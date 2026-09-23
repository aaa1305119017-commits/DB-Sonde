/**
 * 组件的取数绑定:选数据集,再把字段放进「行 / 列 / 指标」三个区。
 *
 * 排版照着透视表的心智模型来,而不是一串下拉:
 *   明细表   行维度 / 列维度(透视) / 指标
 *   图表     维度(轴) / 图例 / 指标
 *   指标卡   只有指标
 * 「列」原来藏在右侧样式页的「明细表维度布局」里,一个下拉一个下拉地设 —— 想做个
 * 交叉表得先知道它在那儿。放在这里才是它该在的地方:行和列是一件事的两边。
 */
import { useEffect } from "react";
import type { DashboardWidget } from "../domain";
import { useDatasets } from "../../datasets/datasetsStore";
import { isTimeField } from "../../datasets/domain";
import { AGG_LABELS, GRAIN_LABELS, type AggKind, type TimeGrain } from "../../datasets/widgetQuery";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { DashboardDimensionSort } from "../domain";
import FieldWell from "./FieldWell";
import Picker from "./Picker";

export default function DatasetBindingEditor({ widget, onChange }: {
  widget: DashboardWidget;
  onChange: (widget: DashboardWidget) => void;
}) {
  const datasets = useDatasets((s) => s.datasets);
  const loaded = useDatasets((s) => s.loaded);
  /* 数据集是全局的,而这个列表只在数据集面板打开时才读过 —— 看板先开的话读到的是空的,
     界面就会说「还没有数据集」,可它明明存着。 */
  useEffect(() => { useDatasets.getState().ensureLoaded(); }, []);

  const dataset = datasets.find((item) => item.id === widget.datasetId);
  const measureFields = dataset?.fields.filter((f) => f.role === "measure" && !f.hidden) ?? [];
  const dimensionFields = dataset?.fields.filter((f) => f.role === "dimension" && !f.hidden) ?? [];
  const label = (name: string) => dataset?.fields.find((f) => f.name === name)?.label || name;
  const wellFields = (list: typeof dimensionFields) => list.map((f) => ({ name: f.name, label: f.label || f.name }));

  const bound = widget.bindings.measures ?? [];
  const boundDims = widget.bindings.dimensions?.length
    ? widget.bindings.dimensions
    : (widget.bindings.dimension ? [widget.bindings.dimension] : []);
  const aggregations = widget.bindings.aggregations ?? {};
  const isTable = widget.type === "table";
  const isKpi = widget.type === "kpi";
  const placements = widget.options.table?.dimensionPlacements ?? {};

  const setBindings = (patch: Partial<DashboardWidget["bindings"]>) =>
    onChange({ ...widget, bindings: { ...widget.bindings, ...patch } });

  /** 维度多选。dimension(单数)是渲染层还在读的老字段,让它跟着首个维度走。 */
  const setDims = (dims: string[]) => setBindings({ dimensions: dims, dimension: dims[0] });

  /* 明细表的行/列是同一份 dimensions,靠 dimensionPlacements 分。列非空即为交叉表。 */
  const rowDims = isTable ? boundDims.filter((d) => placements[d] !== "column") : boundDims;
  const colDims = isTable ? boundDims.filter((d) => placements[d] === "column") : [];
  const setPlacement = (dims: string[], place: "row" | "column") => {
    const next = { ...placements };
    // 遍历新列表,不是旧的 —— 刚勾进来的字段还不在 boundDims 里,漏了它就会掉回「行」。
    for (const d of dims) next[d] = place;
    // 这一区里被去掉的,归到另一边;两边都没有就是真的移除了。
    const keep = [...dims, ...(place === "row" ? colDims : rowDims)];
    for (const d of Object.keys(next)) if (!keep.includes(d)) delete next[d];
    onChange({
      ...widget,
      bindings: { ...widget.bindings, dimensions: keep, dimension: keep[0] },
      options: {
        ...widget.options,
        table: {
          ...(widget.options.table ?? {}),
          dimensionPlacements: next,
          layout: Object.values(next).includes("column") ? "pivot" : "flat",
        },
      },
    });
  };

  const pickDataset = (id: string) => {
    const next = datasets.find((item) => item.id === id);
    const names = new Set(next?.fields.map((f) => f.name) ?? []);
    // 换数据集后,旧字段多半在新数据集里不存在,留着只会查出一句报错。
    onChange({
      ...widget,
      datasetId: id,
      bindings: {
        ...widget.bindings,
        dimension: widget.bindings.dimension && names.has(widget.bindings.dimension) ? widget.bindings.dimension : undefined,
        dimensions: boundDims.filter((d) => names.has(d)),
        seriesDimension: widget.bindings.seriesDimension && names.has(widget.bindings.seriesDimension) ? widget.bindings.seriesDimension : undefined,
        measures: bound.filter((m) => names.has(m)),
      },
    });
  };

  const table = widget.options.table ?? {};
  const patchTable = (change: Partial<typeof table>) =>
    onChange({ ...widget, options: { ...widget.options, table: { ...table, ...change } } });

  /* 维度排序。
     「组内」和普通的区别:普通按这一列自己排,会把上层分组打散(全国网点混在一起排);
     组内先守住上层顺序,只在每个上层分组内部排 —— 「每个大区里最高的那几家」要的是后者。
     只有一层维度时没有「上层」,组内就没有意义,所以不给这两项。 */
  /** 排序状态画成一个箭头:没排是灰色的双向箭头,排了就是实心的单向箭头。
   *  「组」标记表示只在上层分组内部排。 */
  const sortIcon = (value: string) => {
    if (!value) return <ArrowUpDown size={12} />;
    const up = value.endsWith("asc");
    const within = value.startsWith("group_") || value.endsWith("_within");
    return (
      <span className="dash-sort-on">
        {up ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
        {within && <i>组</i>}
      </span>
    );
  };

  const dimSortControl = (name: string, index: number, colDim = false) => (
    <Picker compact icon={sortIcon} ariaLabel={`${label(name)} 排序`}
      value={table.dimensionSorts?.[name] ?? ""}
      options={[
        { value: "", label: "默认顺序" },
        { value: "asc", label: "升序" },
        { value: "desc", label: "降序" },
        /* 列维度不给「组内」:列是一层层展开的,深一层本来就只能在浅一层内部排,
           再给个「全局」的选项等于骗人。行维度不一样,那里两种都成立。 */
        /* 「组内」要有上层分组才说得通,那是表格里才有的层次;
           图表只有一层分类轴,给了也是骗人。 */
        ...(isTable && !colDim && index > 0 ? [
          { value: "group_asc", label: "组内升序" },
          { value: "group_desc", label: "组内降序" },
        ] : []),
      ]}
      onChange={(v) => {
        const next = { ...(table.dimensionSorts ?? {}) };
        if (v) next[name] = v as DashboardDimensionSort;
        else delete next[name];
        patchTable({ dimensionSorts: next });
      }} />
  );

  /** 指标排序:同一时间只有一个指标是排序依据,所以选中一个就把别的清掉。 */
  const metricSortControl = (name: string) => {
    const key = `field:${name}`;
    const current = table.metricSort?.key === key
      ? `${table.metricSort.dir}${table.metricSort.within ? "_within" : ""}`
      : "";
    return (
      <Picker compact icon={sortIcon} ariaLabel={`${label(name)} 排序`}
        value={current}
        options={[
          { value: "", label: "不排序" },
          { value: "desc", label: "降序" },
          { value: "asc", label: "升序" },
          ...(isTable && rowDims.length > 1 ? [
            { value: "desc_within", label: "组内降序" },
            { value: "asc_within", label: "组内升序" },
          ] : []),
        ]}
        onChange={(v) => {
          if (!v) return patchTable({ metricSort: undefined });
          const within = v.endsWith("_within");
          patchTable({ metricSort: { key, dir: within ? v.slice(0, -7) as "asc" | "desc" : v as "asc" | "desc", within } });
        }} />
    );
  };

  const grainControl = (name: string) => {
    // 时间列可以按年/季/月/…汇总;别的列没这回事。
    if (!isTimeField(dataset?.fields.find((f) => f.name === name))) return null;
    return (
      <Picker compact ariaLabel={`${label(name)} 时间粒度`}
        value={widget.bindings.grains?.[name] ?? "raw"}
        options={(Object.keys(GRAIN_LABELS) as TimeGrain[]).map((g) => ({ value: g, label: GRAIN_LABELS[g] }))}
        onChange={(g) => setBindings({ grains: { ...(widget.bindings.grains ?? {}), [name]: g as TimeGrain } })} />
    );
  };

  return (
    <div className="dash-bind">
      <label className="dash-bind-field">
        <span className="dash-bind-label">数据集</span>
        <Picker ariaLabel="数据集" value={widget.datasetId} placeholder="选数据集…"
          options={datasets.map((item) => ({ value: item.id, label: item.name || "未命名数据集" }))}
          onChange={pickDataset} />
      </label>

      {!dataset ? (
        <p className="dash-hint">
          {loaded
            ? "还没选数据集。到「数据资产 → 数据集」建一个:写一段 SQL,或者选主表再关联几张表。"
            : "正在读数据集…"}
        </p>
      ) : (
        <>
          {!isKpi && (
            <FieldWell
              title={isTable ? "行维度" : "维度"}
              hint={isTable ? "按这些字段分组,自上而下" : "图形的分类轴"}
              picked={rowDims}
              available={wellFields(dimensionFields).map((f) => ({ ...f, taken: colDims.includes(f.name) }))}
              onChange={(next) => (isTable ? setPlacement(next, "row") : setDims(next))}
              renderControl={(name) => (
                <>
                  {grainControl(name)}
                  {/* 排序不是表格专属 —— 条形图要按指标排名次,折线图要按时间顺序,
                      饼图要决定扇区从哪儿开始。换个图表类型就没了才不合理。 */}
                  {dimSortControl(name, rowDims.indexOf(name))}
                </>
              )}
              badgeOf={(_, index) => (rowDims.length > 1 ? `第 ${index + 1} 层` : undefined)}
              emptyText={isTable ? "没有行维度就是一张汇总表,只有一行。" : "还没选维度 —— 图形没有分类轴。"}
            />
          )}

          {isTable && (
            <FieldWell
              title="列维度"
              hint="放到这里就成为交叉表,多个按先后叠成多层表头"
              picked={colDims}
              available={wellFields(dimensionFields).map((f) => ({ ...f, taken: rowDims.includes(f.name) }))}
              onChange={(next) => setPlacement(next, "column")}
              renderControl={(name) => (
                <>
                  {grainControl(name)}
                  {dimSortControl(name, colDims.indexOf(name), true)}
                </>
              )}
              badgeOf={(_, index) => (colDims.length > 1 ? `第 ${index + 1} 层` : undefined)}
              emptyText="留空就是普通明细表。放一个字段进来,它的取值会横着展开成列。"
            />
          )}

          {(widget.type === "line" || widget.type === "bar") && (
            <label className="dash-bind-field">
              <span className="dash-bind-label">图例维度<small className="dash-hint-inline">按它拆成多条线/多组柱</small></span>
              <Picker ariaLabel="图例维度" value={widget.bindings.seriesDimension ?? ""} placeholder="不分系列"
                options={[{ value: "", label: "不分系列" },
                  ...dimensionFields.filter((f) => !boundDims.includes(f.name)).map((f) => ({ value: f.name, label: f.label || f.name }))]}
                onChange={(v) => setBindings({ seriesDimension: v || undefined })} />
            </label>
          )}

          <FieldWell
            title="指标"
            hint="汇总方式逐个可选"
            picked={bound}
            available={wellFields(measureFields)}
            onChange={(next) => {
              // 新加进来的按数据集里定的口径走 —— 那是建数据集的人想清楚过的。
              const added = next.filter((n) => !bound.includes(n));
              const rest = { ...aggregations };
              for (const gone of bound.filter((n) => !next.includes(n))) delete rest[gone];
              for (const name of added) {
                const preset = dataset.fields.find((f) => f.name === name)?.defaultAgg;
                if (preset) rest[name] = preset;
              }
              setBindings({ measures: next, aggregations: rest });
            }}
            renderControl={(name) => (
              <>
                <Picker compact ariaLabel={`${label(name)} 汇总方式`}
                  value={aggregations[name] ?? dataset.fields.find((f) => f.name === name)?.defaultAgg ?? "sum"}
                  options={(Object.keys(AGG_LABELS) as AggKind[]).map((a) => ({ value: a, label: AGG_LABELS[a] }))}
                  onChange={(a) => setBindings({ aggregations: { ...aggregations, [name]: a as AggKind } })} />
                {metricSortControl(name)}
              </>
            )}
            emptyText={measureFields.length === 0
              ? "这个数据集还没有度量字段。回数据集里点「探测字段」,把要汇总的列标成「度量」。"
              : "还没选指标 —— 组件会按维度去重,只显示维度有哪些取值。"}
          />
        </>
      )}
    </div>
  );
}
