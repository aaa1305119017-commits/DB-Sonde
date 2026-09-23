import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";

interface Props {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}

type Mode = "day" | "week" | "month" | "year";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y || 2000, (m || 1) - 1, d || 1); };
const startOfToday = () => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); };
const addDays = (base: Date, n: number) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
const monthEnd = (y: number, m: number) => new Date(y, m + 1, 0);
const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const MONTHS = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];

function presets(): { label: string; range: () => [string, string] }[] {
  const t = startOfToday();
  return [
    { label: "今天", range: () => [ymd(t), ymd(t)] },
    { label: "昨天", range: () => { const y = addDays(t, -1); return [ymd(y), ymd(y)]; } },
    { label: "近 7 天", range: () => [ymd(addDays(t, -6)), ymd(t)] },
    { label: "近 30 天", range: () => [ymd(addDays(t, -29)), ymd(t)] },
    { label: "本月", range: () => [ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)] },
    { label: "上月", range: () => [ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(monthEnd(t.getFullYear(), t.getMonth() - 1))] },
    { label: "今年", range: () => [ymd(new Date(t.getFullYear(), 0, 1)), ymd(t)] },
    { label: "去年", range: () => [ymd(new Date(t.getFullYear() - 1, 0, 1)), ymd(new Date(t.getFullYear() - 1, 11, 31))] },
  ];
}

/**
 * 日期区间选择器 —— 单控件 + 弹层。四种粒度(日/周/月/年)都支持"点起点 → 点终点"选一段区间
 * (如 1 月–8 月、2021–2026 年)。portal 到 body(fixed + translateZ)避免被父容器滚动条穿透。
 */
