import { buildGraph, nodeLabelOf, nodeKindOf, useLineage, type Graph } from "../lineage/lineageStore";
import { useOps, type HealthState } from "../lineage/opsStore";
import { useMetrics } from "../metrics/metricsStore";
import { metricSourceTables } from "../metrics/metricSql";
import { useEtl } from "../etl/etlStore";

/** P6 —— 跨模块上下文装配。
 *
 *  把 血缘 / 运行&巡检 / 指标口径 / ETL 四个中心的信息,围绕「一张表」聚成一份
 *  紧凑的实体档案,喂给 AI,让它能回答"几点跑 / 谁在用 / 上游挂没挂 / 口径是什么",
 *  并据此给补数 / 排障建议。纯读现有 store,不连任何服务器、不写死任何表名。 */

const norm = (s?: string) => (s ?? "").trim().toLowerCase();
const STATE_CN: Record<HealthState, string> = {
  ok: "成功",
  error: "失败",
  running: "运行中",
  warn: "暂停/停止",
  unknown: "未知",
};

function neighborLabels(edges: { from: string; to: string }[] | undefined, side: "from" | "to", cap = 8): string[] {
  if (!edges) return [];
  const ids = [...new Set(edges.map((e) => e[side]))];
  const out = ids.slice(0, cap).map((id) => {
    const k = nodeKindOf(id);
    const tag = k === "metric" ? "指标:" : k === "dataset" ? "看板:" : k === "file" ? "文件:" : "";
    return `${tag}${nodeLabelOf(id)}`;
  });
  if (ids.length > cap) out.push(`…共 ${ids.length} 个`);
  return out;
}

/** Metrics whose base tables include this table → 名称(单位):口径. */
function metricsUsing(tableId: string): string[] {
  const metrics = useMetrics.getState().metrics;
  const lookup = (id: string) => metrics.find((x) => x.id === id);
  const out: string[] = [];
  for (const m of metrics) {
    const bases = metricSourceTables(m, lookup).map(norm);
    if (bases.includes(tableId)) {
      out.push(`${m.name}${m.unit ? `(${m.unit})` : ""}${m.caliber ? `:${m.caliber}` : ""}`);
    }
  }
  return out;
}

/** ETL jobs that read or write this table → 作业名: 源 → 目标. */
function etlJobsFor(tableId: string): string[] {
  const out: string[] = [];
  const key = (e: { database?: string; table?: string; path?: string }) =>
    norm(e.database && e.table ? `${e.database}.${e.table}` : e.table || e.path || "");
  for (const src of useEtl.getState().sources) {
    for (const job of src.jobs) {
      const srcs = job.sources.map(key);
      const tgts = job.targets.map(key);
      const bare = tableId.split(".").pop() ?? tableId;
      const hit = [...srcs, ...tgts].some((k) => k === tableId || k === bare || k.endsWith(`.${bare}`));
      if (!hit) continue;
      const s = job.sources.map((e) => e.table || e.querySql?.slice(0, 24) || e.path || e.system || "?").join(", ") || "?";
      const t = job.targets.map((e) => e.table || e.path || "?").join(", ") || "?";
      out.push(`${job.name}${job.schedule ? `(@${job.schedule})` : ""}: ${s} → ${t}`);
    }
  }
  return [...new Set(out)].slice(0, 6);
}

/** One table's dossier as compact Chinese text. */
function tableDossier(graph: Graph, id: string): string {
  const label = nodeLabelOf(id);
  const ops = useOps.getState().ops[id];
  const health = useOps.getState().health[id];
  const up = neighborLabels(graph.up.get(id), "from");
  const down = neighborLabels(graph.down.get(id), "to");

  const lines: string[] = [`【表 ${label}】`];
  lines.push(`- 上游依赖: ${up.length ? up.join("、") : "(无 / 未扫描)"}`);
  lines.push(`- 下游影响 / 谁在用: ${down.length ? down.join("、") : "(无 / 未扫描)"}`);

  if (ops?.scheduleHuman || ops?.schedule) {
    const origin = ops.origin === "scheduler" ? "调度中心" : ops.origin === "etl" ? "ETL 推断" : "手工";
    lines.push(`- 几点跑: ${ops.scheduleHuman ?? ops.schedule}${ops.scheduleHuman && ops.schedule ? `(${ops.schedule})` : ""} · 来源 ${origin}${ops.online === false ? " · 已下线" : ""}${ops.scheduled === false ? " · 未启用调度" : ""}`);
  } else {
    lines.push(`- 几点跑: 未知(未同步调度 / 未标注)`);
  }

  if (health) {
    lines.push(`- 上次运行: ${STATE_CN[health.state]}${health.lastRun ? ` · ${health.lastRun}` : ""}${health.duration ? ` · 耗时 ${health.duration}` : ""}`);
    lines.push(`- 是否重跑: ${health.rerun ? `是(补数/重跑${health.retries ? ` · ${health.retries} 次` : ""})` : "否"}`);
  } else {
    lines.push(`- 上次运行: 无运行记录`);
  }

  // upstream health problems ("上游挂没挂")
  const upIds = [...new Set((graph.up.get(id) ?? []).map((e) => e.from))];
  const bad = upIds
    .map((uid) => ({ uid, h: useOps.getState().health[uid] }))
    .filter((x) => x.h && x.h.state !== "ok" && x.h.state !== "unknown");
  if (bad.length) {
    lines.push(`- 上游健康告警: ${bad.map((x) => `${nodeLabelOf(x.uid)}=${STATE_CN[x.h!.state]}`).join("、")}`);
  } else if (upIds.length) {
    lines.push(`- 上游健康: 均正常或未知`);
  }

  if (ops?.owner || ops?.sla || ops?.note) {
    lines.push(`- 运维: ${[ops.owner && `负责人 ${ops.owner}`, ops.sla && `SLA ${ops.sla}`, ops.note && `备注 ${ops.note}`].filter(Boolean).join(" · ")}`);
  }

  const mets = metricsUsing(id);
  if (mets.length) lines.push(`- 相关指标口径: ${mets.slice(0, 8).join(" | ")}`);

  const jobs = etlJobsFor(id);
  if (jobs.length) lines.push(`- ETL 作业: ${jobs.join(" ; ")}`);

  return lines.join("\n");
}

