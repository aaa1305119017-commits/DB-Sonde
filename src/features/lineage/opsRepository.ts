import { hasOptionalText, isRecord, isText, storedRepository } from "../../lib/storedRepository";
import type { NodeHealth, NodeOps, OpsRecords } from "./opsTypes";

const optionalBoolean = (value: Record<string, unknown>, key: string) => value[key] === undefined || typeof value[key] === "boolean";
const nonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
function isNodeOps(value: unknown): value is NodeOps {
  return isRecord(value) && isText(value.origin) && ["manual", "scheduler", "etl"].includes(value.origin)
    && hasOptionalText(value, ["scope", "schedule", "scheduleHuman", "owner", "sla", "note"])
    && optionalBoolean(value, "online") && optionalBoolean(value, "scheduled")
    && (value.freshnessHours === undefined || (nonnegative(value.freshnessHours) && value.freshnessHours > 0));
}
function isNodeHealth(value: unknown): value is NodeHealth {
  return isRecord(value) && isText(value.state) && ["ok", "warn", "error", "running", "unknown"].includes(value.state)
    && nonnegative(value.checkedAt) && hasOptionalText(value, ["scope", "lastRun", "duration", "message"])
    && optionalBoolean(value, "rerun") && (value.retries === undefined || (nonnegative(value.retries) && Number.isInteger(value.retries)));
}
const recordOf = (value: unknown, accepts: (item: unknown) => boolean) =>
  isRecord(value) && Object.entries(value).every(([id, item]) => id.trim().length > 0 && accepts(item));
// Old records could omit one map. Read that format without weakening entry validation.
interface StoredOps { ops?: OpsRecords["ops"]; health?: OpsRecords["health"]; }
const storage = storedRepository<StoredOps>("sonde.lineageOps.v1", () => ({}),
  (value): value is StoredOps => isRecord(value) && value.version === undefined
    && (value.ops === undefined || recordOf(value.ops, isNodeOps))
    && (value.health === undefined || recordOf(value.health, isNodeHealth)));
export const opsRepository = {
  load(): OpsRecords { const value = storage.load(); return { ops: value.ops ?? {}, health: value.health ?? {} }; },
  save(value: OpsRecords): void { storage.save(value); },
};
