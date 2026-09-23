import { recordTool } from "../audit";
import { createToolRegistry } from "./toolRegistry";
export { ToolFailure, fail } from "./toolTypes";
export type { ToolErrorCode, ToolError, ToolResult } from "./toolTypes";
export type { ToolDef } from "./toolRegistry";
export const { registerTool, listTools, getTool, resetTools, callTool, toolCatalog } = createToolRegistry({ recordTool });
