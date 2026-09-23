import { S } from "./jsonSchema";
import type { NodeFn } from "./graph";
import type { AgentState, DatasetSummary } from "./state";
import type { Metric } from "../metrics/metricTypes";
import type { PlanReader } from "./planReader";
import type { StructuredCaller, ToolCaller } from "./nodes/ports";
import { computeFacts } from "./factCalculator";
import { availableDimensions } from "../dashboard/semantic";
import { validatedMetricsFor, catalogDimensionLabel } from "./analysisCatalog";
import { verdict, type ValidationIssue } from "./validation/dataChecks";

interface CoverageDecision { area: string; action: "query" | "not_needed" | "unavailable"; reason: string; }
export function pendingCoverage(plan: NonNullable<import("./state").AgentState["coveragePlan"]>, executedIds: string[], decisions: CoverageDecision[], failedIds: string[]) {
  return plan.filter(p => p.disposition !== "irrelevant" && p.metricIds.some(id => !executedIds.includes(id))).filter(p => {
    const decision = decisions.find(d => d.area === p.area);
    if (decision?.action === "not_needed" && decision.reason.trim().length >= 16) return false;
    if (decision?.action === "unavailable" && p.metricIds.filter(id => !executedIds.includes(id)).every(id => failedIds.includes(id))) return false;
    return true;
  });
}
interface EvidenceDecision {
  coverageDecisions: CoverageDecision[];
  decision: "ready" | "query" | "clarify";
  reasoning: string;
  question: string;
  gaps: string[];
  queries: { metricIds: string[]; dimensions: string[]; reason: string; }[];
}
const EVIDENCE_SCHEMA = S.obj({
  coverageDecisions: S.arr(S.obj({ area: S.str(), action: S.enumOf(["query", "not_needed", "unavailable"]), reason: S.str("具体说明对问题的影响；未尝试查询不能说不可用") }, ["area", "action", "reason"]), "逐项处理覆盖计划中尚未调查的主题；查询失败才算不可用，不相关需解释取舍", 20),
  decision: S.enumOf(["ready", "query", "clarify"]), reasoning: S.str("现有证据是否足够，为什么"), question: S.str("只有关键业务含义确实无法确定才问"),
  gaps: S.arr(S.str(), "仍未证实的内容，不得假装有答案", 6),
  queries: S.arr(S.obj({ metricIds: S.arr(S.str(), "真实指标 id", 8), dimensions: S.arr(S.str(), "分组维度", 3), reason: S.str("此查询验证哪个疑问") }, ["metricIds", "dimensions", "reason"]), "只查询有助于回答问题、且尚未查询的视角", 2),
}, ["decision", "reasoning", "question", "gaps", "queries", "coverageDecisions"]);

