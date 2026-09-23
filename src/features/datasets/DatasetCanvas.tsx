/**
 * 关联建模画布。
 *
 * 表是画布上的胶囊,拖着摆;两张表之间拉一条曲线,曲线中间挂着关联条件 —— 点它就能改
 * 用哪两列连、左连接还是内连接。
 *
 * 拖拽走鼠标事件而不是 HTML5 drag:后者在 Tauri 里被窗口的文件拖放处理器吞掉过
 * (见 tauri.conf 的 dragDropEnabled),而且鼠标事件才能做出跟手的手感和落点吸附。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Table2, X } from "lucide-react";
import { JOIN_OPS, type DatasetJoinCond, type DatasetJoinNode, type DatasetJoinOp, type DatasetSourceJoin } from "./domain";

const NODE_W = 236;
const NODE_H = 64;
const GAP_X = 300;

export interface CanvasTable {
  alias: string;
  table: string;
  comment?: string;
  columns: number;
  kept: number;
  isBase: boolean;
  join?: DatasetJoinNode;
}

/** 没拖过的节点从左往右排:关联读起来是「主表 → 关联表」,横着摆跟这个顺序一致,
 *  表名长也不会互相挤。隔一个错半行,连线不会叠在一起。 */
function defaultPos(index: number) {
  return { x: 24 + index * GAP_X, y: 40 + (index % 2) * 86 };
}

