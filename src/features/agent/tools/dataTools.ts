import { nanoid } from "nanoid";
import { useMetrics } from "../../metrics/metricsStore";
import { executeDataset } from "../../dashboard/query";
import { fastDimensionValues } from "./dimensionProbe";
import { registerTool } from "./registry";
import { createDataToolRuntime } from "./dataToolRuntime";
import { localDay } from "../../../lib/dates";
export type { BuildPlanInput } from "../queryPlanModel";

/** Compatibility adapter for tools used outside an analysis workflow. */
const runtime = createDataToolRuntime({
  readCatalog: () => useMetrics.getState().metrics,
  nextId: () => `plan-${nanoid(8)}`, today: () => localDay(), executeDataset, fastDimensionValues
});
for (const tool of runtime.tools) registerTool(tool);
export const { getPlan, buildQueryPlan, diagnoseEmpty, resetPlans, buildQueryPlanTool,
  executeQueryPlanTool, validateDatasetTool, dimensionValuesTool, diagnoseEmptyTool } = runtime;
