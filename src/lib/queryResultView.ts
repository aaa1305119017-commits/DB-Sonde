import type { Cell, QueryResult } from "../types";
import { compareText } from "./collate";

export type FilterOp = "=" | "<>" | ">" | ">=" | "<" | "<=" | "like";
export interface FilterCond { column: string; op: FilterOp; value: Cell; }
export interface GridSort { column: string; dir: "asc" | "desc"; }
export interface ResultView { sort: GridSort | null; filters: FilterCond[]; }
export const EMPTY_RESULT_VIEW: ResultView = { sort: null, filters: [] };
const isNull = (value: Cell) => value === null || value === undefined;

/** Compare numeric database strings without rounding BIGINT/DECIMAL through Number. */
function decimal(value: Cell) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const match = /^([+-]?)(\d*\.?\d+)(?:e([+-]?\d+))?$/i.exec(String(value).trim());
  if (!match) return null;
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent)) return null;
  const fraction = match[2].includes(".") ? match[2].length - match[2].indexOf(".") - 1 : 0;
  const digits = match[2].replace(".", "").replace(/^0+/, "") || "0";
  return { sign: digits === "0" ? 0 : match[1] === "-" ? -1 : 1, digits, order: digits.length + exponent - fraction };
}
export function compareCells(a: Cell, b: Cell): number {
  if (isNull(a) || isNull(b)) return isNull(a) ? isNull(b) ? 0 : 1 : -1;
  const left = decimal(a), right = decimal(b);
  if (left && right) {
    if (left.sign !== right.sign) return left.sign - right.sign;
    if (left.sign === 0) return 0;
    if (left.order !== right.order) return Math.sign(left.order - right.order) * left.sign;
    const width = Math.max(left.digits.length, right.digits.length);
    const l = left.digits.padEnd(width, "0"), r = right.digits.padEnd(width, "0");
    return (l === r ? 0 : l < r ? -1 : 1) * left.sign;
  }
  // 文本比较走 lib/collate 的那一份 —— 原来是系统默认语言、没有 numeric,
  // 跟看板表格/图表的顺序对不上(同一列网点名两个地方两种排法)。
  return compareText(String(a), String(b));
}
export function eqCells(a: Cell, b: Cell): boolean {
  if (isNull(a) || isNull(b)) return isNull(a) && isNull(b);
  if (typeof a === "boolean" || typeof b === "boolean") return a === b;
  if (typeof a === "number" || typeof b === "number") return !!decimal(a) && !!decimal(b) && compareCells(a, b) === 0;
  return typeof a === "object" || typeof b === "object" ? JSON.stringify(a) === JSON.stringify(b) : String(a) === String(b);
}
export function matchFilter(cell: Cell, op: FilterOp, value: Cell): boolean {
  if (op === "=") return eqCells(cell, value);
  if (op === "<>") return !eqCells(cell, value);
  if (isNull(cell) || isNull(value)) return false;
  if (op === "like") return String(cell).toLowerCase().includes(String(value).toLowerCase());
  const order = compareCells(cell, value);
  return op === ">" ? order > 0 : op === ">=" ? order >= 0 : op === "<" ? order < 0 : order <= 0;
}
/** Drop only references to missing columns; refreshing data retains valid view settings. */
export function reconcileResultView(view: ResultView, result: QueryResult): ResultView {
  const names = new Set(result.columns.map(column => column.name));
  const sort = view.sort && names.has(view.sort.column) ? view.sort : null;
  const filters = view.filters.filter(filter => names.has(filter.column));
  return sort === view.sort && filters.length === view.filters.length ? view : { sort, filters };
}
export function resultViewKey(sql: string, execution: number, resultSet = 0): string {
  return JSON.stringify([sql, execution, resultSet]);
}
/** Presentation only: immutable rows, no query execution or platform dependency. */
export function applySortFilter(result: QueryResult, sort: GridSort | null, filters: FilterCond[]): QueryResult {
  if (!sort && !filters.length) return result;
  const columnIndex = (name: string) => result.columns.findIndex(column => column.name === name);
  let rows = result.rows;
  for (const filter of filters) {
    const index = columnIndex(filter.column);
    if (index >= 0) rows = rows.filter(row => matchFilter(row[index], filter.op, filter.value));
  }
  if (sort) {
    const index = columnIndex(sort.column);
    if (index >= 0) rows = [...rows].sort((a, b) => {
      // NULL stays last for either direction, matching the grid's empty-value policy.
      const order = compareCells(a[index], b[index]);
      return isNull(a[index]) || isNull(b[index]) ? order : order * (sort.dir === "asc" ? 1 : -1);
    });
  }
  return { ...result, rows };
}
