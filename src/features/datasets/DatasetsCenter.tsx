/**
 * 数据集中心。
 *
 * 一个数据集回答的是「这个组件的数拿哪张表算」:要么直接写一段 SQL,要么选主表再
 * 关联几张表。
 *
 * 关联这块刻意不做成一排下拉框:那是把 SQL 的 FROM 子句拆成十个控件让人一个个填,
 * 填完还得在脑子里拼回去。这里把它写成一句能读的话 —— 「以 A 为主表,左连接 B,当
 * A.x = B.y」 —— 句子里每个词都能点着改。加表时先自动推断关联字段,人只需要看一眼
 * 对不对。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sql as sqlLang } from "@codemirror/lang-sql";
import { syntaxHighlighting } from "@codemirror/language";
import { Boxes, ChevronDown, ChevronRight, Database, Loader2, Play, Plus, Save, Search, Table2, Trash2, Wand2 } from "lucide-react";
import AssetShell from "../assets/AssetShell";
import { editorTheme, highlight } from "../../components/SqlEditor";
import { useApp } from "../../store/appStore";
import { api } from "../../lib/api";
import type { QueryResult } from "../../types";
import { useDatasets } from "./datasetsStore";
import { previewDataset, probeFields } from "./service";
import { guessJoin } from "./inferJoin";
import DatasetCanvas, { type CanvasTable } from "./DatasetCanvas";
import DatasetFieldPanel from "./DatasetFieldPanel";
import {
  buildDatasetSql, createDataset, validateDataset,
  type Dataset,
} from "./domain";
import "./datasets.css";

function useTables(connId: string, database: string | undefined) {
  const [tables, setTables] = useState<{ name: string; comment?: string }[]>([]);
  useEffect(() => {
    if (!connId) { setTables([]); return; }
    let cancelled = false;
    void api.listTables(connId, database ?? "", "")
      .then((list) => { if (!cancelled) setTables(list.map((t) => ({ name: t.name, comment: t.comment ?? undefined }))); })
      .catch(() => { if (!cancelled) setTables([]); });
    return () => { cancelled = true; };
  }, [connId, database]);
  return tables;
}

function useDatabases(connId: string) {
  const [databases, setDatabases] = useState<string[]>([]);
  useEffect(() => {
    if (!connId) { setDatabases([]); return; }
    let cancelled = false;
    void api.listDatabases(connId)
      .then((list) => { if (!cancelled) setDatabases(list); })
      .catch(() => { if (!cancelled) setDatabases([]); });
    return () => { cancelled = true; };
  }, [connId]);
  return databases;
}

/** 表的列。关联要用,自动推断也要用,所以按「连接+库+表」缓存在一处。
 *
 *  load 返回列本身,而不只是塞进缓存:推断关联字段就发生在选中表的那一刻,那时
 *  setState 还没回来,读缓存只会读到空的 —— 于是「自动推断」什么都推不出来。 */
function useTableColumns(connId: string, database: string | undefined) {
  const [cache, setCache] = useState<Record<string, string[]>>({});
  const cacheRef = useRef<Record<string, string[]>>({});
  const inFlight = useRef<Record<string, Promise<string[]>>>({});

  useEffect(() => { cacheRef.current = {}; inFlight.current = {}; setCache({}); }, [connId, database]);

  const load = (table: string): Promise<string[]> => {
    if (!connId || !table) return Promise.resolve([]);
    const known = cacheRef.current[table];
    if (known) return Promise.resolve(known);
    const running = inFlight.current[table];
    if (running) return running;
    const work = api.listColumns(connId, database ?? "", "", table)
      .then((list) => list.map((c) => c.name))
      .catch(() => [] as string[])
      .then((names) => {
        cacheRef.current = { ...cacheRef.current, [table]: names };
        setCache(cacheRef.current);
        delete inFlight.current[table];
        return names;
      });
    inFlight.current[table] = work;
    return work;
  };
  return { columns: cache, load };
}

