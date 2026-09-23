import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'sonde-ops-'));
const require = createRequire(import.meta.url);
const opsKey = 'sonde.lineageOps.v1', edgeKey = 'sonde.lineage.v1';
const now = Date.parse('2026-09-15T12:00:00Z');
try {
  const bundle = join(dir, 'tests.cjs');
  buildSync({ stdin: { contents: [
    'features/lineage/opsModel', 'features/lineage/opsRepository', 'features/lineage/schedulerOpsAdapter',
    'features/lineage/graphModel', 'features/lineage/lineageModel', 'features/scheduler/dolphinRunState',
  ].map(path => `export * from './src/${path}';`).join('\n') + `
    export { useOps } from './src/features/lineage/opsStore';
    export { useLineage } from './src/features/lineage/lineageStore';
    export { useScheduler } from './src/features/scheduler/schedulerStore';
    export { useEtl } from './src/features/etl/etlStore';
    export { getStorageProblems } from './src/lib/jsonStorage';
  `, resolveDir: resolve('.'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
  function fixture(initial = []) {
    const values = new Map(initial);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    delete require.cache[require.resolve(bundle)];
    return { m: require(bundle), values, storage };
  }
  const health = { state: 'ok', lastRun: '2026-09-01T00:00:00Z', checkedAt: now };
  const old = { ops: { 'mart.a': { origin: 'manual', owner: 'Owner', schedule: 'weekly' } }, health: { 'mart.a': health } };
  // Existing partial records normalize, but invalid entries and unknown versions are protected.
  for (const initial of [{}, { ops: old.ops }, { health: old.health }, old]) {
    const { m } = fixture([[opsKey, JSON.stringify(initial)]]);
    assert.deepEqual(m.opsRepository.load(), { ops: initial.ops ?? {}, health: initial.health ?? {} });
  }
  for (const raw of ['{bad', 'null', '{"version":2}', '{"ops":[]}', '{"health":{"t":{"state":"ok"}}}',
    '{"ops":{"t":{"origin":"manual","freshnessHours":-1}}}', '{"ops":{"t":{"origin":["etl"]}}}']) {
    const { m, values } = fixture([[opsKey, raw]]);
    assert.deepEqual(m.opsRepository.load(), { ops: {}, health: {} });
    assert.throws(() => m.opsRepository.save(old), /阻止覆盖/);
    assert.equal(values.get(opsKey), raw);
    values.set(opsKey, JSON.stringify(old));
    assert.deepEqual(m.opsRepository.load(), old);
    m.opsRepository.save(old);
    assert(!m.getStorageProblems().some(issue => issue.key === opsKey));
  }
  {
    const { m } = fixture();
    const prior = { ops: {
      a: { origin: 'scheduler', scope: 'a' }, b: { origin: 'scheduler', scope: 'b' },
      legacy: { origin: 'scheduler' }, manual: { origin: 'manual', owner: 'Keep', freshnessHours: 168 },
    }, health: { a: { ...health, scope: 'a' }, b: { ...health, scope: 'b' }, legacy: health, manual: { ...health, scope: 'a' } } };
    const before = JSON.stringify(prior);
    const next = m.applyOpsSnapshot(prior, { scope: 'a', nodes: { manual: { ops: { origin: 'scheduler' } } } });
    assert.equal(next.ops.a, undefined);
    assert.equal(next.health.a, undefined);
    assert.strictEqual(next.ops.b, prior.ops.b);
    assert.strictEqual(next.health.b, prior.health.b);
    assert.strictEqual(next.ops.legacy, prior.ops.legacy);
    assert.strictEqual(next.ops.manual, prior.ops.manual);
    assert.equal(next.health.manual, undefined, 'manual owner does not retain stale health from a previous run');
    assert.equal(JSON.stringify(prior), before);
    const legacyMatch = m.applyOpsSnapshot(prior, { scope: 'new', nodes: { legacy: { ops: { origin: 'scheduler' } } } });
    assert.equal(legacyMatch.ops.legacy.scope, 'new');
    assert.equal(legacyMatch.health.legacy, undefined);
    assert.equal(m.dolphinRunState('SUBMITTED_SUCCESS'), 'running');
    assert.equal(m.dolphinRunState('SUCCESS'), 'ok');
    assert.equal(m.dolphinRunState('NOT_SUCCESS'), 'unknown');
    assert.equal(m.dolphinRunState('FAILURE'), 'error');
    assert.equal(m.dolphinRunState('WAITING_THREAD'), 'running');
  }
  {
    const { m, storage } = fixture([[opsKey, JSON.stringify(old)]]);
    const write = storage.setItem;
    storage.setItem = () => { throw Error('quota'); };
    assert.equal(m.useOps.getState().setManual('mart.a', { owner: 'Unsaved' }), false);
    assert.deepEqual(m.useOps.getState().ops, old.ops);
    assert.equal(m.useOps.getState().clearNode('mart.a'), false);
    assert.deepEqual(m.useOps.getState().health, old.health);
    assert.match(m.useOps.getState().syncMsg, /保存失败/);
    storage.setItem = write;
    assert.equal(m.useOps.getState().setManual('mart.a', { freshnessHours: 168 }), true);
    assert.equal(m.useOps.getState().ops['mart.a'].freshnessHours, 168);
    assert.equal(m.useOps.getState().syncMsg, null);
  }
  {
    const { m, storage } = fixture([[opsKey, JSON.stringify(old)]]);
    const edge = { from: 'erp.a', to: 'mart.a', source: 'sql', kind: '派生' };
    m.useLineage.setState({ scanned: [edge] });
    const write = storage.setItem;
    storage.setItem = (key, value) => { if (key === opsKey) throw Error('quota'); write(key, value); };
    m.useLineage.getState().forgetNode('mart.a');
    assert.deepEqual(m.useLineage.getState().scanned, [], 'successfully persisted edge cleanup is reflected');
    assert.deepEqual(m.useOps.getState().ops, old.ops, 'failed annotation cleanup retains annotations');
    assert.match(m.useLineage.getState().lastMsg, /运行记录清理失败/);
    storage.setItem = write;
    m.useLineage.getState().forgetNode('mart.a');
    assert.equal(m.useOps.getState().ops['mart.a'], undefined);
  }
  {
    const { m } = fixture();
    const job = (id, project, table) => ({ id, name: id, kind: 'generic', sources: [], targets: [{ kind: 'db', database: 'mart', table }],
      scheduler: { baseUrl: 'https://fixture', projectCode: project, workflowCode: 'wf', workflowName: 'Workflow', taskCode: id, upstreamTaskCodes: [] } });
    const a = job('a', 'A', 'a'), b = job('b', 'B', 'b');
    const sources = [{ id: 'fixture', name: 'Fixture', kind: 'generic', jobs: [a, b], updatedAt: 0 }];
    const graph = m.buildLineageGraph([], sources, []);
    const observation = { connection: { baseUrl: 'https://fixture/', kind: 'dolphinscheduler' }, projectCode: 'A',
      workflows: [{ code: 'wf', name: 'Workflow', online: true, scheduled: true, crontab: 'weekly' }],
      instances: [{ id: 1, workflowCode: 'wf', state: 'SUCCESS', startTime: '2026-09-15T00:00:00Z' },
        { id: 2, workflowCode: 'wf', state: 'SUBMITTED_SUCCESS', startTime: '2026-09-15T01:00:00Z' }],
      tasks: [{ id: 1, instanceId: 1, taskCode: 'a', state: 'SUCCESS' }] };
    const snapshot = m.schedulerOpsSnapshot(observation, sources, graph, now, m.dolphinRunState);
    assert.equal(snapshot.nodes[m.workflowNodeId(a)].health.state, 'running');
    assert.equal(snapshot.nodes[m.taskNodeId(a)].health, undefined, 'old task success does not belong to the new workflow run');
    assert.equal(snapshot.nodes['mart.b'], undefined);
    const generic = m.schedulerOpsSnapshot({ ...observation, connection: { ...observation.connection, kind: 'other' } }, sources, graph, now);
    assert.equal(generic.nodes[m.workflowNodeId(a)].health.state, 'unknown', 'unimplemented engines do not inherit DolphinScheduler vocabulary');
    const distinct = m.schedulerScope({ ...observation, projectCode: 'B' });
    assert.notEqual(snapshot.scope, distinct);
    const dedupSources = [{ ...sources[0], jobs: [a, { ...a, targets: [...a.targets, ...a.targets] }] }];
    const ready = { ...observation, tasks: [{ id: 3, instanceId: 2, taskCode: 'a', state: 'SUCCESS' }] };
    assert.equal(m.schedulerOpsSnapshot(ready, dedupSources, graph, now, m.dolphinRunState).nodes['mart.a'].health.state, 'ok');
    const sharedSources = [{ ...sources[0], jobs: [a, { ...b, targets: a.targets }] }];
    const shared = m.schedulerOpsSnapshot(ready, sharedSources, graph, now, m.dolphinRunState);
    assert.equal(shared.nodes['mart.a'].health, undefined);
    assert.match(shared.nodes['mart.a'].ops.note, /多个生产任务/);
    const sharedPrevious = { ops: { 'mart.a': { origin: 'scheduler', scope: distinct } }, health: { 'mart.a': { ...health, scope: distinct } } };
    assert.equal(m.applyOpsSnapshot(sharedPrevious, shared).health['mart.a'], undefined, 'ambiguous shared node cannot retain a false green status');
    m.useEtl.setState({ sources });
    const conn = { id: 'c', name: 'Fixture', ...observation.connection };
    m.useScheduler.setState({ conns: [conn], activeId: conn.id, projectCode: 'A', status: { c: 'connected' },
      workflows: ready.workflows, instances: ready.instances, recentTasks: ready.tasks, dataLoading: false, dataError: undefined });
    assert(m.useOps.getState().syncFromScheduler(graph) > 0);
    assert.equal(m.useOps.getState().health['mart.a'].state, 'ok');
    const state = m.useOps.getState().health;
    m.useScheduler.setState({ dataLoading: true, workflows: [] });
    assert.equal(m.useOps.getState().syncFromScheduler(graph), 0);
    assert.strictEqual(m.useOps.getState().health, state, 'loading is not evidence of an empty project');
    m.useScheduler.setState({ dataLoading: false });
    m.useOps.getState().syncFromScheduler(graph);
    assert.equal(m.useOps.getState().health['mart.a'], undefined, 'completed empty project removes only scoped observations');
    const etlSources = [{ ...sources[0], jobs: [{ ...a, schedule: 'weekly' }, { ...b, targets: a.targets, schedule: 'monthly' }] }];
    const inferred = m.inferEtlOps({ ops: {}, health: {} }, etlSources, graph);
    assert.equal(inferred.records.ops['mart.a'].schedule, undefined);
    assert.match(inferred.records.ops['mart.a'].note, /调度不同/);
    const manual = m.inferEtlOps(old, etlSources, graph);
    assert.strictEqual(manual.records.ops['mart.a'], old.ops['mart.a']);
    assert.equal(m.inspectOps(graph, old, now).some(finding => finding.code === 'stale'), false);
    const policy = { ...old, ops: { 'mart.a': { ...old.ops['mart.a'], freshnessHours: 168 } } };
    assert(m.inspectOps(graph, policy, now).some(finding => finding.code === 'stale'));
    assert.equal(m.inspectOps(graph, policy, Date.parse('2026-09-02T00:00:00Z')).some(finding => finding.code === 'stale'), false);
  }
  {
    const { m } = fixture([[opsKey, JSON.stringify(old)], ['sonde.etlSources.v1', '{bad']]);
    const graph = m.buildLineageGraph([], [], []);
    assert.equal(m.useOps.getState().syncFromEtl(graph), 0);
    assert.deepEqual(m.useOps.getState().ops, old.ops);
    assert.match(m.useOps.getState().syncMsg, /阻止覆盖/);
  }
  console.log('Ops boundary checks passed: compatible persistence, failure retention, scoped observations, provider states, stale run isolation, ambiguous producers and explicit freshness rules.');
} finally { rmSync(dir, { recursive: true, force: true }); }
