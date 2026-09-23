import {
  X,
  Plus,
  Play,
  Square,
  Pause,
  RotateCcw,
  Redo2,
  RefreshCw,
  Loader2,
  Server,
  Circle,
  Pencil,
  Trash2,
  CalendarClock,
  ExternalLink,
  ChevronRight,
  FileText,
  Power,
  Terminal,
  CalendarRange,
  CheckCircle2,
  XCircle,
  Activity,
  ListChecks,
} from "lucide-react";
import { useScheduler } from "./schedulerStore";
import { providerList, getProvider } from "./providers";
import type { AuthField, InstanceAction, SchedulerConn, Workflow } from "./types";
import { CronEditor, BackfillDialog } from "./SchedulerDialogs";
import { useState } from "react";
import AssetShell from "../assets/AssetShell";
import "./scheduler.css";
import { useConfirm } from "../../components/useConfirm";

/** DolphinScheduler process/task states → plain Chinese + a tone. */
const STATE_META: Record<string, { label: string; tone: string }> = {
  SUBMITTED_SUCCESS: { label: "已提交", tone: "info" },
  RUNNING_EXECUTION: { label: "运行中", tone: "run" },
  READY_PAUSE: { label: "准备暂停", tone: "warn" },
  PAUSE: { label: "已暂停", tone: "warn" },
  READY_STOP: { label: "准备停止", tone: "warn" },
  STOP: { label: "已停止", tone: "muted" },
  FAILURE: { label: "失败", tone: "crit" },
  SUCCESS: { label: "成功", tone: "good" },
  NEED_FAULT_TOLERANCE: { label: "容错中", tone: "warn" },
  KILL: { label: "已杀", tone: "muted" },
  WAITING_THREAD: { label: "等待线程", tone: "info" },
  WAITING_DEPEND: { label: "等待依赖", tone: "info" },
  DELAY_EXECUTION: { label: "延迟执行", tone: "info" },
  FORCED_SUCCESS: { label: "强制成功", tone: "good" },
  SERIAL_WAIT: { label: "串行等待", tone: "info" },
  DISPATCH: { label: "派发中", tone: "info" },
  PENDING: { label: "等待中", tone: "info" },
};
const stateMeta = (s: string) => STATE_META[s] ?? { label: s, tone: "muted" };

/** How the run was triggered → plain Chinese. */
const COMMAND_TYPE: Record<string, string> = {
  START_PROCESS: "手动运行",
  START_CURRENT_TASK_PROCESS: "从当前节点",
  RECOVER_TOLERANCE_FAULT_PROCESS: "容错恢复",
  RECOVER_SUSPENDED_PROCESS: "暂停恢复",
  START_FAILURE_TASK_PROCESS: "失败重跑",
  COMPLEMENT_DATA: "补数据",
  SCHEDULER: "定时触发",
  REPEAT_RUNNING: "重跑",
  PAUSE: "暂停",
  STOP: "停止",
  RECOVER_WAITING_THREAD: "线程恢复",
};
const cmdType = (c?: string | null) => (c ? COMMAND_TYPE[c] ?? c : null);

const RUNNING = new Set([
  "RUNNING_EXECUTION",
  "SUBMITTED_SUCCESS",
  "SERIAL_WAIT",
  "WAITING_THREAD",
  "WAITING_DEPEND",
  "DELAY_EXECUTION",
  "DISPATCH",
  "READY_PAUSE",
  "READY_STOP",
]);
const isRunning = (s: string) => RUNNING.has(s);
const isPaused = (s: string) => s === "PAUSE";
const isFailed = (s: string) => s === "FAILURE" || s === "NEED_FAULT_TOLERANCE";

/** Which control verbs make sense for an instance in this state. */
function actionsFor(state: string): InstanceAction[] {
  if (isRunning(state)) return ["pause", "stop"];
  if (isPaused(state)) return ["resume", "stop"];
  if (isFailed(state)) return ["recover-failed", "rerun"];
  return ["rerun"]; // success / stop / kill
}
const ACTION_META: Record<InstanceAction, { label: string; icon: typeof Play; cls: string }> = {
  pause: { label: "暂停", icon: Pause, cls: "" },
  stop: { label: "停止", icon: Square, cls: "danger" },
  resume: { label: "恢复", icon: Play, cls: "primary" },
  "recover-failed": { label: "从失败恢复", icon: Redo2, cls: "primary" },
  rerun: { label: "重跑", icon: RotateCcw, cls: "" },
};

