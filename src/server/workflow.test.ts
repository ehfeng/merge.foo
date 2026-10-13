import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {updateWorkflow} from './workflow';
import {createFixture} from '../domain/fixtures';
const mocks=vi.hoisted(()=>({command:vi.fn(),view:vi.fn(),fetchRepo:vi.fn(),permission:'write'}));
vi.mock('./github',async original=>({...await original<typeof import('./github')>(),verifyIdentity:async()=>({id:1,login:'alice'}),fetchRepository:(...args:unknown[])=>mocks.fetchRepo(...args)}));
vi.mock('./auth',async original=>({...await original<typeof import('./auth')>(),github:async(_token:string,path:string)=>path.includes('/pulls/')?{node_id:'pr-143',state:'open',merged:false,user:{id:1,login:'alice'}}:{permission:mocks.permission,user:{id:1,login:'alice'}}}));
vi.mock('./plans',async original=>({...await original<typeof import('./plans')>(),loadPlans:async()=>{}}));
vi.mock('./workflow-github',()=>({GitHubWorkflowTransport:class {fetchView(){return mocks.view();}}}));
vi.mock('./state/store',()=>({getStateStore:async()=>({})}));
vi.mock('./state/workflow',()=>({workflowStore:()=>({})}));
vi.mock('../workflow/service',()=>({WorkflowService:class {command(...args:unknown[]){return mocks.command(...args);}},hydrateWorkspace:(workspace:unknown)=>workspace}));
const data={token:'fixture',userId:'1',login:'alice',expires:Date.now()+60000};
const repo={id:42,installationId:7,full_name:'owner/repo',private:true};
function request(command:unknown,preview?:unknown){return new Request('http://127.0.0.1:3000/api/github/workflow',{method:'POST',headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/json'},body:JSON.stringify({repository:'owner/repo',version:0,command,...preview as object})});}
beforeEach(()=>{
  mocks.command.mockReset().mockResolvedValue({version:1});mocks.view.mockReset();mocks.fetchRepo.mockReset();mocks.permission='write';
  vi.stubEnv('APP_ORIGIN','http://127.0.0.1:3000');vi.stubEnv('GITHUB_CLIENT_ID','fixture');vi.stubEnv('GITHUB_CLIENT_SECRET','fixture');vi.stubEnv('AUTH_SECRET','test-session-secret-over-32-characters');
  vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','true');vi.stubEnv('GITHUB_APP_PRIVATE_KEY','fixture-key-presence');vi.stubEnv('GITHUB_WEBHOOK_SECRET','fixture-webhook-secret-over-32-characters');vi.stubEnv('WORKFLOW_RECONCILE_SECRET','fixture-runner-secret-over-32-characters');vi.stubEnv('WORKFLOW_REPOSITORIES',JSON.stringify([repo]));
  const workspace=createFixture();const pr=workspace.prs.find(p=>p.id==='pr-143')!;pr.planVersion=2;pr.plannedReviewerIds=['noah'];pr.plannedReviewerIdentities=[{id:'2',login:'noah'}];
  mocks.view.mockResolvedValue({repo,workspace,snapshot:{scope:'7:42',repository:'owner/repo',observedAt:new Date().toISOString(),complete:true,prs:[]}});mocks.fetchRepo.mockResolvedValue({repo,workspace,warnings:[]});
});
afterEach(()=>vi.unstubAllEnvs());
it('rejects a reviewer plan changed after preview before any release can be queued',async()=>{
  const command={type:'start',prId:'pr-143'};
  for(const preview of [{expectedPlanVersion:1,expectedReviewers:[{id:'2',login:'noah'}]},{expectedPlanVersion:2,expectedReviewers:[{id:'3',login:'maya'}]}])await expect(updateWorkflow(request(command,preview),data)).rejects.toMatchObject({status:409});
  expect(mocks.command).not.toHaveBeenCalled();
});
it('queues only the recipients that match the confirmed preview',async()=>{
  await updateWorkflow(request({type:'start',prId:'pr-143'},{expectedPlanVersion:2,expectedReviewers:[{id:'2',login:'noah'}]}),data);
  expect(mocks.command).toHaveBeenCalledTimes(1);expect(mocks.command.mock.calls[0][3]).toEqual({type:'start',prId:'pr-143'});expect(mocks.view).toHaveBeenCalledTimes(1);
});
it('persists a hold from explicitly incomplete metadata without expensive approval reads or dispatch',async()=>{
  await updateWorkflow(request({type:'configure_pr',prId:'pr-143',held:true}),data);
  expect(mocks.view).not.toHaveBeenCalled();expect(mocks.command.mock.calls[0][1]).toMatchObject({complete:false,prs:expect.arrayContaining([expect.objectContaining({id:'pr-143',githubGate:'unknown',reviewsComplete:false})])});
});
it('a caller whose writer permission was revoked cannot queue a notified review',async()=>{
  mocks.permission='read';await expect(updateWorkflow(request({type:'start',prId:'pr-143'},{expectedPlanVersion:2,expectedReviewers:[{id:'2',login:'noah'}]}),data)).rejects.toMatchObject({status:403});expect(mocks.command).not.toHaveBeenCalled();
});
