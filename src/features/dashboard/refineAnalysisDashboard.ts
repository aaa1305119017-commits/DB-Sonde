import { nanoid } from "nanoid";
import type { DashboardDocument } from "./domain";
import type { Metric } from "../metrics/metricsStore";
import { metricRollup, availableDimensions } from "./semantic";
import { refineAnalysisLayout } from "../agent/presentation";
import type { LayoutItem } from "../agent/layout";

type SourcedItem = LayoutItem & { sourceWidgetId: string };

/** Upgrade a generated board in the editor's existing undo/save flow. */
export function refineAnalysisDashboard(doc: DashboardDocument, metrics: Metric[]): DashboardDocument {
  if (doc.widgets.some((w) => w.type === "container" || w.parentId)) return doc;
  const items: SourcedItem[] = doc.widgets.map((w) => ({
    sourceWidgetId: w.id, x: w.x, y: w.y, w: w.w, h: w.h, type: w.type as LayoutItem["type"], title: w.title, subtitle: w.type === "pie" ? "全部分组 · 占本期总量的比例" : w.subtitle,
    content: w.options.content, footnote: w.type === "pie" ? "各组数量占本期总量的比例；不等于各组自身的发生率。" : w.footnote,
    metricIds: w.bindings.metricIds, dimensions: w.bindings.dimensions ?? (w.bindings.dimension ? [w.bindings.dimension] : []),
    width: "half", band: w.type === "kpi" ? "kpi" : w.type === "pie" ? "structure" : w.type === "line" ? "trend" : w.type === "bar" ? "ranking" : "detail",
    reason: doc.aiProvenance?.widgetReasons?.[w.id] ?? "整理分析版式", topN: w.type === "pie" ? 0 : w.options.topN,
    kpi: w.options.kpi, chart: w.options.chart, appearance: w.options.appearance, text: w.options.text,
  }));
  const layout = refineAnalysisLayout({ title: doc.title, items }, metrics.map((m) => ({ metricId: m.id, name: m.name, rollup: metricRollup(m), supportedDimensions: availableDimensions([m]) })));
  const used = new Set<string>();
  const reasons = { ...doc.aiProvenance?.widgetReasons };
  const widgets = layout.items.map((item) => {
    const sourceId = (item as SourcedItem).sourceWidgetId;
    const source = doc.widgets.find((w) => w.id === sourceId)!;
    const id = item.type === source.type && !used.has(sourceId) ? sourceId : nanoid();
    used.add(id);
    reasons[id] = item.reason;
    return { ...source, id, datasetId: id === sourceId ? source.datasetId : `semantic:${id}`, type: item.type,
      title: item.title, subtitle: item.subtitle, footnote: item.footnote,
      bindings: { ...source.bindings, dimensions: item.dimensions, dimension: item.dimensions[0] },
      x: item.x!, y: item.y!, w: item.w!, h: item.h!,
      options: { ...source.options, topN: item.topN ?? source.options.topN,
        appearance: item.appearance, text: item.text, kpi: item.kpi,
        chart: { ...source.options.chart, ...item.chart },
      },
    };
  });
  return { ...doc, widgets, ...(doc.aiProvenance ? { aiProvenance: { ...doc.aiProvenance, widgetReasons: reasons } } : {}) };
}
