import {github,json} from './auth';
import {AccessError,type Repo} from './github';
import {authorizeBackgroundGrant,installationPrincipal,backgroundConfigured} from './github-app';
import {getStateStore} from './state/store';
import {AUTOMATION_REGISTRY_SCOPE,type StateStore,type StateRecord} from './state/types';
import {findAutomationRepository,registerAutomationRepository,claimNextAutomationRepository} from './automation-registry';
import type {WorkflowDocument} from '../workflow/types';
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
function sameRepository(left:Repo,right:Repo){return left.id===right.id&&left.installationId===right.installationId&&left.full_name.toLowerCase()===right.full_name.toLowerCase();}
async function registeredRepository(store:StateStore,repo:Repo){const registered=await findAutomationRepository(store,repo);return registered&&sameRepository(registered,repo)?registered:null;}
/** Old operator scopes only recover discovery for features already explicitly enrolled. */
async function seedLegacyRepositories(store:StateStore):Promise<boolean>{
  let values:unknown;try{values=JSON.parse(process.env.WORKFLOW_REPOSITORIES??'[]');}catch{throw new AccessError('Invalid legacy background repository scopes.',503);}
  if(!Array.isArray(values)||values.length>100)throw new AccessError('Invalid legacy background repository scopes.',503);
  const repos=values.map(backgroundRepo); // Validate the complete bounded input before writing discovery records.
  if(!repos.length)return false;
  const key='legacy-seed-cursor';const fingerprint=JSON.stringify(repos.map(repo=>[repo.installationId,repo.id,repo.full_name.toLowerCase()]));
  const current=await store.read<{fingerprint:string;next:number}>(AUTOMATION_REGISTRY_SCOPE,'workflow',key);
  const next=current?.value.fingerprint===fingerprint&&Number.isSafeInteger(current.value.next)&&current.value.next>=0?current.value.next:0;
  if(next>=repos.length)return false;
  const repo=repos[next];
  if(!await findAutomationRepository(store,repo)){
    const document=await store.read<WorkflowDocument>(planKey(repo),'workflow','repository');
    const grant=document&&Object.values(document.value.config.stacks).find(stack=>stack.enrolled&&stack.prIds.length&&stack.actorId&&stack.actorLogin);
    if(grant)await registerAutomationRepository(store,repo,{id:grant.actorId,login:grant.actorLogin});
  }
  // A concurrent migration may safely repeat discovery; it cannot enable a feature or GitHub grant.
  await store.compareAndSwap(AUTOMATION_REGISTRY_SCOPE,'workflow',key,current?.version??0,{fingerprint,next:next+1},{id:'scheduler',login:'merge.foo scheduler'});
  return true;
}
export async function drainBackground(repo:Repo,maxSteps=1) {
  const store=await getStateStore();const registered=await registeredRepository(store,repo);
  if(!registered)return {executed:0,version:0,reason:'Repository has no authorized automation registration.'};
  const scope=planKey(registered);const service=new WorkflowService(workflowStore(store));
  const document=await service.read(scope);
  if(!Object.values(document.config.stacks).some(s=>s.enrolled))return {executed:0,version:document.version,reason:'No enrolled features.'};
  if(process.env.GITHUB_WORKFLOW_WRITES_ENABLED!=='true')return {executed:0,version:document.version,reason:'GitHub workflow writes are disabled.'};
  if(!backgroundConfigured())return {executed:0,version:document.version,reason:'Background GitHub review setup is incomplete.'};
  const {token,bot}=await installationPrincipal(registered);
  const transport=new GitHubWorkflowTransport({repository:registered.full_name,enabled:true,externalRequestLimit:36,loadWorkspacePlans:loadPlans,principal:async()=>{
    // One fresh scoped token per bounded invocation; each dispatch rechecks access and actor grant.
    if(process.env.GITHUB_WORKFLOW_WRITES_ENABLED!=='true')throw new AccessError('Background review authorization is unavailable.');
    const current=await github<{id:number;full_name:string;archived:boolean}>(token,`/repos/${registered.full_name}`);
    if(current.id!==registered.id||typeof current.full_name!=='string'||current.full_name.toLowerCase()!==registered.full_name.toLowerCase()||current.archived!==false)throw new AccessError('The selected repository is no longer available or is archived.');
    return {token,actor:{...bot,canWrite:true},repository:registered,effectActor:bot,authorizeScope:async(action,doc)=>authorizeBackgroundGrant(token,registered,action,doc)};
  }});
  let executed=0,version=document.version,reason:string|undefined;
  for(let step=0;step<Math.min(maxSteps,1);step++){const result=await service.runNext(scope,transport,crypto.randomUUID());version=result.document.version;reason=result.reason;if(!result.executed)break;executed++;}
  return {executed,version,reason};
}
async function inboxBatch(store:StateStore,scope:string):Promise<StateRecord<Inbox>[]> {
  const key='inbox-scan-cursor';
  for(let attempt=0;attempt<8;attempt++){
    const cursor=await store.read<{after:string}>(scope,'job',key);const after=cursor?.value.after;
    if(after!==undefined&&(typeof after!=='string'||! /^webhook:[a-f\d-]{16,64}$/i.test(after)))throw new AccessError('Invalid queued webhook cursor.',503);
    let records=await store.scan<Inbox>(scope,'inbox',{...(after?{after}:{}),limit:10});
    if(!records.length&&after)records=await store.scan<Inbox>(scope,'inbox',{limit:10});
    if(!records.length)return [];
    if(await store.compareAndSwap(scope,'job',key,cursor?.version??0,{after:records.at(-1)!.key},{id:'scheduler',login:'merge.foo scheduler'}))return records;
  }
  throw new AccessError('Another worker is selecting queued webhooks. Retry on a later wakeup.',409);
}
export async function drainInbox(repo:Repo,maxEvents=1) {
  const store=await getStateStore();const registered=await registeredRepository(store,repo);if(!registered)return 0;
  const scope=planKey(registered);const records=await inboxBatch(store,scope);let processed=0;
  for(const item of records){if(processed>=Math.min(maxEvents,1))break;if(item.value.state==='done'||Date.parse(item.value.lease?.expiresAt??'')>Date.now())continue;
    const queued=backgroundRepo(item.value.repo);
    if(queued.id!==registered.id||queued.installationId!==registered.installationId)throw new AccessError('Queued webhook repository does not match its authorized state scope.',400);
    // Historic names cannot select a target; only the current registered metadata is dispatched.
    const claim=crypto.randomUUID();const claimed=await store.compareAndSwap(scope,'inbox',item.key,item.version,{...item.value,lease:{id:claim,expiresAt:new Date(Date.now()+120000).toISOString()}},{id:'github',login:'GitHub webhook'});
    if(!claimed)continue;
    try{await drainBackground(registered);await store.compareAndSwap(scope,'inbox',item.key,claimed.version,{...item.value,state:'done',lease:undefined},{id:'github',login:'GitHub webhook'});processed++;}
    catch{await store.compareAndSwap(scope,'inbox',item.key,claimed.version,{...item.value,lease:undefined},{id:'github',login:'GitHub webhook'});throw new AccessError('Background GitHub reconciliation could not complete. The delivery remains queued.',503);}
  }
  return processed;
}
export async function receiveWebhook(request:Request) {
  return handleWebhookReceipt(request,{secret:process.env.GITHUB_WEBHOOK_SECRET,getStore:getStateStore,acceptRepository:async(repo,store)=>!!await registeredRepository(store,repo)});
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
  const store=await getStateStore();if(await seedLegacyRepositories(store))return json({results:[],migration:true});
  const {repo}=await claimNextAutomationRepository(store);if(!repo)return json({results:[]});
  const results=[];let failed=false;
  try{const processed=await drainInbox(repo,1);results.push({repository:repo.full_name,...processed?{processed}:await drainBackground(repo,1)});}catch{failed=true;results.push({repository:repo.full_name,error:'Reconciliation deferred. Persisted work will retry on a later wakeup.'});}
  return json({results},failed?503:200);
}
