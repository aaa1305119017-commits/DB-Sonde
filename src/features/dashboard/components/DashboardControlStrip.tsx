import { FileDown, FileUp, Files, Globe, Loader2, RefreshCw } from "lucide-react";
import DateRangePicker from "./DateRangePicker";
import FilterBar from "./FilterBar";
import { defaultMetricScope } from "../../metrics/queryPlan";
import { clearQueryCache } from "../query";
import type { DashboardDocument, DashboardDrillFilter, DashboardFilter, DashboardRuntimeData } from "../domain";
import type { DashboardFilterValues } from "../filtering";

/**
 * 工具条下面那一条:页面结构、导入导出、刷新、数据日期、筛选器。
 *
 * 从 DashboardWorkspace 里搬出来的纯展示层 —— 它一个 state 都不持有,
 * 所有动作都是回调。留在原处唯一的作用是让那个组件更长、也更难看出
 * 哪些是编排逻辑、哪些只是按钮。
 */
export default function DashboardControlStrip(props: {
  document: DashboardDocument;
  preview: boolean;
  pageRailOpen: boolean;
  exportingHtml: boolean;
  runtime: Record<string, DashboardRuntimeData>;
  filterValues: DashboardFilterValues;
  drill?: DashboardDrillFilter;
  onTogglePageRail: () => void;
  onImport: () => void;
  onExportJson: () => void;
  onExportHtml: () => void;
  onRefresh: () => void;
  onPatch: (patch: Partial<DashboardDocument>) => void;
  onAddFilter: () => void;
  onChangeFilter: (filter: DashboardFilter) => void;
  onRemoveFilter: (id: string) => void;
  onFilterValue: (id: string, value: string) => void;
  onClearDrill: () => void;
}) {
  const { document: doc, preview } = props;
  const scope = doc.metricScope ?? defaultMetricScope();

  return (
    <div className="dash-control-strip">
      {!preview && <button className={`btn sm ${props.pageRailOpen ? "on" : ""}`} onClick={props.onTogglePageRail} title="页面结构"><Files size={13} />页面</button>}
      {!preview && <button className="btn sm" onClick={props.onImport} title="导入看板:JSON,或「导出网页」产出的 HTML —— 导回来可继续编辑"><FileUp size={13} />导入</button>}
      <button className="btn sm" onClick={props.onExportJson} title="导出看板为 JSON(可再导入回来编辑)"><FileDown size={13} />导出</button>
      <button className="btn sm" onClick={props.onExportHtml} disabled={props.exportingHtml} title="导出为离线交互式网页(数据烘进文件,可下钻/切指标)">
        {props.exportingHtml ? <Loader2 size={13} className="spin" /> : <Globe size={13} />}导出网页
      </button>
      {/* 点刷新就是明确要最新的数 —— 清缓存再重取,否则点了也是原样 */}
      <button className="btn sm" onClick={() => { clearQueryCache(); props.onRefresh(); }} title="清掉缓存并立即重新取数"><RefreshCw size={13} />刷新</button>
      {!preview && (
        <label className="dash-strip-label">自动刷新
          <select
            className="dash-strip-select"
            value={doc.refreshInterval ?? 0}
            onChange={(e) => props.onPatch({ refreshInterval: Number(e.target.value) || undefined })}
          >
            <option value={0}>关</option>
            <option value={30}>30 秒</option>
            <option value={60}>1 分钟</option>
            <option value={300}>5 分钟</option>
            <option value={600}>10 分钟</option>
          </select>
        </label>
      )}
      <label className="dash-daterange-label">数据日期
        <DateRangePicker
          start={scope.start}
          end={scope.end}
          onChange={(start, end) => props.onPatch({ metricScope: { ...scope, start, end } })}
        />
      </label>
      <FilterBar
        filters={doc.filters}
        datasets={doc.datasets}
        runtime={props.runtime}
        values={props.filterValues}
        drill={props.drill}
        preview={preview}
        onAdd={props.onAddFilter}
        onChange={props.onChangeFilter}
        onRemove={props.onRemoveFilter}
        onValue={props.onFilterValue}
        onClearDrill={props.onClearDrill}
      />
    </div>
  );
}
