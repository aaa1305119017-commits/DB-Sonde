import type { EtlSource } from "../etl/types";
import { tableId, type Graph } from "./lineageModel";
import type { Finding, OpsRecords, OpsSnapshot } from "./opsTypes";

export function parseRunTime(value?: string | null): number {
  return value ? Date.parse(value.includes("T") ? value : value.replace(" ", "T")) : NaN;
}

/** Replace only evidence belonging to this observation scope. Manual annotations win. */
export function applyOpsSnapshot(previous: OpsRecords, snapshot: OpsSnapshot): OpsRecords {
  const ops = { ...previous.ops };
  const health = { ...previous.health };
  const incoming = new Set(Object.keys(snapshot.nodes));
  for (const [id, record] of Object.entries(ops)) {
    const owned = record.scope === snapshot.scope || (!record.scope && incoming.has(id));
    if (record.origin === "scheduler" && owned) delete ops[id];
  }
  // Health owns its scope independently: editing an owner must not freeze old run status.
  for (const [id, record] of Object.entries(health)) {
    if (record.scope === snapshot.scope || incoming.has(id)) delete health[id];
  }
  for (const [id, record] of Object.entries(snapshot.nodes)) {
    if (ops[id]?.origin !== "manual") ops[id] = { ...record.ops, scope: snapshot.scope };
    if (record.health) health[id] = { ...record.health, scope: snapshot.scope };
  }
  return { ops, health };
}

export function removeOpsNode(previous: OpsRecords, id: string): OpsRecords {
  const ops = { ...previous.ops }, health = { ...previous.health };
  delete ops[id];
  delete health[id];
  return { ops, health };
}

/** Generic ETL inference, never a scheduler-specific cron interpreter. */
export function inferEtlOps(previous: OpsRecords, sources: EtlSource[], graph: Graph): { records: OpsRecords; count: number; } {
  const tables = new Set(graph.nodes.filter(node => node.kind === "table").map(node => node.id));
  const schedules = new Map<string, Set<string>>();
  for (const source of sources) for (const job of source.jobs) {
    if (!job.schedule?.trim()) continue;
    for (const target of job.targets) {
      if (!target.table) continue;
      const id = tableId(target.database, target.table);
      if (!tables.has(id)) continue;
      if (!schedules.has(id)) schedules.set(id, new Set());
      schedules.get(id)!.add(job.schedule);
    }
  }
  const ops = { ...previous.ops };
  for (const id of tables) if (ops[id]?.origin === "etl") delete ops[id];
  let count = 0;
  for (const [id, values] of schedules) {
    if (ops[id]?.origin === "manual" || ops[id]?.origin === "scheduler") continue;
    ops[id] = values.size === 1
      ? { origin: "etl", schedule: [...values][0] }
      : { origin: "etl", note: "多个生产任务的调度不同，请查看上游任务" };
    count++;
  }
  return { records: { ops, health: previous.health }, count };
}

/** Deterministic review: explicit clock, graph labels and per-node age policy. */
export function inspectOps(graph: Graph, records: OpsRecords, now: number): Finding[] {
  const findings: Finding[] = [];
  const labels = new Map(graph.nodes.map(node => [node.id, node.label]));
  for (const node of graph.nodes) {
    if (node.kind !== "table") continue;
    const incoming = graph.up.get(node.id) ?? [];
    const outgoing = graph.down.get(node.id) ?? [];
    const health = records.health[node.id], ops = records.ops[node.id];
    if (health?.state === "error") findings.push({
      nodeId: node.id, level: "error", code: "run-failed",
      text: `「${node.label}」最近一次运行失败(${health.message ?? "FAILURE"})`
    });
    const failed = incoming.find(edge => records.health[edge.from]?.state === "error");
    if (failed) findings.push({
      nodeId: node.id, level: "warn", code: "upstream-failed",
      text: `上游「${labels.get(failed.from) ?? failed.from}」失败,可能波及「${node.label}」`
    });
    if (incoming.length && outgoing.length && !ops?.schedule) findings.push({
      nodeId: node.id, level: "warn", code: "no-schedule",
      text: `「${node.label}」有上下游却缺少调度信息(几点跑未知)`
    });
    const started = parseRunTime(health?.lastRun);
    const hours = ops?.freshnessHours;
    if (hours && hours > 0 && Number.isFinite(started) && now - started > hours * 3600000) findings.push({
      nodeId: node.id, level: "warn", code: "stale",
      text: `「${node.label}」上次运行在 ${health!.lastRun}，已超过设置的 ${hours} 小时阈值`,
    });
  }
  const severity = { error: 3, warn: 2, info: 1 };
  return findings.sort((a, b) => severity[b.level] - severity[a.level]);
}
