import FileSourceForm from "./FileSourceForm";
import { useMemo, useState } from "react";
import { Plus, Workflow, Trash2, FileInput, ArrowRight, Database, FileText, HelpCircle, FolderInput, Loader2, Table2, Search, Clock } from "lucide-react";
import { useLineage, taskNodeId, tableId } from "../lineage/lineageStore";
import { useEtl } from "./etlStore";
import { etlAdapterList, getEtlAdapter } from "./adapters";
import type { Endpoint, EtlKind, EtlJob, EtlFieldMapping } from "./types";
import { api } from "../../lib/api";
import AssetShell, { openAsset } from "../assets/AssetShell";
import "./etl.css";
import { compareText } from "../../lib/collate";

function EndpointChip({ e }: { e: Endpoint }) {
  const Icon = e.kind === "file" ? FileText : e.kind === "db" ? Database : HelpCircle;
  const isQuery = !!e.querySql && !e.table;
  const main = e.table || e.path || (isQuery ? "查询(SQL)" : e.system) || "?";
  const title = [e.system, e.host, e.database && `库 ${e.database}`, e.querySql ?? e.detail].filter(Boolean).join(" · ");
  return (
    <span className={`etl-ep ${e.kind}${isQuery ? " query" : ""}`} title={title}>
      <Icon size={11} />
      {e.system && <span className="ep-sys">{e.system}</span>}
      <span className="ep-main">{e.database && e.kind === "db" && !isQuery ? `${e.database}.${main}` : e.database && isQuery ? `${e.database}·${main}` : main}</span>
    </span>
  );
}

