/**
 * 日期区间的算术。
 *
 * 曾经这里还有一整套「符号化周期」(last_month / last_n_months / named_quarter …),
 * 用来把模型吐的分类落成确定区间。参数改由人在表单里选之后那些全没用了 ——
 * 日期是他自己点的,没有什么需要解析。
 * 留下的只有同环比平移和人话描述:这两件事表单也做不了,得算。
 */

export interface DateRange {
  start: string;
  end: string;
}

const parseDate = (value: string): Date => {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
};

const pad = (n: number) => String(n).padStart(2, "0");
export const fmt = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 某年某月(0 基)的最后一天。自动处理闰年。 */
const endOfMonth = (year: number, month: number): Date => new Date(year, month + 1, 0);
const span = (a: Date, b: Date): DateRange => ({ start: fmt(a), end: fmt(b) });

/**
 * 同比 / 环比区间。
 *
 * 整月识别是关键:8/1–8/31 的环比应该是 7/1–7/31(整个上月),而不是往前推 31 天
 * 得到 6/30–7/30。年同比同理,还要处理闰日 —— 2024-02-29 的去年同期没有 2/29,
 * 夹到 2/28。
 */
export function shiftRange(range: DateRange, kind: "mom" | "yoy"): DateRange {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  const wholeMonths =
    start.getDate() === 1 && end.getDate() === endOfMonth(end.getFullYear(), end.getMonth()).getDate();

  if (kind === "yoy") {
    const shiftedStart = new Date(start.getFullYear() - 1, start.getMonth(), Math.min(start.getDate(), endOfMonth(start.getFullYear() - 1, start.getMonth()).getDate()));
    const lastDay = endOfMonth(end.getFullYear() - 1, end.getMonth()).getDate();
    const shiftedEnd = wholeMonths
      ? endOfMonth(end.getFullYear() - 1, end.getMonth())
      : new Date(end.getFullYear() - 1, end.getMonth(), Math.min(end.getDate(), lastDay));
    return span(shiftedStart, shiftedEnd);
  }

  if (wholeMonths) {
    const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1;
    const shiftedStart = new Date(start.getFullYear(), start.getMonth() - months, 1);
    return span(shiftedStart, endOfMonth(shiftedStart.getFullYear(), shiftedStart.getMonth() + months - 1));
  }

  const days = Math.round((Date.parse(range.end) - Date.parse(range.start)) / 86_400_000) + 1;
  return span(
    new Date(start.getFullYear(), start.getMonth(), start.getDate() - days),
    new Date(end.getFullYear(), end.getMonth(), end.getDate() - days),
  );
}

/** 人话描述,给用户确认用:「2026年8月(环比 7月,同比 去年8月)」。 */
export function describeRange(range: DateRange): string {
  const start = parseDate(range.start);
  const end = parseDate(range.end);
  const wholeMonth =
    start.getDate() === 1 &&
    end.getDate() === endOfMonth(end.getFullYear(), end.getMonth()).getDate() &&
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth();
  if (wholeMonth) return `${start.getFullYear()}年${start.getMonth() + 1}月`;
  const wholeYear = range.start.endsWith("-01-01") && range.end.endsWith("-12-31") && start.getFullYear() === end.getFullYear();
  if (wholeYear) return `${start.getFullYear()}年`;
  return `${range.start} 至 ${range.end}`;
}
