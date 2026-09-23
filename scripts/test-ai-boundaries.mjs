import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const directory = mkdtempSync(join(tmpdir(), 'sonde-ai-'));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
try {
  const bundle = join(directory, 'tests.cjs');
  buildSync({ stdin: { contents: `export * from './src/features/ai/aiConfigModel';
    export * from './src/features/ai/aiConfigRepository';
    export * from './src/features/ai/aiRuntime';
    export * from './src/features/ai/modelDiscovery';
    export * from './src/features/agent/model/modelRouting';
    export * from './src/features/agent/model/analysisModels';
    export * from './src/lib/jsonStorage';`, resolveDir: resolve('.'), loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', outfile: bundle, logLevel: 'silent' });
  const values = new Map(); let failRead = false, failWrite = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => { if (failRead) throw Error('denied'); return values.get(key) ?? null; },
    setItem: (key, value) => { if (failWrite) throw Error('quota secret-key'); values.set(key, value); },
  } });
  const m = createRequire(import.meta.url)(bundle);
  const key = 'ai.config';
  const repo = m.createAiConfigRepository({ read: m.readStoredJson, write: m.writeStoredJson });
  // Legacy fields fill defaults, with independently owned nested objects and no readiness replay.
  values.set(key, JSON.stringify({ v: 1, provider: 'cloud', cloud: { model: 'deepseek-flash', apiKey: 'fixture-key' }, builtin: { ready: true }, agentRoles: { design: 'cloud' } }));
  const legacy = repo.load();
  assert.equal(legacy.cloud.model, 'deepseek-flash');
  assert.equal(legacy.cloud.apiKey, 'fixture-key');
  assert.equal(legacy.builtin.ready, false);
  assert.equal(legacy.thinkingEnabled, false);
  assert.equal(legacy.cloud.baseUrl, m.defaultAiConfig().cloud.baseUrl);
  const copy = repo.load(); copy.cloud.model = 'different';
  assert.equal(legacy.cloud.model, 'deepseek-flash');
  const custom = { ...legacy, local: { baseUrl: 'http://fixture.invalid/v1', model: 'custom-local' },
    designVision: { enabled: true, provider: 'cloud', model: 'custom-vision' },
    thinkingEnabled: true, includeSampleRows: true, agentRoles: { design: 'cloud', cheap: 'local' } };
  repo.save(custom);
  assert.deepEqual(repo.load(), custom);
  assert.equal(JSON.parse(values.get(key)).v, 2);
  assert.equal(m.defaultAiConfig().local.model, '');
  // Future/malformed records are retained, and attempted changes cannot overwrite them.
  for (const raw of ['{bad', 'null', '[]', JSON.stringify({ v: 99 }), JSON.stringify({ provider: 'mystery' }),
    JSON.stringify({ local: null }), JSON.stringify({ cloud: { apiKey: 7 } }), JSON.stringify({ includeSampleRows: 'false' }),
    JSON.stringify({ agentRoles: { review: 'mystery' } }), JSON.stringify({ agentRoles: { futureRole: 'cloud' } }),
    JSON.stringify({ designVision: { enabled: true, model: 'vision' } }), JSON.stringify({ cloud: { futureAuth: 'secret' } })]) {
    values.set(key, raw);
    const store = m.createAiStore(repo);
    assert.equal(store.getState().config.provider, 'builtin');
    const before = store.getState().config;
    assert.equal(store.getState().setProvider('cloud'), false);
    assert.strictEqual(store.getState().config, before);
    assert.equal(values.get(key), raw);
    assert(m.getStorageProblems().some(problem => problem.key === key && problem.kind === 'read'));
    assert(!store.getState().configError.includes('secret'));
  }
  values.set(key, JSON.stringify(m.savedAiConfig(custom))); repo.load();
  assert(!m.getStorageProblems().some(problem => problem.key === key));
  failRead = true;
  const blocked = m.createAiStore(repo);
  failRead = false;
  assert.equal(blocked.getState().updateCloud({ model: 'other' }), false);
  assert.equal(JSON.parse(values.get(key)).cloud.model, 'deepseek-flash');
  repo.load();
  // Saving failure must not change provider, endpoint, key, role choice, or prompt privacy flags.
  const store = m.createAiStore(repo), second = m.createAiStore(repo);
  const before = store.getState().config, raw = values.get(key);
  failWrite = true;
  for (const update of [() => store.getState().setProvider('local'), () => store.getState().updateLocal({ model: 'new' }),
    () => store.getState().updateCloud({ apiKey: 'new-key' }), () => store.getState().update({ includeSampleRows: false, agentRoles: { design: 'builtin' } })]) {
    assert.equal(update(), false);
    assert.strictEqual(store.getState().config, before);
    assert.equal(values.get(key), raw);
    assert(!store.getState().configError.includes('secret-key'));
  }
  // Engine observations and UI events work even when settings storage is unavailable.
  store.getState().setBuiltinRuntime({ ...before.builtin, ready: true });
  assert.equal(store.getState().config.builtin.ready, true);
  assert.equal(values.get(key), raw);
  store.getState().seedAsk('question', 'entity'); store.getState().seedAsk('question');
  assert.equal(store.getState().seedNonce, 2);
  assert.equal(store.getState().focusEntity, 'entity');
  assert.equal(store.getState().consumeSeed(), 'question');
  assert.equal(store.getState().consumeSeed(), null);
  assert.equal(second.getState().seedQuestion, null);
  failWrite = false;
  assert.equal(store.getState().updateCloud({ model: 'chosen-model' }), true);
  assert.equal(store.getState().configError, null);
  assert.equal(store.getState().config.builtin.ready, true);
  assert.equal(JSON.parse(values.get(key)).builtin.ready, false);
  assert.equal(repo.load().builtin.ready, false);
  assert.equal(repo.load().cloud.model, 'chosen-model');
  assert.equal(second.getState().config.cloud.model, 'deepseek-flash');
  assert(!m.getStorageProblems().some(problem => problem.key === key));
  // Policy is independently usable with explicit snapshots, preserving existing economical defaults.
  const routed = { ...custom, agentRoles: undefined };
  assert.equal(m.providerFor('design', routed), 'cloud');
  assert.equal(m.providerFor('structured', routed), 'local');
  assert.equal(m.providerFor('design', { ...routed, agentRoles: { design: 'local' } }), 'local');
  assert.equal(m.bindingFor('design', routed).model, 'deepseek-flash');
  const selected = m.analysisModelConfig(routed, { provider: 'local', model: 'chosen-local' });
  for (const role of ['reasoning', 'design', 'review']) assert.equal(m.bindingFor(role, selected).model, 'chosen-local');
  assert.equal(routed.local.model, 'custom-local');
  assert.equal(m.bindingFor('design', m.analysisModelConfig(routed)).model, 'deepseek-flash');
  // Discovery owns its requests by endpoint and auth; no list or errors leak across visits.
  const calls = [];
  const discovery = m.createModelDiscovery((url, apiKey) => { const wait = deferred(); calls.push({ url, apiKey, ...wait }); return wait.promise; });
  const a = { provider: 'cloud', baseUrl: 'https://a.invalid', apiKey: 'old-key' };
  const b = { ...a, baseUrl: 'https://b.invalid' };
  discovery.getState().setTarget(a);
  const first = discovery.getState().load();
  await discovery.getState().load(); assert.equal(calls.length, 1, 'duplicate reads coalesce');
  discovery.getState().setTarget(b); const secondRead = discovery.getState().load();
  discovery.getState().setTarget(a); const third = discovery.getState().load();
  calls[2].resolve(['new-a', 'new-a', '']); await third;
  calls[0].resolve(['old-a']); calls[1].reject(Error('secret-key'));
  await Promise.all([first, secondRead]);
  assert.deepEqual(discovery.getState().models, ['new-a']);
  assert.equal(discovery.getState().error, null);
  const newAuth = { ...a, apiKey: 'new-key' };
  discovery.getState().setTarget(newAuth);
  assert.deepEqual(discovery.getState().models, []);
  assert.equal(discovery.getState().loaded, false);
  const fourth = discovery.getState().load();
  assert.equal(calls[3].apiKey, 'new-key');
  calls[3].reject(Error('server leaked new-key')); await fourth;
  assert(discovery.getState().error);
  assert(!discovery.getState().error.includes('new-key'));
  const fifth = discovery.getState().load(); discovery.getState().dispose();
  calls[4].resolve(['after-close']); await fifth;
  assert.equal(discovery.getState().loading, false); assert.deepEqual(discovery.getState().models, []);
  discovery.getState().setTarget(b); const sixth = discovery.getState().load();
  calls[5].resolve([]); await sixth;
  assert.equal(discovery.getState().loaded, true); assert.equal(discovery.getState().error, null);
  const seventh = discovery.getState().load(); calls[6].resolve([{ wrong: true }]); await seventh;
  assert(discovery.getState().error); assert.equal(discovery.getState().loaded, false);
  discovery.getState().dispose();
  console.log('AI boundaries passed: legacy/invalid/future settings, save failures, independent runtime/readiness, explicit routing, endpoint/auth request ownership and closure. No model inference or user configuration accessed.');
} finally { rmSync(directory, { recursive: true, force: true }); }
