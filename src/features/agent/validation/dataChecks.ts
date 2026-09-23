import type { QueryResult, Cell } from "../../../types";

/**
 * 数据质量校验 —— **整条链路上最重要的一层,零 LLM**。
 *
 * 设计原则里排第一的是「数据准确性」。这里的每一条都在回答同一个问题:
 * 这批数能不能拿去画图、能不能拿去下结论。
 *
 * fail 一条都不许进出图阶段。宁可告诉用户"查出来的数有问题",
 * 也不能让一张漂亮的看板替错数背书。
 */

export type IssueLevel = "fail" | "warn";

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
  /** 出问题的行号(0 基)或维度取值,便于定位。 */
  samples?: string[];
}

export interface DatasetShape {
  /** 维度列名(按它们在 columns 里的顺序)。 */
  dimensions: string[];
  /** 指标列 → 显示层再聚合方式。ratio/derived 是 avg,跨行求和会得到荒唐值。 */
  metrics: {
    field: string; name: string; rollup: "sum" | "avg" | "min" | "max" | "count" | "count_distinct"; unit: string;
    /** 算式是去重计数 —— 不分组查一次得到的不是同一个量,总分对齐没法比。 */
    distinctCount?: boolean;
  }[];
  /** 时间维度列名(有的话),用来查日期缺口。 */
  timeField?: string;
  /** 查询用的日期区间,用来算应有多少天。 */
  dateRange?: { start: string; end: string };
  grain?: "day" | "week" | "month" | "year";
}

const num = (cell: Cell): number | null => {
  if (cell == null || (typeof cell !== "number" && typeof cell !== "string") || (typeof cell === "string" && !cell.trim())) return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const parsed = Number(cell);
  return Number.isFinite(parsed) ? parsed : null;
};

const indexOf = (result: QueryResult, name: string) => result.columns.findIndex((c) => c.name === name);

/** 按 grain 展开区间应该有多少个时间点。 */
export function expectedPoints(range: { start: string; end: string }, grain: DatasetShape["grain"] = "day"): number {
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end < start) return 0;
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  if (grain === "day") return days;
  if (grain === "week") {
    const monday = (d: Date) => d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000;
    return Math.round((monday(end) - monday(start)) / (7 * 86_400_000)) + 1;
  }
  if (grain === "year") return end.getUTCFullYear() - start.getUTCFullYear() + 1;
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth()) + 1;
}

/**
 * 单个结果集的体检。
 *
 * 每一条都给具体的样本,不只说"有问题" —— 排查时要能直接看到是哪几行。
 */
