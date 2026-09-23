import { useMemo } from "react";
import {
  X,
  ArrowUp,
  ArrowDown,
  Gauge,
  Workflow,
  Sparkles,
  Table2,
  GitBranch,
  TableProperties,
  CircleAlert,
  Clock,
} from "lucide-react";
import { useEntity, type EntityTarget } from "./entityStore";
import { useFreshness } from "./freshness";
import { buildGraph } from "../lineage/lineageStore";
import { openAsset } from "../assets/AssetShell";
import { useLineage } from "../lineage/lineageStore";
import { useEtl } from "../etl/etlStore";
import { useMetrics } from "../metrics/metricsStore";
import { buildEntityPrompt, collectEntityFacts, type JobFact } from "./entityPrompt";
import { useAi } from "../ai/aiStore";
import { useApp, type TreeNode } from "../../store/appStore";
import "./entity.css";



/** 把 db.table 拆成「表名 + 小字库名」显示 —— 比一长串点号 ID 好认。 */
function TableChip({ id, onClick }: { id: string; onClick: () => void }) {
  const dot = id.indexOf(".");
  const db = dot >= 0 ? id.slice(0, dot) : "";
  const table = dot >= 0 ? id.slice(dot + 1) : id;
  return (
    <button className="e360-chip" title={id} onClick={onClick}>
      {table}{db && <small className="e360-chip-db">{db}</small>}
    </button>
  );
}

