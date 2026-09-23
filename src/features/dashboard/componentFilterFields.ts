import { isTimeField } from "../datasets/domain";
import type { DashboardDataset, DashboardWidget } from "./domain";

/**
 * 组件筛选器里,哪些字段该渲染成日期区间(而不是一串取值的多选)。
 *
 * 两个条件:类型上是时间,而且它就是这个数据集的日期轴 —— 后者是因为区间最终落到
 * 组件的 metricScope 上(日期轴本来就按它筛),不需要另造一种筛选类型。别的时间列
 * (比如"首单日期")仍然走多选,因为按它筛要的是一种后端还没有的区间条件,
 * 给个日历只会筛不动。
 *
 * 判定只此一处:看板上用它决定画哪个控件,导出时用它把结论烘进文件 ——
 * 导出的页面照着结论渲染,不自己猜。以前那边是拿字段名做正则猜的,于是同一个字段
 * 软件里是一串日期的下拉、导出的页面里是两个文本框,对不上。
 */
export function dateFilterFieldsOf(widget: DashboardWidget, dataset: DashboardDataset | undefined): string[] {
  const axis = dataset?.compiledFrom?.query.dateRange?.field;
  return (widget.filterFields ?? []).filter((field) => {
    if (field === "date") return true; // 保留名:看板顶部那根日期轴
    if (field !== axis) return false;
    return isTimeField({ name: field, type: dataset?.fields?.find((f) => f.name === field)?.typeName });
  });
}
