import { entityId } from "./entityStore";
import { nodeKindOf } from "../lineage/lineageStore";
import type { Graph } from "../lineage/lineageStore";
import { outputColumns, sqlSourceTables, fieldsUsedOn } from "../lineage/sqlColumns";
import type { EtlJob, EtlSource } from "../etl/types";
import type { Metric } from "../metrics/metricsStore";
import { compareText } from "../../lib/collate";

export interface JobFact { src: string; job: EtlJob; from: string[]; cols: string[] }
export interface MetricFact { id: string; name: string; unit?: string; caliber?: string; fields: string[] }
export interface EntityFacts {
  id: string;
  up: string[];
  downTables: string[];
  metrics: MetricFact[];
  producedBy: JobFact[];
}

/* 给 AI 的不是一串名字,而是一张能推理的结构表:
   作业带上「从哪读 / 灌哪几列」(否则七个同名作业在提示词里就是七次重复),
   指标按字段聚合(138 个名字既塞不下也没信息量 —— 真正有用的是"哪一列被多少
   指标吃着",那才是改表时会踩到谁的依据)。 */
export function buildEntityPrompt(d: EntityFacts, connName: string): string {

  const jobLines = d.producedBy.slice(0, 30).map((p) => {
    const from = p.from.length ? ` ← ${p.from.join("、")}` : "";
    const cols = p.cols.length ? `,灌 ${p.cols.join("、")}` : "";
    return `- [${p.src}] ${p.job.name}${from}${cols}`;
  });
  const byField = new Map<string, string[]>();
  let unknown = 0;
  for (const m of d.metrics) {
    if (m.fields.length === 0) { unknown++; continue; }
    for (const f of m.fields) {
      const bucket = byField.get(f); if (bucket) bucket.push(m.name); else byField.set(f, [m.name]);
    }
  }
  /* 几乎每个指标都读的字段(日期键、主键这类)单独拎一行,不混进下面的清单 ——
     它们在清单里永远排第一,把真正有区分度的列挤到看不见的地方。
     但也不能直接扔:改这种字段恰恰是波及面最大的,得让模型知道。
     判断靠**占比**,不靠字段名。原来这儿写死 ["stat_date","store_id"],
     换个公司(trade_date / account_id)就既剔不掉、又把人家的主键当成了信号。 */
  const analysed = d.metrics.length - unknown;
  const isShared = (count: number) => analysed >= 8 && count >= analysed * 0.9;
  const ranked = [...byField.entries()].sort((a, b) => b[1].length - a[1].length);
  const sharedKeys = ranked.filter(([, names]) => isShared(names.length));
  const distinctive = ranked.filter(([, names]) => !isShared(names.length));
  const fieldLines = distinctive
    .slice(0, 25)
    .map(([f, names]) => `- ${f} — ${names.length} 个指标(${names.slice(0, 5).join("、")}${names.length > 5 ? " 等" : ""})`);
  if (distinctive.length > 25) fieldLines.push(`(还有 ${distinctive.length - 25} 个字段未列出)`);

  const lines = [
    `关于数据表 ${d.id}(连接:${connName}),以下是它的血缘现状:`,
    "",
    d.producedBy.length ? `【谁在灌它】共 ${d.producedBy.length} 条作业` : null,
    ...jobLines,
    d.producedBy.length > 30 ? `(还有 ${d.producedBy.length - 30} 条未列出)` : null,
    "",
    d.up.length ? `【上游表】${d.up.join("、")}` : null,
    d.downTables.length ? `【下游表】${d.downTables.join("、")}` : null,
    "",
    d.metrics.length ? `【建在它上的指标】共 ${d.metrics.length} 个,按它们读到的字段归类:` : null,
    sharedKeys.length ? `- (共用键,几乎每个指标都读)${sharedKeys.map(([f, names]) => `${f} — ${names.length} 个`).join("、")}` : null,
    ...fieldLines,
    unknown ? `(另有 ${unknown} 个指标没解析出具体字段)` : null,
    "",
    "请基于以上信息回答两件事:",
    "1. 这张表的数据是怎么拼出来的 —— 哪几条作业各负责哪一块,它们之间有没有重叠或冲突;",
    "2. 要改它(加列、改口径、停掉某条作业、回刷历史)需要注意什么、会波及哪些指标。",
    "只做只读分析,不要给建表或刷数的 SQL。",
  ].filter((l): l is string => l !== null);
  return lines.join("\n");
}

const epId = (e: { database?: string; table?: string; path?: string }) =>
  e.table ? entityId(e.database, e.table) : e.path ? `file:${e.path}` : "";

