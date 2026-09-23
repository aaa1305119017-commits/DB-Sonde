import { create } from "zustand";
import { etlSourcesForSync } from "../etl/etlStore";
import { getProvider } from "../scheduler/providers";
import { useScheduler } from "../scheduler/schedulerStore";
import type { Graph } from "./lineageModel";
import { applyOpsSnapshot, inferEtlOps, inspectOps, removeOpsNode } from "./opsModel";
import { opsRepository } from "./opsRepository";
import type { Finding, NodeOps, OpsRecords } from "./opsTypes";
import { schedulerOpsSnapshot } from "./schedulerOpsAdapter";
export type { Finding, HealthState, NodeHealth, NodeOps, OpsOrigin } from "./opsTypes";

interface OpsState extends OpsRecords {
  findings: Finding[];
  lastSync: number | null;
  syncMsg: string | null;
  setManual: (nodeId: string, patch: Partial<Omit<NodeOps, "origin" | "scope">>) => boolean;
  clearNode: (nodeId: string) => boolean;
  syncFromScheduler: (graph: Graph) => number;
  syncFromEtl: (graph: Graph) => number;
  inspect: (graph: Graph) => Finding[];
}

/** Integration shell: capture current inputs, invoke pure rules, then persist before publishing. */
export const useOps = create<OpsState>((set, get) => {
  const commit = (records: OpsRecords, status: Partial<Pick<OpsState, "lastSync" | "syncMsg">> = {}): boolean => {
    try { opsRepository.save(records); }
    catch (error) { set({ syncMsg: String(error) }); return false; }
    set({ ...records, syncMsg: null, ...status });
    return true;
  };
  return {
    ...opsRepository.load(), findings: [], lastSync: null, syncMsg: null,
    setManual(nodeId, patch) {
      const ops = { ...get().ops, [nodeId]: { ...get().ops[nodeId], ...patch, origin: "manual" as const } };
      return commit({ ops, health: get().health });
    },
    clearNode(nodeId) { return commit(removeOpsNode(get(), nodeId)); },
    syncFromScheduler(graph) {
      const scheduler = useScheduler.getState();
      const connection = scheduler.conns.find(connection => connection.id === scheduler.activeId);
      if (!connection || !scheduler.projectCode || scheduler.status[connection.id] !== "connected" || scheduler.dataLoading || scheduler.dataError) {
        set({ syncMsg: "调度项目尚未就绪，保留已有运行状态。" });
        return 0;
      }
      let sources;
      try { sources = etlSourcesForSync(); }
      catch (error) { set({ syncMsg: String(error) }); return 0; }
      const now = Date.now();
      const snapshot = schedulerOpsSnapshot({
        connection, projectCode: scheduler.projectCode,
        workflows: scheduler.workflows, instances: scheduler.instances, tasks: scheduler.recentTasks
      },
        sources, graph, now, getProvider(connection.kind).classifyRunState);
      const count = Object.keys(snapshot.nodes).length;
      return commit(applyOpsSnapshot(get(), snapshot), {
        lastSync: now, syncMsg: `调度同步:关联 ${count} 个节点 ← 项目 ${scheduler.projectCode}`,
      }) ? count : 0;
    },
    syncFromEtl(graph) {
      let sources;
      try { sources = etlSourcesForSync(); }
      catch (error) { set({ syncMsg: String(error) }); return 0; }
      const result = inferEtlOps(get(), sources, graph);
      return commit(result.records, { lastSync: Date.now(), syncMsg: `ETL 推断:回填 ${result.count} 个表的调度信息` }) ? result.count : 0;
    },
    inspect(graph) {
      const findings = inspectOps(graph, get(), Date.now());
      set({ findings });
      return findings;
    },
  };
});
