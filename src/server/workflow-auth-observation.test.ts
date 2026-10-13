import {afterEach,describe,expect,it,vi} from 'vitest';
import {AuthenticationError} from './auth';
import {GitHubWorkflowTransport} from './workflow-github';
vi.mock('./plans',()=>({loadPlans:vi.fn(async()=>{})}));

const repo={id:4,installationId:9,full_name:'fixture/repo',private:true};
const failures=['metadata','map','classicPolicy','rules','reviewerPermission','timeline','reviews'] as const;
type Failure=typeof failures[number];
function setup(failure:Failure,background=false){
  const raw={id:'P1',number:1,title:'Fixture',url:'https://github.com/fixture/repo/pull/1',bodyText:'',isDraft:true,state:'OPEN',headRefName:'feature',baseRefName:'main',headRepository:{id:'R4',nameWithOwner:repo.full_name},baseRepository:{id:'R4',nameWithOwner:repo.full_name},additions:1,deletions:0,reviewDecision:null,mergeable:'MERGEABLE',author:{login:'alice',databaseId:1},statusCheckRollup:null,suggestedReviewers:[],reviews:{nodes:[{id:'RV1',fullDatabaseId:'1',state:'APPROVED',submittedAt:'2026-10-12T11:00:00Z',author:{login:'sam',databaseId:2}}],pageInfo:{hasNextPage:failure==='reviews',endCursor:'more'}},reviewRequests:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}},timelineItems:{nodes:[],pageInfo:{hasNextPage:failure==='timeline',endCursor:'more'}},labels:{nodes:[]}};
  const network=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(input);const body=init?.body?JSON.parse(String(init.body)):null;
    if(url.endsWith('/user'))return Response.json({id:1,login:'alice'});
    if(url.includes('/user/installations?'))return Response.json({installations:[{id:9}]});
    if(url.includes('/user/installations/9/repositories?'))return Response.json({repositories:[repo]});
    if(url.includes('/collaborators/alice/permission'))return Response.json({permission:'write',user:{id:1,login:'alice'}});
    if(url.endsWith('/repos/fixture/repo'))return failure==='metadata'?new Response(null,{status:401}):Response.json({id:4,default_branch:'main',archived:false});
    if(url.includes('/rules/branches/'))return failure==='rules'?new Response(null,{status:401}):Response.json([]);
    if(url.includes('/collaborators/sam/permission'))return failure==='reviewerPermission'?new Response(null,{status:401}):Response.json({permission:'read',user:{id:2,login:'sam'}});
    if(body?.query.includes('WorkflowMap')&&failure==='map'||body?.query.includes('WorkflowClassicPolicy')&&failure==='classicPolicy'||body?.query.includes('WorkflowTimeline')&&failure==='timeline'||body?.query.includes('WorkflowReviews')&&failure==='reviews')return new Response(null,{status:401});
    if(body?.query.includes('WorkflowClassicPolicy'))return Response.json({data:{repository:{b0:{branchProtectionRule:null}}}});
    if(body?.query.includes('WorkflowMap')||body?.query.includes('WorkflowAncestry'))return Response.json({data:{repository:{id:'R4',databaseId:4,defaultBranchRef:{name:'main'},viewerPermission:'WRITE',pullRequests:{nodes:body.query.includes('WorkflowAncestry')?[]:[raw],pageInfo:{hasNextPage:false,endCursor:null}}}}});
    throw new Error('Unexpected fixture endpoint.');
  });vi.stubGlobal('fetch',network);
  const loadWorkspacePlans=vi.fn(async()=>{});
  const transport=new GitHubWorkflowTransport({repository:repo.full_name,enabled:false,loadWorkspacePlans,...background?{principal:async()=>({token:'fixture-installation-token',actor:{id:'99',login:'fixture-bot',canWrite:true},repository:repo,authorizeScope:async()=>true})}:{session:{token:'fixture-user-token',userId:'1',login:'alice',expires:Date.now()+60000}}});
  return {transport,network};
}
afterEach(()=>vi.unstubAllGlobals());
describe('workflow authorization lost during observation',()=>{
  it.each(failures)('propagates a session 401 from %s instead of masking it as a transient or incomplete read',async failure=>{
    const {transport,network}=setup(failure);
    await expect(transport.fetchView()).rejects.toBeInstanceOf(AuthenticationError);
    expect(network.mock.calls.some(([,init])=>String(init?.body).includes('mutation'))).toBe(false);
  });
  it.each(['metadata','map','reviews'] as const)('keeps an installation 401 from %s distinct from user sign-in loss',async failure=>{
    const {transport,network}=setup(failure,true);
    await expect(transport.fetchView()).rejects.not.toBeInstanceOf(AuthenticationError);
    expect(network.mock.calls.some(([url])=>String(url).endsWith('/user'))).toBe(false);
  });
  it.each(['classicPolicy','rules','reviewerPermission','timeline'] as const)('retains conservative incomplete policy/evidence for an installation 401 from %s',async failure=>{
    const {transport}=setup(failure,true);const {snapshot}=await transport.fetchView();
    if(failure==='classicPolicy'||failure==='rules')expect(snapshot.prs[0].githubGate).toBe('unknown');
    if(failure==='reviewerPermission')expect(snapshot.prs[0].reviewsComplete).toBe(false);
    if(failure==='timeline')expect(snapshot.prs[0].eventIds).toBeUndefined();
  });
});
