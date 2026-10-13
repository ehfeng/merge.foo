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
const scopes=JSON.stringify([{id:42,installationId:7,full_name:'fixture/repo',private:false}]);
const built=await build({stdin:{contents:`import {nativeWebhookIngress} from './src/server/webhook-native.ts'; export {PlannedAssignments} from './src/server/plan-object.ts'; export default {async fetch(request,env){ if(new URL(request.url).pathname==='/fixture-read')return env.PLANNED_ASSIGNMENTS.get(env.PLANNED_ASSIGNMENTS.idFromName('7:42')).fetch(new Request('https://state.internal/resources',{method:'POST',body:JSON.stringify({operation:'list',kind:'inbox'})})); return await nativeWebhookIngress(request,env)??new Response('missing',{status:404});}};`,resolveDir:root},bundle:true,format:'esm',platform:'neutral',write:false});
const persist=await mkdtemp(join(tmpdir(),'mergefoo-receipt-runtime-'));
const options=convertV4MiniflareOptions({name:'webhook-receipt-fixture',script:built.outputFiles[0].text,modules:true,compatibilityDate:'2026-10-11',compatibilityFlags:['nodejs_compat'],host:'127.0.0.1',port:0,bindings:{GITHUB_WEBHOOK_SECRET:secret,WORKFLOW_REPOSITORIES:scopes},durableObjects:{PLANNED_ASSIGNMENTS:{className:'PlannedAssignments',useSQLite:true}},resourcePersistencePath:persist});
let runtime;
async function send(id,bytes=1000){const body=JSON.stringify({installation:{id:7},repository:{id:42,full_name:'fixture/repo',private:false},fixture:'x'.repeat(bytes)});const signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');const before=performance.now();const response=await runtime.dispatchFetch('https://fixture.invalid/api/github/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-GitHub-Event':'pull_request','X-GitHub-Delivery':id,'X-Hub-Signature-256':signature},body}); assert.equal(response.status,202);assert.equal((await response.json()).accepted,true);return performance.now()-before;}
async function rows(){return (await (await runtime.dispatchFetch('https://fixture.invalid/fixture-read')).json()).records;}
try {runtime=new Miniflare(options);const ids=Array.from({length:40},()=>randomUUID());const timings=await Promise.all(ids.map((id,i)=>send(id,i%4===0?80000:1000)));assert.equal((await rows()).length,40);await Promise.all(ids.flatMap(id=>[send(id),send(id)]));assert.equal((await rows()).length,40);await runtime.dispose();runtime=undefined;runtime=new Miniflare(options);assert.equal((await rows()).length,40);await Promise.all(ids.map(id=>send(id)));assert.equal((await rows()).length,40);await send(randomUUID(),999000);assert.equal((await rows()).length,41);console.log(JSON.stringify({requests:161,distinct:41,duplicates:120,allStatus:202,allDurableAfterRestart:true,largestFixtureBytes:999000,coldConcurrentWallMs:{min:Math.round(Math.min(...timings)),max:Math.round(Math.max(...timings))},bundleBytes:built.outputFiles[0].text.length}));}finally{await runtime?.dispose();await rm(persist,{recursive:true,force:true});}
