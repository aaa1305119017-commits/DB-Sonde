/**
 * 单选下拉。用来替掉原生 <select>。
 *
 * 原生 select 在 macOS 上弹的是系统菜单:它会盖在控件自己身上,配色也跟应用没关系
 * —— 一片深色面板里突然冒出来一块系统灰,选项还带个系统勾。挨着的几个控件明明是
 * 一组,弹出来却各弹各的位置。自己画就跟面板是一套东西,而且能带搜索。
 */
import { createPortal } from "react-dom";
import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { usePopover, useDismiss } from "./usePopover";

export interface PickerOption {
  value: string;
  label: string;
  /** 分组标题,连着相同的归一组。 */
  group?: string;
  hint?: string;
}

export default function Picker({ value, options, onChange, placeholder = "选择…", ariaLabel, searchable, disabled, compact, icon }: {
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel: string;
  /** 选项多的时候给个搜索框。不传则超过 12 项自动给。 */
  searchable?: boolean;
  disabled?: boolean;
  /** 行内用的小号样式(汇总方式、粒度这种)。 */
  compact?: boolean;
  /** 只画一个图标当触发器。排序这种每行都挂一个的,摊开写成下拉会把字段名挤没,
   *  而且十二行都写着「不排」纯属噪音 —— 生效的那一两行用颜色和箭头说话就够了。
   *  菜单里仍然是完整的文字选项,不靠猜。 */
  icon?: (value: string) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { position, anchorRef, popoverRef } = usePopover(open, compact ? 150 : 200);
  useDismiss(open, [anchorRef, popoverRef], () => setOpen(false));

  const current = options.find((option) => option.value === value);
  const withSearch = searchable ?? options.length > 12;
  const needle = query.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  const pick = (next: string) => { onChange(next); setOpen(false); setQuery(""); };

  return (
    <div ref={anchorRef} className={`dash-picker ${compact ? "compact" : ""} ${open ? "open" : ""} ${disabled ? "disabled" : ""}`}>
      <button type="button" className={icon ? "dash-picker-icon" : "dash-picker-trigger"}
        aria-label={ariaLabel} aria-expanded={open} disabled={disabled}
        title={icon ? `${ariaLabel}:${current?.label ?? placeholder}` : undefined}
        onClick={() => { if (!disabled) setOpen((v) => !v); }}>
        {icon ? icon(value) : (
          <>
            <span className={current ? "" : "placeholder"}>{current?.label ?? placeholder}</span>
            <ChevronDown size={13} />
          </>
        )}
      </button>
      {open && createPortal(
        <div ref={popoverRef} className="dash-picker-menu" style={position}>
          {withSearch && (
            <label className="dash-picker-search">
              <Search size={13} />
              <input autoFocus placeholder="搜索" value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
          )}
          <div className="dash-picker-options">
            {filtered.length === 0 && <div className="dash-picker-empty">没有匹配的</div>}
            {filtered.map((option, index) => (
              <div key={option.value}>
                {option.group && option.group !== filtered[index - 1]?.group && (
                  <div className="dash-picker-group">{option.group}</div>
                )}
                <button type="button" className={option.value === value ? "selected" : ""} onClick={() => pick(option.value)}>
                  <span className="dash-picker-label">{option.label}{option.hint && <small>{option.hint}</small>}</span>
                  {option.value === value && <Check size={13} />}
                </button>
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
