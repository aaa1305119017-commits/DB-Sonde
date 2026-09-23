/* 图表悬浮提示里的文本转义。
 *
 * ECharts 的 tooltip formatter 返回的是 **HTML 字符串**,而里面拼的东西
 * ——分类名、系列名、维度值、指标名——全都来自数据库。原样拼进去,一个
 * 名字叫 `<img src=x onerror=...>` 的分组就能在别人悬浮时执行脚本;桌面版
 * 同一个页面还握着原生命令调用能力,后果不止于页面篡改。
 *
 * ECharts 自己生成的 `p.marker`(那个圆色块 span)是结构性 HTML,不转义。
 * 除它之外,进 tooltip 的每一段外来文本都要过这里。
 *
 * 写成普通脚本是为了能原样内联进导出的离线网页 —— 看板和导出页共用这一份,
 * 免得修了一处漏另一处。
 */
(function () {
  var MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

  function esc(value) {
    if (value == null) return "";
    return String(value).replace(/[&<>"']/g, function (c) { return MAP[c]; });
  }

  globalThis.__DASH_TIP__ = { esc: esc };
})();
