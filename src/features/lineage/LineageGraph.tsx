import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minimize2, Crosshair } from "lucide-react";
import type { Graph, NodeKind } from "./lineageStore";
import type { HealthState, NodeHealth } from "./opsStore";

const HEALTH_COLOR: Record<HealthState, string | null> = {
  ok: "var(--green)",
  error: "var(--red)",
  running: "var(--accent)",
  warn: "var(--amber)",
  unknown: null,
};

const NODE_W = 156;
const NODE_H = 34;
const COL_W = 216;
const ROW_H = 46;
const KIND_COLOR: Record<NodeKind, string> = {
  workflow: "var(--accent)",
  task: "var(--amber)",
  table: "var(--accent)",
  file: "var(--amber)",
  metric: "var(--green)",
  dataset: "var(--c-dataset, #8b5cf6)",
};

/** 把 `db.table` 拆成「表名 + 小字库名」,和左侧列表里的 NodeLabel 保持一致。
 *  原来整串直接截断,屏幕上全是 `shop_ads.ads_outlet_o…` —— 前缀一样、后缀被切,
 *  等于每个节点都长一个样,看不出是哪张表。 */
function splitName(kind: NodeKind, label: string): [string, string | null] {
  if (kind !== "table") return [label, null];
  const dot = label.indexOf(".");
  return dot < 0 ? [label, null] : [label.slice(dot + 1), label.slice(0, dot)];
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "\u2026" : s);

interface Placed {
  id: string;
  label: string;
  kind: NodeKind;
  x: number;
  y: number;
}

/** Signed-BFS neighborhood layout around a focus node (upstream = left,
 *  downstream = right). Falls back to longest-path depth layering when nothing
 *  is focused. Pure layered layout — no external graph library. */
export function layout(graph: Graph, focusId: string | null, up = 3, down = 3, cap = 80) {
  const level = new Map<string, number>();
  const has = (id: string) => graph.nodes.some((n) => n.id === id);

  if (focusId && has(focusId)) {
    level.set(focusId, 0);
    let frontier = [focusId];
    for (let d = 1; d <= up; d++) {
      const next: string[] = [];
      for (const id of frontier) for (const e of graph.up.get(id) ?? []) if (!level.has(e.from)) { level.set(e.from, -d); next.push(e.from); }
      frontier = next;
    }
    frontier = [focusId];
    for (let d = 1; d <= down; d++) {
      const next: string[] = [];
      for (const id of frontier) for (const e of graph.down.get(id) ?? []) if (!level.has(e.to)) { level.set(e.to, d); next.push(e.to); }
      frontier = next;
    }
  } else {
    // longest upstream chain = column (cycle-guarded, memoized)
    const memo = new Map<string, number>();
    const depth = (id: string, seen: Set<string>): number => {
      if (memo.has(id)) return memo.get(id)!;
      if (seen.has(id)) return 0;
      seen.add(id);
      let best = 0;
      for (const e of graph.up.get(id) ?? []) best = Math.max(best, depth(e.from, seen) + 1);
      seen.delete(id);
      memo.set(id, best);
      return best;
    };
    for (const n of graph.nodes) level.set(n.id, depth(n.id, new Set()));
  }

  /* 超过 cap 就得挑。**不能按撞见的顺序挑** —— 那个顺序是「焦点 → 上游 1/2/3 层
     → 下游 1/2/3 层」,上游节点一多,下游就一个都排不上,而界面上只写着
     「80/340 节点」,看的人会以为那是有代表性的一部分,不会想到"下游是空的"
     是被截出来的。宽表的上游动辄上百张,这事很容易发生。
     改成按离焦点的距离分配:先要焦点,再要距离 1 的(上下游**交替**取),
     然后距离 2、3 —— 少的那一边先取完,多的那一边接着用剩下的名额。
     没有焦点时 level 是依赖深度、没有上下之分,按深度先浅后深即可。 */
  const budgeted = (): string[] => {
    if (!focusId || !level.has(focusId)) {
      return [...level.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id);
    }
    const at = (l: number) => [...level.entries()].filter(([, v]) => v === l).map(([id]) => id);
    const out = [focusId];
    for (let d = 1; d <= Math.max(up, down); d++) {
      const ups = at(-d);
      const downs = at(d);
      for (let i = 0; i < Math.max(ups.length, downs.length); i++) {
        if (i < ups.length) out.push(ups[i]);
        if (i < downs.length) out.push(downs[i]);
      }
    }
    return out;
  };
  const ids = budgeted().slice(0, cap);
  const idset = new Set(ids);
  const byCol = new Map<number, string[]>();
  for (const id of ids) {
    const l = level.get(id)!;
    const col = byCol.get(l); if (col) col.push(id); else byCol.set(l, [id]);
  }
  const cols = [...byCol.keys()].sort((a, b) => a - b);
  const minL = cols[0] ?? 0;

  /* 交叉最小化(重心法):节点在列内的初始顺序就是被 BFS 撞见的顺序,连线因此
     胡乱交叉 —— 这正是"看着乱"的来源。来回扫几遍,每个节点挪到它邻居行号的
     平均位置附近,连线就基本捋直了。经典 Sugiyama 的第二步,几十行就够。 */
  const rowOf = new Map<string, number>();
  for (const l of cols) byCol.get(l)!.forEach((id, i) => rowOf.set(id, i));
  const neighborRows = (id: string, dir: "up" | "down") =>
    (dir === "up" ? graph.up.get(id) ?? [] : graph.down.get(id) ?? [])
      .map((e) => rowOf.get(dir === "up" ? e.from : e.to))
      .filter((r): r is number => r !== undefined);
  for (let pass = 0; pass < 4; pass++) {
    const order = pass % 2 === 0 ? cols : [...cols].reverse();
    const dir = pass % 2 === 0 ? "up" : "down";
    for (const l of order) {
      const ids = byCol.get(l)!;
      const bary = new Map<string, number>();
      ids.forEach((id, i) => {
        const rs = neighborRows(id, dir);
        bary.set(id, rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : i);
      });
      ids.sort((a, b) => bary.get(a)! - bary.get(b)!);
      ids.forEach((id, i) => rowOf.set(id, i));
    }
  }

  const placed = new Map<string, Placed>();
  let maxRows = 0;
  for (const l of cols) {
    const colIds = byCol.get(l)!;
    maxRows = Math.max(maxRows, colIds.length);
    colIds.forEach((id, i) => {
      const node = graph.nodes.find((n) => n.id === id)!;
      placed.set(id, { id, label: node.label, kind: node.kind, x: (l - minL) * COL_W, y: i * ROW_H });
    });
  }
  const edges = graph.edges.filter((e) => idset.has(e.from) && idset.has(e.to));
  const width = (cols.length ? cols.length : 1) * COL_W;
  const height = Math.max(1, maxRows) * ROW_H;
  return { placed, edges, width, height, count: ids.length, total: graph.nodes.length };
}

