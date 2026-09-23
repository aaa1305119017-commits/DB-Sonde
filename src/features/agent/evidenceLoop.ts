import { callStructured } from "./model/structured";
import { useMetrics } from "../metrics/metricsStore";
import { callTool } from "./tools/registry";
import { getPlan } from "./tools/dataTools";
import { createEvidenceExplorer, createConclusionReviewer } from "./evidenceExploration";
export { pendingCoverage } from "./evidenceExploration";

const ports = { readCatalog: () => useMetrics.getState().metrics, callStructured, callTool, getPlan };
export const evidenceExplorer = createEvidenceExplorer(ports);
export const conclusionReviewer = createConclusionReviewer(ports);
