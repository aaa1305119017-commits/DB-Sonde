/**
 * 够用的 XML 读取 —— **不是通用 XML 解析器**。
 *
 * 只为读 Kettle 导出的 .ktr / .kjb 而写:认元素、属性、文本、CDATA,跳过注释、
 * 处理指令和 DOCTYPE,实体按常见那几个解码。**不做**校验、命名空间、DTD、
 * 混合内容的保序 —— 那些 Kettle 的序列化器不会产出,写了也是负担。
 *
 * 为什么不装个现成的:fast-xml-parser@5 解包 1.3 MB、带三个传递依赖,
 * 而这是个要装到用户机器上的桌面应用,刚花力气把导出包从 1.2 MB 压到 667 KB。
 * 代价是这份代码得自己保证对 —— 所以它单独成文件、只暴露读取用的几个函数:
 * 哪天证明不够用(遇上命名空间、或者要解析别家工具的 XML),换成真解析器
 * 是改这一个文件的事,kettle.ts 一行都不用动。
 *
 * 容错原则:**结构不对时宁可少读,不要瞎猜**。标签没闭合就当它到此为止,
 * 不去猜用户想表达什么 —— 猜错会产出一条不存在的血缘,比少一条更糟。
 */

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  /** 本元素直接持有的文本(含 CDATA),不含子元素里的。已解码实体。 */
  text: string;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
};

/** 解码常见实体和数字引用。认不出的原样留着 —— 那多半是数据里真的有个 & 。 */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/**
 * 解析出所有**顶层元素**。粘贴多个文件时它们会首尾相接,所以返回数组而不是单个根。
 * 一个都读不出来就返回空数组 —— 调用方自己决定怎么报错。
 */
export function parseXml(source: string): XmlNode[] {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  let i = 0;
  const n = source.length;

  /** 把一段文本挂到栈顶元素上。 */
  const addText = (raw: string) => {
    const top = stack[stack.length - 1];
    if (!top) return;                       // 顶层的散文本不要
    const value = decodeEntities(raw);
    if (value.trim() || top.text) top.text += value;
  };

  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt < 0) { addText(source.slice(i)); break; }
    if (lt > i) addText(source.slice(i, lt));

    // <![CDATA[ ... ]]> —— 里面原样保留,不解实体
    if (source.startsWith("<![CDATA[", lt)) {
      const end = source.indexOf("]]>", lt + 9);
      const top = stack[stack.length - 1];
      if (top) top.text += source.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    // <!-- --> 注释,<?...?> 处理指令,<!DOCTYPE ...> —— 一律跳过
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (source.startsWith("<?", lt)) {
      const end = source.indexOf("?>", lt + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (source.startsWith("<!", lt)) {
      const end = source.indexOf(">", lt + 2);
      i = end < 0 ? n : end + 1;
      continue;
    }

    // 找这个标签的 >,引号里的 > 不算
    let j = lt + 1;
    let quote: '"' | "'" | null = null;
    while (j < n) {
      const ch = source[j];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === ">") break;
      j += 1;
    }
    if (j >= n) break;                       // 标签没闭合,到此为止
    const inner = source.slice(lt + 1, j);
    i = j + 1;

    if (inner[0] === "/") {
      // 闭合标签:从栈顶往下找同名的,找到就弹到它;找不到说明结构乱了,忽略
      const tag = inner.slice(1).trim();
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k].tag === tag) { stack.length = k; break; }
      }
      continue;
    }

    const selfClosing = inner.endsWith("/");
    const body = selfClosing ? inner.slice(0, -1) : inner;
    const space = body.search(/\s/);
    const tag = (space < 0 ? body : body.slice(0, space)).trim();
    if (!tag) continue;
    const node: XmlNode = { tag, attrs: space < 0 ? {} : parseAttrs(body.slice(space)), text: "", children: [] };

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(node);
    else roots.push(node);
    if (!selfClosing) stack.push(node);
  }
  return roots;
}

function parseAttrs(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    out[m[1]] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? "");
  }
  return out;
}

/** 直接子元素里第一个叫这个名字的。 */
export const child = (node: XmlNode | undefined, tag: string): XmlNode | undefined =>
  node?.children.find((c) => c.tag === tag);

/** 直接子元素里所有叫这个名字的。 */
export const children = (node: XmlNode | undefined, tag: string): XmlNode[] =>
  node ? node.children.filter((c) => c.tag === tag) : [];

/** 直接子元素的文本,去掉首尾空白。没有就空串。 */
export const childText = (node: XmlNode | undefined, tag: string): string =>
  (child(node, tag)?.text ?? "").trim();

/** 整棵子树里所有叫这个名字的(含自己)。 */
export function findAll(node: XmlNode, tag: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (x: XmlNode) => {
    if (x.tag === tag) out.push(x);
    x.children.forEach(walk);
  };
  walk(node);
  return out;
}
