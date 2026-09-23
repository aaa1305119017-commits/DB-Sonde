import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const directory = mkdtempSync(join(tmpdir(), 'sonde-scheduler-'));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const a = { id: 'a', kind: 'other', name: 'A', baseUrl: 'https://a.invalid' };
const b = { id: 'b', kind: 'other', name: 'B', baseUrl: 'https://b.invalid' };
try {
  const bundle = join(directory, 'tests.cjs');
  buildSync({ stdin: { contents: `export * from './src/lib/requestScope';
    export * from './src/features/scheduler/schedulerRuntime';
    export * from './src/features/scheduler/definitionSync';
    export * from './src/features/scheduler/cron';`, resolveDir: resolve('.'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
  const m = createRequire(import.meta.url)(bundle);
  const stores = [];
  function fixture(overrides = {}, definition = async () => null) {
    const intervals = [], delays = [];
    const provider = { kind: 'other', label: 'Fixture', available: true, capabilities: {}, authFields: [],
      connect: async () => ({}), listProjects: async () => [], listWorkflows: async () => [], listInstances: async () => [],
      runWorkflow: async () => {}, stopInstance: async () => {}, ...overrides };
    const repository = { load: () => [a, b], save: () => {} };
    const store = m.createSchedulerStore({ connections: repository, provider: () => provider, id: () => 'new', syncDefinitions: definition,
      interval: callback => { const entry = { callback, active: true }; intervals.push(entry); return () => { entry.active = false; }; },
      delay: callback => { const entry = { callback, active: true }; delays.push(entry); return () => { entry.active = false; }; },
    });
    stores.push(store);
    const ready = (connection = a, project = 'p') => store.setState({ activeId: connection.id, projectCode: project,
      status: { a: 'connected', b: 'connected' }, sessions: { [connection.id]: { session: connection.id } }, dataLoading: false, dataError: undefined });
    return { store, provider, repository, intervals, delays, ready };
  }
  {
    const gate = m.createRequestScope();
    const initial = gate.capture(), first = gate.begin('data'), second = gate.begin('data');
    assert.equal(first.isCurrent(), false);
    first.finish();
    assert(gate.isPending('data'));
    second.finish();
    assert.equal(gate.isPending('data'), false);
    assert(second.isCurrent(), 'completed requests retain ownership until a successor/invalidation');
    gate.invalidate();
    assert.equal(initial(), false);
    assert.equal(second.isCurrent(), false);
  }
  // A -> B -> A cannot accept the first A connection, despite equal IDs.
  {
    const connections = [];
    const { store } = fixture({ connect: connection => { const wait = deferred(); connections.push({ connection, ...wait }); return wait.promise; } });
    const first = store.getState().connect('a'), second = store.getState().connect('b'), third = store.getState().connect('a');
    connections[2].resolve({ session: 'new-a' }); await third;
    connections[1].reject(Error('old-b')); connections[0].resolve({ session: 'old-a' });
    await Promise.all([first, second]);
    assert.deepEqual(store.getState().sessions.a, { session: 'new-a' });
    assert.equal(store.getState().status.a, 'connected');
    assert.equal(store.getState().error.b, '');
  }
  // A connection's delayed project list cannot navigate using another connection's credentials.
  {
    const list = deferred(); let loads = 0;
    const { store } = fixture({ listProjects: connection => connection.id === 'a' ? list.promise : Promise.resolve([]),
      listWorkflows: async () => { loads++; return []; } });
    const first = store.getState().connect('a'); await flush();
    await store.getState().connect('b');
    list.resolve([{ code: 'foreign', name: 'Foreign' }]); await first;
    assert.equal(store.getState().activeId, 'b');
    assert.equal(store.getState().projectCode, null);
    assert.equal(loads, 0);
  }
  // Old project errors, statistics, and same-project older reads never clobber current state.
  {
    const data = [], stats = [];
    const { store, ready } = fixture({ listWorkflows: () => { const wait = deferred(); data.push(wait); return wait.promise; },
      projectStats: () => { const wait = deferred(); stats.push(wait); return wait.promise; } });
    ready();
    const p = store.getState().selectProject('p'), q = store.getState().selectProject('q');
    data[1].resolve([{ code: 'q', name: 'Current' }]); await q;
    data[0].reject(Error('late p')); await p;
    assert.equal(store.getState().dataError, undefined);
    assert.equal(store.getState().workflows[0].code, 'q');
    const next = store.getState().selectProject('q');
    stats[0].resolve({ total: 999 }); await flush();
    assert.equal(store.getState().stats, null);
    data[2].resolve([{ code: 'q', name: 'Newest' }]); await next;
    stats[1].resolve({ total: 1 }); await flush();
    assert.equal(store.getState().stats.total, 1);
    assert.equal(store.getState().workflows[0].name, 'Newest');
  }
  // Multiple refreshes queue one follow-up, never overlap main requests or start obsolete queued work.
  {
    const calls = [];
    const { store, ready } = fixture({ listWorkflows: () => { const wait = deferred(); calls.push(wait); return wait.promise; } });
    ready();
    const first = store.getState().refresh();
    await Promise.all([store.getState().refresh(), store.getState().refresh(), store.getState().refresh()]);
    assert.equal(calls.length, 1);
    calls[0].resolve([]); await first; await flush();
    assert.equal(calls.length, 2);
    await store.getState().refresh();
    const changed = store.getState().selectProject('new');
    calls[1].resolve([{ code: 'old' }]); calls[2].resolve([{ code: 'new' }]);
    await changed; await flush();
    assert.equal(calls.length, 3);
    assert.equal(store.getState().workflows[0].code, 'new');
  }
  {
    const tasks = [], logs = [];
    const { store, ready } = fixture({ listTasks: (_c, _s, _p, instance) => {
      if (instance === undefined) return Promise.resolve([]);
      const wait = deferred(); tasks.push(wait); return wait.promise;
    }, taskLog: () => { const wait = deferred(); logs.push(wait); return wait.promise; } });
    ready();
    const first = store.getState().toggleInstance(1), second = store.getState().toggleInstance(2);
    tasks[1].resolve([{ id: 2, name: 'Current' }]); await second;
    tasks[0].reject(Error('Old')); await first;
    assert.equal(store.getState().tasks[0].id, 2);
    assert.equal(store.getState().toast, null);
    const log1 = store.getState().openLog(1, 'First'), log2 = store.getState().openLog(2, 'Second');
    logs[1].resolve('new'); await log2;
    logs[0].resolve('old'); await log1;
    assert.equal(store.getState().log.text, 'new');
    const closed = store.getState().openLog(3, 'Closed'); store.getState().closeLog();
    logs[2].reject(Error('late')); await closed;
    assert.equal(store.getState().log, null);
    const detail = store.getState().toggleInstance(3); await store.getState().toggleInstance(3);
    tasks[2].resolve([{ id: 3 }]); await detail;
    assert.deepEqual(store.getState().tasks, []);
    assert.equal(store.getState().tasksLoading, false);
  }
  {
    const actions = [];
    const { store, ready } = fixture({ runWorkflow: (connection, session, project, code) => {
      const wait = deferred(); actions.push({ connection, session, project, code, ...wait }); return wait.promise;
    } });
    ready();
    const old = store.getState().run('old', 'Old');
    await store.getState().run('duplicate', 'Duplicate');
    assert.equal(actions.length, 1);
    await store.getState().selectProject('q');
    const current = store.getState().run('new', 'New');
    assert.equal(actions[0].project, 'p'); assert.equal(actions[1].project, 'q');
    actions[0].resolve(); await old;
    assert.equal(store.getState().busy, 'run:new');
    assert.equal(store.getState().toast, null);
    actions[1].resolve(); await current;
    assert.equal(store.getState().busy, null);
    assert.match(store.getState().toast.msg, /New/);
  }
  {
    const action = deferred(); let dispatched = 0;
    const { store, ready } = fixture({ runWorkflow: () => { dispatched++; return action.promise; } }); ready();
    const first = store.getState().run('run', 'Run');
    await store.getState().selectProject('q'); await store.getState().selectProject('p');
    assert.equal(store.getState().busy, 'run:run');
    await store.getState().run('again', 'Again'); assert.equal(dispatched, 1);
    action.reject(Error('old visit failure')); await first;
    assert.equal(store.getState().busy, null);
    assert.equal(store.getState().toast, null);
  }
  {
    const request = deferred(); const { store, repository, intervals } = fixture({ connect: () => request.promise });
    store.getState().setOpen(true); store.getState().setAutoRefresh(true);
    const connecting = store.getState().connect('a');
    repository.save = () => { throw Error('quota'); };
    await store.getState().removeConn('a');
    assert.equal(store.getState().activeId, 'a');
    assert.equal(intervals[0].active, true);
    repository.save = () => {};
    await store.getState().removeConn('a');
    request.resolve({ session: 'old' }); await connecting;
    assert.equal(store.getState().activeId, null);
    assert.equal(store.getState().sessions.a, undefined);
    assert.equal(intervals[0].active, false);
  }
  {
    const pending = [];
    const { store, ready, intervals } = fixture({}, request => {
      const wait = deferred(); pending.push({ ...wait, request }); return wait.promise;
    }); ready();
    const first = store.getState().syncDefinitions(), second = store.getState().syncDefinitions();
    pending[1].resolve('new'); await second;
    pending[0].resolve('old'); await first;
    assert.equal(store.getState().definitionMessage, 'new');
    assert.equal(pending[0].request.isCurrent(), false);
    store.setState({ dataLoading: true }); await store.getState().syncDefinitions();
    assert.equal(pending.length, 2);
    store.getState().setOpen(true); store.getState().setAutoRefresh(true); store.getState().setAutoRefresh(true);
    assert.equal(intervals.filter(item => item.active).length, 1);
    store.getState().setOpen(false);
    assert.equal(intervals.some(item => item.active), false);
  }
  // Definition parsing/persistence has its own cancellation boundaries, without a global store.
  {
    const wait = deferred(), publications = []; let current = true, parses = 0, reads = 0;
    const request = { connection: a, session: {}, projectCode: 'p', projectName: 'Project', isCurrent: () => current,
      workflows: [{ code: '1', name: 'One' }, { code: '2', name: 'Two' }], provider: { getDefinition: async () => { reads++; return wait.promise; } } };
    const port = { sources: () => [], profiles: () => [], now: () => 1, publish: value => publications.push(value),
      parseSql: async () => { parses++; return { ok: true, sources: [] }; } };
    const result = m.synchronizeDefinitions(request, port);
    current = false; wait.resolve({ tasks: [{ code: 't', name: 'T', type: 'SQL', params: { sql: 'select 1' } }], relations: [] });
    assert.equal(await result, null);
    assert.equal(reads, 1); assert.equal(parses, 0); assert.equal(publications.length, 0);
    current = true;
    const parse = deferred();
    const parsing = m.synchronizeDefinitions(request, { ...port, parseSql: () => parse.promise });
    await flush(); current = false; parse.resolve({ ok: true, sources: ['erp.x'], target: 'mart.x' });
    assert.equal(await parsing, null);
    assert.equal(publications.length, 0);
  }
  // ── cron:编辑器认模式 / 预览下次运行 ────────────────────────────────────
  {
    const { parseCron, buildCron, nextRuns, defaultParams, fmtRun } = m;

    /* 认领的唯一标准是能原样拼回去。编辑器是无条件把 buildCron 的结果存回去的 ——
       认错一条 cron,用户只是进去改个小时,保存出来就是另一个调度。 */
    for (const cron of ['0 0 9 * * ? *', '0 30 * * * ? *', '0 0/15 * * * ? *', '0 0 9 ? * 2 *', '0 0 9 15 * ? *']) {
      const seed = parseCron(cron);
      assert.notEqual(seed.mode, 'custom', `${cron} 本来是认得出的模式`);
      assert.equal(buildCron(seed.mode, seed.params), cron, `${cron} 认出来之后必须能原样拼回去`);
    }
    /* 这些含有我们没法用控件表达的东西(指定月份、秒、年、步进、L、英文星期名)。
       原来是逐字段挑着看,没看的字段直接丢:`0 0 9 1 3 ? *` 一年跑一次,被当成
       「每月 1 号」存回去,一年跑十二次。现在一律落到 custom,原文原样留着。 */
    for (const cron of ['0 0 9 1 3 ? *', '30 0 9 * * ? *', '0 0 9 1 1/3 ? *', '0 0 9 L * ? *',
                        '0 0 9 ? * MON *', '0 0 9 * * ? 2027']) {
      const seed = parseCron(cron);
      assert.equal(seed.mode, 'custom', `${cron} 表达不了,必须当自定义,不能改写用户的调度`);
      assert.equal(seed.params.raw, cron, `${cron} 落到 custom 时原文要原样留着`);
    }
    assert.equal(parseCron('  0   0  9 * * ?  *  ').mode, 'daily', '多余空白不该影响判断');

    /* 每月 N 号:Quartz 的语义是「没有那天的月份就不跑」(要每月最后一天得写 L)。
       原来在同一个 Date 上 setDate/setMonth 推,Date 会把 2 月 31 日顺延成 3 月 3 日 ——
       预览第一条就错,而且溢出之后是从 3 月 3 日接着推,后面每条都钉死在 3 号。 */
    const days = (runs) => runs.map(r => `${r.getMonth() + 1}/${r.getDate()}`);
    assert.deepEqual(days(nextRuns('monthly', { ...defaultParams(), dom: 31 }, 4, new Date(2026, 1, 5, 10))),
      ['3/31', '5/31', '7/31', '8/31'], '每月 31 号要跳过没有 31 号的月份,不能顺延成 3 号');
    assert.deepEqual(days(nextRuns('monthly', { ...defaultParams(), dom: 30 }, 3, new Date(2026, 0, 15, 10))),
      ['1/30', '3/30', '4/30'], '只跳过 2 月,3 月要回到 30 号 —— 不能一次溢出就永远偏着');
    assert.deepEqual(days(nextRuns('monthly', { ...defaultParams(), dom: 29 }, 2, new Date(2027, 0, 30, 10))),
      ['3/29', '4/29'], '平年 2 月没有 29 号');
    assert.deepEqual(days(nextRuns('monthly', { ...defaultParams(), dom: 29 }, 2, new Date(2028, 0, 30, 10))),
      ['2/29', '3/29'], '闰年 2 月 29 号要跑');
    const crossYear = nextRuns('monthly', { ...defaultParams(), dom: 31 }, 2, new Date(2026, 11, 5, 10));
    assert.deepEqual([crossYear[0].getFullYear(), crossYear[1].getFullYear()], [2026, 2027], '跨年');

    // 其余模式:第一条一定在 from 之后,且间隔均匀
    const from = new Date(2026, 5, 15, 9, 30, 45);
    for (const [mode, params, gapMs] of [
      ['daily', defaultParams(), 86400000],
      ['hourly', defaultParams(), 3600000],
      ['everyNMin', { ...defaultParams(), everyN: 15 }, 15 * 60000],
      ['weekly', defaultParams(), 7 * 86400000],
    ]) {
      const runs = nextRuns(mode, params, 3, from);
      assert.equal(runs.length, 3, `${mode} 要给满 3 条`);
      assert.ok(runs[0] > from, `${mode} 第一条必须在当前时刻之后`);
      assert.equal(+runs[1] - +runs[0], gapMs, `${mode} 间隔`);
      assert.equal(+runs[2] - +runs[1], gapMs, `${mode} 间隔`);
    }
    assert.equal(nextRuns('weekly', { ...defaultParams(), dow: 2 }, 1, from)[0].getDay(), 1, 'Quartz dow=2 是周一');
    assert.deepEqual(nextRuns('custom', defaultParams(), 3, from), [], '自定义表达式不预览');
    assert.equal(typeof fmtRun(new Date(2026, 5, 15, 9, 0)), 'string');

    /* cronHuman:调度列表里那句人话。
       星期原来是 DOW[dow % 7],而 Quartz 1=周日 —— 七天全部晚一天显示。 */
    const { cronHuman } = m;
    const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    for (let q = 1; q <= 7; q++) {
      assert.equal(cronHuman(`0 0 9 ? * ${q} *`), `每${week[q - 1]} 09:00`, `Quartz dow=${q} 是${week[q - 1]}`);
    }
    // 跟编辑器的预览必须说同一天,否则一处说周一一处说周二
    const weekly = nextRuns('weekly', { ...defaultParams(), dow: 5 }, 1, new Date(2026, 5, 15, 9, 30))[0];
    assert.ok(cronHuman('0 0 9 ? * 5 *').startsWith(`每${week[weekly.getDay()]}`), 'cronHuman 和 nextRuns 要说同一天');

    assert.equal(cronHuman('0 0 9 * * ? *'), '每天 09:00');
    assert.equal(cronHuman('0 0 9 15 * ? *'), '每月 15 号 09:00');
    assert.equal(cronHuman('0 0/15 * * * ? *'), '每 15 分钟');
    assert.equal(cronHuman('0 30 * * * ? *'), '每小时 · 第 30 分');
    /* 指定了月份/年份就不是「每天/每周/每月」了 —— 原来只看日和周,
       把「每年 3 月 1 日跑一次」说成「每月 1 号」,多说了十一次。 */
    assert.equal(cronHuman('0 0 9 1 3 ? *'), '0 0 9 1 3 ? *', '指定月份时不能说成每月');
    assert.equal(cronHuman('0 0 9 * * ? 2027'), '0 0 9 * * ? 2027', '指定年份时不能说成每天');
    assert.equal(cronHuman(null), null);
    assert.equal(cronHuman('乱写的'), '乱写的', '看不懂就原样交回去');
  }

  // ── DolphinScheduler 客户端:拿假 HTTP 驱动真代码 ────────────────────────
  {
    /* 换掉 @tauri-apps 的 invoke,就能把真的 provider 跑起来。
       翻页这种代码最容易"要么漏页要么死循环",光看是看不出来的。 */
    const stub = join(directory, 'tauri-core-stub.mjs');
    writeFileSync(stub, 'export const invoke = (name, args) => globalThis.__HTTP__(name, args);\n');
    const dsBundle = join(directory, 'ds.cjs');
    buildSync({ stdin: { contents: `export { dolphinscheduler } from './src/features/scheduler/dolphinscheduler';`,
      resolveDir: resolve('.'), loader: 'ts' },
      bundle: true, platform: 'node', format: 'cjs', outfile: dsBundle, logLevel: 'silent',
      alias: { '@tauri-apps/api/core': stub } });
    globalThis.window = { __TAURI_INTERNALS__: {} };
    const { dolphinscheduler: ds } = createRequire(import.meta.url)(dsBundle);

    const calls = [];
    const serve = (handler) => { globalThis.__HTTP__ = (_name, { request }) => { calls.push(request); return handler(request); }; };
    const envelope = (data) => ({ status: 200, ok: true, body: JSON.stringify({ code: 0, msg: 'success', data }) });
    const conn = { baseUrl: 'http://ds.invalid:12345', username: 'u', password: 'p' };
    const session = { sessionId: 'sid' };
    const paramOf = (url, key) => new URL(url).searchParams.get(key);

    // 分页:超过一页(单页 500)的 1250 条,必须一条不少地全拿回来
    {
      calls.length = 0;
      serve((request) => {
        const pageNo = Number(paramOf(request.url, 'pageNo'));
        const size = Number(paramOf(request.url, 'pageSize'));
        const total = 1250, totalPage = Math.ceil(total / size);
        const from = (pageNo - 1) * size;
        const totalList = Array.from({ length: Math.max(0, Math.min(size, total - from)) },
          (_, i) => ({ code: String(from + i), name: `p${from + i}`, defCount: 1, instRunningCount: 0 }));
        return envelope({ totalList, total, totalPage });
      });
      const projects = await ds.listProjects(conn, session);
      assert.equal(projects.length, 1250, '翻页要把 1250 个项目全拿回来,不能只给第一页');
      assert.deepEqual(projects.map(p => p.code).slice(0, 3), ['0', '1', '2']);
      assert.equal(projects[1249].code, '1249', '最后一条也要在');
      assert.equal(calls.length, 3, '1250 条 / 每页 500 = 3 页');
    }

    // 服务端不给 totalPage 时,靠"这页没满"收尾 —— 别翻不动了还一直翻
    {
      calls.length = 0;
      serve((request) => {
        const pageNo = Number(paramOf(request.url, 'pageNo'));
        const size = Number(paramOf(request.url, 'pageSize'));
        const total = size + 7;
        const from = (pageNo - 1) * size;
        return envelope({ totalList: Array.from({ length: Math.max(0, Math.min(size, total - from)) },
          (_, i) => ({ code: String(from + i), name: 'x' })) });
      });
      const projects = await ds.listProjects(conn, session);
      assert.equal(projects.length, 507, '没有 totalPage 也要翻完');
      assert.equal(calls.length, 2, '第二页没满就该停,不能再翻第三页');
    }

    // 保险丝:服务端一直说"还有下一页"也不能无限翻,把界面吊死
    {
      calls.length = 0;
      serve((request) => {
        const size = Number(paramOf(request.url, 'pageSize'));
        return envelope({ totalList: Array.from({ length: size }, () => ({ code: '1', name: 'x' })), totalPage: 9e9 });
      });
      const projects = await ds.listProjects(conn, session);
      assert.ok(calls.length <= 1000, `分页要有保险丝,实际翻了 ${calls.length} 页`);
      assert.ok(projects.length > 0);
    }

    // 运行记录是流水:只要一窗,而且只发一次请求(不该翻到天荒地老)
    {
      calls.length = 0;
      serve((request) => envelope({ totalList: Array.from({ length: Number(paramOf(request.url, 'pageSize')) },
        (_, i) => ({ id: i, name: 'run', state: 'SUCCESS', processDefinitionCode: '1' })), totalPage: 900 }));
      const instances = await ds.listInstances(conn, session, 'p1');
      assert.equal(calls.length, 1, '运行记录是最近 N 次的流水,不翻页');
      assert.equal(instances.length, 50);
    }

    // 点开某次运行看任务:必须给全,少一个就看不到那个失败的节点
    {
      calls.length = 0;
      serve((request) => {
        assert.equal(paramOf(request.url, 'processInstanceId'), '77', '要按实例过滤');
        const pageNo = Number(paramOf(request.url, 'pageNo')), size = Number(paramOf(request.url, 'pageSize'));
        const total = 520, from = (pageNo - 1) * size;
        return envelope({ totalList: Array.from({ length: Math.max(0, Math.min(size, total - from)) },
          (_, i) => ({ id: from + i, name: `t${from + i}`, state: 'SUCCESS', processInstanceId: 77 })), total,
          totalPage: Math.ceil(total / size) });
      });
      const tasks = await ds.listTasks(conn, session, 'p1', 77);
      assert.equal(tasks.length, 520, '某次运行的任务要给全');
    }

    // 定时用本机时区报给 DS —— 写死 Asia/Shanghai 的话,编辑器的预览按本地算、
    // 实际却跑在另一个时区,两边对不上还没人提示
    {
      calls.length = 0;
      serve((request) => request.url.includes('/schedules') && request.method === 'GET'
        ? envelope({ totalList: [{ processDefinitionCode: '9', crontab: '0 0 9 * * ? *', releaseState: 'OFFLINE', id: 5 }] })
        : envelope({}));
      /* 故意换一个绝不会是开发机的时区 —— 不这么做的话,代码里写死
         Asia/Shanghai 在我们自己机器上照样"通过",测了等于没测。 */
      const wasTZ = process.env.TZ;
      process.env.TZ = 'America/New_York';
      try {
        await ds.saveSchedule(conn, session, 'p1', '9', null, '0 0 9 * * ? *');
        const created = calls.find(c => c.method === 'POST' && c.url.endsWith('/schedules'));
        const sent = JSON.parse(decodeURIComponent(created.body.split('schedule=')[1].split('&')[0]).replace(/\+/g, ' '));
        assert.equal(sent.timezoneId, 'America/New_York', '时区要跟这台机器一致,不能写死 Asia/Shanghai');
      } finally { if (wasTZ === undefined) delete process.env.TZ; else process.env.TZ = wasTZ; }
      assert.ok(calls.some(c => c.url.endsWith('/schedule/5/online')), '新建完要把它打开');
    }

    // 新建了定时却找不到它 —— 界面写着"保存后会自动开启",这时必须报错,
    // 不能一声不吭留在关闭状态让用户以为在跑
    {
      serve((request) => request.url.includes('/schedules') && request.method === 'GET'
        ? envelope({ totalList: [] }) : envelope({}));
      await assert.rejects(() => ds.saveSchedule(conn, session, 'p1', '9', null, '0 0 9 * * ? *'),
        /没能.*开启|手动开启/, '找不到新建的定时要说话');
    }

    /* TLS 校验默认开着。Rust 端原来是无条件 danger_accept_invalid_certs(true),
       关掉的是**所有**请求的校验 —— 包括登录那一次,用户名和口令就在 body 里。
       自签证书是个别地址的情况,该由那个连接自己勾。 */
    {
      calls.length = 0;
      serve(() => envelope({ totalList: [] }));
      await ds.listProjects(conn, session);
      assert.notEqual(calls[0].allowInvalidCerts, true, '默认必须校验证书,不能替用户关掉');
      await ds.listProjects({ ...conn, allowInvalidCerts: true }, session);
      assert.equal(calls[1].allowInvalidCerts, true, '勾了的连接才放行');
      // 登录那一次也要带上(口令就在这一次的 body 里,最不能漏)
      calls.length = 0;
      globalThis.__HTTP__ = (_n, { request }) => { calls.push(request);
        return { status: 200, ok: true, body: JSON.stringify({ code: 0, data: { sessionId: 's' } }) }; };
      await ds.connect(conn);
      assert.notEqual(calls[0].allowInvalidCerts, true, '登录默认也要校验证书');
    }

    // DS 用 code≠0 表示失败,HTTP 还是 200 —— 不能当成功
    {
      serve(() => ({ status: 200, ok: true, body: JSON.stringify({ code: 10001, msg: '项目不存在' }) }));
      await assert.rejects(() => ds.listProjects(conn, session), /项目不存在/, 'code≠0 要抛错');
      serve(() => ({ status: 500, ok: false, body: '<html>502 Bad Gateway</html>' }));
      await assert.rejects(() => ds.listProjects(conn, session), /非 JSON/, '返回 HTML 要说清楚');
    }

    // 地址补 /dolphinscheduler,别补两遍
    {
      calls.length = 0;
      serve(() => envelope({ totalList: [] }));
      await ds.listProjects({ ...conn, baseUrl: 'http://ds.invalid:12345/dolphinscheduler/' }, session);
      assert.equal(calls[0].url.match(/dolphinscheduler/g).length, 1, '已经带了就别再补一遍');
    }
    delete globalThis.window;
  }

  for (const store of stores) store.dispose();
  console.log('Scheduler runtime checks passed: injected dependencies, request ownership, A-B-A navigation, stale failures/stats/tasks/logs, refresh queue, mutation locks, connection removal, timers and definition publication guards, cron round-trip and monthly skip, DolphinScheduler paging/timezone/envelope/TLS.');
} finally { rmSync(directory, { recursive: true, force: true }); }