function AddForm({ kind, onDone }: { kind: EtlKind; onDone: () => void }) {
  const adapter = getEtlAdapter(kind);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [mappingText, setMappingText] = useState("");
  const fieldMapping = () => mappingText.trim() ? JSON.parse(mappingText) as EtlFieldMapping : undefined;
  const parseJobs = (input: string) => adapter.parse(input, fieldMapping());
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const parse = () => {
    setError(null);
    try {
      useEtl.getState().addSourceJobs(name, kind, parseJobs(text), fieldMapping());
      onDone();
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    }
  };

  const folderImport = async () => {
    setError(null);
    setBusy(true);
    try {
      const picked = await api.importFolder(`选择 ${adapter.label} 作业文件夹`);
      if (!picked) return; // cancelled
      const jobs: EtlJob[] = [];
      let ok = 0;
      let skip = 0;
      for (const f of picked.files) {
        try {
          jobs.push(...parseJobs(f.content));
          ok++;
        } catch {
          skip++;
        }
      }
      if (jobs.length === 0) {
        setError(`这个文件夹里没解析出作业(试了 ${picked.files.length} 个 .json)`);
        return;
      }
      const folderName = picked.dir.split("/").filter(Boolean).pop() || adapter.label;
      useEtl.getState().addSourceJobs(name || folderName, kind, jobs, fieldMapping());
      setError(`已导入 ${jobs.length} 个作业(${ok} 个文件成功${skip ? `,跳过 ${skip} 个非 ${adapter.label}` : ""})`);
      setTimeout(onDone, 800);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="etl-add">
      <h3>接入 · {adapter.label}</h3>
      <p className="etl-blurb">{adapter.blurb}</p>
      <label className="etl-field">
        <span>名称</span>
        <input className="input" value={name} placeholder={`如 生产环境 ${adapter.label}`} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="etl-field">
        <span>{adapter.inputHint}</span>
        <textarea
          className="input etl-config"
          value={text}
          spellCheck={false}
          placeholder={adapter.example ?? adapter.inputHint}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      {adapter.supportsMapping && <details><summary>映射现有 JSON 字段（可选）</summary>
        <p className="etl-note">填写客户端字段映射，外部文件无需修改。路径以 / 分隔；作业数组位于根部时 jobs 填空字符串。端点映射同时用于来源和目标。</p>
        <textarea className="input etl-config" aria-label="字段映射" spellCheck={false} value={mappingText} onChange={e => setMappingText(e.target.value)} placeholder={'{"jobs":"/tasks","id":"/code","name":"/title","sources":"/inputs","targets":"/outputs","endpoint":{"database":"/schema","table":"/relation"}}'} />
      </details>}
      <p className="etl-note">配置在本机解析,只留 主机/库/表 等元数据,不保存账号密码。Sonde 不去连你的服务器,配置由你提供。</p>
      {error && <div className="etl-error">{error}</div>}
      <div className="etl-add-actions">
        <button className="btn" onClick={onDone}>取消</button>
        <button className="btn" disabled={busy} onClick={folderImport} title="选一个文件夹,批量导入里面所有 .json 作业(含子目录)">
          {busy ? <Loader2 size={14} className="spin" /> : <FolderInput size={14} />} 选文件夹批量导入
        </button>
        <button className="btn primary" disabled={!text.trim()} onClick={parse}>
          <FileInput size={14} /> 解析并接入
        </button>
      </div>
    </div>
  );
}

/** 一张被写入的表(或落地文件),以及是谁在灌它。 */
interface Target {
  key: string;
  name: string;   // 表名 / 文件名
  db: string | null; // 库名 / 目录
  kind: Endpoint["kind"];
  feeds: { job: EtlJob; sourceName: string; sources: Endpoint[] }[];
}

/**
 * 把所有接入源里的作业按「目标表」翻过来聚合。
 *
 * 原来这里是按接入源(连接器)分组 —— 那是运维视角:"我导入了哪几个 DataX 目录"。
 * 但人打开 ETL 中心真正想问的是「这张表是谁在灌的、什么时候灌、从哪来」。
 * 所以默认视角改成表,接入源退到左侧当管理入口。
 */
function collectTargets(sources: { name: string; jobs: EtlJob[] }[]): Target[] {
  const map = new Map<string, Target>();
  for (const src of sources) {
    for (const job of src.jobs) {
      for (const flow of job.flows ?? [job]) {
        for (const t of flow.targets) {
          const isFile = t.kind === "file";
          const key = isFile ? `file:${t.path ?? t.detail ?? "?"}` : tableId(t.database, t.table || t.detail);
          if (!key) continue;
          let row = map.get(key);
          if (!row) {
            const full = isFile ? (t.path ?? t.detail ?? "?") : key;
            const cut = isFile ? full.lastIndexOf("/") : full.indexOf(".");
            row = {
              key,
              name: cut < 0 ? full : full.slice(cut + 1),
              db: cut < 0 ? null : full.slice(0, cut) || null,
              kind: t.kind,
              feeds: [],
            };
            map.set(key, row);
          }
          // 同一个作业可能有多条 flow 都写这张表,只记一次
          if (!row.feeds.some((f) => f.job.id === job.id)) {
            row.feeds.push({ job, sourceName: src.name, sources: flow.sources });
          } else {
            const f = row.feeds.find((f) => f.job.id === job.id)!;
            f.sources = [...f.sources, ...flow.sources];
          }
        }
      }
    }
  }
  return [...map.values()].sort((a, b) => compareText(a.name, b.name));
}

const epKey = (e: Endpoint) => (e.kind === "file" ? `file:${e.path ?? e.detail}` : `${e.system ?? ""}|${e.database ?? ""}|${e.table ?? e.querySql ?? e.detail ?? ""}`);

function TargetTables() {
  const sources = useEtl((s) => s.sources);
  const [q, setQ] = useState("");
  const targets = useMemo(() => collectTargets(sources), [sources]);
  const kw = q.trim().toLowerCase();
  const shown = kw ? targets.filter((t) => `${t.db ?? ""}.${t.name}`.toLowerCase().includes(kw)) : targets;

  if (targets.length === 0) {
    return (
      <div className="etl-hint">
        <Workflow size={30} />
        <p>还没有任何作业,所以还不知道哪张表是谁灌的。</p>
        <p className="dim">可选择「通用作业」导入现有元数据，也可用文件扫描适配器识别配置；无需调整外部目录结构。</p>
      </div>
    );
  }

  return (
    <div className="etl-targets">
      <div className="etl-tg-bar">
        <div className="etl-tg-lead">
          <b>{targets.length}</b> 张表由 ETL 写入 · 共 <b>{sources.reduce((n, s) => n + s.jobs.length, 0)}</b> 个作业
        </div>
        <div className="toolbar-spacer" />
        <label className="etl-tg-search">
          <Search size={13} />
          <input className="input" placeholder="搜表名 / 库名" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>
      {shown.length === 0 && <div className="etl-state">没有匹配「{q}」的表。</div>}
      {shown.map((t) => {
        const srcEps = [...new Map(t.feeds.flatMap((f) => f.sources).map((e) => [epKey(e), e])).values()];
        const schedules = [...new Set(t.feeds.map((f) => f.job.schedule).filter(Boolean))] as string[];
        return (
          <div className="etl-tg" key={t.key}>
            <div className="etl-tg-head">
              {t.kind === "file" ? <FileText size={14} className="etl-tg-ic" /> : <Table2 size={14} className="etl-tg-ic" />}
              <div className="etl-tg-name">
                {t.name}
                {t.db && <small>{t.db}</small>}
              </div>
              <div className="toolbar-spacer" />
              {schedules.map((c) => (
                <span className="etl-tg-cron" key={c} title="配置里带的定时">
                  <Clock size={11} /> {c}
                </span>
              ))}
              <button
                className="btn sm"
                onClick={() => {
                  useLineage.getState().select(t.key);
                  openAsset("lineage");
                }}
              >
                看上下游
              </button>
            </div>
            <div className="etl-tg-from">
              <span className="etl-tg-cap">来自</span>
              <div className="etl-eps">
                {srcEps.length ? srcEps.map((e, i) => <EndpointChip key={i} e={e} />) : <span className="etl-ep unknown">源未知</span>}
              </div>
            </div>
            <div className="etl-tg-jobs">
              {t.feeds.map((f) => (
                <span className="etl-tg-job" key={f.job.id} title={`来自接入源「${f.sourceName}」${f.job.scheduler ? ` · 工作流 ${f.job.scheduler.workflowName}` : ""}`}>
                  {f.job.name}
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SourceView({ id }: { id: string }) {
  const src = useEtl((s) => s.sources.find((x) => x.id === id));
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!src) return null;

  const doImport = () => {
    setError(null);
    try {
      useEtl.getState().importMore(src.id, importText);
      setImportText("");
      setImporting(false);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ""));
    }
  };

  return (
    <div className="etl-source">
      <div className="etl-source-head">
        <div>
          <div className="etl-source-name">{src.name}</div>
          <div className="etl-source-sub">{getEtlAdapter(src.kind).label} · {src.jobs.length} 个作业</div>
        </div>
        <div className="toolbar-spacer" />
        <button className="btn sm" onClick={() => setImporting((v) => !v)}>
          <Plus size={13} /> 导入更多
        </button>
        <button className="btn sm danger" onClick={() => useEtl.getState().removeSource(src.id)}>
          <Trash2 size={13} /> 删除
        </button>
      </div>

      {importing && (
        <div className="etl-import">
          <textarea
            className="input etl-config"
            value={importText}
            spellCheck={false}
            placeholder={src.fieldMapping ? "粘贴作业 JSON，复用已保存的字段映射" : getEtlAdapter(src.kind).inputHint}
            onChange={(e) => setImportText(e.target.value)}
          />
          {error && <div className="etl-error">{error}</div>}
          <div className="etl-add-actions">
            <button className="btn sm" onClick={() => { setImporting(false); setError(null); }}>取消</button>
            <button className="btn sm primary" disabled={!importText.trim()} onClick={doImport}>解析追加</button>
          </div>
        </div>
      )}

      <div className="etl-jobs">
        {src.jobs.length === 0 ? (
          <div className="etl-state">这个源还没有作业。</div>
        ) : (
          src.jobs.map((j) => (
            <div className="etl-job" key={j.id}>
              <div className="etl-job-name">{j.name}</div>
              <div className="etl-flow">
                <div className="etl-eps">
                  {j.sources.length ? j.sources.map((e, i) => <EndpointChip key={i} e={e} />) : <span className="etl-ep unknown">源未知</span>}
                </div>
                <ArrowRight size={15} className="etl-arrow" />
                <div className="etl-eps">
                  {j.targets.length ? j.targets.map((e, i) => <EndpointChip key={i} e={e} />) : <span className="etl-ep unknown">目标未知</span>}
                </div>
              </div>
              {j.scheduler && <div className="etl-job-sched">工作流：{j.scheduler.workflowName} · 任务 {j.scheduler.taskCode}</div>}
              {j.note && <div className="etl-job-sched">{j.note}</div>}
              <div className="etl-job-sched">{j.references?.map(path=><div key={path}><code>{path}</code></div>)}</div>
              <button className="btn sm" onClick={()=>{useLineage.getState().select(taskNodeId(j));openAsset("lineage");}}>查看血缘</button>
              {j.scheduler && <button className="btn sm" onClick={()=>openAsset("sched")}>调度与运行记录</button>}
              {j.schedule && <div className="etl-job-sched">定时:{j.schedule}</div>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function EtlCenter() {
  const open = useEtl((s) => s.open);
  const sources = useEtl((s) => s.sources);
  const selectedId = useEtl((s) => s.selectedId);
  const [fileForm,setFileForm]=useState(false);
  const [addKind, setAddKind] = useState<EtlKind | null>(null);
  if (!open) return null;


  return (
    <AssetShell title="ETL" sub="每张表是谁在灌、从哪来、多久跑一次">
        <div className="etl-body">
          <aside className="etl-rail">
            <button className="btn primary sm" onClick={()=>setFileForm(true)}>连接目录 / 自动识别</button>
            <button
              className={`etl-src-row lead ${!selectedId && !addKind && !fileForm ? "on" : ""}`}
              onClick={() => { useEtl.getState().select(null); setAddKind(null); setFileForm(false); }}
            >
              <Table2 size={14} className="etl-src-ic" />
              <div className="etl-src-body">
                <div className="etl-src-rowname">按目标表看</div>
                <div className="etl-src-rowsub">这张表是谁在灌</div>
              </div>
            </button>
            <div className="rail-head">接入源(管理用)</div>
            <div className="etl-src-list">
              {sources.length === 0 && <div className="etl-empty">还没接入 ETL 源。</div>}
              {sources.map((s) => (
                <div
                  key={s.id}
                  className={`etl-src-row ${selectedId === s.id && !addKind ? "on" : ""}`}
                  onClick={() => { useEtl.getState().select(s.id); setAddKind(null); setFileForm(false); }}
                >
                  <Workflow size={14} className="etl-src-ic" />
                  <div className="etl-src-body">
                    <div className="etl-src-rowname">{s.name}</div>
                    <div className="etl-src-rowsub">{getEtlAdapter(s.kind).label} · {s.jobs.length}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="etl-add-head">接入 ETL 源</div>
            {etlAdapterList.map((a) => (
              <button
                key={a.kind}
                className="etl-add-btn"
                disabled={!a.available}
                onClick={() => { setAddKind(a.kind); useEtl.getState().select(null); }}
              >
                <Plus size={13} />
                <span className="etl-add-label">{a.label}</span>
                {!a.available && <span className="etl-soon">即将支持</span>}
              </button>
            ))}
          </aside>
          <main className="etl-main">
            {fileForm ? <FileSourceForm onDone={()=>setFileForm(false)} /> : addKind ? (
              <AddForm kind={addKind} onDone={() => setAddKind(null)} />
            ) : selectedId ? (
              <SourceView id={selectedId} />
            ) : (
              <TargetTables />
            )}
          </main>
        </div>
    </AssetShell>
  );
}