/** The model decides whether to investigate further. Scope and read-only semantics are enforced in code. */
export interface EvidencePorts {
  readCatalog(): Metric[];
  callStructured: StructuredCaller;
  callTool: ToolCaller;
  getPlan: PlanReader;
}
export function createEvidenceExplorer({ readCatalog, callStructured, callTool, getPlan }: EvidencePorts): NodeFn {
  return async (initial, context) => {
    context?.signal?.throwIfAborted();
    let state = structuredClone(initial);
    const all = structuredClone(readCatalog());
    const anchor = all.find((m) => m.id === state.validatedMetrics?.[0]?.metricId);
    if (!anchor || !state.scope) throw new Error("缺少已核对的分析范围");
    if (state.connId && anchor.connId !== state.connId) throw new Error("分析指标与当前连接不一致，请重新规划");
    const catalog = all.filter((m) => m.enabled && m.connId === anchor.connId && m.database === anchor.database);
    const analyze = (value: AgentState) => computeFacts(value, getPlan, key => catalogDimensionLabel(catalog, key));
    const attempts = [...(state.investigation ?? [])];
    const failedIds: string[] = [];
    // This is a resource budget, not a fixed analytical sequence. Two new views per round.
    for (let round = 0; round < 4; round++) {
      context?.signal?.throwIfAborted();
      const facts = analyze(state);
      const result = await callStructured<EvidenceDecision>({
        role: "reasoning", node: "EvidenceExplorer", name: "evidence_decision", schema: EVIDENCE_SCHEMA, signal: context?.signal,
        system: `你是负责交付质量的分析师。不要拿到第一份汇总就写报告。判断已有证据能否充分回答用户的问题。
你可自主补查其他指标或分组来比较、拆解、验证怀疑，也可以判定证据已经足够。不要为了显得深入而机械增加查询。
先对照完整目录的业务分类与调查记录中的覆盖计划，检查相关业务面是否遗漏。首批8个指标是单次取数预算，不是分析范围。对尚未调查但相关的主题，决定补查或解释为何不展开；不要把首批熟悉的指标当作完整经营情况。
需要解释期内变化而现有数据只有一个月汇总时，可在同一日期范围内按日或周补查，不能拿一个月度点冒充趋势。图表多样性本身不是增加查询的理由。
特别检查：数量变化是否仅由业务量变化解释、比率是否有准确分母、异常是否局部集中、关键分组是否完整。
只能用真实指标清单。查询自动继承已核对的日期和筛选，不能越界。不要重复已有相同的指标/分组查询。
明确区分未查、查询失败和与问题无关。能查询且影响判断的主题应补查，不能以“未展开”替代调查；not_needed必须说明为什么不影响本题结论，不能只说核心总览不依赖。
不可用的数据、无法证实的原因应记为 gaps。只有业务含义歧义才 clarify，不要询问用户要哪个图、前几名。
剩余补查轮数：${3 - round}。为0时必须 ready 并如实列出证据缺口。
用户问题：${state.userRequest}
本次分析路径：${state.analysisAngle ?? ""}
成品验收发现的深度问题（如有）：${state.designFeedback ?? "无"}
实际范围：${JSON.stringify(state.scope)}
真实指标清单：${JSON.stringify(catalog.map((m) => ({ id: m.id, name: m.name, category: m.category, unit: m.unit, caliber: m.caliber, dimensions: availableDimensions([m]) })))}
已经执行的视角：${JSON.stringify([...(state.plans ?? []), ...(state.supportingPlans ?? [])].map((p) => { const plan = getPlan(p.planId); return { metricIds: plan?.metricIds, dimensions: plan?.shape.dimensions }; }))}
业务覆盖计划：${JSON.stringify(state.coveragePlan ?? [])}
调查记录：${JSON.stringify(attempts)}
程序计算的证据：\n${facts.map((f) => `[${f.id}] ${f.text}`).join("\n")}`,
        user: "判断证据是否充分，并决定下一步。",
      }, context?.modelConfig);
      context?.signal?.throwIfAborted();
      state.usage = [...state.usage, { node: "EvidenceExplorer", ms: result.ms, promptTokens: result.promptTokens, completionTokens: result.completionTokens }];
      if (!result.ok || !result.data) throw new Error(`证据检查失败：${result.errors?.join("；")}`);
      const decision = structuredClone(result.data);
      attempts.push(decision.reasoning);
      state.evidenceGaps = decision.gaps;
      if (decision.decision === "clarify") return { ...state, status: "needs_input", clarification: decision.question || "请补充希望进一步验证的业务对象。", investigation: attempts };
      const executed = [...(state.plans ?? []), ...(state.supportingPlans ?? [])].flatMap(p => getPlan(p.planId)?.metricIds ?? []);
      const pending = pendingCoverage(state.coveragePlan ?? [], executed, decision.coverageDecisions ?? [], failedIds);
      for (const choice of decision.coverageDecisions ?? []) attempts.push(`覆盖取舍 · ${choice.area}：${choice.action} — ${choice.reason}`);
      if (decision.decision === "ready" && pending.length && round < 3) {
        attempts.push(`暂不能结束：${pending.map(p => p.area).join("、")}仍有可用指标未调查。给出补查查询，或逐项解释为何与本题无关。`);
        if (!decision.queries.length) continue;
        decision.decision = "query";
      }
      if (decision.decision === "ready" || round === 3) {
        if (pending.length) state.evidenceGaps = [...decision.gaps, ...pending.map(p => `${p.area}：存在可用但尚未完成调查的指标，相关结论尚不充分。`)];
        if (decision.decision !== "ready") state.evidenceGaps = [...(state.evidenceGaps ?? decision.gaps), "本次补查预算已用完，仍有疑问尚未验证。"];
        return { ...state, investigation: attempts };
      }
      let progressed = false;
      for (const query of decision.queries) {
        context?.signal?.throwIfAborted();
        if (!query.metricIds.length || query.metricIds.some((id) => !catalog.some((m) => m.id === id))) {
          attempts.push(`未执行“${query.reason}”：指标不在当前连接与数据库的可用清单中。`); continue;
        }
        const same = [...(state.plans ?? []), ...(state.supportingPlans ?? [])].some((p) => {
          const prior = getPlan(p.planId);
          return JSON.stringify([...(prior?.metricIds ?? [])].sort()) === JSON.stringify([...query.metricIds].sort()) && JSON.stringify([...(prior?.shape.dimensions ?? [])].sort()) === JSON.stringify([...query.dimensions].sort());
        });
        if (same) { attempts.push(`未重复执行“${query.reason}”：此视角已取数。`); continue; }
        const built = await callTool<{ planId: string; }>("build_query_plan", {
          metricIds: query.metricIds, dimensions: query.dimensions,
          dateRange: state.scope!.dateRange, filters: state.scope!.filters.map(({ field, values }) => ({ field, values })), grain: state.scope!.grain
        }, state.workflowId);
        context?.signal?.throwIfAborted();
        if (!built.ok) { attempts.push(`未执行“${query.reason}”：${built.error?.message}`); continue; }
        const planId = built.data!.planId;
        const data = await callTool<DatasetSummary>("execute_query_plan", { planId, maxRows: 20000, preview: 5 }, state.workflowId);
        context?.signal?.throwIfAborted();
        if (!data.ok) { failedIds.push(...query.metricIds); attempts.push(`补查“${query.reason}”失败：${data.error?.message}`); continue; }
        const checked = await callTool<{ issues: ValidationIssue[]; }>("validate_dataset", { planId, checkTotals: true }, state.workflowId);
        context?.signal?.throwIfAborted();
        if (!checked.ok || checked.data!.issues.some((i) => i.level === "fail")) {
          attempts.push(`补查“${query.reason}”未通过数据检查，未作为证据使用。`); continue;
        }
        const existing = new Map((state.validatedMetrics ?? []).map((m) => [m.metricId, m]));
        validatedMetricsFor(query.metricIds, all).forEach((m) => existing.set(m.metricId, m));
        state.validatedMetrics = [...existing.values()];
        state.supportingPlans = [...(state.supportingPlans ?? []), { planId, dimensions: query.dimensions }];
        state.datasets = { ...state.datasets, [planId]: data.data! };
        const warnings = checked.data!.issues.filter((i) => i.level !== "fail");
        if (warnings.length) {
          const issues = [...(state.validation?.issues ?? []), ...warnings];
          state.validation = { ...verdict(issues), issues };
        }
        attempts.push(`完成补查：${query.reason}（${data.data!.rowCount} 行）`);
        progressed = true;
      }
      if (!progressed) attempts.push("本轮未取得新证据，请改变查询思路，或说明证据缺口后结束。");
    }
    return { ...state, investigation: attempts };
  };

}

