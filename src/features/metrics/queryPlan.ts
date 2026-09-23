import type { DbKind } from "../../types";
import { sqlLiteral } from "../../lib/sql";
import { localDay } from "../../lib/dates";
/** Declarative query definitions are user data imported from any catalog.
 * This module contains no company-specific tables, dimensions or predicates. */
export interface QueryScope {
  start: string;
  end: string;
  /** 数据库方言 —— 取值转义要按它来(反斜杠在 MySQL 是转义符,PG 不是)。不传按不转义处理。 */
  dialect?: DbKind;
  dimensions?: string[];
  filters?: { field: string; kind: "select" | "text" | "in"; value: string }[];
}
export type QueryPlan =
  | {
      kind: "sql";
      template: string;
      dimensions: Record<string, { label: string; expression: string; groupFilter?: string }>;
      sourceTables: string[];
    }
  | {
      kind: "ratio";
      numerator: QueryPlan;
      denominator: QueryPlan;
      scale: number;
    }
  | {
      kind: "union";
      dimension: string;
      branches: { value: string; plan: QueryPlan }[];
      fallback: QueryPlan;
    };
export function defaultMetricScope(): QueryScope {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const start = new Date(end.getFullYear(), end.getMonth(), 1);
  return { start: localDay(start), end: localDay(end) };
}
/* 取值转义走 lib/sql.ts 的 sqlLiteral。这儿原来**不分方言**一律把反斜杠加倍 ——
   MySQL 对,PG 错(standard_conforming_strings 默认 on,加倍会变成两个真反斜杠,
   筛选就匹配不到数据)。方言由调用方经 scope 传进来;不传时行为跟以前一致。 */
const literalIn = (dialect: DbKind | undefined) => (value: string) => sqlLiteral(value, dialect);
const identifier = (s: string) => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) throw new Error(`无效字段标识：${s}`);
  return s;
};
export function planDimensions(
  plan: QueryPlan,
): Record<string, { label: string; expression: string; groupFilter?: string }> {
  if (plan.kind === "sql") return plan.dimensions;
  if (plan.kind === "union")
    return { ...planDimensions(plan.fallback), [plan.dimension]: { label: plan.dimension, expression: "" } };
  const n = planDimensions(plan.numerator),
    d = planDimensions(plan.denominator);
  return Object.fromEntries(Object.entries(n).filter(([key]) => key in d));
}
/** 这个计划本身就是个比率吗 —— 比率按定义不可加,和分子长什么样无关。 */
export function planIsRatio(plan: QueryPlan): boolean {
  if (plan.kind === "ratio") return true;
  if (plan.kind === "union") return planIsRatio(plan.fallback);
  return false;
}

/** 计划里所有的 SQL 模板(union 会有多个分支)。 */
export function planTemplates(plan: QueryPlan): string[] {
  if (plan.kind === "sql") return [plan.template];
  if (plan.kind === "ratio") return [...planTemplates(plan.numerator), ...planTemplates(plan.denominator)];
  return [...planTemplates(plan.fallback), ...plan.branches.flatMap((b) => planTemplates(b.plan))];
}

