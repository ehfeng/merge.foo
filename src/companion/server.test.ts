import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {request as httpRequest} from 'node:http';
import {createCompanion,validateOptions} from './server';
import type {GitHubApi} from '../server/github';

vi.mock('../server/state/store',()=>({getStateStore:vi.fn(()=>{throw new Error('Hosted storage must never be used by the companion.');})}));

const origin='https://merge.foo';const running:Awaited<ReturnType<typeof createCompanion>>[]=[];const directories:string[]=[];
afterEach(async()=>{for(const companion of running.splice(0))await companion.close();for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
const rawPr={id:'PR_node',number:1,title:'Private PR title',url:'https://github.com/kernel/work/pull/1',bodyText:'Private description',isDraft:true,state:'OPEN',headRefName:'feature',baseRefName:'main',headRepository:{id:'repo_node',nameWithOwner:'kernel/work'},baseRepository:{id:'repo_node',nameWithOwner:'kernel/work'},additions:10,deletions:2,reviewDecision:'REVIEW_REQUIRED',mergeable:'MERGEABLE',author:{login:'alice'},suggestedReviewers:[],statusCheckRollup:null,reviews:{nodes:[]},reviewRequests:{nodes:[]},timelineItems:{nodes:[]},labels:{nodes:[]}};
async function fixture(readOnly=false){
  const stateDir=await mkdtemp(join(tmpdir(),'mergefoo-server-test-'));directories.push(stateDir);
  const state={user:{id:11,login:'alice'},metadata:{id:99,full_name:'kernel/work',private:true,archived:false},permission:'write',reviewer:{id:22,login:'Reviewer',type:'User'},suggestionRepoId:99};
  const request=vi.fn(async(path:string,method='GET')=>{
    if(method!=='GET')throw new Error('No GitHub write is permitted in these tests.');
    if(path==='/user')return state.user;if(path==='/repos/kernel/work')return state.metadata;
    if(path==='/repos/kernel/work/pulls/1')return {node_id:'PR_node',state:'open',merged:false,user:{id:11,login:'alice'}};
    if(path.endsWith('/collaborators/alice/permission'))return {permission:state.permission,user:{id:11,login:'alice'}};
    if(path.includes('/collaborators/'))return {permission:'read',user:state.reviewer};throw new Error(`Unexpected fixture path ${path}`);
  });
  const graph=vi.fn(async(query:string):Promise<unknown>=>{
    if(query.includes('PlanTarget'))return {node:{__typename:'PullRequest',number:1,repository:{databaseId:99}}};
    if(query.includes('SelectedReviewers'))return {node:{__typename:'PullRequest',repository:{databaseId:state.suggestionRepoId},suggestedReviewers:[{reviewer:{login:'Reviewer'},isAuthor:false,isCommenter:true}]}};
    return {repository:{viewerPermission:'WRITE',pullRequests:{nodes:query.includes('Ancestry')?[]:[rawPr],pageInfo:{hasNextPage:false,endCursor:null}}}};
  });
  const api={request,graph} as unknown as GitHubApi;const companion=await createCompanion({origin,port:0,repositories:['kernel/work'],stateDir,readOnly,pollIntervalMs:3600000},{api});running.push(companion);const {port,pairUrl}=await companion.listen();const base=`http://127.0.0.1:${port}`;
  const call=(path:string,init:RequestInit={})=>fetch(`${base}${path}`,{...init,headers:{Origin:origin,Authorization:`Bearer ${companion.capability}`,...init.body?{'Content-Type':'application/json'}:undefined,...init.headers}});
  return {state,request,graph,companion,port,pairUrl,base,call,stateDir};
}
const planBody=(version=0,reviewerIds=['reviewer'])=>JSON.stringify({repository:'kernel/work',prId:'PR_node',reviewerIds,version});
const rawStatus=(url:string,headers:Record<string,string>)=>new Promise<number>((resolve,reject)=>{const request=httpRequest(url,{headers},response=>{response.resume();resolve(response.statusCode!);});request.on('error',reject);request.end();});

describe('scoped loopback companion routes',()=>{
  it('requires exact Host, Origin and random bearer capability on reads and writes',async()=>{
    const f=await fixture();expect(f.companion.capability).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(f.pairUrl).toBe(`${origin}/#companion=${f.companion.capability}&port=${f.port}`);
    expect((await fetch(`${f.base}/api/session`,{headers:{Origin:origin}})).status).toBe(401);
    expect((await f.call('/api/session',{headers:{Origin:'https://merge.foo.evil.example'}})).status).toBe(403);
    expect(await rawStatus(`${f.base}/api/session`,{Host:`localhost:${f.port}`,Origin:origin,Authorization:`Bearer ${f.companion.capability}`})).toBe(403);
    expect((await f.call('/api/session',{headers:{Authorization:`Bearer ${'é'.repeat(43)}`}})).status).toBe(401);
    const response=await f.call('/api/session');expect(response.status).toBe(200);expect(await response.json()).toMatchObject({authenticated:true,login:'alice',connection:'companion'});expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  });
  it('supports exact private-network preflight without exposing arbitrary methods or headers',async()=>{
    const f=await fixture();const preflight=await f.call('/api/github/plans',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'PUT','Access-Control-Request-Headers':'authorization, content-type','Access-Control-Request-Private-Network':'true'}});expect(preflight.status).toBe(204);expect(preflight.headers.get('access-control-allow-private-network')).toBe('true');
    expect((await f.call('/api/github/plans',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'DELETE'}})).status).toBe(403);
    expect((await f.call('/api/session',{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'cookie'}})).status).toBe(403);
    expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('loads private PRs through direct CLI access, leaves automation off, and enforces the repo allowlist',async()=>{
    const f=await fixture();const repositories=await (await f.call('/api/github/repositories')).json();expect(repositories.repositories).toEqual([{id:99,full_name:'kernel/work',private:true,installationId:11}]);
    const loaded=await (await f.call('/api/github/workspace?repository=kernel%2Fwork')).json();expect(loaded.workspace.prs[0].title).toBe('Private PR title');expect(loaded.workspace.stacks[0].autoProgress).toBe(false);expect(loaded.workspace.prs[0].plannedReviewerIds).toEqual([]);expect(loaded.warnings.join(' ')).toContain('saved on this laptop');
    expect((await f.call('/api/github/workspace?repository=kernel%2Fother')).status).toBe(403);expect(f.request.mock.calls.some(([path])=>path.includes('kernel/other'))).toBe(false);
    expect((await f.call('/api/github/proxy?path=/user')).status).toBe(404);expect(f.graph.mock.calls.every(([query])=>!query.trimStart().startsWith('mutation'))).toBe(true);
    await expect(readFile(join(f.stateDir,'state.json'),'utf8')).rejects.toMatchObject({code:'ENOENT'});
  });
  it('rejects gh account switches, changed repository identity and archived repos',async()=>{
    const f=await fixture();await f.call('/api/github/repositories');f.state.metadata.id=100;expect((await f.call('/api/github/repositories')).status).toBe(403);f.state.metadata.id=99;f.state.metadata.archived=true;expect((await f.call('/api/github/repositories')).status).toBe(403);
    f.state.user={id:12,login:'other'};expect((await f.call('/api/session')).status).toBe(401);expect((await f.call('/api/github/plans',{method:'PUT',body:planBody()})).status).toBe(401);
  });
  it('reads suggestions only for a selected PR inside the allowlisted repository',async()=>{
    const f=await fixture();const response=await f.call('/api/github/reviewers?repository=kernel%2Fwork&prId=PR_node');expect(response.status).toBe(200);expect(await response.json()).toMatchObject({suggestedReviewers:[{reviewerId:'Reviewer',isAuthor:false,isCommenter:true}],reviewers:[{id:'Reviewer',name:'Reviewer'}]});
    expect((await f.call('/api/github/reviewers?repository=kernel%2Fother&prId=PR_node')).status).toBe(403);expect(f.graph).toHaveBeenCalledTimes(1);
    expect((await f.call('/api/github/reviewers?repository=kernel%2Fwork')).status).toBe(400);expect(f.graph).toHaveBeenCalledTimes(1);
    f.state.suggestionRepoId=100;expect((await f.call('/api/github/reviewers?repository=kernel%2Fwork&prId=OTHER_node')).status).toBe(404);
    f.state.user={id:12,login:'other'};expect((await f.call('/api/github/reviewers?repository=kernel%2Fwork&prId=PR_node')).status).toBe(401);
  });
  it('verifies canonical reviewer identities, preserves CAS and persists only local intent',async()=>{
    const f=await fixture();const response=await f.call('/api/github/plans',{method:'PUT',body:planBody()});expect(response.status).toBe(200);expect((await response.json()).plan).toMatchObject({version:1,reviewerIds:['Reviewer'],reviewerIdentities:[{id:'22',login:'Reviewer'}],actorId:'11'});
    expect((await f.call('/api/github/plans',{method:'PUT',body:planBody()})).status).toBe(409);
    expect((await f.call('/api/github/plans',{method:'PUT',body:planBody(1,['alice'])})).status).toBe(400);
    f.state.reviewer.id=23;expect((await f.call('/api/github/plans',{method:'PUT',body:planBody(1)})).status).toBe(409);
    const contents=await readFile(join(f.stateDir,'state.json'),'utf8');expect(contents).not.toContain(f.companion.capability);expect(contents).not.toContain('Private PR title');expect(contents).not.toContain('Private description');expect(f.request.mock.calls.every(([,method])=>method===undefined||method==='GET')).toBe(true);
  });
  it('rejects oversized, non-JSON and malformed requests before GitHub operations',async()=>{
    const f=await fixture();expect((await f.call('/api/github/plans',{method:'PUT',body:'x'.repeat(16001)})).status).toBe(413);
    expect((await f.call('/api/github/plans',{method:'PUT',body:planBody(),headers:{'Content-Type':'text/plain'}})).status).toBe(415);
    expect((await f.call('/api/github/plans',{method:'PUT',body:'{'})).status).toBe(400);expect((await f.call('/api/github/workflow',{method:'POST',body:JSON.stringify({repository:'kernel/work',version:0,command:{type:'shell',command:'rm'}})})).status).toBe(400);expect(f.request).toHaveBeenCalledTimes(1);
  });
  it('allows local plans and held intent in read-only mode while refusing live releases and automation',async()=>{
    const f=await fixture(true);expect((await f.call('/api/github/plans',{method:'PUT',body:planBody()})).status).toBe(200);
    const configured=await f.call('/api/github/workflow',{method:'POST',body:JSON.stringify({repository:'kernel/work',version:0,command:{type:'configure_pr',prId:'PR_node',held:true}})});expect(configured.status).toBe(200);expect((await configured.json()).workspace.prs[0].held).toBe(true);
    expect((await f.call('/api/github/workflow',{method:'POST',body:JSON.stringify({repository:'kernel/work',version:1,command:{type:'auto',stackId:'PR_node',enabled:true}})})).status).toBe(403);
    expect((await f.call('/api/github/workflow',{method:'POST',body:JSON.stringify({repository:'kernel/work',version:1,command:{type:'start',prId:'PR_node'},expectedPlanVersion:1,expectedReviewers:[{id:'22',login:'Reviewer'}]})})).status).toBe(403);
  });
  it('revokes the pairing capability on explicit disconnect',async()=>{
    const f=await fixture();expect((await f.call('/api/auth/logout',{method:'POST'})).status).toBe(204);expect((await f.call('/api/session')).status).toBe(401);expect((await f.call('/api/github/plans',{method:'PUT',body:planBody()})).status).toBe(401);
  });
  it('stops subsequent pagination calls when shutdown begins during a read',async()=>{
    const f=await fixture();let release!:()=>void;let observed!:()=>void;const continued=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{observed=resolve;});
    f.graph.mockImplementationOnce(async()=>{observed();await continued;return {repository:{viewerPermission:'WRITE',pullRequests:{nodes:[rawPr],pageInfo:{hasNextPage:true,endCursor:'next'}}}};});
    const request=f.call('/api/github/workspace?repository=kernel%2Fwork');await started;const closed=f.companion.close();release();expect((await request).status).toBe(503);await closed;expect(f.graph).toHaveBeenCalledTimes(1);
  });
  it('stops pagination after the browser abandons a workspace request',async()=>{
    const f=await fixture();let release!:()=>void;let observed!:()=>void;const continued=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{observed=resolve;});
    f.graph.mockImplementationOnce(async()=>{observed();await continued;return {repository:{viewerPermission:'WRITE',pullRequests:{nodes:[rawPr],pageInfo:{hasNextPage:true,endCursor:'next'}}}};});
    const disconnected=new Promise<void>(resolve=>{f.companion.server.once('request',(_request,response)=>response.once('close',resolve));});
    const request=httpRequest(`${f.base}/api/github/workspace?repository=kernel%2Fwork`,{headers:{Origin:origin,Authorization:`Bearer ${f.companion.capability}`}});request.on('error',()=>{});request.end();await started;request.destroy();await disconnected;release();await new Promise<void>(resolve=>setImmediate(resolve));expect(f.graph).toHaveBeenCalledTimes(1);
  });
  it('validates origin and explicit repository configuration',()=>{
    const valid={origin,port:4318,repositories:['Kernel/Work'],stateDir:'/tmp/example'};expect(validateOptions(valid).repositories).toEqual(['kernel/work']);
    for(const invalidOrigin of ['https://merge.foo/path','https://merge.foo/','http://merge.foo','https://user@merge.foo'])expect(()=>validateOptions({...valid,origin:invalidOrigin})).toThrow();
    for(const repositories of [[],['../work'],['kernel/..'],['kernel/work;cmd']])expect(()=>validateOptions({...valid,repositories})).toThrow();
  });
});