/* issues 只放**必须改**的。核对过没问题的写进 checked —— 它不回灌给写作节点。
   原来两者混在一条数组里:复核列了八条,六条自己写着「此项可接受」「不构成错误」,
   全被当成「逐项修正」喂回去,写作节点照着改一轮,下一轮复核又列一遍。 */
const REVIEW_SCHEMA = S.obj({
  verdict: S.enumOf(["pass", "revise"]),
  issues: S.arr(S.str(), "只写必须修改的:无证据支持的数字、错误口径、漏答、把猜测说成已证实的因果。核对过没问题的不要写在这里", 8),
  checked: S.arr(S.str(), "核对过、确认没问题的要点(不会要求修改)", 8),
}, ["verdict", "issues"]);

/** Independent review of the written answer against evidence, before dashboard generation. */
/**
 * 独立复核:拿报告和证据逐条对。
 *
 * 给它的上下文里**必须带上数据体检的结论** —— 写报告那个节点被要求「体检有提醒就在
 * 结论里交代」,而这儿原来看不到体检结果,于是报告里那句「数据体检提示 2 处 MANY_NULLS」
 * 在复核眼里成了「无证据支持的说法」。只要体检是 warn,报告就必然被判不通过,
 * 两轮之后整个分析作废 —— 而它交代得完全正确。
 */
export function createConclusionReviewer({ readCatalog, callStructured, getPlan }: Omit<EvidencePorts, "callTool">): NodeFn {
  return async (state, context) => {
    context?.signal?.throwIfAborted();
    const catalog = structuredClone(readCatalog()).filter(metric => metric.connId === state.connId);
    const analyze = (value: AgentState) => computeFacts(value, getPlan, key => catalogDimensionLabel(catalog, key));
    const result = await callStructured<{ verdict: "pass" | "revise"; issues: string[]; checked?: string[]; }>({
      role: "review", node: "ConclusionReviewer", name: "conclusion_review", schema: REVIEW_SCHEMA, signal: context?.signal,
      system: `核对分析报告是否准确回答了问题。只检查事实质量，不要求固定措辞、条数或文风。
issues 里只写**必须修改**的;核对过没问题的放 checked,不要写进 issues —— 那会被当成返工要求。
verdict 只看 issues:issues 为空就是 pass。
逐项核对数字、比率分母、日期、分组、样本覆盖、因果与相关的区别。报告里的数字必须能从给定证据核对。
允许有明确标记的假设和下一步验证建议；不得把假设说成已证实原因。真实不可用的数据可以如实承认，不要求无依据的因果；目录中可用但未查不等于缺数据，报告应明确这是调查未完成，不能宣称全面。
覆盖计划：${JSON.stringify(state.coveragePlan ?? [])}
调查与取舍：${JSON.stringify(state.investigation ?? [])}
问题：${state.userRequest}\n实际范围：${JSON.stringify(state.scope)}\n证据缺口：${JSON.stringify(state.evidenceGaps ?? [])}
数据体检：${state.validation ? JSON.stringify({ 结论: state.validation.summary, 明细: state.validation.issues.map((i) => `${i.level === "fail" ? "需修正" : "提醒"} ${i.code}：${i.message}`) }) : "没有体检记录"}
证据：\n${analyze(state).map((f) => `[${f.id}] ${f.text}`).join("\n")}`,
      user: state.report ?? state.analysisSummary ?? "没有报告",
    }, context?.modelConfig);
    context?.signal?.throwIfAborted();
    if (!result.ok || !result.data) throw new Error(`结论复核失败：${result.errors?.join("；")}`);
    return { conclusionReview: result.data, usage: [...state.usage, { node: "ConclusionReviewer", ms: result.ms, promptTokens: result.promptTokens, completionTokens: result.completionTokens }] };
  };

}
