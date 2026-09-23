import { api } from "../../lib/api";
import { planTemplates, planSourceTables } from "./queryPlan";
import type { Metric } from "./metricsStore";

/**
 * 指标体检 —— 口径里写的表和列,库里到底还在不在。
 *
 * 起因是真事:`shop_ads.ads_outlet_member_day` 被删了,12 个会员指标的口径还挂在上面。
 * 指标中心一切正常,看板照样画,直到有人去查数才发现是空的。
 *
 * 这一类问题的共同点是**看不出来** —— 底表换了、列改名了、上游把某个字段下线了,
 * 指标定义本身语法完全正确,只有真去跑一次才知道。所以这里不做 SQL 解析,
 * 只做一件笨但可靠的事:**把口径里出现的每个 `别名.列名` 拿去和它自己声明的
 * 那几张底表的真实列清单比一比**。
 *
 * 为什么不解析别名归属:`b.user_id` 到底属于 FROM 里哪张表,要真解析 SQL 才知道,
 * 而口径里有子查询、UNION、派生表,解析器一旦判错就是误报。改成「在这几张底表的
 * 列的**并集**里找得到就算过」—— 会漏掉「列存在但挂错表」这种情况,但绝不误报。
 * 宁可少报也不能瞎报:一个会误报的体检,用两次就没人看了。
 */

export type IssueKind = "table-missing" | "column-missing" | "no-plan" | "null-unsafe-sum" | "ratio-not-aggregated" | "suspicious-scale" | "not-bound";

export interface MetricIssue {
  kind: IssueKind;
  /** 出问题的表名或列名 */
  name: string;
  text: string;
}

export interface MetricHealth {
  metricId: string;
  metricName: string;
  issues: MetricIssue[];
}

export interface HealthReport {
  checked: number;
  /** 实际去库里问过的表 */
  tables: number;
  unhealthy: MetricHealth[];
  /** 连不上 / 没权限这类,和"指标有问题"是两回事,别混在一起报 */
  errors: string[];
}

/** SQL 里的保留字,别当成列名。只列会出现在 `x.y` 右边位置的。 */
const NOT_A_COLUMN = new Set(["*"]);

/**
 * `SUM(a + b)` 这种写法会静默丢行。
 *
 * SQL 里 `x + NULL = NULL`,而 SUM 会整行跳过 NULL —— 所以只要某些行里 b 是空的,
 * 这些行的 a 也一起没了。单看一个指标不一定出得来问题(少算一点),
 * **比率指标上是致命的**:分子和分母跳的行不一样,比值就偏了,而且看不出来。
 *
 * 真机上撞到的:笔均金额 = SUM(线下GMV + 线上GMV) / SUM(线下订单 + 线上订单),
 * 算出来 2680 元 —— 一个本该几十元的笔均金额。定义本身没写错,是 NULL 把分母吃掉了一大半。
 *
 * 只认聚合函数里的加减:`a.x + a.y`。`COALESCE(a.x,0) + COALESCE(a.y,0)` 是对的写法,
 * 常量相加(`SUM(x) + 1`)不算,所以要求两边都出现 `别名.列名`。
 */
