export type CheckStatus = "running" | "queued" | "passed" | "difference" | "incomplete" | "needs_rule" | "error" | "no_data";
export interface ReportSummary { issueGroups?: number; checks: number; passed: number; differences: number; incomplete: number; issues: number; tables: number; stores: number }
export interface ReportBrief {
  id: string; status: CheckStatus; trigger: "manual" | "scheduled"; startedAt: string; finishedAt?: string;
  start: string; end: string; summary: ReportSummary; plannedChecks?: number; chain?: string; table?: string;
}
export interface ReportIssue {
  group?: Record<string, string | null>;
  checkId: string; chain: string; sourceTables: string[]; targetTable: string; status: CheckStatus; rule: string;
  date?: string; store_id?: string; outlet_name?: string; channel?: string; kind: string; metric: string;
  expected: string | null; actual: string | null; difference: string | null;
}
export interface ReportCheck {
  id: string; name: string; chain: string; date: string; sourceTables: string[]; targetTable: string;
  status: CheckStatus; message?: string; issueCount: number; expectedGroups?: number; actualGroups?: number; scope?: string; elapsedMs?: number;
  expectedTotals?: Record<string, string | null>; actualTotals?: Record<string, string | null>;
}
export interface DailyReport extends ReportBrief {
  schemaVersion: number; catalogRevision: string; checks: ReportCheck[];
  coverage: { status: CheckStatus; message: string; file?: string; chain?: string }[];
  issueRows: ReportIssue[]; filteredIssueCount: number; offset: number;
}
export interface ReportSource { url: string }
export interface ReportResponse {
  timezone?: string;
  error?: string; reports?: ReportBrief[]; chains?: string[]; tables?: string[]; schedule?: string;
  lookbackDays?: number; report?: DailyReport; id?: string; status?: CheckStatus;
}
