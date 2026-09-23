/* 实现是 tooltipText.runtime.js —— 写成普通脚本是为了能原样内联进导出的离线
   网页。看板这边 import 它拿副作用,再套一层类型。一份实现,两处用。 */
import "./tooltipText.runtime.js";

const api = () => (globalThis as unknown as { __DASH_TIP__: { esc(v: unknown): string } }).__DASH_TIP__;

/**
 * 把一段外来文本转义成可以安全拼进 tooltip HTML 的形式。
 *
 * 进 tooltip 的分类名、系列名、维度值、指标名全都来自数据库,谁都能往里写
 * `<script>`。唯一不该过这儿的是 ECharts 自己生成的 `p.marker`。
 */
export const escapeHtml = (value: unknown): string => api().esc(value);
