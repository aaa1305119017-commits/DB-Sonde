import { dolphinRunState } from "./dolphinRunState";
import type {
  Provider,
  SchedulerConn,
  Session,
  Project,
  Workflow,
  Instance,
  Task,
  InstanceAction,
  ProjectStats,
} from "./types";
import { schedulerFetch, formEncode } from "./client";
import { cronHuman } from "./cron";

/** 首页那两条流水各取多少条。不是"上限",是"最近多少条",界面上照实写。 */
const RECENT_INSTANCES = 50;
const RECENT_TASKS = 500;

const pad2 = (n: number) => String(n).padStart(2, "0");
/** Format a Date as DS's "YYYY-MM-DD HH:mm:ss" (local time). */
function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Normalize the base URL to end in /dolphinscheduler (the API root). */
function apiRoot(conn: SchedulerConn): string {
  let b = conn.baseUrl.trim().replace(/\/+$/, "");
  if (!/\/dolphinscheduler$/i.test(b)) b = `${b}/dolphinscheduler`;
  return b;
}

interface DsEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

async function ds<T>(
  conn: SchedulerConn,
  session: Session,
  method: string,
  path: string,
  opts?: { query?: Record<string, string | number>; form?: Record<string, string | number> },
): Promise<T> {
  const headers: Record<string, string> = { sessionId: session.sessionId ?? "" };
  let url = `${apiRoot(conn)}${path}`;
  let body: string | undefined;
  if (opts?.query) url += `?${formEncode(opts.query)}`;
  if (opts?.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = formEncode(opts.form);
  }
  const res = await schedulerFetch({ method, url, headers, body, allowInvalidCerts: conn.allowInvalidCerts });
  let json: DsEnvelope<T>;
  try {
    json = JSON.parse(res.body || "{}");
  } catch {
    throw new Error(`DS 返回非 JSON(HTTP ${res.status}):${res.body.slice(0, 120)}`);
  }
  if (json.code !== 0) throw new Error(json.msg || `DS 返回 code=${json.code}`);
  return json.data;
}


/**
 * 翻完所有页再返回。
 *
 * 原来每个列表都是 `{ pageNo: 1, pageSize: 1000 }` 一把梭 —— 项目 200、工作流 1000、
 * 定时 1000。超出的部分不是报错,是**安安静静地不出现**:界面上少一个工作流,
 * 你只会以为自己记错了,不会想到是翻页没翻完。这些都是用户自己建的东西,
 * 有多少就该显示多少,不存在"太多了给你截一段"这回事。
 *
 * 运行记录那种流水是另一回事(见 listInstances),那儿要的是最近多少条,
 * 界面上也照实写"最近 N 次"。
 */
async function dsPaged(
  conn: SchedulerConn,
  session: Session,
  path: string,
  query: Record<string, string | number> = {},
  pageSize = 500,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  let pageNo = 1;
  // DS 单页最多给 totalPage/total,拿不到就靠"这页没满"判断到底了。
  for (;;) {
    const data = await ds<{ totalList?: Record<string, unknown>[]; total?: number; totalPage?: number }>(
      conn, session, "GET", path, { query: { ...query, pageNo, pageSize } },
    );
    const batch = data.totalList ?? [];
    out.push(...batch);
    const totalPage = Number(data.totalPage ?? 0);
    const done = totalPage > 0 ? pageNo >= totalPage : batch.length < pageSize;
    if (done) return out;
    pageNo += 1;
    /* 保险丝:DS 要是把 totalPage 报成个大得离谱的数(见过分页参数被忽略、
       每页都回同一批的情况),这儿不能变成无限循环把界面卡死。 */
    if (pageNo > 1000) return out;
  }
}

/** Fetch this project's schedules, keyed by process-definition code. */
async function scheduleMap(
  conn: SchedulerConn,
  session: Session,
  projectCode: string,
): Promise<Map<string, { crontab: string; online: boolean; scheduleId: number }>> {
  const map = new Map<string, { crontab: string; online: boolean; scheduleId: number }>();
  try {
    const rows = await dsPaged(conn, session, `/projects/${projectCode}/schedules`);
    for (const s of rows) {
      map.set(String(s.processDefinitionCode), {
        crontab: String(s.crontab ?? ""),
        online: s.releaseState === "ONLINE",
        scheduleId: Number(s.id),
      });
    }
  } catch {
    /* schedules are a bonus; ignore failures */
  }
  return map;
}