export function nullUnsafeSums(sql: string): string[] {
  const out: string[] = [];
  const column = /[A-Za-z_]\w*\.[a-z_]\w*/;
  // 聚合函数的参数:允许里面再嵌一层括号(CASE WHEN、IFNULL 之类)
  const aggregate = /\b(SUM|AVG)\s*\(((?:[^()]|\([^()]*\))*)\)/gi;
  for (const match of sql.matchAll(aggregate)) {
    const body = match[2];
    if (/\b(COALESCE|IFNULL|NVL)\s*\(/i.test(body)) continue;   // 已经兜住了
    // 顶层的加减(括号里的不算 —— 那是别的函数的参数)
    let level = 0, hasOperator = false;
    for (const char of body) {
      if (char === "(") level++;
      else if (char === ")") level--;
      else if ((char === "+" || char === "-") && level === 0) hasOperator = true;
    }
    if (!hasOperator) continue;
    const parts = body.split(/[+\-]/).filter((part) => column.test(part));
    if (parts.length >= 2) out.push(`${match[1].toUpperCase()}(${body.trim()})`);
  }
  return out;
}

const AGGREGATE = /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(/i;
const COLUMN_REF = /[A-Za-z_]\w*\.[a-z_]\w*/;

/**
 * 比率指标的分子分母没套聚合函数。
 *
 * `SUM(gmv)/SUM(订单)` 是「这批行的整体比值」;写成 `gmv/订单` 就是**行级比值** ——
 * 一 GROUP BY,数据库要么报错,要么(MySQL 关掉 ONLY_FULL_GROUP_BY 时)随便挑某一行的值
 * 给你。后者最糟:有数、不报错、还是错的。
 *
 * 真机上撞到的:笔均金额的分子分母都是裸列,加上 scale=100,算出来 2680 元。
 */
function ratioNotAggregated(m: Metric): MetricIssue[] {
  if (m.type !== "ratio") return [];
  return ([["分子", m.numerator], ["分母", m.denominator]] as const)
    .filter(([, text]) => !!text && COLUMN_REF.test(text) && !AGGREGATE.test(text))
    .map(([label, text]) => ({
      kind: "ratio-not-aggregated" as const, name: `${label}:${text!.trim()}`,
      text: `比率指标的${label}没有聚合函数,编出来是**行级比值**而不是整体比值 —— 一分组就变成随便取某一行的数。` +
        `应该写成 SUM(...)/SUM(...) 这种形式。`,
    }));
}

/**
 * ×100 配上不是百分比的单位。
 *
 * scale 是给「小数转百分比」用的。单位不是 % 却乘 100,多半是从某个比率指标复制过来
 * 忘了改 —— 笔均金额 26.8 元就这么变成 2680 元,而 2680 这个数看着不像坏数据,
 * 报告里会一路带下去。
 */
function suspiciousScale(m: Metric): MetricIssue[] {
  if (m.scale !== 100 || (m.unit ?? "").includes("%")) return [];
  return [{
    kind: "suspicious-scale", name: `×100`,
    text: `这个指标乘了 100,单位却是「${m.unit || "(空)"}」。×100 是给小数转百分比用的,` +
      `单位不是 % 就很可能是从别的比率指标抄过来忘了改 —— 结果会整整大一百倍。`,
  }];
}

/** 一个指标里所有的聚合表达式(不管它是哪种类型)。 */
function aggregateExpressions(m: Metric): string[] {
  const plan = m.queryPlan ? planTemplates(m.queryPlan) : [];
  return [m.expression, m.numerator, m.denominator, m.sql, ...plan]
    .filter((text): text is string => !!text && text.trim().length > 0);
}

/**
 * 从模板里抠出 `别名.列名`。
 *
 * 只认小写字母开头、带下划线的标识符 —— 也就是这套口径里列名的写法。
 * `{{start}}` `{{groupBy}}` 这些占位符不含点号,天然不会被抓进来。
 */
export function referencedColumns(sql: string): string[] {
  const out = new Set<string>();
  for (const m of sql.matchAll(/\b[A-Za-z_][A-Za-z_0-9]*\.([A-Za-z_][A-Za-z_0-9]*)\b/g)) {
    const col = m[1];
    if (!NOT_A_COLUMN.has(col)) out.add(col.toLowerCase());
  }
  return [...out];
}

/** `shop_dws.dws_user_outlet_behavior_day` → { database, table } */
function splitTable(id: string): { database: string; table: string } {
  const dot = id.lastIndexOf(".");
  return dot < 0
    ? { database: "", table: id }
    : { database: id.slice(0, dot), table: id.slice(dot + 1) };
}

/**
 * 库名也是列名的来源之一 —— `shop_dws.dws_user_outlet_behavior_day b` 里的
 * `shop_dws.dws_user_outlet_behavior_day` 会被 referencedColumns 抓成
 * 列 `dws_user_outlet_behavior_day`。把底表名本身排掉。
 */
/**
 * 一个指标用到哪几张底表。
 *
 * 原来只认 template 型(从 queryPlan 里读 sourceTables)—— 而真实目录里一个 template
 * 都没有:153 个指标全是 measure / ratio / sql 型,底表写在 source 这个 FROM 子句里
 * (`shop_ads.ads_outlet_daily a JOIN shop_ads.ads_outlet_dim d ON ...`)。
 * 结果就是体检报「0 张底表」,那套「表还在不在」的检查从没跑过 —— 而它正是这个功能
 * 当初要解决的问题(底表被删了、指标还挂在上面,直到有人去查数才发现是空的)。
 */
export function sourceTablesOf(m: Metric): string[] {
  if (m.type === "derived") return [];   // 它引用的是别的指标,不直接碰表
  const text = m.type === "template"
    ? ""                                  // template 走 queryPlan,下面单独取
    : m.type === "sql" ? (m.sql ?? "") : `FROM ${m.source ?? ""}`;
  const found = new Set<string>();
  for (const match of text.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_]\w*\.[A-Za-z_]\w*)/gi)) found.add(match[1]);
  if (m.type === "template" && m.queryPlan) for (const t of planSourceTables(m.queryPlan)) found.add(t);
  return [...found];
}

/** 这个指标的口径里引用到的所有 `别名.列名`。 */
function referencedColumnsOf(m: Metric): string[] {
  const texts = m.type === "template" && m.queryPlan
    ? planTemplates(m.queryPlan)
    : [m.expression, m.numerator, m.denominator, m.sql].filter((t): t is string => !!t);
  const found = new Set<string>();
  for (const text of texts) for (const c of referencedColumns(text)) found.add(c);
  return [...found];
}

function tableNoise(tables: string[]): Set<string> {
  const noise = new Set<string>();
  for (const t of tables) {
    const { table } = splitTable(t);
    noise.add(table.toLowerCase());
  }
  return noise;
}

/**
 * 体检一批指标。
 *
 * `lookup` 可注入,所以这套逻辑能脱离 Tauri 单测 —— 日期逻辑之外,
 * 这是第二个"不注入就没法测"的地方。
 */
