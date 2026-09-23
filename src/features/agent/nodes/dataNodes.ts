import type { AgentState, DatasetSummary } from "../state";
import type { NodeFn } from "../graph";
import type { PlanReader, DimensionLabel } from "../planReader";
import type { ToolCaller } from "./ports";
import { verdict, type ValidationIssue } from "../validation/dataChecks";
import { shiftRange } from "../period";

export interface DataNodePorts { callTool: ToolCaller; getPlan: PlanReader; dimensionLabel: DimensionLabel; }

export function createDataNodes({ callTool, getPlan, dimensionLabel }: DataNodePorts) {
  const dataExecutor: NodeFn = async (state, context) => {
    const datasets: NonNullable<AgentState["datasets"]> = {};
    const notes: string[] = [];
    const executionPlans = [...(state.plans ?? []), ...(state.supportingPlans ?? []).map((p) => ({ ...p, role: "detail" as const }))];
    for (const plan of executionPlans) {
      context?.signal?.throwIfAborted();
      const run = await callTool<DatasetSummary>("execute_query_plan", {
        planId: plan.planId, maxRows: 20000, preview: 5,
      }, state.workflowId);
      context?.signal?.throwIfAborted();
      if (!run.ok) {
        /* 超时和别的失败不是一回事:别的失败是"写错了",超时是"这条查询就是太重了"。
           后者得给能动手的建议,光把 timed out 甩出来,用户只能干瞪眼。 */
        const msg = run.error!.message;
        if (/timed out/i.test(msg)) {
          const dims = getPlan(plan.planId)?.shape.dimensions ?? [];
          const metricCount = state.validatedMetrics?.length ?? 0;
          throw new Error(
            `这条查询跑太久没跑完(${msg.match(/\d+/)?.[0] ?? "?"} 秒)。不是写错了,是它太重:\n` +
            `  · ${metricCount} 个指标一起查${dims.length ? `,还按${dims.map(dimensionLabel).join("、")}分组` : ""}\n` +
            `  · 时间范围 ${state.scope?.label ?? ""}\n` +
            `可以这样减轻:少要几个指标、把区间缩短(比如先看一个月)、` +
            `或者减少分组取值很多的维度。`,
          );
        }
        throw new Error(`取数失败(${plan.role}):${msg}`);
      }
      datasets[plan.planId] = run.data!;

      /* 0 行的时候**当场查清楚为什么**,别留给人猜。
         三个可能(筛选筛空了 / 这段日期没数 / 指标本身查不出数)要靠三次查询才分得开,
         而这三次加起来几秒钟 —— 比让人换个问法再试一遍、猜错再试一遍便宜得多。
         真机上为这个来回折腾了好几轮,每轮都要改代码装包重跑。 */
      if (plan.role === "primary" && run.data!.rowCount === 0) {
        const why = await callTool<{ verdict: string; message: string; }>(
          "diagnose_empty_result", { planId: plan.planId }, state.workflowId);
        context?.signal?.throwIfAborted();
        if (why.ok && why.data!.verdict !== "not-empty") notes.push(`查不到数的原因:${why.data!.message}`);
      }
    }
    return notes.length
      ? { datasets, dropped: [...new Set([...(state.dropped ?? []), ...notes])] }
      : { datasets };
  };

  // ── 7. ★ DataValidator(零 LLM)─────────────────────────────────

  const dataValidator: NodeFn = async (state, context) => {
    if (!state.plans?.some((p) => p.role === "primary")) throw new Error("没有主查询计划");
    const issues: ValidationIssue[] = [];
    /* 体检要分主次。
       原来所有查询的问题混在一起算,只要有一条 fail 整个分析就停在「数据检查没有通过」。
       于是一家去年还没开的店问「今年怎么样、跟去年比」,同比期查出来是空的 ——
       本期数据明明好好的,整件事却直接不做了。
       主查询 fail 该停(没数就没有分析);对比期和补充查询 fail 只说明**这一条**不能用,
       把它摘掉、记一笔,剩下的照做。事实计算那边本来就会跳过没有结果的对比期。 */
    const dropPlans = new Set<string>();
    const notes: string[] = [];
    for (const plan of [...state.plans, ...(state.supportingPlans ?? []).map((p) => ({ ...p, role: "detail" as const }))]) {
      context?.signal?.throwIfAborted();
      const checked = await callTool<{ issues: ValidationIssue[]; }>("validate_dataset", { planId: plan.planId, checkTotals: true }, state.workflowId);
      context?.signal?.throwIfAborted();
      if (!checked.ok) throw new Error(checked.error!.message);
      const label = { primary: "本期", mom: "环比期", yoy: "同比期", detail: "补充分析" }[plan.role];
      const fails = checked.data!.issues.filter((issue) => issue.level === "fail");
      if (plan.role !== "primary" && fails.length) {
        dropPlans.add(plan.planId);
        const why = fails.map((f) => f.message).join("；");
        notes.push(`${label}的数据没通过体检,这次没拿它做对比：${why}`);
        issues.push({ level: "warn", code: "PLAN_DROPPED", message: `${label}：数据没通过体检,已从本次分析里摘掉(${fails.map((f) => f.code).join("、")})。`, samples: fails.map((f) => f.message) });
        continue;
      }
      issues.push(...checked.data!.issues.map((issue) => ({ ...issue, message: `${label}：${issue.message}` })));
    }
    /* 摘掉的对比期也要从 scope 里拿掉 —— 否则报告说「这次没做同比」,
       生成的看板上 KPI 卡却还开着同比徽标(它是照 scope.comparisonRanges 决定的),
       两边自相矛盾。 */
    const droppedKinds = new Set(state.plans.filter((p) => dropPlans.has(p.planId)).map((p) => p.role));
    const plans = state.plans.filter((p) => !dropPlans.has(p.planId));
    return {
      validation: { ...verdict(issues), issues },
      plans,
      ...(state.scope && droppedKinds.size
        ? { scope: { ...state.scope, comparisonRanges: state.scope.comparisonRanges.filter((r) => !droppedKinds.has(r.kind)) } }
        : {}),
      supportingPlans: (state.supportingPlans ?? []).filter((p) => !dropPlans.has(p.planId)),
      // 摘掉了什么必须写进结论 —— 一份没说"少了同比"的报告比说不出结论更危险。
      ...(notes.length ? { dropped: [...new Set([...(state.dropped ?? []), ...notes])] } : {}),
    };
  };

  const lockedPlanner: NodeFn = async (state, context) => {
    const p = state.lockedParams!;
    const ranges: { role: "primary" | "mom" | "yoy"; range: { start: string; end: string; }; }[] = [
      { role: "primary", range: p.dateRange },
      ...p.comparisons.map((kind) => ({ kind, ...shiftRange(p.dateRange, kind) }))
        .map((c) => ({ role: c.kind, range: { start: c.start, end: c.end } })),
    ];
    const grain = p.dimensions.find((d) => ["day", "week", "month", "year"].includes(d)) ?? "day";

    const plans: NonNullable<AgentState["plans"]> = [];
    for (const { role, range } of ranges) {
      context?.signal?.throwIfAborted();
      const built = await callTool<{ planId: string; }>("build_query_plan", {
        metricIds: p.metricIds, dimensions: p.dimensions, dateRange: range, filters: p.filters, grain,
      }, state.workflowId);
      context?.signal?.throwIfAborted();
      if (!built.ok) throw new Error(built.error!.message);
      plans.push({ role, planId: built.data!.planId, dateRange: range });
    }
    const supportingPlans: NonNullable<AgentState["supportingPlans"]> = [];
    // Query each axis separately for autonomous analysis: rates must be recalculated by SQL,
    // never averaged from mixed-grain cells.
    if (state.locked === false && p.dimensions.length > 1) {
      for (const dimension of p.dimensions) {
        context?.signal?.throwIfAborted();
        const built = await callTool<{ planId: string; }>("build_query_plan", {
          metricIds: p.metricIds, dimensions: [dimension], dateRange: p.dateRange, filters: p.filters, grain,
        }, state.workflowId);
        context?.signal?.throwIfAborted();
        if (!built.ok) throw new Error(built.error!.message);
        supportingPlans.push({ planId: built.data!.planId, dimensions: [dimension] });
      }
    }
    return { plans, supportingPlans };
  };

  return { dataExecutor, dataValidator, lockedPlanner };
}
