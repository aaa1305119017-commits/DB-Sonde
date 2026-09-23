import { nanoid } from "nanoid";
import type { Endpoint, EtlAdapter, EtlJob } from "../types";
import { nameJob, parseJdbc } from "./shared";
import { child, childText, children, findAll, parseXml, type XmlNode } from "./xml";

/* Kettle / PDI(Pentaho Data Integration)接入。
 *
 * .ktr 是「转换」:一堆步骤 + 步骤之间的连线(hop)。
 * .kjb 是「作业」:按顺序调若干 .ktr / .kjb / SQL / 脚本。
 *
 * Sonde 只解析文件,不连 Kettle 的资源库、不改任何文件。 */

/** 数据库连接定义:<connection> 在文件顶层,步骤里用名字引用它。 */
interface Conn { system?: string; host?: string; database?: string }

function readConnections(root: XmlNode): Map<string, Conn> {
  const out = new Map<string, Conn>();
  // 顶层的 <connection> 才是定义(步骤里的 <connection> 只是个名字)
  for (const node of children(root, "connection")) {
    const name = childText(node, "name");
    if (!name) continue;
    const system = (childText(node, "type") || undefined)?.toLowerCase();
    const server = childText(node, "server");
    const port = childText(node, "port");
    const database = childText(node, "database") || undefined;
    /* server/port/database 在 Kettle 里常写成 ${VAR} —— 那不是主机名。
       复用 parseJdbc 的判断:拼成一个 jdbc 形状交给它,占位符会被它滤掉。 */
    const host = server ? parseJdbc(`jdbc://${port ? `${server}:${port}` : server}/x`).host : undefined;
    out.set(name, { system, host, database });
  }
  return out;
}

/**
 * 步骤类型 → 它是读还是写。
 *
 * 认不出的类型**两边都不算**(既不当源也不当目标)—— 一个没见过的步骤类型
 * 多半是转换/计算(字段选择、排序、JS 脚本),把它当成端点会凭空多出一条血缘。
 * 宁可少一条。新增类型时往这两张表里加。
 */
const READERS = new Set([
  "TableInput", "CsvInput", "TextFileInput", "ExcelInput", "JsonInput", "XMLInputStream",
  "GetXMLData", "LoadFileInput", "FixedInput", "PropertyInput", "AccessInput", "YamlInput",
  "HadoopFileInput", "ParquetInput", "AvroInput", "OrcInput", "MongoDbInput", "SalesforceInput",
  "GetFileNames", "ExecSQL", "DatabaseLookup", "DynamicSQLRow",
]);
const WRITERS = new Set([
  "TableOutput", "InsertUpdate", "Update", "Delete", "SynchronizeAfterMerge",
  "TextFileOutput", "ExcelOutput", "ExcelWriter", "JsonOutput", "XMLOutput",
  "HadoopFileOutput", "ParquetOutput", "AvroOutput", "OrcOutput", "MongoDbOutput",
  "MySQLBulkLoader", "PGBulkLoader", "OraBulkLoader", "SalesforceInsert", "SalesforceUpdate",
]);
/** 维度查找这类既读又写:查不到就插一条新维度行。 */
const BOTH = new Set(["DimensionLookup", "CombinationLookup"]);

/** 从一个步骤里读出它碰的文件路径(Kettle 有好几种写法)。 */
function stepFiles(step: XmlNode): string[] {
  const out: string[] = [];
  const direct = childText(step, "filename");
  if (direct) out.push(direct);
  for (const file of children(step, "file")) {
    for (const nameNode of children(file, "name")) {
      const value = nameNode.text.trim();
      if (value) out.push(value);
    }
    const single = childText(file, "filename");
    if (single) out.push(single);
  }
  return out;
}

/** 一个步骤对应的端点。读不出有意义的东西就返回空数组。 */
function stepEndpoints(step: XmlNode, conns: Map<string, Conn>): Endpoint[] {
  const type = childText(step, "type");
  const files = stepFiles(step);
  if (files.length) {
    return files.map((path) => ({ kind: "file" as const, system: type.toLowerCase(), path, detail: path }));
  }

  const connName = childText(step, "connection");
  const conn = conns.get(connName) ?? {};
  const sql = childText(step, "sql");
  // 表名可能直接挂在步骤上,也可能在 <lookup> 里(InsertUpdate / Update / Delete)
  const table = childText(step, "table") || childText(child(step, "lookup"), "table");
  const schema = childText(step, "schema") || childText(child(step, "lookup"), "schema");

  if (!table && !sql && !connName) return [];
  return [{
    kind: "db",
    system: conn.system,
    host: conn.host,
    // <schema> 是库/模式名,比连接上配的那个更贴近这一步实际写哪儿
    database: schema || conn.database,
    table: table || undefined,
    querySql: !table && sql ? sql : undefined,
    detail: connName || undefined,
  }];
}

/**
 * 按 hop(步骤连线)把步骤分成连通分量。
 *
 * 一个 .ktr 里放两条互不相干的流水是常事。把「所有输入 → 所有输出」连起来,
 * 会造出四条边,其中两条根本不存在 —— 而血缘图上没人看得出哪两条是假的。
 * 所以按连线分组,一组一条 flow。没有连线信息(极少见)就退回整体一组。
 */
function components(stepNames: string[], root: XmlNode): string[][] {
  const parent = new Map(stepNames.map((n) => [n, n]));
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) { const next = parent.get(x)!; parent.set(x, r); x = next; }
    return r;
  };
  const union = (a: string, b: string) => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  let hops = 0;
  for (const hop of findAll(root, "hop")) {
    // 停用的连线不算 —— 它在 Kettle 里确实不传数据
    if (childText(hop, "enabled").toUpperCase() === "N") continue;
    const from = childText(hop, "from"), to = childText(hop, "to");
    if (from && to) { union(from, to); hops += 1; }
  }
  if (!hops) return stepNames.length ? [stepNames] : [];
  const groups = new Map<string, string[]>();
  for (const name of stepNames) {
    const key = find(name);
    const bucket = groups.get(key);
    if (bucket) bucket.push(name); else groups.set(key, [name]);
  }
  return [...groups.values()];
}

