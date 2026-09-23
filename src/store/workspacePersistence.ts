import { assertStorageReadable, readStoredJson, writeStoredJson } from "../lib/jsonStorage";
import { isRecord, optionalString } from "../lib/storageValidation";
import type { SessionState } from "../lib/workspaceSession";
import { isWorkspaceSnapshot, restoreWorkspace, WORKSPACE_KEY, workspaceSnapshot } from "../lib/workspaceSession";
import type { SavedQuery } from "./appTypes";

export const SAVED_QUERIES_KEY = "sonde.savedQueries.v1";
export function isSavedQueries(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every(item => {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
        typeof item.name !== "string" || typeof item.sql !== "string" || !optionalString(item.connId) || !optionalString(item.database) ||
        !(item.updatedAt === undefined || typeof item.updatedAt === "number" && Number.isFinite(item.updatedAt))) return false;
    ids.add(item.id);
    return true;
  });
}
export function loadSavedQueries(): SavedQuery[] {
  // Older versions did not always include a modification timestamp.
  return readStoredJson<SavedQuery[]>(SAVED_QUERIES_KEY, [], isSavedQueries).map(item => ({ ...item, updatedAt: item.updatedAt ?? 0 }));
}
export function persistSavedQueries(list: SavedQuery[]): void {
  if (!isSavedQueries(list)) throw new Error("脚本格式无效，未保存。");
  writeStoredJson(SAVED_QUERIES_KEY, list);
}
export function loadWorkspace(savedQueries: SavedQuery[]) {
  const snapshot = readStoredJson(WORKSPACE_KEY, { version: 1, tabs: [] }, isWorkspaceSnapshot);
  return restoreWorkspace(JSON.stringify(snapshot), savedQueries);
}
export function persistWorkspace(state: SessionState): void {
  // An empty fallback from failed script loading must not erase workspace references.
  assertStorageReadable(SAVED_QUERIES_KEY);
  writeStoredJson(WORKSPACE_KEY, workspaceSnapshot(state));
}
export const initialSavedQueries = loadSavedQueries();
export const initialWorkspace = loadWorkspace(initialSavedQueries);
