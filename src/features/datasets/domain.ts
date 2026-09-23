import { scanSql } from "../../lib/sql";
/**
 * 数据集 —— 看板取数的唯一来源。
 *
 * 一个数据集就是一张「宽表」:要么直接写 SQL,要么用主表 + 关联表拼出来。它自带
 * 字段清单(维度/度量),组件只管挑数据集、再从它的字段里选维度和度量。
 *
 * 数据集是全局的,不属于任何一张看板 —— 同一份口径在多张看板里复用,改一处处处生效。
 * 指标中心与此无关:那是独立的指标管理,不参与看板取数。
 */
import { nanoid } from "nanoid";
import { qualifiedTable, quoteIdent, sqlLiteral } from "../../lib/sql";
import type { DbKind } from "../../types";

export const DATASET_SCHEMA_VERSION = 1;

export type DatasetFieldRole = "dimension" | "measure";
export type DatasetJoinKind = "inner" | "left";
/** 关联条件的比较方式。绝大多数是等值,但对账、区间匹配用得上别的。 */
export type DatasetJoinOp = "=" | "<>" | ">" | ">=" | "<" | "<=";
export const JOIN_OPS: DatasetJoinOp[] = ["=", "<>", ">", ">=", "<", "<="];

/** 一条关联条件。第一条不带 connector,后面的靠它和前一条相连。 */
export interface DatasetJoinCond {
  field: string;
  op?: DatasetJoinOp;
  targetAlias: string;
  targetField: string;
  connector?: "and" | "or";
}

export interface DatasetField {
  /** 查询里用的列名(join 数据集里是输出列名,已消歧)。 */
  name: string;
  /** 中文显示名,只影响界面。 */
  label?: string;
  role: DatasetFieldRole;
  /** 数据库报出来的类型,用于推断角色和格式化。 */
  type?: string;
  /** 不保留的字段:不进 SELECT,组件里也挑不到它。一张宽表几十上百列,真正要用的
   *  往往不到十个,全带上只会让选字段变成翻墙。 */
  hidden?: boolean;
  /** 来自哪张表(别名)。关联数据集按它分组,单表/SQL 数据集为空。 */
  from?: string;
  /** 原始列名。重名时输出列会被改名,取数仍要按原名引用。 */
  column?: string;
  /** 这个度量默认怎么汇总。组件用它作默认值,仍可单独改。 */
  defaultAgg?: import("./widgetQuery").AggKind;
  /**
   * 计算字段的表达式,基于本数据集里已有的列,例如 `offline_gmv_amt + online_gmv_amt`。
   * 有它就不是原始列:不从表里取,而是在 SELECT 里算出来。
   */
  expr?: string;
  /** 分组字段的规则:把某个字段的取值归类。生成 CASE WHEN。 */
  grouping?: DatasetGrouping;
}

/** 分组字段:把一列的取值归成几档,比如把网点等级归成「直营/加盟」。 */
export interface DatasetGrouping {
  /** 依据哪个字段分组。 */
  source: string;
  /** 每一组:组名 + 命中的取值。 */
  buckets: Array<{ label: string; values: string[] }>;
  /** 都没命中时归到哪 —— 留空则为 NULL。 */
  fallback?: string;
}

/** 画布上的位置。没有就按加入顺序自动摆,人拖过之后记住。 */
export interface DatasetNodePos { x: number; y: number }

/** 关联到主表(或已加入的某张表)上的一张表。 */
export interface DatasetJoinNode {
  id: string;
  schema?: string;
  table: string;
  alias: string;
  kind: DatasetJoinKind;
  /** 关联条件。多条之间用各自的 connector 相连(默认 AND)。 */
  on: DatasetJoinCond[];
  pos?: DatasetNodePos;
}

export interface DatasetSourceSql {
  kind: "sql";
  sql: string;
}

export interface DatasetSourceJoin {
  kind: "join";
  base: { schema?: string; table: string; alias: string; pos?: DatasetNodePos };
  joins: DatasetJoinNode[];
  /** 要输出的列;为空表示各表全选(`alias.*`)。 */
  columns: Array<{ alias: string; field: string; as?: string }>;
}

export type DatasetSource = DatasetSourceSql | DatasetSourceJoin;

export interface Dataset {
  schemaVersion: number;
  id: string;
  name: string;
  description?: string;
  connectionId: string;
  database?: string;
  source: DatasetSource;
  fields: DatasetField[];
  updatedAt: string;
}

/**
 * 这一列是不是时间。
 *
 * 只看类型不够:很多表把日期存成 varchar('2026-09-17') 或整数(20260917),SQLite 干脆
 * 全是 TEXT —— 光看类型会把它们当普通字符串,时间粒度和「数据日期」筛选就都失灵。
 * 名字同样算数,这类列的命名相当一致。
 */
