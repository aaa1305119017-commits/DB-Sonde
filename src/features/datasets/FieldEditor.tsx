/**
 * 计算字段 / 分组字段编辑器。
 *
 * 关联和 SQL 决定了「有哪些列」,这里决定「在这些列之上还要算出什么」:两列相加得一个
 * 合计列,或者把一列的取值归成几档。这些字段只属于这个数据集,不改底表,也不影响别的
 * 数据集。
 *
 * 表达式写的是字段名(人看见的那个),存下来也是字段名;换成表里的真实引用是取数时的事
 * (domain.derivedExpr),因为关联数据集里撞名的列被改过名,而改名不该让写过的表达式失效。
 */
import { useMemo, useState } from "react";
import { Loader2, Plus, Search, Sigma, Table2, X } from "lucide-react";
import { api } from "../../lib/api";
import type { DbKind } from "../../types";
import { buildDatasetSql, type Dataset, type DatasetField, type DatasetGrouping } from "./domain";

/** 行级函数。聚合不在这里 —— 那是组件挑度量时决定的事。 */
const SNIPPETS = [
  { label: "四则", items: ["+", "-", "*", "/", "(", ")"] },
  { label: "常用", items: ["ROUND(", "ABS(", "COALESCE(", "CONCAT(", "CASE WHEN ", " THEN ", " ELSE ", " END"] },
];

