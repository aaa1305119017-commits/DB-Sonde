import type { Provider, SchedulerKind } from "./types";
import { dolphinscheduler } from "./dolphinscheduler";

/** A reserved slot for a scheduler we will support but haven't wired yet. */
function reserved(kind: SchedulerKind, label: string, blurb: string): Provider {
  const soon = async (): Promise<never> => {
    throw new Error(`${label} 接入即将支持`);
  };
  return {
    kind,
    label,
    blurb,
    available: false,
    capabilities: { hasProjects: false, run: false, stop: false, toggleOnline: false },
    authFields: [{ key: "baseUrl", label: "地址" }],
    connect: soon,
    listProjects: soon,
    listWorkflows: soon,
    listInstances: soon,
    runWorkflow: soon,
    stopInstance: soon,
  };
}

/** The registry. New schedulers slot in here; the UI enumerates it. */
export const providers: Record<SchedulerKind, Provider> = {
  dolphinscheduler,
  airflow: reserved("airflow", "Airflow", "REST 监控 / 触发 · DAG 模板生成"),
  kettle: reserved("kettle", "Kettle / PDI", "Carte 远程执行 · 跑 / 停 / 看"),
  xxljob: reserved("xxljob", "XXL-Job", "轻量分布式任务调度"),
  other: reserved("other", "其他 / 自定义", "更多 ETL 调度陆续接入"),
};

export const providerList: Provider[] = Object.values(providers);
export const getProvider = (kind: SchedulerKind): Provider => providers[kind];
