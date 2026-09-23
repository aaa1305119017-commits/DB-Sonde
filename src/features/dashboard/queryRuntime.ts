import { compileSemanticDataset } from "./semantic";
import { buildWidgetSql } from "../datasets/widgetQuery";
import { validateDatasetSql, type DatasetSqlErrorKey, type DatasetQueryFilter } from "./datasetSql";
import type { DashboardDataset } from "./domain";
import type { Metric } from "../metrics/metricTypes";
import type { DbKind, QueryResult } from "../../types";

export interface DatasetQueryPorts {
  readCatalog(): Metric[];
  dialectFor(connectionId: string): DbKind | undefined;
  readQuery(connectionId: string, database: string | undefined, sql: string, maxRows: number,
    filters: DatasetQueryFilter[], timeoutSecs?: number, signal?: AbortSignal): Promise<QueryResult>;
  now?(): number;
}

/** A caller-owned cache and in-flight set. Refresh never joins requests from a previous generation. */
export function createDatasetQueryRuntime(port: DatasetQueryPorts) {
  const now = port.now ?? Date.now;
  const cache = new Map<string, { at: number; result: QueryResult; }>();
  const inFlight = new Map<string, Promise<QueryResult>>();
  const lifetime = new AbortController();
  let generation = 0;
  const keyOf = (id: string, db: string | undefined, sql: string, filters: DatasetQueryFilter[], rows: number, timeout?: number) =>
    JSON.stringify([id, db ?? "", sql, filters, rows, timeout ?? 0]);
  const remember = (key: string, result: QueryResult) => {
    cache.set(key, { at: now(), result: structuredClone(result) });
    if (cache.size > 60) cache.delete(cache.keys().next().value!);
  };
  function clearQueryCache() { generation++; cache.clear(); inFlight.clear(); }
  function dispose() { lifetime.abort(); clearQueryCache(); }
  function primeQueryCache(id: string, db: string | undefined, sql: string, filters: DatasetQueryFilter[], rows: number, result: QueryResult, timeout?: number) {
    lifetime.signal.throwIfAborted();
    remember(keyOf(id, db, sql, filters, rows, timeout), result);
  }
  async function cachedQuery(id: string, db: string | undefined, sql: string, filters: DatasetQueryFilter[], rows: number, timeout?: number) {
    lifetime.signal.throwIfAborted();
    const key = keyOf(id, db, sql, filters, rows, timeout);
    const hit = cache.get(key);
    if (hit && now() - hit.at < 300000) return structuredClone(hit.result);
    let work = inFlight.get(key);
    if (!work) {
      const started = generation;
      work = Promise.resolve().then(async () => {
        lifetime.signal.throwIfAborted();
        const result = await port.readQuery(id, db, sql, rows, filters, timeout, lifetime.signal);
        lifetime.signal.throwIfAborted();
        if (started === generation) remember(key, result);
        return result;
      }).finally(() => { if (inFlight.get(key) === work) inFlight.delete(key); });
      inFlight.set(key, work);
    }
    return structuredClone(await work);
  }
  /**
   * 数据集模型的 SQL。
   *
   * 调用方要换条件时,改的是 dataset 上的 groupBy / metricScope —— 语义数据集每次现编,
   * 这两个自然生效;数据集模型的 sql 是编好的字符串,不重编就完全没反应。下钻、同环比、
   * 组件筛选器的日期都走这条路,三个功能界面上都在却一直是死的,就是漏在这儿。
   */
  function datasetModelSql(dataset: DashboardDataset, filters: DatasetQueryFilter[]): { sql: string; rest: DatasetQueryFilter[] } {
    const from = dataset.compiledFrom;
    if (!from) return { sql: dataset.sql, rest: filters }; // 导入的 HTML / 手写 SQL,没有原料可重编
    const scope = dataset.metricScope;
    const query = { ...from.query };
    /* 下钻:换一列分组。分组换了,原来那列的粒度设定就不适用了。
       钻的那一列可能已经不在数据集里了(被删了,或者标成了不保留)—— 那就当没配这一层,
       按原来的维度出图,而不是编一句引用不存在的列的 SQL 让整张卡片报错。 */
    if (dataset.groupBy?.length) {
      const exposed = new Set(from.dataset.fields.filter((f) => !f.hidden).map((f) => f.name));
      const usable = dataset.groupBy.filter((name) => exposed.has(name));
      if (usable.length) {
        query.dimensions = usable;
        query.grains = undefined;
      }
    }
    // 日期窗口:同环比往前挪,组件筛选器可能收窄。落在数据集原本认定的那根时间轴上。
    if (scope?.start && scope.end && from.query.dateRange) {
      query.dateRange = { ...from.query.dateRange, start: scope.start, end: scope.end };
    }
    /* 等值筛选编进 SQL 里面,不留给后端包在外面。
       后端的做法是 SELECT * FROM (你这句) WHERE xxx —— 要求被筛的列在输出里。
       下钻正好相反:钻进「咖啡」之后按日期分组,product_id 根本不在输出里,于是真库上
       报"没有这一列",mock 里静默不过滤,看到的是没筛过的数。编进去则是过滤子查询,
       那里所有保留的列都在。
       text(包含)没法写成等值,留给后端 —— 那种筛的都是当前分组的列,包在外面是对的。 */
    const inline = filters.filter((f) => f.kind === "in" || f.kind === "select");
    const rest = filters.filter((f) => f.kind !== "in" && f.kind !== "select");
    if (inline.length) {
      query.filters = [
        ...(query.filters ?? []),
        ...inline.map((f) => ({
          field: f.field,
          values: f.kind === "in" ? f.value.split("\u0001").filter(Boolean) : [f.value],
        })),
      ];
    }
    try {
      return { sql: buildWidgetSql(from.dataset, query, from.kind), rest };
    } catch {
      return { sql: dataset.sql, rest: filters }; // 重编不出来就用原来那句,总比整个组件报错强
    }
  }

  async function executeDataset(dataset: DashboardDataset, translateError: (key: DatasetSqlErrorKey) => string,
    maxRows = 1000, filters: DatasetQueryFilter[] = [], timeoutSecs?: number, catalog?: Metric[]): Promise<QueryResult> {
    lifetime.signal.throwIfAborted();
    const rows = Number.isFinite(maxRows) ? Math.min(Math.max(Math.floor(maxRows), 1), 200000) : 1000;
    if (dataset.metricIds) {
      const compiled = compileSemanticDataset(dataset, catalog ?? port.readCatalog(), filters, port.dialectFor(dataset.connectionId));
      const error = validateDatasetSql(compiled.sql);
      if (error) throw new Error(translateError(error));
      return cachedQuery(compiled.connectionId, compiled.database, compiled.sql, [], rows, timeoutSecs);
    }
    const { sql, rest } = datasetModelSql(dataset, filters);
    const error = validateDatasetSql(sql);
    if (error) throw new Error(translateError(error));
    if (!dataset.connectionId) throw new Error(translateError("dashboard.selectConnection"));
    return cachedQuery(dataset.connectionId, dataset.database, sql, structuredClone(rest), rows, timeoutSecs);
  }
  return { executeDataset, clearQueryCache, primeQueryCache, dispose };
}
