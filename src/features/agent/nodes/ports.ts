import type { AiConfig } from "../../ai/aiTypes";
import type { StructuredCall, StructuredResult } from "../model/structured";
import type { ToolResult } from "../tools/toolTypes";

/** Adapters retain transport, schema validation and auditing responsibilities. */
export type StructuredCaller = <T>(call: StructuredCall, config?: AiConfig) => Promise<StructuredResult<T>>;
export type ToolCaller = <T = unknown>(name: string, input: unknown, workflowId: string) => Promise<ToolResult<T>>;
