/**
 * 数据集的字段面板:哪些列留下、哪个是维度哪个是度量、度量默认怎么汇总,以及这个
 * 数据集自己算出来的字段。
 *
 * 搜索、折叠、编辑器开着没开着都是这儿自己的事,所以状态留在里面 —— 外面只给它数据集
 * 和一个改数据集的口子。
 */
import { useState } from "react";
import { ChevronRight, Search, Sigma, Table2, X } from "lucide-react";
import type { DbKind } from "../../types";
import FieldEditor from "./FieldEditor";
import { AGG_LABELS, type AggKind } from "./widgetQuery";
import type { Dataset, DatasetField } from "./domain";

export default function DatasetFieldPanel({
  dataset, kind, picked, tableTitle, onChange, onMessage,
}: {
  dataset: Dataset;
  kind: DbKind | undefined;
  /** 画布上选中的表别名。有值时只看那张表的字段。 */
  picked?: string;
  /** 别名 → 表名,分组标题用。 */
  tableTitle: (alias: string) => string;
  onChange: (fields: DatasetField[]) => void;
  onMessage: (text: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<{ mode: "calc" | "group"; field?: DatasetField } | null>(null);

  const fields = dataset.fields;
  const matches = (f: DatasetField) =>
    !search || f.name.toLowerCase().includes(search.toLowerCase()) || (f.label ?? "").includes(search);

  // 算出来的字段不属于任何来源表,单独成组,按表筛选时也照样列出来
  const derived = fields.filter((f) => f.expr || f.grouping);
  const byTable = new Map<string, DatasetField[]>();
  for (const field of fields) {
    if (field.expr || field.grouping) continue;
    const key = field.from ?? "";
    { const bucket = byTable.get(key); if (bucket) bucket.push(field); else byTable.set(key, [field]); };
  }
  const groups = [...byTable.entries()]
    .map(([alias, list]) => ({
      alias,
      title: alias ? tableTitle(alias) : "字段",
      list,
      shown: list.filter(matches),
      kept: list.filter((f) => !f.hidden).length,
    }))
    .filter((g) => !picked || g.alias === picked);

  const keptCount = fields.filter((f) => !f.hidden).length;
  const visible = groups.flatMap((g) => g.list.map((f) => f.name));
  const patchField = (name: string, next: Partial<DatasetField>) =>
    onChange(fields.map((f) => (f.name === name ? { ...f, ...next } : f)));
  const setKept = (names: string[], keep: boolean) => {
    const set = new Set(names);
    onChange(fields.map((f) => (set.has(f.name) ? { ...f, hidden: !keep } : f)));
  };

  const fieldRow = (field: DatasetField, editable = false) => (
    <div className={`ds-field ${field.role} ${field.hidden ? "off" : ""}`} key={field.name}>
      <input type="checkbox" checked={!field.hidden} title="保留这个字段"
        onChange={(e) => patchField(field.name, { hidden: !e.target.checked })} />
      <button className="ds-field-mark" title="切换维度/度量"
        onClick={() => patchField(field.name, { role: field.role === "measure" ? "dimension" : "measure" })}>
        {field.role === "dimension" ? <Table2 size={11} /> : <span className="ds-sigma">Σ</span>}
      </button>
      <span className="ds-field-body">
        {editable ? (
          <button className="ds-field-edit" onClick={() => setEditor({ mode: field.grouping ? "group" : "calc", field })}>
            {field.label || field.name}
          </button>
        ) : (
          <input className="ds-field-label" value={field.label ?? ""} placeholder={field.name}
            onChange={(e) => patchField(field.name, { label: e.target.value || undefined })} />
        )}
        <span className="ds-field-name" title={field.type ?? field.expr}>
          {field.grouping ? `按 ${field.grouping.source} 分组` : field.expr ?? field.name}
        </span>
      </span>
      {field.role === "measure" && (
        <select className="ds-agg" value={field.defaultAgg ?? "sum"}
          title="组件用这个作默认汇总方式,单个组件仍可改"
          onChange={(e) => patchField(field.name, { defaultAgg: e.target.value as AggKind })}>
          {(Object.keys(AGG_LABELS) as AggKind[]).map((agg) => (
            <option key={agg} value={agg}>{AGG_LABELS[agg]}</option>
          ))}
        </select>
      )}
      {editable && (
        <button className="ds-field-del" title="删掉这个字段"
          onClick={() => onChange(fields.filter((f) => f.name !== field.name))}>
          <X size={11} />
        </button>
      )}
    </div>
  );

  return (
    <>
      <div className="ds-panel-ops">
        <span className="ds-count">保留 {keptCount} / {fields.length}</span>
        {/* 作用域跟着眼前看到的走:画布上选了某张表,这里就只动那张表的字段 */}
        <button className="ds-linkbtn" onClick={() => setKept(visible, true)}>{picked ? "本表全选" : "全选"}</button>
        <button className="ds-linkbtn" onClick={() => setKept(visible, false)}>{picked ? "本表全不选" : "全不选"}</button>
        {search && (
          <button className="ds-linkbtn accent"
            onClick={() => setKept(groups.flatMap((g) => g.shown.map((f) => f.name)), true)}>
            保留搜到的 {groups.reduce((n, g) => n + g.shown.length, 0)} 个
          </button>
        )}
        <label className="ds-search"><Search size={12} />
          <input value={search} placeholder="找字段" onChange={(e) => setSearch(e.target.value)} />
        </label>
        {/* 关联和 SQL 决定有哪些列,这里往上加算出来的列 */}
        <button className="ds-linkbtn accent" onClick={() => setEditor({ mode: "calc" })}>＋计算字段</button>
        <button className="ds-linkbtn accent" onClick={() => setEditor({ mode: "group" })}>＋分组字段</button>
      </div>

      <div className="ds-groups">
        {derived.length > 0 && (
          <section className="ds-group">
            <div className="ds-group-head as-row">
              <Sigma size={12} />
              <strong>这个数据集自己算出来的</strong>
              <span className="ds-kept">{derived.filter((f) => !f.hidden).length}/{derived.length}</span>
            </div>
            <div className="ds-field-list">{derived.map((f) => fieldRow(f, true))}</div>
          </section>
        )}

        {groups.map((group) => {
          const folded = collapsed[group.alias] ?? false;
          const dims = group.shown.filter((f) => f.role === "dimension");
          const meas = group.shown.filter((f) => f.role === "measure");
          return (
            <section key={group.alias} className="ds-group">
              <button className="ds-group-head" onClick={() => setCollapsed((c) => ({ ...c, [group.alias]: !folded }))}>
                <ChevronRight size={12} className={folded ? "" : "open"} />
                <strong>{group.title}</strong>
                <span className="ds-kept">{group.kept}/{group.list.length}</span>
                <span className="ds-group-ops">
                  <span role="button" tabIndex={0} className="ds-linkbtn"
                    onClick={(e) => { e.stopPropagation(); setKept(group.list.map((f) => f.name), true); }}
                    onKeyDown={(e) => { if (e.key === "Enter") setKept(group.list.map((f) => f.name), true); }}>全选</span>
                  <span role="button" tabIndex={0} className="ds-linkbtn"
                    onClick={(e) => { e.stopPropagation(); setKept(group.list.map((f) => f.name), false); }}
                    onKeyDown={(e) => { if (e.key === "Enter") setKept(group.list.map((f) => f.name), false); }}>清空</span>
                </span>
              </button>
              {!folded && (
                <div className="ds-field-list">
                  {[...dims, ...meas].map((f) => fieldRow(f))}
                  {group.shown.length === 0 && <p className="ds-group-empty">没有匹配的字段</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {editor && (
        <FieldEditor
          dataset={dataset}
          kind={kind}
          mode={editor.mode}
          editing={editor.field}
          onClose={() => setEditor(null)}
          onSave={(field) => {
            onChange(editor.field
              ? fields.map((f) => (f.name === editor.field!.name ? { ...f, ...field } : f))
              : [...fields, field]);
            setEditor(null);
            onMessage(editor.field ? `已更新「${field.name}」` : `已加上「${field.name}」,记得保存`);
          }}
        />
      )}
    </>
  );
}
