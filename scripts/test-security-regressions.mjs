import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const dir = mkdtempSync(join(tmpdir(), 'sonde-safety-'));
const pg = new PGlite();
try {
  const output = join(dir, 'fixture.cjs');
  await build({ stdin: { contents: [
    'features/datasets/service', 'features/datasets/domain', 'features/datasets/widgetQuery',
    'features/metrics/metricSql', 'lib/secureRepository', 'lib/tableEditing', 'lib/sql', 'lib/dates',
    'store/connectionsSlice', 'store/querySlice', 'features/ai/aiRuntime', 'features/ai/aiConfigModel',
  ].map(p => `export * from './src/${p}';`).join('\n'), resolveDir: resolve('.'), loader: 'ts' },
    outfile: output, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'isolated-api', setup(b) {
      b.onResolve({filter:/lib\/api$/}, () => ({path:'fixture-api',namespace:'isolated'}));
      b.onLoad({filter:/.*/,namespace:'isolated'}, () => ({contents:'export const api = new Proxy({}, {get: (_, name) => (...args) => globalThis.safetyApi[name](...args)});',loader:'js'}));
    }}],
  });
  const values = new Map();
  globalThis.localStorage = { getItem:k=>values.get(k)??null, setItem:(k,v)=>values.set(k,v), removeItem:k=>values.delete(k) };
  const m = createRequire(import.meta.url)(output);
  let reads = 0, writes = 0;
  const result = r => ({columns:r.fields.map(f=>({name:f.name})),rows:r.rows.map(row=>Object.values(row)),rowsAffected:r.affectedRows});
  globalThis.safetyApi = {
    runQuery: async () => { writes++; throw Error('general executor must not be reached'); },
    runReadOnlyQuery: async (_c,_d,sql) => {
      reads++;
      await pg.exec('BEGIN READ ONLY');
      try { return result(await pg.query(sql)); } finally { await pg.exec('ROLLBACK'); }
    },
    setAutocommit: async () => { throw Error('transaction unavailable'); },
    commitSession: async () => { throw Error('reopen failed; still manual'); },
  };
  await pg.exec("CREATE TABLE preview(id integer); INSERT INTO preview VALUES(1),(2); CREATE FUNCTION touch_fixture() RETURNS integer LANGUAGE SQL AS $$ DELETE FROM preview; SELECT 1 $$;");
  const ds = {schemaVersion:1,id:'fixture',name:'Fixture',connectionId:'c',database:'d',source:{kind:'sql',sql:'DELETE FROM preview'},fields:[],updatedAt:''};
  for(const sql of ['DELETE FROM preview', 'SELECT touch_fixture()']) {
    await assert.rejects(m.previewDataset({...ds,source:{kind:'sql',sql}},'postgres'));
    await assert.rejects(m.probeFields({...ds,source:{kind:'sql',sql}},'postgres'));
  }
  assert.equal((await pg.query('SELECT count(*)::int n FROM preview')).rows[0].n,2);
  assert.equal(writes,0); assert.equal(reads,4);
  assert.equal((await m.previewDataset({...ds,source:{kind:'sql',sql:'SELECT * FROM preview;'}},'postgres')).rows.length,2);
  await assert.rejects(m.previewDataset({...ds,source:{kind:'sql',sql:'SELECT 1; DELETE FROM preview'}},'postgres'));

  await pg.exec("CREATE TABLE expression(status text); INSERT INTO expression VALUES('status');");
  const derived={...ds,source:{kind:'join',base:{table:'expression',alias:'t'},joins:[]},fields:[{name:'status',column:'status',from:'t',role:'dimension'},{name:'flag',expr:"CASE WHEN status='status' THEN 1 ELSE 0 END",role:'measure'}]};
  assert.equal((await pg.query(m.buildDatasetSql(derived,'postgres'))).rows[0].flag,1);
  assert.equal(m.derivedExpr({...derived.fields[1],expr:'net_status + status'},derived,'postgres'),'net_status + "t"."status"');
  for(const expr of ["status || 'status' /* status */", 'status || $$status$$', "status || E'status'"]) {
    const sql=m.derivedExpr({...derived.fields[1],expr},derived,'postgres');
    assert(sql.includes('"t"."status"')); assert(sql.includes(expr.slice(expr.indexOf('||')+3)));
  }
  await pg.exec("CREATE TABLE days(ts timestamp, amount integer); INSERT INTO days VALUES('2026-09-20 00:00:00',10),('2026-09-20 23:59:59.999999',20),('2026-09-21 00:00:00',100);");
  const dayDs={...ds,source:{kind:'sql',sql:'SELECT ts,amount FROM days'}};
  const query=m.buildWidgetSql(dayDs,{dimensions:[],measures:[{field:'amount',agg:'sum'}],dateRange:{field:'ts',start:'2026-09-20',end:'2026-09-20'}},'postgres');
  assert.equal(Number((await pg.query(query)).rows[0].amount),30);
  const where=m.metricDateWhere({timeField:'ts'}, {start:'2026-09-20',end:'2026-09-20'});
  assert.equal(Number((await pg.query(`SELECT SUM(amount) n FROM days WHERE ${where}`)).rows[0].n),30);
  assert.throws(()=>m.metricDateWhere({timeField:'ts'},{start:'2026-02-30',end:'2026-03-01'}));
  assert.equal(m.nextCalendarDay('2024-02-29'),'2024-03-01'); assert.throws(()=>m.nextCalendarDay('2026-02-30'));
  const bigint=JSON.parse('{"id":"9007199254740993"}').id;
  assert(m.buildRowDelete('mysql','d',undefined,'items',{id:bigint}).includes("CAST(`id` AS CHAR) = '9007199254740993'"));
  assert(m.buildRowDelete('postgres','d','public','items',{id:bigint}).includes(bigint));
  assert.throws(()=>m.buildRowDelete('sqlite',undefined,undefined,'items',{id:9007199254740992}));
  assert.equal(m.parseEditedValue(bigint,1,{number:'number',boolean:'boolean'},true),bigint);
  let state={}; const set=patch=>{state={...state,...(typeof patch==='function'?patch(state):patch)}};
  state={...m.createConnectionsSlice(set,()=>state),language:'zh-CN',autocommit:{c:false},showToast:()=>{}};
  await state.setAutocommit('c',true,'d'); assert.equal(state.autocommit.c,false);
  await state.commitSession('c'); assert.equal(state.autocommit.c,false);
  state={...m.createQuerySlice(set,()=>state),meta:{c:{kind:'postgres'}},dirtyTabs:{},showToast:()=>{},tabs:[{id:'ai',kind:'query',connId:'c',database:'d',sql:'SELECT touch_fixture()',readOnly:true,executions:[]}]};
  await state.runTab('ai'); assert.equal(writes,0); assert(state.tabs[0].error);
  assert.equal((await pg.query('SELECT count(*)::int n FROM preview')).rows[0].n,2);

  // Vault migration, corruption and write failure tests use synthetic secrets only.
  const accepts=v=>v!==null&&typeof v==='object'&&typeof v.secret==='string';
  const empty=()=>({secret:''});
  function vault({raw=null,sealed=null,fail=false}={}) {
    const legacy=new Map(raw===null?[]:[['test',raw]]), encrypted=new Map(sealed===null?[]:[['test',sealed]]), events=[];
    const port={ load:async k=>encrypted.get(k)??null, save:async(k,v)=>{events.push('save');if(fail)throw Error('fixture-secret'); encrypted.set(k,v)} };
    const storage={getItem:k=>legacy.get(k)??null,removeItem:k=>{events.push('remove');legacy.delete(k)}};
    const repo=m.secureRepository('test',empty,accepts,port,storage);
    return {repo,legacy,encrypted,events,port};
  }
  const migrated=vault({raw:JSON.stringify({secret:'fixture-secret'})});
  await migrated.repo.initialize();
  assert.deepEqual(migrated.events,['save','remove']); assert.equal(migrated.legacy.size,0);
  assert.equal(migrated.repo.load().secret,'fixture-secret');
  const failed=vault({raw:JSON.stringify({secret:'fixture-secret'}),fail:true});
  await failed.repo.initialize(); assert.equal(failed.legacy.size,1);assert.throws(()=>failed.repo.save({secret:'new'}));
  for(const raw of ['{bad','null','{}']) { const bad=vault({raw});await bad.repo.initialize();assert.equal(bad.legacy.get('test'),raw);assert.equal(bad.events.length,0);assert.throws(()=>bad.repo.save({secret:'new'})); }
  const corrupt=vault({sealed:'{bad',raw:JSON.stringify({secret:'old'})}); await corrupt.repo.initialize();assert.equal(corrupt.legacy.size,1);assert.equal(corrupt.events.length,0);
  const stale=vault({sealed:JSON.stringify({secret:'latest'}),raw:JSON.stringify({secret:'old'})});await stale.repo.initialize();assert.equal(stale.repo.load().secret,'latest');assert.deepEqual(stale.events,['remove']);
  migrated.port.save=async()=>{throw Error('must not echo fixture-secret')};
  await assert.rejects(migrated.repo.save({secret:'changed'}),error=>!String(error).includes('fixture-secret'));
  assert.equal(migrated.repo.load().secret,'fixture-secret');assert.equal(migrated.legacy.size,0);
  const callbacks=[];
  const ai=m.createAiStore({load:m.defaultAiConfig,save:config=>new Promise((resolve,reject)=>callbacks.push({config,resolve,reject}))});
  const first=ai.getState().updateCloud({apiKey:'a'}),second=ai.getState().updateCloud({apiKey:'ab'});
  assert.equal(ai.getState().config.cloud.apiKey,'ab');callbacks[0].resolve();await first;
  callbacks[1].reject(Error('fixture-secret'));assert.equal(await second,false);
  assert.equal(ai.getState().config.cloud.apiKey,'a');assert(!ai.getState().configError.includes('fixture-secret'));
  console.log('Security regressions passed: read-only routing/side effects, dates, expression literals, bigint writes, transaction UI and encrypted migration/failure behavior.');
} finally {await pg.close();rmSync(dir,{recursive:true,force:true});}
