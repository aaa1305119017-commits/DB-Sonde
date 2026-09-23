import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const dir = mkdtempSync(join(tmpdir(), 'sonde-autoconnect-'));
const tick = () => new Promise(r => setImmediate(r));
try {
  const outfile = join(dir, 'tests.cjs');
  buildSync({ stdin: { contents: "export {useApp} from './src/store/appStore'; export {api} from './src/lib/api';", resolveDir: resolve('.'), loader: 'ts' }, outfile, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const storage = new Map();
  globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v) };
  globalThis.document = { documentElement: { setAttribute() {}, lang: '' } };
  const { useApp, api } = createRequire(import.meta.url)(outfile);
  const profiles = ['saved-a','offline','no-password','saved-b','changed-password','connected','local-file'].map(id => ({id,name:id,kind:id==='local-file'?'sqlite':'mysql',host:'fixture.invalid',port:3306,username:'fixture'}));
  const meta = id => ({id,kind:'mysql',hasMultipleDatabases:false,currentDatabase:'fixture'});
  const requests = [], releases = new Map(), toasts = []; let active = 0, peak = 0;
  api.listConnections = async () => profiles;
  api.connect = async (id,password) => {
    requests.push({id,password}); peak = Math.max(peak, ++active);
    try {
      await new Promise(r => releases.set(id,r));
      if (id==='offline') throw Error('Connection timed out');
      if (id==='no-password') throw Error('CREDENTIAL_REQUIRED');
      if (id==='changed-password') throw Error('CREDENTIAL_REJECTED');
      return meta(id);
    } finally { active--; }
  };
  useApp.setState({ language:'zh-CN',meta:{connected:meta('connected')},loadChildren:async()=>{},loadCatalog:async()=>{},showToast:toast=>toasts.push(toast),passwordPromptId:'manual-dialog' });
  await Promise.all([useApp.getState().init(),useApp.getState().init()]);
  await tick();
  assert.equal(requests.length,3,'startup remains interactive while connection requests are pending');
  assert.equal(peak,3);
  await useApp.getState().connect('saved-a');assert.equal(requests.length,3,'manual click cannot duplicate an ongoing automatic connection');
  releases.get('saved-a')(); releases.get('offline')(); releases.get('no-password')();
  await tick();
  assert.equal(requests.length,5); releases.get('saved-b')(); releases.get('changed-password')();
  await tick();await tick();
  assert.equal(peak,3);assert(requests.every(r=>r.password===null),'password retrieval stays in the backend');
  assert(useApp.getState().meta['saved-a']);assert(useApp.getState().meta['saved-b']);
  assert.equal(useApp.getState().passwordPromptId,'manual-dialog','background success and failures preserve a manual password prompt');
  assert(!useApp.getState().meta.offline);assert(!Object.values(useApp.getState().connecting).some(Boolean));
  assert.equal(toasts.length,1);assert(toasts[0].text.includes('offline')&&toasts[0].text.includes('changed-password'));assert(!toasts[0].text.includes('no-password'));
  delete useApp.getState().meta['saved-a'];
  await useApp.getState().init();await useApp.getState().autoConnectSaved();
  assert.equal(requests.length,5,'refresh and repeated initialization do not reconnect a deliberately disconnected database');
  api.connect=async()=>{throw Error('CREDENTIAL_REQUIRED');};await useApp.getState().connect('no-password');assert.equal(useApp.getState().passwordPromptId,'no-password');
  api.connect=async(id,password)=>{assert.equal(password,'replacement');return meta(id);};await useApp.getState().connect('no-password','replacement');
  assert(useApp.getState().meta['no-password']);assert.equal(useApp.getState().passwordPromptId,undefined);
  console.log('Startup connections passed: background launch, saved credential reuse, bounded concurrency, duplicate prevention, missing/rejected credentials, partial failures and manual login preservation.');
} finally {rmSync(dir,{recursive:true,force:true});}
