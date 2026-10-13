import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {receiveWebhook,validRunnerSecret,reconcileScheduled,backgroundRepo,drainBackground,drainInbox,reconcileBackground} from './workflow-background';
import {emptyWorkflow} from '../workflow/engine';
import type {Repo} from './github';
import type {StateRecord,ResourceKind} from './state/types';
import type {GitHubWorkflowOptions,WorkflowPrincipal} from './workflow-github';
const fixture=vi.hoisted(()=>({rows:new Map<string,StateRecord<unknown>>(),writes:vi.fn(),scans:vi.fn(),install:vi.fn(),options:[] as GitHubWorkflowOptions[],principals:[] as WorkflowPrincipal[]}));
vi.mock('./state/store',()=>({getStateStore:async()=>({
  read:async(scope:string,kind:string,key:string)=>fixture.rows.get(`${scope}/${kind}/${key}`)??null,
  list:async()=>{throw new Error('Background discovery must use bounded scans.');},
  scan:async(scope:string,kind:string,options:{after?:string;limit:number})=>{fixture.scans(scope,kind,options);return [...fixture.rows].filter(([id,row])=>id.startsWith(`${scope}/${kind}/`)&&(!options.after||row.key>options.after)).map(([,row])=>row).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).slice(0,options.limit);},
  compareAndSwap:async(scope:string,kind:ResourceKind,key:string,expected:number,value:unknown,actor:{id:string;login:string})=>{fixture.writes(scope,kind,key);const id=`${scope}/${kind}/${key}`;const previous=fixture.rows.get(id);if((previous?.version??0)!==expected)return null;const result={key,kind,version:expected+1,value,actor,updatedAt:new Date().toISOString()};fixture.rows.set(id,result);return result;},
})}));
vi.mock('./github-app',async original=>({...await original<typeof import('./github-app')>(),installationPrincipal:fixture.install}));
vi.mock('./workflow-github',()=>({GitHubWorkflowTransport:class{
  enabled=true;
  constructor(private options:GitHubWorkflowOptions){fixture.options.push(options);}
  async observe(){const principal=await this.options.principal!();fixture.principals.push(principal);return {scope:`${principal.repository.installationId}:${principal.repository.id}`,repository:principal.repository.full_name,complete:false,observedAt:new Date().toISOString(),prs:[]};}
}}));
const secret='test-webhook-secret-that-is-at-least-32-characters';
const repo:Repo={id:42,installationId:7,full_name:'owner/repo',private:true};
const other:Repo={id:43,installationId:8,full_name:'other/private',private:true};
function put(scope:string,kind:ResourceKind,key:string,value:unknown){fixture.rows.set(`${scope}/${kind}/${key}`,{key,kind,version:1,value,actor:{id:'5',login:'writer'},updatedAt:new Date().toISOString()});}
function register(repo:Repo){put('automation-registry','job',`repository:${repo.installationId}:${repo.id}`,repo);}
function enroll(repo:Repo,enabled=true){const doc=emptyWorkflow();doc.version=1;doc.config.stacks.s={enrolled:enabled,autoProgress:false,started:false,prIds:['p'],actorId:'5',actorLogin:'writer'};put(`${repo.installationId}:${repo.id}`,'workflow','repository',doc);return doc;}
function schedulerRequest(){return new Request('https://merge.example/api/internal/reconcile',{headers:{Authorization:`Bearer ${secret}`}});}
beforeEach(()=>{
  fixture.rows.clear();fixture.writes.mockClear();fixture.scans.mockClear();fixture.install.mockReset().mockResolvedValue({token:'fixture-token',bot:{id:'99',login:'merge-foo[bot]'}});fixture.options.length=0;fixture.principals.length=0;
  vi.stubEnv('GITHUB_WEBHOOK_SECRET',secret);vi.stubEnv('WORKFLOW_RECONCILE_SECRET',secret);vi.stubEnv('WORKFLOW_REPOSITORIES','[]');vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','true');vi.stubEnv('GITHUB_APP_PRIVATE_KEY','fixture-key-presence');vi.stubEnv('GITHUB_APP_ID','99');vi.stubEnv('STATE_STORE','durable-object');vi.stubEnv('DATABASE_URL','');
  vi.stubGlobal('fetch',vi.fn(async(url:string)=>{
    if(url.includes('/collaborators/'))return Response.json({permission:'write',user:{id:5,login:'writer'}});
    const current=[repo,other].find(repo=>url.endsWith(`/repos/${repo.full_name}`));if(!current)throw new Error('Unexpected GitHub request.');return Response.json({...current,archived:false});
  }));
});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function delivery(body:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Request('https://merge.example/api/github/webhook',{method:'POST',headers:{'X-Hub-Signature-256':'sha256='+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('hex'),'X-GitHub-Event':'pull_request_review','X-GitHub-Delivery':'12345678-1234-1234-1234-123456789abc'},body});}
it('durably queues registered signed deliveries without GitHub; duplicate is idempotent',async()=>{
  register(repo);const network=vi.fn(()=>{throw new Error('Webhook ACK must not call GitHub.');});vi.stubGlobal('fetch',network);
  const body=JSON.stringify({installation:{id:7},repository:{id:42,full_name:'owner/repo',private:true}});
  expect(await (await receiveWebhook(await delivery(body))).json()).toMatchObject({queued:true});expect(await (await receiveWebhook(await delivery(body))).json()).toMatchObject({accepted:true});
  expect(fixture.writes).toHaveBeenCalledTimes(1);expect(network).not.toHaveBeenCalled();expect(fixture.install).not.toHaveBeenCalled();
  expect(fixture.rows.get('7:42/inbox/webhook:12345678-1234-1234-1234-123456789abc')).toMatchObject({value:{state:'pending',repo:{id:42,installationId:7}}});
});
it('invalid signatures cannot create inbox state',async()=>{
  expect((await receiveWebhook(new Request('https://merge.example/api/github/webhook',{method:'POST',headers:{'X-GitHub-Event':'pull_request','X-Hub-Signature-256':'sha256='+'0'.repeat(64)},body:JSON.stringify({installation:{id:7},repository:{id:42,full_name:'owner/repo'}})}))).status).toBe(401);expect(fixture.writes).not.toHaveBeenCalled();
});
it('does not treat a legacy allowlist or signed delivery as new automation enrollment',async()=>{
  vi.stubEnv('WORKFLOW_REPOSITORIES',JSON.stringify([repo]));
  expect(await (await receiveWebhook(await delivery(JSON.stringify({installation:{id:7},repository:repo})))).json()).toMatchObject({ignored:true});expect(fixture.rows.size).toBe(0);expect(fixture.writes).not.toHaveBeenCalled();expect(fixture.install).not.toHaveBeenCalled();
});
it('requires registered canonical names for new webhook metadata',async()=>{
  register(repo);const body=JSON.stringify({installation:{id:7},repository:{...repo,full_name:'owner/forged'}});
  expect(await (await receiveWebhook(await delivery(body))).json()).toMatchObject({ignored:true});expect(fixture.writes).not.toHaveBeenCalled();
});
it('runs any registered enrolled repository without static scopes and preserves feature opt-in',async()=>{
  for(const current of [repo,other]){register(current);enroll(current);expect(await drainBackground(current)).toMatchObject({executed:0});}
  expect(fixture.install.mock.calls.map(call=>call[0])).toEqual([repo,other]);expect(fixture.options).toHaveLength(2);
  const doc=fixture.rows.get('8:43/workflow/repository')!.value;expect(doc).toMatchObject({config:{stacks:{s:{enrolled:true,autoProgress:false,started:false}}}});
});
it.each(['unregistered','disabled','global-off'] as const)('does not mint GitHub credentials for %s automation',async state=>{
  if(state!=='unregistered')register(repo);enroll(repo,state!=='disabled');if(state==='global-off')vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','false');
  expect(await drainBackground(repo)).toMatchObject({executed:0});expect(fixture.install).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('does not mint credentials or scan private inbox state for unregistered runner requests',async()=>{
  const result=await reconcileBackground(new Request('https://merge.example/api/internal/reconcile',{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:JSON.stringify(repo)}));
  expect(await result.json()).toMatchObject({executed:0});expect(fixture.install).not.toHaveBeenCalled();expect(fixture.scans).not.toHaveBeenCalled();
});
it('rechecks repository archive status and numeric grant actor permission',async()=>{
  register(repo);const doc=enroll(repo);await drainBackground(repo);const principal=await fixture.options[0].principal!();
  const action={stackId:'s',prId:'p',mode:'automatic'} as Parameters<NonNullable<WorkflowPrincipal['authorizeScope']>>[0];const snapshot={scope:'7:42',repository:repo.full_name,complete:false,observedAt:new Date().toISOString(),prs:[]};
  expect(await principal.authorizeScope!(action,doc,snapshot)).toBe(true);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({permission:'read',user:{id:5}})));expect(await principal.authorizeScope!(action,doc,snapshot)).toBe(false);
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({...repo,archived:true})));await expect(fixture.options[0].principal!()).rejects.toThrow('archived');expect(fixture.install).toHaveBeenCalledTimes(1);
});
it.each(['durable-object','postgres'])('keeps the %s transport budget portable across hosts',async mode=>{
  register(repo);enroll(repo);vi.stubEnv('STATE_STORE',mode);await drainBackground(repo);
  const budget=fixture.options[0].externalRequestLimit!;expect(budget).toBe(36);
  // The DO host reserves five App requests, four metadata checks and four actor grants.
  // PostgreSQL HTTP also needs provider-specific total quota verification; its storage selection does not constrain Node/Vercel.
  expect(budget+5+4+4).toBeLessThanOrEqual(50);
});
it('rejects foreign repository identities in an existing inbox before minting or dispatch',async()=>{
  register(repo);enroll(repo);put('7:42','inbox','webhook:12345678-1234-1234-1234-123456789abc',{repo:other,state:'pending'});
  await expect(drainInbox(repo)).rejects.toThrow('does not match');expect(fixture.install).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('uses registered metadata for older inbox names after a user refresh',async()=>{
  register(repo);enroll(repo);vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','false');put('7:42','inbox','webhook:12345678-1234-1234-1234-123456789abc',{repo:{...repo,full_name:'owner/old-name'},state:'pending'});
  expect(await drainInbox(repo)).toBe(1);expect(fixture.rows.get('7:42/inbox/webhook:12345678-1234-1234-1234-123456789abc')).toMatchObject({value:{state:'done'}});expect(fixture.install).not.toHaveBeenCalled();
});
it('advances bounded inbox scans past completed history and wraps for later work',async()=>{
  register(repo);enroll(repo);vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','false');
  for(let index=0;index<15;index++)put('7:42','inbox',`webhook:${String(index).padStart(16,'0')}`,{repo,state:index===14?'pending':'done'});
  expect(await drainInbox(repo)).toBe(0);expect(await drainInbox(repo)).toBe(1);expect(await drainInbox(repo)).toBe(0);expect(fixture.scans.mock.calls.every(call=>call[2].limit===10)).toBe(true);
});
it('rotates dynamic repositories fairly across concurrent scheduler wakeups',async()=>{
  for(const current of [repo,other]){register(current);enroll(current);}vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','false');
  const responses=await Promise.all([reconcileScheduled(schedulerRequest()),reconcileScheduled(schedulerRequest())]);const rows=await Promise.all(responses.map(response=>response.json()));
  expect(new Set(rows.map(row=>row.results[0].repository))).toEqual(new Set([repo.full_name,other.full_name]));expect((await (await reconcileScheduled(schedulerRequest())).json()).results[0].repository).toBe(repo.full_name);expect(fixture.install).not.toHaveBeenCalled();
});
it('migrates legacy discovery one scope at a time only for previously enrolled features',async()=>{
  vi.stubEnv('WORKFLOW_REPOSITORIES',JSON.stringify([repo,other]));enroll(repo);enroll(other,false);vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','false');
  expect(await (await reconcileScheduled(schedulerRequest())).json()).toMatchObject({migration:true});expect(fixture.rows.has('automation-registry/job/repository:7:42')).toBe(true);expect(fixture.rows.has('automation-registry/job/repository:8:43')).toBe(false);
  expect(await (await reconcileScheduled(schedulerRequest())).json()).toMatchObject({migration:true});expect(fixture.rows.has('automation-registry/job/repository:8:43')).toBe(false);
  expect(await (await reconcileScheduled(schedulerRequest())).json()).toMatchObject({results:[{repository:repo.full_name,reason:'GitHub workflow writes are disabled.'}]});expect(fixture.install).not.toHaveBeenCalled();
});
it('checks scheduler authorization and validates legacy migration input before discovery writes',async()=>{
  vi.stubEnv('WORKFLOW_REPOSITORIES',JSON.stringify([repo,{...other,id:0}]));expect(await validRunnerSecret(`Bearer ${secret}`)).toBe(true);expect(await validRunnerSecret('Bearer wrong')).toBe(false);
  await expect(reconcileScheduled(new Request('https://merge.example/api/internal/reconcile'))).rejects.toThrow('authorization required');await expect(reconcileScheduled(schedulerRequest())).rejects.toThrow('Invalid background repository scope');expect(fixture.writes).not.toHaveBeenCalled();expect(()=>backgroundRepo({...repo,full_name:'https://evil.example/repo'})).toThrow();
});
