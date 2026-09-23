import type { Metric } from "../metrics/metricTypes";
import { availableDimensions, metricRollup } from "../dashboard/semantic";
import { metricSourceTables } from "../metrics/metricSql";
import { GRAIN_LABELS, planDimensions } from "../metrics/queryPlan";

export function validatedMetricsFor(ids: string[], all: Metric[]) {
  return ids.map((id) => all.find((m) => m.id === id)).filter((m): m is Metric => !!m).map((m) => ({
    metricId: m.id, name: m.name, unit: m.unit, direction: m.higherIsBetter === true ? "higher" as const : m.higherIsBetter === false ? "lower" as const : "neutral" as const, caliber: m.caliber, rollup: metricRollup(m),
    supportedDimensions: availableDimensions([m]), dateScoped: true,
    sourceTables: metricSourceTables(m, (id) => all.find((x) => x.id === id)),
  }));
}

/** Names belong to the caller's scoped catalog, never another connection's vocabulary. */
export function catalogDimensionLabel(all: Metric[], key: string): string {
  for (const metric of all) {
    const explicit = metric.dimensionLabels?.[key];
    if (explicit && explicit !== key) return explicit;
    const label = metric.queryPlan && planDimensions(metric.queryPlan)[key]?.label;
    if (label && label !== key) return label;
  }
  return GRAIN_LABELS[key] ?? key;
}

/**
 * 这次分析该连哪个连接。
 *
 * 连接是**指标目录的属性**,不是"你点「分析」时恰好在看哪个 tab"。
 * 指标编译出来的 SQL 只能在它自己声明的那个连接上跑,拿别的连接去查是错的。
 *
 * 踩过:用户在浏览另一个库的表时点了「分析」,分析 tab 就把那个连接焊死在身上
 * (tab 建一次之后一直复用),于是 153 个指标全被 `connId` 过滤掉,
 * 提示「当前连接没有可用指标」—— 而指标一个没少,只是找错了地方。
 *
 * 规则:当前连接自己有启用的指标就用它(用户可能真有多个连接各带一套口径);
 * 没有、而全局只有一个连接有指标时,那个就是唯一正确答案,直接用;
 * 有好几个连接都有指标时**不猜**,原样返回,让上层把候选摆出来问人。
 */
export function catalogConnection(metrics: Metric[], current: string): { connId: string; candidates: { connId: string; connName: string; count: number }[] } {
  const enabled = metrics.filter((m) => m.enabled);
  const byConn = new Map<string, { connId: string; connName: string; count: number }>();
  for (const m of enabled) {
    const hit = byConn.get(m.connId);
    if (hit) hit.count += 1;
    else byConn.set(m.connId, { connId: m.connId, connName: m.connName ?? "", count: 1 });
  }
  const candidates = [...byConn.values()].sort((a, b) => b.count - a.count);
  if (current && byConn.has(current)) return { connId: current, candidates };
  return { connId: candidates.length === 1 ? candidates[0].connId : current, candidates };
}
