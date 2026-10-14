import {github,revalidateIdentity,type Session} from './auth';
import type { PullRequest, Reviewer, Workspace } from '../domain/types';

export type Repo = {id:number;full_name:string;private:boolean;installationId:number;canRequestReviews?:boolean};
/** Trusted server-side transport. A local companion can use gh without exporting its credential. */
export type GitHubApi = {
  request<T>(path:string,method?:string,body?:unknown):Promise<T>;
  graph<T>(query:string,variables:Record<string,unknown>):Promise<T>;
};
type InstalledRepo=Omit<Repo,'installationId'>&{archived?:boolean};
type GqlUser = {login:string};
type RepoIdentity={id:string;nameWithOwner:string};
export type GqlPr = {id:string;number:number;title:string;url:string;bodyText:string;isDraft:boolean;headRefName:string;baseRefName:string;
  headRepository?:RepoIdentity|null;baseRepository?:RepoIdentity|null;state?:string;
  additions:number;deletions:number;reviewDecision:string|null;mergeable:string;author:GqlUser|null;
  suggestedReviewers?:({reviewer:GqlUser;isAuthor:boolean;isCommenter:boolean}|null)[];
  statusCheckRollup:{state:string}|null;reviews:{nodes:{author:GqlUser|null;state:string;submittedAt:string}[]};
  reviewRequests:{nodes:{requestedReviewer:GqlUser|null}[]};
  timelineItems:{nodes:{createdAt?:string;requestedReviewer?:GqlUser}[]};labels:{nodes:{name:string}[]};};
export class AccessError extends Error {constructor(message:string,public status=403){super(message);}}
/** Partial GraphQL results are never usable; only explicit resource/deadline
 * failures may be retried with a smaller read. Mixed permission/rate failures
 * must propagate even when another error reports a timeout. */
