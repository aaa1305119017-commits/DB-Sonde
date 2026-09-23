/** Scheduler integration — kinds, connection config, and the Provider contract.
 *  Adding a scheduler = one new Provider; the UI adapts to its capabilities. */

export type SchedulerKind = "dolphinscheduler" | "airflow" | "kettle" | "xxljob" | "other";

export interface SchedulerConn {
  id: string;
  kind: SchedulerKind;
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
  token?: string;
  /**
   * 这个地址允许自签 / 过期证书吗。**默认不允许。**
   *
   * Rust 端的代理原来是无条件关掉 TLS 校验的(理由是"自建调度常用自签证书"),
   * 可那关掉的是所有请求的校验,包括登录那一次 —— 用户名和口令就在 body 里,
   * 同网段上谁都能中间人截下来。自签是个别地址的情况,改成个别地址自己勾。
   */
  allowInvalidCerts?: boolean;
}

/** Runtime auth material (e.g. a DolphinScheduler sessionId). Never persisted. */
export type Session = Record<string, string>;

export interface Project {
  code: string;
  name: string;
  workflows?: number;
  running?: number;
}

export interface Workflow {
  code: string;
  name: string;
  online: boolean;
  scheduled: boolean;
  description?: string;
  crontab?: string | null;
  cronHuman?: string | null;
  scheduleId?: number | null;
  updateTime?: string | null;
}

export interface Instance {
  workflowCode?: string;
  id: number;
  name: string;
  state: string; // raw engine state, e.g. RUNNING_EXECUTION / SUCCESS / FAILURE
  startTime?: string | null;
  endTime?: string | null;
  duration?: string | null;
  commandType?: string | null; // how it was triggered (SCHEDULER / MANUAL / COMPLEMENT …)
  host?: string | null;
  executor?: string | null;
  dryRun?: boolean;
  retryTimes?: number | null;
}

export interface Task {
  taskCode?: string;
  instanceId?: number;
  id: number;
  name: string;
  type?: string | null; // SHELL / SQL / DATAX …
  state: string;
  startTime?: string | null;
  endTime?: string | null;
  duration?: string | null;
  host?: string | null;
  retryTimes?: number | null;
}

/** Control verbs the UI can request on a running/finished instance. */
export type InstanceAction = "rerun" | "recover-failed" | "pause" | "resume" | "stop";

export interface Capabilities {
  hasProjects: boolean;
  run: boolean;
  stop: boolean;
  toggleOnline: boolean;
  taskDetail?: boolean;
  logs?: boolean;
  rerun?: boolean;
  recover?: boolean;
  pause?: boolean;
  toggleSchedule?: boolean;
  overview?: boolean;
  editCron?: boolean;
  backfill?: boolean;
}

/** Today's run counts for the overview strip. */
export interface ProjectStats {
  total: number;
  success: number;
  failure: number;
  running: number;
}

export interface AuthField {
  key: "baseUrl" | "username" | "password" | "token";
  label: string;
  placeholder?: string;
  password?: boolean;
}

export type RunHealthState = "ok" | "warn" | "error" | "running" | "unknown";

export interface Provider {
  /** Interpret this engine's status vocabulary; unknown is preferable to guessing. */
  classifyRunState?: (raw: string) => RunHealthState;
  kind: SchedulerKind;
  label: string;
  blurb: string;
  /** false = a reserved slot ("即将支持") that can't connect yet. */
  available: boolean;
  capabilities: Capabilities;
  authFields: AuthField[];
  connect(conn: SchedulerConn): Promise<Session>;
  listProjects(conn: SchedulerConn, session: Session): Promise<Project[]>;
  listWorkflows(conn: SchedulerConn, session: Session, projectCode: string): Promise<Workflow[]>;
  listInstances(conn: SchedulerConn, session: Session, projectCode: string): Promise<Instance[]>;
  getDefinition?(conn: SchedulerConn, session: Session, projectCode: string, workflowCode: string): Promise<import("./definitionImport").WorkflowDefinition>;
  runWorkflow(conn: SchedulerConn, session: Session, projectCode: string, workflowCode: string): Promise<void>;
  stopInstance(conn: SchedulerConn, session: Session, projectCode: string, instanceId: number): Promise<void>;

  // Optional richer capabilities — a provider implements what its engine supports.
  listTasks?(conn: SchedulerConn, session: Session, projectCode: string, instanceId?: number): Promise<Task[]>;
  taskLog?(conn: SchedulerConn, session: Session, taskInstanceId: number): Promise<string>;
  instanceAction?(
    conn: SchedulerConn,
    session: Session,
    projectCode: string,
    instanceId: number,
    action: InstanceAction,
  ): Promise<void>;
  setWorkflowOnline?(
    conn: SchedulerConn,
    session: Session,
    projectCode: string,
    workflowCode: string,
    online: boolean,
  ): Promise<void>;
  setScheduleOnline?(
    conn: SchedulerConn,
    session: Session,
    projectCode: string,
    scheduleId: number,
    online: boolean,
  ): Promise<void>;
  /** Today's run stats for the project (overview strip). */
  projectStats?(conn: SchedulerConn, session: Session, projectCode: string): Promise<ProjectStats>;
  /** Create (scheduleId null) or update a workflow's schedule, then bring it online. */
  saveSchedule?(
    conn: SchedulerConn,
    session: Session,
    projectCode: string,
    workflowCode: string,
    scheduleId: number | null,
    crontab: string,
  ): Promise<void>;
  /** Backfill: run a workflow once per day across [startDate, endDate]. */
  backfill?(
    conn: SchedulerConn,
    session: Session,
    projectCode: string,
    workflowCode: string,
    startDate: string,
    endDate: string,
  ): Promise<void>;
}
