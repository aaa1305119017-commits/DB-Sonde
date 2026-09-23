import { compareText } from "../../lib/collate";
import type {
  DashboardDataset,
  DashboardDrillFilter,
  DashboardFilter,
  DashboardRuntimeData,
} from "./domain";

export type DashboardFilterValues = Record<string, string>;

export interface ActiveDashboardFilter {
  field: string;
  kind: DashboardFilter["kind"];
  value: string;
}

/** 某数据集当前生效的筛选:全局筛选按"含该维度字段"联动,组件筛选按 datasetId
 *  绑定,外加下钻。传入整个 dataset(需要 fields 来判断全局筛选是否适用)。 */
export function activeDashboardFilters(
  dataset: Pick<DashboardDataset, "id" | "fields" | "compiledFrom">,
  definitions: DashboardFilter[],
  values: DashboardFilterValues,
  drill?: DashboardDrillFilter,
): ActiveDashboardFilter[] {
  /* 「这份数据是谁的」在两种模型下是两个 id:指标看板里编译产物的 id 就是数据集 id;
     数据集模型下编译产物按组件存,组件共用的那个数据集 id 在原料里。两个都认 ——
     只认前者的话,点一根柱子联动别的组件永远对不上,看起来就是"点了没反应"。 */
  const owns = (id: string | undefined) => !!id && (id === dataset.id || id === dataset.compiledFrom?.dataset.id);
  const active = definitions
    .filter((filter) =>
      (filter.scope ?? "dataset") === "global"
        ? dataset.fields.some((field) => field.name === filter.field)
        : owns(filter.datasetId),
    )
    .map((filter) => ({
      field: filter.field,
      kind: filter.kind,
      value: values[filter.id] ?? filter.defaultValue ?? "",
    }))
    .filter((filter) => filter.value !== "");
  if (drill && owns(drill.datasetId)) {
    active.push({ field: drill.field, kind: "select", value: drill.value });
  }
  return active;
}

export function distinctFilterValues(
  runtime: DashboardRuntimeData | undefined,
  field: string,
  limit = 200,
): string[] {
  const result = runtime?.result;
  if (!result) return [];
  const index = result.columns.findIndex((column) => column.name === field);
  if (index < 0) return [];
  return [...new Set(result.rows.map((row) => String(row[index] ?? "NULL")))]
    .sort(compareText)
    .slice(0, limit);
}