/** Resolve which table nodes to describe: the focus if given, else table nodes
 *  whose label is mentioned in the question (capped). */
function pickTargets(graph: Graph, focusId: string | null, question: string, cap = 3): string[] {
  if (focusId) {
    const n = graph.nodes.find((x) => x.id === focusId);
    if (n && n.kind === "table") return [focusId];
    // a metric/dataset focus → describe its upstream tables
    if (n) {
      const ups = [...new Set((graph.up.get(focusId) ?? []).map((e) => e.from))].filter((id) => nodeKindOf(id) === "table");
      if (ups.length) return ups.slice(0, cap);
    }
  }
  const q = norm(question);
  const hits = graph.nodes.filter((n) => n.kind === "table" && n.label.length > 1 && q.includes(norm(n.label)));
  return hits.slice(0, cap).map((n) => n.id);
}

/** Build the 跨模块运营上下文 block for the AI, or "" if nothing relevant. */
export function buildOpsContext(focusId: string | null, question: string): string {
  const graph = buildGraph(useLineage.getState().scanned);
  if (graph.nodes.length === 0) return "";
  const targets = pickTargets(graph, focusId, question);
  if (targets.length === 0) return "";
  return targets.map((id) => tableDossier(graph, id)).join("\n\n");
}

/** Human label for the focus chip. */
export function focusLabel(focusId: string | null): string | null {
  return focusId ? nodeLabelOf(focusId) : null;
}

/** P6 深化 —— 巡检简报:跑一遍巡检,把发现 + 受影响表的运行档案打包成一段
 *  问题文本,让 AI 给「今日异常摘要 + 排障/补数顺序建议」。 */
export function buildInspectionBriefing(): string {
  const graph = buildGraph(useLineage.getState().scanned);
  const findings = useOps.getState().inspect(graph);
  const LEVEL: Record<string, string> = { error: "失败", warn: "警告", info: "提示" };

  if (findings.length === 0) {
    return "请对当前数据血缘做一次巡检点评:本次自动巡检(运行失败 / 上游失败波及 / 缺少调度 / 疑似陈旧)未发现异常。请确认是否还有值得关注的运维风险,或回复「暂无异常」。";
  }

  const findingLines = findings.map((f) => `- [${LEVEL[f.level] ?? f.level}] ${f.text}`).join("\n");
  // 受影响的表节点去重(findings 都锚在 table 节点上),各附一份档案
  const ids = [...new Set(findings.map((f) => f.nodeId))].filter((id) => nodeKindOf(id) === "table").slice(0, 12);
  const dossiers = ids.map((id) => tableDossier(graph, id)).join("\n\n");

  return [
    "你是数据平台运维助手。下面是当前数据血缘的自动巡检结果和相关表的运行档案。",
    "请给出:1)一句话总体健康判断;2)「今日异常摘要」——按严重度归纳有哪些问题;3)「建议处理顺序」——按依赖关系编号排序,先修最上游的失败,再往下游补;每条注明依据(基于哪条发现/哪张表)和下一步动作。",
    "注意:涉及重跑/补数/改数的动作只给建议,让我到调度中心自己执行;档案里没有的信息不要臆测。",
    "",
    `巡检发现(${findings.length} 条,已按严重度排序):`,
    findingLines,
    "",
    "涉及表的运行档案:",
    dossiers,
  ].join("\n");
}
