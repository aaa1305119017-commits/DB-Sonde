import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const dir = mkdtempSync(join(tmpdir(), 'sonde-query-runtime-'));
const later = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { resolve, promise }; };
const tick = () => new Promise(r => setImmediate(r));
const result = n => ({ columns: [{ name: 'value', dataType: 'INT' }], rows: [[n]], elapsedMs: 1 });
try {
  const outfile = join(dir, 'test.cjs');
  const files = ['src/lib/queryGate.ts', 'src/features/dashboard/queryRuntime.ts', 'src/features/agent/tools/dataToolRuntime.ts', 'src/features/agent/tools/toolRegistry.ts', 'src/features/agent/previewData.ts', 'src/features/agent/model/httpRetry.ts'];
  const build = buildSync({ stdin: { contents: files.map(f => `export * from './${f}';`).join('\n'), resolveDir: resolve('.'), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', metafile: true, logLevel: 'silent' });
  assert(!Object.keys(build.metafile.inputs).some(f => /Store\.ts|\/lib\/api.ts|@tauri|react|zustand/.test(f)));
  const m = createRequire(import.meta.url)(outfile);
  const gate = m.createQueryGate(2), holds = [later(), later()], order = []; let active = 0, peak = 0;
  const operation = (id, hold) => gate(async () => { order.push(id); peak = Math.max(peak, ++active); if (hold) await hold.promise; active--; return id; });
  const a = operation('a', holds[0]), b = operation('b', holds[1]); await tick();
  const cancel = new AbortController(); const cancelled = gate(async () => { throw Error('cancelled request ran'); }, cancel.signal);
  const rejected = assert.rejects(cancelled, e => e.name === 'AbortError'); cancel.abort(); await rejected;
  const c = operation('c'); holds[0].resolve(); const d = operation('d'); holds[1].resolve();
  await Promise.all([a,b,c,d]); assert.equal(peak, 2); assert.deepEqual(order, ['a','b','c','d']);
  await assert.rejects(gate(async () => { throw Error('backend'); }), /backend/); assert.equal(await operation('after'), 'after');
  assert.throws(() => m.createQueryGate(0));
  const calls = [], pending = []; let now = 0;
  const ports = { readCatalog: () => [], dialectFor: () => 'mysql', now: () => now,
    readQuery: async (...args) => { calls.push(args); const deferred = later(); pending.push(deferred); return deferred.promise; } };
  const cache = m.createDatasetQueryRuntime(ports), other = m.createDatasetQueryRuntime(ports);
  const dataset = { id: 'd', connectionId: 'A', sql: 'SELECT 1' }; const read = runtime => runtime.executeDataset(dataset, x => x);
  const first = read(cache), joined = read(cache); await tick(); assert.equal(calls.length, 1);
  cache.clearQueryCache(); const fresh = read(cache); await tick(); assert.equal(calls.length, 2);
  pending[0].resolve(result(1)); assert.equal((await first).rows[0][0], 1); await joined;
  const stillJoined = read(cache); await tick(); assert.equal(calls.length, 2, 'old completion cannot delete newer in-flight request');
  pending[1].resolve(result(2)); const freshRows = await fresh; await stillJoined; freshRows.rows[0][0] = 99;
  assert.equal((await read(cache)).rows[0][0], 2, 'consumers cannot mutate cached rows');
  const isolated = read(other); await tick(); assert.equal(calls.length, 3); pending[2].resolve(result(3)); await isolated;
  now = 300001; const expired = read(cache); await tick(); pending[3].resolve(result(4)); await expired;
  cache.clearQueryCache(); const late = read(cache), lateRejected = assert.rejects(late, e => e.name === 'AbortError'); await tick(); cache.dispose();
  pending[4].resolve(result(5)); await lateRejected; await assert.rejects(read(cache), e => e.name === 'AbortError');
  now = 0; assert.equal((await read(other)).rows[0][0], 3, 'disposing one runtime cannot clear another'); // other timestamp expired too
  const metric = { id: 'sales', key: 'sales', name: 'Sales', unit: '$', enabled: true, type: 'measure', connId: 'A', database: 'mart', source: 'events', expression: 'SUM(amount)', timeField: 'day', dimensions: ['region'] };
  const input = { metricIds: ['sales'], dimensions: ['region'], dateRange: { start: '2026-08-01', end: '2026-08-31' } };
  const reads = [];
  const dataPorts = { readCatalog: () => [metric], nextId: () => 'same-id', today: () => '2026-09-15', fastDimensionValues: async () => null,
    executeDataset: async (...args) => { reads.push(args); return result(10); } };
  const data = m.createDataToolRuntime(dataPorts), secondData = m.createDataToolRuntime(dataPorts);
  const audit = [], registry = m.createToolRegistry({ recordTool: (...args) => audit.push(args) }); data.tools.forEach(t => registry.registerTool(t));
  assert.equal((await registry.callTool('missing', {})).error.code, 'NOT_FOUND');
  assert.equal((await registry.callTool('build_query_plan', {})).error.code, 'INVALID_ARGS');
  const plan = data.buildQueryPlan(input); metric.expression = 'SUM(new_amount)';
  await registry.callTool('execute_query_plan', { planId: plan.planId }, 'workflow-A');
  assert.equal(reads[0][5][0].expression, 'SUM(amount)', 'execution uses the plan catalog');
  assert.equal(secondData.getPlan(plan.planId), undefined); secondData.buildQueryPlan(input);
  assert.equal(secondData.getPlan(plan.planId).catalog[0].expression, 'SUM(new_amount)');
  data.dispose(); assert.equal(data.getPlan(plan.planId), undefined); assert(secondData.getPlan(plan.planId));
  assert.equal((await registry.callTool('execute_query_plan', { planId: plan.planId })).error.code, 'INVALID_ARGS');
  assert(audit.some(a => a[0] === 'workflow-A' && a[1] === 'execute_query_plan' && a[3]));
  const requests = [];
  const racing = m.createDataToolRuntime({ ...dataPorts, executeDataset: () => { const q = later(); requests.push(q); return q.promise; } }); racing.buildQueryPlan(input);
  const r1 = racing.executeQueryPlanTool.run({ planId: 'same-id' }), stale = assert.rejects(r1, /忽略旧结果/);
  const r2 = racing.executeQueryPlanTool.run({ planId: 'same-id' }); requests[1].resolve(result(20)); await r2; requests[0].resolve(result(1)); await stale;
  assert.equal(racing.getPlan('same-id').result.rows[0][0], 20);
  const r3 = racing.executeQueryPlanTool.run({ planId: 'same-id' }), disposed = assert.rejects(r3, /会话已结束/); racing.dispose(); requests[2].resolve(result(30)); await disposed;
  const widget = { id: 'k', title: 'Sales', type: 'kpi', visible: true, datasetId: 'semantic:k', bindings: { metricIds: ['sales'], secondaryMetricIds: [], dimensions: [] }, options: { kpi: { showComparison: true } } };
  const document = { widgets: [widget], datasets: [], metrics: [], metricScope: { ...input.dateRange, filters: [{ field: 'region', kind: 'in', value: 'East' }] } };
  const state = { workflowId: 'preview-owner', scope: { comparisonRanges: [{ kind: 'mom' }] } };
  const previews = [];
  const previewPorts = { readCatalog: () => [metric], getPlan: () => ({ result: result(17) }), callTool: async (name, args, owner) => {
    previews.push({ name, args, owner }); return { ok: true, data: name === 'build_query_plan' ? { planId: 'preview-only' } : { issues: [] } };
  } };
  const rendered = await m.previewData(document, state, undefined, previewPorts);
  assert.equal(rendered.runtime.k.result.rows[0][0], 17); assert.equal(rendered.runtime.k.comparison.period.rows[0][0], 17);
  assert(previews.every(p => p.owner === 'preview-owner'));
  const built = previews.filter(p => p.name === 'build_query_plan'); assert.equal(built.length, 2);
  assert.deepEqual(built[0].args.filters, [{ field: 'region', values: ['East'] }]); assert.notDeepEqual(built[0].args.dateRange, built[1].args.dateRange);
  for (const stopAt of ['build_query_plan', 'execute_query_plan', 'validate_dataset']) {
    const controller = new AbortController(), names = [];
    await assert.rejects(m.previewData(document, state, controller.signal, { ...previewPorts, callTool: async (...args) => {
      names.push(args[0]); const output = await previewPorts.callTool(...args); if (args[0] === stopAt) controller.abort(); return output;
    } }), e => e.name === 'AbortError');
    assert.equal(names.at(-1), stopAt);
  }
  // Transport recovery is bounded across all repairs of one model call.
  const delays = [], retry = m.createHttpRetry({ wait: async ms => { delays.push(ms); }, random: () => 0 }); let attempts = 0;
  const success = await retry(async () => ++attempts < 3 ? new Response('internal_error', { status: 500 }) : new Response('{}'));
  assert(success.ok); assert.deepEqual(delays, [1000,2000]); assert.equal(attempts,3);
  await assert.rejects(retry(async () => new Response('again', { status: 503 })), /已自动重试 2 次/);
  for (const status of [400,401,403,404,422]) {
    let count = 0;
    await assert.rejects(m.createHttpRetry({ wait: async () => assert.fail('must not wait') })(async () => { count++; return new Response('invalid', { status }); }), e => e.status === status);
    assert.equal(count,1);
  }
  const after = []; let limited = 0;
  await m.createHttpRetry({ wait: async ms => after.push(ms), random: () => 0 })(async () => ++limited === 1 ? new Response('', {status:429, headers:{'retry-after':'4'}}) : new Response('{}'));
  assert.deepEqual(after,[4000]);
  await assert.rejects(m.createHttpRetry({wait: async () => assert.fail('long wait')})(async () => new Response('',{status:503,headers:{'retry-after':'60'}})), e => e.status===503);
  const ac = new AbortController(); let attemptsCancelled = 0;
  const cancelRetry = m.createHttpRetry({wait: async (_ms, signal) => { ac.abort(); signal.throwIfAborted(); }});
  await assert.rejects(cancelRetry(async () => { attemptsCancelled++; return new Response('',{status:500}); }, ac.signal), e => e.name==='AbortError'); assert.equal(attemptsCancelled,1);
  const waitAbort = new AbortController(), waiting = m.waitForRetry(30000, waitAbort.signal); waitAbort.abort(); await assert.rejects(waiting,e=>e.name==='AbortError');
  console.log('Query runtime: cache generations, independent plans, shared concurrency, cancellation, snapshots and HTTP recovery passed.');
} finally { rmSync(dir, { recursive: true, force: true }); }