/** 紧凑下拉:整块可点,值显示在上面。用于关联条里的字段和连接方式。 */
function Pick({ value, options, onChange, placeholder, className }: {
  value: string;
  options: Array<{ value: string; label: string; hint?: string }>;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <span className={`ds-pick ${className ?? ""} ${value ? "" : "empty"}`}>
      <span className="ds-pick-text">{current?.label || value || placeholder}</span>
      <ChevronDown size={11} />
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.hint ? `${option.label} · ${option.hint}` : option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

export default function DatasetsCenter() {
  const open = useDatasets((s) => s.open);
  const datasets = useDatasets((s) => s.datasets);
  const connections = useApp((s) => s.connections);
  const [draft, setDraft] = useState<Dataset | null>(null);
  const [busy, setBusy] = useState<"probe" | "preview" | "save" | null>(null);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [message, setMessage] = useState<string>();
  const [picked, setPicked] = useState<string | undefined>();   // 画布上选中的表
  const [tableSearch, setTableSearch] = useState("");
  const [bottomTab, setBottomTab] = useState<"fields" | "preview">("fields");

  const kind = connections.find((c) => c.id === draft?.connectionId)?.kind;
  const databases = useDatabases(draft?.connectionId ?? "");
  const tables = useTables(draft?.connectionId ?? "", draft?.database);
  const { columns, load } = useTableColumns(draft?.connectionId ?? "", draft?.database);
  const generated = useMemo(() => {
    try { return draft ? buildDatasetSql(draft, kind) : ""; } catch { return ""; }
  }, [draft, kind]);
  const problem = draft ? validateDataset(draft) : undefined;
  const source = draft?.source;

  // 句子里出现的每张表都要有列可选,进来就把它们的列拉回来。
  useEffect(() => {
    if (source?.kind !== "join") return;
    if (source.base.table) load(source.base.table);
    for (const join of source.joins) if (join.table) load(join.table);
  });

  useEffect(() => { if (!open) { setDraft(null); setPreview(null); setMessage(undefined); } }, [open]);
  if (!open) return null;

  const patch = (next: Partial<Dataset>) => setDraft((d) => (d ? { ...d, ...next } : d));

  const run = async (what: "probe" | "preview") => {
    if (!draft) return;
    setBusy(what); setMessage(undefined);
    try {
      if (what === "probe") {
        const fields = await probeFields(draft, kind);
        patch({ fields });
        setMessage(`${fields.length} 个字段 · ${fields.filter(f => f.role === "dimension").length} 维度 · ${fields.filter(f => f.role === "measure").length} 度量`);
      } else {
        setPreview(await previewDataset(draft, kind));
      }
    } catch (error) {
      setMessage(String(error));
    } finally { setBusy(null); }
  };

  const save = async () => {
    if (!draft || problem) return;
    setBusy("save");
    try {
      setDraft(await useDatasets.getState().save(draft));
      setMessage("已保存");
    } catch (error) { setMessage(String(error)); } finally { setBusy(null); }
  };

  /**
   * 把一张表放上画布。第一张是主表,之后的自动挂到主表上并推断关联字段 —— 选表是人
   * 做的最后一步,之后不该再让人从两串字段里翻出该对上的那两个。
   */
  const addTable = async (table: string) => {
    if (source?.kind !== "join" || !draft) return;
    if (!source.base.table) {
      void load(table);
      patch({ source: { ...source, base: { ...source.base, table } } });
      setPicked(source.base.alias);
      return;
    }
    const alias = `t${source.joins.length + 2}`;
    const targetAlias = source.base.alias;
    const [fields, targetFields] = await Promise.all([load(table), load(source.base.table)]);
    const guess = guessJoin(fields, targetFields, source.base.table);
    patch({
      source: {
        ...source,
        joins: [...source.joins, {
          id: `join-${Math.random().toString(36).slice(2, 8)}`,
          table, alias, kind: "left",
          on: [{ field: guess?.field ?? "", targetAlias, targetField: guess?.targetField ?? "" }],
        }],
      },
    });
    setPicked(alias);
    setMessage(guess ? `已按${guess.reason}关联:${guess.targetField} = ${guess.field}` : "两张表没有看起来能对上的字段,点连线中间那块设置关联");
  };

  const fields = draft?.fields ?? [];

  /** 关联数据集按来源表分组;SQL 数据集没有表可分,归到一组。
   *  这里在 early return 之后,不能用 useMemo —— hook 必须每次渲染都调到。字段撑死
   *  几百个,直接算。 */


  const hasSource = source?.kind === "sql" ? !!source.sql.trim() : !!source?.base.table;
  const ready = !problem;

  /** 画布上的胶囊。主表在前,关联表按加入顺序跟在后面。 */
  const canvasTables: CanvasTable[] = source?.kind === "join"
    ? [
        {
          alias: source.base.alias, table: source.base.table,
          comment: tables.find((t) => t.name === source.base.table)?.comment,
          columns: columns[source.base.table]?.length ?? 0,
          kept: fields.filter((f) => f.from === source.base.alias && !f.hidden).length,
          isBase: true,
        },
        ...source.joins.map((join) => ({
          alias: join.alias, table: join.table,
          comment: tables.find((t) => t.name === join.table)?.comment,
          columns: columns[join.table]?.length ?? 0,
          kept: fields.filter((f) => f.from === join.alias && !f.hidden).length,
          isBase: false, join,
        })),
      ]
    : [];

  const usedTables = new Set(canvasTables.map((t) => t.table).filter(Boolean));
  const shownTables = tables.filter((t) =>
    !tableSearch || t.name.toLowerCase().includes(tableSearch.toLowerCase()) || (t.comment ?? "").includes(tableSearch));

  // 画布上选中某张表时,字段面板只看那张表的

  return (
    <AssetShell
      title="数据集"
      sub="看板组件的取数来源。一个数据集 = 一段 SQL,或者主表加几张关联表。"
    >
      <div className="ds-layout">
        {/* ── 左:数据集 + 表 ── */}
        <aside className="ds-rail">
          <div className="ds-rail-top">
            <button className="ds-new" onClick={() => {
              setDraft(createDataset("未命名数据集", connections[0]?.id ?? ""));
              setPreview(null); setMessage(undefined); setPicked(undefined);
            }}><Plus size={13} />新建数据集</button>
            {datasets.map((item) => (
              <button key={item.id} className={`ds-item ${draft?.id === item.id ? "on" : ""}`}
                onClick={() => { setDraft(item); setPreview(null); setMessage(undefined); setPicked(undefined); }}>
                <Boxes size={13} />
                <span className="ds-item-name">{item.name || "未命名数据集"}</span>
              </button>
            ))}
          </div>

          {draft && source?.kind === "join" && (
            <div className="ds-rail-tables">
              <div className="ds-rail-head">
                <strong>表</strong>
                <span className="ds-count">{tables.length}</span>
              </div>
              <label className="ds-search"><Search size={12} />
                <input value={tableSearch} placeholder="找表" onChange={(e) => setTableSearch(e.target.value)} />
              </label>
              <p className="ds-rail-hint">{source.base.table ? "点一张表,挂到主表上" : "点一张表作为主表"}</p>
              <div className="ds-rail-list">
                {shownTables.map((t) => (
                  <button key={t.name} className={`ds-rail-item ${usedTables.has(t.name) ? "used" : ""}`}
                    disabled={usedTables.has(t.name)} title={t.comment ?? t.name}
                    onClick={() => void addTable(t.name)}>
                    <Table2 size={12} />
                    <span className="ds-rail-name">{t.name}</span>
                    {t.comment && <small>{t.comment}</small>}
                  </button>
                ))}
                {shownTables.length === 0 && <p className="ds-rail-hint">没有匹配的表</p>}
              </div>
            </div>
          )}
        </aside>

        {!draft ? (
          <div className="ds-blank">
            <Boxes size={30} />
            <h3>数据集</h3>
            <p>看板组件从这里取数。<br />一个数据集就是一张宽表 —— 拖几张表连起来,或者直接写 SQL。</p>
          </div>
        ) : (
          <div className="ds-work">
            <header className="ds-head">
              <input className="ds-title" value={draft.name} placeholder="给这个数据集起个名字"
                onChange={(e) => patch({ name: e.target.value })} />
              <div className="ds-crumbs">
                <Database size={12} />
                <Pick className="crumb" value={draft.connectionId} placeholder="选连接"
                  options={connections.map((c) => ({ value: c.id, label: c.name }))}
                  onChange={(value) => patch({ connectionId: value, database: undefined, fields: [] })} />
                <ChevronRight size={12} />
                <Pick className="crumb" value={draft.database ?? ""} placeholder="选库"
                  options={databases.map((d) => ({ value: d, label: d }))}
                  onChange={(value) => patch({ database: value || undefined, fields: [] })} />
                <div className="ds-mode">
                  <button className={source?.kind === "join" ? "on" : ""}
                    onClick={() => patch({ source: source?.kind === "join" ? source : { kind: "join", base: { table: "", alias: "t1" }, joins: [], columns: [] } })}>画布</button>
                  <button className={source?.kind === "sql" ? "on" : ""}
                    onClick={() => patch({ source: { kind: "sql", sql: source?.kind === "sql" ? source.sql : generated } })}>SQL</button>
                </div>
                <div className="ds-acts">
                  <button className="btn sm" onClick={() => void run("probe")} disabled={!!busy || !ready}>
                    {busy === "probe" ? <Loader2 size={13} className="spin" /> : <Wand2 size={13} />}探测字段
                  </button>
                  <button className="btn sm" onClick={() => { setBottomTab("preview"); void run("preview"); }} disabled={!!busy || !ready}>
                    {busy === "preview" ? <Loader2 size={13} className="spin" /> : <Play size={13} />}预览
                  </button>
                  <button className="btn sm primary" onClick={() => void save()} disabled={!!busy || !ready}>
                    {busy === "save" ? <Loader2 size={13} className="spin" /> : <Save size={13} />}保存
                  </button>
                  {datasets.some((d) => d.id === draft.id) && (
                    <button className="btn sm danger" onClick={() => {
                      if (!window.confirm(`删除数据集「${draft.name}」?引用它的看板组件会取不到数。`)) return;
                      void useDatasets.getState().remove(draft.id).then(() => setDraft(null));
                    }}><Trash2 size={13} /></button>
                  )}
                </div>
              </div>
            </header>

            <div className="ds-stage">
              {source?.kind === "sql" ? (
                <div className="ds-sqleditor">
                  <CodeMirror value={source.sql} height="100%" theme={editorTheme}
                    extensions={[sqlLang(), syntaxHighlighting(highlight)]}
                    onChange={(value) => patch({ source: { kind: "sql", sql: value } })} />
                </div>
              ) : !source?.base.table ? (
                <div className="ds-stage-empty">
                  <Table2 size={26} />
                  <p>从左边点一张表开始</p>
                  <small>第一张是主表,之后点的表会自动挂上去并猜好关联字段</small>
                </div>
              ) : (
                <DatasetCanvas
                  source={source}
                  tables={canvasTables}
                  columnsOf={(table) => columns[table] ?? []}
                  selected={picked}
                  onSelect={setPicked}
                  onChange={(next) => patch({ source: next })}
                  onRemove={(id) => patch({ source: { ...source, joins: source.joins.filter((j) => j.id !== id) } })}
                />
              )}
            </div>

            {/* ── 底部:字段 / 预览 ── */}
            <div className="ds-bottom">
              <div className="ds-tabs">
                <button className={bottomTab === "fields" ? "on" : ""} onClick={() => setBottomTab("fields")}>
                  字段{fields.length > 0 && <span className="ds-count">{fields.filter((f) => !f.hidden).length}/{fields.length}</span>}
                </button>
                <button className={bottomTab === "preview" ? "on" : ""} onClick={() => setBottomTab("preview")}>
                  预览{preview && <span className="ds-count">{preview.rows.length} 行</span>}
                </button>
                {bottomTab === "fields" && picked && (
                  <button className="ds-linkbtn accent" onClick={() => setPicked(undefined)}>显示全部表</button>
                )}
                <span className={`ds-msg ${problem ? "warn" : ""}`}>{problem ?? message}</span>
                {hasSource && generated && (
                  <details className="ds-sqlbox">
                    <summary>SQL</summary>
                    <pre className="ds-sql">{generated}</pre>
                  </details>
                )}
              </div>

              <div className="ds-bottom-body">
                {bottomTab === "fields" ? (
                  fields.length === 0 ? (
                    <p className="ds-bottom-empty">点上面的「探测字段」认出这些表有哪些列 —— 之后就能挑要留哪些、度量怎么汇总。</p>
                  ) : (
                    <DatasetFieldPanel
                      dataset={draft}
                      kind={kind}
                      picked={picked}
                      tableTitle={(alias) => {
                        if (source?.kind !== "join") return alias;
                        if (alias === source.base.alias) return source.base.table || alias;
                        return source.joins.find((j) => j.alias === alias)?.table ?? alias;
                      }}
                      onChange={(next) => patch({ fields: next })}
                      onMessage={setMessage}
                    />
                  )
                ) : preview ? (
                  <div className="ds-preview-scroll">
                    <table>
                      <thead><tr>{preview.columns.map((c) => <th key={c.name}>{c.name}</th>)}</tr></thead>
                      <tbody>
                        {preview.rows.slice(0, 50).map((row, i) => (
                          <tr key={i}>{row.map((cell, j) => <td key={j}>{cell === null ? <span className="ds-null">NULL</span> : String(cell)}</td>)}</tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="ds-bottom-empty">点上面的「预览」看前 50 行。</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

    </AssetShell>
  );
}
