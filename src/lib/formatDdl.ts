import { format, type SqlLanguage } from "sql-formatter";
import type { DbKind } from "../types";

/* DDL 美化。
 *
 * MySQL 的 SHOW CREATE VIEW 返回的是**一整行**,几十个 CASE WHEN / LIKE 挤在一起,
 * 基本没法读。这里只做排版:换行、缩进、关键字大写。
 *
 * 两条保证:
 *  1. **视图头原样保留。** `CREATE ALGORITHM=... DEFINER=`app`@`%` ... VIEW x AS`
 *     这一段不交给格式化器 —— 它会把 `app`@`%` 拆成 `app` @`%`,账号写法中间多了
 *     空格,复制出去执行有风险。只格式化 AS 后面的查询体。
 *  2. **只许改空白和关键字大小写。** 格式化后去掉所有空白、统一小写,必须和原文
 *     逐字一致;不一致(格式化器出了意外)就退回原文。美化不能改 DDL 的意思。
 */

const DIALECT: Record<DbKind, SqlLanguage> = {
  mysql: "mysql",
  mariadb: "mariadb",
  postgres: "postgresql",
  sqlite: "sqlite",
  oracle: "plsql",
  clickhouse: "clickhouse",
};

/* 视图头:CREATE 到 VIEW 之间不许有括号和引号(否则 VIEW 可能是注释或字符串里的词),
   VIEW 之后懒匹配到第一个 AS —— 列清单 `VIEW v (a, b) AS` 里没有 AS,不会截错。 */
const VIEW_HEAD = /^(\s*CREATE\b[^('"]*?\bVIEW\b[\s\S]*?\bAS\b)\s*([\s\S]+)$/i;

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export interface FormattedDdl {
  text: string;
  /** false = 没格式化(空、失败,或格式化会改变内容),text 就是原文。 */
  formatted: boolean;
}

export function formatDdl(ddl: string, kind?: DbKind): FormattedDdl {
  if (!ddl.trim()) return { text: ddl, formatted: false };
  const language: SqlLanguage = (kind && DIALECT[kind]) || "sql";

  const view = VIEW_HEAD.exec(ddl);
  const head = view ? view[1].trim() : "";
  const body = view ? view[2] : ddl;

  let out: string;
  try {
    out = format(body, { language, keywordCase: "upper", tabWidth: 2, linesBetweenQueries: 1 });
  } catch {
    return { text: ddl, formatted: false };
  }

  const text = head ? `${head}\n${out}` : out;
  if (squash(text) !== squash(ddl)) return { text: ddl, formatted: false };
  return { text, formatted: true };
}
