import { create } from "zustand";
import type { AnalysisDraftRepository } from "./analysisRepository";
import type { AiConfig } from "../ai/aiTypes";
import { catalogConnection } from "./analysisCatalog";
import type { Metric } from "../metrics/metricTypes";
import { analysisModelConfig, analysisModelProblems } from "./model/analysisModels";
import { analysisProblems, blankAnalysisDraft, filterContext } from "./analysisDraft";
import type { AnalysisDraft, LockedParams } from "./analysisTypes";
import type { createAnalysisWorkflow } from "./analysisWorkflow";
import type { createState, AgentState } from "./state";

export interface AnalysisState {
  draft: AnalysisDraft;
  storageError: string | null;
  valueOptions: Record<string, string[]>;
  loadingValues: boolean;
  running: boolean;
  stopping: boolean;
  run: AgentState | null;
  abort: AbortController | null;
  patch(patch: Partial<AnalysisDraft>): boolean;
  reset(): boolean;
  setOptions(field: string, values: string[]): void;
  setLoadingValues(loading: boolean): void;
  clearOptions(key: string): void;
  start(connId: string, followUp?: string): Promise<void>;
  stop(): void;
  dispose(): void;
}
export interface AnalysisRuntimePort {
  repository: AnalysisDraftRepository;
  metrics(): Metric[];
  modelConfig(): AiConfig;
  workflow: ReturnType<typeof createAnalysisWorkflow>;
  createState: typeof createState;
  now(): Date;
  releaseRun(workflowId: string): void;
}

/** One workspace instance owns its draft and run; switching UI tabs does not dispose it. */
export function createAnalysisStore(port: AnalysisRuntimePort) {
  let owner: object | null = null;
  let disposed = false;
  return create<AnalysisState>((set, get) => {
    const save = (draft?: AnalysisDraft) => {
      try {
        if (draft) port.repository.save(draft);
        else port.repository.reset();
        return true;
      }
      catch {
        set({ storageError: "分析配置未能保存，本次修改未生效。请检查本地存储提示后重试。" });
        return false;
      }
    };
    return {
      draft: port.repository.load(), storageError: null, valueOptions: {}, loadingValues: false,
      running: false, stopping: false, run: null, abort: null,
      patch(patch) {
        if (disposed || get().running) return false;
        const old = get().draft;
        const draft = structuredClone({ ...old, ...patch });
        if (patch.metricIds && !old.filterContext && Object.values(old.filterValues).some(values => values.length)) {
          draft.filterContext = filterContext(old.metricIds, port.metrics());
        }
        if (!save(draft)) return false;
        set({ draft, storageError: null });
        return true;
      },
      reset() {
        if (disposed || get().running) return false;
        const draft = blankAnalysisDraft(port.now());
        if (!save()) return false;
        const previous = get().run;
        set({ draft, valueOptions: {}, loadingValues: false, run: null, storageError: null });
        if (previous) port.releaseRun(previous.workflowId);
        return true;
      },
      setOptions(field, values) {
        if (!disposed) set(state => ({ valueOptions: Object.fromEntries([...Object.entries(state.valueOptions).filter(([key]) => key !== field), [field, [...values]]].slice(-30)) }));
      },
      setLoadingValues(loadingValues) { if (!disposed) set({ loadingValues }); },
      clearOptions(key) {
        const valueOptions = { ...get().valueOptions };
        delete valueOptions[key];
        if (!disposed) set({ valueOptions });
      },
      async start(connId, followUp) {
        if (disposed || get().running) return;
        const draft = structuredClone(get().draft);
        const metrics = structuredClone(port.metrics());
        const config = structuredClone(port.modelConfig());
        const followUpQuestion = followUp?.trim();
        const questionMode = !!followUpQuestion || draft.mode === "question";
        const question = followUpQuestion || draft.question.trim();
        /* Manual selection already identifies the source; record the connection actually queried.
           直接提问没有选中的指标,就按**指标目录**来定连接 —— 而不是按
           "点「分析」时恰好在看哪个 tab"。分析 tab 建一次就一直复用,
           那个随手带上的 connId 会被永久焊死,于是指标一个没少却全被过滤掉。 */
        const runConnId = questionMode
          ? catalogConnection(metrics, connId).connId
          : metrics.find(metric => metric.id === draft.metricIds[0])?.connId || connId;
        const last = get().run;
        const previous = runConnId && last?.connId === runConnId && (followUpQuestion || (last.userRequest === question && last.locked === false)) ? structuredClone(last) : undefined;
        const problems = [...(questionMode ? question ? [] : ["写下你想了解的问题"] : analysisProblems(draft, metrics)),
        ...analysisModelProblems(config, draft.modelChoice, draft.wantsDashboard)];
        const initial = port.createState({ userRequest: questionMode ? question : draft.focus, connId: runConnId });
        if (problems.length) {
          set({ run: { ...initial, status: "failed", errors: [{ node: "Run", message: problems.join("；"), at: port.now().toISOString() }] } });
          if (last) port.releaseRun(last.workflowId);
          return;
        }
        const controller = new AbortController(), ticket = {};
        owner = ticket;
        const current = () => !disposed && owner === ticket;
        set({ running: true, stopping: false, run: null, abort: controller });
        const params: LockedParams = {
          metricIds: draft.metricIds, dimensions: [draft.grain, ...draft.dimensions],
          dateRange: { start: draft.start, end: draft.end },
          comparisons: [...(draft.mom ? ["mom" as const] : []), ...(draft.yoy ? ["yoy" as const] : [])],
          filters: Object.entries(draft.filterValues).filter(([, values]) => values.length).map(([field, values]) => ({ field, values })),
          focus: draft.focus, wantsDashboard: draft.wantsDashboard,
        };
        try {
          if (last) port.releaseRun(last.workflowId);
          const options = {
            connId: runConnId, modelConfig: analysisModelConfig(config, draft.modelChoice), modelChoice: draft.modelChoice,
            signal: controller.signal,
            onStep: (state: AgentState) => { if (current() && !controller.signal.aborted) set({ run: state }); },
          };
          const final = questionMode
            ? await port.workflow.runQuestionAnalysis(question, { ...options, previous, wantsDashboard: draft.wantsDashboard })
            : await port.workflow.runLockedAnalysis(params, options);
          if (current()) set({ run: controller.signal.aborted ? { ...final, status: "cancelled" } : final });
          else port.releaseRun(final.workflowId);
        } catch (error) {
          if (current()) set({
            run: {
              ...(get().run ?? initial), status: controller.signal.aborted ? "cancelled" : "failed",
              errors: [{ node: "Run", message: String(error).replace(/^Error:\s*/, ""), at: port.now().toISOString() }]
            }
          });
        } finally {
          if (current()) {
            owner = null;
            set({ running: false, stopping: false, abort: null });
          }
        }
      },
      stop() {
        if (disposed || !get().running) return;
        get().abort?.abort();
        set({ stopping: true });
      },
      dispose() {
        disposed = true; owner = null;
        get().abort?.abort();
        const last = get().run;
        set({
          running: false, stopping: false, abort: null, loadingValues: false,
          run: last && last.status === "running" ? { ...last, status: "cancelled" } : last
        });
        if (last) port.releaseRun(last.workflowId);
      },
    };
  });
}