export default function DatasetCanvas({
  source, tables, columnsOf, selected, onSelect, onChange, onRemove,
}: {
  source: DatasetSourceJoin;
  tables: CanvasTable[];
  columnsOf: (table: string) => string[];
  selected?: string;
  onSelect: (alias: string | undefined) => void;
  onChange: (next: DatasetSourceJoin) => void;
  onRemove: (id: string) => void;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ alias: string; dx: number; dy: number } | null>(null);
  const [editing, setEditing] = useState<string | undefined>();

  const posOf = (t: CanvasTable, index: number) =>
    (t.isBase ? source.base.pos : t.join?.pos) ?? defaultPos(index);

  const move = useCallback((alias: string, pos: { x: number; y: number }) => {
    if (alias === source.base.alias) onChange({ ...source, base: { ...source.base, pos } });
    else onChange({ ...source, joins: source.joins.map((j) => (j.alias === alias ? { ...j, pos } : j)) });
  }, [source, onChange]);

  useEffect(() => {
    if (!drag) return;
    const onMove = (event: MouseEvent) => {
      const board = boardRef.current?.getBoundingClientRect();
      if (!board) return;
      move(drag.alias, {
        x: Math.max(8, event.clientX - board.left - drag.dx),
        y: Math.max(8, event.clientY - board.top - drag.dy),
      });
    };
    const onUp = () => setDrag(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, move]);

  const byAlias = new Map(tables.map((t, i) => [t.alias, { ...t, pos: posOf(t, i) }]));
  const height = Math.max(300, ...[...byAlias.values()].map((t) => t.pos.y + NODE_H + 40));
  const width = Math.max(0, ...[...byAlias.values()].map((t) => t.pos.x + NODE_W + 60));

  return (
    <div className="dc-board" ref={boardRef} style={{ height, minWidth: width }} onMouseDown={() => { onSelect(undefined); setEditing(undefined); }}>
      <svg className="dc-wires">
        <defs>
          <linearGradient id="dc-wire" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--c-table, #4d8dff)" stopOpacity=".65" />
            <stop offset="100%" stopColor="var(--c-table, #4d8dff)" stopOpacity=".28" />
          </linearGradient>
        </defs>
        {source.joins.map((join) => {
          const from = byAlias.get(join.on[0]?.targetAlias ?? source.base.alias);
          const to = byAlias.get(join.alias);
          if (!from || !to) return null;
          const leftFirst = from.pos.x <= to.pos.x;
          const x1 = leftFirst ? from.pos.x + NODE_W : from.pos.x;
          const x2 = leftFirst ? to.pos.x : to.pos.x + NODE_W;
          const y1 = from.pos.y + NODE_H / 2, y2 = to.pos.y + NODE_H / 2;
          const mid = (x1 + x2) / 2;
          return (
            <path key={join.id} className="dc-wire"
              d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`} />
          );
        })}
      </svg>

      {tables.map((t, index) => {
        const pos = posOf(t, index);
        const on = selected === t.alias;
        return (
          <div key={t.alias}
            className={`dc-node ${on ? "on" : ""} ${t.table ? "" : "empty"} ${drag?.alias === t.alias ? "dragging" : ""}`}
            style={{ left: pos.x, top: pos.y, width: NODE_W }}
            onMouseDown={(event) => {
              event.stopPropagation();
              onSelect(t.alias);
              const board = boardRef.current?.getBoundingClientRect();
              if (!board) return;
              setDrag({ alias: t.alias, dx: event.clientX - board.left - pos.x, dy: event.clientY - board.top - pos.y });
            }}
          >
            <span className="dc-node-icon"><Table2 size={14} /></span>
            <span className="dc-node-body">
              <span className="dc-node-name">{t.table || "选一张表"}</span>
              <span className="dc-node-meta">
                {t.comment ? <em>{t.comment}</em> : <code>{t.alias}</code>}
                {t.columns > 0 && <span>{t.kept}/{t.columns} 列</span>}
              </span>
            </span>
            {t.isBase && <span className="dc-node-tag">主表</span>}
            {!t.isBase && t.join && (
              <button className="dc-node-x" title="移出画布"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => onRemove(t.join!.id)}><X size={12} /></button>
            )}
          </div>
        );
      })}

      {/* 关联条件挂在连线中点 */}
      {source.joins.map((join) => {
        const from = byAlias.get(join.on[0]?.targetAlias ?? source.base.alias);
        const to = byAlias.get(join.alias);
        if (!from || !to) return null;
        const cx = (from.pos.x + to.pos.x) / 2 + NODE_W / 2;
        const cy = (from.pos.y + NODE_H + to.pos.y) / 2;
        const cond = join.on[0] ?? { field: "", targetAlias: source.base.alias, targetField: "" };
        const open = editing === join.id;
        const done = cond.field && cond.targetField;
        const setOn = (index: number, patch: Partial<DatasetJoinCond>) => onChange({
          ...source,
          joins: source.joins.map((j) => (j.id === join.id
            ? { ...j, on: j.on.map((c, k) => (k === index ? { ...c, ...patch } : c)) }
            : j)),
        });
        return (
          <div key={`c-${join.id}`} className={`dc-cond ${open ? "open" : ""} ${done ? "" : "todo"}`}
            style={{ left: cx, top: cy }}
            onMouseDown={(event) => event.stopPropagation()}>
            <button className="dc-cond-chip" onClick={() => setEditing(open ? undefined : join.id)}>
              <Link2 size={11} />
              {join.kind === "left" ? "左连接" : "内连接"}
              {done
                ? <em>{cond.targetField} {cond.op ?? "="} {cond.field}{join.on.length > 1 ? ` +${join.on.length - 1}` : ""}</em>
                : <em className="todo">待设置</em>}
            </button>
            {open && (
              <div className="dc-cond-panel">
                <label className="dc-cond-kind">连接方式
                  <select value={join.kind}
                    onChange={(e) => onChange({ ...source, joins: source.joins.map((j) => j.id === join.id ? { ...j, kind: e.target.value as DatasetJoinNode["kind"] } : j) })}>
                    <option value="left">左连接</option>
                    <option value="inner">内连接</option>
                  </select>
                </label>

                {join.on.map((c, i) => (
                  <div className="dc-cond-row" key={i}>
                    {i > 0 && (
                      <select className="dc-cond-join" value={c.connector ?? "and"}
                        onChange={(e) => setOn(i, { connector: e.target.value as "and" | "or" })}>
                        <option value="and">且</option>
                        <option value="or">或</option>
                      </select>
                    )}
                    <div className="dc-cond-expr">
                      <select value={c.targetField} onChange={(e) => setOn(i, { targetField: e.target.value })}>
                        <option value="">{from.table || from.alias} 的字段…</option>
                        {columnsOf(from.table).map((col) => <option key={col} value={col}>{col}</option>)}
                      </select>
                      <select className="dc-cond-op" value={c.op ?? "="} onChange={(e) => setOn(i, { op: e.target.value as DatasetJoinOp })}>
                        {JOIN_OPS.map((op) => <option key={op} value={op}>{op}</option>)}
                      </select>
                      <select value={c.field} onChange={(e) => setOn(i, { field: e.target.value })}>
                        <option value="">{to.table || to.alias} 的字段…</option>
                        {columnsOf(to.table).map((col) => <option key={col} value={col}>{col}</option>)}
                      </select>
                      {join.on.length > 1 && (
                        <button className="dc-cond-del" title="删掉这个条件"
                          onClick={() => onChange({ ...source, joins: source.joins.map((j) => j.id === join.id ? { ...j, on: j.on.filter((_, k) => k !== i) } : j) })}>
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                <button className="dc-cond-add"
                  onClick={() => onChange({
                    ...source,
                    joins: source.joins.map((j) => j.id === join.id
                      ? { ...j, on: [...j.on, { field: "", op: "=" as DatasetJoinOp, targetAlias: cond.targetAlias, targetField: "", connector: "and" as const }] }
                      : j),
                  })}>＋ 加一个条件</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