export async function checkMetrics(
  metrics: Metric[],
  lookup: (connId: string, database: string, table: string) => Promise<string[] | null> = defaultLookup,
): Promise<HealthReport> {
  /* 所有启用的指标都要体检。原来只挑 template 型 —— 而真实目录里一个都没有,
     于是整张检查表形同虚设(报「查了 0 个」还看不出来是漏了)。 */
  const targets = metrics.filter((m) => m.enabled);
  const errors: string[] = [];
  /* NULL 安全这条不用连库,所以对**所有**启用的指标都跑 —— 上面的表/列检查只认
     template 型(要有 queryPlan 才知道底表),可 measure/ratio 型一样会写出
     SUM(a + b),而且比率指标上后果更严重。 */
  const staticIssues = new Map<string, MetricIssue[]>();
  for (const m of metrics.filter((metric) => metric.enabled)) {
    const found = [...new Set(aggregateExpressions(m).flatMap(nullUnsafeSums))];
    const issues: MetricIssue[] = [
      ...found.map((expression) => ({
        kind: "null-unsafe-sum" as const, name: expression,
        text: `${expression} 里只要有一列是 NULL,整行就被跳过 —— 分子和分母跳的行不一样时,比值会偏。` +
          `建议写成 SUM(COALESCE(列1,0) + COALESCE(列2,0))。`,
      })),
      ...ratioNotAggregated(m),
      ...suspiciousScale(m),
    ];
    if (issues.length) staticIssues.set(m.id, issues);
  }

  // 先把要问的表去重 —— 12 个会员指标共用 3 张底表,问 3 次就够了
  const wanted = new Map<string, { connId: string; database: string; table: string }>();
  for (const m of targets) {
    if (!m.connId) continue;   // 没绑连接就问不了库,别拿它去报「表不存在」
    for (const t of sourceTablesOf(m)) {
      const { database, table } = splitTable(t);
      const key = `${m.connId}|${database}|${table}`;
      if (!wanted.has(key)) wanted.set(key, { connId: m.connId, database, table });
    }
  }

  const columnsOf = new Map<string, string[] | null>(); // null = 表不存在
  for (const [key, t] of wanted) {
    try {
      columnsOf.set(key, await lookup(t.connId, t.database, t.table));
    } catch (e) {
      columnsOf.set(key, []); // 问不到就当"没法判断",下面不拿它判列
      errors.push(`查 ${t.database}.${t.table} 的字段失败:${String(e)}`);
    }
  }

  const unhealthy: MetricHealth[] = [];
  for (const m of targets) {
    const issues: MetricIssue[] = [];
    if (m.type === "template" && !m.queryPlan) {
      issues.push({ kind: "no-plan", name: m.name, text: "标成语义查询却没有计算定义" });
      unhealthy.push({ metricId: m.id, metricName: m.name, issues });
      continue;
    }
    /* 没绑数据库连接就没法查表和列。这件事要明说 —— 界面上只报「0 张底表」的话,
       看着像"检查过了、没问题",实际上是一行都没查。真机上就是这么过去的:
       重新导入目录把连接绑定冲掉了,131 个指标全成了未绑定,体检照样显示 0 张底表。 */
    if (!m.connId && sourceTablesOf(m).length) {
      issues.push({ kind: "not-bound", name: m.name, text: "这个指标还没绑定数据库连接,没法检查它的底表和字段还在不在 —— 请先在指标目录上选择连接。" });
    }
    const tables = m.connId ? sourceTablesOf(m) : [];
    const known = new Set<string>();
    let anyUnknownTable = false;
    for (const t of tables) {
      const { database, table } = splitTable(t);
      const cols = columnsOf.get(`${m.connId}|${database}|${table}`);
      if (cols === null) {
        issues.push({ kind: "table-missing", name: t, text: `底表 ${t} 在库里不存在了` });
        anyUnknownTable = true;
        continue;
      }
      if (!cols || cols.length === 0) { anyUnknownTable = true; continue; }
      for (const c of cols) known.add(c.toLowerCase());
    }
    // 有表没问到就别判列了 —— 并集缺一块,判出来的"列不存在"是假的
    if (!anyUnknownTable && tables.length) {
      const noise = tableNoise(tables);
      for (const c of referencedColumnsOf(m)) {
        if (noise.has(c) || known.has(c)) continue;
        issues.push({ kind: "column-missing", name: c, text: `字段 ${c} 在这个指标的底表里都找不到` });
      }
    }
    issues.push(...(staticIssues.get(m.id) ?? []));
    staticIssues.delete(m.id);
    if (issues.length) unhealthy.push({ metricId: m.id, metricName: m.name, issues });
  }
  return { checked: targets.length, tables: wanted.size, unhealthy, errors };
}

/** 真去库里问。表不存在时后端会抛错 —— 那正是我们要的信号。 */
async function defaultLookup(connId: string, database: string, table: string): Promise<string[] | null> {
  try {
    const cols = await api.listColumns(connId, database, "", table);
    return cols.length ? cols.map((c) => c.name) : null;
  } catch {
    return null; // 表没了
  }
}
