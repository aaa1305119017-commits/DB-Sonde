/**
 * 一个「字段区」:行维度 / 列维度 / 度量 各是一个。
 *
 * 加字段原来是个下拉,选一个加一个 —— 十个度量就得点开十次,每次还要在四十多个字段里
 * 重新找位置。这里一次点开勾完,带搜索。
 *
 * 顺序有意义(维度是分层,第一层在最上面),所以列表能上下调,不是随便排的。
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronUp, Plus, Search, X } from "lucide-react";
import { usePopover, useDismiss } from "./usePopover";

export interface WellField {
  name: string;
  label: string;
  /** 已经被别的区用掉了(比如放进了列),这里就不该再列出来。 */
  taken?: boolean;
}

export default function FieldWell({ title, hint, picked, available, onChange, renderControl, emptyText, badgeOf }: {
  title: string;
  hint?: string;
  /** 已选字段名,按顺序。 */
  picked: string[];
  available: WellField[];
  onChange: (next: string[]) => void;
  /** 每一项右侧的控件(粒度、汇总方式…)。 */
  renderControl?: (name: string) => React.ReactNode;
  emptyText: string;
  /** 每一项左侧的小标(第 1 层这种)。 */
  badgeOf?: (name: string, index: number) => string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { position, anchorRef, popoverRef } = usePopover(open, 230, 320);
  useDismiss(open, [anchorRef, popoverRef], () => setOpen(false));

  const labelOf = (name: string) => available.find((f) => f.name === name)?.label ?? name;
  const needle = query.trim().toLowerCase();
  const selectable = available.filter((f) => !f.taken || picked.includes(f.name));
  const filtered = needle ? selectable.filter((f) => f.label.toLowerCase().includes(needle) || f.name.toLowerCase().includes(needle)) : selectable;

  const toggle = (name: string) =>
    onChange(picked.includes(name) ? picked.filter((n) => n !== name) : [...picked, name]);
  const move = (index: number, by: number) => {
    const next = [...picked];
    const to = index + by;
    if (to < 0 || to >= next.length) return;
    [next[index], next[to]] = [next[to], next[index]];
    onChange(next);
  };

  return (
    <section className="dash-well">
      <div className="dash-well-head">
        <strong>{title}</strong>
        <div ref={anchorRef} className="dash-well-add">
          <button type="button" className={open ? "on" : ""} aria-label={`添加${title}`} aria-expanded={open}
            onClick={() => setOpen((v) => !v)}>
            <Plus size={12} />添加
          </button>
        </div>
      </div>
      {hint && <p className="dash-well-hint">{hint}</p>}

      {picked.length === 0 ? (
        <p className="dash-well-empty">{emptyText}</p>
      ) : (
        <ul className="dash-well-list">
          {picked.map((name, index) => (
            <li key={name}>
              <span className="dash-well-name" title={name}>{labelOf(name)}</span>
              {badgeOf?.(name, index) && <span className="dash-well-badge">{badgeOf(name, index)}</span>}
              {renderControl?.(name)}
              {picked.length > 1 && (
                <span className="dash-well-order">
                  <button type="button" aria-label="上移" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp size={11} /></button>
                  <button type="button" aria-label="下移" disabled={index === picked.length - 1} onClick={() => move(index, 1)}><ChevronDown size={11} /></button>
                </span>
              )}
              <button type="button" className="dash-well-x" aria-label={`移除 ${labelOf(name)}`} onClick={() => toggle(name)}><X size={11} /></button>
            </li>
          ))}
        </ul>
      )}

      {open && createPortal(
        <div ref={popoverRef} className="dash-picker-menu" style={position}>
          <label className="dash-picker-search">
            <Search size={13} />
            <input autoFocus placeholder={`搜索${title}`} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="dash-picker-options">
            {filtered.length === 0 && <div className="dash-picker-empty">没有可选的字段</div>}
            {filtered.map((field) => {
              const on = picked.includes(field.name);
              return (
                <button type="button" key={field.name} className={on ? "selected" : ""} onClick={() => toggle(field.name)}>
                  <span className="dash-picker-label">{field.label}{field.label !== field.name && <small>{field.name}</small>}</span>
                  {on && <Check size={13} />}
                </button>
              );
            })}
          </div>
          <div className="dash-picker-foot">勾选即可加入,可以一次勾多个</div>
        </div>,
        document.body,
      )}
    </section>
  );
}
