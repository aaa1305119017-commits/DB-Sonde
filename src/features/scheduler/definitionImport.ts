import { dataxAdapter } from "../etl/adapters/datax";
import { type FileProfile, type SqlLineageParser, enrichTasks } from "../etl/fileCatalog";
import type { EtlJob } from "../etl/types";
import type { SchedulerConn, Workflow } from "./types";
export interface WorkflowDefinition {
  tasks: { code: string; name: string; type: string; params: Record<string, unknown>; }[];
  relations: { from: string; to: string; }[];
}
export async function importWorkflowDefinition(
  conn: SchedulerConn,
  projectCode: string,
  w: Workflow,
  definition: WorkflowDefinition,
  context: { parseSql: SqlLineageParser; files: EtlJob[]; previousJobs?: EtlJob[]; pathMappings?: FileProfile["pathMappings"]; },
): Promise<EtlJob[]> {
  const jobs: EtlJob[] = [];
  for (const task of definition.tasks) {
    const job: EtlJob = {
      id: `${conn.kind === "dolphinscheduler" ? "ds" : conn.kind}:${projectCode}:${w.code}:${task.code}`,
      name: task.name,
      kind: "generic",
      sources: [],
      targets: [],
      schedule: w.crontab ?? undefined,
      scheduler: {
        baseUrl: conn.baseUrl.replace(/\/+$/, ""),
        projectCode,
        workflowCode: w.code,
        workflowName: w.name,
        taskCode: task.code,
        upstreamTaskCodes: definition.relations.filter((r) => r.to === task.code && r.from !== "0").map((r) => r.from),
      },
      references: [],
      flows: [],
    };
    let parseFailed = false;
    if (task.type === "DATAX" && task.params.json) {
      try {
        const parsed = dataxAdapter.parse(String(task.params.json));
        job.flows = parsed.map((j) => ({ sources: j.sources, targets: j.targets }));
      } catch (e) {
        job.note = String(e);
        parseFailed = true;
      }
    }
    if (task.type === "SQL" && task.params.sql) {
      const result: Awaited<ReturnType<SqlLineageParser>> = await context.parseSql(
        String(task.params.sql),
        String(task.params.type ?? "").toLowerCase() || undefined,
      ).catch(() => ({ ok: false, sources: [] as string[] }));
      const ep = (table: string) => ({ kind: "db" as const, table });
      if (result.ok)
        job.flows = (result.flows ?? [{ sources: result.sources, targets: result.target ? [result.target] : [] }]).map((f) => ({ sources: f.sources.map(ep), targets: f.targets.map(ep) }));
      else {
        job.note = "SQL 无法静态解析，已保留任务及依赖";
        parseFailed = true;
      }
    }
    if (task.type === "SHELL" || task.type === "PYTHON") {
      const script = String(task.params.rawScript ?? " ");
      job.references = [...new Set(script.match(/[\w./${}-]+\.(?:json|sql|sh|py|ktr|kjb)\b/g) ?? [])];
      job.note = "已读取任务定义；通过脚本引用关联文件目录";
    }
    job.sources = job.flows?.flatMap((f) => f.sources) ?? [];
    job.targets = job.flows?.flatMap((f) => f.targets) ?? [];
    if (parseFailed) {
      const previous = context.previousJobs?.find(previous => previous.id === job.id);
      if (previous) {
        job.sources = previous.sources;
        job.targets = previous.targets;
        job.flows = previous.flows;
        job.note += "；沿用上次数据流，尚未重新验证";
      }
    }
    jobs.push(job);
  }
  return context.files.length ? enrichTasks(jobs, context.files, context.pathMappings) : jobs;
}
