import type { Cell } from "../../../types";
import type { ResolvedDashboardMetric } from "../metrics";
import type { DashboardNumberFormat } from "../domain";
import { maxOf, minOf } from "../../../lib/numbers";

/** 组件渲染共享的数值/指标工具。所有 widget 组件复用,避免各处重复实现。 */

export function numberValue(value: Cell): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatNumber(value: number, decimals: number, grouping = false): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals, useGrouping: grouping }).format(value);
}

/** 单位换算表。换算后单位由后缀接管:12345678 元 → 1,234.57 万元。 */
const SCALES: Record<"none" | "wan" | "yi", { div: number; suffix: string }> = {
  none: { div: 1, suffix: "" },
  wan: { div: 1e4, suffix: "万" },
  yi: { div: 1e8, suffix: "亿" },
};

/** auto:每个数按自己的量级选一档。定死一档时,一张卡上量级差很远的几个数必有读不出的。 */
export function scaleFor(value: number, scale: DashboardNumberFormat["scale"]): "none" | "wan" | "yi" {
  if (scale !== "auto") return scale ?? "none";
  const size = Math.abs(value);
  return size >= 1e8 ? "yi" : size >= 1e4 ? "wan" : "none";
}

/**
 * 带显示格式的数值渲染:单位换算 + 前后缀。
 *
 * 大额金额原样摊开是「12,345,678 元」,一眼读不出量级 —— 管理层看板需要「1,234.6 万元」。
 * `fmt.suffix` 留空时后缀 = 换算词 + 指标单位;填了就整个由它接管(比如只想要「万」不要「元」)。
 */
export function scaledText(
  value: number,
  decimals: number,
  unit: string,
  fmt?: DashboardNumberFormat,
  grouping = false,
): string {
  const scale = SCALES[scaleFor(value, fmt?.scale)];
  const shown = formatNumber(value / scale.div, decimals, grouping);
  const suffix = fmt?.suffix ?? `${scale.suffix}${unit}`;
  return `${fmt?.prefix ?? ""}${shown}${suffix}`;
}

/** 指标显示名(带单位)。 */
export function metricLabel(metric: ResolvedDashboardMetric): string {
  return metric.unit.trim() ? `${metric.name} (${metric.unit.trim()})` : metric.name;
}

/** 指标数值(格式化 + 单位 + 可选的显示格式)。 */
export function metricValue(
  metric: ResolvedDashboardMetric,
  value: number,
  fmt?: DashboardNumberFormat,
): string {
  return scaledText(value, metric.decimals, metric.unit, fmt);
}

/**
 * 把几行合成一个数(同一个 x 上有多行时)。
 *
 * 进来的值**已经被数据库聚合过一轮**,每行是一个分组的结果。所以「计数」要把各组的
 * 计数**相加** —— 原来返回 values.length,那是"有几行",五家店各一百单会得到 5。
 *
 * 平均和去重计数严格说算不回去(各组行数不同 / 去重集合会重叠),但图形要有个高度,
 * 只能取近似:平均取各组平均的平均,去重计数按相加当上界。饼图那边另有拦截 ——
 * 只有 sum 和 count 这种真可加的才让画,别的会让人改用条形图。
 */
export function aggregate(rows: Cell[][], metric: ResolvedDashboardMetric): number {
  const values = rows.map((row) => row[metric.columnIndex]).filter((value) => value != null).map(numberValue);
  if (values.length === 0) return 0;
  /* 去重计数落到这儿只能退而求其次按平均算:一格里本来就该只有一行(SQL 已经分过组),
     多行说明查询的维度比图上细,这时候相加会把同一个对象数好几遍 —— 平均至少量级还在。
     真正危险的是拿它画饼(各块加起来当整体),那条由看板验收挡(NON_ADDITIVE_PIE)。 */
  if (metric.aggregation === "avg" || metric.aggregation === "count_distinct") {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  // 循环取极值:一个分组的行数是用户数据说了算的,参数展开有引擎级上限
  if (metric.aggregation === "min") return minOf(values) ?? 0;
  if (metric.aggregation === "max") return maxOf(values) ?? 0;
  return values.reduce((sum, value) => sum + value, 0);
}

/** 一组指标共享的单位(仅当全部同单位时返回,用于坐标轴名)。 */
export function axisUnit(metrics: ResolvedDashboardMetric[]): string {
  const units = [...new Set(metrics.map((metric) => metric.unit.trim()).filter(Boolean))];
  return units.length === 1 ? units[0] : "";
}

/** 指标切换/分组切换的一个选项:一个选项对应一个或一组指标。 */
export interface MetricChoice {
  id: string;
  label: string;
  metrics: ResolvedDashboardMetric[];
}

/**
 * 由 displayMode 构建切换器选项(KPI 与图表共用):
 * - group_switch:每个指标组一项(过滤到实际绑定的指标),空组丢弃;
 * - 其它(switch):每个指标一项。
 * group.metricIds 引用指标中心 id,与 ResolvedDashboardMetric.key 一致。
 */
export function buildMetricChoices(
  displayMode: string | undefined,
  metricGroups: { id: string; label: string; metricIds: string[] }[] | undefined,
  metrics: ResolvedDashboardMetric[],
  groupFallbackLabel: string,
): MetricChoice[] {
  if (displayMode === "group_switch") {
    return (metricGroups ?? [])
      .map((group) => ({ id: group.id, label: group.label || groupFallbackLabel, metrics: metrics.filter((m) => group.metricIds.includes(m.key)) }))
      .filter((choice) => choice.metrics.length > 0);
  }
  return metrics.map((m) => ({ id: m.key, label: metricLabel(m), metrics: [m] }));
}