export function checkDataset(result: QueryResult, shape: DatasetShape): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const rows = result.rows;

  if (rows.length === 0) {
    return [{ level: "fail", code: "EMPTY", message: "查询没有返回任何数据。可能是日期范围内确实没数,也可能是筛选条件过严 —— 不要拿空结果画图。" }];
  }

  /* 结果被截断 = 后面所有的合计、同环比、TopN 全都是在残缺数据上算的。
     这比"数据有问题"更危险:每一行都是对的,加起来却少了一大截,而且看不出来。
     必须硬拦,并且让上游知道该降维重查,而不是提高上限硬扛。 */
  if (result.truncated) {
    return [{
      level: "fail", code: "TRUNCATED",
      message: `结果被截断在 ${rows.length.toLocaleString()} 行 —— 拿它算合计会少一大截,而且表面看不出来。` +
        `维度组合太细了,应该减少分组维度重新查,而不是提高行数上限。`,
    }];
  }

  // ── 维度组合重复:说明 GROUP BY 没盖住,或者 JOIN 放大了 ──
  for (const dimension of shape.dimensions) {
    if (indexOf(result, dimension) < 0) issues.push({ level: "fail", code: "MISSING_DIMENSION", message: `查询结果缺少分组维度 ${dimension}，请检查指标定义。` });
  }
  const dimIdx = shape.dimensions.map((d) => indexOf(result, d)).filter((i) => i >= 0);
  if (dimIdx.length) {
    const seen = new Map<string, number>();
    const dupes: string[] = [];
    rows.forEach((row) => {
      const key = JSON.stringify(dimIdx.map((i) => row[i] ?? null));
      const count = (seen.get(key) ?? 0) + 1;
      seen.set(key, count);
      if (count === 2 && dupes.length < 5) dupes.push(dimIdx.map((i) => String(row[i] ?? "")).join(" / "));
    });
    if (dupes.length) {
      issues.push({
        level: "fail",
        code: "DUPLICATE_DIMENSIONS",
        message: `同一个维度组合出现了多行 —— GROUP BY 没盖住所有维度,或者 JOIN 放大了行数。这种数据求和会重复计算。`,
        samples: dupes,
      });
    }
  }

  // ── 时间缺口 ──
  if (shape.timeField && shape.dateRange) {
    const ti = indexOf(result, shape.timeField);
    if (ti >= 0) {
      const points = new Set(rows.map((row) => String(row[ti] ?? "").slice(0, 10)).filter(Boolean));
      const expected = expectedPoints(shape.dateRange, shape.grain);
      if (expected > 0 && points.size < expected) {
        const missingRatio = 1 - points.size / expected;
        issues.push({
          level: missingRatio > 0.2 ? "fail" : "warn",
          code: "TIME_GAPS",
          message: `区间内应有 ${expected} 个${({ day: "天", week: "周", month: "月", year: "年" }[shape.grain ?? "day"])},实际只有 ${points.size} 个(缺 ${Math.round(missingRatio * 100)}%)。ETL 可能还没跑完,趋势图会出现断崖。`,
        });
      }
    }
  }

  // ── 指标列逐列体检 ──
  for (const metric of shape.metrics) {
    const mi = indexOf(result, metric.field);
    if (mi < 0) {
      issues.push({ level: "fail", code: "MISSING_COLUMN", message: `结果里没有指标列 ${metric.field}(${metric.name}),查询和绑定对不上。` });
      continue;
    }
    const values = rows.map((row) => num(row[mi]));
    const nulls = values.filter((v) => v === null).length;
    if (nulls === values.length) {
      issues.push({ level: "fail", code: "ALL_NULL", message: `指标「${metric.name}」整列都是空值,这个数不能用。` });
      continue;
    }
    if (nulls / values.length > 0.1) {
      issues.push({
        level: "warn",
        code: "MANY_NULLS",
        message: `指标「${metric.name}」有 ${Math.round((nulls / values.length) * 100)}% 的空值,结论里要说明。`,
      });
    }

    const real = values.filter((v): v is number => v !== null);
    // 负值:金额/数量类指标出现负数通常是退款没处理干净或口径反了
    const negatives = real.filter((v) => v < 0);
    if (negatives.length && /元|单|个|人|家|次/.test(metric.unit)) {
      issues.push({
        level: "warn",
        code: "NEGATIVE",
        message: `指标「${metric.name}」有 ${negatives.length} 个负值(单位是${metric.unit})。退款冲抵是正常的,但也可能是口径反了。`,
        samples: negatives.slice(0, 3).map(String),
      });
    }
    // 极端值:不是错误,是让 AnalysisAgent 去解释的异常点
    if (real.length >= 5) {
      const sorted = [...real].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median > 0) {
        const outliers = real.filter((v) => v > median * 20);
        if (outliers.length) {
          issues.push({
            level: "warn",
            code: "OUTLIER",
            message: `指标「${metric.name}」有 ${outliers.length} 个值超过中位数的 20 倍。可能是真的异常业务,也可能是脏数据 —— 结论里要单独交代。`,
            samples: outliers.slice(0, 3).map(String),
          });
        }
      }
    }
  }

  return issues;
}

/**
 * 总分对齐 —— **整套校验里性价比最高的一条**。
 *
 * 分组查询的各行按各自的 rollup 汇总,和单独查的总计比。对不上就说明中间某一步
 * 出了问题:JOIN 放大、维度笛卡尔积、筛选没下推到分组查询…… 这几类错误最隐蔽,
 * 因为每一行看起来都是对的,只有加起来才露馅。
 *
 * 代价是多一次查询。值。
 */