/** 一条 ETL 作业行。名字之外还要说清「从哪读、灌哪几列」,否则同名作业分不清。 */
function JobRow({ src, job, from, cols }: JobFact) {
  const shown = cols.slice(0, 4);
  return (
    <div className="e360-job" title={cols.length ? `产出字段:${cols.join("、")}` : job.name}>
      <div className="e360-job-top">
        <span className="e360-job-name">{job.name}</span>
        <span className="e360-job-src">{src}</span>
      </div>
      {(from.length > 0 || shown.length > 0) && (
        <div className="e360-job-sub">
          {from.length > 0 && <span className="e360-job-from">← {from.slice(0, 2).join("、")}{from.length > 2 ? ` 等 ${from.length} 张` : ""}</span>}
          {shown.length > 0 && (
            <span className="e360-job-cols">
              灌 {shown.join("、")}
              {cols.length > shown.length ? ` 等 ${cols.length} 列` : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** 同一批作业常被两种方式接进来(扫文件夹 + 扫服务器),不分组就像重复了一堆。 */
function JobGroups({ rows }: { rows: JobFact[] }) {
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const bucket = groups.get(r.src); if (bucket) bucket.push(r); else groups.set(r.src, [r]); };
  return (
    <>
      {[...groups].map(([src, list]) => (
        <div className="e360-jobgroup" key={src}>
          <div className="e360-jobgroup-h">
            {src} <b>{list.length}</b>
          </div>
          {list.map((p) => <JobRow key={p.job.id} {...p} />)}
        </div>
      ))}
    </>
  );
}

export default function Entity360() {
  const target = useEntity((s) => s.target);
  const scanned = useLineage((s) => s.scanned);
  const etlSources = useEtl((s) => s.sources);

  /* etlSources 不是多余依赖:buildGraph 内部读的是 useEtl.getState().sources,
     eslint 看不穿 getState()。去掉它,ETL 作业变了血缘图不会重建。 */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const graph = useMemo(() => buildGraph(scanned), [scanned, etlSources]);

  const freshness = useFreshness(target);
  const data = useMemo(
    () => (target ? collectEntityFacts(target, graph, etlSources, useMetrics.getState().metrics) : null),
    [target, graph, etlSources],
  );

  if (!target || !data) return null;

  const jump = (tableId: string) => {
    // tableId is "db.table" or "table" — navigate the panel to it (same connection)
    const dot = tableId.indexOf(".");
    const database = dot >= 0 ? tableId.slice(0, dot) : target.database;
    const table = dot >= 0 ? tableId.slice(dot + 1) : tableId;
    useEntity.getState().open({ ...target, database, table, objectKind: undefined });
  };

  const askAi = () => {
    useAi.getState().seedAsk(buildEntityPrompt(data, target.connName ?? target.connId), String(data.id).toLowerCase());
    useEntity.getState().close();
  };

  const openData = () => {
    const t = target;
    const node: TreeNode = {
      key: `c:${t.connId}/d:${t.database ?? ""}/t:${t.table}`,
      kind: t.objectKind ?? "table",
      label: t.table,
      connId: t.connId,
      database: t.database,
      schema: t.schema ?? "",
      table: t.table,
      childKeys: [],
      hasChildren: false,
      loaded: false,
      loading: false,
      expanded: false,
    };
    void useApp.getState().openTableTab(node);
    useEntity.getState().close();
  };

  const seeInLineage = () => {
    useLineage.getState().select(data.id);
    openAsset("lineage");
    useEntity.getState().close();
  };

  const nothing = data.up.length + data.downTables.length + data.metrics.length + data.producedBy.length + data.consumedBy.length === 0;

  return (
    <div className="e360-overlay" onMouseDown={() => useEntity.getState().close()}>
      <div className="e360-drawer" onMouseDown={(e) => e.stopPropagation()}>
        <header className="e360-head">
          <Table2 size={16} />
          <div className="e360-title">
            <div className="e360-name">{data.id}</div>
            <div className="e360-sub">{target.connName ?? target.connId} · 360° 全景</div>
          </div>
          <button className="ai-icon" title="关闭" onClick={() => useEntity.getState().close()}>
            <X size={16} />
          </button>
        </header>

        <div className="e360-actions">
          <button className="btn sm" onClick={openData}><TableProperties size={13} /> 打开表数据</button>
          <button className="btn sm" onClick={seeInLineage}><GitBranch size={13} /> 在血缘中看</button>
          <button className="btn sm primary" onClick={askAi}><Sparkles size={13} /> 问 AI</button>
        </div>

        <div className="e360-body">
          {nothing && (
            <div className="e360-hint">
              <CircleAlert size={15} />
              还没有关联信息。到「血缘」点「扫描 ETL / 视图 / 指标血缘」,或在「ETL 中心」导入作业后,这里就会显示上下游、指标、作业。
            </div>
          )}

          <section className="e360-sec">
            <div className="e360-sec-h"><Clock size={13} /> 数据新鲜度</div>
            {freshness.loading ? (
              <div className="e360-none">正在看这张表更新到哪儿了…</div>
            ) : freshness.error ? (
              <div className="e360-none">读不到(可能没连上库)</div>
            ) : freshness.unavailable ? (
              <div className="e360-none">这张表没有可用的时间列,判断不了</div>
            ) : (
              <div className={`e360-fresh tone-${freshness.tone ?? "fresh"}`}>
                <b>{freshness.value}</b>
                {freshness.ago && <span className="e360-fresh-ago">{freshness.ago}</span>}
                <span className="e360-fresh-col">按 {freshness.column} 算</span>
              </div>
            )}
          </section>

          <section className="e360-sec">
            <div className="e360-sec-h"><ArrowUp size={13} /> 血缘 · 上游(它依赖谁) <b>{data.up.length}</b></div>
            {data.up.length === 0 ? <div className="e360-none">—</div> : (
              <div className="e360-chips">{data.up.map((n) => <TableChip key={n} id={n} onClick={() => jump(n)} />)}</div>
            )}
          </section>

          <section className="e360-sec">
            <div className="e360-sec-h"><ArrowDown size={13} /> 血缘 · 下游/影响(谁依赖它) <b>{data.downTables.length}</b></div>
            {data.downTables.length === 0 ? <div className="e360-none">—</div> : (
              <div className="e360-chips">{data.downTables.map((n) => <TableChip key={n} id={n} onClick={() => jump(n)} />)}</div>
            )}
          </section>

          <section className="e360-sec">
            <div className="e360-sec-h"><Gauge size={13} /> 建在它上的指标 <b>{data.metrics.length}</b></div>
            {data.metrics.length === 0 ? <div className="e360-none">扫描指标血缘后显示</div> : (
              <div className="e360-chips">
                {data.metrics.map((m) => (
                  <span
                    key={m.id}
                    className="e360-chip metric"
                    title={[
                      m.fields.length ? `用到这张表的字段:${m.fields.join("、")}` : "解析不出它读了哪些字段",
                      m.caliber ? `口径:${m.caliber}` : "",
                      `指标 ID:${m.id}`,
                    ].filter(Boolean).join("\n")}
                  >
                    {m.name}
                    {m.fields.length > 0 && <small className="e360-chip-n">{m.fields.length} 字段</small>}
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="e360-sec">
            <div className="e360-sec-h"><Workflow size={13} /> 产出它的 ETL 作业 <b>{data.producedBy.length}</b></div>
            {data.producedBy.length === 0 ? <div className="e360-none">—</div> : (
              <div className="e360-jobs">
                <JobGroups rows={data.producedBy} />
              </div>
            )}
          </section>

          {data.consumedBy.length > 0 && (
            <section className="e360-sec">
              <div className="e360-sec-h"><Workflow size={13} /> 读取它的 ETL 作业 <b>{data.consumedBy.length}</b></div>
              <div className="e360-jobs">
                <JobGroups rows={data.consumedBy} />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/** Convenience for callers (tree/lineage) to open the panel. */
export function openEntity360(t: EntityTarget) {
  useEntity.getState().open(t);
}
