import { hasOptionalText, isIdentifiedList, isNonEmptyText, isRecord, isText } from "../../lib/storedRepository";
import { secureRepository } from "../../lib/secureRepository";
import type { SchedulerConn } from "./types";

export function isSchedulerConnection(value: unknown): value is SchedulerConn {
  return isRecord(value) && isNonEmptyText(value.id) && isText(value.name) && isText(value.baseUrl)
    && isText(value.kind) && ["dolphinscheduler", "airflow", "kettle", "xxljob", "other"].includes(value.kind)
    && hasOptionalText(value, ["username", "password", "token"]);
}
// Retain the installed format and key; runtime sessions never belong in this record.
export const schedulerConnections = secureRepository<SchedulerConn[]>(
  "scheduler.conns.v1", () => [], value => isIdentifiedList(value, isSchedulerConnection),
);
