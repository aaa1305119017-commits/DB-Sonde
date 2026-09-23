import type { Endpoint, EtlJob } from "../etl/types";
/** Edge source — where a lineage edge was derived from (drives its label/color). */
export type EdgeSource = "etl" | "metric" | "view" | "sql";
export interface GEdge {
    from: string;
    to: string;
    kind: string; // 写入 / 用于 / 派生 …
    source: EdgeSource;
}
export type NodeKind = "table" | "file" | "metric" | "dataset" | "task" | "workflow";
export interface GNode {
    id: string;
    label: string;
    kind: NodeKind;
}
export const norm = (s?: string) => (s ?? "").trim().toLowerCase();
/** Stable node id: db.table (lowercased), file:<path>, or metric:<name>. */
export function tableId(database?: string, table?: string): string {
    const t = norm(table).replace(/[`"\[\]]/g, "");
    const d = norm(database);
    return t.includes(".") ? t : d && t ? `${d}.${t}` : t;
}
export function endpointId(e: Endpoint): string {
    if (e.kind === "file")
        return `file:${e.path ?? e.detail ?? "?"}`;
    return tableId(e.database, e.table || e.detail);
}
export function nodeKindOf(id: string): NodeKind {
    if (id.startsWith("task:"))
        return "task";
    if (id.startsWith("workflow:"))
        return "workflow";
    if (id.startsWith("metric:"))
        return "metric";
    if (id.startsWith("file:"))
        return "file";
    if (id.startsWith("bi:"))
        return "dataset";
    return "table";
}
export function labelForNode(id: string, metrics: {
    id: string;
    name: string;
}[], jobs: EtlJob[]): string {
    if (id.startsWith("metric:"))
        return metrics.find(m => m.id === id.slice(7))?.name ?? id.slice(7);
    for (const job of jobs) {
        if (id === taskNodeId(job))
            return job.name;
        if (job.scheduler && id === workflowNodeId(job))
            return job.scheduler.workflowName;
    }
    if (id.startsWith("file:"))
        return id.slice(5);
    if (id.startsWith("bi:"))
        return id.slice(3);
    return id;
}
export const taskNodeId = (job: EtlJob) => `task:${job.scheduler?.baseUrl ?? "local"}:${job.id}`;
export const workflowNodeId = (job: EtlJob) => `workflow:${job.scheduler?.baseUrl}:${job.scheduler?.projectCode}:${job.scheduler?.workflowCode}`;
export interface Graph {
    nodes: GNode[];
    edges: GEdge[];
    up: Map<string, GEdge[]>; // id -> incoming edges (its upstream)
    down: Map<string, GEdge[]>; // id -> outgoing edges (its downstream)
}
