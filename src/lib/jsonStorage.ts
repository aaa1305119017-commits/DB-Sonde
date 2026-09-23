/** Local JSON boundary: failed reads never authorize overwriting the original. */
export interface StorageProblem {
  key: string;
  kind: "read" | "write";
  message: string;
}
const blocked = new Set<string>();
const pending = new Map<string, StorageProblem>();
const listeners = new Set<(message: string) => void>();
const subscribers = new Set<() => void>();
let snapshot: readonly StorageProblem[] = [];

function publish() {
  snapshot = [...pending.values()];
  for (const subscriber of subscribers) subscriber();
}
function problem(key: string, kind: StorageProblem["kind"], message: string): void {
  if (pending.get(key)?.message === message) return;
  pending.set(key, { key, kind, message });
  publish();
  for (const listener of listeners) listener(message);
}
export const reportStorageProblem = problem;
function recovered(key: string, readOnly = false): void {
  blocked.delete(key);
  if ((!readOnly || pending.get(key)?.kind === "read") && pending.delete(key)) publish();
}
export const clearStorageProblem = (key: string): void => recovered(key);
export const getStorageProblems = () => snapshot;
export function subscribeStorageProblems(listener: () => void): () => void {
  subscribers.add(listener);
  return () => { subscribers.delete(listener); };
}
export function onStorageProblem(listener: (message: string) => void): () => void {
  listeners.add(listener);
  for (const issue of pending.values()) listener(issue.message);
  return () => { listeners.delete(listener); };
}
/** Also guards dependent records, e.g. a workspace referring to unreadable scripts. */
export function assertStorageReadable(key: string): void {
  if (blocked.has(key)) throw new Error(`本地配置 ${key} 尚未恢复，已阻止覆盖原始内容。`);
}
function readStored<T>(key: string, fallback: T, decode: (raw: string) => unknown, accepts: (value: unknown) => boolean): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) {
      recovered(key, true);
      return fallback;
    }
    const value = decode(raw);
    if (!accepts(value)) throw new Error("invalid shape");
    recovered(key, true);
    return value as T;
  } catch {
    blocked.add(key);
    problem(key, "read", `本地配置 ${key} 无法读取，已保留原始内容；请恢复有效配置后重试。`);
    return fallback;
  }
}
export function readStoredJson<T>(key: string, fallback: T, accepts: (value: unknown) => boolean): T {
  return readStored(key, fallback, JSON.parse, accepts);
}
/** Preserves the unquoted scalar format used by existing display preferences. */
export function readStoredText<T extends string>(key: string, fallback: T, accepts: (value: string) => boolean): T {
  return readStored(key, fallback, raw => raw, value => typeof value === "string" && accepts(value));
}
function writeFailure(key: string): Error {
  const message = `本地配置 ${key} 保存失败，本次修改尚未保存。`;
  problem(key, "write", message);
  return new Error(message);
}
export function writeStoredText(key: string, value: string): void {
  assertStorageReadable(key);
  try {
    localStorage.setItem(key, value);
    recovered(key);
  } catch { throw writeFailure(key); }
}
export function writeStoredJson(key: string, value: unknown): void {
  assertStorageReadable(key);
  let raw: string | undefined;
  try { raw = JSON.stringify(value); }
  catch { throw writeFailure(key); }
  if (raw === undefined) throw writeFailure(key);
  writeStoredText(key, raw);
}
