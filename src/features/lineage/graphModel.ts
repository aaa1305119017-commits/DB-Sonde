import type { Endpoint, EtlSource } from "../etl/types";
import { metricSourceTables } from "../metrics/metricSql";
import type { Metric } from "../metrics/metricsStore";
import { endpointId, labelForNode, nodeKindOf, tableId, taskNodeId, workflowNodeId, type GEdge, type GNode, type Graph } from "./lineageModel";
import { compareText } from "../../lib/collate";

const edgeKey = (e: GEdge) => JSON.stringify([e.source, e.from, e.to]);
export function dedup(edges: GEdge[]): GEdge[] {
  const seen = new Set<string>();
  const out: GEdge[] = [];
  for (const e of edges) {
    if (e.from && e.to && e.from !== e.to && !seen.has(edgeKey(e))) {
      seen.add(edgeKey(e));
      out.push(e);
    }
  }
  return out;
}

const usable = (e: Endpoint) => !!(e.table || e.path);

/** Live ETL edges for endpoints with a concrete table/file. querySql readers
 *  (source table hidden in a SELECT) are resolved by scanEtl() via sqlglot. */
function etlEdges(sources: EtlSource[]): GEdge[] {
  const out: GEdge[] = [];
  const add = (from: string, to: string, kind: string) => out.push({ from, to, kind, source: "etl" });
  for (const src of sources) for (const job of src.jobs) {
    const task = taskNodeId(job);
    if (job.scheduler) {
      add(workflowNodeId(job), task, "包含任务");
      for (const code of job.scheduler.upstreamTaskCodes) {
        const parent = src.jobs.find(j => j.scheduler?.baseUrl === job.scheduler?.baseUrl && j.scheduler?.projectCode === job.scheduler?.projectCode && j.scheduler?.workflowCode === job.scheduler?.workflowCode && j.scheduler?.taskCode === code);
        if (parent) add(taskNodeId(parent), task, "任务依赖");
      }
    }
    for (const ref of job.references ?? []) add(`file:${ref}`, task, "脚本引用");
    for (const e of job.sources.filter(usable)) add(endpointId(e), task, "读取");
    for (const e of job.targets.filter(usable)) add(task, endpointId(e), "写入");
    for (const flow of job.flows ?? [job]) for (const s of flow.sources.filter(usable)) for (const t of flow.targets.filter(usable)) add(endpointId(s), endpointId(t), "写入");
  }
  return out;
}
function liveMetricEdges(metrics: Metric[]): GEdge[] {
  return metrics.flatMap(m => metricSourceTables(m, id => metrics.find(x => x.id === id)).map(table => ({ from: tableId(m.database, table), to: `metric:${m.id}`, kind: "用于", source: "metric" as const })));
}

/** Merge ETL edges + scanned edges into a graph with adjacency. */
export function buildLineageGraph(scanned: GEdge[], sources: EtlSource[], metrics: Metric[]): Graph {
  const edges = dedup([...etlEdges(sources), ...liveMetricEdges(metrics), ...scanned.filter(e => e.source !== "metric" || metrics.some(m => m.type === "sql" && e.to === `metric:${m.id}`))]);
  const nodeMap = new Map<string, GNode>();
  const up = new Map<string, GEdge[]>();
  const down = new Map<string, GEdge[]>();
  const jobs = sources.flatMap(source => source.jobs);
  const touch = (id: string) => {
    if (!nodeMap.has(id)) nodeMap.set(id, { id, label: labelForNode(id, metrics, jobs), kind: nodeKindOf(id) });
  };
  for (const e of edges) {
    touch(e.from);
    touch(e.to);
    (down.get(e.from) ?? down.set(e.from, []).get(e.from)!).push(e);
    (up.get(e.to) ?? up.set(e.to, []).get(e.to)!).push(e);
  }
  const nodes = [...nodeMap.values()].sort((a, b) => compareText(a.label, b.label));
  return { nodes, edges, up, down };
}

/** On partial scan failure keep previous evidence; it is not proof of deletion. */
export function mergeScannedEdges(previous: GEdge[], fresh: GEdge[], source: GEdge["source"], complete: boolean): GEdge[] {
  return dedup([...(complete ? previous.filter(edge => edge.source !== source) : previous), ...fresh]);
}
