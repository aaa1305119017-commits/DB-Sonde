import { readStoredJson, writeStoredJson } from "./jsonStorage";

/** Persistence port: domain callers neither access Web Storage nor swallow failures. */
export interface JsonStoragePort {
  read<T>(key: string, fallback: T, accepts: (value: unknown) => boolean): T;
  write(key: string, value: unknown): void;
}
export interface StoredRepository<T> {
  load(): T;
  save(value: T): void | Promise<void>;
}
const localJson: JsonStoragePort = { read: readStoredJson, write: writeStoredJson };
export function storedRepository<T>(
  key: string,
  empty: () => T,
  accepts: (value: unknown) => value is T,
  storage: JsonStoragePort = localJson,
): StoredRepository<T> {
  return {
    load: () => storage.read(key, empty(), accepts),
    save(value) {
      if (!accepts(value)) throw new Error(`本地配置 ${key} 格式无效，未保存。`);
      storage.write(key, value);
    },
  };
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const isText = (value: unknown): value is string => typeof value === "string";
export const isNonEmptyText = (value: unknown): value is string => isText(value) && value.trim().length > 0;
export function hasOptionalText(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every(key => value[key] === undefined || isText(value[key]));
}
export function isIdentifiedList<T extends { id: string; }>(
  value: unknown, accepts: (item: unknown) => item is T,
): value is T[] {
  return Array.isArray(value) && value.every(accepts) && new Set(value.map(item => item.id)).size === value.length;
}
