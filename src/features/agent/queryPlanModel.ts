import type { Metric } from "../metrics/metricTypes";
import { semanticDataset, metricField, metricRollup, isDistinctCount, availableDimensions } from "../dashboard/semantic";
import { createWidget, type DashboardWidget } from "../dashboard/domain";
import type { DatasetShape } from "./validation/dataChecks";
import { fail } from "./tools/toolTypes";
import { isCalendarDay } from "../../lib/dates";

export interface BuildPlanInput {
  metricIds: string[];
  dimensions?: string[];
  dateRange: { start: string; end: string; };
  filters?: { field: string; values: string[]; }[];
  grain?: "day" | "week" | "month" | "year";
}

/** Validate and describe a query without registering plans or accessing a database. */
export function prepareQueryPlan(input: BuildPlanInput, all: Metric[]) {
  const SOH = String.fromCharCode(1);
  const metrics = input.metricIds.map((id) => {
    const metric = all.find((m) => m.id === id);
    if (!metric) fail("MISSING_METRIC", `指标 ${id} 不在指标中心里。metricId 只能来自 validate_metrics 的返回,不要自己编。`);
    if (!metric!.enabled) fail("UNSUPPORTED", `指标「${metric!.name}」已停用,不能用来取数。`);
    return metric!;
  });
  if (!isCalendarDay(input.dateRange.start) || !isCalendarDay(input.dateRange.end) || input.dateRange.start > input.dateRange.end) fail("INVALID_ARGS", "请选择有效的分析日期范围。");
  if (metrics.some((m) => !m.connId)) fail("INVALID_ARGS", "指标尚未绑定数据库连接。");
  if (metrics.length === 0) fail("INVALID_ARGS", "至少要一个指标。");

  const shared = availableDimensions(metrics);
  const dims = [...new Set(input.dimensions ?? [])];
  const invalidFilters = (input.filters ?? []).filter((f) => f.values.length && !shared.includes(f.field));
  if (invalidFilters.length) fail("UNSUPPORTED", "筛选维度不被所选指标支持，请重新选择。");
  if (metrics.some((m) => m.connId !== metrics[0].connId || m.database !== metrics[0].database)) fail("UNSUPPORTED", "不同连接或数据库的指标需要分开分析。");
  const bad = dims.filter((d) => !shared.includes(d));
  if (bad.length) {
    fail(
      "UNSUPPORTED",
      `维度 ${bad.join("、")} 不被这组指标同时支持。「${metrics.map((m) => m.name).join("」「")}」的共同维度是:${shared.join("、") || "(无)"}。` +
      `要按这些维度看,得换一组指标或者去掉它们。`,
    );
  }

  // 借一个临时 widget 走现成的语义数据集装配 —— 不进任何看板,只为了编译查询
  const widget: DashboardWidget = {
    ...createWidget(dims.length ? "table" : "kpi", ""),
    bindings: { dimensions: dims, measures: metrics.map(metricField), metricIds: input.metricIds, secondaryMetricIds: [] },
  };
  const dataset = semanticDataset(widget, metrics, { start: input.dateRange.start, end: input.dateRange.end });

  const filters = (input.filters ?? [])
    .filter((f) => f.values.length)
    .map((f) => ({ field: f.field, kind: "in" as const, value: f.values.join(SOH) }));

  /* 粒度必须来自**真正用来分组的那个时间维度**,不能用区间跨度去猜。
     踩过的坑:按 month 分组查 8 月,只会回来 1 行,而按区间跨度算出来的 grain 是
     day,于是体检认为"应有 31 天却只有 1 天",把一份完全正常的数据判成硬问题。 */
  const timeField = dims.find((d) => ["day", "week", "month", "year"].includes(d));
  const shape: DatasetShape = {
    dimensions: dims,
    metrics: metrics.map((m) => ({ field: metricField(m), name: m.name, rollup: metricRollup(m), unit: m.unit, distinctCount: isDistinctCount(m) })),
    timeField,
    dateRange: input.dateRange,
    grain: (timeField as DatasetShape["grain"]) ?? input.grain ?? "day",
  };

  return { dataset, shape, metricIds: [...input.metricIds], filters };
}
