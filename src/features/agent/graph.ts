import type { AiConfig } from "../ai/aiTypes";
import type { AuditEvent } from "./audit";
import type { AgentState } from "./state";

/** Bounded state graph. Nodes, clock and audit are supplied by the host. */
export interface GraphRuntime {
  now?: () => number;
  record?: (event: Omit<AuditEvent, "id" | "at">) => void;
}

export const END = "__end__";

export type NodeFn = (state: AgentState, context?: { signal?: AbortSignal; modelConfig?: AiConfig }) => Promise<Partial<AgentState>> | Partial<AgentState>;
/** 返回下一个节点名,或 END。 */
export type Router = (state: AgentState) => string;

interface NodeEntry {
  name: string;
  fn: NodeFn;
  /** 这个节点最多重试几次(被别的节点回退到它时计数)。 */
  maxRetry: number;
}

export interface RunOptions {
  /** 全局节点执行上限,防止边配错成环。 */
  maxSteps?: number;
  /** 节点**开始前**和**跑完后**各回调一次 —— UI 的时间线靠它。
   *  只在跑完时回调会让界面慢一拍,把等待算到上一步头上。 */
  onStep?: (state: AgentState) => void;
  /** 每个节点后落一次 checkpoint。 */
  onCheckpoint?: (state: AgentState) => void | Promise<void>;
  modelConfig?: AiConfig;
  signal?: AbortSignal;
}

export class Graph {
  private nodes = new Map<string, NodeEntry>();
  private edges = new Map<string, Router>();
  private entry = "";
  private targets = new Map<string, string>();
  private now: () => number;
  constructor(private readonly runtime: GraphRuntime = {}) { this.now = runtime.now ?? Date.now; }

  addNode(name: string, fn: NodeFn, options: { maxRetry?: number } = {}): this {
    if (!Number.isInteger(options.maxRetry ?? 2) || (options.maxRetry ?? 2) < 0) throw new Error("节点重试上限必须是非负整数");
    if (this.nodes.has(name)) throw new Error(`节点重名:${name}`);
    this.nodes.set(name, { name, fn, maxRetry: options.maxRetry ?? 2 });
    return this;
  }

  setEntry(name: string): this {
    this.entry = name;
    return this;
  }

  addEdge(from: string, to: string): this {
    this.addConditionalEdge(from, () => to);
    this.targets.set(from, to);
    return this;
  }

  /** 条件边:由 state 决定下一站。回退边就是它指回上游节点。 */
  addConditionalEdge(from: string, router: Router): this {
    this.targets.delete(from);
    this.edges.set(from, router);
    return this;
  }

  /** 图本身是否自洽 —— 边指向不存在的节点这种错,应该在跑之前就发现。 */
  validate(): string[] {
    const problems: string[] = [];
    if (!this.entry) problems.push("没有设置入口节点");
    else if (!this.nodes.has(this.entry)) problems.push(`入口节点 ${this.entry} 不存在`);
    for (const name of this.nodes.keys()) {
      if (!this.edges.has(name)) problems.push(`节点 ${name} 没有出边,走到这里就断了`);
    }
    for (const from of this.edges.keys()) if (!this.nodes.has(from)) problems.push(`边的起点 ${from} 不存在`);
    for (const to of this.targets.values()) if (to !== END && !this.nodes.has(to)) problems.push(`边的目标 ${to} 不存在`);
    return problems;
  }

  async run(initial: AgentState, options: RunOptions = {}): Promise<AgentState> {
    const problems = this.validate();
    if (problems.length) throw new Error(`图配置有问题:${problems.join(";")}`);

    const maxSteps = options.maxSteps ?? 30;
    if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new Error("执行步数上限必须是正整数");
    let state: AgentState = { ...initial };
    let current = this.entry;
    let steps = 0;
    /* retry[X] 的含义是「回退到 X 多少次」,不是「X 被执行多少次」。
       所以只在走到**已经跑过**的节点时才计数 —— 直线往前走的节点不该被算成重试,
       否则一条长链路走到后面就会被 maxRetry 误杀。 */
    const visited = new Set<string>();

    while (current !== END) {
      if (options.signal?.aborted) {
        return { ...state, status: "cancelled", currentNode: current };
      }
      if (++steps > maxSteps) {
        // 到这一步说明边配出环了。如实失败,不要假装跑完。
        return {
          ...state,
          status: "failed",
          errors: [...state.errors, { node: current, message: `执行步数超过上限 ${maxSteps},图里可能有环`, at: new Date(this.now()).toISOString() }],
        };
      }

      const entry = this.nodes.get(current);
      if (!entry) {
        return {
          ...state,
          status: "failed",
          errors: [...state.errors, { node: current, message: `边指向了不存在的节点 ${current}`, at: new Date(this.now()).toISOString() }],
        };
      }

      // 回退次数用尽 → 如实失败,不要降低标准放行
      const used = state.retry[current] ?? 0;
      if (used > entry.maxRetry) {
        return {
          ...state,
          status: "failed",
          errors: [...state.errors, { node: current, message: `${current} 重试 ${used} 次仍未通过(上限 ${entry.maxRetry})`, at: new Date(this.now()).toISOString() }],
        };
      }

      const started = this.now();
      state = { ...state, currentNode: current, trace: [...state.trace, current], nodeStartedAt: started };
      /* 进节点**之前**先报一次 —— 否则界面永远慢一拍:
         onStep 只在节点跑完时调,于是 QueryPlanner 在等云模型的那几十秒里,
         界面显示的还是上一步 MetricValidator 在转圈。真机上看着就是「卡在核对指标中心」,
         其实核对早就过了,卡的是下一步。转圈的那个必须是真正在跑的那个。 */
      options.onStep?.(state);
      if (options.signal?.aborted) return { ...state, status: "cancelled" };
      try {
        const patch = await entry.fn(state, { signal: options.signal, modelConfig: options.modelConfig });
        if (options.signal?.aborted) return { ...state, ...(patch.dashboardId ? { dashboardId: patch.dashboardId } : {}), status: "cancelled" };
        state = { ...state, ...patch };
        this.runtime.record?.({ workflowId: state.workflowId, kind: "node", name: current, ok: true, ms: this.now() - started });
      } catch (error) {
        if (options.signal?.aborted) return { ...state, status: "cancelled" };
        const message = String(error).replace(/^Error:\s*/, "");
        this.runtime.record?.({ workflowId: state.workflowId, kind: "node", name: current, ok: false, ms: this.now() - started, detail: message });
        return {
          ...state,
          status: "failed",
          errors: [...state.errors, { node: current, message, at: new Date(this.now()).toISOString() }],
        };
      }

      options.onStep?.(state);
      await options.onCheckpoint?.(state);
      if (options.signal?.aborted) return { ...state, status: "cancelled" };

      if (state.status === "failed" || state.status === "cancelled" || state.status === "needs_input") return state;

      visited.add(current);
      const next = this.edges.get(current)!(state);
      if (next !== END && visited.has(next)) {
        state = { ...state, retry: { ...state.retry, [next]: (state.retry[next] ?? 0) + 1 } };
      }
      current = next;
    }

    return { ...state, status: state.status === "running" ? "done" : state.status, currentNode: END };
  }
}


/** 回退边的通用写法:还能重试就回上游,否则去 fallback(通常是 END 或失败处理)。 */
export function retryOr(state: AgentState, target: string, limit: number, fallback: string): string {
  return (state.retry[target] ?? 0) < limit ? target : fallback;
}
