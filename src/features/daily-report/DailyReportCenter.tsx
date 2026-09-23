import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, RefreshCw, Play, Settings2, AlertTriangle, CheckCircle2, Search, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import AssetShell from "../assets/AssetShell";
import { api } from "../../lib/api";
import { defaultReportWindow, reportServiceSource, useDailyReport } from "./reportStore";
import type { CheckStatus, DailyReport, ReportBrief, ReportResponse, ReportSource } from "./types";
import "./daily-report.css";

const SOURCE_KEY = "sonde.daily-report.source.v2";
const labels: Record<CheckStatus, string> = { running: "检查中", queued: "等待开始", passed: "已通过", difference: "发现差异", incomplete: "存在未验证项", needs_rule: "待补充规则", error: "检查失败", no_data: "两侧均无数据" };
const issueLabels: Record<string, string> = { metric: "指标差异", missing: "目标缺失", extra: "目标多出", null_store: "网点字段为空", null_metric: "指标为空" };
const show = (v: unknown) => v === null || v === undefined || v === "" ? "—" : String(v);
const time = (value?: string, timeZone?: string) => value ? new Date(value).toLocaleString("zh-CN", { timeZone, hour12: false }) : "—";
function initialSource(): ReportSource {
  for (const key of [SOURCE_KEY, "sonde.daily-report.source.v1"]) {
    try { const saved = localStorage.getItem(key); const source = saved && reportServiceSource(JSON.parse(saved)); if (source) return source; } catch { /* Invalid preferences can be replaced in service settings. */ }
  }
  return { url: "" };
}
function Status({ value }: { value: CheckStatus }) { return <span className={`dr-status ${value}`}>{labels[value] ?? value}</span>; }

