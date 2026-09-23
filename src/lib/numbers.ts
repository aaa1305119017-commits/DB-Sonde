/**
 * 数值上的小工具 —— 只放那些「写法看着没问题、数据一大就出事」的。
 *
 * `Math.min(...values)` 是最典型的一个:参数展开有个引擎级的上限
 * (WebKit 上几万个就到头了),而这四个地方拿到的数组长度是用户数据说了算的 ——
 * 结果网格里选中一整列(后端上限 20 万行)、明细表的列合计、图表里一个分组的行、
 * 分析事实计算里一个分组的行。到了就是一句 RangeError,不是慢,是直接报错。
 */

/** 最小值。空数组返回 null —— 调用方自己决定「没有数」该显示什么。 */
export function minOf(values: readonly number[]): number | null {
  let out: number | null = null;
  for (const value of values) if (out === null || value < out) out = value;
  return out;
}

/** 最大值。空数组返回 null。 */
export function maxOf(values: readonly number[]): number | null {
  let out: number | null = null;
  for (const value of values) if (out === null || value > out) out = value;
  return out;
}
