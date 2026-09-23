/** Production composition. Node implementations receive explicit capabilities. */
import { discardDraft } from "../tools/dashboardTools";
import { callStructured, providerFor, bindingFor } from "../model/structured";
import { callTool } from "../tools/registry";
import { getPlan } from "../tools/dataTools";
import { dimensionLabel } from "../dimensions";
import { createDataNodes } from "./dataNodes";
import { createAnalysisNode } from "./analysisNode";
import { createLayoutDesigner } from "./layoutDesigner";
import { createDashboardReviewer } from "./dashboardReviewer";
import { createDashboardCompiler } from "./dashboardCompiler";

export { LAYOUT_SCHEMA, VISUAL_PRESETS } from "./layoutDesigner";
export type { LockedParams } from "../analysisTypes";
export const { dataExecutor, dataValidator, lockedPlanner } = createDataNodes({ callTool, getPlan, dimensionLabel });
export const analysisAgent = createAnalysisNode({ callStructured, getPlan, dimensionLabel });
export const { layoutDesigner, designDataViews } = createLayoutDesigner({ callStructured, getPlan });
export const dashboardReviewer = createDashboardReviewer({ callStructured, getPlan });
export const { compileDashboard, dashboardExecutor } = createDashboardCompiler({
  callTool, getPlan, discardDraft,
  describeModel: config => `${providerFor("design", config)} · ${bindingFor("design", config).model}`,
});
