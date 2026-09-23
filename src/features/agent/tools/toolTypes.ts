export type ToolErrorCode =
  | "INVALID_ARGS"
  | "NOT_FOUND"
  | "UNSUPPORTED"
  | "MISSING_METRIC"
  /** 数据集不存在,或引用了它没有的字段/用错了字段角色。 */
  | "MISSING_DATASET"
  | "MISSING_FIELD"
  | "WRONG_FIELD_ROLE"
  | "AMBIGUOUS"
  | "BACKEND_ERROR";

export interface ToolError {
  code: ToolErrorCode;
  /** 给模型看的一句话:说清哪里不对、该怎么改。 */
  message: string;
  details?: unknown;
}

export interface ToolResult<T> {
  ok: boolean;
  data?: T;
  error?: ToolError;
  audit: { tool: string; ms: number; };
}

/** 工具内部用它抛出结构化错误,由 callTool 统一转成 ToolResult。 */
export class ToolFailure extends Error {
  constructor(readonly code: ToolErrorCode, message: string, readonly details?: unknown) {
    super(message);
    this.name = "ToolFailure";
  }
}

export const fail = (code: ToolErrorCode, message: string, details?: unknown): never => {
  throw new ToolFailure(code, message, details);
};
