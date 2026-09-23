import { Filter, Globe, Link2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useI18n } from "../../../hooks/useI18n";
import type {
  DashboardDataset,
  DashboardDrillFilter,
  DashboardFilter,
  DashboardRuntimeData,
} from "../domain";
import { distinctFilterValues, type DashboardFilterValues } from "../filtering";

interface Props {
  filters: DashboardFilter[];
  datasets: DashboardDataset[];
  runtime: Record<string, DashboardRuntimeData>;
  values: DashboardFilterValues;
  drill?: DashboardDrillFilter;
  preview: boolean;
  onAdd: () => void;
  onChange: (filter: DashboardFilter) => void;
  onRemove: (id: string) => void;
  onValue: (id: string, value: string) => void;
  onClearDrill: () => void;
}

export default function FilterBar({
  filters,
  datasets,
  runtime,
  values,
  drill,
  preview,
  onAdd,
  onChange,
  onRemove,
  onValue,
  onClearDrill,
}: Props) {
  const { t } = useI18n();
  if (preview && filters.length === 0 && !drill) return null;
  const truncated = Object.values(runtime).some((item) => item.result?.truncated);
  // 所有数据集的维度并集 —— 全局筛选可选任意维度,自动联动含它的所有组件。
  const allDimensions = [...new Set(datasets.flatMap((d) => d.fields.filter((f) => f.role === "dimension").map((f) => f.name)))];
  // 候选值:全局筛选从第一个含该维度的数据集取;组件筛选从自己的数据集取。
  const optionsFor = (field: string, datasetId: string, isGlobal: boolean) => {
    const ds = isGlobal ? datasets.find((d) => d.fields.some((f) => f.name === field)) : datasets.find((d) => d.id === datasetId);
    return distinctFilterValues(ds ? runtime[ds.id] : undefined, field);
  };
  return (
    <div className="dash-filter-bar">
      <span className="dash-filter-heading"><Filter size={12} />{t("dashboard.filters")}</span>
      {filters.map((filter) => {
        const isGlobal = (filter.scope ?? "dataset") === "global";
        const dataset = datasets.find((item) => item.id === filter.datasetId);
        const fields = isGlobal ? allDimensions : (dataset?.fields.filter((f) => f.role === "dimension").map((f) => f.name) ?? []);
        const options = optionsFor(filter.field, filter.datasetId, isGlobal);
        return (
          <div className={`dash-filter-control ${isGlobal ? "is-global" : ""}`} key={filter.id} title={isGlobal ? "全局筛选:联动所有含该维度的组件" : "只作用于本数据集"}>
            {!preview ? (
              <>
                <select aria-label="筛选范围" value={filter.scope ?? "dataset"} onChange={(event) => onChange({ ...filter, scope: event.target.value as "global" | "dataset" })}>
                  <option value="global">全局</option>
                  <option value="dataset">本组件</option>
                </select>
                <select
                  aria-label={t("dashboard.filterField")}
                  value={filter.field}
                  onChange={(event) => onChange({ ...filter, field: event.target.value, title: event.target.value })}
                >
                  {fields.map((name) => <option value={name} key={name}>{name}</option>)}
                </select>
              </>
            ) : (
              <span className="dash-filter-title">{isGlobal && <Globe size={11} />}{filter.title}</span>
            )}
            {filter.kind === "in" ? (() => {
              const sep = String.fromCharCode(1);
              const vals = (values[filter.id] ?? filter.defaultValue ?? "").split(sep).filter(Boolean);
              const avail = options.filter((o) => !vals.includes(o));
              return (
                <span className="dash-multi">
                  {vals.map((v) => (
                    <span className="dash-chip" key={v}>{v}<button onClick={() => onValue(filter.id, vals.filter((x) => x !== v).join(sep))}>×</button></span>
                  ))}
                  <select aria-label={filter.title} value="" onChange={(event) => { if (event.target.value) onValue(filter.id, [...vals, event.target.value].join(sep)); }}>
                    <option value="">{vals.length ? "＋" : t("dashboard.filterAll")}</option>
                    {avail.map((value) => <option value={value} key={value}>{value}</option>)}
                  </select>
                </span>
              );
            })() : filter.kind === "select" ? (
              <select
                aria-label={filter.title}
                value={values[filter.id] ?? filter.defaultValue ?? ""}
                onChange={(event) => onValue(filter.id, event.target.value)}
              >
                <option value="">{t("dashboard.filterAll")}</option>
                {options.map((value) => <option value={value} key={value}>{value}</option>)}
              </select>
            ) : (
              <input
                aria-label={filter.title}
                value={values[filter.id] ?? filter.defaultValue ?? ""}
                placeholder={t("dashboard.filterContains")}
                onChange={(event) => onValue(filter.id, event.target.value)}
              />
            )}
            {!preview && (
              <>
                <select
                  aria-label={t("dashboard.filterType")}
                  value={filter.kind}
                  onChange={(event) => onChange({ ...filter, kind: event.target.value as DashboardFilter["kind"] })}
                >
                  <option value="select">{t("dashboard.filterSelect")}</option>
                  <option value="in">多选</option>
                  <option value="text">{t("dashboard.filterText")}</option>
                </select>
                <button className="icon-btn" title={t("dashboard.removeFilter")} onClick={() => onRemove(filter.id)}>
                  <Trash2 size={11} />
                </button>
              </>
            )}
          </div>
        );
      })}
      {drill && (
        <button className="dash-drill-chip" onClick={onClearDrill} title={t("dashboard.clearLinkage")}>
          <Link2 size={11} />联动:{datasets.find((d) => d.dimensionLabels?.[drill.field])?.dimensionLabels?.[drill.field] || drill.field} = {drill.value}<RotateCcw size={10} />
        </button>
      )}
      {truncated && <span className="dash-filter-warning">{t("dashboard.filterTruncated")}</span>}
      {!preview && (
        <button className="dash-add-filter" onClick={onAdd}><Plus size={11} />{t("dashboard.addFilter")}</button>
      )}
    </div>
  );
}
