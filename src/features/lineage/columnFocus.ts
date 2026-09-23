import { useEtl } from "../etl/etlStore";
import { useMetrics } from "../metrics/metricsStore";
import { metricSourceTables } from "../metrics/metricSql";
import { tableId } from "./lineageStore";
import { outputColumns, sqlVocab } from "./sqlColumns";
import type { Graph } from "./lineageStore";

/**
 * 「这张宽表的上游，跟我这个指标有关系吗」
 *
 * 血缘是表级的，可 ads 层常常是一张几十列的宽表，由十几个各灌几列的作业拼出来。
 * 于是"销售额"的上游里会冒出供应链库存、会员、巡检评分这些压根不相干的表 ——
 * 它们只是恰好写了同一张表的别的列。
 *
 * 这里不做完整的列级血缘(那要按 schema 解析每条 SQL)，而是用一个便宜且够准的
 * 近似:每个灌入口的 SELECT 里写着它产出哪些列(`... AS online_gmv_amt`)，指标的
 * 口径 SQL 里写着它读哪些列。两边对一下,只留碰得上的那几条入口。
 * 顺着接受的入口往上走时,词表换成那条入口自己的 SQL —— 于是相关性能一层层传下去。
 *
 * 原则:宁可多留,不可错杀。对不上任何一条(解析不出、纯表对表同步)就全留。
 */

interface Feed {
  sql: string;
  outCols: Set<string>;
}

/** 按目标表收集灌入口(flow 粒度)。 */
function buildFeeds(): Map<string, Feed[]> {
  const map = new Map<string, Feed[]>();
  for (const src of useEtl.getState().sources) {
    for (const job of src.jobs) {
      for (const flow of job.flows ?? [job]) {
        const sql = flow.sources.map((e) => e.querySql ?? "").filter(Boolean).join("\n");
        for (const t of flow.targets) {
          const id = t.kind === "file" ? `file:${t.path ?? t.detail ?? "?"}` : tableId(t.database, t.table || t.detail);
          if (!id) continue;
          const entry = { sql, outCols: sql ? outputColumns(sql) : new Set<string>() };
          const bucket = map.get(id); if (bucket) bucket.push(entry); else map.set(id, [entry]);
        }
      }
    }
  }
  return map;
}

/** 灌同一张表的入口大多都写 stat_date / store_id / etl_time,这类共有列不具区分度。 */
function distinctiveCols(feeds: Feed[]): Map<Feed, Set<string>> {
  const freq = new Map<string, number>();
  for (const f of feeds) for (const c of f.outCols) freq.set(c, (freq.get(c) ?? 0) + 1);
  const common = Math.max(2, Math.ceil(feeds.length * 0.5));
  const out = new Map<Feed, Set<string>>();
  for (const f of feeds) out.set(f, new Set([...f.outCols].filter((c) => (freq.get(c) ?? 0) < common)));
  return out;
}

/** 上游表(作业 / 工作流节点当透明管道穿过去)。 */
function upTables(graph: Graph, id: string): string[] {
  const out = new Set<string>();
  const through = (n: string) => n.startsWith("task:") || n.startsWith("workflow:");
  for (const e of graph.up.get(id) ?? []) {
    if (through(e.from)) for (const e2 of graph.up.get(e.from) ?? []) { if (!through(e2.from)) out.add(e2.from); }
    else out.add(e.from);
  }
  return [...out];
}

/** 表名在这段 SQL 里出现过吗(dim_outlet 不该匹配到 dim_outlet_mapping)。 */
function mentions(sql: string, id: string): boolean {
  const name = id.split(".").pop() ?? id;
  /* 名字太短(t1、fx 这种)判断不出来:`\bt1\b` 会撞上 SQL 里随便一个别名。
     但"判断不出来"按本模块的原则就得**留下** —— 原来这儿返回 false,
     调用方看到 from.length === 0 就把这个上游剪掉了,正好反着来。 */
  if (name.length < 3) return true;
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(sql);
}

