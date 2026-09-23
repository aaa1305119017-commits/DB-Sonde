/**
 * Agent 审计流水 —— 回答「AI 为什么建了这个图」的唯一依据。
 *
 * 现在先落内存 + 可导出;等 Phase 2 有了 workflow 再把它和 checkpoint 一起写盘
 * (走 dashboard_store 那套原子写,和看板文件放一起,排查时能对着看)。
 *
 * 刻意不记模型的完整输出:那会让流水膨胀到没法看。只记够复盘的:
 * 谁、在哪个节点、调了什么、入参摘要、成没成、花了多久、烧了多少 token。
 */

export type AuditKind = "node" | "tool" | "model";

export interface AuditEvent {
  id: number;
  workflowId: string;
  kind: AuditKind;
  /** 节点名 / 工具名 */
  name: string;
  ok: boolean;
  ms: number;
  at: string;
  /** 入参摘要(已截断)。 */
  input?: string;
  /** 出参摘要或错误信息。 */
  detail?: string;
  promptTokens?: number;
  completionTokens?: number;
}

const MAX_EVENTS = 2000;
let seq = 0;
const events: AuditEvent[] = [];
const listeners = new Set<(event: AuditEvent) => void>();

const brief = (value: unknown, cap = 300): string => {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = text ?? "";
  return text.length > cap ? `${text.slice(0, cap)}…(共 ${text.length} 字)` : text;
};

export function record(event: Omit<AuditEvent, "id" | "at">): AuditEvent {
  const full: AuditEvent = { ...event, id: ++seq, at: new Date().toISOString() };
  events.push(full);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  for (const listener of listeners) listener(full);
  return full;
}

/** 记一次工具调用。入参/结果都会截断。 */
export function recordTool(
  workflowId: string,
  name: string,
  input: unknown,
  ok: boolean,
  ms: number,
  detail?: unknown,
): void {
  record({ workflowId, kind: "tool", name, ok, ms, input: brief(input), detail: brief(detail) });
}

export function list(workflowId?: string): AuditEvent[] {
  return workflowId ? events.filter((e) => e.workflowId === workflowId) : [...events];
}

export function subscribe(listener: (event: AuditEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clear(workflowId?: string): void {
  if (!workflowId) {
    events.length = 0;
    return;
  }
  for (let i = events.length - 1; i >= 0; i--) if (events[i].workflowId === workflowId) events.splice(i, 1);
}

/** token 与耗时汇总 —— 给"这次分析花了多少"用。 */
export function usage(workflowId: string): { ms: number; promptTokens: number; completionTokens: number; tools: number } {
  return list(workflowId).reduce(
    (acc, e) => ({
      ms: acc.ms + e.ms,
      promptTokens: acc.promptTokens + (e.promptTokens ?? 0),
      completionTokens: acc.completionTokens + (e.completionTokens ?? 0),
      tools: acc.tools + (e.kind === "tool" ? 1 : 0),
    }),
    { ms: 0, promptTokens: 0, completionTokens: 0, tools: 0 },
  );
}
