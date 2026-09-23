import { isNonEmptyText, isRecord, isText, storedRepository } from "../../lib/storedRepository";
import type { GEdge } from "./lineageModel";

export function isLineageEdge(value: unknown): value is GEdge {
  return isRecord(value) && isNonEmptyText(value.from) && isNonEmptyText(value.to)
    && isText(value.kind) && isText(value.source) && ["etl", "metric", "view", "sql"].includes(value.source);
}
export const lineageEdges = storedRepository<GEdge[]>(
  "sonde.lineage.v1", () => [],
  (value): value is GEdge[] => Array.isArray(value) && value.every(isLineageEdge),
);
