import { useAi } from "../ai/aiStore";
import { useMetrics } from "../metrics/metricsStore";
import { runLockedAnalysis, runQuestionAnalysis } from "./workflow";
import { clearDesignSession } from "./designLoop";
import { createState } from "./state";
import { createAnalysisRepository } from "./analysisRepository";
import { createAnalysisStore } from "./analysisRuntime";
export type { AnalysisDraft } from "./analysisTypes";
export type { AnalysisState } from "./analysisRuntime";

/** Production wiring. Drafts persist; results and running tasks belong to this workspace. */
export const useAnalysis = createAnalysisStore({
  repository: createAnalysisRepository(), metrics: () => useMetrics.getState().metrics,
  modelConfig: () => useAi.getState().config, workflow: { runLockedAnalysis, runQuestionAnalysis },
  createState, now: () => new Date(), releaseRun: clearDesignSession,
});
