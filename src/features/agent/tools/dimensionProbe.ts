import { api } from "../../../lib/api";
import type { DatasetQueryPorts } from "../../dashboard/queryRuntime";
import { validateDatasetSql } from "../../dashboard/query";
import { compileSemanticDataset } from "../../dashboard/semantic";
import { useMetrics } from "../../metrics/metricsStore";
import { useApp } from "../../../store/appStore";
import type { DashboardDataset } from "../../dashboard/domain";
import { sqlLiteral } from "../../../lib/sql";

/**
 * 「大区有哪些取值」—— 只问维表,别扫事实表。
 *
 * 之前是拿**完整的指标 SQL**(DWS 事实表 join 两张维表、扫半年、再 GROUP BY)去问这个问题,
 * 45 秒都跑不完 → 探测超时 → 「华东」没能补成「华东大区」→ `in ('华东')` 一行都匹配不到
 * → 0 行。修了八轮症状,根子在这:**用扫几亿行的方式,去问一个维表就能答的问题。**
 *
 * war_zone 的表达式是 `d.outlet_region`,而 `d` 在 FROM 里就是 `shop_ads.ads_outlet_dim` ——
 * 一张小维表。`SELECT DISTINCT d.outlet_region FROM shop_ads.ads_outlet_dim d` 是毫秒级的,
 * 而且**不受日期范围影响**:大区有哪些本来就跟"这半年有没有生意"无关。
 *
 * 拆不出来(表达式跨多表、子查询里等等)就返回 null,由调用方退回原来那条慢路 ——
 * 拆不准就别硬拆,给个错的取值清单比慢更糟。
 */