export function isTimeField(field: { name: string; type?: string } | undefined): boolean {
  if (!field) return false;
  if (/date|time|timestamp|year|month/i.test(field.type ?? "")) return true;
  return /(^|_)(date|time|dt|day|month|year|week|hour)(_|$)|日期|时间/i.test(field.name);
}

/**
 * 字段默认算维度还是度量。探测完给个默认,用户可以改。
 *
 * 光看类型不够:主键和外键几乎都是整数,但没人会把 store_id 求和 —— 一张宽表里这种
 * 列能有十几个,全判成度量等于让人挨个改回来。名字比类型更能说明它是什么。
 */
export function inferRole(type: string | undefined, name?: string): DatasetFieldRole {
  const n = (name ?? "").toLowerCase();
  // id / code / no / key 结尾,或 uuid、序号这类,是拿来分组和关联的,不是拿来加总的。
  if (/(^|_)(id|code|no|key|uuid|sn|seq)$/.test(n) || /^id$/.test(n)) return "dimension";
  // 年月日这类列常存成整数(20260917),同样是维度。
  if (/(^|_)(year|month|day|date|week|quarter|hour)$/.test(n)) return "dimension";

  const t = (type ?? "").toLowerCase();
  if (!t) return "dimension";
  if (/date|time|year|month|interval/.test(t)) return "dimension";
  if (/int|decimal|numeric|number|float|double|real|money|bigint|smallint/.test(t)) return "measure";
  return "dimension";
}

export function createDataset(name: string, connectionId: string, database?: string): Dataset {
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    id: `dataset-${nanoid(10)}`,
    name,
    connectionId,
    database,
    // 默认表关联:点几下就能建出来,写 SQL 是给需要的人留的另一条路。
    source: { kind: "join", base: { table: "", alias: "t1" }, joins: [], columns: [] },
    fields: [],
    updatedAt: new Date().toISOString(),
  };
}

/** 关联数据集里某张表的输出列名:带上表别名前缀,避免两张表同名字段打架。 */
export function joinColumnAlias(tableAlias: string, field: string): string {
  return `${tableAlias}_${field}`;
}

/**
 * 把数据集变成一段可执行的 SELECT。
 *
 * SQL 数据集原样返回(它本来就是一段查询);关联数据集按主表 + 各 JOIN 拼。列一律显式
 * 列出并加别名前缀 —— `SELECT *` 在多表关联下会产生重名列,取数时分不清是谁的。
 */
export function buildDatasetSql(dataset: Dataset, kind: DbKind | undefined): string {
  const source = dataset.source;
  if (source.kind === "sql") return source.sql.trim();

  const ref = (schema: string | undefined, table: string, alias: string) =>
    `${qualifiedTable(kind, dataset.database, schema, table)} ${quoteIdent(kind, alias)}`;
  const col = (alias: string, field: string) => `${quoteIdent(kind, alias)}.${quoteIdent(kind, field)}`;

  /* 优先按保留下来的字段逐列输出。`SELECT *` 只是还没探测字段时的兜底 —— 它会把
     几十列全拖出来,多表关联下还会产生重名列,取数时分不清是谁的。 */
  const kept = dataset.fields.filter((f) => !f.hidden && (f.from || f.expr || f.grouping));
  const columns = kept.length
    ? kept.map((f) => {
        const derived = derivedExpr(f, dataset, kind);
        if (derived) return `${derived} AS ${quoteIdent(kind, f.name)}`;
        const raw = f.column ?? f.name;
        const ref = col(f.from!, raw);
        return raw === f.name ? ref : `${ref} AS ${quoteIdent(kind, f.name)}`;
      })
    : source.columns.length
      ? source.columns.map((c) => `${col(c.alias, c.field)} AS ${quoteIdent(kind, c.as || joinColumnAlias(c.alias, c.field))}`)
      : [`${quoteIdent(kind, source.base.alias)}.*`, ...source.joins.map((j) => `${quoteIdent(kind, j.alias)}.*`)];

  const lines = [
    `SELECT ${columns.join(", ")}`,
    `FROM ${ref(source.base.schema, source.base.table, source.base.alias)}`,
  ];
  for (const join of source.joins) {
    const on = join.on
      .filter((c) => c.field && c.targetField)
      .map((c, index) => {
        /* 运算符只认白名单。它直接拼进 ON 子句,而数据集是从磁盘上的 JSON 读回来的 ——
           界面上只能从下拉里选,可文件被手改或损坏时,这儿是一条没人看守的通道。 */
        const op = JOIN_OPS.includes(c.op as DatasetJoinOp) ? c.op : "=";
        const expr = `${col(join.alias, c.field)} ${op} ${col(c.targetAlias, c.targetField)}`;
        return index === 0 ? expr : `${(c.connector ?? "and").toUpperCase()} ${expr}`;
      })
      .join(" ");
    lines.push(`${join.kind === "left" ? "LEFT JOIN" : "INNER JOIN"} ${ref(join.schema, join.table, join.alias)} ON ${on || "1 = 1"}`);
  }
  return lines.join("\n");
}