/** 一个 <transformation> → 一个作业。 */
function transformationToJob(root: XmlNode): EtlJob {
  const conns = readConnections(root);
  const name = childText(child(root, "info"), "name") || childText(root, "name") || "转换";

  const steps = children(root, "step");
  const byName = new Map<string, { node: XmlNode; type: string; endpoints: Endpoint[] }>();
  for (const step of steps) {
    const stepName = childText(step, "name");
    if (!stepName) continue;
    byName.set(stepName, { node: step, type: childText(step, "type"), endpoints: stepEndpoints(step, conns) });
  }

  const flows: { sources: Endpoint[]; targets: Endpoint[] }[] = [];
  for (const group of components([...byName.keys()], root)) {
    const sources: Endpoint[] = [];
    const targets: Endpoint[] = [];
    for (const stepName of group) {
      const step = byName.get(stepName);
      if (!step || !step.endpoints.length) continue;
      if (READERS.has(step.type) || BOTH.has(step.type)) sources.push(...step.endpoints);
      if (WRITERS.has(step.type) || BOTH.has(step.type)) targets.push(...step.endpoints);
    }
    if (sources.length || targets.length) flows.push({ sources, targets });
  }

  const sources = flows.flatMap((f) => f.sources);
  const targets = flows.flatMap((f) => f.targets);
  const unknown = [...byName.values()].filter((s) => s.endpoints.length && !READERS.has(s.type) && !WRITERS.has(s.type) && !BOTH.has(s.type));
  return {
    id: nanoid(8),
    name,
    kind: "kettle",
    sources,
    targets,
    // 一条流的时候 flows 没有额外信息,别重复存一遍
    flows: flows.length > 1 ? flows : undefined,
    note: unknown.length ? `${unknown.length} 个步骤类型还没认到(${unknown.slice(0, 3).map((s) => s.type).join("、")}),它们碰的数据没算进血缘` : undefined,
  };
}

/** 一个 <job>(.kjb)→ 一个作业。它的活是调别的文件,所以重点是 references。 */
function jobToJob(root: XmlNode): EtlJob {
  const conns = readConnections(root);
  const name = childText(root, "name") || childText(child(root, "info"), "name") || "作业";
  const sources: Endpoint[] = [];
  const targets: Endpoint[] = [];
  const references: string[] = [];

  for (const entry of findAll(root, "entry")) {
    const type = childText(entry, "type").toUpperCase();
    if (type === "TRANS" || type === "JOB") {
      // 指向哪个文件:优先 filename,其次资源库里的名字
      const ref = childText(entry, "filename") || childText(entry, "transname") || childText(entry, "jobname");
      if (ref) references.push(ref);
      continue;
    }
    if (type === "SQL") {
      const sql = childText(entry, "sql");
      const conn = conns.get(childText(entry, "connection")) ?? {};
      /* 这条 SQL 可能是 TRUNCATE、也可能是 INSERT ... SELECT。放进 querySql,
         由血缘那一层用 sqlglot 去解析里面到底读了写了哪些表 —— 这儿不猜。 */
      if (sql) sources.push({ kind: "db", system: conn.system, host: conn.host, database: conn.database, querySql: sql });
      continue;
    }
    // 文件类的动作(复制/删除/校验)也算碰了数据
    for (const path of stepFiles(entry)) targets.push({ kind: "file", system: type.toLowerCase(), path, detail: path });
  }

  return {
    id: nanoid(8), name, kind: "kettle", sources, targets,
    references: references.length ? [...new Set(references)] : undefined,
    note: references.length ? `调用了 ${references.length} 个转换/作业` : undefined,
  };
}

export const kettleAdapter: EtlAdapter = {
  kind: "kettle",
  label: "Kettle / PDI",
  blurb: "Pentaho · 解析 .ktr 步骤与 .kjb 调用关系",
  available: true,
  inputHint: "粘贴 .ktr 或 .kjb 的 XML(可以一次贴多个文件,首尾相接即可)",
  example: `<transformation>
  <info><name>加载日汇总</name></info>
  <connection><name>prod</name><type>MYSQL</type>
    <server>192.0.2.2</server><port>3306</port><database>dws</database></connection>
  <step><name>读明细</name><type>TableInput</type><connection>prod</connection>
    <sql>SELECT store_id, gmv FROM dws_outlet_day</sql></step>
  <step><name>写汇总</name><type>TableOutput</type><connection>prod</connection>
    <schema>ads</schema><table>ads_outlet_day</table></step>
  <order><hop><from>读明细</from><to>写汇总</to><enabled>Y</enabled></hop></order>
</transformation>`,
  parse(text: string): EtlJob[] {
    const roots = parseXml(text);
    const jobs: EtlJob[] = [];
    for (const root of roots) {
      if (root.tag === "transformation") jobs.push(transformationToJob(root));
      else if (root.tag === "job") jobs.push(jobToJob(root));
    }
    if (!jobs.length) {
      throw new Error("没找到 <transformation> 或 <job> —— 请贴 .ktr / .kjb 的完整 XML");
    }
    // 名字没读出来的,用「源 → 目标」兜一下,列表里才不是一排「转换」
    return jobs.map((job) =>
      job.name === "转换" || job.name === "作业"
        ? { ...job, name: nameJob(job.sources, job.targets, job.name) }
        : job);
  },
};
