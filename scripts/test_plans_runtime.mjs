// Actual workerd/SQLite restart test. No dotenv, credentials, GitHub calls or remote deployment.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url);
const runtimeRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=runtimeRequire('miniflare');
const {build}=runtimeRequire('esbuild');
const root=fileURLToPath(new URL('../',import.meta.url));
const built=await build({stdin:{contents:`export {PlannedAssignments} from './src/server/plan-object.ts';
export default {fetch(request,env) {const url=new URL(request.url);return env.PLANNED_ASSIGNMENTS.get(env.PLANNED_ASSIGNMENTS.idFromName(url.searchParams.get('scope')??url.pathname)).fetch(request);}};`,resolveDir:root},bundle:true,format:'esm',platform:'neutral',write:false});
const persist=await mkdtemp(join(tmpdir(),'merge-foo-sqlite-fixture-'));
const options=convertV4MiniflareOptions({name:'plans-runtime-fixture',script:built.outputFiles[0].text,modules:true,
  compatibilityDate:'2026-10-11',host:'127.0.0.1',port:0,
  durableObjects:{PLANNED_ASSIGNMENTS:{className:'PlannedAssignments',useSQLite:true}},
  resourcePersistencePath:persist});
let runtime;
const plan={prId:'PR_fixture',reviewerIds:['sam'],reviewerIdentities:[{id:'42',login:'sam'}],version:0,
  actor:'alice',actorId:'1',updatedAt:'2026-10-12T12:00:00Z'};
async function read(scope='/install-1:repo-1') {return (await runtime.dispatchFetch(`https://fixture.invalid${scope}`)).json();}
async function save(value,scope='/install-1:repo-1') {return runtime.dispatchFetch(`https://fixture.invalid${scope}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});}
async function resource(input) {return (await runtime.dispatchFetch('https://fixture.invalid/resources?scope=9:4',{method:'POST',body:JSON.stringify(input)})).json();}
try {
  runtime=new Miniflare(options);
  assert.deepEqual(await read(),{plans:[],history:[]});
  const created=await save(plan);assert.equal(created.status,200);
  assert.equal((await created.json()).plan.version,1);
  const shared=await read();assert.equal(shared.plans[0].actorId,'1');
  assert.deepEqual(shared.plans[0].reviewerIdentities,[{id:'42',login:'sam'}]);
  const conflict=await save({...plan,actor:'bob',actorId:'2'});assert.equal(conflict.status,409);
  assert.equal((await read()).history.length,1);
  assert.deepEqual(await read('/install-1:repo-2'),{plans:[],history:[]});
  await runtime.dispose();runtime=undefined;
  runtime=new Miniflare(options);
  const recovered=await read();assert.equal(recovered.plans[0].version,1);assert.equal(recovered.history.length,1);
  const updated=await save({...plan,version:1,actor:'bob',actorId:'2',reviewerIds:[],reviewerIdentities:[]});assert.equal(updated.status,200);
  const result=await read();assert.equal(result.plans[0].version,2);assert.equal(result.history.length,2);
  assert.equal(result.plans[0].actorId,'2');assert.deepEqual(result.plans[0].reviewerIds,[]);
  const actor={id:'1',login:'alice'};
  assert.equal((await resource({operation:'cas',kind:'workflow',key:'repository',expectedVersion:0,value:{version:1,generation:1,status:'pending'},actor})).version,1);
  const claims=await Promise.all(['worker-A','worker-B'].map(owner=>resource({operation:'cas',kind:'workflow',key:'repository',expectedVersion:1,value:{version:2,generation:1,status:'claimed',owner},actor})));
  assert.equal(claims.filter(Boolean).length,1);
  assert.equal((await resource({operation:'list',kind:'workflow'})).history.length,2);
  assert.ok(await resource({operation:'cas',kind:'inbox',key:'delivery-1',expectedVersion:0,value:{received:true},actor}));
  assert.equal(await resource({operation:'cas',kind:'inbox',key:'delivery-1',expectedVersion:0,value:{received:true},actor}),null);
  await runtime.dispose();runtime=undefined;runtime=new Miniflare(options);
  assert.equal((await resource({operation:'read',kind:'workflow',key:'repository'})).value.status,'claimed');
  assert.equal((await resource({operation:'list',kind:'workflow'})).history.length,2);
  assert.equal((await resource({operation:'read',kind:'inbox',key:'delivery-1'})).value.received,true);
  console.log('SQLite workerd runtime passed: durable restart, shared reads, repository isolation, actor history, version conflict and clearing.');
} finally {
  await runtime?.dispose();
  await rm(persist,{recursive:true,force:true});
}
