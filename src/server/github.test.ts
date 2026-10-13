import {describe,it,expect,vi,afterEach} from 'vitest';
import {normalize,fetchRepository,repositories,validateRepositoryAccess} from './github';
import {isApproved,outstanding,stateOf} from '../domain/engine';
const pr=(number:number,head:string,base='main',more:Record<string,unknown>={})=>({id:`github-${number}`,number,title:`PR ${number}`,url:`https://github.com/acme/platform/pull/${number}`,bodyText:'Description',isDraft:false,headRefName:head,baseRefName:base,headRepository:{id:'repo-node',nameWithOwner:'acme/platform'},baseRepository:{id:'repo-node',nameWithOwner:'acme/platform'},additions:10,deletions:2,reviewDecision:'REVIEW_REQUIRED',mergeable:'UNKNOWN',author:{login:'ehfeng'},statusCheckRollup:null,reviews:{nodes:[]},reviewRequests:{nodes:[]},timelineItems:{nodes:[]},labels:{nodes:[]},...more});
const normalizeTest=(nodes:ReturnType<typeof pr>[],truncated=false)=>normalize(nodes as Parameters<typeof normalize>[0],'acme/platform',truncated);
describe('GitHub read-only normalization',()=>{
  it('uses reliable branch relationships and disables automation on connection',()=>{const {workspace}=normalizeTest([pr(1,'base'),pr(2,'tip','base'),pr(3,'other')]);expect(workspace.stacks).toHaveLength(2);expect(workspace.prs[1].parentId).toBe('github-1');expect(workspace.stacks.every(s=>!s.autoProgress)).toBe(true);expect(workspace.prs.every(p=>!p.plannedReviewerIds.length)).toBe(true);});
  it('does not guess among ambiguous branches',()=>{const {workspace,warnings}=normalizeTest([pr(1,'base'),pr(2,'base'),pr(3,'tip','base')]);expect(workspace.prs[2].parentId).toBeUndefined();expect(warnings.join(' ')).toContain('ambiguous');});
  it('does not fabricate request age from PR creation',()=>{const {workspace}=normalizeTest([pr(1,'base','main',{reviewRequests:{nodes:[{requestedReviewer:{login:'reviewer'}}]}})]);expect(workspace.prs[0].requests[0].requestedAt).toBe('');});
  it('uses actual matching review-request events',()=>{const {workspace}=normalizeTest([pr(1,'base','main',{reviewRequests:{nodes:[{requestedReviewer:{login:'reviewer'}}]},timelineItems:{nodes:[{createdAt:'2026-10-11T10:00:00Z',requestedReviewer:{login:'reviewer'}}]}})]);expect(workspace.prs[0].requests[0].requestedAt).toBe('2026-10-11T10:00:00Z');});
  it('uses GitHub policy instead of interpreting a single historical approval as the gate',()=>{const {workspace}=normalizeTest([pr(1,'base','main',{reviews:{nodes:[{author:{login:'reviewer'},state:'APPROVED',submittedAt:'2026-10-11T10:00:00Z'}]}})]);expect(isApproved(workspace.prs[0])).toBe(false);expect(stateOf(workspace.prs[0])).toBe('Ready');});
  it('keeps an authoritative re-request active after historical approval',()=>{const {workspace}=normalizeTest([pr(1,'base','main',{reviews:{nodes:[{author:{login:'reviewer'},state:'APPROVED',submittedAt:'2026-10-11T10:00:00Z'}]},reviewRequests:{nodes:[{requestedReviewer:{login:'reviewer'}}]}})]);expect(outstanding(workspace.prs[0])).toHaveLength(1);});
  it('discloses partial data and leaves estimates unassessed',()=>{const {workspace,warnings}=normalizeTest([pr(1,'base')],true);expect(warnings.join(' ')).toContain('Partial PR coverage');expect(workspace.prs[0].risk).toBe('Unknown');expect(workspace.prs[0].lines.discounted).toBe(0);});
  it('separates observed approval from checks and mergeability',()=>{const {workspace}=normalizeTest([pr(1,'base','main',{reviewDecision:'APPROVED',reviews:{nodes:[{author:{login:'reviewer'},state:'APPROVED',submittedAt:'2026-10-11T10:00:00Z'}]},statusCheckRollup:{state:'FAILURE'},mergeable:'CONFLICTING'})]);expect(isApproved(workspace.prs[0])).toBe(true);expect(workspace.prs[0].lifecycle).toBe('open');expect(workspace.prs[0].checks).toBe('failing');expect(workspace.prs[0].mergeability).toBe('conflicts');});
});

