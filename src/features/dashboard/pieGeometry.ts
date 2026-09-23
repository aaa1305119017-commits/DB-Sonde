/* 实现是 pieGeometry.runtime.js —— 写成普通脚本是为了能原样内联进导出的离线网页。
   看板这边 import 它拿副作用,再套一层类型。一份实现,两处用。 */
import "./pieGeometry.runtime.js";

interface PieApi {
  PIE_LABEL: {
    label: Record<string, unknown>;
    labelLine: Record<string, unknown>;
    labelLayout: Record<string, unknown>;
    outerWithLabels: number;
  };
  pieRadii(inner?: number, outer?: number, showLabels?: boolean): [number, number];
}

const api = () => (globalThis as unknown as { __DASH_PIE__: PieApi }).__DASH_PIE__;

/** 外置标签的排版参数(看板和导出页同一份)。 */
export const PIE_LABEL = api().PIE_LABEL;

/**
 * 环形的内外半径(百分比)。showLabels 为真时给外置标签腾地方 —— 外圈收小,
 * 内圈按同比例跟着收,否则本来二三十个单位厚的环会被压成一条线。
 */
export const pieRadii = (inner?: number, outer?: number, showLabels = false): [number, number] =>
  api().pieRadii(inner, outer, showLabels);
