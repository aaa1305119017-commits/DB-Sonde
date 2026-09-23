export interface PieSlice { name: string; value: number; isOther?: boolean }

/** Keep the full denominator when reducing a composition to its leading categories. */
export function pieComposition(values: PieSlice[], topN: number, includeOthers = true): PieSlice[] {
  /* 负数和缺失的分组剔掉,别让一个退款把整张饼作废。
     原来是「只要有一个负的就整体返回空」—— 真实的 GMV 里出现一两个负数太正常了
     (退款、冲账),于是整张图变成一句「数据含负值或没有可用总量」,还看不出是哪个分组。
     饼图确实表达不了负数,但能表达的那些不该跟着陪葬。 */
  const sorted = values
    .filter((v) => Number.isFinite(v.value) && v.value > 0)
    .sort((a, b) => b.value - a.value);
  const limit = Math.floor(topN);
  if (limit <= 0 || sorted.length <= limit) return sorted;
  const selected = sorted.slice(0, limit);
  if (!includeOthers) return selected;
  let otherName = "其他";
  const names = new Set(sorted.map((v) => v.name));
  while (names.has(otherName)) otherName = `其余分组（${otherName}）`;
  return [...selected, { name: otherName, value: sorted.slice(limit).reduce((sum, v) => sum + v.value, 0), isOther: true }];
}
