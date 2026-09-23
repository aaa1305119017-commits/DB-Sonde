import type { RunHealthState } from "./types";
const states: Record<string, RunHealthState> = {
  SUCCESS: "ok", FORCED_SUCCESS: "ok",
  FAILURE: "error", NEED_FAULT_TOLERANCE: "error",
  SUBMITTED_SUCCESS: "running", RUNNING_EXECUTION: "running", READY_PAUSE: "running", READY_STOP: "running",
  WAITING_THREAD: "running", WAITING_DEPEND: "running", DELAY_EXECUTION: "running", SERIAL_WAIT: "running", DISPATCH: "running",
  PAUSE: "warn", STOP: "warn", KILL: "warn",
};
export function dolphinRunState(raw: string): RunHealthState { return states[raw.trim().toUpperCase()] ?? "unknown"; }
