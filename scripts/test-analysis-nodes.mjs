import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-nodes-'));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const ok = data => ({ ok: true, data, audit: { tool: 'fixture', ms: 1 } });
const modelOk = data => ({ ok: true, data, attempts: 1, ms: 1, promptTokens: 2, completionTokens: 3, mode: 'prompt' });
try {
  const outfile = join(dir, 'test.cjs');
  const modules = ['factCalculator', 'nodes/dataNodes', 'nodes/analysisNode', 'nodes/layoutDesigner', 'nodes/dashboardReviewer', 'nodes/dashboardCompiler', 'nodes/observations'];
  const bundle = buildSync({ stdin: { contents: modules.map(name => `export * from './src/features/agent/${name}';`).join('\n'), resolveDir: resolve('.'), loader: 'ts' },
    outfile, bundle: true, platform: 'node', format: 'cjs', metafile: true, logLevel: 'silent' });
  assert(!Object.keys(bundle.metafile.inputs).some(path => /Store\.ts|tools\/|model\/structured|@tauri|react|zustand/.test(path)), 'nodes must load without platform, stores, tool registry or model transport');
  const m = createRequire(import.meta.url)(outfile);
  const range = { start: '2026-08-01', end: '2026-08-31' };
  const metric = { metricId: 'revenue', name: 'Revenue', unit: '$', rollup: 'sum', supportedDimensions: ['month', 'region', 'category'], caliber: 'sum', dateScoped: true, sourceTables: ['sales'] };
  const result = (dimensions, rows, field = 'value') => ({ columns: [...dimensions, field].map(name => ({ name, dataType: 'fixture' })), rows, rowCount: rows.length, elapsedMs: 1 });
  const plan = (dimensions, rows, id = 'revenue', rollup = 'sum') => ({ metricIds: [id], shape: { dimensions, metrics: [{ field: 'value', name: id, unit: '$', rollup }] }, result: result(dimensions, rows) });
  const plans = new Map([['shared', plan(['region'], [['east', 10], ['west', 20]])]]);
  const read = id => plans.get(id);
  const state = { workflowId: 'run-A', userRequest: 'Review inventory', status: 'running', retry: {}, trace: [], errors: [], usage: [],
    scope: { label: 'August', dateRange: range, comparisonRanges: [], filters: [{ field: 'region', values: ['east'] }] },
    validatedMetrics: [metric], plans: [{ planId: 'shared', role: 'primary', dateRange: range }], supportingPlans: [] };
  const item = (overrides = {}) => ({ title: 'Revenue', type: 'bar', band: 'ranking', metricIds: ['revenue'], dimensions: ['region'], width: 'half', reason: 'Compare regions', ...overrides });
  const layout = items => ({ title: 'Inventory', theme: 'Compare', preset: 'editorial', items });
  const config = { provider: 'fixture', model: 'chosen-model' };
  const original = structuredClone(state);

  // Independent observations may reuse plan IDs; labels come from their own catalog.
  const a = m.computeFacts(state, read, id => `A:${id}`);
  const otherRead = () => plan(['region'], [['north', 40], ['south', 60]]);
  const b = m.computeFacts(state, otherRead, id => `B:${id}`);
  assert.equal(a[0].rows[0][1], 30); assert.equal(b[0].rows[0][1], 100);
  assert(a.some(f => f.text.includes('A:region'))); assert(b.some(f => f.text.includes('B:region')));
  assert(!a.some(f => f.text.includes('B:region')));
  const ratePlan = plan(['region'], [['east', 10], ['west', 90]], 'rate', 'avg');
  assert(!m.computeFacts(state, () => ratePlan, id => id).some(f => f.computedBy === 'avg(value)'), 'group averages cannot become an overall average');
  ratePlan.totalResult = result([], [[70]]);
  assert.equal(m.computeFacts(state, () => ratePlan, id => id)[0].rows[0][1], 70, 'exact totals win over grouped averages');
  assert.deepEqual(state, original);

  const tools = [];
  const data = m.createDataNodes({ getPlan: read, dimensionLabel: id => `Label:${id}`, callTool: async (name, input, workflowId) => {
    tools.push({ name, input: structuredClone(input), workflowId });
    if (name === 'build_query_plan') return ok({ planId: `p${tools.length}` });
    if (name === 'execute_query_plan') return ok({ rowCount: 0 });
    if (name === 'diagnose_empty_result') return ok({ verdict: 'filtered-out', message: 'No matching region' });
    return ok({ issues: [{ level: 'warn', code: 'GAP', message: 'Missing observation' }] });
  } });
  const lockedParams = { metricIds: ['revenue'], dimensions: ['month', 'region'], dateRange: range, comparisons: ['mom'], filters: state.scope.filters };
  const built = await data.lockedPlanner({ ...state, locked: true, lockedParams });
  assert.equal(built.plans.length, 2); assert.equal(built.supportingPlans.length, 0);
  assert.deepEqual(tools[0].input.dimensions, lockedParams.dimensions); assert.deepEqual(tools[0].input.filters, lockedParams.filters);
  assert.deepEqual(tools[1].input.dateRange, { start: '2026-07-01', end: '2026-07-31' });
  assert(tools.every(call => call.workflowId === 'run-A'));
  const executed = await data.dataExecutor(state);
  assert(executed.dropped[0].includes('No matching region'));
  const validated = await data.dataValidator(state);
  assert.equal(validated.validation.status, 'warn'); assert(validated.validation.issues[0].message.startsWith('本期'));

  // Cancellation during the last awaited tool must not publish a successful node result.
  for (const [method, name] of [['lockedPlanner', 'build_query_plan'], ['dataValidator', 'validate_dataset'], ['dataExecutor', 'diagnose_empty_result']]) {
    const pending = deferred(), started = deferred(), controller = new AbortController();
    const node = m.createDataNodes({ getPlan: read, dimensionLabel: id => id, callTool: async tool => {
      if (tool === name) { started.resolve(); return pending.promise; }
      return ok({ rowCount: 0 });
    } })[method];
    const running = node({ ...state, lockedParams: { ...lockedParams, comparisons: [] } }, { signal: controller.signal });
    await started.promise; controller.abort(); pending.resolve(ok({ planId: 'late', rowCount: 1, issues: [], verdict: 'filtered-out', message: 'late' }));
    await assert.rejects(running, error => error.name === 'AbortError');
  }
  const timeout = m.createDataNodes({ getPlan: id => plan([id === 'detail' ? 'category' : 'region'], [['x', 1]]), dimensionLabel: id => id,
    callTool: async (name, input) => input.planId === 'detail' ? { ok: false, error: { message: 'timed out after 9 seconds' } } : ok({ rowCount: 1 }) });
  await assert.rejects(timeout.dataExecutor({ ...state, supportingPlans: [{ planId: 'detail', dimensions: ['category'] }] }), error => error.message.includes('category') && !error.message.includes('按region'));

  // Reasoning cannot import a fact from another observation repository or invent an evidence ID.
  const calls = [];
  const reasoning = m.createAnalysisNode({ getPlan: read, dimensionLabel: id => id, callStructured: async (call, selected) => {
    calls.push({ call, selected });
    return modelOk({ summary: '30 total', findings: [{ headline: '30 total', factId: 'F1', severity: 'info' }, { headline: '999 invented', factId: 'missing', severity: 'warn' }] });
  } });
  const report = await reasoning(state, { modelConfig: config });
  assert.equal(report.insights.length, 1); assert.equal(report.insights[0].evidence.rows[0][1], 30);
  assert.equal(calls[0].selected, config); assert.equal(calls[0].call.role, 'reasoning'); assert.equal(report.usage[0].completionTokens, 3);
  assert(!report.report.includes('999 invented')); assert(report.report.includes('丢弃了 1'));

  const designCalls = [];
  const designer = m.createLayoutDesigner({ getPlan: read, callStructured: async (call, selected) => {
    designCalls.push({ call, selected }); return modelOk(layout([item({ type: 'pie', band: 'structure', chart: { pieHole: 20 } })]));
  } });
  const designed = await designer.layoutDesigner(state, { modelConfig: config });
  assert.equal(designed.layout.items[0].chart.pieHole, 20, 'custom donut radius survives');
  assert.equal(designCalls[0].selected, config); assert(designCalls[0].call.system.includes('pieHole'));
  assert.equal(designer.designDataViews(state)[0].dimensions[0].count, 2);
  const invalidDesigner = m.createLayoutDesigner({ getPlan: read, callStructured: async () => modelOk(layout([item({ metricIds: ['invented'] })])) });
  assert((await invalidDesigner.layoutDesigner(state)).designBindingErrors.some(error => error.includes('invented')));

  // Removing a duplicate ahead of a differently-sized KPI must not apply the old index's magnitude.
  const big = plan([], [[200000000]], 'big'), small = plan([], [[50]], 'small');
  const reviewPlans = new Map([['big', big], ['small', small]]);
  const reviewState = { ...state, validatedMetrics: [{ ...metric, metricId: 'big' }, { ...metric, metricId: 'small' }], plans: [
    { planId: 'big', role: 'primary', dateRange: range }, { planId: 'small', role: 'mom', dateRange: range }],
    layout: layout([item({ type: 'kpi', band: 'kpi', metricIds: ['big'], dimensions: [] }), item({ type: 'kpi', band: 'kpi', metricIds: ['big'], dimensions: [] }),
      item({ type: 'kpi', band: 'kpi', metricIds: ['small'], dimensions: [], title: 'Small' })]) };
  const review = m.createDashboardReviewer({ getPlan: id => reviewPlans.get(id), callStructured: async () => modelOk({ verdict: 'pass', findings: [] }) });
  const reviewed = await review(reviewState, { modelConfig: config });
  assert.equal(reviewed.layout.items.length, 2);
  assert.notEqual(reviewed.layout.items.find(card => card.metricIds[0] === 'small').scale, 'yi');
  assert.notEqual(reviewed.layout.items.find(card => card.metricIds[0] === 'small').scale, 'wan');
  assert(!reviewed.review.findings.some(f => f.code === 'WRONG_SCALE'));
  // A model saying pass cannot override deterministic invalidity.
  const emptyReview = await review({ ...reviewState, layout: layout([]) });
  assert.equal(emptyReview.review.verdict, 'needs_revision'); assert(emptyReview.review.findings.some(f => f.code === 'EMPTY'));

  for (const factory of [m.createAnalysisNode, ports => m.createLayoutDesigner(ports).layoutDesigner, m.createDashboardReviewer]) {
    const pending = deferred(), started = deferred(), controller = new AbortController();
    const node = factory({ getPlan: read, dimensionLabel: id => id, callStructured: async () => { started.resolve(); return pending.promise; } });
    const running = node({ ...state, layout: layout([item()]) }, { signal: controller.signal });
    await started.promise; controller.abort(); pending.resolve({ ok: false, errors: ['late'] });
    await assert.rejects(running, error => error.name === 'AbortError');
  }

  // Preview compilation is a draft transaction; each instance owns only the draft it created.
  const compilerFixture = (tag, intercept = async () => {}) => {
    const log = [], discarded = []; let widget = 0;
    const compiler = m.createDashboardCompiler({ getPlan: read, describeModel: selected => selected.model, discardDraft: id => discarded.push(id),
      callTool: async (name, input, workflowId) => {
        log.push({ name, input, workflowId }); await intercept(name);
        return ok(name === 'create_dashboard' ? { dashboardId: tag } : name === 'add_component' ? { widgetId: `${tag}-w${++widget}` } : { dashboardId: tag });
      } });
    return { ...compiler, log, discarded };
  };
  plans.set('detail', plan(['category'], [['a', 1], ['b', 2], ['c', 3]]));
  const compilerState = { ...state, supportingPlans: [{ planId: 'detail', dimensions: ['category'] }], layout: layout([item({ dimensions: ['category'], chart: { pieHole: 25 } })]) };
  const preview = compilerFixture('draft-A');
  assert.equal((await preview.compileDashboard(compilerState, { modelConfig: config })).candidateDashboardId, 'draft-A');
  assert(!preview.log.some(call => call.name === 'save_dashboard'));
  assert.equal(preview.log.find(call => call.name === 'style_component').input.chart.showLabels, true, 'labels use the supporting plan bound to this card');
  assert.equal(preview.log.find(call => call.name === 'style_component').input.chart.pieHole, 25);
  assert.deepEqual(preview.log.find(call => call.name === 'set_dashboard_scope').input.filters, state.scope.filters);
  assert.equal(preview.log.find(call => call.name === 'set_dashboard_provenance').input.model, 'chosen-model');
  assert(preview.log.every(call => call.workflowId === 'run-A'));
  const broken = compilerFixture('draft-B', async name => { if (name === 'style_component') throw Error('style failed'); });
  await assert.rejects(broken.compileDashboard(compilerState, { modelConfig: config }), /style failed/);
  assert.deepEqual(broken.discarded, ['draft-B']); assert.deepEqual(preview.discarded, []);
  assert(!broken.log.some(call => call.name === 'save_dashboard'));

  for (const step of ['create_dashboard', 'set_dashboard_provenance', 'save_dashboard']) {
    const controller = new AbortController();
    const instance = compilerFixture(`cancel-${step}`, async name => { if (name === step) controller.abort(); });
    const running = instance.compileDashboard(compilerState, { modelConfig: config, signal: controller.signal }, step === 'save_dashboard');
    if (step === 'save_dashboard') {
      assert.equal((await running).dashboardId, `cancel-${step}`, 'completed save must return its durable receipt');
      assert.deepEqual(instance.discarded, []);
    } else {
      await assert.rejects(running, error => error.name === 'AbortError');
      assert.deepEqual(instance.discarded, [`cancel-${step}`]);
      assert(!instance.log.some(call => call.name === 'save_dashboard'));
    }
  }
  // Series count includes secondary metrics; 3 categories can still be too dense for automatic labels.
  const densePlan = plan(['region', 'category'], Array.from({ length: 15 }, (_, n) => [`r${n % 3}`, `s${Math.floor(n / 3)}`, 1]));
  const denseItem = item({ dimensions: ['region'], seriesDimension: 'category' });
  assert.equal(m.observedCounts(denseItem, densePlan).points, 15);
  assert.equal(m.planForItem(item({ secondaryMetricIds: ['unknown'] }), [plans.get('shared')]), undefined);
  assert.deepEqual(state, original, 'nodes leave their input state unchanged');
  console.log('Analysis node checks passed: isolated imports and observations, exact fact totals, supplied parameters, cancellation, evidence/binding gates, review reindexing, per-card data, draft cleanup and durable save receipts.');
} finally { rmSync(dir, { recursive: true, force: true }); }
