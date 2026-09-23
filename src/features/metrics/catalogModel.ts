import type { Metric } from "./metricTypes";
/** Legacy records have no catalog metadata; retain IDs so saved dashboards still resolve them. */
export const LEGACY_CATALOG_ID = "legacy";
export const catalogIdOf = (metric: Metric) => metric.catalogId || LEGACY_CATALOG_ID;
export function metricCatalogs(metrics: Metric[]): {
    id: string;
    name: string;
}[] {
    return [...new Map(metrics.map(metric => [catalogIdOf(metric), {
                id: catalogIdOf(metric), name: metric.catalogName || metric.catalogId || "未分组指标（兼容旧数据）",
            }])).values()];
}
export function bindCatalogMetrics(metrics: Metric[], catalogId: string, connId: string, connName: string, updatedAt: number): Metric[] {
    return metrics.map(metric => catalogIdOf(metric) === catalogId ? { ...metric, connId, connName, updatedAt } : metric);
}
export function mergeCatalogMetrics(current: Metric[], incoming: Metric[], mode: "keep" | "replace"): Metric[] {
    const byId = new Map<string, Metric>();
    for (const metric of incoming) {
        if (!metric.id || byId.has(metric.id))
            throw new Error(`指标标识缺失或重复：${metric.id}`);
        const previous = current.find(item => item.id === metric.id);
        // Refuse accidental cross-catalog replacement. Legacy IDs can be adopted once.
        if (previous?.catalogId && catalogIdOf(previous) !== catalogIdOf(metric)) {
            throw new Error(`指标标识 ${metric.id} 已属于其他目录，请为导入目录使用独立标识`);
        }
        byId.set(metric.id, metric);
    }
    /* 覆盖同名指标时,口径换成导入的那份,但**连接绑定留在本地**。
       目录文件是可移植的,里面的 connId 本来就是空的(换台机器、换个库都能用同一份口径);
       而「这个目录连的是哪个库」是安装时绑的。原来直接整份替换,于是重新导入一次
       就把 131 个指标全变成未绑定 —— 口径更新了,却什么都查不了,而且界面上看不出来。 */
    const keepBinding = (incomingMetric: Metric, previous: Metric | undefined): Metric =>
        previous && !incomingMetric.connId
            ? { ...incomingMetric, connId: previous.connId, connName: previous.connName }
            : incomingMetric;
    const existingIds = new Set(current.map(metric => metric.id));
    return [
        ...current.map(metric => mode === "replace" ? keepBinding(byId.get(metric.id) ?? metric, metric) : metric),
        ...incoming.filter(metric => !existingIds.has(metric.id)),
    ];
}
