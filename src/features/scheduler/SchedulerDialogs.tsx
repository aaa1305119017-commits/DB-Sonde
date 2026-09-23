import { useMemo, useState } from "react";
import { X, CalendarClock, CalendarRange, Loader2 } from "lucide-react";
import { useScheduler } from "./schedulerStore";
import type { Workflow } from "./types";
import { localDayOffset } from "../../lib/dates";
import {
  type CronMode,
  buildCron,
  parseCron,
  nextRuns,
  fmtRun,
  defaultParams,
  DOW_LABELS,
} from "./cron";

const MODES: { key: CronMode; label: string }[] = [
  { key: "daily", label: "每天" },
  { key: "hourly", label: "每小时" },
  { key: "everyNMin", label: "每 N 分钟" },
  { key: "weekly", label: "每周" },
  { key: "monthly", label: "每月" },
  { key: "custom", label: "自定义" },
];

export function CronEditor({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const busy = useScheduler((s) => s.busy === `sch:${workflow.code}`);
  const seed = useMemo(() => parseCron(workflow.crontab), [workflow.crontab]);
  const [mode, setMode] = useState<CronMode>(seed.mode);
  const [p, setP] = useState({ ...defaultParams(), ...seed.params });
  const set = (patch: Partial<typeof p>) => setP((prev) => ({ ...prev, ...patch }));

  const cron = buildCron(mode, p);
  const runs = useMemo(() => nextRuns(mode, p, 3), [mode, p]);

  const save = async () => {
    if (!cron.trim()) return;
    await useScheduler.getState().saveSchedule(workflow, cron);
    onClose();
  };

  const numInput = (val: number, on: (n: number) => void, min: number, max: number, w = 62) => (
    <input
      className="input"
      style={{ width: w }}
      type="number"
      min={min}
      max={max}
      value={val}
      onChange={(e) => on(Math.max(min, Math.min(max, Number(e.target.value) || 0)))}
    />
  );

  return (
    <div className="sd-overlay" onMouseDown={onClose}>
      <div className="sd-panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sd-head">
          <CalendarClock size={15} />
          <span className="sd-title">定时 · {workflow.name}</span>
          <div className="toolbar-spacer" />
          <button className="ai-icon" onClick={onClose} title="关闭">
            <X size={15} />
          </button>
        </header>
        <div className="sd-body">
          <div className="sd-modes">
            {MODES.map((m) => (
              <button key={m.key} className={`sd-mode ${mode === m.key ? "on" : ""}`} onClick={() => setMode(m.key)}>
                {m.label}
              </button>
            ))}
          </div>

          <div className="sd-params">
            {mode === "daily" && (
              <div className="sd-row">
                每天 {numInput(p.hour, (n) => set({ hour: n }), 0, 23)} 点 {numInput(p.minute, (n) => set({ minute: n }), 0, 59)} 分
              </div>
            )}
            {mode === "hourly" && (
              <div className="sd-row">每小时的第 {numInput(p.minute, (n) => set({ minute: n }), 0, 59)} 分</div>
            )}
            {mode === "everyNMin" && (
              <div className="sd-row">每 {numInput(p.everyN, (n) => set({ everyN: n }), 1, 59)} 分钟一次</div>
            )}
            {mode === "weekly" && (
              <div className="sd-row">
                每
                <select className="input" value={p.dow} onChange={(e) => set({ dow: Number(e.target.value) })}>
                  {DOW_LABELS.map((l, i) => (
                    <option key={i} value={i + 1}>
                      {l}
                    </option>
                  ))}
                </select>
                {numInput(p.hour, (n) => set({ hour: n }), 0, 23)} 点 {numInput(p.minute, (n) => set({ minute: n }), 0, 59)} 分
              </div>
            )}
            {mode === "monthly" && (
              <div className="sd-row">
                每月 {numInput(p.dom, (n) => set({ dom: n }), 1, 31)} 号 {numInput(p.hour, (n) => set({ hour: n }), 0, 23)} 点{" "}
                {numInput(p.minute, (n) => set({ minute: n }), 0, 59)} 分
              </div>
            )}
            {mode === "custom" && (
              <div className="sd-row col">
                <span className="sd-hint">Quartz 表达式(7 段:秒 分 时 日 月 周 年)</span>
                <input
                  className="input mono"
                  value={p.raw}
                  spellCheck={false}
                  placeholder="0 0 9 * * ? *"
                  onChange={(e) => set({ raw: e.target.value })}
                />
              </div>
            )}
          </div>

          <div className="sd-cron">
            <span className="sd-cron-label">cron</span>
            <code>{cron || "—"}</code>
          </div>

          <div className="sd-preview">
            <div className="sd-preview-head">接下来会在</div>
            {runs.length ? (
              runs.map((r, i) => (
                <div key={i} className="sd-run">
                  {fmtRun(r)}
                </div>
              ))
            ) : (
              <div className="sd-run dim">自定义表达式不预览</div>
            )}
          </div>
        </div>
        <footer className="sd-foot">
          <span className="sd-note">保存后会自动开启定时。</span>
          <div className="toolbar-spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={save} disabled={busy || !cron.trim()}>
            {busy ? <Loader2 size={14} className="spin" /> : <CalendarClock size={14} />} 保存定时
          </button>
        </footer>
      </div>
    </div>
  );
}


export function BackfillDialog({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  const busy = useScheduler((s) => s.busy === `run:${workflow.code}`);
  const [start, setStart] = useState(localDayOffset(7));
  const [end, setEnd] = useState(localDayOffset(1));

  const run = async () => {
    if (!workflow.online) return;
    if (start > end) return;
    if (window.confirm(`确认补数据「${workflow.name}」?\n${start} ~ ${end},按天各跑一次,会写真实数据。`)) {
      await useScheduler.getState().backfill(workflow, start, end);
      onClose();
    }
  };

  return (
    <div className="sd-overlay" onMouseDown={onClose}>
      <div className="sd-panel narrow" onMouseDown={(e) => e.stopPropagation()}>
        <header className="sd-head">
          <CalendarRange size={15} />
          <span className="sd-title">补数据 · {workflow.name}</span>
          <div className="toolbar-spacer" />
          <button className="ai-icon" onClick={onClose} title="关闭">
            <X size={15} />
          </button>
        </header>
        <div className="sd-body">
          <div className="sd-row">
            从
            <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            到
            <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div className="sd-hint">按天跑一次(串行)。跑历史日期,把那几天的数据补回来。</div>
          {!workflow.online && <div className="sd-warn">工作流未上线,先上线才能补数。</div>}
          {start > end && <div className="sd-warn">开始日期不能晚于结束日期。</div>}
        </div>
        <footer className="sd-foot">
          <div className="toolbar-spacer" />
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={run} disabled={busy || !workflow.online || start > end}>
            {busy ? <Loader2 size={14} className="spin" /> : <CalendarRange size={14} />} 开始补数
          </button>
        </footer>
      </div>
    </div>
  );
}
