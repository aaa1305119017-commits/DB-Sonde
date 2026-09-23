import { splitSqlStatements, stripLeadingComments } from "../../lib/sql";
import type { DbKind } from "../../types";

/** Anything that can change data or schema. The AI is only ever allowed to
 *  produce/run read-only SQL, so these are hard-blocked before insert/run. */
const WRITE_KEYWORD =
  /\b(insert|update|delete|truncate|create|alter|drop|replace|merge|upsert|grant|revoke|call|exec|execute|into|comment\s+on|vacuum|attach|detach|copy|load|rename|reindex|cluster)\b/i;

const READ_HEAD = /^\s*(select|with|explain|show|describe|desc)\b/i;

function isReadOnlyStatement(statement: string): boolean {
  const s = statement.trim();
  if (!s) return true;
  /* 首词判断要跳过开头的注释 —— 人习惯把说明写在 SQL 上面,`#说明\nSELECT …`
     不剥的话 READ_HEAD 匹配不上,一条正经查询会被当成不可读运行而挡下。
     写关键字仍然扫**原文**:按注释跳过的话,PG 上 `SELECT a #> b; DELETE FROM t`
     的第二条就藏起来了。宁可把注释里的词也当语句扫(多拒),也不能漏。 */
  if (!READ_HEAD.test(stripLeadingComments(s))) return false;
  return !WRITE_KEYWORD.test(s);
}

/** True only when every statement is a read-only query. Errs on the side of
 *  false (blocking) for anything ambiguous. */
export function isReadOnlySql(sql: string, kind?: DbKind): boolean {
  /* 方言影响怎么拆语句(反斜杠是不是转义)。拆错了会把两条并成一条 ——
     这条守卫因为**对整段文本**扫写关键字,并了也照样拦得住,但传对方言才能
     给出准确的判断,不至于把一条正经查询因为并进了别的东西而误拦。 */
  const statements = splitSqlStatements(sql, kind);
  if (!statements.length) return true;
  return statements.every(isReadOnlyStatement);
}
