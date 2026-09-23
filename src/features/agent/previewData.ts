import { resolveSemanticDocument } from '../dashboard/semantic';
import type { DashboardDocument, DashboardRuntimeData } from '../dashboard/domain';
import type { Metric } from '../metrics/metricTypes';
import type { AgentState } from './state';
import type { ToolCaller } from './nodes/ports';
import type { PlanReader } from './planReader';
import { shiftRange } from './period';
import type { QueryResult } from '../../types';
export interface PreviewDataPorts { readCatalog(): Metric[]; callTool: ToolCaller; getPlan: PlanReader; }
/** Build the same semantic datasets as the editor, and validate every rendered view. */
export async function previewData(document: DashboardDocument, state: AgentState, signal: AbortSignal | undefined, port: PreviewDataPorts) {
  signal?.throwIfAborted();
  const doc = resolveSemanticDocument(document, port.readCatalog());
  const runtime: Record<string, DashboardRuntimeData> = {};
  const views = new Map<string, QueryResult>();
  for (const widget of doc.widgets) {
    if (widget.type === 'text' || widget.type === 'container' || !widget.visible) continue;
    signal?.throwIfAborted();
    const dataset = doc.datasets.find((d) => d.id === widget.datasetId)!;
    if (!dataset?.metricScope) throw new Error(`「${widget.title}」没有已核对的数据范围`);
    const dimensions = [...new Set([...(widget.bindings.dimensions ?? []), ...(widget.bindings.seriesDimension ? [widget.bindings.seriesDimension] : [])])];
    const read = async (range: { start: string; end: string; }) => {
      signal?.throwIfAborted();
      const input = {
        metricIds: dataset.metricIds!, dimensions, dateRange: range,
        filters: (dataset.metricScope!.filters ?? []).map((f) => ({ field: f.field, values: f.value.split('\x01') }))
      };
      const key = JSON.stringify(input);
      if (views.has(key)) return views.get(key)!;
      if (views.size >= 60) throw new Error('成品取数视角过多，请减少重复组件');
      const built = await port.callTool<{ planId: string; }>('build_query_plan', input, state.workflowId);
      signal?.throwIfAborted();
      if (!built.ok) throw new Error(built.error?.message);
      const id = built.data!.planId;
      const result = await port.callTool('execute_query_plan', { planId: id, maxRows: 20000, preview: 3 }, state.workflowId);
      signal?.throwIfAborted();
      if (!result.ok) throw new Error(result.error?.message);
      const checked = await port.callTool<{ issues: { level: string; message: string; }[]; }>('validate_dataset', { planId: id, checkTotals: true }, state.workflowId);
      signal?.throwIfAborted();
      if (!checked.ok || checked.data!.issues.some((i) => i.level === 'fail')) throw new Error(`「${widget.title}」成品数据未通过检查：${checked.data?.issues.filter((i) => i.level === 'fail').map((i) => i.message).join('；') ?? checked.error?.message}`);
      const data = port.getPlan(id)!.result!;
      views.set(key, data); return data;
    };
    const range = { start: dataset.metricScope.start, end: dataset.metricScope.end };
    const result = await read(range);
    const comparison: NonNullable<DashboardRuntimeData['comparison']> = {};
    if (widget.type === 'kpi' && widget.options.kpi?.showComparison) {
      for (const period of state.scope?.comparisonRanges ?? []) comparison[period.kind === 'mom' ? 'period' : 'year'] = await read(shiftRange(range, period.kind));
    }
    runtime[widget.id] = { loading: false, result, comparison };
  }
  return { doc, runtime };
}
