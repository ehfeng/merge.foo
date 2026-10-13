import {configuration,github,type Session} from './auth';
import {AccessError,validateRepositoryAccess,verifyIdentity,type Repo} from './github';
import type {Workspace} from '../domain/types';
import {getStateStore} from './state/store';
import type {Plan,PlansSnapshot} from './state/types';
import {boundedBody} from './request-body';
export type {Plan,PlanHistory,PlansSnapshot} from './state/types';
export function planKey(repo:Repo){return `${repo.installationId}:${repo.id}`;}
export async function planStore(repo:Repo,method='GET',body?:unknown):Promise<Response> {
  try {
    const store=await getStateStore();const scope=planKey(repo);
    if(method==='GET') {
      const snapshot=await store.list<Plan>(scope,'plan');
      return Response.json({plans:snapshot.records.map(r=>r.value),history:snapshot.history.map(r=>({...r.value,id:r.id}))});
    }
    if(method!=='PUT')return Response.json({error:'Method not allowed.'},{status:405});
    const incoming=body as Plan;
    const value={...incoming,version:incoming.version+1};
    const saved=await store.compareAndSwap(scope,'plan',incoming.prId,incoming.version,value,{id:incoming.actorId,login:incoming.actor});
    return saved?Response.json({plan:saved.value}):Response.json({error:'Someone changed this assignment. Refresh the repository before editing again.'},{status:409});
  } catch(error) {throw new AccessError(error instanceof Error?error.message:'Shared assignment storage is unavailable.',503);}
}
export async function loadPlans(repo:Repo,workspace:Workspace) {
  const response=await planStore(repo);if(!response.ok)throw new AccessError('Shared assignment storage could not be read.',503);
  const snapshot=await response.json() as PlansSnapshot;
  for(const pr of workspace.prs){const plan=snapshot.plans.find(p=>p.prId===pr.id);if(plan){pr.plannedReviewerIds=plan.reviewerIds;pr.plannedReviewerIdentities=plan.reviewerIdentities;pr.planVersion=plan.version;for(const id of plan.reviewerIds)if(!workspace.reviewers.some(r=>r.id===id))workspace.reviewers.push({id,name:id,initials:id.slice(0,2).toUpperCase(),color:'#8674bd',specialty:'Planned reviewer'});}}
  workspace.activity=snapshot.history.filter(h=>workspace.prs.some(p=>p.id===h.prId)).map(h=>({id:`plan:${h.id}`,at:h.updatedAt,prId:h.prId,stackId:workspace.prs.find(p=>p.id===h.prId)!.stackId,message:`${h.actor} planned ${h.reviewerIds.length?h.reviewerIds.join(', '):'no reviewers'} (version ${h.version}).`,kind:'intent'}));
}
export function parsePlan(value:unknown):{repository:string;prId:string;reviewerIds:string[];version:number} {
  if(!value||typeof value!=='object')throw new AccessError('Invalid planned assignment.',400);
  const v=value as Record<string,unknown>;
  if(typeof v.repository!=='string'||typeof v.prId!=='string'||!v.prId||v.prId.length>200||!Number.isSafeInteger(v.version)||Number(v.version)<0||!Array.isArray(v.reviewerIds)||v.reviewerIds.length>20||v.reviewerIds.some(id=>typeof id!=='string'||! /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(id))||new Set(v.reviewerIds.map(id=>String(id).toLowerCase())).size!==v.reviewerIds.length)throw new AccessError('Invalid planned assignment. Choose up to 20 distinct GitHub users.',400);
  return v as {repository:string;prId:string;reviewerIds:string[];version:number};
}
export async function updatePlan(request:Request,data:Session) {
  const origin=configuration()?.origin;
  if(!origin||request.headers.get('Origin')!==origin||new URL(request.url).origin!==origin||request.headers.get('Sec-Fetch-Site')==='cross-site')throw new AccessError('Assignment updates must come from this site.',403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AccessError('Expected a JSON planned assignment.',415);
  if(Number(request.headers.get('Content-Length'))>16000)throw new AccessError('Assignment payload too large.',413);
  const text=new TextDecoder().decode(await boundedBody(request,16000));
  let body:unknown;try{body=JSON.parse(text);}catch{throw new AccessError('Invalid JSON.',400);}
  const input=parsePlan(body);const actor=await verifyIdentity(data);const repo=await validateRepositoryAccess(data,input.repository);
  // Resolve stable node ID inside this authorized repository, then use the REST PR for fresh author/state.
  const {graphQuery}=await import('./github');
  const found=await graphQuery<{node:null|{__typename:string;number?:number;repository?:{databaseId:number};author?:{login:string}}}>(data.token,`query PlanTarget($id:ID!) {node(id:$id) {__typename ... on PullRequest {number repository {databaseId} author {login}}}}`,{id:input.prId});
  if(found.node?.__typename!=='PullRequest'||found.node.repository?.databaseId!==repo.id||!found.node.number)throw new AccessError('This pull request does not belong to the selected repository.',404);
  const pr=await github<{node_id:string;state:string;merged:boolean;user:{id:number;login:string}}>(data.token,`/repos/${repo.full_name}/pulls/${found.node.number}`);
  if(pr.node_id!==input.prId||pr.state!=='open'||pr.merged)throw new AccessError('Only open pull requests can have planned assignments.',409);
  if(String(pr.user.id)!==String(actor.id)) {
    const access=await github<{permission:string}>(data.token,`/repos/${repo.full_name}/collaborators/${encodeURIComponent(actor.login)}/permission`);
    if(!['admin','maintain','write'].includes(access.permission))throw new AccessError('Only the PR author or a repository writer can edit its planned assignment.');
  }
  const snapshotResponse=await planStore(repo);if(!snapshotResponse.ok)throw new AccessError('Shared assignment storage could not be read.',503);
  const snapshot=await snapshotResponse.json() as PlansSnapshot;const previous=snapshot.plans.find(p=>p.prId===input.prId);
  if(input.version!==(previous?.version??0))return Response.json({error:'Someone changed this assignment. Refresh the repository before editing again.'},{status:409});
  const canonical:string[]=[];const reviewerIdentities:{id:string;login:string}[]=[];
  for(const login of input.reviewerIds) {
    if(login.toLowerCase()===pr.user.login.toLowerCase())throw new AccessError('The PR author cannot be a planned reviewer.',400);
    const target=await github<{permission:string;user:{id:number;login:string;type:string}}>(data.token,`/repos/${repo.full_name}/collaborators/${encodeURIComponent(login)}/permission`);
    if(!target.user||target.user.type!=='User'||!['read','triage','write','maintain','admin'].includes(target.permission)||target.user.id===pr.user.id)throw new AccessError(`@${login} is not a verified repository reviewer.`,400);
    const prior=previous?.reviewerIdentities?.find(r=>r.login.toLowerCase()===login.toLowerCase());
    if(prior&&prior.id!==String(target.user.id))throw new AccessError(`@${login} no longer identifies the saved GitHub account. Remove the assignment before choosing a replacement.`,409);
    if(reviewerIdentities.some(r=>r.id===String(target.user.id)))throw new AccessError('Each reviewer can appear only once, including renamed accounts.',400);
    canonical.push(target.user.login);reviewerIdentities.push({id:String(target.user.id),login:target.user.login});
  }
  return planStore(repo,'PUT',{prId:input.prId,reviewerIds:canonical,reviewerIdentities,version:input.version,actor:actor.login,actorId:String(actor.id),updatedAt:new Date().toISOString()});
}
