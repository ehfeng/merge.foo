import {github,json} from './auth';
import {AccessError,type Repo} from './github';
import {authorizeBackgroundGrant,installationPrincipal,backgroundScopeConfigured} from './github-app';
import {getStateStore} from './state/store';
import {workflowStore} from './state/workflow';
import {WorkflowService} from '../workflow/service';
import {GitHubWorkflowTransport} from './workflow-github';
import {loadPlans,planKey} from './plans';
import {boundedBody} from './request-body';
import {handleWebhookReceipt,type WebhookInbox as Inbox} from './webhook-receipt';
export function backgroundRepo(value:unknown):Repo {
  if(!value||typeof value!=='object')throw new AccessError('Invalid background repository scope.',400);
  const r=value as Record<string,unknown>;
  if(!Number.isSafeInteger(r.id)||Number(r.id)<=0||!Number.isSafeInteger(r.installationId)||Number(r.installationId)<=0||typeof r.full_name!=='string'||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.full_name))throw new AccessError('Invalid background repository scope.',400);
  return {id:Number(r.id),installationId:Number(r.installationId),full_name:r.full_name,private:r.private===true};
}
export async function drainBackground(repo:Repo,maxSteps=1) {
  if(!backgroundScopeConfigured(repo))return {executed:0,version:0,reason:'Repository is outside the configured background scope.'};
  const store=await getStateStore();const scope=planKey(repo);const service=new WorkflowService(workflowStore(store));
  const document=await service.read(scope);
  if(!Object.values(document.config.stacks).some(s=>s.enrolled))return {executed:0,version:document.version,reason:'No enrolled features.'};
  if(process.env.GITHUB_WORKFLOW_WRITES_ENABLED!=='true')return {executed:0,version:document.version,reason:'GitHub workflow writes are disabled.'};
  const {token,bot}=await installationPrincipal(repo);
  const transport=new GitHubWorkflowTransport({repository:repo.full_name,enabled:true,loadWorkspacePlans:loadPlans,principal:async()=>{
    const fresh=await github<{id:number;full_name:string}>(token,`/repos/${repo.full_name}`);
    if(fresh.id!==repo.id||fresh.full_name.toLowerCase()!==repo.full_name.toLowerCase())throw new AccessError('The selected repository is no longer available.');
    return {token,actor:{...bot,canWrite:true},repository:repo,effectActor:bot,authorizeScope:async(action,doc)=>authorizeBackgroundGrant(token,repo,action,doc)};
  }});
  let executed=0,version=document.version,reason:string|undefined;
  for(let step=0;step<maxSteps;step++){const result=await service.runNext(scope,transport,crypto.randomUUID());version=result.document.version;reason=result.reason;if(!result.executed)break;executed++;}
  return {executed,version,reason};
}
export async function drainInbox(repo:Repo,maxEvents=1) {
  const store=await getStateStore();const scope=planKey(repo);const snapshot=await store.list<Inbox>(scope,'inbox');let processed=0;
  for(const item of snapshot.records){if(processed>=maxEvents)break;if(item.value.state==='done'||Date.parse(item.value.lease?.expiresAt??'')>Date.now())continue;
    const claim=crypto.randomUUID();const claimed=await store.compareAndSwap(scope,'inbox',item.key,item.version,{...item.value,lease:{id:claim,expiresAt:new Date(Date.now()+120000).toISOString()}},{id:'github',login:'GitHub webhook'});
    if(!claimed)continue;
    try{await drainBackground(item.value.repo);await store.compareAndSwap(scope,'inbox',item.key,claimed.version,{...item.value,state:'done',lease:undefined},{id:'github',login:'GitHub webhook'});processed++;}
    catch{await store.compareAndSwap(scope,'inbox',item.key,claimed.version,{...item.value,lease:undefined},{id:'github',login:'GitHub webhook'});throw new AccessError('Background GitHub reconciliation could not complete. The delivery remains queued.',503);}
  }
  return processed;
}
export async function receiveWebhook(request:Request) {
  return handleWebhookReceipt(request,{secret:process.env.GITHUB_WEBHOOK_SECRET,scopes:process.env.WORKFLOW_REPOSITORIES,getStore:getStateStore});
}
export async function validRunnerSecret(header:string|null,secret=process.env.WORKFLOW_RECONCILE_SECRET):Promise<boolean> {
  if(!secret||secret.length<32||!header?.startsWith('Bearer '))return false;
  const expected=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)));const actual=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(header.slice(7))));let difference=0;for(let i=0;i<expected.length;i++)difference|=expected[i]^actual[i];return difference===0;
}
export async function reconcileBackground(request:Request) {
  if(!await validRunnerSecret(request.headers.get('Authorization')))throw new AccessError('Background scheduler authorization required.',401);
  const bytes=await boundedBody(request,4000);let input:unknown;try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AccessError('Invalid reconciliation JSON.',400);}
  const repo=backgroundRepo(input);const processed=await drainInbox(repo);return json(processed?{processed}:await drainBackground(repo));
}
export async function reconcileScheduled(request:Request) {
  if(!await validRunnerSecret(request.headers.get('Authorization'),process.env.CRON_SECRET||process.env.WORKFLOW_RECONCILE_SECRET))throw new AccessError('Background scheduler authorization required.',401);
  let scopes:unknown;try{scopes=JSON.parse(process.env.WORKFLOW_REPOSITORIES??'[]');}catch{throw new AccessError('The operator must configure background repository scopes.',503);}
  if(!Array.isArray(scopes)||scopes.length>100)throw new AccessError('Invalid background repository scopes.',503);
  // Validate every scope before any external action, then dispatch a bounded batch.
  const repos=scopes.map(backgroundRepo);if(!repos.length)return json({results:[]});
  const store=await getStateStore();const scope=planKey(repos[0]);const fingerprint=JSON.stringify(repos.map(r=>[r.installationId,r.id,r.full_name]));let offset=0,claimed=false;
  for(let attempt=0;attempt<8;attempt++){
    const current=await store.read<{offset:number;fingerprint:string}>(scope,'job','scheduler-cursor');
    const stored=current?.value;offset=stored?.fingerprint===fingerprint&&Number.isSafeInteger(stored.offset)&&stored.offset>=0?stored.offset%repos.length:0;
    const next=(offset+1)%repos.length;
    if(await store.compareAndSwap(scope,'job','scheduler-cursor',current?.version??0,{offset:next,fingerprint},{id:'scheduler',login:'merge.foo scheduler'})){claimed=true;break;}
  }
  if(!claimed)throw new AccessError('Another scheduler is selecting the next repository batch. Retry on the next wakeup.',409);
  const results=[];let failed=false;
  const repo=repos[offset];try{const processed=await drainInbox(repo,1);results.push({repository:repo.full_name,...processed?{processed}:await drainBackground(repo,1)});}catch{failed=true;results.push({repository:repo.full_name,error:'Reconciliation deferred. Persisted work will retry on a later wakeup.'});}
  return json({results,remainingScopes:Math.max(0,repos.length-1)},failed?503:200);
}
