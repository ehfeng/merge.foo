import {github,type Session} from './auth';
import {verifyIdentity,fetchRepository,type Repo,AccessError} from './github';
import {loadPlans,planKey} from './plans';
import {getStateStore} from './state/store';
import {registerAutomationRepository} from './automation-registry';
import {workflowStore} from './state/workflow';
import {WorkflowService,hydrateWorkspace} from '../workflow/service';
import {GitHubWorkflowTransport} from './workflow-github';
import {backgroundConfigured} from './github-app';
import {readWorkflowInput} from './workflow-input';
import type {Workspace} from '../domain/types';
import type {WorkflowActor,WorkflowSnapshot,WorkflowCommand} from '../workflow/types';

export async function workflowService(){return new WorkflowService(workflowStore(await getStateStore()));}
export const workflowWritesEnabled=()=>process.env.GITHUB_WORKFLOW_WRITES_ENABLED==='true';
async function actorAccess(data:Session,repo:Repo):Promise<WorkflowActor> {
  const identity=await verifyIdentity(data);
  const permission=await github<{permission:string;user?:{id:number}}>(data.token,`/repos/${repo.full_name}/collaborators/${encodeURIComponent(identity.login)}/permission`);
  if(permission.user&&permission.user.id!==identity.id)throw new AccessError('GitHub identity changed. Sign in again.');
  return {id:String(identity.id),login:identity.login,canWrite:['admin','maintain','write'].includes(permission.permission)};
}
export async function loadCoordination(data:Session,repo:Repo,workspace:Workspace) {
  const actor=await actorAccess(data,repo);const service=await workflowService();
  return {workspace:hydrateWorkspace(workspace,await service.read(planKey(repo))),coordination:{canManage:actor.canWrite,writesEnabled:workflowWritesEnabled(),backgroundEnabled:backgroundConfigured()&&repo.canRequestReviews!==false,...(repo.canRequestReviews===false?{backgroundReason:'Ask a repository administrator to approve Pull requests write access for merge.foo in GitHub.'}:{})},viewerLogin:actor.login};
}
async function settingsView(data:Session,repository:string,command:WorkflowCommand) {
  const identity=await verifyIdentity(data);const view=await fetchRepository({...data,login:identity.login},repository);await loadPlans(view.repo,view.workspace);
  let author:{id:number;login:string}|undefined;
  if(command.type==='configure_pr'){
    const target=view.workspace.prs.find(pr=>pr.id===command.prId);if(!target||target.lifecycle!=='open')throw new AccessError('Select an open PR in this repository.',404);
    const fresh=await github<{node_id:string;state:string;merged:boolean;user:{id:number;login:string}}>(data.token,`/repos/${view.repo.full_name}/pulls/${target.number}`);
    if(fresh.node_id!==target.id||fresh.state!=='open'||fresh.merged)throw new AccessError('This PR changed or is no longer open.',409);author=fresh.user;
  }
  // Settings are durable intent, not approval evidence. No release or rollback can
  // be inferred from this deliberately incomplete observation.
  const snapshot:WorkflowSnapshot={scope:planKey(view.repo),repository:view.repo.full_name,observedAt:new Date().toISOString(),complete:false,prs:view.workspace.prs.map(pr=>({id:pr.id,number:pr.number,stackId:pr.stackId,parentId:pr.parentId,author:{id:command.type==='configure_pr'&&command.prId===pr.id?String(author!.id):'',login:pr.author},lifecycle:pr.lifecycle,readiness:pr.readiness,githubGate:'unknown',reviewsComplete:false,reviews:[],requests:[],plannedReviewers:pr.plannedReviewerIdentities??[]}))};
  return {...view,snapshot};
}
export async function updateWorkflow(request:Request,data:Session) {
  const input=await readWorkflowInput(request);
  const transport=new GitHubWorkflowTransport({session:data,repository:input.repository,enabled:workflowWritesEnabled(),loadWorkspacePlans:loadPlans});
  const settings=input.command.type==='configure_pr'||input.command.type==='enroll'&&!input.command.autoProgress||input.command.type==='auto'&&!input.command.enabled;
  const view=settings?await settingsView(data,input.repository,input.command):await transport.fetchView();const actor=await actorAccess(data,view.repo);
  if((input.command.type==='enroll'||input.command.type==='auto')&&!actor.canWrite)throw new AccessError('A repository writer must enable or manage this feature.');
  if(input.command.type==='start'&&!actor.canWrite)throw new AccessError('GitHub requires repository write access to request reviews.');
  if((input.command.type==='auto'&&input.command.enabled)||(input.command.type==='enroll'&&input.command.autoProgress)||input.command.type==='start')if(!workflowWritesEnabled()||!backgroundConfigured()||view.repo.canRequestReviews===false)throw new AccessError(view.repo.canRequestReviews===false?'Approve Pull requests write access for merge.foo in GitHub installation settings.':'Review automation is unavailable. The operator needs to finish server setup.',503);
  if(input.command.type==='start'&&!workflowWritesEnabled())throw new AccessError('GitHub review actions are not enabled by the operator.',503);
  if(input.command.type==='start'){
    const targetId=input.command.prId;const target=view.workspace.prs.find(pr=>pr.id===targetId);
    if(!target||target.planVersion!==input.expectedPlanVersion||JSON.stringify(target.plannedReviewerIdentities??[])!==JSON.stringify(input.expectedReviewers))throw new AccessError('The reviewer plan changed after your preview. Refresh and review the recipients before starting.',409);
  }
  const store=await getStateStore();const service=new WorkflowService(workflowStore(store));const scope=planKey(view.repo);
  const document=await service.command(scope,view.snapshot,actor,input.command,input.version,async next=>{
    if(!Object.values(next.config.stacks).some(stack=>stack.enrolled))return;
    try{await registerAutomationRepository(store,view.repo,actor);}catch{throw new AccessError('Repository automation registration is unavailable. Retry this feature update.',503);}
  });
  // Signed deliveries and an independent scheduler drive the durable outbox.
  return {workspace:hydrateWorkspace(view.workspace,document),coordination:{canManage:actor.canWrite,writesEnabled:workflowWritesEnabled(),backgroundEnabled:backgroundConfigured()&&view.repo.canRequestReviews!==false,...(view.repo.canRequestReviews===false?{backgroundReason:'Ask a repository administrator to approve Pull requests write access for merge.foo in GitHub.'}:{})},viewerLogin:actor.login};
}
