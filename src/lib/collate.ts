/**
 * 文本排序的**唯一**一份规则。
 *
 * 项目里原来一半写 `localeCompare(b, "zh-CN", { numeric: true })`,一半写
 * 光秃秃的 `localeCompare(b)`。后者有两个问题:
 *
 *   1. 不传语言就跟着**操作系统**走。同一份数据,中文系统上按拼音排,
 *      英文系统上按码点排 —— 「丙 甲 乙」变成「丙 乙 甲」。换台电脑打开
 *      同一个库,顺序就变了。
 *   2. 没有 numeric,「店10」排在「店2」前面。
 *
 * 最要命的是两种写法同时存在:结果网格用系统默认排,看板表格和图表用
 * zh-CN + numeric 排。同一列网点名,两个地方给出两种顺序,而且都不说为什么。
 *
 * 语言固定用 zh-CN,不跟界面语言走 —— 排的是**数据**不是界面。
 * 切个界面语言就让同一批网点换个顺序,只会让人以为数据变了。
 */
const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "variant" });

/** 按人读的顺序比两段文本:中文按拼音,数字按大小(店2 在 店10 前面)。 */
export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}