/** 从编译好的 SQL 里找出 `别名 -> 库.表`。只认 FROM / JOIN 后面紧跟的那种写法。 */
export function tableAliases(sql: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /\b(?:FROM|JOIN)\s+([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)\s+(?:AS\s+)?([A-Za-z_][\w$]*)\b/gi;
  for (const m of sql.matchAll(re)) {
    const alias = m[2];
    // ON / WHERE 这些关键字不是别名
    if (/^(on|where|group|order|left|right|inner|join|using|limit|having)$/i.test(alias)) continue;
    if (!(alias in out)) out[alias] = m[1];
  }
  return out;
}

/**
 * 找出 SELECT 里这个维度对应的表达式。
 *
 * 两种写法都要认:
 *  - `d.outlet_region AS war_zone` —— 维度名和列名不同,要带别名
 *  - `outlet_region`(裸列名,没有 AS)—— 维度名**就是**列名时编译器不写别名
 *
 * 只认第一种是踩过的坑:这个函数是照着旧的 queryPlan 目录写的(维度表达式一律
 * 是 `别名.列`),而现在的指标目录用**裸列名**当维度。于是正则从来没匹配上过,
 * 探测一路 return null,任何带筛选值的问题都得到「无法核对到真实取值」——
 * 不是偶尔失败,是这一整类从来就没成功过。
 */
export function selectExpressionFor(sql: string, field: string): string | null {
  if (!/^[A-Za-z_][\w$]*$/.test(field)) return null;
  const aliased = new RegExp(`([A-Za-z_][\\w$]*\\.[A-Za-z_][\\w$]*)\\s+AS\\s+\`?${field}\`?\\b`, "i").exec(sql);
  if (aliased) return aliased[1];
  // 裸列名:只在 SELECT 列表里找,别把 WHERE/GROUP BY 里的同名词当成选出来的列
  const select = /^\s*SELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\s+FROM\s/i.exec(sql);
  if (!select) return null;
  const bare = new RegExp(`(^|,)\\s*\`?${field}\`?\\s*(,|$)`, "i");
  return bare.test(select[1]) ? field : null;
}

/**
 * 原样取出 FROM 到 WHERE/GROUP BY 之间的东西 —— 可能是一张表,也可能带 JOIN。
 *
 * 裸列名的情况下**没法静态判断这一列属于哪张表**,猜错就查出一份别的表的取值清单
 * (比查不到更糟:它看起来是对的)。所以不猜,拿整个 FROM 去查 ——
 * 带 JOIN 会比单查维表慢,但一定正确。
 */
export function fromClause(sql: string): string | null {
  const m = /\sFROM\s+([\s\S]*?)(?:\s+WHERE\s|\s+GROUP\s+BY\s|\s+ORDER\s+BY\s|\s+LIMIT\s|\s+HAVING\s|$)/i.exec(sql);
  const text = m?.[1]?.trim();
  return text ? text : null;
}

/**
 * 直接问维表要取值。拿不准就 null。
 *
 * 两条路:表达式是 `别名.列` 且别名对得上实表 → 只扫那一张维表(快);
 * 表达式是裸列名 → 拿整个 FROM 子句查(慢一点,但不会查错表)。
 * 带函数的(DATE_FORMAT(...))一律不碰 —— 时间维度本来也不需要探。
 *
 * 不论走哪条,都**不带日期范围** —— 大区有哪些跟"这一周有没有生意"是两件事,
 * 拿分析窗口去限制它,窗口里恰好没数就会把匹配能力一起废掉。
 */
export async function fastDimensionValues(
  dataset: DashboardDataset,
  field: string,
  limit = 300,
  search = "",
  catalog = useMetrics.getState().metrics,
  transport?: Pick<DatasetQueryPorts, "dialectFor" | "readQuery">,
): Promise<string[] | null> {
  if (!dataset.metricIds) return null;
  const dialect = transport ? transport.dialectFor(dataset.connectionId) : useApp.getState().connections.find((c) => c.id === dataset.connectionId)?.kind;
  let compiled;
  try {
    compiled = compileSemanticDataset({ ...dataset, groupBy: [field] }, catalog, [], dialect);
  } catch {
    return null;
  }

  const expression = selectExpressionFor(compiled.sql, field);
  if (!expression) return null;
  /* 带别名的(`d.outlet_region`)能定位到具体那张维表 —— 走快路,只扫那一张。
     裸列名的没法静态判断它属于哪张表,就拿**整个 FROM**去查:带 JOIN 会慢一些,
     但绝不会查出一份别的表的取值清单。猜错了比查不到更糟,它看起来是对的。 */
  const alias = expression.includes(".") ? expression.split(".")[0] : "";
  const source = alias ? tableAliases(compiled.sql)[alias] : fromClause(compiled.sql);
  if (!source) return null;
  const from = alias ? `${source} ${alias}` : source;

  const take = Math.max(1, Math.min(1001, Math.floor(limit)));
  /* ESCAPE ! 让用户输入里的 % 和 _ 变成普通字符(所有方言都支持)。
     这一步是 LIKE 的**模式**转义,跟「字符串取值」的转义是两回事 ——
     后者交给 sqlLiteral。原来这儿自己拼引号,而且反斜杠只按 mysql 处理,
     漏了 mariadb 和 clickhouse(这两个同样拿反斜杠当转义符)。 */
  const pattern = `%${search.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_")}%`;
  const searchClause = search ? ` AND ${expression} LIKE ${sqlLiteral(pattern, dialect)} ESCAPE '!'` : "";
  const limitClause = dialect === "oracle" ? `FETCH FIRST ${take} ROWS ONLY` : `LIMIT ${take}`;
  const sql =
    `SELECT DISTINCT ${expression} AS ${field} FROM ${from} ` +
    `WHERE ${expression} IS NOT NULL AND ${expression} <> ''${searchClause} ORDER BY 1 ${limitClause}`;
  if (validateDatasetSql(sql)) return null; // 过不了只读护栏就别跑

  const result = await (transport?.readQuery ?? api.runReadOnlyQuery)(compiled.connectionId, compiled.database, sql, take, []);
  const index = result.columns.findIndex((c) => c.name === field);
  if (index < 0) return null;
  return [...new Set(result.rows.map((r) => String(r[index] ?? "")).filter(Boolean))];
}
