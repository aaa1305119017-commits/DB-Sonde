/** Friendly cron building for the schedule editor. We only model the common
 *  cases as structured "modes"; anything else is edited as a raw Quartz string
 *  (DolphinScheduler uses 7-field Quartz: sec min hour dom mon dow year). */

export type CronMode = "daily" | "hourly" | "everyNMin" | "weekly" | "monthly" | "custom";

export interface CronParams {
  hour: number;
  minute: number;
  everyN: number; // for everyNMin
  dow: number; // Quartz day-of-week 1=Sun … 7=Sat (for weekly)
  dom: number; // day-of-month 1-31 (for monthly)
  raw: string; // for custom
}

export const DOW_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"]; // index = Quartz dow-1

/**
 * Quartz cron → 一句人话,给调度列表显示用。说不清楚就把原式子原样交回去。
 *
 * 本来长在 dolphinscheduler.ts 里,自己又列了一份星期表 `DOW[Number(dow) % 7]` ——
 * 而 Quartz 是 1=周日,dow=2 是周一却显示成周二,七天全部晚一天,列表里每条
 * 「每周 X」都是错的。同一份表两处各写一遍,走散是迟早的事,所以搬到这儿跟
 * DOW_LABELS 放一起。「把 cron 说成人话」本来也是 cron 的知识,不是 DS API 的。
 *
 * 另外必须看月份和年份字段:`0 0 9 1 3 ? *` 是每年 3 月 1 日跑一次,原来只看
 * 日/周,描述成「每月 1 号」—— 说的比实际多跑十一次。跟 parseCron 一个道理:
 * 没看过的字段不能假装它是 *。
 */
export function cronHuman(cron: string | null | undefined): string | null {
  if (!cron) return null;
  const f = cron.trim().split(/\s+/);
  if (f.length < 6) return cron;
  const [sec, min, hour, dom, mon, dow, year] = f;
  const pad = (x: string) => (x.length === 1 ? `0${x}` : x);
  const numeric = (x: string) => /^\d+$/.test(x);
  const anyDom = dom === "*" || dom === "?";
  const anyDow = dow === "*" || dow === "?";
  // 指定了月份或年份的,下面那些「每天/每周/每月」都不成立,直接给原式子。
  const everyMonth = mon === "*" || mon === "?";
  const everyYear = year === undefined || year === "*" || year === "?";
  if (!everyMonth || !everyYear) return cron;
  // every N minutes
  const perMin = min.match(/^(\d+)?\/(\d+)$/);
  if (hour === "*" && perMin) return `每 ${perMin[2]} 分钟`;
  const perHour = hour.match(/^(\d+)?\/(\d+)$/);
  if (perHour && numeric(min)) return `每 ${perHour[2]} 小时 · 第 ${min} 分`;
  if (hour === "*" && numeric(min)) return `每小时 · 第 ${min} 分`;
  if (numeric(hour) && numeric(min)) {
    const t = `${pad(hour)}:${pad(min)}`;
    if (anyDom && anyDow) return `每天 ${t}`;
    // DOW_LABELS 的下标就是 Quartz dow-1(1=周日),见 cron.ts 的定义。
    if (!anyDow && numeric(dow)) return `每${DOW_LABELS[Number(dow) - 1] ?? `周${dow}`} ${t}`;
    if (!anyDom && numeric(dom)) return `每月 ${dom} 号 ${t}`;
    return `${t}${sec !== "0" ? ` (${sec}秒)` : ""}`;
  }
  return cron;
}

export const defaultParams = (): CronParams => ({
  hour: 9,
  minute: 0,
  everyN: 30,
  dow: 2, // Monday
  dom: 1,
  raw: "0 0 9 * * ? *",
});

/** Build a Quartz cron string from a mode + params. */
export function buildCron(mode: CronMode, p: CronParams): string {
  const { hour: h, minute: m } = p;
  switch (mode) {
    case "daily":
      return `0 ${m} ${h} * * ? *`;
    case "hourly":
      return `0 ${m} * * * ? *`;
    case "everyNMin":
      return `0 0/${Math.max(1, p.everyN)} * * * ? *`;
    case "weekly":
      return `0 ${m} ${h} ? * ${p.dow} *`;
    case "monthly":
      return `0 ${m} ${h} ${p.dom} * ? *`;
    case "custom":
      return p.raw.trim();
  }
}

/**
 * 认出一条 crontab 属于哪个模式,好把编辑器的控件摆对。
 *
 * **认领的唯一标准是能原样拼回去。** 原来是逐字段挑着看(只读分/时/日/周),
 * 没看的字段就当不存在 —— 于是 `0 0 9 1 3 ? *`(每年 3 月 1 日跑一次)被认成
 * 「每月 1 号」。编辑器是无条件回写 buildCron 结果的:用户打开这个任务只想改个
 * 小时,一保存就变成每月 1 号,一年跑一次变成一年跑十二次。模式标签、cron 框、
 * 下次运行预览三处还会自洽地一起显示错的,看不出来。
 *
 * 加字段判断是补不完的:月份、秒、年、`1/3` 这种步进、`L`/`W`、英文月份和星期名
 * ……改成拼回去比一遍,对不上就老老实实当 custom(原文照样放在 params.raw 里,
 * 用户在自定义框里看到的还是他自己写的那条),以后 Quartz 再多什么语法都不用管。
 */