describe('full repository ingestion',()=>{
  afterEach(()=>vi.unstubAllGlobals());
  const session={token:'test',userId:'1',login:'alice',expires:Date.now()+10000};
  const mock=(pages:Record<string,unknown>[])=>{let count=0;const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if(url.endsWith('/user/installations?per_page=100&page=1'))return Response.json({installations:[{id:8}]});if(url.includes('/user/installations/8/repositories'))return Response.json({repositories:[{id:1,full_name:'acme/platform',private:false}]});if(url.endsWith('/graphql')){const body=JSON.parse(String(init?.body));if(body.query.includes('Ancestry'))return Response.json({data:{repository:{viewerPermission:'WRITE',pullRequests:{nodes:[],pageInfo:{hasNextPage:false,endCursor:null}}}}});return Response.json({data:pages[count++]});}throw new Error('Unexpected test URL '+url);});vi.stubGlobal('fetch',fetcher);return fetcher;};
  it('completes raw pagination before excluding archived repositories across installations',async()=>{
    const publicRepo={id:101,full_name:'owner/active-public',private:false,archived:false};const privateRepo={id:102,full_name:'owner/active-private',private:true,archived:false};
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));const page=url.searchParams.get('page');
      if(url.pathname==='/user/installations')return Response.json({installations:[{id:8},{id:9}]});
      if(url.pathname==='/user/installations/8/repositories'&&page==='1')return Response.json({repositories:Array.from({length:100},(_,index)=>({id:index+1,full_name:`owner/archive-${index+1}`,private:index%2===0,archived:true}))});
      if(url.pathname==='/user/installations/8/repositories'&&page==='2')return Response.json({repositories:[publicRepo,privateRepo,{id:103,full_name:'owner/archive-private',private:true,archived:true},publicRepo]});
      if(url.pathname==='/user/installations/9/repositories'&&page==='1')return Response.json({repositories:[{id:104,full_name:'org/active-private',private:true,archived:false},publicRepo]});
      throw new Error('Unexpected fixture request.');
    });vi.stubGlobal('fetch',fetcher);
    expect(await repositories(session)).toEqual([{id:101,full_name:'owner/active-public',private:false,installationId:9},{id:102,full_name:'owner/active-private',private:true,installationId:8},{id:104,full_name:'org/active-private',private:true,installationId:9}]);
    expect(fetcher.mock.calls.some(([url])=>String(url).includes('/8/repositories?per_page=100&page=2'))).toBe(true);expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('rejects a stale archived selection during fresh server access validation before loading its graph',async()=>{
    const fetcher=vi.fn(async(input:RequestInfo|URL)=>{
      const url=new URL(String(input));
      if(url.pathname==='/user/installations')return Response.json({installations:[{id:8}]});
      if(url.pathname==='/user/installations/8/repositories')return Response.json({repositories:[{id:1,full_name:'acme/platform',private:true,archived:true},{id:2,full_name:'acme/active',private:true,archived:false}]});
      throw new Error('Archived selections must not reach graph loading.');
    });vi.stubGlobal('fetch',fetcher);
    await expect(validateRepositoryAccess(session,'acme/platform')).rejects.toMatchObject({status:403});
    await expect(fetchRepository(session,'acme/platform')).rejects.toMatchObject({status:403});
    expect(fetcher.mock.calls.every(([url])=>!String(url).endsWith('/graphql'))).toBe(true);
    expect(await validateRepositoryAccess(session,'acme/active')).toMatchObject({id:2,private:true,installationId:8});
  });
  it('loads every author over cursor pages, keeps suggestion order and sends queries only',async()=>{
    const fetcher=mock([{repository:{viewerPermission:'WRITE',pullRequests:{nodes:[pr(1,'a','main',{author:{login:'bob'},suggestedReviewers:[{reviewer:{login:'zoe'},isAuthor:true,isCommenter:false},{reviewer:{login:'amy'},isAuthor:false,isCommenter:true}]})],pageInfo:{hasNextPage:true,endCursor:'next'}}}},{repository:{viewerPermission:'WRITE',pullRequests:{nodes:[pr(2,'b','a',{author:{login:'carol'}})],pageInfo:{hasNextPage:false,endCursor:null}}}}]);
    const result=await fetchRepository(session,'acme/platform');expect(result.workspace.prs.map(p=>p.author)).toEqual(['bob','carol']);expect(result.workspace.prs[1].parentId).toBe('github-1');expect(result.workspace.prs[0].suggestedReviewers?.map(s=>s.reviewerId)).toEqual(['zoe','amy']);expect(result.workspace.prs.every(p=>p.canEditPlan)).toBe(true);
    const calls=fetcher.mock.calls.filter(([url])=>String(url).endsWith('/graphql'));expect(JSON.parse(String(calls[1][1]?.body)).variables.cursor).toBe('next');expect(calls.every(([,init])=>!String(init?.body).includes('mutation'))).toBe(true);
  });
  it('fails instead of returning a partial graph when cursors stop advancing',async()=>{mock([{repository:{viewerPermission:'READ',pullRequests:{nodes:[pr(1,'a')],pageInfo:{hasNextPage:true,endCursor:null}}}}]);await expect(fetchRepository(session,'acme/platform')).rejects.toThrow('pagination could not complete');});
  it('uses merged matching ancestry and limits read users to their own PR plan',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=String(input);if(url.includes('/user/installations?'))return Response.json({installations:[{id:8}]});if(url.includes('/repositories?'))return Response.json({repositories:[{id:1,full_name:'acme/platform',private:false}]});const ancestry=String(init?.body).includes('Ancestry');return Response.json({data:{repository:{viewerPermission:'READ',pullRequests:{nodes:ancestry?[pr(1,'a','main',{state:'MERGED'})]:[pr(2,'b','a',{author:{login:'alice'}}),pr(3,'other','main',{author:{login:'bob'}})],pageInfo:{hasNextPage:false,endCursor:null}}}}});}));
    const {workspace,warnings}=await fetchRepository(session,'acme/platform');expect(workspace.prs.find(p=>p.number===1)?.lifecycle).toBe('merged');expect(workspace.prs.find(p=>p.number===2)?.canEditPlan).toBe(true);expect(workspace.prs.find(p=>p.number===3)?.canEditPlan).toBe(false);expect(warnings.join(' ')).toContain('100 most recently');
  });
  it('does not connect a fork branch to an unrelated repository branch',()=>{const {workspace}=normalizeTest([pr(1,'base','main',{headRepository:{id:'fork-node',nameWithOwner:'bob/platform'}}),pr(2,'tip','base')]);expect(workspace.prs[1].parentId).toBeUndefined();});
  it('refuses to infer topology without stable repository identity',()=>{const {workspace,warnings}=normalizeTest([pr(1,'a','main',{headRepository:null}),pr(2,'b','a')]);expect(workspace.prs[1].parentId).toBeUndefined();expect(warnings.join(' ')).toContain('missing repository identity');});
  it('reports reused branch names as ambiguous even across open and merged PRs',()=>{const {workspace,warnings}=normalizeTest([pr(1,'a','main',{state:'MERGED'}),pr(2,'a'),pr(3,'b','a')]);expect(workspace.prs[2].parentId).toBeUndefined();expect(warnings.join(' ')).toContain('ambiguous');});
  it('breaks cycles before layout',()=>{const {workspace,warnings}=normalizeTest([pr(1,'a','b'),pr(2,'b','a')]);expect(workspace.prs.every(p=>!p.parentId)).toBe(true);expect(warnings.join(' ')).toContain('Cyclic');});
});
