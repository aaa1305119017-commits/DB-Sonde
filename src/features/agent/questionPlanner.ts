import { useMetrics } from "../metrics/metricsStore";
import { callStructured } from "./model/structured";
import { fastDimensionValues } from "./tools/dimensionProbe";
import { createQuestionPlanner } from "./questionPlanning";
import { validatedMetricsFor as fromCatalog } from "./analysisCatalog";
export { questionRange, requestedGroupCounts } from "./questionPlanning";
export type { QuestionPlan } from "./questionPlanning";
export const validatedMetricsFor = (ids: string[], all = useMetrics.getState().metrics) => fromCatalog(ids, all);
/** Production adapters; the planner itself does not load stores or query transport. */
export const questionPlanner = createQuestionPlanner({
  readCatalog: () => useMetrics.getState().metrics,
  callStructured, dimensionValues: fastDimensionValues
});