function ConnForm({
  initial,
  onCancel,
  onSave,
}: {
  initial: SchedulerConn;
  onCancel: () => void;
  onSave: (c: SchedulerConn) => Promise<void>;
}) {
  const provider = getProvider(initial.kind);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<SchedulerConn>({ ...initial, name: initial.name || provider.label });
  const set = (k: keyof SchedulerConn, v: string | boolean) => setDraft((d) => ({ ...d, [k]: v }));
  const field = (f: AuthField) => (
    <label className="sched-field" key={f.key}>
      <span>{f.label}</span>
      <input
        className="input"
        type={f.password ? "password" : "text"}
        value={(draft[f.key] as string) ?? ""}
        placeholder={f.placeholder}
        spellCheck={false}
        onChange={(e) => set(f.key, e.target.value)}
      />
    </label>
  );
  return (
    <div className="sched-form">
      <h3>
        {initial.id ? "编辑" : "接入"} · {provider.label}
      </h3>
      <p className="sched-blurb">{provider.blurb}</p>
      <label className="sched-field">
        <span>名称</span>
        <input className="input" value={draft.name} spellCheck={false} onChange={(e) => set("name", e.target.value)} />
      </label>
      {provider.authFields.map(field)}
      {/* 只在 https 地址下给这个开关 —— http 压根没有 TLS 可校验,摆出来只会让人
          以为自己漏勾了什么。默认不勾:自签是个别地址的情况,不该所有地址陪绑。 */}
      {/^https:/i.test(draft.baseUrl.trim()) && (
        <label className="sched-field row">
          <input
            type="checkbox"
            checked={draft.allowInvalidCerts ?? false}
            onChange={(e) => set("allowInvalidCerts", e.target.checked)}
          />
          <span>允许自签证书(仅当这个地址用的是自签 / 过期证书时勾上)</span>
        </label>
      )}
      <p className="sched-note">桌面版凭据加密保存在本机；浏览器预览仅在本次页面有效。</p>
      <div className="sched-form-actions">
        <button className="btn" disabled={saving} onClick={onCancel}>
          取消
        </button>
        <button className="btn primary" disabled={saving || !draft.baseUrl.trim()} onClick={async () => {
          setSaving(true);
          try { await onSave(draft); } finally { setSaving(false); }
        }}>
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

function WorkflowRow({
  w,
  onEditCron,
  onBackfill,
}: {
  w: Workflow;
  onEditCron: (w: Workflow) => void;
  onBackfill: (w: Workflow) => void;
}) {
  const s = useScheduler();
  const provider = getProvider(s.conns.find((c) => c.id === s.activeId)!.kind);
  const running = s.busy === `run:${w.code}`;
  const confirmRun = () => {
    if (!w.online) return;
    if (window.confirm(`确认运行工作流「${w.name}」?\n这会在真实调度器上触发一次执行。`))
      void s.run(w.code, w.name);
  };
  return (
    <div className="wf-row">
      {/* 名字独占一行 —— 工作流名普遍很长(「线上三渠道汇总dws&ads」),
          和状态、按钮挤在同一行时会被截成「线上…」,一列全长一个样。 */}
      <div className="wf-name" title={w.description || w.name}>
        {w.name}
      </div>
      <div className="wf-foot">
        <div className="wf-tags">
          <span className={`tag ${w.online ? "on" : "off"}`}>{w.online ? "已上线" : "未上线"}</span>
          {w.scheduled && (
            <span className="tag sched" title={w.crontab ?? ""}>
              <CalendarClock size={11} /> {w.cronHuman ?? "定时"}
            </span>
          )}
          {!w.scheduled && w.crontab && (
            <span className="tag off" title={w.crontab}>
              定时关
            </span>
          )}
        </div>
        <div className="toolbar-spacer" />
        <div className="wf-actions">
        {provider.capabilities.toggleOnline && provider.setWorkflowOnline && (
          <button
            className="ai-icon xs"
            disabled={s.busy === `wf:${w.code}`}
            title={w.online ? "下线" : "上线"}
            onClick={() => void s.toggleWorkflowOnline(w)}
          >
            <Power size={13} className={w.online ? "pow-on" : "pow-off"} />
          </button>
        )}
        {provider.capabilities.toggleSchedule && provider.setScheduleOnline && w.scheduleId != null && (
          <button
            className="ai-icon xs"
            disabled={s.busy === `sch:${w.code}`}
            title={w.scheduled ? "关闭定时" : "开启定时"}
            onClick={() => void s.toggleSchedule(w)}
          >
            <CalendarClock size={13} className={w.scheduled ? "pow-on" : "pow-off"} />
          </button>
        )}
        {provider.capabilities.editCron && provider.saveSchedule && (
          <button className="ai-icon xs" title="编辑定时(cron)" onClick={() => onEditCron(w)}>
            <Pencil size={13} />
          </button>
        )}
        {provider.capabilities.backfill && provider.backfill && (
          <button
            className="ai-icon xs"
            title={w.online ? "补数据(按天)" : "未上线,不能补数"}
            disabled={!w.online}
            onClick={() => onBackfill(w)}
          >
            <CalendarRange size={13} />
          </button>
        )}
        {provider.capabilities.run && (
          <button
            className="btn xs"
            disabled={running || !w.online}
            title={w.online ? "运行一次" : "未上线,先上线才能运行"}
            onClick={confirmRun}
          >
            {running ? <Loader2 size={12} className="spin" /> : <Play size={12} />} 运行
          </button>
        )}
        </div>
      </div>
    </div>
  );
}

function StatsStrip() {
  const stats = useScheduler((s) => s.stats);
  if (!stats) return null;
  const tiles = [
    { icon: <ListChecks size={14} />, label: "今日运行", val: stats.total, cls: "" },
    { icon: <CheckCircle2 size={14} />, label: "成功", val: stats.success, cls: "good" },
    { icon: <XCircle size={14} />, label: "失败", val: stats.failure, cls: stats.failure > 0 ? "crit" : "" },
    { icon: <Activity size={14} />, label: "在跑", val: stats.running, cls: stats.running > 0 ? "run" : "" },
  ];
  return (
    <div className="sched-stats">
      {tiles.map((t) => (
        <div className={`stat ${t.cls}`} key={t.label}>
          <span className="stat-ic">{t.icon}</span>
          <span className="stat-val">{t.val}</span>
          <span className="stat-lbl">{t.label}</span>
        </div>
      ))}
    </div>
  );
}

function ConnectedView() {
  const s = useScheduler();
  const conn = s.conns.find((c) => c.id === s.activeId)!;
  const provider = getProvider(conn.kind);
  const [cronFor, setCronFor] = useState<Workflow | null>(null);
  const [backfillFor, setBackfillFor] = useState<Workflow | null>(null);

  const confirmAction = (id: number, name: string, action: InstanceAction) => {
    const m = ACTION_META[action];
    if (window.confirm(`确认「${m.label}」实例「${name}」?`)) void s.instanceAction(id, action);
  };

  return (
    <div className="sched-workspace">
      <div className="sched-toolbar">
        {provider.capabilities.hasProjects && (
          <div className="sched-projects">
            {s.projects.map((p) => (
              <button
                key={p.code}
                className={`proj ${s.projectCode === p.code ? "on" : ""}`}
                onClick={() => void s.selectProject(p.code)}
                title={`${p.workflows ?? 0} 个工作流 · ${p.running ?? 0} 个在跑`}
              >
                {p.name}
                {p.running ? <span className="proj-run">{p.running}</span> : null}
              </button>
            ))}
          </div>
        )}
        <div className="toolbar-spacer" />
        <label className="sched-auto" title="每 5 秒自动刷新运行记录">
          <input type="checkbox" checked={s.autoRefresh} onChange={(e) => s.setAutoRefresh(e.target.checked)} />
          自动刷新
        </label>
        <a className="btn sm ghost" href={conn.baseUrl} target="_blank" rel="noreferrer" title="打开调度器原界面">
          <ExternalLink size={13} /> 原界面
        </a>
        <button className="btn sm" onClick={() => void s.refresh()} disabled={s.dataLoading}>
          <RefreshCw size={13} className={s.dataLoading ? "spin" : ""} /> 刷新
        </button>
      </div>

      {s.definitionMessage && <div className="sched-error">{s.definitionMessage} <button className="btn sm" onClick={()=>void s.syncDefinitions()}>刷新任务定义</button></div>}
      {s.dataError && <div className="sched-error">{s.dataError}</div>}

      <StatsStrip />

      <div className="sched-cols">
        <section className="sched-col">
          <div className="col-head">
            工作流 <b>{s.workflows.length}</b>
          </div>
          <div className="col-body">
            {s.dataLoading ? (
              <div className="sched-state">
                <Loader2 size={16} className="spin" /> 读取中…
              </div>
            ) : s.workflows.length === 0 ? (
              <div className="sched-state">这个项目还没有工作流。</div>
            ) : (
              s.workflows.map((w) => (
                <WorkflowRow key={w.code} w={w} onEditCron={setCronFor} onBackfill={setBackfillFor} />
              ))
            )}
          </div>
        </section>

        <section className="sched-col wide">
          <div className="col-head">
            {/* 这里原来写的是 instances.length —— 而那是一页的条数(50),
                不是这个项目跑过多少次。天天在跑的项目也显示「运行记录 50」,
                看着像总共只跑过 50 次。改成照实说这是最近几次。 */}
            运行记录 · 最近 <b>{s.instances.length}</b> 次
            <span className="col-head-hint">点一行看每个任务和日志</span>
          </div>
          <div className="col-body">
            {s.dataLoading ? (
              <div className="sched-state">
                <Loader2 size={16} className="spin" /> 读取中…
              </div>
            ) : s.instances.length === 0 ? (
              <div className="sched-state">还没有运行记录。</div>
            ) : (
              s.instances.map((i) => {
                const m = stateMeta(i.state);
                const expanded = s.expandedInstance === i.id;
                return (
                  <div className={`inst-block ${expanded ? "open" : ""}`} key={i.id}>
                    <div className="inst-row" onClick={() => void s.toggleInstance(i.id)}>
                      <ChevronRight size={13} className={`inst-caret ${expanded ? "open" : ""}`} />
                      <span className={`pill ${m.tone}`}>{m.label}</span>
                      <div className="inst-info">
                        <div className="inst-name" title={i.name}>
                          {i.name}
                          {i.dryRun && <span className="dry">试运行</span>}
                        </div>
                        <div className="inst-meta">
                          {cmdType(i.commandType) && <span className="im-tag">{cmdType(i.commandType)}</span>}
                          {i.startTime ?? "—"}
                          {i.duration ? ` · 耗时 ${i.duration}` : ""}
                          {i.host ? ` · ${i.host}` : ""}
                          {i.executor ? ` · ${i.executor}` : ""}
                        </div>
                      </div>
                      <div className="inst-actions" onClick={(e) => e.stopPropagation()}>
                        {provider.instanceAction &&
                          actionsFor(i.state).map((a) => {
                            const am = ACTION_META[a];
                            const Icon = am.icon;
                            const busy = s.busy === `act:${a}:${i.id}` || (a === "stop" && s.busy === `stop:${i.id}`);
                            return (
                              <button
                                key={a}
                                className={`btn xs ${am.cls}`}
                                disabled={busy}
                                onClick={() => confirmAction(i.id, i.name, a)}
                              >
                                {busy ? <Loader2 size={12} className="spin" /> : <Icon size={12} />} {am.label}
                              </button>
                            );
                          })}
                      </div>
                    </div>

                    {expanded && (
                      <div className="inst-tasks">
                        {s.tasksLoading ? (
                          <div className="sched-state sm">
                            <Loader2 size={14} className="spin" /> 读取任务…
                          </div>
                        ) : s.tasks.length === 0 ? (
                          <div className="sched-state sm">这次运行还没有任务记录。</div>
                        ) : (
                          <table className="task-table">
                            <thead>
                              <tr>
                                <th>任务</th>
                                <th>类型</th>
                                <th>状态</th>
                                <th>耗时</th>
                                <th>执行机</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {s.tasks.map((t) => {
                                const tm = stateMeta(t.state);
                                return (
                                  <tr key={t.id}>
                                    <td className="tk-name" title={t.name}>
                                      {t.name}
                                      {(t.retryTimes ?? 0) > 0 && <span className="retry">重试{t.retryTimes}</span>}
                                    </td>
                                    <td className="tk-type">{t.type ?? "—"}</td>
                                    <td>
                                      <span className={`pill sm ${tm.tone}`}>{tm.label}</span>
                                    </td>
                                    <td className="tk-dim">{t.duration ?? "—"}</td>
                                    <td className="tk-dim" title={t.host ?? ""}>
                                      {t.host ?? "—"}
                                    </td>
                                    <td>
                                      {provider.taskLog && (
                                        <button className="btn xs ghost" onClick={() => void s.openLog(t.id, t.name)}>
                                          <FileText size={11} /> 日志
                                        </button>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>

      {cronFor && <CronEditor workflow={cronFor} onClose={() => setCronFor(null)} />}
      {backfillFor && <BackfillDialog workflow={backfillFor} onClose={() => setBackfillFor(null)} />}
    </div>
  );
}

function LogModal() {
  const log = useScheduler((s) => s.log);
  const closeLog = useScheduler((s) => s.closeLog);
  if (!log) return null;
  return (
    <div className="log-overlay" onMouseDown={closeLog}>
      <div className="log-panel" onMouseDown={(e) => e.stopPropagation()}>
        <header className="log-head">
          <Terminal size={14} />
          <span className="log-title" title={log.taskName}>
            {log.taskName} · 日志
          </span>
          <div className="toolbar-spacer" />
          <button className="ai-icon" title="关闭" onClick={closeLog}>
            <X size={15} />
          </button>
        </header>
        <pre className="log-body">
          {log.loading ? "读取中…" : log.text}
        </pre>
      </div>
    </div>
  );
}

export default function SchedulerCenter() {
  const s = useScheduler();
  // hook 必须在 early return 之前调用 —— 下面那句 `if (!s.open) return null` 一挡,
  // 放在它后面就成了条件调用的 hook(test:hooks 那条守卫盯的就是这个)。
  const { askConfirm, confirmDialog } = useConfirm();
  if (!s.open) return null;

  /** 删一个调度连接。**要确认** —— 这个垃圾桶图标紧挨着编辑的铅笔图标,
   *  点错一下,地址、用户名、口令就一起没了,而且没有撤销。 */
  const removeConn = async (id: string, name: string, baseUrl: string) => {
    if (!(await askConfirm(`${name}\n${baseUrl}\n\n删掉之后要重新填一遍地址和凭据,没有撤销。`, "删除调度连接", "删除"))) return;
    s.removeConn(id);
  };

  const active = s.conns.find((c) => c.id === s.activeId);
  const activeStatus = s.activeId ? s.status[s.activeId] : undefined;

  return (
    <AssetShell title="调度" sub="看 / 跑 / 停 / 暂停 / 重跑 · 目前接入 DolphinScheduler">

        {s.toast && <div className={`sched-toast ${s.toast.tone}`}>{s.toast.msg}</div>}

        <div className="sched-body">
          <aside className="sched-rail">
            <div className="rail-head">
              <span>调度连接</span>
            </div>
            <div className="rail-conns">
              {s.conns.length === 0 && <div className="rail-empty">还没有调度连接</div>}
              {s.conns.map((c) => {
                const st = s.status[c.id];
                return (
                  <div
                    key={c.id}
                    className={`conn-row ${s.activeId === c.id ? "on" : ""}`}
                    onClick={() => void s.connect(c.id)}
                  >
                    <Server size={14} className="conn-icon" />
                    <div className="conn-body">
                      <div className="conn-name">{c.name}</div>
                      <div className="conn-url">{c.baseUrl}</div>
                    </div>
                    <Circle
                      size={8}
                      className={`conn-dot ${st === "connected" ? "ok" : st === "error" ? "err" : st === "connecting" ? "wait" : ""}`}
                    />
                    <span className="conn-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="ai-icon xs" title="编辑" onClick={() => s.editConn(c)}>
                        <Pencil size={12} />
                      </button>
                      <button className="ai-icon xs" title="删除" onClick={() => void removeConn(c.id, c.name, c.baseUrl)}>
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="rail-add">
              <div className="rail-add-head">接入调度器</div>
              {providerList.map((p) => (
                <button key={p.kind} className="add-provider" disabled={!p.available} onClick={() => s.newConn(p.kind)}>
                  <Plus size={13} />
                  <span className="ap-label">{p.label}</span>
                  {!p.available && <span className="ap-soon">即将支持</span>}
                </button>
              ))}
            </div>
          </aside>

          <main className="sched-main">
            {s.form ? (
              <ConnForm initial={s.form} onCancel={s.cancelForm} onSave={s.saveConn} />
            ) : activeStatus === "connecting" ? (
              <div className="sched-center-state">
                <Loader2 size={22} className="spin" /> 连接中…
              </div>
            ) : activeStatus === "error" ? (
              <div className="sched-center-state error">
                连接失败:{s.activeId ? s.error[s.activeId] : ""}
                {active && (
                  <button className="btn sm" onClick={() => void s.connect(active.id)}>
                    重试
                  </button>
                )}
              </div>
            ) : activeStatus === "connected" ? (
              <ConnectedView />
            ) : (
              <div className="sched-center-state hint">
                <CalendarClock size={30} />
                <p>左侧选一个调度连接开始,或「接入调度器 · DolphinScheduler」新建一个。</p>
                <p className="dim">Airflow / Kettle / XXL-Job 等会陆续接入。</p>
              </div>
            )}
          </main>
        </div>
        <LogModal />
      {confirmDialog}
    </AssetShell>
  );
}
