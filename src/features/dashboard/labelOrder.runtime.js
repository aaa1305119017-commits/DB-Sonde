/* 图表分类轴(饼图就是扇区)的排列顺序。
 *
 * 跟 xlsx.runtime.js 一样是「一份实现两处用」:看板 import 它,导出的离线网页把同一个
 * 文件内联进去。排序这种「看着对不对全靠肉眼」的逻辑最怕两边走散 —— 导出来的图跟
 * 看板上顺序不一样,没人会立刻发现,发现了也说不清哪个是对的。
 *
 * 规则:
 *   指标排序优先于维度排序 —— 用户挑了「按总GMV降序」,那就是他要的,维度顺序让位。
 *   都没设就保持取数回来的顺序(SQL 里 GROUP BY 的自然顺序)。
 *   「只看前几名」(topN)是另一回事:它先按指标挑出前几名,再由这里决定这几名怎么排。
 */
(function () {
  /**
   * @param labels     分类值(已按 topN 挑过)
   * @param spec       { dimension: "asc"|"desc"|"", metric: { dir, valueOf } | null }
   *                   valueOf(label) 给出该分类下的指标值
   * @returns 排好的新数组(不改入参)
   */
  function orderLabels(labels, spec) {
    var out = labels.slice();
    if (!spec) return out;
    if (spec.metric && typeof spec.metric.valueOf === "function") {
      var sign = spec.metric.dir === "asc" ? 1 : -1;
      var cache = {};
      out.forEach(function (l) { cache[l] = spec.metric.valueOf(l); });
      out.sort(function (a, b) {
        var va = cache[a], vb = cache[b];
        // 算不出来的(比如平均值没法汇总)排到最后,别让 NaN 把顺序搅乱
        if (!isFinite(va) && !isFinite(vb)) return 0;
        if (!isFinite(va)) return 1;
        if (!isFinite(vb)) return -1;
        return (va - vb) * sign;
      });
      return out;
    }
    if (spec.dimension === "asc" || spec.dimension === "desc") {
      /* 按分类值本身排。numeric 让「2 月」排在「10 月」前面,而不是按字符串比;
         中文按拼音(localeCompare 的 zh-CN)—— 跟表格那边一套规则。 */
      out.sort(function (a, b) { return String(a).localeCompare(String(b), "zh-CN", { numeric: true }); });
      if (spec.dimension === "desc") out.reverse();
    }
    return out;
  }

  /**
   * 从组件配置里读出排序意图。存的位置历史上叫 options.table —— 当初只有表格能排序,
   * 后来图表也要排,沿用同一处是为了「表格改成折线图,排序还在」。名字没跟着改,
   * 因为改了老看板里存的那份就读不到了。
   *
   * @param widget      组件
   * @param xField      当前分类轴字段名
   * @param metricKeys  当前在画的指标 key,用来判断指标排序是不是还指着一个存在的指标
   */
  function orderSpecOf(widget, xField, metricKeys, xIsTime) {
    var to = (widget.options && widget.options.table) || {};
    var co = (widget.options && widget.options.chart) || {};
    var ms = to.metricSort;
    /* 时间轴不按数值排。时间序列不是排行榜 —— 把月份按 GMV 从小到大摞一遍,那条折线
       看上去一路上涨,其实什么也不表示,x 轴还是乱的(2026-09 排在 2026-02 前面)。
       想看排名换条形图。SQL 那边(resolveDatasets 的 orderByOf)守的是同一条规则。 */
    if (ms && ms.key && !xIsTime && metricKeys.indexOf(ms.key) >= 0) {
      return { dimension: "", metricKey: ms.key, dir: ms.dir === "asc" ? "asc" : "desc" };
    }
    var dim = (to.dimensionSorts || {})[xField];
    /* 老看板里折线图的「时间顺序」是单独一个样式选项。现在排序统一在数据面板上设,
       这个当兼容读:没设新的就用它,设了新的就以新的为准。 */
    if (!dim && widget.type === "line" && co.lineTimeOrder) dim = co.lineTimeOrder;
    // 组内升降序是表格的概念(要有上层分组);图表只有一层分类轴,当普通升降序处理。
    if (dim === "group_asc") dim = "asc";
    if (dim === "group_desc") dim = "desc";
    /* 时间轴默认按时间先后。数据库回来的顺序本来就是 ORDER BY 过的,但组件筛选器会让
       后端把 SQL 包一层(SELECT * FROM (...) WHERE ...),那时候内层的 ORDER BY 就不作数了
       —— 轴上于是出现 2026-09、2026-02、2026-04 这种顺序。这儿兜一道底。 */
    if (!dim && xIsTime) dim = "asc";
    return { dimension: dim === "asc" || dim === "desc" ? dim : "", metricKey: null, dir: null };
  }

  /* 挂 globalThis 而不是 window:浏览器里两者是同一个,而 Node 里(跑测试、打包时
     把组件搬进 Node 执行)没有 window —— 用 window 会直接 ReferenceError。 */
  globalThis.__DASH_ORDER__ = { orderLabels: orderLabels, orderSpecOf: orderSpecOf };
})();
