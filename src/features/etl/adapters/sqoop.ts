import { nanoid } from "nanoid";
import type { Endpoint, EtlAdapter, EtlJob } from "../types";
import { nameJob, parseJdbc, redactJdbc } from "./shared";

/* Sqoop 接入 —— 解析 sqoop 命令行。
 *
 * 用户贴的通常是一段 .sh:若干条 sqoop 命令,反斜杠续行,夹着注释和别的命令。
 * 所以这儿要做的是「从一段脚本里挑出 sqoop 命令,再把每条拆成参数」。
 * Sonde 不执行任何命令,只读文本。 */

/** 绝不收进作业的参数 —— 收了就会顺着血缘图、导出的文档一路流出去。 */
const SECRET_FLAGS = new Set([
  "--password", "--password-file", "--password-alias", "-P",
  "--username", "-p",
  "-D",  // -Dhadoop.security... 之类,可能带凭据
]);

/**
 * 把一段脚本切成词。处理三件事:反斜杠续行、引号、注释。
 *
 * 引号里的空格不切 —— `--query "SELECT a FROM t WHERE x=1 AND \$CONDITIONS"`
 * 整个是一个词,切开了 SQL 就碎了。
 */
export function tokenize(script: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;                     // current 是否已经开始(空串也算一个词)
  const push = () => { if (started) { out.push(current); current = ""; started = false; } };

  for (let i = 0; i < script.length; i += 1) {
    const ch = script[i];
    if (quote) {
      if (ch === "\\" && quote === '"' && i + 1 < script.length) {
        // shell 双引号里的 \$ \" \\ —— 去掉反斜杠留下字符($CONDITIONS 常这么写)
        const next = script[i + 1];
        current += "$\"\\`".includes(next) ? next : ch + next;
        i += 1;
        continue;
      }
      if (ch === quote) { quote = null; continue; }
      current += ch;
      continue;
    }
    if (ch === "#" && !started) {          // 整行注释
      while (i < script.length && script[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "\\" && script[i + 1] === "\n") { i += 1; continue; }   // 续行
    if (ch === "\\" && script[i + 1] === "\r" && script[i + 2] === "\n") { i += 2; continue; }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) { push(); continue; }
    if (ch === ";" || ch === "&" || ch === "|") { push(); continue; }  // 命令分隔符
    current += ch;
    started = true;
  }
  push();
  return out;
}

/** 一条 sqoop 命令的参数表。同名参数可能出现多次(比如 --table)。 */
type Args = Map<string, string[]>;

function readArgs(tokens: string[]): Args {
  const args: Args = new Map();
  const put = (key: string, value: string) => {
    const bucket = args.get(key);
    if (bucket) bucket.push(value); else args.set(key, [value]);
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("-")) continue;
    // --key=value 和 --key value 两种写法都有
    const eq = token.indexOf("=");
    const key = eq > 0 ? token.slice(0, eq) : token;
    if (SECRET_FLAGS.has(key)) { if (eq < 0 && tokens[i + 1] && !tokens[i + 1].startsWith("-")) i += 1; continue; }
    if (eq > 0) { put(key, token.slice(eq + 1)); continue; }
    const next = tokens[i + 1];
    if (next && !next.startsWith("-")) { put(key, next); i += 1; }
    else put(key, "");                     // 开关型参数,比如 --hive-import
  }
  return args;
}

const one = (args: Args, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const v = args.get(key);
    if (v && v[0]) return v[0];
  }
  return undefined;
};
const has = (args: Args, key: string) => args.has(key);

/** `db.table` 或 `--xxx-database` + `--xxx-table` 两种写法都归一成 {database, table}。 */
function splitQualified(name: string | undefined, database: string | undefined): { database?: string; table?: string } {
  if (!name) return { database };
  const dot = name.indexOf(".");
  if (dot > 0 && !database) return { database: name.slice(0, dot), table: name.slice(dot + 1) };
  return { database, table: name };
}

/** 关系库那一端(--connect 指向的地方)。 */
function dbEndpoint(args: Args): Endpoint | null {
  const url = one(args, "--connect");
  if (!url) return null;
  const { host, database } = parseJdbc(url);
  const system = url.match(/^jdbc:([a-z0-9]+)/i)?.[1]?.toLowerCase();
  const table = one(args, "--table");
  const query = one(args, "--query", "-e");
  return {
    kind: "db", system, host, database,
    table: table || undefined,
    // --query 里才是真正读了哪几张表,交给血缘那层用 sqlglot 解
    querySql: !table && query ? query : undefined,
    detail: redactJdbc(url),
  };
}

