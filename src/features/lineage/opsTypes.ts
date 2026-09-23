export type HealthState = "ok" | "warn" | "error" | "running" | "unknown";
export type OpsOrigin = "scheduler" | "etl" | "manual";

/** When/how a node is produced. */
export interface NodeOps {
  origin: OpsOrigin;
  scope?: string; // Identity of the producing integration snapshot.
  freshnessHours?: number; // Optional maximum age of the last run record.
  schedule?: string; // cron
  scheduleHuman?: string; // 人话版
  online?: boolean;
  scheduled?: boolean;
  owner?: string;
  sla?: string;
  note?: string;
}

/** Last-run snapshot for a node. */
export interface NodeHealth {
  state: HealthState;
  scope?: string;
  lastRun?: string;
  duration?: string;
  retries?: number;
  rerun?: boolean; // 补数 / 重跑
  message?: string;
  checkedAt: number;
}

export interface Finding {
  nodeId: string;
  level: "error" | "warn" | "info";
  code: string;
  text: string;
}

/** Persisted manual annotations and last observed execution evidence. */
export interface OpsRecords {
  ops: Record<string, NodeOps>;
  health: Record<string, NodeHealth>;
}
/** Normalized observation boundary; no provider-specific raw states here. */
export interface OpsSnapshot {
  scope: string;
  nodes: Record<string, { ops: NodeOps; health?: NodeHealth; }>;
}
