import type { EtlSource } from "../etl/types";
import type { Instance, RunHealthState, SchedulerConn, Task, Workflow } from "../scheduler/types";
import { tableId, taskNodeId, workflowNodeId, type Graph } from "./lineageModel";
import { parseRunTime } from "./opsModel";
import type { NodeHealth, OpsSnapshot } from "./opsTypes";

export interface SchedulerObservation {
  connection: Pick<SchedulerConn, "baseUrl" | "kind">;
  projectCode: string;
  workflows: Workflow[];
  instances: Instance[];
  tasks: Task[];
}
const address = (value: string) => value.replace(/\/+$/, "");
export function schedulerScope(input: SchedulerObservation): string {
  return JSON.stringify([input.connection.kind, address(input.connection.baseUrl), input.projectCode]);
}
function runHealth(run: Instance | Task, instance: Instance | undefined, now: number,
  classify: (raw: string) => RunHealthState, label: string): NodeHealth {
  const command = instance?.commandType?.toUpperCase() ?? "";
  return {
    state: classify(run.state), lastRun: run.startTime ?? undefined, duration: run.duration ?? undefined,
    retries: run.retryTimes ?? undefined,
    rerun: /COMPLEMENT|RECOVER|RERUN/.test(command) || (instance?.retryTimes ?? 0) > 0,
    message: `${label}：${run.state}`, checkedAt: now,
  };
}

/** Translate scheduler observations to the generic node overlay contract. */
export function schedulerOpsSnapshot(input: SchedulerObservation, sources: EtlSource[], graph: Graph, now: number,
  classify: (raw: string) => RunHealthState = () => "unknown"): OpsSnapshot {
  const snapshot: OpsSnapshot = { scope: schedulerScope(input), nodes: {} };
  const visible = new Set(graph.nodes.map(node => node.id));
  const jobs = sources.flatMap(source => source.jobs);
  const producers = new Map<string, Set<string>>();
  for (const job of jobs) for (const target of job.targets) {
    if (!target.table) continue;
    const id = tableId(target.database, target.table);
    if (!producers.has(id)) producers.set(id, new Set());
    producers.get(id)!.add(taskNodeId(job));
  }
  for (const job of jobs) {
    const ref = job.scheduler;
    if (!ref || address(ref.baseUrl) !== address(input.connection.baseUrl) || ref.projectCode !== input.projectCode) continue;
    const workflow = input.workflows.find(workflow => workflow.code === ref.workflowCode);
    if (!workflow) continue;
    const latest = input.instances.filter(instance => instance.workflowCode === workflow.code)
      .sort((a, b) => (parseRunTime(b.startTime) || 0) - (parseRunTime(a.startTime) || 0) || b.id - a.id)[0];
    const task = latest ? input.tasks.filter(task => task.taskCode === ref.taskCode && task.instanceId === latest.id)
      .sort((a, b) => b.id - a.id)[0] : undefined;
    const workflowId = workflowNodeId(job);
    const targets = new Set(job.targets.filter(target => target.table).map(target => tableId(target.database, target.table)));
    for (const id of new Set([taskNodeId(job), workflowId, ...targets])) {
      if (!visible.has(id)) continue;
      const ambiguous = targets.has(id) && (producers.get(id)?.size ?? 0) > 1;
      const run = id === workflowId ? latest : task;
      snapshot.nodes[id] = {
        ops: ambiguous ? { origin: "scheduler", note: "多个生产任务，请查看上游任务的各自运行状态" }
          : {
            origin: "scheduler", schedule: workflow.crontab ?? undefined, scheduleHuman: workflow.cronHuman ?? undefined,
            online: workflow.online, scheduled: workflow.scheduled
          },
        health: !ambiguous && run ? runHealth(run, latest, now, classify, id === workflowId ? "工作流" : `任务 ${job.name}`) : undefined,
      };
    }
  }
  return snapshot;
}
