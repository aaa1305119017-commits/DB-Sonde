/** ETL 中心 —— 可插拔的 ETL 接入层。
 *
 *  和调度中心一样:每种 ETL 工具 = 一个 Adapter,UI 按能力自适应。Sonde 只
 *  是客户端 —— 用户把配置(DataX JSON、脚本…)喂进来,本地解析成统一的作业模型,
 *  不去连、不写入任何服务器。解析出的 源→目标 就是血缘的源头段。
 *  绝不写死任何一家公司的表名 / 路径 —— 只认通用格式。 */

export type EtlKind = "datax" | "airflow" | "kettle" | "sqoop" | "generic";

/** A data endpoint an ETL job reads from or writes to. */
export interface Endpoint {
  kind: "db" | "file" | "unknown";
  system?: string; // mysql / oracle / hdfs / txt / clickhouse … (from reader/writer)
  host?: string; // host:port parsed from a jdbcUrl (never credentials)
  database?: string;
  table?: string;
  querySql?: string; // reader that pulls via a SELECT — real source is inside it (parse w/ sqlglot)
  path?: string; // for file endpoints
  detail?: string; // raw jdbcUrl / path, for display
}

/** One normalized ETL job: what it reads, what it writes, when it runs. */
export interface EtlJob {
  id: string;
  name: string;
  kind: EtlKind;
  sources: Endpoint[];
  targets: Endpoint[];
  schedule?: string; // cron / hint, if the config carries it
  note?: string;
  references?: string[];
  flows?: { sources: Endpoint[]; targets: Endpoint[] }[];
  scheduler?: {
    baseUrl: string; projectCode: string; workflowCode: string; workflowName: string;
    taskCode: string; upstreamTaskCodes: string[];
  };
}

/** A registered ETL source — a named bundle of jobs the user imported. */
export interface EtlSource {
  id: string;
  name: string;
  kind: EtlKind;
  jobs: EtlJob[];
  updatedAt: number;
  fieldMapping?: EtlFieldMapping;
  capturedAt?: string;
  schedulerBaseUrl?: string;
}

/** An adapter turns a tool's config text into normalized jobs. Adding a tool =
 *  one adapter; the registry + UI adapt. `available:false` = reserved slot. */
export interface EtlAdapter {
  kind: EtlKind;
  label: string;
  blurb: string;
  available: boolean;
  /** How the user supplies config, e.g. "粘贴一个 DataX 作业 JSON". */
  inputHint: string;
  /** Parse pasted/imported config text into jobs. Throw with a clear message. */
  supportsMapping?: boolean;
  example?: string;
  parse(text: string, mapping?: EtlFieldMapping): EtlJob[];
}

/** Mapping belongs to this client. External documents remain unchanged. Paths are JSON pointers. */
export interface EtlFieldMapping {
  jobs: string;
  id: string;
  name: string;
  sources: string;
  targets: string;
  schedule?: string;
  references?: string;
  endpoint?: Partial<Record<keyof Endpoint, string>>;
}
