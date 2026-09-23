import type { Cell } from "../../../types";
/* 实现是 xlsx.runtime.js —— 那份写成普通脚本(挂到 window)是为了能原样内联进导出的
   离线网页。看板这边 import 它拿到副作用,再套一层类型。两处同一份实现。 */
import "./xlsx.runtime.js";

export interface SheetColumn {
  label: string;
  /** 给了小数位就按数字写进去(Excel 里能直接求和排序);不给就当文本。 */
  decimals?: number;
}

interface SheetApi {
  exportTable(name: string, columns: SheetColumn[], rows: Cell[][]): Promise<{ format: "xlsx" | "csv"; filename: string }>;
  buildXlsx(sheetName: string, columns: SheetColumn[], rows: Cell[][]): Promise<Blob>;
  fitsExcel(rowCount: number, colCount: number): boolean;
  MAX_ROWS: number;
  MAX_COLS: number;
}

const api = () => (globalThis as unknown as { __DASH_XLSX__: SheetApi }).__DASH_XLSX__;

/**
 * 导出一张表。装得下就是 .xlsx,装不下(超过 Excel 单表 104 万行 / 16384 列)自动退回
 * CSV —— 返回值里的 format 说明走了哪条路,调用方据此给使用者一句话。
 */
export const exportSheet = (name: string, columns: SheetColumn[], rows: Cell[][]) =>
  api().exportTable(name, columns, rows);

export const excelLimits = () => ({ rows: api().MAX_ROWS, cols: api().MAX_COLS });
