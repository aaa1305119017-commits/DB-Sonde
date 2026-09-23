/**
 * 图表导出注册表:ChartWidget 挂载时以 widgetId 注册自己的"导出 PNG"函数
 * (内部持有 ECharts 实例),画布头部的导出按钮据此触发。避免把 ECharts 实例
 * 从深层组件往上层头部穿线。
 */
const exporters = new Map<string, () => void>();

export function registerChartExporter(widgetId: string, fn: () => void): () => void {
  exporters.set(widgetId, fn);
  return () => { if (exporters.get(widgetId) === fn) exporters.delete(widgetId); };
}

/** 触发某组件导出 PNG(若已注册)。 */
export function exportChartPng(widgetId: string): void {
  exporters.get(widgetId)?.();
}

export function canExportChart(widgetId: string): boolean {
  return exporters.has(widgetId);
}
