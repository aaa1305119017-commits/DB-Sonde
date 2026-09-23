import type { AnalysisDraft } from "./analysisTypes";
import type { Metric } from "../metrics/metricTypes";
import { availableDimensions } from "../dashboard/semantic";
import { isCalendarDay, localDayOffset } from "../../lib/dates";

export const filterContext = (ids: string[], all: Metric[]): string => JSON.stringify(ids.slice().sort().map((id) => all.find((m) => m.id === id)));

export function analysisProblems(d: AnalysisDraft, all: Metric[]): string[] {
  const problems: string[] = [];
  const selected = d.metricIds.map((id) => all.find((m) => m.id === id));
  if (!selected.length) problems.push("至少选一个指标");
  if (selected.some((m) => !m || !m.enabled)) problems.push("有指标已删除或停用，请移除后重新选择");
  const metrics = selected.filter((m): m is Metric => !!m && m.enabled);
  if (metrics.some((m) => !m.connId)) problems.push("所选指标尚未绑定数据库连接");
  if (metrics.some((m) => m.connId !== metrics[0].connId || m.database !== metrics[0].database)) {
    problems.push("所选指标来自不同连接或数据库，请分开分析");
  }
  if (!isCalendarDay(d.start) || !isCalendarDay(d.end)) problems.push("请选择有效的开始和结束日期");
  else if (d.start > d.end) problems.push("开始日期晚于结束日期");
  const shared = availableDimensions(metrics);
  if (metrics.length && !shared.includes(d.grain)) problems.push("所选指标不共同支持当前时间粒度，请重新选择");
  if (d.dimensions.some((v) => !shared.includes(v))) problems.push("有分组维度不再受支持，请移除后重新选择");
  if (Object.entries(d.filterValues).some(([f, v]) => v.length && !shared.includes(f))) {
    problems.push("有筛选条件不再受支持，请清除后重新选择");
  }
  if (d.filterContext && Object.values(d.filterValues).some((v) => v.length) && d.filterContext !== filterContext(d.metricIds, all)) problems.push("指标或来源已变化，请确认沿用筛选或重新选择");
  return problems;
}

/** A stored draft is user-editable JSON; never trust its field types. */
export function normalizeAnalysisDraft(raw: unknown, defaults: AnalysisDraft): AnalysisDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return defaults;
  const value = raw as Record<string, unknown>;
  const strings = (v: unknown): string[] => Array.isArray(v) ? [...new Set(v.filter((s): s is string => typeof s === "string"))] : [];
  const draft = { ...defaults };
  draft.mode = value.mode === "manual" ? "manual" : "question";
  draft.question = typeof value.question === "string" ? value.question : "";
  for (const k of ["start", "end", "focus", "filterField", "filterContext"] as const) {
    if (typeof value[k] === "string") draft[k] = value[k];
  }
  for (const k of ["mom", "yoy", "wantsDashboard"] as const) {
    if (typeof value[k] === "boolean") draft[k] = value[k];
  }
  if (typeof value.grain === "string" && ["day", "week", "month", "year"].includes(value.grain)) draft.grain = value.grain;
  draft.metricIds = strings(value.metricIds);
  draft.dimensions = strings(value.dimensions);
  draft.filterValues = value.filterValues && typeof value.filterValues === "object" && !Array.isArray(value.filterValues)
    ? Object.fromEntries(Object.entries(value.filterValues).map(([key, v]) => [key, strings(v)])) : {};
  const choice = value.modelChoice as Record<string, unknown> | undefined;
  draft.modelChoice = choice && ["cloud", "local", "builtin"].includes(String(choice.provider)) && typeof choice.model === "string"
    ? { provider: choice.provider as "cloud" | "local" | "builtin", model: choice.model } : undefined;
  return draft;
}


/** Calendar defaults are provided by the host, keeping restoration reproducible. */
export function blankAnalysisDraft(now: Date): AnalysisDraft {
  return { mode: "question", question: "", metricIds: [], grain: "month", dimensions: [],
    start: localDayOffset(90, now), end: localDayOffset(1, now), mom: false, yoy: false, focus: "", wantsDashboard: true,
    filterField: "", filterValues: {} };
}

export type SavedAnalysisDraft = Partial<AnalysisDraft> & { modelChoiceMigration?: 1 };
/** Missing legacy fields may receive defaults; malformed or future fields must not be discarded. */
export function isSavedAnalysisDraft(value: unknown): value is SavedAnalysisDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = ["mode", "question", "modelChoice", "metricIds", "grain", "dimensions", "start", "end", "mom", "yoy", "focus", "wantsDashboard", "filterField", "filterContext", "filterValues", "modelChoiceMigration"];
  if (!Object.keys(record).every(key => keys.includes(key))) return false;
  if (record.modelChoiceMigration !== undefined && record.modelChoiceMigration !== 1) return false;
  if (record.mode !== undefined && record.mode !== "question" && record.mode !== "manual") return false;
  if (record.grain !== undefined && !["day", "week", "month", "year"].includes(String(record.grain))) return false;
  for (const key of ["question", "start", "end", "focus", "filterField", "filterContext"]) {
    if (record[key] !== undefined && typeof record[key] !== "string") return false;
  }
  for (const key of ["mom", "yoy", "wantsDashboard"]) {
    if (record[key] !== undefined && typeof record[key] !== "boolean") return false;
  }
  const strings = (v: unknown) => Array.isArray(v) && v.every(item => typeof item === "string");
  for (const key of ["metricIds", "dimensions"]) if (record[key] !== undefined && !strings(record[key])) return false;
  const filters = record.filterValues;
  if (filters !== undefined && (!filters || typeof filters !== "object" || Array.isArray(filters) || !Object.values(filters).every(strings))) return false;
  const choice = record.modelChoice;
  if (choice !== undefined) {
    if (!choice || typeof choice !== "object" || Array.isArray(choice)) return false;
    const item = choice as Record<string, unknown>;
    if (!Object.keys(item).every(key => key === "provider" || key === "model") || !["cloud", "local", "builtin"].includes(String(item.provider)) || typeof item.model !== "string") return false;
  }
  return true;
}
