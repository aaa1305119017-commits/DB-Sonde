import type { QueryResult } from "../types";
import { api } from "./api";
import { inTauri } from "./mockBackend";

export type ExportFormat = "csv" | "json";

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function serializeResult(result: QueryResult, format: ExportFormat): string {
  if (format === "json") {
    const rows = result.rows.map((row) =>
      Object.fromEntries(result.columns.map((column, index) => [column.name, row[index]])),
    );
    return JSON.stringify(rows, null, 2);
  }

  const header = result.columns.map((column) => csvCell(column.name)).join(",");
  const body = result.rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return `${header}\r\n${body}`;
}

export async function exportResultFile(
  result: QueryResult,
  format: ExportFormat,
  baseName = "query-result",
): Promise<string | undefined> {
  const content = serializeResult(result, format);
  if (inTauri) {
    const payload = format === "csv" ? `\uFEFF${content}` : content;
    return api.saveExport(baseName, format, payload);
  }
  const mime = format === "json" ? "application/json" : "text/csv";
  const blob = new Blob([format === "csv" ? `\uFEFF${content}` : content], {
    type: `${mime};charset=utf-8`,
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${baseName}.${format}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return undefined;
}
