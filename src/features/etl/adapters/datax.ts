import { nanoid } from "nanoid";
import type { EtlAdapter, EtlJob, Endpoint } from "../types";
/* jdbcUrl 解析、数组归一、作业命名跟 Kettle / Sqoop 共用一份 —— 见 shared.ts 的说明。 */
import { arr, nameJob, parseJdbc, redactJdbc } from "./shared";

const first = <T,>(v: T | T[] | undefined): T | undefined => (Array.isArray(v) ? v[0] : v);

/** Turn a DataX reader/writer spec into one or more endpoints. */
function endpoints(spec: Record<string, unknown> | undefined): Endpoint[] {
  if (!spec) return [];
  const name = String(spec.name ?? "").toLowerCase();
  const system = name.replace(/(reader|writer)$/i, "") || undefined;
  const p = (spec.parameter ?? {}) as Record<string, unknown>;

  // file-based (txtfilereader / hdfswriter / …)
  if (p.path !== undefined && p.connection === undefined) {
    return arr(p.path as string | string[]).map((path) => ({
      kind: "file" as const,
      system,
      path: String(path),
      detail: String(path),
    }));
  }

  const conns = arr(p.connection as Record<string, unknown> | Record<string, unknown>[]);
  if (conns.length === 0) {
    return [{ kind: system ? "unknown" : "unknown", system, detail: name }];
  }

  const out: Endpoint[] = [];
  for (const c of conns) {
    const jdbc = first(c.jdbcUrl as string | string[] | undefined);
    const { host, database } = parseJdbc(String(jdbc ?? ""));
    /* detail 会显示在血缘图的悬停提示上,而 jdbcUrl 里是可以带口令的
       (?user=root&password=xxx),存之前抹掉。 */
    const shown = jdbc ? redactJdbc(String(jdbc)) : undefined;
    const tables = arr(c.table as string | string[] | undefined);
    const querySql = arr(c.querySql as string | string[] | undefined);
    if (tables.length) {
      for (const t of tables) out.push({ kind: "db", system, host, database, table: String(t), detail: shown });
    } else if (querySql.length) {
      // real source table(s) live inside the SELECT — resolved later via sqlglot
      for (const query of querySql) out.push({ kind: "db", system, host, database, querySql: String(query) });
    } else {
      out.push({ kind: "db", system, host, database, detail: shown });
    }
  }
  return out;
}

function contentToJob(content: Record<string, unknown>, kind = "datax" as const): EtlJob {
  const sources = endpoints(content.reader as Record<string, unknown> | undefined);
  const targets = endpoints(content.writer as Record<string, unknown> | undefined);
  return { id: nanoid(8), name: nameJob(sources, targets), kind, sources, targets };
}

export const dataxAdapter: EtlAdapter = {
  kind: "datax",
  label: "DataX",
  blurb: "阿里 DataX · 解析 reader→writer 得到源→目标",
  available: true,
  inputHint: "粘贴一个或多个 DataX 作业 JSON(job.content),或一个 JSON 数组",
  parse(text: string): EtlJob[] {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error(`不是合法 JSON:${String(e).slice(0, 80)}`);
    }
    const contents: Record<string, unknown>[] = [];
    const collect = (d: unknown) => {
      if (!d || typeof d !== "object") return;
      const o = d as Record<string, unknown>;
      if (Array.isArray(d)) {
        d.forEach(collect);
      } else if (o.job && typeof o.job === "object") {
        const job = o.job as Record<string, unknown>;
        for (const c of arr(job.content as Record<string, unknown> | Record<string, unknown>[])) contents.push(c);
      } else if (o.content) {
        for (const c of arr(o.content as Record<string, unknown> | Record<string, unknown>[])) contents.push(c);
      } else if (o.reader || o.writer) {
        contents.push(o);
      }
    };
    collect(data);
    if (contents.length === 0) throw new Error("没找到 DataX 的 job.content(reader/writer)");
    return contents.map((c) => contentToJob(c));
  },
};
