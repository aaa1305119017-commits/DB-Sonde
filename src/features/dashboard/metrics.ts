import { nanoid } from "nanoid";
import type { QueryResult } from "../../types";
import type { DashboardDataset, DashboardDocument, DashboardMetricAggregation, DashboardMetricDefinition, DashboardWidget } from "./domain";

export interface ResolvedDashboardMetric {
  key: string;
  field: string;
  name: string;
  aggregation: DashboardMetricAggregation;
  unit: string;
  decimals: number;
  direction: "neutral" | "higher" | "lower";
  columnIndex: number;
  dateScoped?: boolean; // 是否随日期范围变化(同环比是否适用)
}

/** Resolve reusable semantic metrics first, then retain field-based bindings
 * for dashboards created before schema v2. */
export function resolveWidgetMetrics(
  widget: DashboardWidget,
  definitions: DashboardMetricDefinition[],
  columns: QueryResult["columns"],
  /** 字段 → 显示名(数据集里改过的名字)。图例和表头用它,别把英文列名甩给看的人。 */
  fieldLabels?: Record<string, string>,
): ResolvedDashboardMetric[] {
  const reusable = resolveMetricIds(widget, widget.bindings.metricIds, definitions, columns);
  if (reusable.length) return reusable;

  /* 没绑度量时猜「第二列就是指标」—— 那是给老文档留的兜底(那时候数据集是一段裸 SQL,
     没有字段角色可问)。可它会把维度当成指标:行放日期、列放品类,第二列是品类,
     于是表头写着「品类」、格子里全是 0。绑过维度的就不猜了,宁可空着让人去选。 */
  const boundDims = [
    ...(widget.bindings.dimensions ?? []),
    ...(widget.bindings.dimension ? [widget.bindings.dimension] : []),
    ...(widget.bindings.seriesDimension ? [widget.bindings.seriesDimension] : []),
  ];
  const guess = columns.slice(1, 2).map((column) => column.name).filter((name) => !boundDims.includes(name));
  const fields = widget.bindings.measures.length ? widget.bindings.measures : guess;
  return fields.flatMap((field) => {
    const columnIndex = columns.findIndex((column) => column.name === field);
    if (columnIndex < 0) return [];
    const presentation = widget.options.metrics[field];
    /* 汇总方式原来写死成 sum。SQL 那边是按用户选的算的,可渲染层拿到的永远是「求和」——
       于是明细表的小计/总计把一列平均值加起来,饼图也不再拦"平均值组不成整体"。
       数字错了还不报错,是最难发现的那种。 */
    const agg = (widget.bindings.aggregations ?? {})[field];
    return [{
      key: `field:${field}`,
      field,
      name: presentation?.alias.trim() || fieldLabels?.[field] || field,
      aggregation: (agg ?? "sum") as DashboardMetricAggregation,
      unit: presentation?.unit ?? "",
      decimals: presentation?.decimals ?? widget.options.decimals,
      direction: presentation?.direction ?? "neutral",
      columnIndex,
    }];
  });
}

export function resolveMetricIds(
  widget: DashboardWidget,
  metricIds: string[],
  definitions: DashboardMetricDefinition[],
  columns: QueryResult["columns"],
): ResolvedDashboardMetric[] {
  return metricIds
    .map((id) => definitions.find((metric) => metric.id === id && metric.datasetId === widget.datasetId))
    .filter((metric): metric is DashboardMetricDefinition => !!metric)
    .flatMap((metric) => {
      const columnIndex = columns.findIndex((column) => column.name === metric.field);
      if (columnIndex < 0) return [];
      // 看板级覆盖(别名/精度/单位/趋势),存 options.metrics[metric.id];缺省用指标中心的。
      const p = widget.options.metrics[metric.id];
      return [{
        key: metric.id,
        field: metric.field,
        name: p?.alias?.trim() || metric.name,
        aggregation: metric.aggregation,
        unit: p?.unit ?? metric.unit,
        decimals: p?.decimals ?? metric.decimals,
        direction: p?.direction ?? metric.direction,
        columnIndex,
        dateScoped: metric.dateScoped,
      }];
    });
}

export function reconcileWidgetMetrics(widget: DashboardWidget, definitions: DashboardMetricDefinition[]): DashboardWidget {
  if (!widget.bindings.metricIds.length && !widget.bindings.secondaryMetricIds.length) return widget;
  const selected = widget.bindings.metricIds
    .map((id) => definitions.find((metric) => metric.id === id && metric.datasetId === widget.datasetId))
    .filter((metric): metric is DashboardMetricDefinition => !!metric);
  const secondary = widget.bindings.secondaryMetricIds
    .map((id) => definitions.find((metric) => metric.id === id && metric.datasetId === widget.datasetId))
    .filter((metric): metric is DashboardMetricDefinition => !!metric && !selected.some((primary) => primary.id === metric.id));
  return {
    ...widget,
    bindings: {
      ...widget.bindings,
      metricIds: selected.map((metric) => metric.id),
      measures: selected.map((metric) => metric.field),
      secondaryMetricIds: secondary.map((metric) => metric.id),
    },
  };
}

export function createDashboardMetric(dataset?: DashboardDataset): DashboardMetricDefinition | undefined {
  const field = dataset?.fields.find((item) => item.role === "measure");
  if (!dataset || !field) return undefined;
  return {
    id: `metric-${nanoid(10)}`,
    name: field.name,
    description: "",
    datasetId: dataset.id,
    field: field.name,
    aggregation: "sum",
    unit: "",
    decimals: 2,
    direction: "neutral",
  };
}

export function updateDashboardMetric(document: DashboardDocument, metric: DashboardMetricDefinition): DashboardDocument {
  const metrics = document.metrics.map((item) => item.id === metric.id ? metric : item);
  return { ...document, metrics, widgets: document.widgets.map((widget) => reconcileWidgetMetrics(widget, metrics)) };
}

export function removeDashboardMetric(document: DashboardDocument, id: string): DashboardDocument {
  const metrics = document.metrics.filter((item) => item.id !== id);
  return { ...document, metrics, widgets: document.widgets.map((widget) => reconcileWidgetMetrics(widget, metrics)) };
}
