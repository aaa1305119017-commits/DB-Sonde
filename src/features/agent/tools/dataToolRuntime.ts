import { prepareQueryPlan, type BuildPlanInput } from "../queryPlanModel";
import type { Metric } from "../../metrics/metricTypes";
import type { DashboardDataset } from "../../dashboard/domain";
import type { DatasetSqlErrorKey, DatasetQueryFilter } from "../../dashboard/datasetSql";
import type { QueryResult } from "../../../types";
import { checkDataset, checkTotals, verdict, type DatasetShape, type ValidationIssue } from "../validation/dataChecks";
import { matchDimensionValue } from "../../../lib/dimensionMatching";
import { fail } from "./toolTypes";
import type { ToolDef } from "./toolRegistry";
import { S } from "../jsonSchema";
import { utcDay } from "../../../lib/dates";
import { compareText } from "../../../lib/collate";

const SOH = String.fromCharCode(1); // 多值 in 筛选的分隔符,和看板运行时一致

export interface StoredPlan {
  catalog: Metric[];
  revision: number;
  id: string;
  result?: QueryResult;
  totalResult?: QueryResult;
  dataset: DashboardDataset;
  shape: DatasetShape;
  /** 只用于审计,不进模型上下文。 */
  metricIds: string[];
  filters: { field: string; kind: "in"; value: string; }[];
}

export interface DataToolPorts {
  readCatalog(): Metric[];
  nextId(): string;
  today(): string;
  executeDataset(dataset: DashboardDataset, translate: (key: DatasetSqlErrorKey) => string, rows: number,
    filters: DatasetQueryFilter[], timeout: number, catalog: Metric[]): Promise<QueryResult>;
  fastDimensionValues(dataset: DashboardDataset, field: string, limit: number, search: string, catalog: Metric[]): Promise<string[] | null>;
}