/** Hadoop 那一端:Hive / HCatalog 表,或者 HDFS 目录。可能同时有。 */
function hadoopEndpoints(args: Args): Endpoint[] {
  const out: Endpoint[] = [];
  const hive = splitQualified(one(args, "--hive-table"), one(args, "--hive-database"));
  if (hive.table) out.push({ kind: "db", system: "hive", database: hive.database, table: hive.table });
  const hcat = splitQualified(one(args, "--hcatalog-table"), one(args, "--hcatalog-database"));
  if (hcat.table) out.push({ kind: "db", system: "hcatalog", database: hcat.database, table: hcat.table });
  for (const key of ["--target-dir", "--warehouse-dir", "--export-dir"]) {
    const path = one(args, key);
    if (path) out.push({ kind: "file", system: "hdfs", path, detail: path });
  }
  return out;
}

/** 一条 sqoop 命令 → 一个作业。不是 import/export 就返回 null。 */
function commandToJob(tokens: string[]): EtlJob | null {
  // `sqoop job --create x -- import --connect ...` 这种,真正的动作在 `--` 后面
  const dashDash = tokens.indexOf("--");
  const body = dashDash >= 0 ? tokens.slice(dashDash + 1) : tokens.slice(1);
  const action = (body[0] ?? "").toLowerCase();
  const importing = action === "import" || action === "import-all-tables";
  const exporting = action === "export";
  if (!importing && !exporting) return null;

  const args = readArgs(body.slice(1));
  const db = dbEndpoint(args);
  const hadoop = hadoopEndpoints(args);
  if (!db && !hadoop.length) return null;

  /* 方向就是 import / export 字面上的意思:
     import 把关系库搬进 Hadoop,export 反过来。搞反了整张血缘图的箭头都是错的。 */
  const sources = importing ? (db ? [db] : []) : hadoop;
  const targets = importing ? hadoop : (db ? [db] : []);

  const notes: string[] = [];
  if (action === "import-all-tables") notes.push("整库导入(--import-all-tables),没有逐表列出");
  if (has(args, "--options-file")) notes.push("用了 --options-file,那个文件里的参数没读到");
  if (has(args, "--hive-import") && !one(args, "--hive-table")) notes.push("--hive-import 没指定 --hive-table,表名由 Sqoop 按源表推导");

  return {
    id: nanoid(8),
    name: nameJob(sources, targets, action),
    kind: "sqoop",
    sources, targets,
    note: notes.length ? notes.join(";") : undefined,
  };
}

export const sqoopAdapter: EtlAdapter = {
  kind: "sqoop",
  label: "Sqoop",
  blurb: "解析 import / export 命令,得到关系库 ↔ Hadoop 的流向",
  available: true,
  inputHint: "粘贴 sqoop 命令或整段 .sh 脚本(支持反斜杠续行、多条命令)",
  /* 输入框的占位示例。口令那行故意留着 —— 让用户看见「贴进来也不会被收走」,
     而不是自己先手动删一遍(手动删才是真会出错的那一步)。 */
  example: `sqoop import \\
  --connect jdbc:mysql://192.0.2.2:3306/ods \\
  --username etl --password *** \\
  --table t_store \\
  --hive-import --hive-database ods --hive-table t_store`,
  parse(text: string): EtlJob[] {
    const tokens = tokenize(text);
    // 按 `sqoop` 这个词切成若干条命令
    const commands: string[][] = [];
    let current: string[] | null = null;
    for (const token of tokens) {
      if (token === "sqoop" || token.endsWith("/sqoop")) {
        if (current) commands.push(current);
        current = [token];
      } else if (current) current.push(token);
    }
    if (current) commands.push(current);

    const jobs = commands.map(commandToJob).filter((j): j is EtlJob => j !== null);
    if (!jobs.length) {
      throw new Error(
        commands.length
          ? "只认 sqoop import / export(以及 import-all-tables),没找到能解析的命令"
          : "没找到 sqoop 命令 —— 请贴以 sqoop 开头的命令或整段脚本",
      );
    }
    return jobs;
  },
};
