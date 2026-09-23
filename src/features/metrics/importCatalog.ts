import { open } from "@tauri-apps/plugin-dialog";
import { api } from "../../lib/api";
import { useMetrics, type Metric } from "./metricsStore";
import { compileQueryPlan, defaultMetricScope } from "./queryPlan";

export function validateCatalog(value: unknown): Metric[] {
  const root = value as { version?: number; id?: string; name?: string; metrics?: unknown[] };
  if (root?.version !== 1 || !Array.isArray(root.metrics)) throw new Error("需要 version=1、metrics 数组的指标目录");
  if (root.id !== undefined && (typeof root.id !== "string" || !root.id.trim())) throw new Error("目录 id 必须是非空文本");
  if (root.name !== undefined && typeof root.name !== "string") throw new Error("目录名称必须是文本");
  const ids = new Set<string>();
  return root.metrics.map((item) => {
    const m = item as Metric;
    if (!m || !m.id || !m.name || !m.key || ids.has(m.id)) throw new Error("指标名称或标识缺失，或标识重复");
    if (!["measure", "ratio", "derived", "sql", "template"].includes(m.type))
      throw new Error(`不支持的指标类型：${m.type}`);
    if (m.type === "template") {
      if (!m.queryPlan) throw new Error(`指标 ${m.name} 缺少计算定义`);
      compileQueryPlan(m.queryPlan, defaultMetricScope(), m.key);
    }
    ids.add(m.id);
    return { ...m, catalogId: root.id || m.catalogId, catalogName: root.name || m.catalogName };
  });
}
export interface ImportOutcome {
  added: number;
  replaced: number;
  skipped: number;
}

/** 导入指标目录。mode=replace 时同 id 的用新定义顶掉 —— 底表换了要重挂口径时用。 */
export async function importCatalogFile(mode: "keep" | "replace" = "keep"): Promise<ImportOutcome> {
  const path = await open({ multiple: false, filters: [{ name: "指标目录", extensions: ["json"] }] });
  if (!path) return { added: 0, replaced: 0, skipped: 0 };
  const metrics = validateCatalog(JSON.parse(await api.pyReadFile(path)));
  const existing = new Set(useMetrics.getState().metrics.map((m) => m.id));
  const dupes = metrics.filter((m) => existing.has(m.id)).length;
  useMetrics.getState().importMetrics(metrics, mode);
  return {
    added: metrics.length - dupes,
    replaced: mode === "replace" ? dupes : 0,
    skipped: mode === "replace" ? 0 : dupes,
  };
}
export async function loadConfiguredCatalog(): Promise<void> {
  const catalog = await api.loadSemanticCatalog();
  if (!catalog) return;
  const key = "sonde.semantic-imports.v1";
  const imported: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
  // A stable id belongs to the input document, never to a bundled company catalog.
  const value = catalog as { id?: string };
  if (!value.id || imported.includes(value.id)) return;
  useMetrics.getState().importMetrics(validateCatalog(catalog));
  localStorage.setItem(key, JSON.stringify([...imported, value.id]));
}
