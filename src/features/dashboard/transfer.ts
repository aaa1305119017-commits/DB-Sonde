import { nanoid } from "nanoid";
import { isDashboardHtml, parseDashboardHtml } from "./export/htmlImport";
import type { DashboardDocument } from "./domain";

/**
 * 看板的进出 —— 导出 JSON / 导入 JSON 或导出的网页。
 *
 * 「导出离线网页」单独放在 export/offlineHtml.ts:它依赖 Vite 的 `?raw` 导入,
 * 谁 import 了这个文件就被那个依赖绑住 —— 集成测试的打包器直接吃不下。
 * 把重依赖隔离在叶子模块,解析这类纯逻辑才测得了。
 *
 * 从 DashboardWorkspace 里搬出来的:这些全是**文件与序列化**的活,
 * 一行 React 状态都不碰。留在组件里唯一的作用是让那个文件更长。
 *
 * 约定:这里只做事并**返回事实**,不弹 toast、不翻译文案 —— 提示语归调用方,
 * 服务层不该知道 i18n 和 UI 的存在(和 dashboardService 一个规矩)。
 *
 * 注意 `document` 这个名字:在这些函数里它指看板文档,浏览器的 DOM 要写 window.document。
 */

export function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = window.document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 导出整张看板为 JSON(备份 / 分享)。 */
export function downloadJson(doc: DashboardDocument): void {
  download(`${doc.title || "dashboard"}.json`, new Blob([JSON.stringify(doc, null, 2)], { type: "application/json" }));
}

export interface ImportedDashboard {
  doc: DashboardDocument;
  /** 从哪种文件来的 —— 调用方据此说不同的话。 */
  from: "json" | "html";
}

/** 把一段文本解析成看板文档。既收看板 JSON,也收「导出网页」产出的 HTML。 */
export function parseDashboardFile(text: string, fileName: string): ImportedDashboard {
  if (isDashboardHtml(text)) {
    const fromHtml = parseDashboardHtml(text, fileName.replace(/\.html?$/i, ""));
    if (!fromHtml) throw new Error("这个 HTML 里没找到可还原的看板数据");
    return { doc: { ...fromHtml, title: `${fromHtml.title} (导入)` }, from: "html" };
  }
  const parsed = JSON.parse(text) as Partial<DashboardDocument>;
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.widgets)) {
    throw new Error("不是有效的看板 JSON 或导出网页");
  }
  // 导入一律当新草稿:换 id、标题加后缀、revision 归 1,免得覆盖同 id 的现有看板
  return {
    doc: {
      ...(parsed as DashboardDocument),
      id: `dashboard-${nanoid(10)}`,
      title: `${parsed.title || "导入看板"} (导入)`,
      status: "draft",
      revision: 1,
    },
    from: "json",
  };
}

/** 弹文件选择框,选完解析好给回来。用户取消 → resolve(null)。 */
export function pickDashboardFile(): Promise<ImportedDashboard | null> {
  return new Promise((resolve, reject) => {
    const input = window.document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json,text/html,.html";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve(parseDashboardFile(String(reader.result), file.name));
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error("读不了这个文件"));
      reader.readAsText(file);
    };
    input.click();
  });
}
