import { S } from "../jsonSchema";
import { computeFacts } from "../factCalculator";
import type { Insight } from "../state";
import type { NodeFn } from "../graph";
import type { PlanReader, DimensionLabel } from "../planReader";
import type { StructuredCaller } from "./ports";

const ANALYSIS_SCHEMA = S.obj(
  {
    summary: S.str("围绕用户问题组织完整结论，长度匹配问题复杂度。区别事实、假设、待验证建议，并说明重要局限"),
    findings: {
      type: "array", minItems: 1, maxItems: 10,
      items: S.obj(
        {
          headline: S.str("一句话结论,必须带具体数字"),
          /** 指向代码算出来的那条事实 —— 模型只能引用,不能自己编数 */
          factId: S.str("引用哪条事实(来自给你的事实清单里的 id)"),
          severity: S.enumOf(["info", "warn", "critical"]),
        },
        ["headline", "factId", "severity"],
      ),
    },
  },
  ["summary", "findings"],
);

export function createAnalysisNode({ callStructured, getPlan, dimensionLabel }: {
  callStructured: StructuredCaller; getPlan: PlanReader; dimensionLabel: DimensionLabel;
}): NodeFn {
  return async (state, context) => {
    context?.signal?.throwIfAborted();
    /* 关键:趋势、同环比、TopN、贡献度全由代码算好,模型只负责**挑重点和讲人话**。
       让它自己从数据里"看出"结论,等于让它心算几千行 —— 那正是幻觉的来源。 */
    const facts = computeFacts(state, getPlan, dimensionLabel);
    if (facts.length === 0) {
      return { insights: [], report: "数据取回来了,但没有算出值得一提的结论(可能是维度太少或区间太短)。" };
    }

    const factList = facts.map((f) => `[${f.id}] ${f.text}`).join("\n");
    const result = await callStructured<{ summary: string; findings: { headline: string; factId: string; severity: Insight["severity"]; }[]; }>({
      signal: context?.signal,
      role: "reasoning",
      node: "AnalysisAgent",
      name: "analysis",
      schema: ANALYSIS_SCHEMA,
      system: `你是数据分析师。下面是**程序从真实数据里算出来的事实**,你的工作是从中挑出最重要的几条,用业务语言讲清楚。

铁律:
- **只能引用事实清单里的数字**,一个字都不许自己算、自己编。
- 区分事实、相关关系与因果。允许提出明确标记为“待验证”的解释和验证建议，但不能把猜测当成已证实原因。
- 每条 finding 必须填 factId,指明它基于哪条事实。
- 按问题需要决定结论条数和展开程度，不套固定的总量、趋势、前几名模板。

分析目标:${state.requirement?.goal ?? state.userRequest}
本次分析路径:${state.analysisAngle ?? "根据问题选择最有解释力的事实"}
前一轮结论:${state.previousSummary ?? "无"}
如果是追问，围绕新问题补充证据和比较，不重复整段旧结论；如果数据和发现没有变化，直接说明，不为变化而编造。
数据范围:${state.scope?.label}
证据缺口:${JSON.stringify(state.evidenceGaps ?? [])}
调查经过:${JSON.stringify(state.investigation ?? [])}
${state.conclusionReview?.verdict === "revise" ? `上一稿未通过复核，请逐项修正：${state.conclusionReview.issues.join("；")}` : ""}
${state.validation?.status === "warn" ? `\n注意:数据体检有提醒 —— ${state.validation.summary},结论里要交代。` : ""}
${state.dropped?.length ? `\n注意:用户的这些要求这次没能满足,写结论时不要假装做到了:\n${state.dropped.map((d) => `  · ${d}`).join("\n")}` : ""}`,
      user: `事实清单:\n${factList}`,
    }, context?.modelConfig);

    context?.signal?.throwIfAborted();
    if (!result.ok) throw new Error(`分析失败:${result.errors?.join(";")}`);
    const byId = new Map(facts.map((f) => [f.id, f]));
    // 引用了不存在的 factId = 模型在编,直接丢掉这条(设计报告:没有 evidence 的 insight 一律丢弃)
    const insights: Insight[] = result.data!.findings
      .filter((f) => byId.has(f.factId))
      .map((f) => {
        const fact = byId.get(f.factId)!;
        return {
          kind: fact.kind,
          headline: f.headline,
          evidence: { planId: fact.planId, rows: fact.rows, columns: fact.columns, computedBy: fact.computedBy },
          severity: f.severity,
        };
      });

    const dropped = result.data!.findings.length - insights.length;
    const report = [
      result.data!.summary,
      "",
      ...insights.map((i) => `- ${i.headline}`),
      /* 没做到的要求必须写在结论里。一份看着完整、实际漏了半个条件的报告,
         比一句"做不到"危险得多。 */
      state.dropped?.length
        ? `\n以下要求这次没能满足:\n${state.dropped.map((d) => `  · ${d}`).join("\n")}`
        : "",
      state.validation?.status === "warn" ? `\n数据提醒:${state.validation.summary}` : "",
      dropped > 0 ? `\n(丢弃了 ${dropped} 条没有事实支撑的结论)` : "",
    ].filter(Boolean).join("\n");

    return {
      insights,
      analysisSummary: result.data!.summary,
      report,
      usage: [...state.usage, { node: "AnalysisAgent", ms: result.ms, promptTokens: result.promptTokens, completionTokens: result.completionTokens }],
    };
  };


}