/* 取值转义走共用的 sqlLiteral —— 这儿原来自己写了一个「只把 ' 换成 ''」的版本,
   反斜杠完全不管。分组规则里的取值和标签是人在界面上敲的:MySQL 默认拿反斜杠当转义符,
   一个以 `\` 结尾的取值会把右引号吃掉,后面的 SQL 就接上去了。
   全项目的取值转义只此一份(lib/sql.ts),别再各写各的。 */

/**
 * 计算字段和分组字段生成的表达式。原始列返回 undefined。
 *
 * 表达式里写的是字段名(人看见的那个),这里换成它在表里的真实引用 —— 关联数据集里
 * 撞名的列被改过名,直接把名字塞进 SQL 会引用不到。
 */
export function derivedExpr(
  field: DatasetField,
  dataset: Dataset,
  kind: DbKind | undefined,
  /** 展开路径上已经见过的字段。计算字段能引用别的计算字段,A=B+1 配 B=A+1 就是一个环,
   *  不记着就一路递归到爆栈。界面允许你这么写,所以这里必须挡。 */
  seen: ReadonlySet<string> = new Set(),
): string | undefined {
  if (seen.has(field.name)) return undefined; // 成环了,这个字段算不出来
  const path = new Set(seen).add(field.name);
  const refOf = (name: string): string | undefined => {
    const target = dataset.fields.find((f) => f.name === name);
    if (!target || target.name === field.name) return undefined;
    if (target.from) return `${quoteIdent(kind, target.from)}.${quoteIdent(kind, target.column ?? target.name)}`;
    // 自己也是算出来的:展开它。展不开(成环或它自己就是坏的)就跟着一起算不出来 ——
    // 退回裸名字会引用一个子查询里并不存在的列,错得更隐蔽。
    if (target.expr || target.grouping) {
      const nested = derivedExpr(target, dataset, kind, path);
      return nested ? `(${nested})` : undefined;
    }
    // SQL 数据集的普通列没有 from,名字就是它在子查询里的样子。
    return quoteIdent(kind, target.name);
  };

  if (field.grouping) {
    const { source, buckets, fallback } = field.grouping;
    const col = refOf(source);
    if (!col) return undefined;
    const whens = buckets
      .filter((b) => b.label && b.values.length)
      .map((b) => b.values.length === 1
        ? `WHEN ${col} = ${sqlLiteral(b.values[0], kind)} THEN ${sqlLiteral(b.label, kind)}`
        : `WHEN ${col} IN (${b.values.map((v) => sqlLiteral(v, kind)).join(", ")}) THEN ${sqlLiteral(b.label, kind)}`);
    if (!whens.length) return undefined;
    return `CASE ${whens.join(" ")} ELSE ${fallback ? sqlLiteral(fallback, kind) : "NULL"} END`;
  }

  if (field.expr) {
    // Only unquoted SQL identifiers are expression references. Literal values,
    // comments, already-qualified names and function names keep their meaning.
    const code = new Set<number>();
    scanSql(field.expr, kind, undefined, i => code.add(i));
    const names = dataset.fields.map(f => f.name).filter(n => n && n !== field.name)
      .sort((a, b) => b.length - a.length)
      .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (!names.length) return field.expr;
    const boundary = "[\\w$\\u4e00-\\u9fa5]";
    const pattern = new RegExp(`(?<!${boundary})(?:${names.join("|")})(?!${boundary})`, "g");
    let broken = false;
    const out = field.expr.replace(pattern, (name, offset: number) => {
      if (!Array.from({ length: name.length }, (_, i) => offset + i).every(i => code.has(i))) return name;
      const before = field.expr!.slice(0, offset).trimEnd();
      const after = field.expr!.slice(offset + name.length).trimStart();
      if (before.endsWith(".") || after.startsWith(".") || after.startsWith("(")) return name;
      const ref = refOf(name);
      if (ref === undefined) broken = true;
      return ref ?? name;
    });
    return broken ? undefined : out;
  }
  return undefined;
}