export default function DateRangePicker({ start, end, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("day");
  const [pending, setPending] = useState<string | null>(null); // 已点起点、待点终点(代表日:日/周=当天,月=月首,年=年首)
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(() => parse(end || start));
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const width = 540;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) });
  };
  const openPop = () => { place(); const d = parse(end || start); setView(new Date(d.getFullYear(), d.getMonth(), 1)); setPending(null); setMode("day"); setOpen(true); };
  const close = () => { setOpen(false); setPending(null); };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as Node; if (!triggerRef.current?.contains(t) && !popRef.current?.contains(t)) close(); };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => { document.removeEventListener("mousedown", onDoc); window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);

  const cells = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const gridStart = new Date(view.getFullYear(), view.getMonth(), 1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  }, [view]);

  const activePreset = presets().find((p) => { const [s, e] = p.range(); return s === start && e === end; });
  const todayStr = ymd(startOfToday());
  const yearBase = Math.floor(view.getFullYear() / 12) * 12;

  // 把两个"代表日"按当前粒度展开成完整区间。
  const expand = (a: string, b: string): [string, string] => {
    const [lo, hi] = [a, b].sort();
    const s = parse(lo), e = parse(hi);
    if (mode === "week") return [ymd(addDays(s, -s.getDay())), ymd(addDays(addDays(e, -e.getDay()), 6))];
    if (mode === "month") return [ymd(new Date(s.getFullYear(), s.getMonth(), 1)), ymd(monthEnd(e.getFullYear(), e.getMonth()))];
    if (mode === "year") return [`${s.getFullYear()}-01-01`, `${e.getFullYear()}-12-31`];
    return [lo, hi];
  };
  // 当前高亮区间:待选终点时用 起点↔悬停;否则用 已选 start↔end。
  const hl = pending ? expand(pending, hover ?? pending) : [start, end];

  const pick = (repDate: string) => {
    if (!pending) { setPending(repDate); setHover(repDate); return; }
    const [s, e] = expand(pending, repDate);
    onChange(s, e);
    close();
  };

  const grid = () => {
    if (mode === "month") {
      const y = view.getFullYear();
      const hlLo = hl[0].slice(0, 7), hlHi = hl[1].slice(0, 7);
      return (
        <>
          <div className="dash-cal-head">
            <button type="button" onClick={() => setView(new Date(y - 1, 0, 1))}><ChevronLeft size={15} /></button>
            <strong>{y} 年</strong>
            <button type="button" onClick={() => setView(new Date(y + 1, 0, 1))}><ChevronRight size={15} /></button>
          </div>
          <div className="dash-cal-cells">
            {MONTHS.map((label, m) => {
              const key = `${y}-${pad(m + 1)}`;
              return <button key={m} type="button" className={`dash-cal-cell${key >= hlLo && key <= hlHi ? " on" : ""}`} onClick={() => pick(ymd(new Date(y, m, 1)))} onMouseEnter={() => pending && setHover(ymd(new Date(y, m, 1)))}>{label}</button>;
            })}
          </div>
        </>
      );
    }
    if (mode === "year") {
      const hlLo = Number(hl[0].slice(0, 4)), hlHi = Number(hl[1].slice(0, 4));
      return (
        <>
          <div className="dash-cal-head">
            <button type="button" onClick={() => setView(new Date(yearBase - 12, 0, 1))}><ChevronLeft size={15} /></button>
            <strong>{yearBase} - {yearBase + 11}</strong>
            <button type="button" onClick={() => setView(new Date(yearBase + 12, 0, 1))}><ChevronRight size={15} /></button>
          </div>
          <div className="dash-cal-cells">
            {Array.from({ length: 12 }, (_, i) => yearBase + i).map((y) => (
              <button key={y} type="button" className={`dash-cal-cell${y >= hlLo && y <= hlHi ? " on" : ""}`} onClick={() => pick(`${y}-01-01`)} onMouseEnter={() => pending && setHover(`${y}-01-01`)}>{y}</button>
            ))}
          </div>
        </>
      );
    }
    // day / week
    return (
      <>
        <div className="dash-cal-head">
          <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}><ChevronLeft size={15} /></button>
          <strong>{view.getFullYear()} 年 {view.getMonth() + 1} 月</strong>
          <button type="button" onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}><ChevronRight size={15} /></button>
        </div>
        <div className="dash-cal-grid dash-cal-weekdays">{WEEKDAYS.map((w) => <span key={w}>{w}</span>)}</div>
        <div className="dash-cal-grid" onMouseLeave={() => setHover(null)}>
          {cells.map((d) => {
            const s = ymd(d);
            const inMonth = d.getMonth() === view.getMonth();
            const inRange = s >= hl[0] && s <= hl[1];
            return (
              <button
                key={s}
                type="button"
                className={`dash-cal-day${inMonth ? "" : " other"}${inRange ? " in" : ""}${s === hl[0] ? " start" : ""}${s === hl[1] ? " end" : ""}${s === todayStr ? " today" : ""}`}
                onClick={() => pick(s)}
                onMouseEnter={() => setHover(s)}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div className="dash-daterange">
      <button ref={triggerRef} type="button" className="dash-daterange-trigger" onClick={() => (open ? close() : openPop())}>
        <Calendar size={13} />
        <span>{activePreset ? activePreset.label : `${start} — ${end}`}</span>
      </button>
      {open && createPortal(
        <div className="dash-daterange-pop" ref={popRef} style={{ top: pos.top, left: pos.left }}>
          <div className="dash-daterange-presets">
            {presets().map((p) => (
              <button key={p.label} type="button" className={activePreset?.label === p.label ? "on" : ""} onClick={() => { const [s, e] = p.range(); onChange(s, e); close(); }}>{p.label}</button>
            ))}
          </div>
          <div className="dash-cal">
            <div className="dash-cal-modes">
              {(["day", "week", "month", "year"] as Mode[]).map((m) => (
                <button key={m} type="button" className={mode === m ? "on" : ""} onClick={() => { setMode(m); setPending(null); }}>{{ day: "日", week: "周", month: "月", year: "年" }[m]}</button>
              ))}
            </div>
            {grid()}
            <div className="dash-cal-foot">{pending ? "再点一个选为终点(可跨月/年)" : `${start} — ${end}`}</div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
