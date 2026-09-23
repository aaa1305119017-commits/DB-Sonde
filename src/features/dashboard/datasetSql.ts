import type { TranslationKey } from "../../i18n";
import type { DashboardFilter } from "./domain";

export type DatasetQueryFilter = Pick<DashboardFilter, "field" | "kind"> & { value: string; };

export type DatasetSqlErrorKey = Extract<
  TranslationKey,
  | "dashboard.sql.empty"
  | "dashboard.sql.readonly"
  | "dashboard.sql.single"
  | "dashboard.sql.forbidden"
  | "dashboard.selectConnection"
>;

const FORBIDDEN = new Set([
  "ALTER", "ATTACH", "CALL", "COMMENT", "COPY", "CREATE", "DELETE", "DETACH", "DO", "DROP",
  "EXEC", "EXECUTE", "GRANT", "INSERT", "INTO", "LOCK", "MERGE", "PRAGMA", "REINDEX", "REPLACE",
  "REVOKE", "SET", "TRUNCATE", "UNLOCK", "UPDATE", "UPSERT", "VACUUM",
]);

/** 关键字同时也是常用函数:出现在函数调用位(紧跟左括号)时放行。
 *  写语句形式仍被拦 —— REPLACE INTO 撞 INTO,TRUNCATE TABLE 撞首词检查。与 Rust 端一致。 */
const FUNCTION_SAFE = new Set(["REPLACE", "TRUNCATE"]);

interface SqlToken { text: string; call: boolean; }

function sqlTokens(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let index = 0;
  let current = "";
  const flush = (at: number) => {
    if (current) {
      let probe = at;
      while (probe < sql.length && /\s/.test(sql[probe])) probe += 1;
      tokens.push({ text: current.toLocaleUpperCase(), call: sql[probe] === "(" });
    }
    current = "";
  };
  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];
    if (/[A-Za-z0-9_]/.test(char)) {
      current += char;
      index += 1;
      continue;
    }
    flush(index);
    if (char === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index + 1 < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      index = Math.min(index + 2, sql.length);
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) index += 2;
          else { index += 1; break; }
        } else if (sql[index] === "\\" && quote === "'") index += 2;
        else index += 1;
      }
      continue;
    }
    if (char === ";") tokens.push({ text: ";", call: false });
    index += 1;
  }
  flush(sql.length);
  return tokens;
}

/** Fast UI validation. Rust repeats stricter validation before executing. */
export function validateDatasetSql(sql: string): DatasetSqlErrorKey | undefined {
  const trimmed = sql.trim();
  if (!trimmed) return "dashboard.sql.empty";
  const tokens = sqlTokens(trimmed);
  if (tokens[0]?.text !== "SELECT" && tokens[0]?.text !== "WITH") {
    return "dashboard.sql.readonly";
  }
  if (tokens.some((token) => token.text === ";")) return "dashboard.sql.single";
  if (tokens.some((token) => FORBIDDEN.has(token.text) && !(token.call && FUNCTION_SAFE.has(token.text)))) return "dashboard.sql.forbidden";
  return undefined;
}
