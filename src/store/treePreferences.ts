import { readStoredJson, writeStoredJson } from "../lib/jsonStorage";
import { isRecord, isStringArray } from "../lib/storageValidation";
import type { ConnectionConfig } from "../types";

export const CONN_ORDER_KEY = "sonde.connOrder.v1";
export const NODE_ORDER_KEY = "sonde.nodeOrder.v1";
export const HIDDEN_NODES_KEY = "sonde.hiddenNodes.v1";
export function loadConnOrder(): string[] {
  return readStoredJson(CONN_ORDER_KEY, [], isStringArray);
}
export function persistConnOrder(ids: string[]): void {
  writeStoredJson(CONN_ORDER_KEY, ids);
}
export function loadNodeOrder(): Record<string, string[]> {
  return readStoredJson(NODE_ORDER_KEY, {}, value => isRecord(value) && Object.values(value).every(isStringArray));
}
export function persistNodeOrder(map: Record<string, string[]>): void {
  writeStoredJson(NODE_ORDER_KEY, map);
}
export function loadHidden(): string[] {
  return readStoredJson(HIDDEN_NODES_KEY, [], isStringArray);
}
export function persistHidden(keys: string[]): void {
  writeStoredJson(HIDDEN_NODES_KEY, keys);
}
export function applyConnOrder(conns: ConnectionConfig[], order: string[]): ConnectionConfig[] {
    if (order.length === 0)
        return conns;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...conns].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
}
export function orderChildKeys(parentKey: string, keys: string[], map: Record<string, string[]>): string[] {
    const order = Object.prototype.hasOwnProperty.call(map, parentKey) ? map[parentKey] : undefined;
    if (!order || order.length === 0)
        return keys;
    const rank = new Map(order.map((k, i) => [k, i]));
    return [...keys].sort((a, b) => (rank.get(a) ?? 1e9) - (rank.get(b) ?? 1e9));
}
