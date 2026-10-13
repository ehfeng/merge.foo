import {github,revalidateIdentity,type Session} from './auth';
import type { PullRequest, Reviewer, Workspace } from '../domain/types';

export type Repo = {id:number;full_name:string;private:boolean;installationId:number;canRequestReviews?:boolean};
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
  if(!response.ok)throw new AccessError(response.status===401?'GitHub session expired. Sign in again.':`GitHub graph read failed (${response.status}).`,response.status===401?401:502);
  const result=await response.json() as {data?:T;errors?:unknown[]};
  if(result.errors||!result.data)throw new Error('GitHub could not read this repository. Check the App installation and read permissions.');
  return result.data;
}
const fields=`id number title url bodyText isDraft state headRefName baseRefName headRepository {id nameWithOwner} baseRepository {id nameWithOwner} additions deletions reviewDecision mergeable author {login} statusCheckRollup {state}
  suggestedReviewers {reviewer {login} isAuthor isCommenter}
  reviews(last:100) {nodes {author {login} state submittedAt}}
  reviewRequests(first:100) {nodes {requestedReviewer {... on User {login} ... on Team {slug}}}}
  timelineItems(last:100,itemTypes:[REVIEW_REQUESTED_EVENT]) {nodes {... on ReviewRequestedEvent {createdAt requestedReviewer {... on User {login}}}}}
  labels(first:20) {nodes {name}}`;
type Page={repository:null|{viewerPermission:string;pullRequests:{nodes:GqlPr[];pageInfo:{hasNextPage:boolean;endCursor:string|null}}}};
export async function fetchRepository(data:Session,fullName:string):Promise<{workspace:Workspace;warnings:string[];repo:Repo}> {
  const repo=await validateRepositoryAccess(data,fullName);
  const [owner,name]=repo.full_name.split('/'); const all:GqlPr[]=[];
  let cursor:string|null=null;let permission='READ';
  for(let page=0;page<100;page++) {
    const result:Page=await graphQuery<Page>(data.token,`query WorkMap($owner:String!,$name:String!,$cursor:String) {repository(owner:$owner,name:$name) {viewerPermission pullRequests(first:50,after:$cursor,states:OPEN,orderBy:{field:CREATED_AT,direction:ASC}) {pageInfo {hasNextPage endCursor} nodes {${fields}}}}}`,{owner,name,cursor});
    if(!result.repository)throw new AccessError('Repository access is no longer available.');
    permission=result.repository.viewerPermission;all.push(...result.repository.pullRequests.nodes);
    if(!result.repository.pullRequests.pageInfo.hasNextPage)break;
    const next=result.repository.pullRequests.pageInfo.endCursor;
    if(!next||next===cursor||page===99)throw new Error('Open PR pagination could not complete. No partial graph was shown.');
    cursor=next;
  }
  // Recent merged ancestry is deliberately bounded; never imply complete historical coverage.
  const history=await graphQuery<Page>(data.token,`query Ancestry($owner:String!,$name:String!) {repository(owner:$owner,name:$name) {viewerPermission pullRequests(first:100,states:MERGED,orderBy:{field:UPDATED_AT,direction:DESC}) {pageInfo {hasNextPage endCursor} nodes {${fields}}}}}`,{owner,name});
  const merged=history.repository?.pullRequests.nodes??[];
  const selected=new Set(all.map(p=>p.id));
  for(let pass=0;pass<merged.length;pass++)for(const candidate of merged)if(!selected.has(candidate.id)&&[...all,...merged.filter(p=>selected.has(p.id))].some(p=>sameBranch(candidate,p))){selected.add(candidate.id);}
  const normalized=normalize([...all,...merged.filter(p=>selected.has(p.id))],repo.full_name);
  normalized.warnings.push('All open PRs across authors loaded. Merged ancestry covers matching branches among the 100 most recently updated merged PRs; older or deleted branches may be missing.');
  for(const pr of normalized.workspace.prs)pr.canEditPlan=pr.lifecycle==='open'&&(pr.author.toLowerCase()===data.login.toLowerCase()||['ADMIN','MAINTAIN','WRITE'].includes(permission));
  return {...normalized,repo};
}
function sameBranch(parent:GqlPr,child:GqlPr) {
  // Missing repository identity is unsafe, particularly for forks with repeated branch names.
  return parent.id!==child.id&&!!parent.headRepository&&!!child.baseRepository&&parent.headRepository.id===child.baseRepository.id&&parent.headRefName===child.baseRefName;
}
export function normalize(nodes:GqlPr[],repository:string,truncated=false):{workspace:Workspace;warnings:string[]} {
  const warnings:string[]=['GitHub snapshot with shared planned assignments. Assignments send no review request or notification.','Repository coverage only. Request and review history is limited to the latest 100 events per PR; observed reviewer load is partial.'];
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
      plannedReviewerIds:[],planVersion:0,suggestedReviewers:(p.suggestedReviewers??[]).filter(s=>s!==null).map(s=>({reviewerId:register(s.reviewer.login),isAuthor:s.isAuthor,isCommenter:s.isCommenter})),requests,reviews:p.reviews.nodes.filter(r=>r.author&&['APPROVED','CHANGES_REQUESTED','COMMENTED'].includes(r.state)).map(r=>({reviewerId:register(r.author!.login),decision:r.state==='APPROVED'?'approved':r.state==='CHANGES_REQUESTED'?'changes_requested':'commented',contentVersion:1,at:r.submittedAt})),
      lines:{added:p.additions,deleted:p.deletions,discounted:0,reason:'No effective-LOC discounts calculated for live data.'},complexity:'Unknown',risk:'Unknown',riskReason:'Risk and complexity have not been assessed.',priority:p.labels.nodes.some(l=>/urgent|p0/i.test(l.name))?'Urgent':'Normal'};
  });
  const stacks=[...new Set(prs.map(p=>p.stackId))].map((id,index)=>({id,title:prs.find(p=>p.id===id)?.title??'Related pull requests',description:`${repository} · observed repository and branch relationship`,autoProgress:false,color:['#8171d4','#d79661','#66a09b'][index%3]}));
  if(!prs.length)warnings.push('No open PRs found in this repository.');
  return {workspace:{schemaVersion:1,prs,stacks,reviewers:[...reviewers.values()],activity:[],handledEventIds:[]},warnings};
}
