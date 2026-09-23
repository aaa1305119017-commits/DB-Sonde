import type { DashboardDataset, DashboardWidget } from "../domain";
import type { ComponentFilterValue } from "../useDashboardRuntime";
import { useFieldValues } from "../useFieldValues";
import { useI18n } from "../../../hooks/useI18n";
import V1MultiSelect from "./V1MultiSelect";
import DateRangePicker from "./DateRangePicker";
import { dateFilterFieldsOf } from "../componentFilterFields";

/* 字段的显示名跟着数据集走(建数据集的人改过的名字),数据集没给就用字段名本身。
   "date" 是保留名,它渲染成日期区间。 */

interface Props {
  widget: DashboardWidget;
  dataset?: DashboardDataset;
  scope: { start: string; end: string };
  value?: ComponentFilterValue;
  onChange: (value: ComponentFilterValue) => void;
}

export default function ComponentFilterBar({ widget, dataset, scope, value, onChange }: Props) {
  const { t } = useI18n();
  const { valuesOf, load } = useFieldValues(widget.datasetId, dataset, t);
  if (!widget.filtersEnabled || !(widget.filterFields?.length)) return null;
  const labelOf = (field: string) => (field === "date" ? "日期" : dataset?.dimensionLabels?.[field] || field);
  /* 日期轴字段也给日历,不再只认保留名 "date"。勾的是"统计日期"这种维度时,
     原来渲染出来是一串日期的多选框(几百个选项,没法用)。 */
  const dateFields = dateFilterFieldsOf(widget, dataset);

  const current: ComponentFilterValue = value ?? { selections: {} };
  const patch = (change: Partial<ComponentFilterValue>) => onChange({ ...current, ...change, selections: change.selections ?? current.selections });
  return (
    <div className="dash-component-filters" onMouseDown={(event) => event.stopPropagation()}>
      {widget.filterFields.map((field) => {
        if (dateFields.includes(field)) {
          return (
            /* 跟看板顶部用同一个日期控件 —— 那个有今天/近 7 天/本月这些快捷项,
               这里原来是两个原生 date 输入框,弹的是系统日历,既没有快捷项,
               长相也跟顶部那个完全不是一回事。 */
            <span className="dash-component-date" key={field}>
              <DateRangePicker
                start={current.start ?? scope.start}
                end={current.end ?? scope.end}
                onChange={(start, end) => patch({ start, end })}
              />
            </span>
          );
        }
        const got = valuesOf(field);
        return (
          <span className="dash-component-select" key={field}>
            <V1MultiSelect
              ariaLabel={labelOf(field)}
              options={got.values.map((item) => ({ value: item, label: item }))}
              values={current.selections[field] ?? []}
              onChange={(next) => patch({ selections: { ...current.selections, [field]: next } })}
              onOpen={() => void load(field)}
              placeholder={got.loading ? "加载中…" : labelOf(field)}
              searchable={got.values.length > 12}
            />
          </span>
        );
      })}
    </div>
  );
}
