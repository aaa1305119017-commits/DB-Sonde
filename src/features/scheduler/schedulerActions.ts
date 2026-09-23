import type { SchedulerState } from "./schedulerState";
import type { InstanceAction, Provider, SchedulerConn, Session } from "./types";

export interface ProjectContext {
  connection: SchedulerConn;
  session: Session;
  provider: Provider;
  projectCode: string;
  isCurrent(): boolean;
}
type ActionNames = "run" | "stop" | "instanceAction" | "toggleWorkflowOnline" | "toggleSchedule" | "saveSchedule" | "backfill";
export function createSchedulerActions(port: {
  context(): ProjectContext | null;
  get(): SchedulerState;
  setBusy(value: string | null): void;
}) {
  // Mutations are not cancelled by navigation. Keep their lock until the real request settles.
  const pending = new Map<string, string>();
  const key = (connectionId: string, projectCode: string) => JSON.stringify([connectionId, projectCode]);
  const publishBusy = () => {
    const state = port.get();
    port.setBusy(state.activeId && state.projectCode ? pending.get(key(state.activeId, state.projectCode)) ?? null : null);
  };
  async function perform(label: string, send: (context: ProjectContext) => Promise<void> | undefined, success: string, failure: string) {
    const context = port.context();
    if (!context || !context.isCurrent()) return;
    const id = key(context.connection.id, context.projectCode);
    if (pending.has(id)) return;
    pending.set(id, label);
    publishBusy();
    try {
      const request = send(context);
      if (!request) return;
      await request;
      if (!context.isCurrent()) return;
      port.get().showToast(success, "good");
      await port.get().refresh();
    } catch (error) {
      if (context.isCurrent()) port.get().showToast(`${failure}:${String(error).replace(/^Error:\s*/, "")}`, "crit");
    } finally {
      pending.delete(id);
      publishBusy();
    }
  }
  const labels: Record<InstanceAction, string> = { rerun: "重跑", "recover-failed": "从失败处恢复", pause: "暂停", resume: "恢复", stop: "停止" };
  const actions: Pick<SchedulerState, ActionNames> = {
    run: (code, name) => perform(
      `run:${code}`,
      c => c.provider.runWorkflow(c.connection, c.session, c.projectCode, code),
      `已触发运行:「${name}」— 新实例正在创建,看右侧运行记录`, "运行失败",
    ),
    stop: id => actions.instanceAction(id, "stop"),
    instanceAction: (id, action) => perform(
      `act:${action}:${id}`,
      c => c.provider.instanceAction?.(c.connection, c.session, c.projectCode, id, action),
      `已请求${labels[action]}:实例 #${id}`, `${labels[action]}失败`,
    ),
    toggleWorkflowOnline: w => perform(
      `wf:${w.code}`,
      c => c.provider.setWorkflowOnline?.(c.connection, c.session, c.projectCode, w.code, !w.online),
      `「${w.name}」已${w.online ? "下线" : "上线"}`, "上线状态切换失败",
    ),
    toggleSchedule: w => perform(
      `sch:${w.code}`,
      c => w.scheduleId == null ? undefined
        : c.provider.setScheduleOnline?.(c.connection, c.session, c.projectCode, w.scheduleId, !w.scheduled),
      `「${w.name}」定时已${w.scheduled ? "关闭" : "开启"}`, "定时切换失败",
    ),
    saveSchedule: (w, cron) => perform(
      `sch:${w.code}`,
      c => c.provider.saveSchedule?.(c.connection, c.session, c.projectCode, w.code, w.scheduleId ?? null, cron),
      `「${w.name}」定时已保存并开启`, "保存定时失败",
    ),
    backfill: (w, start, end) => perform(
      `run:${w.code}`,
      c => c.provider.backfill?.(c.connection, c.session, c.projectCode, w.code, start, end),
      `已触发补数据:「${w.name}」${start} ~ ${end}`, "补数据失败",
    ),
  };
  return { actions, publishBusy };
}
