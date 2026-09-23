/**
 * 交叉表的排版:把放到「列」的维度展开成列,其余维度作行分组。
 *
 * 单独成一个模块,因为这是纯计算 —— 列的顺序、多层表头、列数封顶都在这儿,错了很难从
 * 界面上看出来(得先凑一份取值足够多的数据),放在组件文件里就只能连 React 一起打包才能测。
 */
import type { Cell } from "../../types";
import type { DashboardTableOptions } from "./domain";
import { compareText } from "../../lib/collate";

/** 一列的规格:维度或指标,带在 rows 里的下标、显示名、格式。 */
export interface TableColumnSpec {
  key: string; // 唯一键(= 显示名),用于宽度/排序/合并映射
  label: string;
  kind: "dim" | "metric";
  colIndex: number; // 在 rows 二维数组里的下标
  decimals?: number;
  unit?: string;
  /** 透视列的分组名(= 列维度取值,如 "2026-08-31")。设了它表头就渲染成两级:
   *  上面每层按取值跨列合并,最下面一行是各指标。 */
  /** 透视列头,一个列维度一层(大区在上、主管在下)。原来是一个字符串,多个列维度
   *  被拼成「北京大区 / 刘海涛」挤在一格里 —— 那不是交叉表,那是把两列粘一起了。 */
  groups?: string[];
  /** 该指标列的再聚合方式:比率/均值类不能加总,小计与列总计据此走平均/极值。 */
  aggregation?: "sum" | "avg" | "min" | "max" | "count" | "count_distinct";
}

export type Rec = Record<string, Cell>;

export const num = (v: Cell): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};



/** 透视布局:把 placement=column 的维度展开成列,其余维度作行分组。导出供测试直接调 ——
 *  列的顺序、多层表头、列数封顶都在这儿,靠点界面验太费劲也盖不全。 */
export function buildPivot(
  records: Rec[],
  dims: TableColumnSpec[],
  metrics: TableColumnSpec[],
  options: DashboardTableOptions,
): { columns: TableColumnSpec[]; rows: Rec[] } {
  const colDims = dims.filter((d) => options.dimensionPlacements?.[d.key] === "column");
  if (colDims.length === 0) return { columns: [...dims, ...metrics], rows: records };
  const rowDims = dims.filter((d) => !colDims.includes(d));
  /* 列头按层保留,不拼成一个字符串 —— 拼了就没法把大区和主管分成两行表头。
     排序让同一个上层的取值挨在一起,否则跨列合并会碎成一格一格。 */
  /* 列的先后按每个列维度自己配的方向,一层一层比 —— 深一层天然是在浅一层内部排,
     这正是交叉表想要的。原来是把整条路径 JSON 化之后按字符串升序,既不听配置,
     比的还包括引号和方括号。 */
  const colDirs = colDims.map((d) => (options.dimensionSorts?.[d.key] ?? options.timeOrder ?? "asc").replace("group_", ""));
  const pivotKeys = [...new Set(records.map((r) => JSON.stringify(colDims.map((d) => String(r[d.key])))))]
    .sort((a, b) => {
      const left = JSON.parse(a) as string[];
      const right = JSON.parse(b) as string[];
      for (let i = 0; i < left.length; i += 1) {
        const cmp = compareText(left[i], right[i]);
        if (cmp) return colDirs[i] === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  const groups = new Map<string, Rec>();
  for (const r of records) {
    const rowKey = rowDims.map((d) => String(r[d.key])).join("\u0001");
    const target = groups.get(rowKey) ?? Object.fromEntries(rowDims.map((d) => [d.key, r[d.key]]));
    const pk = JSON.stringify(colDims.map((d) => String(r[d.key])));
    metrics.forEach((m) => (target[`${pk} \u0001 ${m.key}`] = num(r[m.key])));
    groups.set(rowKey, target);
  }
  const metricCols: TableColumnSpec[] = pivotKeys.flatMap((pk) =>
    metrics.map((m) => ({ key: `${pk} \u0001 ${m.key}`, label: m.label, groups: JSON.parse(pk) as string[], kind: "metric" as const, colIndex: -1, decimals: m.decimals, unit: m.unit, aggregation: m.aggregation })),
  );
  const cols: TableColumnSpec[] = [...rowDims, ...metricCols];
  const rows = [...groups.values()];
  if (options.rowTotal && metricCols.length) {
    const totalCol: TableColumnSpec = { key: "\u0001rowtotal", label: "行总计", kind: "metric", colIndex: -1, decimals: metrics[0]?.decimals };
    rows.forEach((r) => (r[totalCol.key] = metricCols.reduce((t, c) => t + num(r[c.key]), 0)));
    cols.push(totalCol);
  }
  return { columns: cols, rows };
}