export function createDataToolRuntime({ readCatalog, nextId, today, executeDataset, fastDimensionValues }: DataToolPorts) {
  let disposed = false;
  const assertOpen = () => { if (disposed) fail("INVALID_ARGS", "分析查询会话已结束"); };
  const tools: ToolDef[] = [];
  const registerTool = (definition: ToolDef) => {
    const tool = {
      ...definition, run: async (input: unknown) => {
        assertOpen(); const result = await definition.run(input); assertOpen(); return result;
      }
    };
    tools.push(tool); return tool;
  };
  const dimensionValues = async (dataset: DashboardDataset, field: string, catalog: Metric[]) => {
    assertOpen();
    const result = await executeDataset({ ...dataset, groupBy: [field] }, key => key, 300, [], 180, catalog);
    assertOpen();
    const index = result.columns.findIndex(column => column.name === field);
    return index < 0 ? [] : [...new Set(result.rows.map(row => String(row[index] ?? "")).filter(Boolean))]
      .sort(compareText);
  };
  const plans = new Map<string, StoredPlan>();

  /** 只在测试里用。 */
  function resetPlans(): void {
    plans.clear();
  }

  function getPlan(id: string): StoredPlan | undefined {
    return plans.get(id);
  }

  function buildQueryPlan(input: BuildPlanInput): { planId: string; dimensions: string[]; metrics: DatasetShape["metrics"]; rows: null; } {
    assertOpen();
    const catalog = structuredClone(readCatalog());
    const prepared = prepareQueryPlan(structuredClone(input), catalog);
    const planId = nextId();
    plans.set(planId, { id: planId, ...prepared, catalog, revision: 0 });
    return { planId, dimensions: prepared.shape.dimensions, metrics: prepared.shape.metrics, rows: null };
  }

  const translateError = (key: string) => `查询被拒绝:${key}`;

  /* AI 分析是后台活,不是用户盯着等的交互 —— 后端默认那 30 秒是按看板组件刷新定的,
     拿来掐一个 8 指标 × 半年的分析查询只会白跑一趟。这边给 180 秒,
     而且面板上有秒表和「正在 execute_query_plan」,等多久是看得见的。 */
  const AGENT_QUERY_TIMEOUT_SECS = 180;

  async function run(plan: StoredPlan, maxRows: number): Promise<QueryResult> {
    assertOpen();
    const result = await executeDataset(plan.dataset, translateError, maxRows, plan.filters, AGENT_QUERY_TIMEOUT_SECS, plan.catalog);
    assertOpen();
    return result;
  }

  // ── 注册 ────────────────────────────────────────────────────────

  const dateField = S.date();

  const buildQueryPlanTool: ToolDef = registerTool({
    name: "build_query_plan",
    description: "把指标 + 维度 + 日期范围组装成查询计划,返回 planId。不会真的取数。metricId 必须来自 validate_metrics。",
    readOnly: true,
    schema: S.obj(
      {
        /* 上限要按「真实数据能有多少」给,不能用防模型解码循环的那个默认 20:
           这些入参多数是表单里选出来的,由代码填进来 —— 按网点筛选一次点二三十家
           太正常了,撞上限就是整次分析报「入参不对」。 */
        metricIds: S.arr(S.str("来自 validate_metrics 的 metricId"), "要查的指标", 100),
        dimensions: S.arr(S.str(), "按哪些维度分组,留空则只出总计"),
        dateRange: S.obj({ start: dateField, end: dateField }, ["start", "end"], "查询日期范围"),
        filters: S.arr(S.obj({ field: S.str("维度名"), values: S.arr(S.str(), "取值", 1000) }, ["field", "values"]), "维度筛选", 50),
        grain: S.enumOf(["day", "week", "month", "year"], "没有时间维度时的兜底粒度。有时间维度时以它为准"),
      },
      ["metricIds", "dateRange"],
    ),
    run: (input: BuildPlanInput) => buildQueryPlan(input),
  });

  const executeQueryPlanTool: ToolDef = registerTool({
    name: "execute_query_plan",
    description: "执行查询计划取数,返回行数和前几行样例。只读,走看板同一套只读护栏。",
    readOnly: true,
    schema: S.obj({ planId: S.str("build_query_plan 返回的 id"), maxRows: S.int("最多取多少行", 1, 50000), preview: S.int("返回几行样例", 0, 50) }, ["planId"]),
    run: async (input: { planId: string; maxRows?: number; preview?: number; }) => {
      const plan = plans.get(input.planId);
      if (!plan) fail("NOT_FOUND", `没有 planId=${input.planId} 的计划。先调 build_query_plan。`);
      const revision = ++plan!.revision;
      plan!.result = undefined;
      plan!.totalResult = undefined;
      const result = await run(plan!, input.maxRows ?? 5000);
      if (revision !== plan!.revision) fail("INVALID_ARGS", "查询计划已重新执行，忽略旧结果");
      plan!.result = result;
      const take = input.preview ?? 5;
      return {
        planId: input.planId,
        rowCount: result.rows.length,
        truncated: result.truncated === true,
        columns: result.columns.map((c) => c.name),
        // 只回样例行:全量塞进模型上下文既装不下也没意义
        sampleRows: result.rows.slice(0, take),
      };
    },
  });

  const validateDatasetTool: ToolDef = registerTool({
    name: "validate_dataset",
    description: "对已取数的计划做数据质量体检:空/维度重复/日期缺口/空值/负值/极端值,可选的总分对齐。fail 一条都不许继续画图。",
    readOnly: true,
    schema: S.obj(
      { planId: S.str(), checkTotals: S.bool("是否额外查一次总计做总分对齐(多一次查询,但最能抓出 JOIN 放大这类隐蔽错误)") },
      ["planId"],
    ),
    run: async (input: { planId: string; checkTotals?: boolean; }) => {
      const plan = plans.get(input.planId) as (StoredPlan & { result?: QueryResult; }) | undefined;
      if (!plan) fail("NOT_FOUND", `没有 planId=${input.planId} 的计划。`);
      const result = plan!.result;
      if (!result) fail("INVALID_ARGS", `计划 ${input.planId} 还没取数,先调 execute_query_plan。`);

      plan!.totalResult = undefined;
      const issues: ValidationIssue[] = checkDataset(result!, plan!.shape);
      if (input.checkTotals && !issues.some((issue) => issue.level === "fail") && plan!.shape.dimensions.length) {
        // 同样的指标和筛选,去掉分组再查一次
        const totalPlan: StoredPlan = { ...plan!, dataset: { ...plan!.dataset, groupBy: [] } };
        const total = await run(totalPlan, 10);
        if (plan!.result !== result) fail("INVALID_ARGS", "查询结果已变化，请重新校验");
        issues.push(...checkDataset(total, { ...plan!.shape, dimensions: [], timeField: undefined }));
        if (total.rows.length !== 1) issues.push({ level: "fail", code: "INVALID_TOTAL", message: "整体指标查询应返回一行，无法确认汇总口径。" });
        issues.push(...checkTotals(result!, total, plan!.shape.metrics));
        if (!issues.some((issue) => issue.level === "fail")) plan!.totalResult = total;
      }
      if (!plan!.shape.dimensions.length && !issues.some((issue) => issue.level === "fail")) plan!.totalResult = result;
      return { planId: input.planId, ...verdict(issues), issues };
    },
  });

  const dimensionValuesTool: ToolDef = registerTool({
    name: "get_dimension_values",
    description: "查一个维度在当前计划下有哪些取值。解析「华东大区」这类说法时用它 —— 取值必须来自数据库,不能编。",
    readOnly: true,
    schema: S.obj({ planId: S.str(), field: S.str("维度名"), match: S.str("可选:要匹配的自然语言说法") }, ["planId", "field"]),
    run: async (input: { planId: string; field: string; match?: string; }) => {
      const plan = plans.get(input.planId);
      if (!plan) fail("NOT_FOUND", `没有 planId=${input.planId} 的计划。`);
      /* 先直接问维表 —— 「大区有哪些」不需要扫事实表。拆不出来才退回慢路。
         慢路是整条指标 SQL(事实表 join 维表、扫整个日期范围、再 GROUP BY),
         真机上 45 秒都跑不完,于是「华东」永远补不成「华东大区」。 */
      const fast = await fastDimensionValues(plan!.dataset, input.field, 300, "", plan!.catalog).catch(() => null);
      const values = fast ?? await dimensionValues(plan!.dataset, input.field, plan!.catalog);
      /* 不带 match 时要把**取到的全部**取值回去,不能只给前 100 ——
         调用方(QueryPlanner)现在是拿这份清单在本地匹配的,截断会让「华北」
         这类排在后面的取值匹配不上,然后报成「数据里没有这个取值」。
         比截断更糟的是那句错误结论听起来还很确定。 */
      if (!input.match) return { field: input.field, total: values.length, values };
      const matches = matchDimensionValue(values, input.match);
      return {
        field: input.field,
        query: input.match,
        /* 命中多个时原样返回,**不替调用方挑** —— 那是该问用户的信号。
           「华东」只对上「华东大区」一个可以直接用;还对上「华东南」就必须问。 */
        matches,
        exact: matches.length === 1,
        total: values.length,
      };
    },
  });

  /**
   * 「为什么是 0 行」—— 把查询一层层剥开,让**数据自己说**是哪一层筛空的。
   *
   * 之前查一次空结果要来回猜好几轮:是日期不对?是筛选值对不上?还是指标口径本身
   * 就查不出数?每猜一轮就得改一次代码、装一次包、让用户再跑一遍。
   * 这三个可能性一次查询就能分清,没有理由靠猜。
   *
   * 剥的顺序是从窄到宽 —— 第一个变得有数的那层,就是凶手:
   *   1. 原样(带筛选、带日期)
   *   2. 去掉筛选
   *   3. 去掉筛选 + 日期放宽到两年
   * 只读、三条聚合查询,而且只在真的 0 行时才跑。
   */
  async function diagnoseEmpty(planId: string): Promise<{
    verdict: "filters" | "dateRange" | "metric" | "not-empty";
    message: string;
    counts: { asIs: number; noFilters: number; wideDate: number; };
    /** verdict=filters 时,库里该维度实际有哪些取值。 */
    actualValues?: Record<string, string[]>;
    /** 数据库原样抛回来的那句话。有它就别再自己转述。 */
    sqlError?: string;
  }> {
    const plan = plans.get(planId);
    if (!plan) fail("NOT_FOUND", `没有 planId=${planId} 的计划。`);

    /* 查不动和查出 0 行是两回事,别混 —— 而且**报的什么错必须留下来**。
       第一版这里 `catch { return -1 }` 把错误内容整个扔了,于是界面上只剩一句
       「查询直接报错」,到底是列名不对、JOIN 写错还是没权限,谁也不知道。
       那一行字本来就能结束整轮排查。 */
    const count = async (dataset: DashboardDataset, filters: StoredPlan["filters"]) => {
      assertOpen();
      try {
        const result = await executeDataset(dataset, translateError, 2000, filters, 90, plan!.catalog);
        assertOpen();
        return { rows: result.rows.length };
      } catch (e) {
        assertOpen();
        return { rows: -1, error: String(e).replace(/^Error:\s*/, "").slice(0, 400) };
      }
    };

    const a = await count(plan!.dataset, plan!.filters);
    const asIs = a.rows;
    if (asIs > 0) {
      return { verdict: "not-empty", message: `原样就能查到 ${asIs} 行,不是空的。`, counts: { asIs, noFilters: asIs, wideDate: asIs } };
    }

    const nf = await count(plan!.dataset, []);
    const noFilters = nf.rows;
    if (noFilters > 0) {
      // 是筛选筛空的 —— 顺手把库里真实取值捞回来,用户一眼看出该写什么
      const actualValues: Record<string, string[]> = {};
      for (const f of plan!.filters) {
        try {
          actualValues[f.field] = (await dimensionValues(plan!.dataset, f.field, plan!.catalog)).slice(0, 20);
        } catch { /* 捞不到就算了,结论本身已经成立 */ }
      }
      const wanted = plan!.filters.map((f) => `${f.field}=${f.value.split(SOH).join("、")}`).join(";");
      const real = Object.entries(actualValues).map(([k, v]) => `${k} 实际有:${v.join("、") || "(空)"}`).join(";");
      return {
        verdict: "filters",
        message: `**是筛选条件筛空的**。去掉筛选后同样的日期范围有 ${noFilters} 行。你筛的是 ${wanted}。${real}`,
        counts: { asIs, noFilters, wideDate: noFilters },
        actualValues,
      };
    }

    // 日期放宽到两年:排除"这段时间恰好没数"
    const end = plan!.dataset.metricScope?.end ?? today();
    const wideStart = utcDay(new Date(new Date(end).getTime() - 730 * 86_400_000));
    const wide = { ...plan!.dataset, metricScope: { ...(plan!.dataset.metricScope ?? {}), start: wideStart, end } } as DashboardDataset;
    const wd = await count(wide, []);
    const wideDate = wd.rows;
    if (wideDate > 0) {
      return {
        verdict: "dateRange",
        message: `**是日期范围里没数据**。把范围放宽到 ${wideStart} 至 ${end} 就有 ${wideDate} 行,` +
          `说明扩大日期范围后出现了符合条件的数据，具体原因仍需核查。`,
        counts: { asIs, noFilters, wideDate },
      };
    }

    const sqlError = wd.error ?? nf.error ?? a.error;
    return {
      verdict: "metric",
      // 有报错就把**原话**摆出来 —— 「查询直接报错」等于没说,数据库说的那句才有用
      message: sqlError
        ? `**指标的 SQL 跑不起来**,和你的问法、日期、筛选都无关。数据库说:「${sqlError}」` +
        `去指标中心打开这几个指标改口径;或者点「指标体检」核一遍底表和字段。`
        : `**是指标本身查不出数**。去掉全部筛选、把日期放宽到两年,依然一行都没有(查询返回 0 行,没报错)。` +
        `当前查询在放宽后的范围内仍没有匹配结果；是否与底表覆盖、关联条件或业务口径有关，需要进一步核查。`,
      counts: { asIs, noFilters, wideDate },
      sqlError,
    };
  }

  const diagnoseEmptyTool: ToolDef = registerTool({
    name: "diagnose_empty_result",
    description: "查出来 0 行时,一层层剥开查询,判定是筛选筛空的、日期范围内没数据、还是指标口径本身查不出数。只读。",
    readOnly: true,
    schema: S.obj({ planId: S.str("build_query_plan 返回的 id") }, ["planId"]),
    run: (input: { planId: string; }) => diagnoseEmpty(input.planId),
  });

  function dispose() { disposed = true; plans.clear(); }
  return {
    tools, getPlan, buildQueryPlan, diagnoseEmpty, resetPlans, dispose,
    buildQueryPlanTool, executeQueryPlanTool, validateDatasetTool, dimensionValuesTool, diagnoseEmptyTool
  };
}
