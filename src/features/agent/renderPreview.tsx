import { contrast, rgb } from "../dashboard/cardReadability";
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import html2canvas from 'html2canvas-pro';
import DashboardCanvas from '../dashboard/components/DashboardCanvas';
import { previewData as buildPreviewData, type PreviewDataPorts } from './previewData';
import { useMetrics } from '../metrics/metricsStore';
import type { DashboardDocument } from '../dashboard/domain';
import type { AgentState } from './state';
import { callTool } from './tools/registry';
import { getPlan } from './tools/dataTools';
import '../dashboard/dashboard.css';

export interface RenderedPreview { images: string[]; width: number; height: number; complete: boolean; issues: string[]; text: string; }
const noop = () => { };

const defaultPorts: PreviewDataPorts = { readCatalog: () => useMetrics.getState().metrics, callTool, getPlan };
export const previewData = (document: DashboardDocument, state: AgentState, signal?: AbortSignal, port = defaultPorts) => buildPreviewData(document, state, signal, port);

/** Capture only our off-screen dashboard preview, never the desktop or another application. */
export async function renderDashboardPreview(document: DashboardDocument, state: AgentState, signal?: AbortSignal, port: PreviewDataPorts = defaultPorts): Promise<RenderedPreview> {
  if (typeof window === 'undefined') throw new Error('成品预览需要桌面应用的渲染环境');
  const { doc, runtime } = await previewData(document, state, signal, port);
  const host = window.document.createElement('div');
  host.style.cssText = 'position:fixed;left:-16000px;top:0;width:1440px;pointer-events:none;padding:20px;box-sizing:border-box;background:var(--bg);';
  host.setAttribute('aria-hidden', 'true');
  window.document.body.appendChild(host);
  const root = createRoot(host);
  const images: string[] = [], issues: string[] = [];
  const variants: Record<string, string>[] = [{}];
  for (const container of doc.widgets.filter((w) => w.type === 'container' && w.visible)) {
    for (const tab of container.tabs.slice(1)) variants.push({ [container.id]: tab.id });
  }
  let height = 0, complete = true;
  const texts: string[] = [];
  try {
    await Promise.race([window.document.fonts.ready, new Promise((resolve) => setTimeout(resolve, 3000))]);
    signal?.throwIfAborted();
    for (const previewTabs of variants) {
      signal?.throwIfAborted();
      if (images.length >= 12) { complete = false; issues.push('分页过多，截图预算内未覆盖全部页面'); break; }
      flushSync(() => root.render(<DashboardCanvas widgets={doc.widgets} datasets={doc.datasets} metrics={doc.metrics} runtime={runtime}
        scope={{ start: doc.metricScope!.start, end: doc.metricScope!.end }} componentFilterValues={{}} drillPaths={{}} preview staticRender previewTabs={previewTabs}
        onSelect={noop} onChange={noop} onInteractionStart={noop} onDelete={noop} onDuplicate={noop} onToggle={noop} onAddChild={noop}
        onDrill={noop} onDrillDown={noop} onDrillTo={noop} onComponentFiltersChange={noop} />));
      // Allow asynchronous chart initialization; capture uses static chart frames.
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      signal?.throwIfAborted();
      height = Math.max(height, host.scrollHeight);
      if (host.scrollHeight > 12000) { complete = false; issues.push('看板超过预览高度上限，未覆盖底部'); }
      host.querySelectorAll('.dash-widget-state.error').forEach((el) => issues.push(el.textContent ?? '组件渲染错误'));
      host.querySelectorAll<HTMLElement>('.dash-widget-header strong,.dash-kpi strong').forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 4) issues.push(`文字被裁切：${el.textContent}`);
      });
      host.querySelectorAll<HTMLElement>('.dash-text-content,.dash-widget-header strong,.dash-kpi strong,.dash-kpi-label,.dash-dt th').forEach((el) => {
        const foreground = rgb(getComputedStyle(el).color);
        const card = el.matches('th') ? el : el.closest('.dash-widget');
        const background = card ? rgb(getComputedStyle(card).backgroundColor) : undefined;
        if (foreground && background && contrast(foreground, background) < 4.5) issues.push(`文字对比度不足：${el.textContent?.slice(0, 45)}`);
      });
      host.querySelectorAll<HTMLElement>('.dash-kpi-grid,.dash-text-content').forEach((el) => {
        if (el.scrollHeight > el.clientHeight + 4) issues.push(`卡片内容需要内部滚动：${el.textContent?.slice(0, 45)}`);
        if (el.matches('.dash-text-content') && el.clientHeight > 120) {
          const range = window.document.createRange();
          range.selectNodeContents(el);
          const used = range.getBoundingClientRect().height;
          if (used > 0 && used < el.clientHeight * .35) issues.push(`文字卡留白过多，应按内容压缩高度：${el.textContent?.slice(0, 45)}`);
        }
      });
      texts.push(host.innerText.slice(0, 10000));
      const canvas = await html2canvas(host, {
        backgroundColor: getComputedStyle(window.document.body).backgroundColor, scale: 1,
        width: 1440, height: Math.min(host.scrollHeight, 12000), logging: false, imageTimeout: 5000, useCORS: false
      });
      signal?.throwIfAborted();
      for (let top = 0; top < canvas.height; top += 1600) {
        if (images.length >= 12) { complete = false; issues.push('截图预算内未覆盖完整长页面'); break; }
        const tile = window.document.createElement('canvas'); tile.width = canvas.width; tile.height = Math.min(1600, canvas.height - top);
        tile.getContext('2d')!.drawImage(canvas, 0, top, canvas.width, tile.height, 0, 0, tile.width, tile.height);
        images.push(tile.toDataURL('image/png')); tile.width = tile.height = 0;
      }
      canvas.width = canvas.height = 0;
    }
    return { images, width: 1440, height, complete, issues: [...new Set(issues)], text: texts.join('\n分页\n').slice(0, 18000) };
  } finally { root.unmount(); host.remove(); }
}