/** 数据集能不能取数。界面用它决定「保存」能不能点、错在哪。 */
export function validateDataset(dataset: Dataset): string | undefined {
  if (!dataset.name.trim()) return "数据集要有名字";
  if (!dataset.connectionId) return "先选一个数据库连接";
  const source = dataset.source;
  if (source.kind === "sql") {
    if (!source.sql.trim()) return "SQL 不能为空";
    return undefined;
  }
  if (!source.base.table) return "先选主表";
  const aliases = new Set([source.base.alias]);
  for (const join of source.joins) {
    if (!join.table) return "关联表还没选";
    if (aliases.has(join.alias)) return `表别名「${join.alias}」重复了`;
    if (join.on.length === 0) return `「${join.table}」还没设关联字段`;
    // 只能关联到已经在 FROM 里的表,否则生成的 SQL 引用不到。
    for (const cond of join.on)
      if (!aliases.has(cond.targetAlias)) return `「${join.table}」关联到了还没加入的表`;
    aliases.add(join.alias);
  }
  return derivedProblem(dataset);
}

/**
 * 算不出来的计算字段。
 *
 * 展不开有两种原因:引用了不存在的字段(多半是打错字或那列被删了),或者互相引用成了环
 * (A=B+1 配 B=A+1)。两种都得说出来 —— 不说的话字段就那么没了,人对着一张少了列的表
 * 想不明白哪里错了。
 */
function derivedProblem(dataset: Dataset): string | undefined {
  const names = new Set(dataset.fields.map((f) => f.name));
  for (const field of dataset.fields) {
    if (!field.expr && !field.grouping) continue;
    if (derivedExpr(field, dataset, undefined)) continue;
    const who = field.label || field.name;
    const chain = cycleFrom(field, dataset);
    if (chain) return `字段「${who}」和「${chain}」互相引用,算不出来`;
    if (field.grouping) {
      return names.has(field.grouping.source)
        ? `分组字段「${who}」还没设好分组规则`
        : `分组字段「${who}」依据的列不在了`;
    }
    /* 表达式里认不出来的词一律放过 —— ROUND、CASE、字面量都不是字段名,想分辨"打错字"
       和"SQL 函数"只能靠数据库。字段编辑器里的「校验」就是干这个的:拿一行真跑一遍。 */
    return `字段「${who}」算不出来,检查一下表达式里引用的字段`;
  }
  return undefined;
}

function cycleFrom(start: DatasetField, dataset: Dataset): string | undefined {
  const byName = new Map(dataset.fields.map((f) => [f.name, f]));
  const seen = new Set<string>();
  const walk = (field: DatasetField): string | undefined => {
    if (seen.has(field.name)) return field.label || field.name;
    seen.add(field.name);
    const refs = field.grouping
      ? [field.grouping.source]
      : dataset.fields.map((f) => f.name).filter((n) => n !== field.name && referenced(field.expr ?? "", n));
    for (const name of refs) {
      const next = byName.get(name);
      if (!next || !(next.expr || next.grouping)) continue;
      const hit = walk(next);
      if (hit) return hit;
    }
    seen.delete(field.name);
    return undefined;
  };
  return walk(start);
}

/** 表达式里是不是提到了这个字段名(按标识符边界,免得 gmv 命中 net_gmv)。 */
function referenced(expr: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w\\u4e00-\\u9fa5])${escaped}([^\\w\\u4e00-\\u9fa5]|$)`).test(expr);
}

/** 读盘容错:旧字段缺了就补默认值,坏结构不至于让整个列表打不开。 */
export function normalizeDataset(raw: Dataset): Dataset {
  const source: DatasetSource = raw.source?.kind === "join"
    ? {
        kind: "join",
        base: {
          ...(raw.source.base ?? {}),
          table: raw.source.base?.table ?? "",
          alias: raw.source.base?.alias || "t1",
        },
        joins: (raw.source.joins ?? []).map((j) => ({ ...j, on: j.on ?? [] })),
        columns: raw.source.columns ?? [],
      }
    : { kind: "sql", sql: raw.source?.kind === "sql" ? raw.source.sql ?? "" : "" };
  return {
    schemaVersion: DATASET_SCHEMA_VERSION,
    id: raw.id || `dataset-${nanoid(10)}`,
    name: raw.name ?? "",
    description: raw.description ?? "",
    connectionId: raw.connectionId ?? "",
    database: raw.database,
    source,
    fields: (raw.fields ?? []).map((f) => ({ ...f, role: f.role === "measure" ? "measure" : "dimension" })),
    updatedAt: raw.updatedAt ?? new Date().toISOString(),
  };
}
