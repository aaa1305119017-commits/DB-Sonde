import type { AiConfig } from "../ai/aiTypes";
import { analysisRoles, analysisModelConfig, type AnalysisModelChoice } from "./model/analysisModels";
import { bindingFor } from "./model/modelRouting";
import { buildAnalysisGraph, type AnalysisNodes } from "./analysisGraph";
import type { GraphRuntime } from "./graph";
import { createState, type AgentState, type ValidatedMetric } from "./state";
import type { LockedParams } from "./analysisTypes";
import { describeRange, shiftRange } from "./period";

export interface RunAnalysisOptions {
  modelConfig?: AiConfig;
  modelChoice?: AnalysisModelChoice;
  connId?: string;
  today?: string;
  onStep?: (state: AgentState) => void;
  signal?: AbortSignal;
  previous?: AgentState;
  wantsDashboard?: boolean;
}

/** 数据没过体检时,给用户一个能看懂的交代 —— 而不是一句 failed。 */
export function explainFailure(state: AgentState): string {
  if (state.validation?.status === "fail") {
    return [
      "查出来的数没通过体检,所以我没有继续做分析 —— 拿有问题的数据下结论比不给结论更糟。",
      "",
      ...state.validation.issues.filter((i) => i.level === "fail").map((i) => `- ${i.message}`),
    ].join("\n");
  }
  if (state.errors.length) {
    return state.errors.map((e) => `[${e.node}] ${e.message}`).join("\n");
  }
  return "没跑完,但也没有明确的错误信息。";
}



export interface AnalysisWorkflowPort {
  nodes: AnalysisNodes;
  graph?: GraphRuntime;
  createState: typeof createState;
  modelConfig(): AiConfig;
  validatedMetrics(ids: string[]): ValidatedMetric[];
  prepare(connId?: string): void;
  clearDesignSession(workflowId: string): void;
}

export function createAnalysisWorkflow(port: AnalysisWorkflowPort) {
  async function execute(state: AgentState, question: boolean, options: RunAnalysisOptions, modelConfig: AiConfig) {
    let completed = false;
    try {
      options.signal?.throwIfAborted();
      port.prepare(options.connId);
      const result = await buildAnalysisGraph(port.nodes, question, port.graph).run(state,
        { maxSteps: 40, onStep: options.onStep, signal: options.signal, modelConfig });
      completed = result.status === "done";
      return result;
    } finally {
      if (!completed) port.clearDesignSession(state.workflowId);
    }
  }
  /** 跑一次参数锁死的分析。 */
  async function runLockedAnalysis(
    params: LockedParams,
    options: RunAnalysisOptions = {},
  ): Promise<AgentState> {
    params = structuredClone(params);
    const label = describeRange(params.dateRange);
    /* userRequest 仍要有内容:下游好几个节点拿它当「用户想要什么」。
       锁死模式下它 = 用户填的「重点」+ 一句机器生成的范围描述。 */
    const userRequest = params.focus.trim()
      ? params.focus.trim()
      : `分析 ${label} 的数据`;
    const validatedMetrics = port.validatedMetrics(params.metricIds);


    const modelConfig = analysisModelConfig(options.modelConfig ?? port.modelConfig(), options.modelChoice);
    const state: AgentState = {
      ...port.createState({ userRequest, connId: options.connId, today: options.today }),
      validatedMetrics,
      modelChoice: options.modelChoice,
      models: analysisRoles(params.wantsDashboard).map(({ role }) => { const { provider, model } = bindingFor(role, modelConfig); return { role, provider, model }; }),
      locked: true,
      lockedParams: params,
      focus: params.focus.trim() || undefined,
      requirement: {
        goal: userRequest,
        subject: label,
        audience: "analyst",
        comparisons: params.comparisons,
        candidateDimensions: params.dimensions,
        candidateMetricTerms: [],
        wantsDashboard: params.wantsDashboard,
        unsupported: [],
      },
      scope: {
        dateRange: params.dateRange,
        grain: (params.dimensions.find((d) => ["day", "week", "month", "year"].includes(d)) ?? "day") as "day" | "week" | "month" | "year",
        comparisonRanges: params.comparisons.map((kind) => ({ kind, ...shiftRange(params.dateRange, kind) })),
        filters: params.filters.map((f) => ({ ...f, resolvedFrom: f.values.join("、") })),
        label,
      },
    };
    return execute(state, false, options, modelConfig);
  }


  /** Ask a business question without a parameter form; only unresolved meaning pauses the run. */
  async function runQuestionAnalysis(question: string, options: RunAnalysisOptions = {}): Promise<AgentState> {
    const config = analysisModelConfig(options.modelConfig ?? port.modelConfig(), options.modelChoice);
    const previous = options.connId && options.previous?.connId === options.connId ? structuredClone(options.previous) : undefined;
    const conversation = previous ? [...(previous.conversation ?? []),
    { role: "user" as const, content: previous.userRequest },
    { role: "assistant" as const, content: previous.clarification ?? previous.analysisSummary ?? "" },
    ].slice(-8) : [];

    const state: AgentState = {
      ...port.createState({ userRequest: question, connId: options.connId, today: options.today }),
      locked: false, focus: question, conversation, previousParams: previous?.lockedParams ?? previous?.previousParams,
      previousSummary: previous?.analysisSummary ?? previous?.previousSummary,
      modelChoice: options.modelChoice,
      models: analysisRoles(options.wantsDashboard !== false).map(({ role }) => { const { provider, model } = bindingFor(role, config); return { role, provider, model }; }),
      requirement: { goal: question, subject: "", audience: "analyst", comparisons: [], candidateDimensions: [], candidateMetricTerms: [], wantsDashboard: options.wantsDashboard ?? true },
    };
    return execute(state, true, options, config);
  }

  return { runLockedAnalysis, runQuestionAnalysis };
}
