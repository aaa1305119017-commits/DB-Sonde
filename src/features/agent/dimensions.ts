import { useMetrics } from "../metrics/metricsStore";
import { GRAIN_LABELS, planDimensions } from "../metrics/queryPlan";

/**
 * 维度 key → 人看的名字。
 *
 * 一个维度有三层称呼(以某个零售部署为例):
 *   war_zone       维度 key    —— 指标中心的词汇表,模型和代码都用它
 *   d.outlet_region  SQL 表达式  —— 库里真正的列
 *   大区            label      —— 人看的
 * 这三层是什么词由部署时配的指标中心决定,代码不预设任何行业词汇。
 *
 * 界面上原来直接摊 key(「war_zone=华东/华北」),用户看了第一反应是
 * 「war_zone 是什么?大区字段不是 outlet_region 吗?」—— 一个正确的东西,
 * 因为用错了称呼,看起来像个 bug。给人看的地方一律用 label。
 *
 * label 直接取自指标定义,不另建一张映射表 —— 多一张表就多一处会过期的地方。
 */

export function dimensionLabel(key: string): string {
  for (const metric of useMetrics.getState().metrics) {
    if (!metric.queryPlan) continue;
    const hit = planDimensions(metric.queryPlan)[key];
    // union 分支里的 label 会被填成 key 本身,那种不算数
    if (hit?.label && hit.label !== key) return hit.label;
  }
  return GRAIN_LABELS[key] ?? key;
}

/** 「大区、网点」这种连起来的说法。 */
export function dimensionLabels(keys: readonly string[]): string {
  return keys.map(dimensionLabel).join("、");
}
