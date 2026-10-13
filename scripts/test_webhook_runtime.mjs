import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHmac,randomUUID} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(root+'/package.json');
const runtimeRequire=createRequire(require.resolve('wrangler/package.json'));
const {Miniflare,convertV4MiniflareOptions}=runtimeRequire('miniflare');
const {build}=runtimeRequire('esbuild');
const secret='fixture-secret-is-not-a-credential-123456789';
const repos=[{id:42,installationId:7,full_name:'fixture/repo',private:false},{id:43,installationId:8,full_name:'fixture/second',private:true}];
const unregistered={id:44,installationId:9,full_name:'fixture/unregistered',private:true};
// The old migration seed deliberately omits the second registered repository.
const scopes=JSON.stringify([repos[0]]);
const built=await build({stdin:{contents:`
  import {nativeWebhookIngress} from './src/server/webhook-native.ts';
  import {DurableObjectStateStore} from './src/server/state/durable-object.ts';
  import {registerAutomationRepository} from './src/server/automation-registry.ts';
  export {PlannedAssignments} from './src/server/plan-object.ts';
  const registered=${JSON.stringify(repos)};
  const readable=[...registered,${JSON.stringify(unregistered)}];
  export default {async fetch(request,env){
    const url=new URL(request.url);
    const store=new DurableObjectStateStore(env.PLANNED_ASSIGNMENTS);
    if(url.pathname==='/fixture-register'){
      const input=await request.json();const repo=registered.find(repo=>repo.id===input.id&&repo.installationId===input.installationId&&repo.full_name===input.full_name);
      if(!repo)return new Response('unknown fixture',{status:400});
      await registerAutomationRepository(store,repo,{id:'1',login:'fixture-writer'});return new Response('registered');
    }
    if(url.pathname==='/fixture-read'){
      const repo=readable.find(repo=>String(repo.installationId)+':'+String(repo.id)===url.searchParams.get('scope'));
      if(!repo)return new Response('unknown fixture',{status:400});
      return Response.json(await store.scan(String(repo.installationId)+':'+String(repo.id),'inbox',{limit:100}));
    }
    if(url.pathname==='/fixture-registry')return Response.json(await store.scan('automation-registry','job',{limit:10}));
    return await nativeWebhookIngress(request,env)??new Response('missing',{status:404});
  }};`,resolveDir:root},bundle:true,format:'esm',platform:'neutral',write:false});
const persist=await mkdtemp(join(tmpdir(),'mergefoo-receipt-runtime-'));
const options=convertV4MiniflareOptions({name:'webhook-receipt-fixture',script:built.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,bindings:{GITHUB_WEBHOOK_SECRET:secret,WORKFLOW_REPOSITORIES:scopes},durableObjects:{PLANNED_ASSIGNMENTS:{className:'PlannedAssignments',useSQLite:true}},resourcePersistencePath:persist});
let runtime;let requests=0;
async function send(id,{repo=repos[0],bytes=1000,ignored=false}={}){
  const body=JSON.stringify({installation:{id:repo.installationId},repository:repo,fixture:'x'.repeat(bytes)});const signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');const before=performance.now();
  const response=await runtime.dispatchFetch('https://fixture.invalid/api/github/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-GitHub-Event':'pull_request','X-GitHub-Delivery':id,'X-Hub-Signature-256':signature},body});requests++;
  assert.equal(response.status,202);const result=await response.json();assert.equal(result.accepted,true);
  if(ignored)assert.equal(result.ignored,true);else assert.ok(result.queued||result.duplicate);
  return performance.now()-before;
}
async function rows(repo){return await (await runtime.dispatchFetch(`https://fixture.invalid/fixture-read?scope=${repo.installationId}:${repo.id}`)).json();}
async function registry(){return (await (await runtime.dispatchFetch('https://fixture.invalid/fixture-registry')).json()).map(record=>record.value);}
try {
  runtime=new Miniflare(options);
  for(const repo of repos)assert.equal((await runtime.dispatchFetch('https://fixture.invalid/fixture-register',{method:'POST',body:JSON.stringify(repo)})).status,200);
  const initialRegistry=await registry();assert.deepEqual(initialRegistry,repos);
  await send(randomUUID(),{repo:unregistered,ignored:true});assert.equal((await rows(unregistered)).length,0);assert.deepEqual(await registry(),initialRegistry);
  // Reuse delivery UUIDs across installations: deduplication must remain repository scoped.
  const ids=Array.from({length:40},()=>randomUUID());
  const timings=await Promise.all(ids.flatMap((id,index)=>repos.map(repo=>send(id,{repo,bytes:index%4===0?80000:1000}))));
  for(const repo of repos){const snapshot=await rows(repo);assert.equal(snapshot.length,40);assert.ok(snapshot.every(record=>record.value.repo.id===repo.id&&record.value.repo.installationId===repo.installationId));}
  await Promise.all(ids.flatMap(id=>repos.flatMap(repo=>[send(id,{repo}),send(id,{repo})])));
  for(const repo of repos)assert.equal((await rows(repo)).length,40);
  await runtime.dispose();runtime=undefined;runtime=new Miniflare(options);
  assert.deepEqual(await registry(),initialRegistry);for(const repo of repos)assert.equal((await rows(repo)).length,40);
  await Promise.all(ids.flatMap(id=>repos.map(repo=>send(id,{repo}))));for(const repo of repos)assert.equal((await rows(repo)).length,40);
  await send(randomUUID(),{repo:unregistered,ignored:true});assert.equal((await rows(unregistered)).length,0);assert.deepEqual(await registry(),initialRegistry);
  await send(randomUUID(),{bytes:999000});assert.equal((await rows(repos[0])).length,41);assert.equal((await rows(repos[1])).length,40);
  assert.equal(requests,323);
  console.log(JSON.stringify({requests,registeredRepositories:2,distinct:81,duplicates:240,unregisteredIgnored:2,unregisteredRows:0,allStatus:202,allDurableAfterRestart:true,registryDurableAfterRestart:true,largestFixtureBytes:999000,coldConcurrentWallMs:{min:Math.round(Math.min(...timings)),max:Math.round(Math.max(...timings))},bundleBytes:built.outputFiles[0].text.length}));
}finally{await runtime?.dispose();await rm(persist,{recursive:true,force:true});}