export function isTransientGraphFailure(errors:unknown):boolean {
  if(!Array.isArray(errors)||!errors.length)return false;
  return errors.every(error=>{
    if(!error||typeof error!=='object')return false;
    const {type,message}=error as {type?:unknown;message?:unknown};
    if(typeof type==='string'&&['FORBIDDEN','UNAUTHORIZED','NOT_FOUND','RATE_LIMITED','GRAPHQL_VALIDATION_FAILED'].includes(type))return false;
    return typeof type==='string'&&['TIMEOUT','MAX_NODE_LIMIT_EXCEEDED','RESOURCE_LIMIT_EXCEEDED'].includes(type)
      ||typeof message==='string'&&/could(?:n['’]t| not) respond to your request in time|resource limits? (?:were |was )?exceeded|query(?: execution)? timed out|exceeds the maximum (?:number of nodes|node limit)/i.test(message);
  });
}
async function allPages<T>(token:string,path:string,field?:string): Promise<T[]> {
  const list:T[]=[];
  for(let page=1;page<=50;page++) {
    const result=await github<T[]|Record<string,T[]>>(token,`${path}${path.includes('?')?'&':'?'}per_page=100&page=${page}`);
    const values=field?(result as Record<string,T[]>)[field]:result as T[];
    if(!Array.isArray(values))throw new Error('Unexpected GitHub response.');
    list.push(...values); if(values.length<100) return list;
  }
  throw new Error('GitHub coverage limit reached. The repository list could not be completed.');
}
export async function repositories(data:Session):Promise<Repo[]> {
  const installs=await allPages<{id:number;permissions?:{pull_requests?:string}}>(data.token,'/user/installations','installations');
  const pages=await Promise.all(installs.map(async i=>(await allPages<InstalledRepo>(data.token,`/user/installations/${i.id}/repositories`,'repositories')).filter(r=>r.archived!==true).map(r=>({...r,installationId:i.id,...(i.permissions?{canRequestReviews:i.permissions.pull_requests==='write'}:{})}))));
  return [...new Map(pages.flat().map(r=>[r.id,{id:r.id,full_name:r.full_name,private:r.private,installationId:r.installationId,...(typeof r.canRequestReviews==='boolean'?{canRequestReviews:r.canRequestReviews}:{})}])).values()];
}
export const verifyIdentity=revalidateIdentity;
export async function validateRepositoryAccess(data:Session,fullName:string):Promise<Repo> {
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) throw new AccessError('Select a valid repository.',400);
  const accessible=await repositories(data);
  const repo=accessible.find(r=>r.full_name.toLowerCase()===fullName.toLowerCase());
  if(!repo) throw new AccessError('This repository is archived or outside your authorized App installation. Choose a non-archived repository or update repository access in GitHub.');
  return repo;
}
export async function graphQuery<T>(token:string,query:string,variables:Record<string,unknown>):Promise<T> {
  const response=await fetch('https://api.github.com/graphql',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','User-Agent':'merge.foo'},cache:'no-store',signal:AbortSignal.timeout(20000),body:JSON.stringify({query,variables})});
  if(!response.ok)throw Object.assign(new AccessError(response.status===401?'GitHub session expired. Sign in again.':`GitHub graph read failed (${response.status}).`,response.status===401?401:502),{readRetryable:[502,503,504].includes(response.status)});
  const result=await response.json() as {data?:T;errors?:unknown[]};
  if(result.errors||!result.data) {
    const readRetryable=isTransientGraphFailure(result.errors);
    throw Object.assign(new AccessError(readRetryable?'GitHub timed out while reading this repository. Refresh to try again.':'GitHub could not read this repository. Check the App installation and read permissions.',502),{readRetryable});
  }
  return result.data;
}
export async function fetchReviewerSuggestions(repo:Repo,prId:string,api:GitHubApi):Promise<{suggestedReviewers:NonNullable<PullRequest['suggestedReviewers']>;reviewers:Reviewer[]}> {
  if(typeof prId!=='string'||!prId||prId.length>200)throw new AccessError('Select a valid pull request.',400);
  const result=await api.graph<{node:null|{__typename:string;repository?:{databaseId:number};suggestedReviewers?:GqlPr['suggestedReviewers']}}>(`query SelectedReviewers($id:ID!) {node(id:$id) {__typename ... on PullRequest {repository {databaseId} suggestedReviewers {reviewer {login} isAuthor isCommenter}}}}`,{id:prId});
  if(result.node?.__typename!=='PullRequest'||result.node.repository?.databaseId!==repo.id)throw new AccessError('This pull request does not belong to the selected repository.',404);
  if(!Array.isArray(result.node.suggestedReviewers))throw new AccessError('GitHub reviewer suggestions are unavailable.',502);
  const reviewers=new Map<string,Reviewer>();
  const suggestedReviewers=result.node.suggestedReviewers.filter(s=>s!==null).map(s=>{
    const login=s.reviewer?.login;
    if(typeof login!=='string'||!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login))throw new AccessError('GitHub returned an invalid suggested reviewer.',502);
    reviewers.set(login,{id:login,name:login,initials:login.slice(0,2).toUpperCase(),color:'#8674bd',specialty:'GitHub reviewer'});
    return {reviewerId:login,isAuthor:s.isAuthor,isCommenter:s.isCommenter};
  });
  return {suggestedReviewers,reviewers:[...reviewers.values()]};
}
const fields=`id number title url bodyText isDraft state headRefName baseRefName headRepository {id nameWithOwner} baseRepository {id nameWithOwner} additions deletions reviewDecision mergeable author {login} statusCheckRollup {state}
  reviews(last:100) {nodes {author {login} state submittedAt}}
  reviewRequests(first:100) {nodes {requestedReviewer {... on User {login} ... on Team {slug}}}}
  timelineItems(last:100,itemTypes:[REVIEW_REQUESTED_EVENT]) {nodes {... on ReviewRequestedEvent {createdAt requestedReviewer {... on User {login}}}}}
  labels(first:20) {nodes {name}}`;
const ancestryFields='id state headRefName baseRefName headRepository {id nameWithOwner} baseRepository {id nameWithOwner}';
type AncestryPr=Pick<GqlPr,'id'|'state'|'headRefName'|'baseRefName'|'headRepository'|'baseRepository'>;
type HistoryPage={repository:null|{pullRequests:{nodes:AncestryPr[];pageInfo:{hasNextPage:boolean;endCursor:string|null}}}};
type Page={repository:null|{viewerPermission:string;pullRequests:{nodes:GqlPr[];pageInfo:{hasNextPage:boolean;endCursor:string|null}}}};
// GitHub terminates expensive GraphQL reads after ten seconds. Only explicitly
// classified upstream failures may shrink a read; authentication, rate limits,
// malformed responses and cancellation must propagate without another request.
function canReduceRead(error:unknown):boolean {
  if(!error||typeof error!=='object')return false;
  const failure=error as {name?:string;readRetryable?:boolean};
  return failure.name!=='AbortError'&&(failure.readRetryable===true||failure.name==='TimeoutError');
}
const openPageSizes=[20,10,5,1] as const;
const maxOpenPrs=5000;
export async function fetchRepository(data:Session,fullName:string):Promise<{workspace:Workspace;warnings:string[];repo:Repo}> {
  const repo=await validateRepositoryAccess(data,fullName);
  return fetchRepositoryWith({id:Number(data.userId),login:data.login},repo,{
    request:<T>(path:string)=>github<T>(data.token,path),
    graph:<T>(query:string,variables:Record<string,unknown>)=>graphQuery<T>(data.token,query,variables),
  });
}
/** Caller must freshly verify the identity and repository grant before invoking this reader. */
export async function fetchRepositoryWith(identity:{id:number;login:string},repo:Repo,api:GitHubApi):Promise<{workspace:Workspace;warnings:string[];repo:Repo}> {
  const [owner,name]=repo.full_name.split('/'); const all:GqlPr[]=[];
  let cursor:string|null=null;let permission='READ';let sizeIndex=0;
  const seenCursors=new Set<string>();const seenPrs=new Set<string>();
  // Reviewer suggestions are read separately for the selected PR to meet GitHub's query deadline.
  // Reduce only a failed page, at its original cursor, and retain the smaller
  // size for subsequent pages. The coverage bound counts PRs, not pages.
  for(let page=0;page<maxOpenPrs;page++) {
    let result:Page;
    for(;;) {
      try {
        result=await api.graph<Page>(`query WorkMap($owner:String!,$name:String!,$cursor:String,$first:Int!) {repository(owner:$owner,name:$name) {viewerPermission pullRequests(first:$first,after:$cursor,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}) {pageInfo {hasNextPage endCursor} nodes {${fields}}}}}`,{owner,name,cursor,first:openPageSizes[sizeIndex]});
        break;
      } catch(error) {
        if(!canReduceRead(error)||sizeIndex===openPageSizes.length-1)throw error;
        sizeIndex++;
      }
    }
    if(!result.repository)throw new AccessError('Repository access is no longer available.');
    const {nodes,pageInfo}=result.repository.pullRequests;
    if(!Array.isArray(nodes)||nodes.length>openPageSizes[sizeIndex]||!pageInfo||typeof pageInfo.hasNextPage!=='boolean')throw new Error('Open PR pagination changed while loading. Refresh the repository. No partial graph was shown.');
    for(const pr of nodes){if(!pr||typeof pr.id!=='string'||!pr.id||seenPrs.has(pr.id))throw new Error('Open PR pagination changed while loading. Refresh the repository. No partial graph was shown.');seenPrs.add(pr.id);}
    if(all.length+nodes.length>maxOpenPrs)throw new Error('Open PR pagination could not complete. No partial graph was shown.');
    permission=result.repository.viewerPermission;all.push(...nodes);
    if(!pageInfo.hasNextPage)break;
    const next=pageInfo.endCursor;
    if(!nodes.length||typeof next!=='string'||!next||seenCursors.has(next)||all.length===maxOpenPrs||page===maxOpenPrs-1)throw new Error('Open PR pagination could not complete. No partial graph was shown.');
    seenCursors.add(next);cursor=next;
  }
  // Recent merged ancestry is deliberately bounded; never imply complete historical coverage.
  const merged:AncestryPr[]=[];let historyCursor:string|null=null;
  for(let page=0;page<4;page++) {
    const history:HistoryPage=await api.graph<HistoryPage>(`query Ancestry($owner:String!,$name:String!,$cursor:String) {repository(owner:$owner,name:$name) {pullRequests(first:25,after:$cursor,states:MERGED,orderBy:{field:UPDATED_AT,direction:DESC}) {pageInfo {hasNextPage endCursor} nodes {${ancestryFields}}}}}`,{owner,name,cursor:historyCursor});
    if(!history.repository)throw new AccessError('Repository access is no longer available.');
    merged.push(...history.repository.pullRequests.nodes);
    if(!history.repository.pullRequests.pageInfo.hasNextPage)break;
    const next:string|null=history.repository.pullRequests.pageInfo.endCursor;
    if(!next||next===historyCursor)throw new Error('Merged ancestry pagination could not complete.');
    historyCursor=next;
  }
  const selected=new Set(all.map(p=>p.id));
  for(let pass=0;pass<merged.length;pass++)for(const candidate of merged)if(!selected.has(candidate.id)&&[...all,...merged.filter(p=>selected.has(p.id))].some(p=>sameBranch(candidate,p))){selected.add(candidate.id);}
  // Read full reviews only for ancestors that actually connect to an open PR.
  const ids=merged.filter(p=>selected.has(p.id)).map(p=>p.id);const ancestors:GqlPr[]=[];
  for(let offset=0;offset<ids.length;offset+=5) {
    const batch=ids.slice(offset,offset+5);
    const result=await api.graph<{nodes:((GqlPr&{repository:{databaseId:number}})|null)[]}>(`query WorkMapAncestors($ids:[ID!]!) {nodes(ids:$ids) {... on PullRequest {repository {databaseId} ${fields}}}}`,{ids:batch});
    if(!Array.isArray(result.nodes)||result.nodes.length!==batch.length||result.nodes.some((pr,index)=>!pr||pr.id!==batch[index]||pr.state!=='MERGED'||pr.repository?.databaseId!==repo.id))throw new AccessError('Merged ancestry changed while loading. Refresh the repository.',409);
    ancestors.push(...result.nodes as GqlPr[]);
  }
  const normalized=normalize([...all,...ancestors],repo.full_name);
  normalized.warnings.push('All open PRs across authors loaded. Merged ancestry covers matching branches among the 100 most recently updated merged PRs; older or deleted branches may be missing.');
  for(const pr of normalized.workspace.prs)pr.canEditPlan=pr.lifecycle==='open'&&(pr.author.toLowerCase()===identity.login.toLowerCase()||['ADMIN','MAINTAIN','WRITE'].includes(permission));
  return {...normalized,repo};
}
function sameBranch(parent:AncestryPr,child:AncestryPr) {
  // Missing repository identity is unsafe, particularly for forks with repeated branch names.
  return parent.id!==child.id&&!!parent.headRepository&&!!child.baseRepository&&parent.headRepository.id===child.baseRepository.id&&parent.headRefName===child.baseRefName;
}
export function normalize(nodes:GqlPr[],repository:string,truncated=false):{workspace:Workspace;warnings:string[]} {
  const warnings:string[]=['GitHub snapshot. Planned assignments send no review request or notification.','Repository coverage only. Request and review history is limited to the latest 100 events per PR; observed reviewer load is partial.'];
  if(truncated)warnings.push('Partial PR coverage. Dependencies may be incomplete.');
  const parent=new Map<string,string>();
  for(const node of nodes) {
    const candidates=nodes.filter(p=>sameBranch(p,node));
    if(candidates.length===1)parent.set(node.id,candidates[0].id);
    if(candidates.length>1)warnings.push(`#${node.number}: ambiguous base branch; shown independently.`);
    if(!node.headRepository||!node.baseRepository)warnings.push(`#${node.number}: missing repository identity; dependency not inferred.`);
  }
  for(const id of parent.keys()){const seen=new Set([id]);let current=parent.get(id);while(current){if(seen.has(current)){for(const member of seen)parent.delete(member);warnings.push('Cyclic branch relationship ignored.');break;}seen.add(current);current=parent.get(current);}}
  const root=(id:string):string=>{let current=id;while(parent.has(current))current=parent.get(current)!;return current;};
  const reviewers=new Map<string,Reviewer>();
  const register=(login:string)=>{reviewers.set(login,{id:login,name:login,initials:login.slice(0,2).toUpperCase(),color:'#8674bd',specialty:'GitHub reviewer'});return login;};
  const prs:PullRequest[]=nodes.map(p=>{
    const requests=p.reviewRequests.nodes.filter(r=>r.requestedReviewer?.login).map(r=>{const id=register(r.requestedReviewer!.login);const dates=p.timelineItems.nodes.filter(e=>e.requestedReviewer?.login===id&&e.createdAt).map(e=>e.createdAt!).sort();return {reviewerId:id,requestedAt:dates.at(-1)??'',key:`github:${p.id}:${id}`};});
    if(p.reviewRequests.nodes.some(r=>r.requestedReviewer&&!r.requestedReviewer.login))warnings.push(`#${p.number}: team review requests are present; individual load is incomplete.`);
    return {id:p.id,number:p.number,title:p.title,url:p.url,stackId:root(p.id),parentId:parent.get(p.id),repository,branch:p.headRefName,author:p.author?.login??'Unknown',summary:p.bodyText?.slice(0,1200)||'No pull request description.',areas:[],
      lifecycle:p.state==='MERGED'?'merged':p.state==='CLOSED'?'closed':'open',readiness:p.isDraft?'draft':'ready',held:false,checks:p.statusCheckRollup?.state==='SUCCESS'?'passing':p.statusCheckRollup?.state==='FAILURE'?'failing':'pending',mergeability:p.mergeable==='MERGEABLE'?'clean':p.mergeable==='CONFLICTING'?'conflicts':'unknown',contentVersion:1,validity:'fresh',requiredApprovals:0,observedGate:p.reviewDecision==='APPROVED'?'approved':p.reviewDecision==='CHANGES_REQUESTED'?'changes_requested':p.reviewDecision==='REVIEW_REQUIRED'?'review_required':'unknown',
      plannedReviewerIds:[],planVersion:0,suggestedReviewers:p.suggestedReviewers?.filter(s=>s!==null).map(s=>({reviewerId:register(s.reviewer.login),isAuthor:s.isAuthor,isCommenter:s.isCommenter})),requests,reviews:p.reviews.nodes.filter(r=>r.author&&['APPROVED','CHANGES_REQUESTED','COMMENTED'].includes(r.state)).map(r=>({reviewerId:register(r.author!.login),decision:r.state==='APPROVED'?'approved':r.state==='CHANGES_REQUESTED'?'changes_requested':'commented',contentVersion:1,at:r.submittedAt})),
      lines:{added:p.additions,deleted:p.deletions,discounted:0,reason:'No effective-LOC discounts calculated for live data.'},complexity:'Unknown',risk:'Unknown',riskReason:'Risk and complexity have not been assessed.',priority:p.labels.nodes.some(l=>/urgent|p0/i.test(l.name))?'Urgent':'Normal'};
  });
  const stacks=[...new Set(prs.map(p=>p.stackId))].map((id,index)=>({id,title:prs.find(p=>p.id===id)?.title??'Related pull requests',description:`${repository} · observed repository and branch relationship`,autoProgress:false,color:['#8171d4','#d79661','#66a09b'][index%3]}));
  if(!prs.length)warnings.push('No open PRs found in this repository.');
  return {workspace:{schemaVersion:1,prs,stacks,reviewers:[...reviewers.values()],activity:[],handledEventIds:[]},warnings};
}
