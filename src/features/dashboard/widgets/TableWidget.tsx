import { useCallback, useMemo } from "react";
import type { QueryResult } from "../../../types";
import type { DashboardDrillFilter, DashboardWidget } from "../domain";
import type { ResolvedDashboardMetric } from "../metrics";
import DashboardTable from "../components/DashboardTable";
import type { TableColumnSpec } from "../pivot";
import { metricLabel } from "./metricUtils";

interface Props {
  widget: DashboardWidget;
  result: QueryResult;
  resolvedMetrics: ResolvedDashboardMetric[];
  secondaryMetrics: ResolvedDashboardMetric[];
  dimensionLabels?: Record<string, string>;
  onDrill?: (filter: DashboardDrillFilter) => void;
}

/** 明细/透视表:绑定的度量为指标列,其余列一律视为维度(天然支持多维度)。 */
export default function TableWidget({ widget, result, resolvedMetrics, secondaryMetrics, dimensionLabels, onDrill }: Props) {
  /* 列清单必须记住。表格里那几个 useMemo 全以 columns 为依赖,这里每次渲染都造一个
     新数组的话,它们一次也命中不了 —— 于是父组件任何一次重渲染(改个绑定、保存一下、
     点开个下拉),整张透视表都要按 500 行 × 上千列重算一遍再全量重绘。
     这就是「选完字段卡一下」和「保存之后一顿一顿」的来源。 */
  const specs = useMemo<TableColumnSpec[]>(() => {
    const metricSpecs = [...resolvedMetrics, ...secondaryMetrics];
    const metricIdx = new Set(metricSpecs.map((m) => m.columnIndex));
    const out: TableColumnSpec[] = [];
    result.columns.forEach((column, index) => {
      // 列头显示中文维度名(数据集里配的),key 仍用字段名,排序/宽度/合并映射不受影响。
      if (!metricIdx.has(index)) out.push({ key: column.name, label: dimensionLabels?.[column.name] || column.name, kind: "dim", colIndex: index });
    });
    // 带上聚合口径:小计/列总计据此决定加总还是取平均(比率列加总是错的)。
    metricSpecs.forEach((m) => out.push({ key: m.key, label: metricLabel(m), kind: "metric", colIndex: m.columnIndex, decimals: m.decimals, unit: m.unit, aggregation: m.aggregation }));
    return out;
  }, [result.columns, resolvedMetrics, secondaryMetrics, dimensionLabels]);

  // 行内箭头每次都是新函数,memo 会当成 props 变了 —— 稳住它表格才拦得住重绘。
  const drill = useCallback(
    (field: string, value: string) => onDrill?.({ datasetId: widget.datasetId, field, value }),
    [onDrill, widget.datasetId],
  );

  return (
    <DashboardTable
      columns={specs}
      rows={result.rows}
      options={widget.options.table}
      filename={widget.title}
      truncated={result.truncated}
      onDrill={onDrill ? drill : undefined}
    />
  );
}