export function parseCron(cron: string | null | undefined): { mode: CronMode; params: CronParams } {
  const params = defaultParams();
  if (!cron) return { mode: "daily", params };
  const text = cron.trim().replace(/\s+/g, " ");
  params.raw = text;
  const f = text.split(" ");
  if (f.length < 6) return { mode: "custom", params };
  const [, min, hour, dom, , dow] = f;
  const num = (x: string) => (/^\d+$/.test(x) ? Number(x) : null);
  const perN = min.match(/^(?:0|\*)?\/(\d+)$/);

  /** 认领之前先拼回去比一遍 —— 对不上说明这条 cron 里还有我们没表达的东西。 */
  const claim = (mode: CronMode, patch: Partial<CronParams>): { mode: CronMode; params: CronParams } | null => {
    const candidate = { ...params, ...patch };
    return buildCron(mode, candidate) === text ? { mode, params: candidate } : null;
  };

  const mm = num(min);
  const hh = num(hour);
  const guesses = [
    perN ? claim("everyNMin", { everyN: Number(perN[1]) }) : null,
    mm != null ? claim("hourly", { minute: mm }) : null,
    hh != null && mm != null ? claim("weekly", { hour: hh, minute: mm, dow: num(dow) ?? params.dow }) : null,
    hh != null && mm != null ? claim("monthly", { hour: hh, minute: mm, dom: num(dom) ?? params.dom }) : null,
    hh != null && mm != null ? claim("daily", { hour: hh, minute: mm }) : null,
  ];
  return guesses.find((g) => g !== null) ?? { mode: "custom", params };
}

/** Next `count` run times for a structured mode (custom returns []). */
export function nextRuns(mode: CronMode, p: CronParams, count = 3, from = new Date()): Date[] {
  const out: Date[] = [];
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);

  if (mode === "everyNMin") {
    const n = Math.max(1, p.everyN);
    const d = new Date(start.getTime());
    // advance to the next minute that is a multiple of n
    d.setMinutes(d.getMinutes() + 1);
    while (d.getMinutes() % n !== 0) d.setMinutes(d.getMinutes() + 1);
    for (let i = 0; i < count; i++) {
      out.push(new Date(d.getTime()));
      d.setMinutes(d.getMinutes() + n);
    }
    return out;
  }
  if (mode === "hourly") {
    const d = new Date(start.getTime());
    d.setMinutes(p.minute, 0, 0);
    if (d <= from) d.setHours(d.getHours() + 1);
    for (let i = 0; i < count; i++) {
      out.push(new Date(d.getTime()));
      d.setHours(d.getHours() + 1);
    }
    return out;
  }
  if (mode === "daily") {
    const d = new Date(start.getTime());
    d.setHours(p.hour, p.minute, 0, 0);
    if (d <= from) d.setDate(d.getDate() + 1);
    for (let i = 0; i < count; i++) {
      out.push(new Date(d.getTime()));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }
  if (mode === "weekly") {
    const jsDow = (p.dow - 1 + 7) % 7; // Quartz 1=Sun → JS 0=Sun
    const d = new Date(start.getTime());
    d.setHours(p.hour, p.minute, 0, 0);
    let guard = 0;
    while ((d.getDay() !== jsDow || d <= from) && guard++ < 14) d.setDate(d.getDate() + 1);
    for (let i = 0; i < count; i++) {
      out.push(new Date(d.getTime()));
      d.setDate(d.getDate() + 7);
    }
    return out;
  }
  if (mode === "monthly") {
    /* 按年月日重新构造,不用 setDate/setMonth 在同一个 Date 上推 ——
       Date 会把不存在的日子**顺延**:2 月 31 日变成 3 月 3 日。原来的写法因此有两个错:
       一是「每月 31 号」在 2 月直接给出 3 月 3 日;二是溢出之后 setMonth(+1) 是从 3 月 3 日
       接着往下推,后面每一条都钉死在 3 号,再也回不到 31 号。
       Quartz 的语义是**跳过**:没有 31 号的月份就不跑(要「每月最后一天」得写 L)。
       这儿照它来,免得预览说的和实际跑的不是一回事。 */
    const dom = Math.max(1, Math.min(31, p.dom));
    let year = start.getFullYear();
    let month = start.getMonth();
    let guard = 0;
    while (out.length < count && guard++ < 120) {
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      if (dom <= daysInMonth) {
        const run = new Date(year, month, dom, p.hour, p.minute, 0, 0);
        if (run > from) out.push(run);
      }
      month += 1;
      if (month > 11) { month = 0; year += 1; }
    }
    return out;
  }
  return out; // custom
}

const pad = (n: number) => String(n).padStart(2, "0");
export function fmtRun(d: Date): string {
  const w = DOW_LABELS[d.getDay()];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${w} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