export default function LineageGraph({
  graph,
  focusId,
  onSelect,
  health,
}: {
  graph: Graph;
  focusId: string | null;
  onSelect: (id: string) => void;
  health?: Record<string, NodeHealth>;
}) {
  const { placed, edges, count, total, width, height } = useMemo(() => layout(graph, focusId), [graph, focusId]);
  const [view, setView] = useState({ x: 24, y: 24, k: 1 });
  const [full, setFull] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  /** 缩放 + 居中到正好装下整张图 —— 免得一进来就看见被截掉的一角。 */
  const fit = useCallback(() => {
    const el = box.current;
    if (!el || !width || !height) return;
    const bw = el.clientWidth - 32;
    const bh = el.clientHeight - 56;
    const k = Math.max(0.3, Math.min(1.2, Math.min(bw / (width + NODE_W), bh / (height + NODE_H))));
    setView({ k, x: Math.max(16, (el.clientWidth - (width + NODE_W) * k) / 2), y: 44 });
  }, [width, height]);

  useLayoutEffect(() => { fit(); }, [fit, full]);

  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setFull(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [full]);

  /* 悬停时把不相干的线和节点压暗 —— 上百条边叠在一起时,这是唯一能看清
     "这个节点到底连了谁"的办法。 */
  const lit = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    for (const e of edges) {
      if (e.from === hover) set.add(e.to);
      if (e.to === hover) set.add(e.from);
    }
    return set;
  }, [hover, edges]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const k = Math.max(0.3, Math.min(2.2, view.k * (e.deltaY < 0 ? 1.1 : 0.9)));
    setView((v) => ({ ...v, k }));
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setView((v) => ({ ...v, x: drag.current!.ox + (e.clientX - drag.current!.sx), y: drag.current!.oy + (e.clientY - drag.current!.sy) }));
  };
  const onUp = () => (drag.current = null);

  const edgePath = (a: Placed, b: Placed) => {
    const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
    const x2 = b.x, y2 = b.y + NODE_H / 2;
    const mx = (x1 + x2) / 2;
    return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
  };

  if (count === 0) {
    return <div className="lin-graph-empty">还没有血缘可画。先在血缘里「扫描 ETL / 视图 / 指标血缘」。</div>;
  }

  return (
    <div
      ref={box}
      className={`lin-graph${full ? " full" : ""}`}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerLeave={() => { onUp(); setHover(null); }}
    >
      <div className="lin-graph-hint">
        {focusId ? "聚焦选中节点的上下游" : "全局(按依赖深度分层)"} · {count}/{total} 节点 · 滚轮缩放 · 拖动平移
      </div>
      <div className="lin-graph-tools">
        <button className="ai-icon xs" title="适应窗口" onClick={fit}><Crosshair size={13} /></button>
        <button className="ai-icon xs" title={full ? "退出全屏(Esc)" : "全屏看图"} onClick={() => setFull((v) => !v)}>
          {full ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>
      <svg className="lin-graph-svg" width="100%" height="100%">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <defs>
            <marker id="lg-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 Z" fill="var(--text-3)" />
            </marker>
          </defs>
          {edges.map((e, i) => {
            const a = placed.get(e.from), b = placed.get(e.to);
            if (!a || !b) return null;
            const on = !lit || (lit.has(e.from) && lit.has(e.to) && (e.from === hover || e.to === hover));
            return <path key={i} d={edgePath(a, b)} className={`lg-edge${on ? "" : " dim"}`} markerEnd="url(#lg-arrow)" />;
          })}
          {[...placed.values()].map((n) => {
            const hs = health?.[n.id]?.state;
            const dot = hs ? HEALTH_COLOR[hs] : null;
            const [name, db] = splitName(n.kind, n.label);
            return (
              <g
                key={n.id}
                transform={`translate(${n.x} ${n.y})`}
                className={`lg-node ${n.id === focusId ? "focus" : ""}${lit && !lit.has(n.id) ? " dim" : ""}`}
                onClick={() => onSelect(n.id)}
                onPointerEnter={() => setHover(n.id)}
              >
                <rect width={NODE_W} height={NODE_H} rx="7" />
                <rect width="4" height={NODE_H} rx="2" fill={KIND_COLOR[n.kind]} />
                <text x="12" y={db ? 15 : NODE_H / 2 + 4}>{clip(name, dot ? 18 : 20)}</text>
                {db && <text x="12" y="26" className="lg-sub">{clip(db, 22)}</text>}
                {dot && <circle cx={NODE_W - 9} cy={9} r={4} fill={dot} className={hs === "running" ? "lg-pulse" : undefined} />}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
