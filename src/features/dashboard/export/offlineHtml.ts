import { api } from "../../../lib/api";
import { bakeDashboard } from "./bake";
import { buildDashboardHtml } from "./htmlExport";
import { download } from "../transfer";
import type { DashboardDocument } from "../domain";
import type { Metric } from "../../metrics/metricsStore";

/**
 * 导出离线交互式网页。
 *
 * 单独一个文件的原因是依赖:htmlExport 用 Vite 的 `?raw` 把运行时和 CSS 内联进来,
 * 这条依赖会顺着 import 链传染。放在叶子上,transfer.ts 的解析逻辑才能进测试。
 */

export interface HtmlExportResult {
  /** 生成的网页有多大(MB,一位小数)—— 数据是烘进去的,用户会关心。 */
  mb: string;
  /** 顺带存进工作区了没。存不进不算失败,下载已经成了。 */
  savedToFiles: boolean;
  /** 烘数据时发现的问题,原样交给调用方决定提示几条。 */
  warnings: string[];
}

/**
 * 导出离线交互式 HTML:按各组件锁定范围把明细烘进单个自包含网页(内联 echarts),
 * 双击即可离线打开,支持下钻/切指标/悬停/同环比。数据是导出那一刻的快照。
 */
export async function downloadOfflineHtml(
  doc: DashboardDocument,
  metrics: Metric[],
  translateError: Parameters<typeof bakeDashboard>[2],
): Promise<HtmlExportResult> {
  const { baked, warnings } = await bakeDashboard(doc, metrics, translateError);
  const html = await buildDashboardHtml(baked);
  download(`${doc.title || "dashboard"}.html`, new Blob([html], { type: "text/html;charset=utf-8" }));

  // 同时存进工作区,这样「文件」面板里能看到它,点一下就能导回来继续编辑。
  const safeName = (doc.title || "dashboard").replace(/[\\/:*?"<>|]/g, "_");
  let savedToFiles = false;
  try {
    const dir = await api.pyWorkspaceDir();
    if (dir) {
      await api.pyWriteFile(`${dir}/${safeName}.html`, html);
      savedToFiles = true;
    }
  } catch { /* 存工作区失败不影响下载 */ }

  return { mb: (html.length / 1_048_576).toFixed(1), savedToFiles, warnings };
}

