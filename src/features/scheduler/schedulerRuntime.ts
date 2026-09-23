import { create } from "zustand";
import { createRequestScope } from "../../lib/requestScope";
import type { StoredRepository } from "../../lib/storedRepository";
import type { DefinitionRequest } from "./definitionSync";
import { createSchedulerActions, type ProjectContext } from "./schedulerActions";
import type { SchedulerState } from "./schedulerState";
import type { Provider, SchedulerConn, SchedulerKind } from "./types";

export interface SchedulerRuntimePort {
  connections: StoredRepository<SchedulerConn[]>;
  provider(kind: SchedulerKind): Provider;
  syncDefinitions(request: DefinitionRequest): Promise<string | null>;
  id(): string;
  interval(callback: () => void, ms: number): () => void;
  delay(callback: () => void, ms: number): () => void;
}
const emptyProject = () => ({
  workflows: [], instances: [], recentTasks: [], stats: null,
  expandedInstance: null, tasks: [], tasksLoading: false, log: null, definitionMessage: null,
  dataLoading: false, dataError: undefined
});

export function createSchedulerStore(port: SchedulerRuntimePort) {
  const connectionScope = createRequestScope(), projectScope = createRequestScope();
  let refreshQueued = false;
  let connectionWrites: Promise<void> = Promise.resolve();
  const serializeConnectionWrite = (work: () => Promise<void>) => {
    const result = connectionWrites.then(work);
    connectionWrites = result.catch(() => {});
    return result;
  };
  let cancelAuto: (() => void) | undefined, cancelToast: (() => void) | undefined;
  const store = create<SchedulerState>((set, get) => {
    function connectionContext() {
      const state = get();
      const connection = state.conns.find(connection => connection.id === state.activeId);
      if (!connection || state.status[connection.id] !== "connected") return null;
      const valid = connectionScope.capture();
      const session = state.sessions[connection.id];
      return {
        connection, session: session ?? {}, provider: port.provider(connection.kind),
        isCurrent: () => valid() && get().activeId === connection.id
          && get().conns.find(item => item.id === connection.id) === connection && get().sessions[connection.id] === session
      };
    }
    function projectContext(): ProjectContext | null {
      const context = connectionContext(), projectCode = get().projectCode;
      if (!context || !projectCode) return null;
      const valid = projectScope.capture();
      return { ...context, projectCode, isCurrent: () => valid() && context.isCurrent() && get().projectCode === projectCode };
    }
    const commands = createSchedulerActions({ context: () => get().dataLoading ? null : projectContext(), get, setBusy: busy => set({ busy }) });
    const resetRequests = () => { connectionScope.invalidate(); projectScope.invalidate(); refreshQueued = false; };
    function clearConnection(id: string) {
      const { [id]: removedSession, ...sessions } = get().sessions;
      const { [id]: removedStatus, ...status } = get().status;
      const { [id]: removedError, ...error } = get().error;
      void removedSession; void removedStatus; void removedError;
      if (get().activeId === id) {
        resetRequests();
        cancelAuto?.(); cancelAuto = undefined;
        set({ ...emptyProject(), activeId: null, projectCode: null, projects: [], autoRefresh: false, busy: null, toast: null });
      }
      set({ sessions, status, error });
    }
    async function loadProject(context: ProjectContext, select: boolean) {
      if (!select && projectScope.isPending("data")) { refreshQueued = true; return; }
      projectScope.invalidate("stats");
      const ticket = projectScope.begin("data");
      const current = () => context.isCurrent() && ticket.isCurrent();
      set({ dataLoading: true, dataError: undefined });
      try {
        const [workflows, instances, recentTasks] = await Promise.all([
          context.provider.listWorkflows(context.connection, context.session, context.projectCode),
          context.provider.listInstances(context.connection, context.session, context.projectCode),
          context.provider.listTasks?.(context.connection, context.session, context.projectCode) ?? Promise.resolve([]),
        ]);
        if (!current()) return;
        set({ workflows, instances, recentTasks, dataLoading: false });
        if (select) void get().syncDefinitions();
        // Optional details have their own ownership; a slow stats call does not block the next refresh.
        if (context.provider.projectStats) {
          const statsTicket = projectScope.begin("stats");
          void context.provider.projectStats(context.connection, context.session, context.projectCode)
            .then(stats => { if (context.isCurrent() && statsTicket.isCurrent()) set({ stats }); })
            .catch(() => { if (context.isCurrent() && statsTicket.isCurrent()) set({ stats: null }); })
            .finally(statsTicket.finish);
        }
        if (!select && get().expandedInstance != null) void loadTasks(context, get().expandedInstance!);
      } catch (error) {
        if (current()) set({ dataError: String(error) });
      } finally {
        if (current()) set({ dataLoading: false });
        ticket.finish();
        if (current() && refreshQueued) { refreshQueued = false; void get().refresh(); }
      }
    }
    async function loadTasks(context: ProjectContext, instanceId: number) {
      const ticket = projectScope.begin("tasks");
      const current = () => context.isCurrent() && ticket.isCurrent() && get().expandedInstance === instanceId;
      if (!context.provider.listTasks) { set({ tasksLoading: false }); ticket.finish(); return; }
      set({ tasksLoading: true });
      try {
        const tasks = await context.provider.listTasks(context.connection, context.session, context.projectCode, instanceId);
        if (current()) set({ tasks });
      } catch (error) {
        if (current()) get().showToast(`读取任务失败:${String(error)}`, "crit");
      } finally {
        if (current()) set({ tasksLoading: false });
        ticket.finish();
      }
    }
    return {
      ...emptyProject(), open: false, conns: port.connections.load(), form: null, activeId: null,
      sessions: {}, status: {}, error: {}, projects: [], projectCode: null, busy: null, toast: null, autoRefresh: false,
      ...commands.actions,
      setOpen(open) {
        if (!open) { cancelAuto?.(); cancelAuto = undefined; refreshQueued = false; }
        set({ open, ...(open ? {} : { autoRefresh: false }) });
      },
      showToast(msg, tone) {
        cancelToast?.();
        set({ toast: { msg, tone } });
        cancelToast = port.delay(() => set({ toast: null }), 4200);
      },
      newConn: kind => set({ form: { id: "", kind, name: "", baseUrl: "", username: "", password: "", token: "" } }),
      editConn: connection => set({ form: { ...connection } }),
      cancelForm: () => set({ form: null }),
      saveConn(connection) {
        const form = get().form;
        return serializeConnectionWrite(async () => {
          const id = connection.id || port.id();
          const next = get().conns.some(item => item.id === id)
            ? get().conns.map(item => item.id === id ? { ...connection, id } : item)
            : [...get().conns, { ...connection, id }];
          try { await port.connections.save(next); }
          catch { get().showToast("连接设置加密保存失败，本次修改未生效", "crit"); return; }
          clearConnection(id);
          set({ conns: next, ...(get().form === form ? { form: null } : {}) });
        });
      },
      removeConn(id) {
        return serializeConnectionWrite(async () => {
          const next = get().conns.filter(item => item.id !== id);
          try { await port.connections.save(next); }
          catch { get().showToast("连接设置加密保存失败，未删除连接", "crit"); return; }
          clearConnection(id);
          set({ conns: next });
        });
      },
      async connect(id) {
        const connection = get().conns.find(item => item.id === id);
        if (!connection) return;
        resetRequests();
        const ticket = connectionScope.begin("connect");
        const current = () => ticket.isCurrent() && get().activeId === id && get().conns.find(item => item.id === id) === connection;
        const previousId = get().activeId;
        set(state => ({
          ...emptyProject(), activeId: id, projectCode: null, projects: [], busy: null, toast: null,
          status: { ...state.status, ...(previousId && state.status[previousId] === "connecting" ? { [previousId]: "idle" as const } : {}), [id]: "connecting" },
          error: { ...state.error, [id]: "" }
        }));
        try {
          const provider = port.provider(connection.kind);
          const session = await provider.connect(connection);
          if (!current()) return;
          const projects = await provider.listProjects(connection, session);
          if (!current()) return;
          set(state => ({ sessions: { ...state.sessions, [id]: session }, status: { ...state.status, [id]: "connected" }, projects }));
          if (projects[0]) await get().selectProject(projects[0].code);
          for (const project of projects.slice(1)) {
            if (!current()) return;
            await get().syncDefinitions(project.code);
          }
        } catch (error) {
          if (current()) set(state => ({ status: { ...state.status, [id]: "error" }, error: { ...state.error, [id]: String(error) } }));
        } finally { ticket.finish(); }
      },
      async selectProject(code) {
        if (!connectionContext()) return;
        projectScope.invalidate();
        refreshQueued = false;
        // Active-project definition requests stop when leaving that visit, even on A -> B -> A.
        set({ ...emptyProject(), projectCode: code, dataLoading: true, toast: null });
        commands.publishBusy();
        const context = projectContext();
        if (context) await loadProject(context, true);
      },
      async refresh() {
        const context = projectContext();
        if (context) await loadProject(context, false);
      },
      async syncDefinitions(project) {
        const context = connectionContext();
        const projectCode = project ?? get().projectCode;
        if (!context || !projectCode || (project === undefined && (get().dataLoading || get().dataError))) return;
        const validVisit = project === undefined ? projectScope.capture() : () => true;
        const ticket = connectionScope.begin(`definition:${projectCode}`);
        const current = () => context.isCurrent() && ticket.isCurrent() && validVisit();
        const visible = () => current() && get().projectCode === projectCode;
        if (visible()) set({ definitionMessage: "正在读取任务定义与依赖…" });
        try {
          const message = await port.syncDefinitions({
            ...context, projectCode,
            projectName: get().projects.find(item => item.code === projectCode)?.name ?? projectCode,
            workflows: project === undefined ? get().workflows : undefined, isCurrent: current
          });
          if (visible() && message !== null) set({ definitionMessage: message });
        } catch (error) {
          if (visible()) set({ definitionMessage: `任务定义同步失败：${String(error)}` });
        } finally { ticket.finish(); }
      },
      async toggleInstance(instanceId) {
        projectScope.invalidate("tasks");
        projectScope.invalidate("log");
        if (get().expandedInstance === instanceId) { set({ expandedInstance: null, tasks: [], tasksLoading: false, log: null }); return; }
        const context = projectContext();
        if (!context) return;
        set({ expandedInstance: instanceId, tasks: [], log: null });
        await loadTasks(context, instanceId);
      },
      async openLog(taskId, taskName) {
        const context = projectContext();
        if (!context?.provider.taskLog) return;
        const ticket = projectScope.begin("log");
        const current = () => context.isCurrent() && ticket.isCurrent();
        set({ log: { taskId, taskName, text: "", loading: true } });
        try {
          const text = await context.provider.taskLog(context.connection, context.session, taskId);
          if (current()) set({ log: { taskId, taskName, text: text || "(日志为空)", loading: false } });
        } catch (error) {
          if (current()) set({ log: { taskId, taskName, text: `读取日志失败:${String(error)}`, loading: false } });
        } finally { ticket.finish(); }
      },
      closeLog() { projectScope.invalidate("log"); set({ log: null }); },
      setAutoRefresh(on) {
        cancelAuto?.(); cancelAuto = undefined;
        if (!on) refreshQueued = false;
        if (on && get().open) cancelAuto = port.interval(() => { if (get().open && get().autoRefresh) void get().refresh(); }, 5000);
        set({ autoRefresh: !!cancelAuto });
      },
    };
  });
  return Object.assign(store, { dispose() { connectionScope.invalidate(); projectScope.invalidate(); cancelAuto?.(); cancelToast?.(); } });
}
