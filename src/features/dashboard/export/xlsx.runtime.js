/* 明细表导出 .xlsx。
 *
 * 一份实现两处用:看板里 import 这个文件(它把自己挂到 window),导出的离线网页把同一个
 * 文件内联进去 —— 所以写成普通脚本而不是 ES 模块。两边各写一套的话,迟早一边的数字
 * 格式跟另一边不一样,而且不会有人发现。
 *
 * 不引第三方库:xlsx 就是个 zip 套几份 XML,自己写一百多行够了,比为它多背 1MB 划算
 * (导出的页面是要发给人看的,每一百 KB 都算在打开速度上)。
 * 压缩优先用浏览器自带的 CompressionStream;没有就存储不压 —— 文件大些,但一定能打开。
 *
 * Excel 单表放得下 1048576 行 × 16384 列,超了写出来也打不开,调用方据此改走 CSV。
 */
(function () {
  var MAX_ROWS = 1048576;
  var MAX_COLS = 16384;

  // ---- zip ----
  var CRC = (function () {
    var t = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    var c = 0xffffffff;
    for (var i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  async function deflate(bytes) {
    if (typeof CompressionStream !== "function") return null;
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) { return null; }
  }
  function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
  function u16(v) { return [v & 255, (v >>> 8) & 255]; }

  /** 把若干 {name, bytes} 打成一个 zip。 */
  async function zip(entries) {
    var parts = [], central = [], offset = 0;
    var enc = new TextEncoder();
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var nameBytes = enc.encode(e.name);
      var crc = crc32(e.bytes);
      var packed = await deflate(e.bytes);
      var method = packed ? 8 : 0;
      var body = packed || e.bytes;
      var local = [].concat(
        u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
        u32(crc), u32(body.length), u32(e.bytes.length), u16(nameBytes.length), u16(0));
      parts.push(new Uint8Array(local), nameBytes, body);
      central.push({ name: nameBytes, crc: crc, comp: body.length, raw: e.bytes.length, method: method, offset: offset });
      offset += local.length + nameBytes.length + body.length;
    }
    var dirStart = offset, dirSize = 0;
    for (var j = 0; j < central.length; j++) {
      var c2 = central[j];
      var head = [].concat(
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(c2.method), u16(0), u16(0),
        u32(c2.crc), u32(c2.comp), u32(c2.raw), u16(c2.name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(c2.offset));
      parts.push(new Uint8Array(head), c2.name);
      dirSize += head.length + c2.name.length;
    }
    parts.push(new Uint8Array([].concat(
      u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length),
      u32(dirSize), u32(dirStart), u16(0))));
    return new Blob(parts, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // ---- xlsx ----
  var XML_BAD = new RegExp("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]", "g");
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c];
    }).replace(XML_BAD, "");
  }
  function colName(n) {
    var s = "";
    for (n += 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  var HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  var NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";

  /**
   * columns: [{ label, decimals? }] —— 给了 decimals 的列按数字写进去,
   *          这样 Excel 里能直接求和、排序,而不是一列看着像数字的文本。
   * rows:    原始值二维数组(别传格式化过的字符串)
   */
  async function buildXlsx(sheetName, columns, rows) {
    var enc = new TextEncoder();
    /* 字符串共享表:大区、主管这类值重复得厉害,共享之后文件小一大截。 */
    var shared = [], sharedIndex = new Map();
    function sref(v) {
      var hit = sharedIndex.get(v);
      if (hit !== undefined) return hit;
      var i = shared.length;
      shared.push(v); sharedIndex.set(v, i);
      return i;
    }

    var numeric = columns.map(function (c) { return typeof c.decimals === "number"; });
    /* 样式:0 普通,1 表头(粗体+浅底),之后每种小数位一个。 */
    var styleOf = {}, numFmts = [];
    var cellXfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>',
                   '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1"/>'];
    columns.forEach(function (c) {
      if (typeof c.decimals !== "number" || styleOf[c.decimals] != null) return;
      var id = 164 + numFmts.length;
      var code = c.decimals > 0 ? "#,##0." + new Array(c.decimals + 1).join("0") : "#,##0";
      numFmts.push('<numFmt numFmtId="' + id + '" formatCode="' + code + '"/>');
      styleOf[c.decimals] = cellXfs.length;
      cellXfs.push('<xf numFmtId="' + id + '" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>');
    });

    var body = ['<row r="1">' + columns.map(function (c, i) {
      return '<c r="' + colName(i) + '1" t="s" s="1"><v>' + sref(String(c.label)) + "</v></c>";
    }).join("") + "</row>"];
    for (var r = 0; r < rows.length; r++) {
      var cells = "";
      for (var i2 = 0; i2 < columns.length; i2++) {
        var v = rows[r][i2];
        if (v == null || v === "") continue;
        var ref = colName(i2) + (r + 2);
        var num = numeric[i2] ? Number(v) : NaN;
        if (numeric[i2] && isFinite(num)) cells += '<c r="' + ref + '" s="' + styleOf[columns[i2].decimals] + '"><v>' + num + "</v></c>";
        else cells += '<c r="' + ref + '" t="s"><v>' + sref(String(v)) + "</v></c>";
      }
      body.push('<row r="' + (r + 2) + '">' + cells + "</row>");
    }

    /* 列宽照内容估一下,不然打开一列全是 ####。中文按两个字符宽算。 */
    var widths = columns.map(function (c, i) {
      var w = String(c.label).length * 2 + 4;
      for (var k = 0; k < Math.min(rows.length, 200); k++) {
        var v2 = rows[k][i];
        if (v2 != null) w = Math.max(w, String(v2).length * (/[^\x00-\xff]/.test(String(v2)) ? 2 : 1.1) + 3);
      }
      return Math.min(46, Math.max(8, Math.round(w)));
    });
    var lastCol = colName(columns.length - 1);
    var safeName = String(sheetName || "Sheet1").replace(/[\\\/?*\[\]:]/g, " ").slice(0, 31) || "Sheet1";

    var sheetXml = HEAD + '<worksheet xmlns="' + NS + '">'
      /* 表头冻结 + 自动筛选:几千行的明细表,没这两样根本没法看。 */
      + '<sheetViews><sheetView workbookViewId="0" tabSelected="1">'
      + '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      + "<cols>" + widths.map(function (w, i) {
          return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
        }).join("") + "</cols>"
      + "<sheetData>" + body.join("") + "</sheetData>"
      + '<autoFilter ref="A1:' + lastCol + (rows.length + 1) + '"/>'
      + "</worksheet>";

    var rels = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    var files = [
      { name: "[Content_Types].xml", bytes: enc.encode(HEAD
        + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>') },
      { name: "_rels/.rels", bytes: enc.encode(HEAD
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="' + rels + '/officeDocument" Target="xl/workbook.xml"/></Relationships>') },
      { name: "xl/workbook.xml", bytes: enc.encode(HEAD
        + '<workbook xmlns="' + NS + '" xmlns:r="' + rels + '"><sheets>'
        + '<sheet name="' + esc(safeName) + '" sheetId="1" r:id="rId1"/></sheets></workbook>') },
      { name: "xl/_rels/workbook.xml.rels", bytes: enc.encode(HEAD
        + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="' + rels + '/worksheet" Target="worksheets/sheet1.xml"/>'
        + '<Relationship Id="rId2" Type="' + rels + '/sharedStrings" Target="sharedStrings.xml"/>'
        + '<Relationship Id="rId3" Type="' + rels + '/styles" Target="styles.xml"/></Relationships>') },
      { name: "xl/styles.xml", bytes: enc.encode(HEAD
        + '<styleSheet xmlns="' + NS + '"><numFmts count="' + numFmts.length + '">' + numFmts.join("") + "</numFmts>"
        + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        + '<fill><patternFill patternType="solid"><fgColor rgb="FFEFF3F9"/><bgColor indexed="64"/></patternFill></fill></fills>'
        + '<borders count="1"><border/></borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="' + cellXfs.length + '">' + cellXfs.join("") + "</cellXfs>"
        // 默认样式:少了它有些解析器会报「工作簿没有默认样式」
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + "</styleSheet>") },
      { name: "xl/sharedStrings.xml", bytes: enc.encode(HEAD
        + '<sst xmlns="' + NS + '" count="' + shared.length + '" uniqueCount="' + shared.length + '">'
        + shared.map(function (v) { return '<si><t xml:space="preserve">' + esc(v) + "</t></si>"; }).join("") + "</sst>") },
      { name: "xl/worksheets/sheet1.xml", bytes: enc.encode(sheetXml) },
    ];
    return zip(files);
  }

  /** 超出 Excel 单表上限就别写 xlsx 了 —— 写出来也打不开。 */
  function fitsExcel(rowCount, colCount) {
    return rowCount + 1 <= MAX_ROWS && colCount <= MAX_COLS;
  }

  /** 退路:数据量超出 Excel 能装的,老老实实给 CSV。 */
  function csvBlob(columns, rows) {
    var q = function (v) {
      var s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    var lines = [columns.map(function (c) { return q(c.label); }).join(",")];
    rows.forEach(function (r) { lines.push(r.map(q).join(",")); });
    // BOM:没有它 Excel 打开中文是乱码
    return new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  }

  function saveBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /**
   * 导出一张表。装得下就给 xlsx,装不下自动退回 CSV(并把退回的原因交回调用方说明)。
   * 返回 { format: "xlsx" | "csv", filename }。
   */
  async function exportTable(name, columns, rows) {
    /* 文件名上的日期戳按**本地日历**取。用 toISOString 的话东八区早上八点前会换算成
       UTC 的前一天 —— 一早导出的明细表,文件名写着昨天,看上去像是拿错了旧文件。
       跟 filterControls.runtime.js 的 ymd()、lib/dates.ts 的 localDay() 是同一套算法;
       runtime 脚本要能原样内联进离线网页,不能 import,所以这里自己写。 */
    var now = new Date();
    var p2 = function (n) { return n < 10 ? "0" + n : String(n); };
    var stamp = now.getFullYear() + "-" + p2(now.getMonth() + 1) + "-" + p2(now.getDate());
    var base = String(name || "明细表").replace(/[\\\/:*?"<>|]/g, " ").trim() || "明细表";
    if (fitsExcel(rows.length, columns.length)) {
      var blob = await buildXlsx(base, columns, rows);
      saveBlob(blob, base + "-" + stamp + ".xlsx");
      return { format: "xlsx", filename: base + "-" + stamp + ".xlsx" };
    }
    saveBlob(csvBlob(columns, rows), base + "-" + stamp + ".csv");
    return { format: "csv", filename: base + "-" + stamp + ".csv" };
  }

  // 挂 globalThis:浏览器里就是 window,Node 里(测试/打包)没有 window。
  globalThis.__DASH_XLSX__ = {
    buildXlsx: buildXlsx, fitsExcel: fitsExcel, csvBlob: csvBlob,
    saveBlob: saveBlob, exportTable: exportTable,
    MAX_ROWS: MAX_ROWS, MAX_COLS: MAX_COLS,
  };
})();