export function checkTotals(
  grouped: QueryResult,
  total: QueryResult,
  metrics: DatasetShape["metrics"],
  tolerance = 0.005,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (total.rows.length === 0) return [{ level: "warn", code: "NO_TOTAL", message: "总计查询没返回数据,跳过总分对齐检查。" }];
  /* 分组结果被截断时这个比较毫无意义 —— 少的那部分本来就没查回来,
     报"JOIN 放大了行数"会把人带到完全错误的方向上。 */
  if (grouped.truncated) return [];

  for (const metric of metrics) {
    // 只有可加的指标能这么比。平均/比率型跨行汇总本身就没有唯一答案。
    if (metric.rollup !== "sum" && metric.rollup !== "count") continue;
    /* 去重计数:分组之和跟不分组的值本来就不是一个量,差多少都不说明有错。
       真机上踩过 ——「有效天数」按网点分组求和 310、不分组查是 31,被判成硬问题,
       整个分析停在「数据检查没有通过」。可这两个数都对:310 是网点有效天数(算日均的
       分母),31 是日历天数。该做的是把话说清楚,不是拦下来。 */
    if (metric.distinctCount) {
      const gi0 = grouped.columns.findIndex((c) => c.name === metric.field);
      const ti0 = total.columns.findIndex((c) => c.name === metric.field);
      if (gi0 < 0 || ti0 < 0) continue;
      const parts0 = grouped.rows.reduce((acc, row) => acc + (num(row[gi0]) ?? 0), 0);
      const whole0 = num(total.rows[0][ti0]) ?? 0;
      if (whole0 !== 0 && Math.abs(parts0 - whole0) / Math.max(Math.abs(whole0), Math.abs(parts0)) > tolerance) {
        issues.push({
          level: "warn", code: "DISTINCT_COUNT_SCOPE",
          message: `「${metric.name}」按分组加起来是 ${parts0.toLocaleString()},不分组直接查是 ${whole0.toLocaleString()} —— ` +
            `去重计数本来就会这样,两个都对但不是同一个量(前者是各分组各自去重后的合计,后者是整体去重)。` +
            `用作日均一类的分母时要的是前者;说"整体有多少个"时要的是后者。结论里别把两者混着用。`,
        });
      }
      continue;
    }
    const gi = grouped.columns.findIndex((c) => c.name === metric.field);
    const ti = total.columns.findIndex((c) => c.name === metric.field);
    if (gi < 0 || ti < 0) continue;

    const parts = grouped.rows.reduce((acc, row) => acc + (num(row[gi]) ?? 0), 0);
    const whole = num(total.rows[0][ti]) ?? 0;
    if (whole === 0 && parts === 0) continue;
    const diff = Math.abs(parts - whole);
    const base = Math.max(Math.abs(whole), Math.abs(parts));
    if (diff / base > tolerance) {
      /* 别一口咬定是 JOIN —— 真机上第一次触发这条,原因其实是「笔均金额」被当成了
         可加指标(它是 SUM(gmv)/SUM(orders),31 天一加就是 31 倍)。
         倍数和行数对得上,就是不可加指标的铁证,先说这个;对不上再怀疑 JOIN。 */
      const ratio = whole !== 0 ? parts / whole : 0;
      const rows = grouped.rows.length;
      const looksNonAdditive = rows > 1 && Math.abs(ratio - rows) / rows < 0.1;
      const cause = looksNonAdditive
        ? `分组求和正好约等于总计的 ${rows} 倍(= 行数),说明这个指标根本不能跨行相加 —— ` +
          `比率、均值、COUNT(DISTINCT) 都是这样。它的显示聚合方式应该是平均而不是求和。`
        : `这通常意味着 JOIN 放大了行数、维度产生了笛卡尔积,或者筛选条件只作用到了其中一边。`;
      issues.push({
        level: "fail",
        code: "TOTAL_MISMATCH",
        message:
          `指标「${metric.name}」分组求和是 ${parts.toLocaleString()},单独查总计是 ${whole.toLocaleString()},` +
          `差 ${((diff / base) * 100).toFixed(2)}%。${cause}`,
      });
    }
  }
  return issues;
}

/* 这儿原来还有一个 checkRollup:「比率型指标被要求求和」判成硬错。
   它写好了、测试也测了,但**生产代码里一次都没调用过** —— 而且在当前结构下也点不着:
   查询计划的 rollup 就是 metricRollup 算出来的那一个,不存在「请求的聚合方式」跟它不一致的情况。
   一个跑不到的检查比没有更糟:测试绿着,给人一种「这条守住了」的错觉。
   真要守这件事,该守在指标定义那一层(指标体检里的 ratio-not-aggregated / null-unsafe-sum),
   那儿是人能写错、而且写错了看不出来的地方。 */

/** 汇总成一句结论。fail 一条都不许放行。 */
export function verdict(issues: ValidationIssue[]): { status: "pass" | "warn" | "fail"; summary: string } {
  const fails = issues.filter((i) => i.level === "fail");
  const warns = issues.filter((i) => i.level === "warn");
  if (fails.length) {
    return { status: "fail", summary: `数据有 ${fails.length} 个硬问题,不能用来画图:${fails.map((f) => f.code).join("、")}` };
  }
  if (warns.length) {
    return { status: "warn", summary: `数据可用,但有 ${warns.length} 处需要在结论里交代:${warns.map((w) => w.code).join("、")}` };
  }
  return { status: "pass", summary: "数据体检通过。" };
}