export default function DailyReportCenter() {
  const open = useDailyReport((s) => s.open);
  const [source, setSource] = useState(initialSource);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingRun, setPendingRun] = useState("");
  const [reports, setReports] = useState<ReportBrief[]>([]);
  const [report, setReport] = useState<DailyReport | null>(null);
  const [selected, setSelected] = useState("");
  const [chains, setChains] = useState<string[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [schedule, setSchedule] = useState("");
  const [window, setWindow] = useState(defaultReportWindow);
  const [serviceTimezone, setServiceTimezone] = useState<string>();
  const windowInitialized = useRef(false);
  const [chain, setChain] = useState("");
  const [table, setTable] = useState("");
  const [tab, setTab] = useState<"issues" | "checks" | "coverage">("issues");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("all");
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (source.url) return;
    void api.dailyReportSource().then((saved) => {
      if (!mounted.current) return;
      const configured = reportServiceSource(saved);
      if (configured) setSource((current) => current.url ? current : configured);
      else setSettings(true);
    }).catch(() => { if (mounted.current) setSettings(true); });
    /* 只在挂载时读一次服务地址。source.url 正是这个 effect 要写的东西
       (第一行 if (source.url) return 就是防重入),列进依赖等于自己触发自己。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const request = async (operation: Record<string, unknown>): Promise<ReportResponse> => {
    const result = await api.dailyReportRequest(source, operation);
    if (result.error) throw new Error(result.error);
    return result;
  };
  const load = async (id = selected, offset = 0) => {
    const current = ++sequence.current;
    setBusy(true); setError("");
    try {
      const listing = await request({ action: "list" });
      const target = id || listing.reports?.[0]?.id || "";
      const result = target ? await request({ action: "read", id: target, query, state, offset }) : null;
      if (!mounted.current || current !== sequence.current) return;
      setReports(listing.reports ?? []); setChains(listing.chains ?? []); setTables(listing.tables ?? []); setSchedule(listing.schedule ?? "");
      setServiceTimezone(listing.timezone);
      if (!windowInitialized.current) { setWindow(defaultReportWindow(new Date(), listing.timezone)); windowInitialized.current = true; }
      setSelected(target); setReport(result?.report ?? null);
      if (result?.report) setPendingRun("");
      localStorage.setItem(SOURCE_KEY, JSON.stringify(source));
      localStorage.removeItem("sonde.daily-report.source.v1");
      setSettings(false);
    } catch (e) { if (current === sequence.current) setError(String(e).replace(/^Error:\s*/, "")); }
    finally { if (current === sequence.current) setBusy(false); }
  };
  useEffect(() => {
    if (!open || !pendingRun || busy) return;
    const timer = setTimeout(() => void load(pendingRun), 5000);
    return () => clearTimeout(timer);
    /* load 是每次渲染现建的函数,列进依赖会让这个 5 秒轮询在每次渲染时重新计时 ——
       于是永远等不到 5 秒,轮询实际上不会发生。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingRun, busy]);
  useEffect(() => {
    if (open && source.url && !reports.length && !busy && !settings) void load();
    // Loading is deliberately controlled by opening the page or explicit refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source.url]);
  useEffect(() => {
    if (!open || report?.status !== "running" || busy || error) return;
    const timer = setTimeout(() => void load(report.id, report.offset), 15000);
    return () => clearTimeout(timer);
    /* 同上:load 每次渲染都是新函数,列进去这个 15 秒轮询永远重新计时。 */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report, busy, error]);
  const run = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await request({ action: "run", start: window.start, end: window.end, chain: chain || undefined, table: table || undefined });
      setNotice("检查已提交，结果会自动更新；关闭 Sonde 后服务端仍会继续。");
      setSelected(result.id ?? "");
      setPendingRun(result.id ?? "");
    } catch (e) { setError(String(e).replace(/^Error:\s*/, "")); }
    finally { setBusy(false); }
  };
  if (!open) return null;
  const summary = report?.summary;
  const filteredChecks = report?.checks.filter((c) => !query || JSON.stringify(c).toLowerCase().includes(query.toLowerCase())) ?? [];
  return <AssetShell title="每日汇报" sub="源头到末端，逐日、逐店核对" actions={
    <><button className="btn" onClick={() => setSettings(!settings)}><Settings2 size={14} /> 服务连接</button><button className="btn" disabled={busy || !source.url} onClick={() => void load()}><RefreshCw size={14} className={busy ? "spin" : ""} /> 刷新</button></>
  }>
    <div className="dr-body">
      {settings && <form className="dr-connection" onSubmit={(e) => { e.preventDefault(); void load(""); }}>
        <b>每日检查服务</b><p>直接连接汇报服务，读取结果和手动检查无需 SSH。你当前这台电脑和服务器本机可直接访问。</p>
        <div className="dr-fields"><label>服务地址<input className="input" required type="url" disabled={busy} value={source.url} placeholder="http://192.0.2.2:8765" onChange={(e) => setSource({ url: e.target.value })} /></label></div>
        <button className="btn primary" disabled={busy || !source.url}>连接并读取汇报</button>
      </form>}
      {error && <div className="dr-alert error"><AlertTriangle size={16} /> {error}</div>}
      {notice && <div className="dr-alert">{notice}</div>}
      <section className="dr-manual">
        <div className="dr-section-title"><b>手动检查</b><span>默认昨天及最近 7 天 · 上海时间</span></div>
        <div className="dr-fields">
          <label>开始日期<input className="input" type="date" value={window.start} onChange={(e) => { windowInitialized.current = true; setWindow({ ...window, start: e.target.value }); }} /></label>
          <label>结束日期<input className="input" type="date" value={window.end} onChange={(e) => { windowInitialized.current = true; setWindow({ ...window, end: e.target.value }); }} /></label>
          <label>链路<select className="input" value={chain} onChange={(e) => setChain(e.target.value)}><option value="">全部链路</option>{chains.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>涉及的表<select className="input" value={table} onChange={(e) => setTable(e.target.value)}><option value="">全部表</option>{tables.map((t) => <option key={t}>{t}</option>)}</select></label>
          <button className="btn primary" disabled={busy || !source.url || !window.start || !window.end || window.start > window.end} onClick={() => void run()}>{busy ? <Loader2 size={14} className="spin" /> : <Play size={14} />} 开始检查</button>
        </div>
        <p className="dr-muted">{schedule || "每日自动检查的状态将在连接服务后显示。"} 每次检查保留独立结果，可在修复后重新检查。</p>
      </section>
      <div className="dr-history"><b>检查记录</b><select className="input" disabled={busy} value={selected} onChange={(e) => void load(e.target.value)}><option value="">选择检查记录</option>{reports.map((r) => <option key={r.id} value={r.id}>{time(r.startedAt, serviceTimezone)} · {r.trigger === "manual" ? "手动" : "自动"} · {r.start} 至 {r.end} · {labels[r.status]}</option>)}</select>{report && <Status value={report.status} />}</div>
      {!report ? <div className="dr-empty"><ClipboardCheck size={38} /><h3>尚未读取检查结果</h3><p>连接服务后查看每日汇报，或选择日期发起手动检查。</p></div> : <>
        <div className="dr-cards">
          <div><span>发现差异</span><strong className={summary?.differences ? "dr-red" : ""}>{summary?.differences ?? 0}</strong><small>项检查 · {summary?.issues ?? 0} 条异常</small></div>
          <div><span>异常分组</span><strong>{summary?.issueGroups ?? summary?.stores ?? 0}</strong><small>按各检查的分组口径统计</small></div>
          <div><span>已通过</span><strong className="dr-green">{summary?.passed ?? 0}</strong><small>共 {summary?.checks ?? 0} / {report.plannedChecks ?? "—"} 项检查</small></div>
          <div><span>尚未验证</span><strong className={(summary?.incomplete || report.coverage.length) ? "dr-amber" : ""}>{(summary?.incomplete ?? 0) + report.coverage.length}</strong><small>失败、无数据、规则缺口</small></div>
        </div>
        <div className="dr-run-meta"><span>{report.start} 至 {report.end} · 涉及 {summary?.tables ?? 0} 张表</span><span>开始 {time(report.startedAt, serviceTimezone)} · 完成 {time(report.finishedAt, serviceTimezone)}</span></div>
        {report.status === "passed" && <div className="dr-alert success"><CheckCircle2 size={16} /> 本次已配置范围检查通过。覆盖范围和规则版本可在下方查看。</div>}
        <div className="dr-tabs">{([['issues', '异常明细'], ['checks', '检查明细'], ['coverage', '链路覆盖']] as const).map(([id, label]) => <button className={tab === id ? "on" : ""} key={id} onClick={() => setTab(id)}>{label}</button>)}<div className="dr-search"><Search size={14} /><input className="input" value={query} placeholder="表、分组条件、核对项" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(selected); }} /></div>{tab === "issues" && <><select className="input" value={state} onChange={(e) => setState(e.target.value)}><option value="all">全部异常类型</option>{Object.entries(issueLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><button className="btn" disabled={busy} onClick={() => void load(selected)}>筛选</button></>}</div>
        {tab === "issues" && <><div className="dr-table-wrap"><table className="dr-table"><thead><tr>{['链路 / 环节', '分组条件', '异常类型', '核对项', '应有值', '实际值', '差值'].map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{report.issueRows.map((i, n) => <tr key={`${i.checkId}:${n}`}><td><b>{i.chain}</b><small title={i.sourceTables.join("\n")}>{i.sourceTables.join("、") || "本表字段检查"}</small><small title={i.targetTable}>→ {i.targetTable}</small></td><td>{Object.entries(i.group ?? { 日期: i.date, 网点: i.outlet_name || i.store_id, 渠道: i.channel }).map(([key, value]) => <small key={key}>{key}: {show(value)}</small>)}</td><td>{issueLabels[i.kind] ?? i.kind}</td><td>{i.metric}</td><td className="dr-number">{show(i.expected)}</td><td className="dr-number">{show(i.actual)}</td><td className="dr-number dr-red">{show(i.difference)}</td></tr>)}</tbody></table>{!report.issueRows.length && <p className="dr-table-empty">当前筛选没有异常明细。检查是否完整请查看“检查明细”和“链路覆盖”。</p>}</div><div className="dr-pagination"><span>共 {report.filteredIssueCount} 条 · 当前 {report.filteredIssueCount ? report.offset+1 : 0}—{Math.min(report.offset+100, report.filteredIssueCount)}</span><button className="btn" disabled={busy || report.offset === 0} onClick={() => void load(selected, Math.max(0, report.offset-100))}><ChevronLeft size={14} /> 上一页</button><button className="btn" disabled={busy || report.offset+100 >= report.filteredIssueCount} onClick={() => void load(selected, report.offset+100)}>下一页 <ChevronRight size={14} /></button></div></>}
        {tab === "checks" && <div className="dr-table-wrap"><table className="dr-table"><thead><tr><th>链路 / 检查</th><th>目标表</th><th>日期 / 范围</th><th>结果</th><th>来源 / 目标分组数</th><th>核对数值（应有 / 实际）</th><th>异常数</th><th>说明</th></tr></thead><tbody>{filteredChecks.map((c) => <tr key={c.id}><td><b>{c.chain}</b><small>{c.name}</small></td><td>{c.targetTable}</td><td>{c.scope === "全表" ? "全表" : c.date}</td><td><Status value={c.status} /></td><td>{show(c.expectedGroups)} / {show(c.actualGroups)}</td><td>{Object.keys(c.expectedTotals ?? {}).map((key) => <small key={key}>{key}: {show(c.expectedTotals?.[key])} / {show(c.actualTotals?.[key])}</small>)}</td><td>{c.issueCount}</td><td>{c.message || (c.status === "no_data" ? "没有数据可用于验证；需确认该日是否应有数据" : "—")}</td></tr>)}</tbody></table></div>}
        {tab === "coverage" && <div className="dr-coverage"><p>本次规则版本：<code>{report.catalogRevision.slice(0,16)}</code></p><p>新链路、文件变更、未解析入口和未覆盖环节会在此列出，检查失败不会被记作通过。</p>{report.coverage.length ? report.coverage.map((c, i) => <div className="dr-gap" key={i}><Status value={c.status} /><div><b>{c.message}</b><small>{[c.chain, c.file].filter(Boolean).join(" · ")}</small></div></div>) : <div className="dr-alert success">本次没有发现额外的链路覆盖缺口。逐项检查状态见“检查明细”。</div>}</div>}
      </>}
    </div>
  </AssetShell>;
}
