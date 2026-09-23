/**
 * 看板左侧的数据面板 —— 选中的组件「取什么数」全在这儿。
 *
 * 这里原来挂的是指标中心。数据集接管取数之后,指标中心跟看板已经没有关系了,留在
 * 左边只是占地方;而维度、度量、锁定范围散在右侧检查器的三个 tab 里,改一个组件要
 * 来回翻页。所以左边归数据(数据集/维度/度量/筛选/锁定),右边只剩外观和交互。
 *
 * 候选值走 useFieldValues,跟查看态的组件筛选器同一条路。
 */

import { Database, Settings2 } from "lucide-react";
import type { DashboardWidget } from "../domain";
import { useDatasets } from "../../datasets/datasetsStore";
import { useFieldValues } from "../useFieldValues";
import { useI18n } from "../../../hooks/useI18n";
import DatasetBindingEditor from "./DatasetBindingEditor";
import DateRangePicker from "./DateRangePicker";
import V1MultiSelect from "./V1MultiSelect";

interface Props {
  widget?: DashboardWidget;
  /** 看板当前「数据日期」范围 —— 组件锁定日期时的默认起止。 */
  scope: { start: string; end: string };
  onChange: (widget: DashboardWidget) => void;
}

export default function WidgetDataPanel({ widget, scope, onChange }: Props) {
  const { t } = useI18n();
  const datasets = useDatasets((s) => s.datasets);
  const dataset = datasets.find((item) => item.id === widget?.datasetId);
  const { valuesOf, load } = useFieldValues(widget?.datasetId, undefined, t);

  const title = (
    <div className="dash-panel-title">
      <Database size={14} />
      数据
      <span className="dash-panel-actions">
        <button className="icon-btn" title="管理数据集" onClick={() => useDatasets.getState().setOpen(true)}>
          <Settings2 size={14} />
        </button>
      </span>
    </div>
  );

  if (!widget) {
    return <aside className="dash-data-panel">{title}<div className="dash-inspector-empty">在画布上选一个组件,这里配它的取数。</div></aside>;
  }
  if (widget.type === "text" || widget.type === "container") {
    return <aside className="dash-data-panel">{title}<div className="dash-inspector-empty">{widget.type === "text" ? "文本" : "容器"}组件不取数。内容和样式在右侧设置。</div></aside>;
  }

  const patch = (change: Partial<DashboardWidget>) => onChange({ ...widget, ...change });
  const dimensionFields = dataset?.fields.filter((f) => f.role === "dimension" && !f.hidden) ?? [];
  const labelOf = (name: string) => dataset?.fields.find((f) => f.name === name)?.label || name;

  // 锁定范围统一写入(日期 + 维度取值),两者都空就整个清掉,别留一个空壳。
  const lock = widget.options.lockedScope;
  const applyLock = (next: { start?: string; end?: string; filters?: Record<string, string[]> }) => {
    const filters = Object.fromEntries(Object.entries(next.filters ?? {}).filter(([, list]) => list.length > 0));
    const hasFilters = Object.keys(filters).length > 0;
    const hasDate = !!(next.start && next.end);
    patch({
      options: {
        ...widget.options,
        lockedScope: hasDate || hasFilters
          ? { ...(hasDate ? { start: next.start, end: next.end } : {}), ...(hasFilters ? { filters } : {}) }
          : undefined,
      },
    });
  };

  const filterFields = widget.filterFields ?? [];
  const toggleFilterField = (field: string, on: boolean) =>
    patch({ filterFields: on ? [...filterFields, field] : filterFields.filter((item) => item !== field) });

  return (
    <aside className="dash-data-panel">
      {title}
      <div className="dash-inspector-body">
        <section>
          <strong>取数</strong>
          <DatasetBindingEditor widget={widget} onChange={onChange} />
        </section>

        {(widget.type === "bar" || widget.type === "pie") && (
          <section>
            <strong>分类数量</strong>
            <label>只看前几名
              <select value={widget.options.topN} onChange={(event) => patch({ options: { ...widget.options, topN: Number(event.target.value) } })}>
                <option value={0}>全部</option>
                {[5, 10, 20, 50].map((value) => <option value={value} key={value}>Top {value}</option>)}
              </select>
            </label>
          </section>
        )}

        {dataset && (
          <>
            <section className="dash-v1-section-card">
              <div><strong>组件级筛选器</strong><span className="dash-hint">在这个组件上多一排筛选框,只影响它自己。</span></div>
              <label className="dash-v1-switch"><input type="checkbox" checked={widget.filtersEnabled === true} onChange={(event) => patch({ filtersEnabled: event.target.checked })} /><i /></label>
            </section>
            {widget.filtersEnabled && (
              <section className="dash-v1-check-grid">
                <label className={filterFields.includes("date") ? "on" : ""}>
                  <input type="checkbox" checked={filterFields.includes("date")} onChange={(event) => toggleFilterField("date", event.target.checked)} />日期
                </label>
                {dimensionFields.map((field) => (
                  <label className={filterFields.includes(field.name) ? "on" : ""} key={field.name} title={field.name}>
                    <input type="checkbox" checked={filterFields.includes(field.name)} onChange={(event) => toggleFilterField(field.name, event.target.checked)} />{field.label || field.name}
                  </label>
                ))}
                {dimensionFields.length === 0 && <span className="dash-hint">这个数据集没有维度字段。</span>}
              </section>
            )}

            <section className="dash-v1-admin-lock">
              <strong>锁定数据范围</strong>
              <span className="dash-hint">锁住的部分不再跟看板顶部的筛选走,使用者也改不了。</span>
              <div className="dash-v1-lock-field">
                <span>日期</span>
                <div className="dash-lock-date">
                  <label className="dash-check">
                    <input type="checkbox" checked={!!(lock?.start && lock?.end)}
                      onChange={(event) => applyLock(event.target.checked ? { start: scope.start, end: scope.end, filters: lock?.filters } : { filters: lock?.filters })} />锁定
                  </label>
                  {lock?.start && lock?.end && (
                    <DateRangePicker start={lock.start} end={lock.end} onChange={(start, end) => applyLock({ start, end, filters: lock?.filters })} />
                  )}
                </div>
              </div>
              {dimensionFields.map((field) => (
                <div className="dash-v1-lock-field" key={field.name}>
                  <span title={field.name}>{labelOf(field.name)}</span>
                  {(() => {
                    const got = valuesOf(field.name);
                    return (
                      <div className="dash-lock-values">
                        <V1MultiSelect
                          ariaLabel={`锁定${labelOf(field.name)}`}
                          options={got.values.map((value) => ({ value, label: value }))}
                          values={lock?.filters?.[field.name] ?? []}
                          onOpen={() => void load(field.name)}
                          placeholder={got.loading ? "加载中…" : "不限"}
                          searchable={got.values.length > 12}
                          onChange={(next) => applyLock({ start: lock?.start, end: lock?.end, filters: { ...(lock?.filters ?? {}), [field.name]: next } })}
                        />
                        {got.truncated && <span className="dash-hint">取值太多,只列出前 {got.values.length} 个。</span>}
                      </div>
                    );
                  })()}
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
