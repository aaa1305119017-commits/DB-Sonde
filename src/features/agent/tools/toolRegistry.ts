import { validate, type JsonSchema } from "../jsonSchema";
import { ToolFailure, type ToolResult } from "./toolTypes";
export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  /** 给 LLM 看的一句话:这个工具回答什么问题。 */
  description: string;
  schema: JsonSchema;
  /** false 的工具会改状态(建看板/改组件),编排层据此决定要不要人工确认。 */
  readOnly: boolean;
  run(input: I): Promise<O> | O;
}

export interface ToolRegistryPorts {
  now?: () => number;
  recordTool?: (workflowId: string, name: string, input: unknown, ok: boolean, ms: number, output: unknown) => void;
}
export function createToolRegistry({ now = Date.now, recordTool }: ToolRegistryPorts = {}) {
  const registry = new Map<string, ToolDef>();

  function registerTool<I, O>(def: ToolDef<I, O>): ToolDef<I, O> {
    if (registry.has(def.name)) throw new Error(`工具重名:${def.name}`);
    registry.set(def.name, def as ToolDef);
    return def;
  }

  function listTools(): ToolDef[] {
    return [...registry.values()];
  }

  function getTool(name: string): ToolDef | undefined {
    return registry.get(name);
  }

  /** 只在测试里用:清掉注册表好重新注册。 */
  function resetTools(): void {
    registry.clear();
  }

  /**
   * 调一个工具:校验入参 → 执行 → 规范化错误 → 记审计。
   *
   * 入参校验放在这里而不是各工具内部,是为了保证**每个工具的错误格式一致** ——
   * 编排层和模型只需要认一种形状。
   */
  async function callTool<T = unknown>(
    name: string,
    input: unknown,
    workflowId = "adhoc",
  ): Promise<ToolResult<T>> {
    const started = now();
    const finish = (result: Omit<ToolResult<T>, "audit">): ToolResult<T> => {
      const ms = now() - started;
      recordTool?.(workflowId, name, input, result.ok, ms, result.ok ? result.data : result.error);
      return { ...result, audit: { tool: name, ms } };
    };

    const tool = registry.get(name);
    if (!tool) {
      return finish({
        ok: false,
        error: { code: "NOT_FOUND", message: `没有叫 ${name} 的工具。可用:${[...registry.keys()].join("、")}` },
      });
    }

    const errors = validate(input, tool.schema);
    if (errors.length) {
      return finish({
        ok: false,
        error: { code: "INVALID_ARGS", message: `${name} 的入参不对:\n${errors.map((e) => `  - ${e}`).join("\n")}`, details: errors },
      });
    }

    try {
      const data = (await tool.run(input)) as T;
      return finish({ ok: true, data });
    } catch (error) {
      if (error instanceof ToolFailure) {
        return finish({ ok: false, error: { code: error.code, message: error.message, details: error.details } });
      }
      return finish({
        ok: false,
        error: { code: "BACKEND_ERROR", message: String(error).replace(/^Error:\s*/, "") },
      });
    }
  }

  /** 工具清单的紧凑描述,拼进 prompt 用。 */
  function toolCatalog(): string {
    return listTools()
      .map((t) => `- ${t.name}${t.readOnly ? "" : "(会改状态)"}:${t.description}`)
      .join("\n");
  }

  return { registerTool, listTools, getTool, resetTools, callTool, toolCatalog };
}
