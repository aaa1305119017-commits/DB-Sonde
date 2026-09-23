import type { DashboardWidget } from "./domain";
/* 实现是 labelOrder.runtime.js —— 写成普通脚本是为了能原样内联进导出的离线网页。
   看板这边 import 它拿副作用,再套一层类型。两处同一份排序规则。 */
import "./labelOrder.runtime.js";

export interface LabelOrderSpec {
  /** 按分类值本身排;空串表示不按维度排。 */
  dimension: "asc" | "desc" | "";
  /** 按某个指标排(优先于维度);null 表示没设。 */
  metricKey: string | null;
  dir: "asc" | "desc" | null;
}

interface OrderApi {
  orderLabels(labels: string[], spec: { dimension: string; metric: { dir: string; valueOf: (label: string) => number } | null }): string[];
  orderSpecOf(widget: DashboardWidget, xField: string, metricKeys: string[], xIsTime: boolean): LabelOrderSpec;
}

const api = () => (globalThis as unknown as { __DASH_ORDER__: OrderApi }).__DASH_ORDER__;

/** 读出这个组件想怎么排(指标优先于维度)。 */
export const orderSpecOf = (widget: DashboardWidget, xField: string, metricKeys: string[], xIsTime: boolean): LabelOrderSpec =>
  api().orderSpecOf(widget, xField, metricKeys, xIsTime);

/** 按 spec 把分类值排好。valueOf 只在按指标排时用到。 */
export const orderLabels = (
  labels: string[],
  spec: LabelOrderSpec,
  valueOf: (label: string) => number,
): string[] =>
  api().orderLabels(labels, {
    dimension: spec.dimension,
    metric: spec.metricKey && spec.dir ? { dir: spec.dir, valueOf } : null,
  });
