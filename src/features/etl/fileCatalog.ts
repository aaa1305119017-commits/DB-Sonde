export interface SqlLineageParser {
  (sql: string, dialect?: string): Promise<{ ok: boolean; sources: string[]; target?: string | null; flows?: { sources: string[]; targets: string[] }[] }>;
}

import { dataxAdapter } from "./adapters/datax";
import type { Endpoint, EtlJob } from "./types";
import { maxOf } from "../../lib/numbers";
export interface FileInventory {
  root: string;
  files: { path: string; references: string[]; sql: string[]; datax?: unknown }[];
  warnings: string[];
}
export interface FileProfile {
  id: string;
  name: string;
  root: string;
  schedulerBaseUrl?: string;
  host?: string;
  username?: string;
  port?: number;
  pathMappings?: { from: string; to: string }[];
}
const unique = (values: Endpoint[]) => [...new Map(values.map((e) => [JSON.stringify(e), e])).values()];
const endpoint = (name: string): Endpoint => {
  const parts = name.replace(/[`"\[\]]/g, "").split(".");
  return { kind: "db", table: parts.pop(), database: parts.length ? parts.join(".") : undefined };
};
export function resolveReference(
  reference: string,
  paths: string[],
  mappings: FileProfile["pathMappings"] = [],
): string | undefined {
  let ref = reference.replace(/^['"]|['"]$/g, "");
  const applicable = mappings.filter(mapping => ref === mapping.from || ref.startsWith(mapping.from + "/"));
  if (applicable.length) {
    const longest = maxOf(applicable.map(mapping => mapping.from.length))!;
    const candidates = new Set(applicable.filter(mapping => mapping.from.length === longest)
      .map(mapping => mapping.to + ref.slice(mapping.from.length)));
    // Conflicting mappings are unresolved, never decided by directory array order.
    if (candidates.size !== 1) return undefined;
    ref = [...candidates][0];
  }
  const exact = paths.filter(path => path === ref);
  if (exact.length) return exact.length === 1 ? exact[0] : undefined;
  ref = ref.replace(/^\$\{?\w+\}?\//, "");
  const candidates = paths.filter((p) => p.endsWith("/" + ref));
  return candidates.length === 1 ? candidates[0] : undefined;
}
export async function parseFileInventory(
  inventory: FileInventory,
  profile: FileProfile,
  parseSql: SqlLineageParser,
): Promise<{ jobs: EtlJob[]; warnings: string[] }> {
  const warnings = [...inventory.warnings];
  const safeParse: SqlLineageParser = async (sql, dialect) => {
    try { return await parseSql(sql, dialect); }
    catch { return { ok: false, sources: [] }; }
  };
  const jobs: EtlJob[] = [];
  const paths = inventory.files.map((f) => f.path);
  for (const file of inventory.files) {
    const flows: { sources: Endpoint[]; targets: Endpoint[] }[] = [];
    let unparsed = 0;
    if (file.datax) {
      try {
        for (const parsed of dataxAdapter.parse(JSON.stringify(file.datax))) {
          const sources: Endpoint[] = [];
          for (const e of parsed.sources) {
            if (!e.querySql) {
              sources.push(e);
              continue;
            }
            const lineage = await safeParse(
              e.querySql,
              e.system?.includes("postgres") ? "postgres" : e.system?.includes("oracle") ? "oracle" : "mysql",
            );
            if (!lineage.ok) {
              unparsed++;
              continue;
            }
            sources.push(
              ...lineage.sources.map((t) => ({
                ...endpoint(t),
                database: endpoint(t).database ?? e.database,
                host: e.host,
                system: e.system,
              })),
            );
          }
          flows.push({ sources, targets: parsed.targets });
        }
      } catch (e) {
        warnings.push(`${file.path}: ${String(e)}`);
      }
    }
    for (const sql of file.sql ?? []) {
      const lineage = await safeParse(sql);
      if (!lineage.ok) {
        unparsed++;
        continue;
      }
      for (const flow of lineage.flows ?? [
        { sources: lineage.sources, targets: lineage.target ? [lineage.target] : [] },
      ])
        flows.push({ sources: flow.sources.map(endpoint), targets: flow.targets.map(endpoint) });
    }
    if (unparsed) warnings.push(`${file.path}: ${unparsed} 段 SQL 无法静态解析，未生成血缘`);
    jobs.push({
      id: `file:${profile.id}:${file.path}`,
      name: file.path.split("/").pop() ?? file.path,
      kind: file.datax ? "datax" : "generic",
      sources: unique(flows.flatMap((f) => f.sources)),
      targets: unique(flows.flatMap((f) => f.targets)),
      flows,
      references: [file.path, ...file.references.map((ref) => resolveReference(ref, paths, profile.pathMappings)).filter((p): p is string => !!p && p !== file.path)],
      note: flows.length ? `已解析 ${flows.length} 段数据流` : "已识别脚本引用；没有可静态解析的数据流",
    });
  }
  return { jobs, warnings };
}
/** Link a task only through an exact path, configured mapping or unique path suffix. */
export function enrichTasks(tasks: EtlJob[], files: EtlJob[], mappings: FileProfile["pathMappings"] = []): EtlJob[] {
  const paths = files.map((f) => f.references?.[0]).filter((p): p is string => !!p);
  const collect = (ref: string, seen: Set<string>): EtlJob[] => {
    const path = resolveReference(ref, paths, mappings);
    if (!path || seen.has(path)) return [];
    seen.add(path);
    const file = files.find((f) => f.references?.[0] === path)!;
    return [file, ...(file.references ?? []).slice(1).flatMap((r) => collect(r, seen))];
  };
  return tasks.map((task) => {
    if (!task.references?.length) return task;
    const linked = (task.references ?? []).flatMap((ref) => collect(ref, new Set()));
    if (!linked.length) return { ...task, note: "脚本尚未匹配：请配置文件目录及路径映射" };
    const flows = linked.flatMap((f) => f.flows ?? []);
    return {
      ...task,
      sources: unique(flows.flatMap((f) => f.sources)),
      targets: unique(flows.flatMap((f) => f.targets)),
      flows,
      note: `已匹配 ${new Set(linked.map((f) => f.id)).size} 个文件，${flows.length} 段数据流`,
    };
  });
}
