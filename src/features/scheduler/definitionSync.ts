import type { FileProfile, SqlLineageParser } from "../etl/fileCatalog";
import { schedulerFileScope } from "../etl/fileScope";
import type { EtlSource } from "../etl/types";
import { importWorkflowDefinition } from "./definitionImport";
import type { Provider, SchedulerConn, Session, Workflow } from "./types";

export interface DefinitionSyncPort {
  sources(): EtlSource[];
  profiles(): FileProfile[];
  parseSql: SqlLineageParser;
  publish(source: EtlSource): void;
  now(): number;
}
export interface DefinitionRequest {
  connection: SchedulerConn;
  session: Session;
  provider: Provider;
  projectCode: string;
  projectName: string;
  workflows?: Workflow[];
  isCurrent(): boolean;
}
/** Fetch/parse/publish pipeline. Superseded requests stop at every asynchronous boundary. */
export async function synchronizeDefinitions(request: DefinitionRequest, port: DefinitionSyncPort): Promise<string | null> {
  const { connection, session, provider, projectCode, isCurrent } = request;
  if (!isCurrent()) return null;
  if (!provider.getDefinition) return "当前调度适配器尚未提供任务定义";
  // Preserve installed DolphinScheduler source identities; other providers have their own namespace.
  const namespace = connection.kind === "dolphinscheduler" ? "ds" : connection.kind;
  const sourceId = `${namespace}:${connection.baseUrl.replace(/\/+$/, "")}:${projectCode}`;
  const sources = port.sources();
  const previous = sources.find(source => source.id === sourceId);
  const context = {
    parseSql: port.parseSql, previousJobs: previous?.jobs,
    ...schedulerFileScope(connection.baseUrl, sources, port.profiles())
  };
  const workflows = request.workflows ?? await provider.listWorkflows(connection, session, projectCode);
  if (!isCurrent()) return null;
  const jobs: EtlSource["jobs"] = [], errors: string[] = [];
  for (const workflow of workflows) {
    if (!isCurrent()) return null;
    try {
      const definition = await provider.getDefinition(connection, session, projectCode, workflow.code);
      if (!isCurrent()) return null;
      const parsed = await importWorkflowDefinition(connection, projectCode, workflow, definition, {
        ...context,
        parseSql: async (sql, dialect) => isCurrent() ? port.parseSql(sql, dialect) : { ok: false, sources: [] },
      });
      if (!isCurrent()) return null;
      jobs.push(...parsed);
    } catch (error) {
      if (!isCurrent()) return null;
      errors.push(`${workflow.name}: ${String(error)}`);
      jobs.push(...(previous?.jobs.filter(job => job.scheduler?.workflowCode === workflow.code) ?? []));
    }
  }
  if (!isCurrent()) return null;
  port.publish({ id: sourceId, name: `${connection.name} · ${request.projectName}`, kind: "generic", jobs, updatedAt: port.now() });
  return `已同步 ${jobs.length} 个任务、${workflows.length} 个工作流${errors.length ? `；${errors.length} 个失败，保留上次结果：${errors.join("；")}` : ""}`;
}
