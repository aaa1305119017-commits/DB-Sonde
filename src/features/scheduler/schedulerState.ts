import type { Instance, InstanceAction, Project, ProjectStats, SchedulerConn, Session, Task, Workflow } from "./types";

type Status = "idle" | "connecting" | "connected" | "error";
type ToastTone = "good" | "crit" | "info";
interface Toast {
  msg: string;
  tone: ToastTone;
}

interface LogView {
  taskId: number;
  taskName: string;
  text: string;
  loading: boolean;
}

export interface SchedulerState {
  open: boolean;
  conns: SchedulerConn[];
  form: SchedulerConn | null;
  activeId: string | null;
  sessions: Record<string, Session>;
  status: Record<string, Status>;
  error: Record<string, string>;

  projects: Project[];
  projectCode: string | null;
  workflows: Workflow[];
  instances: Instance[];
  stats: ProjectStats | null;
  dataLoading: boolean;
  dataError?: string;
  busy: string | null; // an in-flight run/stop/action label

  // instance drill-down
  expandedInstance: number | null;
  tasks: Task[];
  recentTasks: Task[];
  tasksLoading: boolean;
  log: LogView | null;

  toast: Toast | null;
  autoRefresh: boolean;

  setOpen: (open: boolean) => void;
  newConn: (kind: SchedulerConn["kind"]) => void;
  editConn: (conn: SchedulerConn) => void;
  cancelForm: () => void;
  saveConn: (conn: SchedulerConn) => Promise<void>;
  removeConn: (id: string) => Promise<void>;

  connect: (id: string) => Promise<void>;
  selectProject: (code: string) => Promise<void>;
  syncDefinitions: (project?: string) => Promise<void>;
  definitionMessage: string | null;
  refresh: () => Promise<void>;
  run: (workflowCode: string, workflowName: string) => Promise<void>;
  stop: (instanceId: number) => Promise<void>;
  instanceAction: (instanceId: number, action: InstanceAction) => Promise<void>;
  toggleWorkflowOnline: (w: Workflow) => Promise<void>;
  toggleSchedule: (w: Workflow) => Promise<void>;
  saveSchedule: (w: Workflow, crontab: string) => Promise<void>;
  backfill: (w: Workflow, startDate: string, endDate: string) => Promise<void>;

  toggleInstance: (instanceId: number) => Promise<void>;
  openLog: (taskId: number, taskName: string) => Promise<void>;
  closeLog: () => void;
  setAutoRefresh: (on: boolean) => void;
  showToast: (msg: string, tone: ToastTone) => void;
}