/** 把一张表的血缘事实收拢成结构化数据 —— 面板和给 AI 的提示词共用同一份。 */
export function collectEntityFacts(
  target: { database?: string; table: string },
  graph: Graph,
  etlSources: EtlSource[],
  catalog: Metric[],
): EntityFacts & { consumedBy: JobFact[] } {
  const id = entityId(target.database, target.table);
  const upEdges = graph.up.get(id) ?? [];
  const downEdges = graph.down.get(id) ?? [];
  // 上下游只列「表」这类业务对象。作业(task/workflow)和脚本文件(file)在下面
  // 有专门的区块显示真实作业名 —— 混进来既重复,又会把 task:local:xxx 这种
  // 内部 ID 直接怼到脸上,没人看得懂。
  const isTable = (n: string) => nodeKindOf(n) === "table";
  const up = [...new Set(upEdges.map((e) => e.from))].filter(isTable);
  const downAll = [...new Set(downEdges.map((e) => e.to))];
  /* 指标原来直接把内部 id(v1:tcsl_gmv_daily_store_avg)怼在脸上。换成中文名,
     并算出它到底读了这张表的哪几个字段 —— 悬停就能看见,不用去指标中心翻口径。 */
  const metrics = downAll
    .filter((n) => n.startsWith("metric:"))
    .map((n) => {
      const mid = n.slice(7);
      const m = catalog.find((x) => x.id === mid);
      const sql = m ? `${JSON.stringify(m.queryPlan ?? "")} ${m.sql ?? ""}` : "";
      return { id: mid, name: m?.name ?? mid, unit: m?.unit, caliber: m?.caliber, fields: sql ? fieldsUsedOn(sql, id) : [] };
    })
    .sort((a, b) => compareText(a.name, b.name));
  const downTables = downAll.filter((n) => !n.startsWith("metric:")).filter(isTable);

  // ETL jobs that produce / consume this entity (from the ETL center, live)
  /* 灌同一张宽表的 DataX 作业,文件名清一色就是目标表名 —— 列出来七行一模一样,
     看着像重复。真正区分它们的是「从哪读、灌哪几列」,补一行写清楚。 */
  const describe = (job: EtlJob) => {
    const sql = (job.flows ?? [job]).flatMap((f) => f.sources.map((e) => e.querySql ?? "")).filter(Boolean).join("\n");
    const from = sql
      ? sqlSourceTables(sql)
      : (job.flows ?? [job]).flatMap((f) => f.sources.map((e) => (e.kind === "file" ? (e.path ?? "") : [e.database, e.table].filter(Boolean).join(".")))).filter(Boolean);
    // rn 之类是窗口函数的中间别名,不是真产出列。
    // 「每条入口都写的列没有区分度」那一条移到下面按数据算 —— 见 dropCommonCols。
    const cols = sql ? [...outputColumns(sql)].filter((c) => c.length > 3) : [];
    // information_schema 是脚本用来探列是否存在的,不是数据来源
    return { from: [...new Set(from)].filter((t) => !t.startsWith("information_schema.")), cols };
  };
  /**
   * 每条作业都写的列剔掉 —— 列出来只是重复,真正区分这几条作业的是各自独有的那些。
   *
   * 原来是写死 `["stat_date","store_id","etl_time"]`。意图没错(日期键、主键、
   * 落库时间每条入口都写),但换个公司就成了两头落空:人家的 trade_date 剔不掉,
   * 而 store_id 要是人家真正的业务列反倒被吞了。改成按这批作业自己算:
   * 有两条以上作业时,取它们产出列的交集当"共有部分"扣掉;只有一条作业时
   * 没有可比对象,原样保留。
   */
  const dropCommonCols = <T extends { cols: string[] }>(entries: T[]): T[] => {
    if (entries.length < 2) return entries;
    const withCols = entries.filter((e) => e.cols.length);
    if (withCols.length < 2) return entries;
    const common = withCols.reduce<Set<string>>(
      (acc, e) => new Set(e.cols.filter((c) => acc.has(c))),
      new Set(withCols[0].cols),
    );
    if (!common.size) return entries;
    return entries.map((e) => ({ ...e, cols: e.cols.filter((c) => !common.has(c)) }));
  };
  const producedBy: { src: string; job: EtlJob; from: string[]; cols: string[] }[] = [];
  const consumedBy: { src: string; job: EtlJob; from: string[]; cols: string[] }[] = [];
  for (const s of etlSources) {
    for (const job of s.jobs) {
      if (job.targets.some((e) => epId(e) === id)) producedBy.push({ src: s.name, job, ...describe(job) });
      if (job.sources.some((e) => epId(e) === id)) consumedBy.push({ src: s.name, job, ...describe(job) });
    }
  }
  return { id, up, downTables, metrics, producedBy: dropCommonCols(producedBy), consumedBy: dropCommonCols(consumedBy) };
}
