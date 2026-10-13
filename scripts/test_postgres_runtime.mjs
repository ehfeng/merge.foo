// Dedicated local PostgreSQL fixture only. Never reads DATABASE_URL or production credentials.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
const connection=process.env.TEST_DATABASE_URL;
if(!connection)throw new Error('Set TEST_DATABASE_URL to an isolated localhost PostgreSQL fixture.');
const url=new URL(connection);
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.username!=='mergefoo_test'||url.password)throw new Error('This check accepts only the dedicated loopback mergefoo_test fixture.');
const require=createRequire(import.meta.url);
const runtimeRequire=createRequire(require.resolve('wrangler/package.json'));
const {build}=runtimeRequire('esbuild');
const temp=await mkdtemp(join(tmpdir(),'mergefoo-postgres-parity-'));
const schema=`fixture_${crypto.randomUUID().replaceAll('-','')}`;
let pool;
try {
  const compiled=join(temp,'postgres.mjs');
  await build({stdin:{contents:`export {PostgresStateStore} from './src/server/state/postgres.ts';export {workflowStore} from './src/server/state/workflow.ts';export {WorkflowService} from './src/workflow/service.ts';`,resolveDir:fileURLToPath(new URL('../',import.meta.url))},bundle:true,format:'esm',platform:'node',packages:'external',outfile:compiled});
  const {PostgresStateStore,workflowStore,WorkflowService}=await import(pathToFileURL(compiled).href);
  pool=new Pool({connectionString:connection});
  await pool.query(`CREATE SCHEMA ${schema}`);await pool.end();
  const open=()=>new Pool({connectionString:connection,options:`-c search_path=${schema}`,max:10});
  pool=open();await pool.query(await readFile(new URL('../migrations/001_shared_state.sql',import.meta.url),'utf8'));
  const store=new PostgresStateStore(async(text,parameters)=>(await pool.query(text,parameters)).rows);
  const actor={id:'1',login:'alice'};const scope='9:4';
  assert.equal(await store.read(scope,'workflow','repository'),null);
  assert.equal(await store.compareAndSwap(scope,'workflow','missing',7,{version:8},actor),null);
  const initial={version:1,actions:[{id:'release-1',generation:1,status:'pending'}]};
  const created=await store.compareAndSwap(scope,'workflow','repository',0,initial,actor);assert.equal(created.version,1);
  const results=await Promise.all(['worker-A','worker-B'].map(owner=>store.compareAndSwap(scope,'workflow','repository',1,{version:2,actions:[{id:'release-1',generation:1,status:'claimed',claim:{owner}}]},actor)));
  assert.equal(results.filter(Boolean).length,1,'exactly one worker can acquire the versioned action claim');
  const snapshot=await store.list(scope,'workflow');assert.equal(snapshot.history.length,2);
  const winning=snapshot.records[0].value;assert.equal(winning.actions[0].status,'claimed');
  assert.equal(await store.compareAndSwap(scope,'workflow','repository',0,{version:1},actor),null);
  assert.equal((await store.list(scope,'workflow')).history.length,2,'conflicts append no audit history');
  assert.equal(await store.read('9:5','workflow','repository'),null);
  assert.equal(await store.read('10:4','workflow','repository'),null);
  const delivery=await store.compareAndSwap(scope,'inbox','delivery-1',0,{event:'review'},actor);assert.ok(delivery);
  assert.equal(await store.compareAndSwap(scope,'inbox','delivery-1',0,{event:'review'},actor),null);
  const plan={prId:'PR_fixture',reviewerIds:['sam'],reviewerIdentities:[{id:'42',login:'sam'}],version:1,actor:'alice',actorId:'1',updatedAt:'2026-10-12T12:00:00Z'};
  await store.compareAndSwap(scope,'plan','PR_fixture',0,plan,actor);
  assert.deepEqual((await store.list(scope,'plan')).records[0].value,plan);
  await pool.end();pool=undefined;
  // Optional actual server restart, restricted to the root's dedicated temporary fixture cluster.
  if(process.env.TEST_PG_DATA==='/private/tmp/mergefoo-pg-pilot') {
    execFileSync('/opt/homebrew/opt/postgresql@18/bin/pg_ctl',['restart','-D',process.env.TEST_PG_DATA,'-w','-m','fast','-l','/private/tmp/mergefoo-pg-pilot-runtime.log'],{stdio:'pipe',timeout:15000});
  }
  pool=open();
  assert.deepEqual((await store.read(scope,'workflow','repository')).value,winning,'generation/claim survive PostgreSQL restart');
  assert.equal((await store.list(scope,'workflow')).history.length,2);
  assert.equal((await store.read(scope,'inbox','delivery-1')).value.event,'review');
  // Exercise the actual workflow service against SQL, using only a fake external transport.
  const workflowScope='9:6';const observedAt='2026-10-12T12:00:00Z';
  const observation={scope:workflowScope,repository:'fixture/repo',observedAt,complete:true,prs:['1','2','3'].map((id,index)=>({id,number:index+1,stackId:'feature',parentId:index?String(index):undefined,author:actor,lifecycle:'open',readiness:'draft',topologyVerified:true,githubGate:'none',reviewsComplete:true,requestsComplete:true,reviews:[],requests:[],plannedReviewers:[{id:'42',login:'sam'}]}))};
  const service=new WorkflowService(workflowStore(store),()=>Date.parse(observedAt));
  const manager={...actor,canWrite:true};
  let document=await service.command(workflowScope,observation,manager,{type:'enroll',stackId:'feature',enabled:true,autoProgress:true},0);
  document=await service.command(workflowScope,observation,manager,{type:'start',prId:'1'},document.version);
  let effects=0;
  const transport={enabled:true,observe:async()=>structuredClone(observation),authorize:async()=>true,reconcile:async()=>({state:'unknown'}),perform:async(action,_snapshot,beforeDispatch)=>{
    if(beforeDispatch&&!await beforeDispatch(observation))return {state:'not_applied'};
    effects++;const pr=observation.prs.find(p=>p.id===action.prId);const receipt={eventId:action.id,actorId:actor.id,at:observedAt,attributable:true};
    if(action.kind==='ready'){pr.readiness='ready';pr.readinessEvent={id:action.id,at:observedAt,actorId:actor.id,readiness:'ready'};}
    if(action.kind==='request'){pr.requests.push({reviewerId:action.reviewer.id,login:action.reviewer.login,eventId:action.id});receipt.reviewerId=action.reviewer.id;}
    if(action.kind==='remove_request')pr.requests=pr.requests.filter(r=>r.reviewerId!==action.reviewer.id);
    if(action.kind==='draft'){pr.readiness='draft';pr.readinessEvent={id:action.id,at:observedAt,actorId:actor.id,readiness:'draft'};}
    return {state:'applied',receipt};
  }};
  const second=new WorkflowService(workflowStore(store),()=>Date.parse(observedAt));
  await Promise.all([service.runNext(workflowScope,transport,'first'),second.runNext(workflowScope,transport,'second')]);
  assert.equal(effects,1,'SQL claim fencing prevents two workflow workers dispatching the same step');
  await service.runNext(workflowScope,transport,'first');
  observation.prs[0].reviews=[{id:'100',reviewerId:'42',state:'approved',submittedAt:observedAt,eligible:true}];
  await service.reconcile(workflowScope,observation);await service.runNext(workflowScope,transport,'first');await service.runNext(workflowScope,transport,'first');
  assert.equal(observation.prs[1].readiness,'ready');assert.equal(observation.prs[1].requests.length,1);assert.equal(observation.prs[0].lifecycle,'open');
  const resumed=new WorkflowService(workflowStore(store),()=>Date.parse(observedAt));
  observation.prs[0].reviews.push({id:'101',reviewerId:'42',state:'changes_requested',submittedAt:'2026-10-12T13:00:00Z',eligible:true});
  await resumed.reconcile(workflowScope,observation);await resumed.runNext(workflowScope,transport,'restart');await resumed.runNext(workflowScope,transport,'restart');
  assert.equal(observation.prs[1].requests.length,0);assert.equal(observation.prs[1].readiness,'draft');
  assert.ok((await resumed.read(workflowScope)).releases['2'].rolledBack);
  console.log('PostgreSQL fixture passed: atomic CAS/audit, concurrent claim fencing, scope isolation, inbox deduplication, shared plans, restart persistence and real service release/rollback with fake effects.');
} finally {
  if(pool){await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await pool.end();}
  await rm(temp,{recursive:true,force:true});
}