export function planSourceTables(plan: QueryPlan): string[] {
  if (plan.kind === "sql") return plan.sourceTables;
  if (plan.kind === "ratio")
    return [...new Set([...planSourceTables(plan.numerator), ...planSourceTables(plan.denominator)])];
  return [...new Set([plan.fallback, ...plan.branches.map((b) => b.plan)].flatMap(planSourceTables))];
}
function render(plan: QueryPlan, scope: QueryScope): string {
  const literal = literalIn(scope.dialect);
  const dims = (scope.dimensions ?? []).map(identifier);
  if (plan.kind === "union") {
    const channelFilters = (scope.filters ?? []).filter((f) => f.field === plan.dimension && f.value);
    if (!dims.includes(plan.dimension) && !channelFilters.length) return render(plan.fallback, scope);
    if (!dims.includes(plan.dimension)) throw new Error("按此维度筛选时，请同时选择该维度分组");
    const branches = plan.branches.filter((b) =>
      channelFilters.every((f) =>
        f.kind === "in"
          ? f.value.split("\u0001").filter(Boolean).includes(b.value)
          : f.kind === "text"
            ? b.value.includes(f.value)
            : b.value === f.value,
      ),
    );
    if (!branches.length) throw new Error("所选维度没有匹配项");
    return branches
      .map(
        (b) =>
          `SELECT ${[...dims.map((d) => (d === plan.dimension ? `${literal(b.value)} AS ${d}` : d)), "value"].join(", ")} FROM (${render(b.plan, { ...scope, dimensions: dims.filter((d) => d !== plan.dimension), filters: scope.filters?.filter((f) => f.field !== plan.dimension) })}) branch_result`,
      )
      .join(" UNION ALL ");
  }
  if (plan.kind === "ratio") {
    const n = render(plan.numerator, scope),
      d = render(plan.denominator, scope);
    if (!dims.length)
      return `SELECT COALESCE(n.value/NULLIF(d.value,0)*${plan.scale},0) AS value FROM (${n}) n CROSS JOIN (${d}) d`;
    const keys = dims.join(", ");
    const on = (a: string) =>
      dims.map((d) => `(k.${d} = ${a}.${d} OR (k.${d} IS NULL AND ${a}.${d} IS NULL))`).join(" AND ");
    return `SELECT ${dims.map((d) => `k.${d}`).join(", ")},COALESCE(n.value/NULLIF(d.value,0)*${plan.scale},0) AS value FROM (SELECT ${keys} FROM (${n}) n UNION SELECT ${keys} FROM (${d}) d) k LEFT JOIN (${n}) n ON ${on("n")} LEFT JOIN (${d}) d ON ${on("d")}`;
  }
  const expr = (d: string) => {
    const definition = plan.dimensions[d];
    if (!definition) throw new Error(`指标不支持维度 ${d}`);
    return definition.expression;
  };
  const filters = (scope.filters ?? [])
    .filter((f) => f.value)
    .map((f) =>
      f.kind === "in"
        ? `${expr(f.field)} IN (${f.value.split(/\u0001/).filter(Boolean).map(literal).join(", ") || "NULL"})`
        : f.kind === "text"
          ? ` ${expr(f.field)} LIKE ${literal("%" + f.value.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_") + "%")} ESCAPE '!'`
          : `${expr(f.field)}=${literal(f.value)}`,
    );
  filters.push(...dims.flatMap((d) => (plan.dimensions[d]?.groupFilter ? [plan.dimensions[d].groupFilter!] : [])));
  const groups = dims.map(expr).join(", ");
  const vars: Record<string, string> = {
    start: literal(scope.start),
    end: literal(scope.end),
    select: dims.length ? dims.map((d) => `${expr(d)} AS ${d}`).join(", ") + ", " : "",
    groupBy: dims.length ? ` GROUP BY ${groups}` : "",
    groupSuffix: dims.length ? `, ${groups}` : "",
    names: dims.length ? dims.join(", ") + ", " : "",
    groupNames: dims.length ? ` GROUP BY ${dims.join(", ")}` : "",
    filters: filters.length ? " AND " + filters.join(" AND ") : "",
  };
  return plan.template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`未知查询参数 ${key}`);
    return vars[key];
  });
}
export function compileQueryPlan(plan: QueryPlan, scope: QueryScope, output: string): string {
  identifier(output);
  for (const date of [scope.start, scope.end])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new Error("请选择有效日期范围");
  if (scope.start > scope.end) throw new Error("开始日期不能晚于结束日期");
  return `SELECT ${[...(scope.dimensions ?? []).map(identifier), `COALESCE(value,0) AS ${output}`].join(", ")} FROM (${render(plan, scope)}) metric_result`;
}

/* 粒度 key → 人看的名字。这些 key 是查询计划自己造出来的,任何库都一样,所以能写死。
   业务词汇(大区/主管/网点…)不行:换个行业就全是错的。那些名字由部署时配的指标中心
   给,没配就原样显示 key —— 至少不会张冠李戴。 */
export const GRAIN_LABELS: Record<string, string> = {
  day: "日期", week: "周", month: "月份", year: "年份",
};