export const dolphinscheduler: Provider = {
  kind: "dolphinscheduler",
  classifyRunState: dolphinRunState,
  label: "DolphinScheduler",
  blurb: "海豚调度 · Open API 全能力(看 / 跑 / 停 / 暂停 / 重跑 / 日志)",
  available: true,
  capabilities: {
    hasProjects: true,
    run: true,
    stop: true,
    toggleOnline: true,
    taskDetail: true,
    logs: true,
    rerun: true,
    recover: true,
    pause: true,
    toggleSchedule: true,
    overview: true,
    editCron: true,
    backfill: true,
  },
  authFields: [
    { key: "baseUrl", label: "地址", placeholder: "http://192.0.2.2:12345" },
    { key: "username", label: "用户名", placeholder: "admin" },
    { key: "password", label: "密码", password: true },
  ],

  async connect(conn) {
    const res = await schedulerFetch({
      method: "POST",
      url: `${apiRoot(conn)}/login`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: formEncode({ userName: conn.username ?? "", userPassword: conn.password ?? "" }),
      allowInvalidCerts: conn.allowInvalidCerts,
    });
    const json = JSON.parse(res.body || "{}");
    if (json.code !== 0 || !json.data?.sessionId) throw new Error(json.msg || `登录失败(HTTP ${res.status})`);
    return { sessionId: String(json.data.sessionId) };
  },

  async listProjects(conn, session) {
    const rows = await dsPaged(conn, session, "/projects");
    return rows.map(
      (p): Project => ({
        code: String(p.code),
        name: String(p.name),
        workflows: Number(p.defCount ?? 0),
        running: Number(p.instRunningCount ?? 0),
      }),
    );
  },

  async listWorkflows(conn, session, projectCode) {
    const [rows, sched] = await Promise.all([
      dsPaged(conn, session, `/projects/${projectCode}/process-definition`),
      scheduleMap(conn, session, projectCode),
    ]);
    return rows.map((w): Workflow => {
      const s = sched.get(String(w.code));
      return {
        code: String(w.code),
        name: String(w.name),
        online: w.releaseState === "ONLINE",
        scheduled: (w.scheduleReleaseState === "ONLINE") || (s?.online ?? false),
        description: (w.description as string) || "",
        crontab: s?.crontab ?? null,
        cronHuman: cronHuman(s?.crontab),
        scheduleId: s?.scheduleId ?? null,
        updateTime: (w.updateTime as string) ?? null,
      };
    });
  },

  async getDefinition(conn, session, projectCode, workflowCode) {
    const data=await ds<{taskDefinitionList: Record<string,unknown>[];processTaskRelationList: Record<string,unknown>[]}>(conn,session,"GET",`/projects/${projectCode}/process-definition/${workflowCode}`);
    if(!Array.isArray(data.taskDefinitionList)||!Array.isArray(data.processTaskRelationList))throw new Error("调度返回的任务定义格式不受支持");
    return {tasks:data.taskDefinitionList.map(t=>({code:String(t.code),name:String(t.name),type:String(t.taskType),params:typeof t.taskParams==="string"?JSON.parse(t.taskParams):(t.taskParams??{}) as Record<string,unknown>})),relations:data.processTaskRelationList.map(r=>({from:String(r.preTaskCode),to:String(r.postTaskCode)}))};
  },
  async listInstances(conn, session, projectCode) {
    const data = await ds<{ totalList: Record<string, unknown>[] }>(
      conn,
      session,
      "GET",
      `/projects/${projectCode}/process-instances`,
      /* 运行记录是流水,要的是最近几次,不是全量 —— 一个天天跑的项目攒几万条
         实例,面板还在定时刷新,拉全了没意义也卡。界面上照实写「最近 N 次」,
         不拿这个数冒充总数(以前列头写的是 instances.length,看着像总共就跑过 50 次)。 */
      { query: { pageNo: 1, pageSize: RECENT_INSTANCES } },
    );
    return (data.totalList ?? []).map(
      (i): Instance => ({
        workflowCode: String(i.processDefinitionCode ?? ""),
        id: Number(i.id),
        name: String(i.name),
        state: String(i.state),
        startTime: (i.startTime as string) ?? null,
        endTime: (i.endTime as string) ?? null,
        duration: (i.duration as string) ?? null,
        commandType: (i.commandType as string) ?? null,
        host: (i.host as string) ?? null,
        executor: (i.executorName as string) ?? null,
        dryRun: Number(i.dryRun ?? 0) === 1,
        retryTimes: (i.retryTimes as number) ?? null,
      }),
    );
  },

  async listTasks(conn, session, projectCode, instanceId) {
    /* 点开某次运行看它的任务时要**给全** —— 少一个任务,用户就看不到那个失败的节点。
       不指定实例的那次调用是首页的"最近任务"流水,跟运行记录一样只要一窗。 */
    const rows = instanceId == null
      ? await ds<{ totalList?: Record<string, unknown>[] }>(conn, session, "GET",
          `/projects/${projectCode}/task-instances`, { query: { pageNo: 1, pageSize: RECENT_TASKS } })
          .then((d) => d.totalList ?? [])
      : await dsPaged(conn, session, `/projects/${projectCode}/task-instances`, { processInstanceId: instanceId });
    return rows.map(
      (t): Task => ({
        taskCode: String(t.taskCode ?? ""),
        instanceId: Number(t.processInstanceId),
        id: Number(t.id),
        name: String(t.name),
        type: (t.taskType as string) ?? null,
        state: String(t.state),
        startTime: (t.startTime as string) ?? null,
        endTime: (t.endTime as string) ?? null,
        duration: (t.duration as string) ?? null,
        host: (t.host as string) ?? null,
        retryTimes: (t.retryTimes as number) ?? null,
      }),
    );
  },

  async taskLog(conn, session, taskInstanceId) {
    const data = await ds<{ message?: string } | string>(conn, session, "GET", `/log/detail`, {
      query: { taskInstanceId, skipLineNum: 0, limit: 3000 },
    });
    if (typeof data === "string") return data;
    return data?.message ?? "";
  },

  async instanceAction(conn, session, projectCode, instanceId, action: InstanceAction) {
    const map: Record<InstanceAction, string> = {
      rerun: "REPEAT_RUNNING",
      "recover-failed": "START_FAILURE_TASK_PROCESS",
      pause: "PAUSE",
      resume: "RECOVER_SUSPENDED_PROCESS",
      stop: "STOP",
    };
    await ds(conn, session, "POST", `/projects/${projectCode}/executors/execute`, {
      form: { processInstanceId: instanceId, executeType: map[action] },
    });
  },

  async setWorkflowOnline(conn, session, projectCode, workflowCode, online) {
    await ds(conn, session, "POST", `/projects/${projectCode}/process-definition/${workflowCode}/release`, {
      form: { name: "", releaseState: online ? "ONLINE" : "OFFLINE" },
    });
  },

  async setScheduleOnline(conn, session, projectCode, scheduleId, online) {
    await ds(
      conn,
      session,
      "POST",
      `/projects/${projectCode}/schedule/${scheduleId}/${online ? "online" : "offline"}`,
    );
  },

  async runWorkflow(conn, session, projectCode, workflowCode) {
    await ds(conn, session, "POST", `/projects/${projectCode}/executors/start-process-instance`, {
      form: {
        processDefinitionCode: workflowCode,
        failureStrategy: "CONTINUE",
        warningType: "NONE",
        warningGroupId: 0,
        taskDependType: "TASK_POST",
        runMode: "RUN_MODE_SERIAL",
        processInstancePriority: "MEDIUM",
        workerGroup: "default",
        environmentCode: "",
        startNodeList: "",
        execType: "",
        scheduleTime: "",
        dryRun: 0,
      },
    });
  },

  async stopInstance(conn, session, projectCode, instanceId) {
    await ds(conn, session, "POST", `/projects/${projectCode}/executors/execute`, {
      form: { processInstanceId: instanceId, executeType: "STOP" },
    });
  },

  async projectStats(conn, session, projectCode): Promise<ProjectStats> {
    const now = new Date();
    const start = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
    const end = fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59));
    const data = await ds<{ totalCount: number; workflowInstanceStatusCounts?: { state: string; count: number }[] }>(
      conn,
      session,
      "GET",
      "/projects/analysis/process-state-count",
      { query: { projectCode, startDate: start, endDate: end } },
    );
    const counts = new Map<string, number>();
    for (const c of data.workflowInstanceStatusCounts ?? []) counts.set(c.state, c.count);
    const running = ["RUNNING_EXECUTION", "SUBMITTED_SUCCESS", "SERIAL_WAIT", "WAITING_THREAD", "DISPATCH", "DELAY_EXECUTION", "READY_PAUSE", "READY_STOP"]
      .reduce((n, s) => n + (counts.get(s) ?? 0), 0);
    return {
      total: data.totalCount ?? 0,
      success: counts.get("SUCCESS") ?? 0,
      failure: (counts.get("FAILURE") ?? 0) + (counts.get("NEED_FAULT_TOLERANCE") ?? 0),
      running,
    };
  },

  async saveSchedule(conn, session, projectCode, workflowCode, scheduleId, crontab) {
    const schedule = JSON.stringify({
      startTime: fmt(new Date()),
      endTime: "2125-01-01 00:00:00",
      crontab,
      /* 用这台机器的时区,不写死 Asia/Shanghai。
         理由不只是"换个国家就错了":定时编辑器里的「下次运行」预览是按本地时间
         算并显示的,这儿要是报给 DS 另一个时区,预览说 9 点、实际跑在别的点上,
         而且没有任何地方会提示对不上。让两边用同一个时区,预览才算数。 */
      timezoneId: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    const common = {
      schedule,
      failureStrategy: "CONTINUE",
      warningType: "NONE",
      warningGroupId: 0,
      processInstancePriority: "MEDIUM",
      workerGroup: "default",
    };
    const online = (id: number) =>
      ds(conn, session, "POST", `/projects/${projectCode}/schedule/${id}/online`);
    const offline = (id: number) =>
      ds(conn, session, "POST", `/projects/${projectCode}/schedule/${id}/offline`).catch(() => {});

    if (scheduleId == null) {
      await ds(conn, session, "POST", `/projects/${projectCode}/schedules`, {
        form: { processDefinitionCode: workflowCode, ...common },
      });
      /* 新建出来的定时默认是关着的,得回头查到 id 再打开。
         查不到就要说话 —— 界面上写着「保存后会自动开启定时」,这儿一声不吭地
         留在关闭状态,用户以为定时已经在跑了,其实一次都不会跑。 */
      const map = await scheduleMap(conn, session, projectCode);
      const s = map.get(String(workflowCode));
      if (!s) throw new Error("定时已创建,但没能在调度里找到它、因此没能开启 —— 请到 DolphinScheduler 里手动开启。");
      await online(s.scheduleId);
    } else {
      // DS won't update an online schedule — offline, update, then re-online
      await offline(scheduleId);
      await ds(conn, session, "PUT", `/projects/${projectCode}/schedules/${scheduleId}`, { form: common });
      await online(scheduleId);
    }
  },

  async backfill(conn, session, projectCode, workflowCode, startDate, endDate) {
    const scheduleTime = JSON.stringify({
      complementStartDate: `${startDate} 00:00:00`,
      complementEndDate: `${endDate} 00:00:00`,
    });
    await ds(conn, session, "POST", `/projects/${projectCode}/executors/start-process-instance`, {
      form: {
        processDefinitionCode: workflowCode,
        failureStrategy: "CONTINUE",
        warningType: "NONE",
        warningGroupId: 0,
        taskDependType: "TASK_POST",
        runMode: "RUN_MODE_SERIAL",
        processInstancePriority: "MEDIUM",
        workerGroup: "default",
        environmentCode: "",
        startNodeList: "",
        execType: "COMPLEMENT_DATA",
        scheduleTime,
        dryRun: 0,
      },
    });
  },
};
