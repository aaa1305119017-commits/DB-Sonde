import { nanoid } from "nanoid";
import { DASHBOARD_SCHEMA_VERSION, normalizeDashboard, type DashboardDocument } from "../domain";
import { defaultMetricScope } from "../../metrics/queryPlan";

/**
 * 把「导出网页」产出的自包含 HTML 还原成可继续编辑的看板文档。
 *
 * 导出时每个组件的**完整配置**(bindings/options/位置)都原样内嵌在
 * `window.__DASH__` 里,所以这里只需把 widgets + 标题 + 数据日期取回来;
 * 数据集与指标定义会由 resolveSemanticDocument 按 metricIds 重新推导
 * ——因此导回的机器上「指标中心」要有同名指标(和 JSON 导入同一前提)。
 *
 * 烘焙进去的那份数据不还原:它只是导出那一刻的快照,编辑时会重新查库。
 */
export function parseDashboardHtml(html: string, fallbackTitle?: string): DashboardDocument | null {
  const marker = "window.__DASH__=";
  const start = html.indexOf(marker);
  if (start < 0) return null;
  const end = html.indexOf("</script>", start);
  if (end < 0) return null;
  let json = html.slice(start + marker.length, end).trim();
  if (json.endsWith(";")) json = json.slice(0, -1);

  let baked: { title?: string; description?: string; scope?: { start?: string; end?: string }; widgets?: { widget?: unknown }[] };
  try {
    baked = JSON.parse(json); // JSON.parse 原生认识导出时写入的 < 转义
  } catch {
    return null;
  }
  const widgets = (baked.widgets ?? []).map((item) => item?.widget).filter(Boolean);
  if (widgets.length === 0) return null;

  const base = defaultMetricScope();
  return normalizeDashboard({
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    id: `dashboard-${nanoid(10)}`,
    title: baked.title || fallbackTitle || "导入看板",
    description: baked.description ?? "",
    status: "draft",
    revision: 1,
    metricScope: { ...base, start: baked.scope?.start ?? base.start, end: baked.scope?.end ?? base.end },
    datasets: [],
    metrics: [],
    filters: [],
    widgets,
    updatedAt: new Date().toISOString(),
  });
}

/** 该文本看起来是不是 Sonde 导出的离线看板网页。 */
export const isDashboardHtml = (text: string) => text.includes("window.__DASH__=");