export default function FieldEditor({ dataset, kind, editing, mode, onSave, onClose }: {
  dataset: Dataset;
  kind: DbKind | undefined;
  /** 改已有字段时传进来。 */
  editing?: DatasetField;
  mode: "calc" | "group";
  onSave: (field: DatasetField) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(editing?.label ?? editing?.name ?? "");
  const [role, setRole] = useState<DatasetField["role"]>(editing?.role ?? (mode === "calc" ? "measure" : "dimension"));
  const [expr, setExpr] = useState(editing?.expr ?? "");
  const [grouping, setGrouping] = useState<DatasetGrouping>(editing?.grouping ?? {
    source: dataset.fields.find((f) => f.role === "dimension" && !f.hidden)?.name ?? "",
    buckets: [{ label: "", values: [] }],
    fallback: "",
  });
  const [search, setSearch] = useState("");
  /* 占位符里的例子用这个数据集自己的列。写死一句「线下GMV + 线上GMV」,换个行业的库
     就是天书,用户还得先分辨那是举例还是真有这么个字段。 */
  const sample = dataset.fields.filter((f) => f.role === "measure" && !f.hidden && !f.expr).map((f) => f.label || f.name);
  const exprHint = sample.length >= 2 ? `${sample[0]} + ${sample[1]}` : sample.length === 1 ? `${sample[0]} * 1.0` : "字段A + 字段B";
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState<{ ok: boolean; text: string } | undefined>();

  // 自己不能引用自己,否则取数时会绕回来
  const usable = useMemo(
    () => dataset.fields.filter((f) => f.name !== editing?.name),
    [dataset.fields, editing?.name],
  );
  const shown = usable.filter((f) =>
    !search || f.name.toLowerCase().includes(search.toLowerCase()) || (f.label ?? "").includes(search));

  const insert = (text: string) => {
    const area = document.getElementById("ds-expr") as HTMLTextAreaElement | null;
    if (!area) { setExpr(expr + text); return; }
    const start = area.selectionStart, end = area.selectionEnd;
    const next = expr.slice(0, start) + text + expr.slice(end);
    setExpr(next);
    requestAnimationFrame(() => { area.focus(); area.selectionStart = area.selectionEnd = start + text.length; });
    setChecked(undefined);
  };

  const draftField = (): DatasetField => ({
    name: name.trim(),
    label: undefined,
    role,
    ...(mode === "calc" ? { expr: expr.trim() } : { grouping }),
  });

  /** 校验:把这个字段塞进数据集跑一行,让数据库说表达式成不成立。 */
  const check = async () => {
    setChecking(true); setChecked(undefined);
    try {
      const probe: Dataset = { ...dataset, fields: [...usable, { ...draftField(), name: name.trim() || "__probe" }] };
      const sql = buildDatasetSql(probe, kind);
      const result = await api.runQuery(dataset.connectionId, dataset.database, sql, 1);
      const column = result.columns.find((c) => c.name === (name.trim() || "__probe"));
      setChecked({ ok: true, text: column ? `没问题,类型是 ${column.typeName ?? "未知"}` : "没问题" });
    } catch (error) {
      setChecked({ ok: false, text: String(error).replace(/^Error:\s*/, "") });
    } finally {
      setChecking(false);
    }
  };

  const problem = !name.trim()
    ? "先给字段起个名字"
    : usable.some((f) => f.name === name.trim())
      ? "这个名字和已有字段重了"
      : mode === "calc"
        ? (expr.trim() ? undefined : "表达式不能为空")
        : (!grouping.source ? "先选依据哪个字段分组"
          : grouping.buckets.some((b) => b.label.trim() && b.values.length) ? undefined : "至少要有一组有名字和取值");

  return (
    <div className="fe-backdrop" onMouseDown={onClose}>
      <div className="fe-modal" onMouseDown={(e) => e.stopPropagation()}>
        <header className="fe-head">
          <strong>{editing ? "编辑" : "新建"}{mode === "calc" ? "计算字段" : "分组字段"}</strong>
          <button className="fe-x" onClick={onClose}><X size={14} /></button>
        </header>

        <div className="fe-row">
          <input className="fe-name" value={name} placeholder={mode === "calc" ? "新字段叫什么" : "分组字段叫什么"}
            onChange={(e) => { setName(e.target.value); setChecked(undefined); }} />
          <div className="fe-role">
            {(["dimension", "measure"] as const).map((r) => (
              <button key={r} className={role === r ? "on" : ""} onClick={() => setRole(r)}>
                {r === "dimension" ? <><Table2 size={11} />维度</> : <><Sigma size={11} />度量</>}
              </button>
            ))}
          </div>
        </div>

        {mode === "calc" ? (
          <div className="fe-body">
            <div className="fe-left">
              <textarea id="ds-expr" className="fe-expr" value={expr} spellCheck={false}
                placeholder={`用字段名写表达式,例如:${exprHint}`}
                onChange={(e) => { setExpr(e.target.value); setChecked(undefined); }} />
              <div className="fe-snips">
                {SNIPPETS.map((group) => (
                  <div key={group.label} className="fe-snip-row">
                    <span>{group.label}</span>
                    {group.items.map((item) => (
                      <button key={item} onClick={() => insert(item)}>{item.trim()}</button>
                    ))}
                  </div>
                ))}
              </div>
              <p className="fe-hint">
                这是行级表达式 —— 每行算一次。求和平均那些是组件挑度量时定的,不用写在这。
              </p>
            </div>
            <div className="fe-fields">
              <label className="fe-search"><Search size={12} />
                <input value={search} placeholder="找字段" onChange={(e) => setSearch(e.target.value)} />
              </label>
              <div className="fe-field-list">
                {shown.map((f) => (
                  <button key={f.name} onClick={() => insert(f.name)} title={`插入 ${f.name}`}>
                    <span className={`fe-dot ${f.role}`} />
                    <span className="fe-field-name">{f.label || f.name}</span>
                    {f.label && <small>{f.name}</small>}
                  </button>
                ))}
                {shown.length === 0 && <p className="fe-empty">没有匹配的字段</p>}
              </div>
            </div>
          </div>
        ) : (
          <div className="fe-body fe-group">
            <label className="fe-src">依据字段
              <select value={grouping.source}
                onChange={(e) => { setGrouping({ ...grouping, source: e.target.value }); setChecked(undefined); }}>
                <option value="">选字段…</option>
                {usable.filter((f) => !f.expr && !f.grouping).map((f) => (
                  <option key={f.name} value={f.name}>{f.label ? `${f.label} (${f.name})` : f.name}</option>
                ))}
              </select>
            </label>

            <div className="fe-buckets">
              {grouping.buckets.map((bucket, index) => (
                <div className="fe-bucket" key={index}>
                  <input value={bucket.label} placeholder="组名"
                    onChange={(e) => setGrouping({
                      ...grouping,
                      buckets: grouping.buckets.map((b, i) => (i === index ? { ...b, label: e.target.value } : b)),
                    })} />
                  <input value={bucket.values.join(", ")} placeholder="取值,逗号分隔"
                    onChange={(e) => setGrouping({
                      ...grouping,
                      buckets: grouping.buckets.map((b, i) => (i === index
                        ? { ...b, values: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) }
                        : b)),
                    })} />
                  {grouping.buckets.length > 1 && (
                    <button className="fe-x sm" onClick={() => setGrouping({
                      ...grouping, buckets: grouping.buckets.filter((_, i) => i !== index),
                    })}><X size={12} /></button>
                  )}
                </div>
              ))}
              <button className="fe-add" onClick={() => setGrouping({
                ...grouping, buckets: [...grouping.buckets, { label: "", values: [] }],
              })}><Plus size={12} />加一组</button>
            </div>

            <label className="fe-src">其余归到
              <input value={grouping.fallback ?? ""} placeholder="留空则为空值"
                onChange={(e) => setGrouping({ ...grouping, fallback: e.target.value || undefined })} />
            </label>
          </div>
        )}

        <footer className="fe-foot">
          <button className="btn sm" onClick={() => void check()} disabled={checking || !!problem}>
            {checking ? <Loader2 size={13} className="spin" /> : null}校验
          </button>
          {checked && <span className={`fe-check ${checked.ok ? "ok" : "bad"}`}>{checked.text}</span>}
          <span className="fe-problem">{problem}</span>
          <button className="btn sm" onClick={onClose}>取消</button>
          <button className="btn sm primary" disabled={!!problem}
            onClick={() => onSave(draftField())}>确定</button>
        </footer>
      </div>
    </div>
  );
}
