/**
 * 日期 → "YYYY-MM-DD"。
 *
 * 只有两种正确写法,这里各给一个名字,因为**混着用只在每天凌晨那几小时出错** ——
 * 平时怎么点都对,天亮之后自己就好了,谁也复现不出来。
 *
 * 出错的写法长这样:
 *
 *     const d = new Date();          // 本地当前时刻
 *     d.setDate(d.getDate() - 1);    // 按本地日历减一天
 *     d.toISOString().slice(0, 10);  // ← 换算成 UTC 再取日期
 *
 * 东八区 0 点到 8 点之间,UTC 还停在前一天:9 月 18 日凌晨两点算「昨天」,
 * 算出来是 16 号,不是 17 号。调度台的回填对话框就是拿这个当默认值的 ——
 * 一早去补数,补的是错的那天。
 *
 * 所以调用方必须挑一个:
 *   localDay —— 「用户日历上的今天」。人说"今天""昨天"指的是这个。
 *   utcDay   —— 日期本身就是用 Date.UTC 造出来的、只把 Date 当天数容器用。
 *               整月/整年对齐、按天加减都属于这类,用 UTC 是为了躲开夏令时。
 *
 * 业务日期跟机器所在时区不一致时(服务器在别的时区),按指定时区取 —— 见 localDayIn。
 */

const pad = (n: number) => String(n).padStart(2, "0");

/** 本地日历日。传 Date 就格式化它,不传就是今天。 */
export function localDay(at: Date = new Date()): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** 本地日历上的 n 天前(n 为负则往后)。跨月跨年由 Date 自己处理。 */
export function localDayOffset(days: number, from: Date = new Date()): string {
  return localDay(new Date(from.getFullYear(), from.getMonth(), from.getDate() - days));
}

/**
 * UTC 锚点日。**只**给那些用 Date.UTC 造出来、或由 "YYYY-MM-DD" 解析出来的 Date 用 ——
 * 对这些 Date 而言 UTC 就是它唯一的含义,换算不丢东西。
 * 传一个 new Date() 进来是错的,那是本地时刻,该用 localDay。
 */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/** 指定时区的日历日 —— 业务日期跟机器时区不一致时用(比如服务在国外、账期按国内算)。 */
export function localDayIn(timeZone: string, at: Date = new Date()): string {
  // en-CA 的短日期格式就是 YYYY-MM-DD,省得自己拼。
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/**
 * 是不是一个合法的 "YYYY-MM-DD"。
 *
 * 光靠正则不够:"2026-02-31" 形状没问题,但 Date 会把它顺延成 3 月 3 日。
 * 拿解析回来的日期反过来渲染一遍,对不上就是不存在的日期。
 * 这里必须用 utcDay —— "YYYY-MM-DD" 被 Date 解析成的就是 UTC 零点。
 */
export function isCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && utcDay(new Date(value)) === value;
}

/** Exclusive upper boundary of an inclusive calendar-day filter (timezone independent). */
export function nextCalendarDay(value: string): string {
  if (!isCalendarDay(value)) throw new Error("日期必须是有效的 YYYY-MM-DD");
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + 1);
  const result = utcDay(date);
  if (!isCalendarDay(result)) throw new Error("日期范围超出支持的年份");
  return result;
}