/**
 * 从指标出发,只沿"列对得上"的入口往上走,返回该留下的节点。
 * 返回 null = 判断不了(不是指标、没有 ETL 信息),调用方别剪。
 */
export function relevantUpstream(graph: Graph, focusId: string): Set<string> | null {
  if (!focusId.startsWith("metric:")) return null;
  const metric = useMetrics.getState().metrics.find((m) => m.id === focusId.slice(7));
  if (!metric) return null;
  const roots = metricSourceTables(metric).map((t) => tableId(metric.database, t)).filter(Boolean);
  if (roots.length === 0) return null;

  const feeds = buildFeeds();
  if (feeds.size === 0) return null;

  // 指标口径里出现的所有词 = 它碰过的列。
  // measure/ratio 型的列名只出现在 expression / numerator / denominator 里 ——
  // 漏掉它们词表就是空的，下面的相关性判断会全部走兜底，等于没筛。
  const metricSql = [
    JSON.stringify(metric.queryPlan ?? ""),
    metric.sql ?? "",
    metric.expression ?? "",
    metric.numerator ?? "",
    metric.denominator ?? "",
    metric.caliber ?? "",
  ].join(" ");
  const keep = new Set<string>([focusId, ...roots]);
  /* 走过的节点连同"用什么词表走过的"一起记下来。
     原来只记 id:同一张表被两条路径走到时,**第一条的词表赢**,第二条带来的列名
     直接丢掉 —— 于是它自己的上游是按半个词表剪的,剪掉了本该留下的表。
     菱形血缘(两条入口都灌这张中间表)就是这个形状。
     改成词表取并集,只有真带来新词时才重走:词表只增不减,所以一定收敛。 */
  const walked = new Map<string, Set<string> | null>();
  const queue: { id: string; vocab: Set<string> | null }[] = roots.map((id) => ({ id, vocab: sqlVocab(metricSql) }));

  while (queue.length) {
    const next = queue.shift()!;
    const id = next.id;
    let vocab = next.vocab;
    if (walked.has(id)) {
      const before = walked.get(id)!;
      // null 表示"这条路上没 SQL 可参考,上游全留",已经是最宽的了,不会更宽
      if (before === null) continue;
      if (vocab === null) {
        // 这次是全留,比之前宽 —— 要按全留再走一遍
      } else {
        const fresh = [...vocab].filter((w) => !before.has(w));
        if (fresh.length === 0) continue; // 没带来新词,走了也是一样的结果
        vocab = new Set([...before, ...vocab]);
      }
    }
    walked.set(id, vocab);

    const ups = upTables(graph, id);
    if (ups.length === 0) continue;

    const list = (feeds.get(id) ?? []).filter((f) => f.sql);
    if (list.length === 0 || !vocab) {
      // 没有灌入口的 SQL 可参考 —— 退回表级血缘,上游全留
      for (const u of ups) { keep.add(u); queue.push({ id: u, vocab: null }); }
      continue;
    }
    const dist = distinctiveCols(list);
    const hit = list.filter((f) => [...(dist.get(f) ?? [])].some((c) => vocab.has(c)));
    // 一条都对不上(词表没覆盖 / 解析不出列)就全留,别把人的上游剪没了
    const chosen = hit.length ? hit : list;

    for (const u of ups) {
      const from = chosen.filter((f) => mentions(f.sql, u));
      if (from.length === 0) continue; // 这个上游只服务于被剪掉的那几列
      keep.add(u);
      const vocabUp = new Set<string>();
      for (const f of from) for (const w of sqlVocab(f.sql)) vocabUp.add(w);
      queue.push({ id: u, vocab: vocabUp });
    }
  }

  // 下游(谁用了这个指标)不剪
  const down = [focusId];
  while (down.length) {
    const id = down.shift()!;
    for (const e of graph.down.get(id) ?? []) if (!keep.has(e.to)) { keep.add(e.to); down.push(e.to); }
  }
  return keep;
}
