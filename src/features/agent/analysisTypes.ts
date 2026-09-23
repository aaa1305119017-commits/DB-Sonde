import type { AnalysisModelChoice } from "./model/analysisModels";

export interface AnalysisDraft {
  mode: "question" | "manual";
  question: string;
  modelChoice?: AnalysisModelChoice;
  metricIds: string[];
  grain: string;
  dimensions: string[];
  start: string;
  end: string;
  mom: boolean;
  yoy: boolean;
  focus: string;
  wantsDashboard: boolean;
  /** 当前展开的筛选维度。 */
  filterField: string;
  filterContext?: string;
  /** 维度 → 已选取值。 */
  filterValues: Record<string, string[]>;
}

export interface LockedParams {
  metricIds: string[];
  /** 分组维度,**含时间粒度**(day/week/month/year 里的一个)。 */
  dimensions: string[];
  dateRange: { start: string; end: string; };
  comparisons: ("mom" | "yoy")[];
  /** 取值是用户从真实清单里选的,不需要再去库里核。 */
  filters: { field: string; values: string[]; }[];
  /** 「你想看什么、重点是什么」。 */
  focus: string;
  wantsDashboard: boolean;
}

