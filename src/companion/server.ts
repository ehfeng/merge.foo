import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {Workspace} from '../domain/types';
import {AccessError,fetchRepositoryWith,fetchReviewerSuggestions,type GitHubApi,type Repo} from '../server/github';
import {parsePlan,planKey} from '../server/plans';
import {parseWorkflowInput,type WorkflowInput} from '../server/workflow-input';
import type {Plan,StateStore} from '../server/state/types';
import {workflowStore} from '../server/state/workflow';
import {GitHubWorkflowTransport,type WorkflowPrincipal} from '../server/workflow-github';
import {WorkflowService,hydrateWorkspace} from '../workflow/service';
import {WorkflowError,WorkflowTransportError,type WorkflowActor,type WorkflowSnapshot} from '../workflow/types';
import {LocalStateStore} from './store';
import {ghApi} from './gh-api';

export type CompanionOptions={origin:string;port:number;repositories:string[];stateDir:string;readOnly?:boolean;pollIntervalMs?:number};
type User={id:number;login:string};
type Metadata={id:number;full_name:string;private:boolean;archived:boolean};
const loginValid=(login:unknown):login is string=>typeof login==='string'&&/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login);
const repositoryValid=(repository:string)=>/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)&&repository.split('/').every(part=>part!=='.'&&part!=='..');
const routes:Record<string,string>={'/api/session':'GET','/api/github/repositories':'GET','/api/github/workspace':'GET','/api/github/reviewers':'GET','/api/github/plans':'PUT','/api/github/workflow':'POST','/api/auth/logout':'POST'};

export function validateOptions(options:CompanionOptions):CompanionOptions {
  const url=new URL(options.origin);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.origin!==options.origin||url.protocol==='http:'&&!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Use an exact HTTPS application origin, or a local HTTP development origin.');
  if(!Number.isSafeInteger(options.port)||options.port<0||options.port>65535)throw new Error('Choose a valid companion port.');
  if(!options.repositories.length||options.repositories.length>50||options.repositories.some(repository=>!repositoryValid(repository)))throw new Error('Choose 1–50 explicit repositories using --repo owner/name.');
  return {...options,repositories:[...new Set(options.repositories.map(repository=>repository.toLowerCase()))]};
}

export async function createCompanion(rawOptions:CompanionOptions,dependencies:{api?:GitHubApi;store?:StateStore}={}) {
  const options=validateOptions(rawOptions);const upstream=dependencies.api??ghApi();let active=true;
  const requestContext=new AsyncLocalStorage<AbortSignal>();
  const ensureActive=()=>{if(!active||requestContext.getStore()?.aborted)throw new AccessError('The companion or this request stopped. No new GitHub request was started.',503);};
  const api:GitHubApi={
    async request<T>(path:string,method='GET',body?:unknown):Promise<T>{ensureActive();return upstream.request<T>(path,method,body);},
    async graph<T>(query:string,variables:Record<string,unknown>):Promise<T>{ensureActive();return upstream.graph<T>(query,variables);},
  };
  const initial=await api.request<User>('/user');
  if(!Number.isSafeInteger(initial.id)||initial.id<=0||!loginValid(initial.login))throw new AccessError('GitHub CLI identity could not be verified.',401);
  const ownedStore=dependencies.store?undefined:await LocalStateStore.create(options.stateDir);const store=dependencies.store??ownedStore!;
  const service=new WorkflowService(workflowStore(store));const capability=randomBytes(32).toString('base64url');const repositoryIds=new Map<string,number>();let port=options.port;let pendingRequests=0;let polling=false;let timer:ReturnType<typeof setInterval>|undefined;
  const operations=new Map<string,Promise<unknown>>();
  const serialize=<T>(repository:string,operation:()=>Promise<T>):Promise<T>=>{const prior=operations.get(repository)??Promise.resolve();const next=prior.catch(()=>{}).then(operation);operations.set(repository,next);void next.finally(()=>{if(operations.get(repository)===next)operations.delete(repository);}).catch(()=>{});return next;};
  const identity=async():Promise<User>=>{const user=await api.request<User>('/user');if(!Number.isSafeInteger(user.id)||user.id!==initial.id||!loginValid(user.login))throw new AccessError('The GitHub CLI account changed. Stop this companion and pair a new one.',401);return user;};
  const repository=async(fullName:string):Promise<Repo>=>{
    const selected=fullName.toLowerCase();if(!repositoryValid(fullName)||!options.repositories.includes(selected))throw new AccessError('This repository is outside the companion allowlist. Restart with --repo owner/name to add it.',403);
    const metadata=await api.request<Metadata>(`/repos/${selected}`);
    if(!Number.isSafeInteger(metadata.id)||metadata.id<=0||metadata.archived!==false||typeof metadata.private!=='boolean'||typeof metadata.full_name!=='string'||metadata.full_name.toLowerCase()!==selected)throw new AccessError('Repository access changed, it was renamed, or it is archived. Restart with the current repository name.',403);
    const pinned=repositoryIds.get(selected);if(pinned!==undefined&&pinned!==metadata.id)throw new AccessError('Repository identity changed. Stop and restart the companion.',403);repositoryIds.set(selected,metadata.id);
    return {id:metadata.id,full_name:metadata.full_name,private:metadata.private,installationId:initial.id};
  };
  const actorAccess=async(repo:Repo,user:User):Promise<WorkflowActor>=>{
    const access=await api.request<{permission:string;user?:User}>(`/repos/${repo.full_name}/collaborators/${encodeURIComponent(user.login)}/permission`);
    if(!access.user||access.user.id!==user.id||!loginValid(access.user.login)||access.user.login.toLowerCase()!==user.login.toLowerCase())throw new AccessError('GitHub collaborator identity changed.',403);
    return {id:String(user.id),login:user.login,canWrite:['admin','maintain','write'].includes(access.permission)};
  };
  const loadPlans=async(repo:Repo,workspace:Workspace)=>{
    const snapshot=await store.list<Plan>(planKey(repo),'plan');
    for(const pr of workspace.prs){const plan=snapshot.records.find(record=>record.key===pr.id)?.value;if(plan){pr.plannedReviewerIds=plan.reviewerIds;pr.plannedReviewerIdentities=plan.reviewerIdentities;pr.planVersion=plan.version;for(const id of plan.reviewerIds)if(!workspace.reviewers.some(person=>person.id===id))workspace.reviewers.push({id,name:id,initials:id.slice(0,2).toUpperCase(),color:'#8674bd',specialty:'Planned reviewer'});}}
    workspace.activity=snapshot.history.filter(history=>workspace.prs.some(pr=>pr.id===history.value.prId)).map(history=>({id:`plan:${history.id}`,at:history.value.updatedAt,prId:history.value.prId,stackId:workspace.prs.find(pr=>pr.id===history.value.prId)!.stackId,message:`${history.value.actor} planned ${history.value.reviewerIds.length?history.value.reviewerIds.join(', '):'no reviewers'} (version ${history.value.version}).`,kind:'intent'}));
  };
  const coordination=(actor:WorkflowActor)=>({source:'companion' as const,canManage:actor.canWrite,writesEnabled:!options.readOnly,backgroundEnabled:active&&!options.readOnly});
  const view=async(fullName:string)=>{const user=await identity();const repo=await repository(fullName);const fetched=await fetchRepositoryWith(user,repo,api);await loadPlans(repo,fetched.workspace);const actor=await actorAccess(repo,user);return {...fetched,actor};};
  const principal=async(fullName:string):Promise<WorkflowPrincipal>=>{
    const user=await identity();const repo=await repository(fullName);const actor=await actorAccess(repo,user);
    return {actor,repository:repo,effectActor:actor,authorizeScope:async(action,document,snapshot)=>{
      if(!active||options.readOnly||!actor.canWrite||snapshot.scope!==planKey(repo))return false;
      const grant=action.mode==='automatic'?document.config.stacks[action.stackId]?.actorId:document.releases[action.prId]?.actorId;
      return grant===actor.id&&!!document.config.stacks[action.stackId]?.enrolled;
    }};
  };
  const workflowApi={async request<T>(path:string,method='GET',body?:unknown):Promise<T>{
    const query=(body as {query?:unknown})?.query;const write=path==='/graphql'?typeof query==='string'&&query.trimStart().startsWith('mutation'):method!=='GET';
    if(write&&(!active||options.readOnly))throw new WorkflowTransportError('The companion stopped or GitHub writes are disabled. No GitHub change was dispatched.','rejected');
    return api.request<T>(path,method,body);
  }};
  const transport=(fullName:string)=>new GitHubWorkflowTransport({repository:fullName,api:workflowApi,principal:()=>principal(fullName),enabled:!options.readOnly,loadWorkspacePlans:loadPlans,externalRequestLimit:160});
  const savePlan=async(body:unknown)=>{
    const input=parsePlan(body);const user=await identity();const repo=await repository(input.repository);
    const found=await api.graph<{node:null|{__typename:string;number?:number;repository?:{databaseId:number}}}>(`query PlanTarget($id:ID!) {node(id:$id) {__typename ... on PullRequest {number repository {databaseId}}}}`,{id:input.prId});
    if(found.node?.__typename!=='PullRequest'||found.node.repository?.databaseId!==repo.id||!found.node.number)throw new AccessError('This pull request does not belong to the selected repository.',404);
    const pr=await api.request<{node_id:string;state:string;merged:boolean;user:User}>(`/repos/${repo.full_name}/pulls/${found.node.number}`);
    if(pr.node_id!==input.prId||pr.state!=='open'||pr.merged)throw new AccessError('Only open pull requests can have planned assignments.',409);
    if(!pr.user||!Number.isSafeInteger(pr.user.id)||pr.user.id<=0||!loginValid(pr.user.login))throw new AccessError('The PR author could not be verified.',403);
    if(pr.user.id!==user.id&&!(await actorAccess(repo,user)).canWrite)throw new AccessError('Only the PR author or a repository writer can edit its planned assignment.');
    const previous=(await store.read<Plan>(planKey(repo),'plan',input.prId))?.value;if(input.version!==(previous?.version??0))throw new AccessError('Someone changed this assignment. Refresh the repository before editing again.',409);
    const reviewerIds:string[]=[];const reviewerIdentities:{id:string;login:string}[]=[];
    for(const login of input.reviewerIds){
      if(login.toLowerCase()===pr.user.login.toLowerCase())throw new AccessError('The PR author cannot be a planned reviewer.',400);
      const target=await api.request<{permission:string;user:User&{type:string}}>(`/repos/${repo.full_name}/collaborators/${encodeURIComponent(login)}/permission`);
      if(!target.user||!Number.isSafeInteger(target.user.id)||target.user.id<=0||!loginValid(target.user.login)||target.user.type!=='User'||!['read','triage','write','maintain','admin'].includes(target.permission)||target.user.id===pr.user.id)throw new AccessError(`@${login} is not a verified repository reviewer.`,400);
      const prior=previous?.reviewerIdentities?.find(person=>person.login.toLowerCase()===login.toLowerCase());if(prior&&prior.id!==String(target.user.id))throw new AccessError(`@${login} no longer identifies the saved GitHub account. Remove the assignment before choosing a replacement.`,409);
      if(reviewerIdentities.some(person=>person.id===String(target.user.id)))throw new AccessError('Each reviewer can appear only once, including renamed accounts.',400);
      reviewerIds.push(target.user.login);reviewerIdentities.push({id:String(target.user.id),login:target.user.login});
    }
    const plan:Plan={prId:input.prId,reviewerIds,reviewerIdentities,version:input.version+1,actor:user.login,actorId:String(user.id),updatedAt:new Date().toISOString()};
    if(!await store.compareAndSwap(planKey(repo),'plan',input.prId,input.version,plan,{id:String(user.id),login:user.login}))throw new AccessError('Someone changed this assignment. Refresh the repository before editing again.',409);return {plan};
  };
  const settingsView=async(input:WorkflowInput)=>{
    const fetched=await view(input.repository);let author:User|undefined;
    if(input.command.type==='configure_pr'){const targetId=input.command.prId;const target=fetched.workspace.prs.find(pr=>pr.id===targetId);if(!target||target.lifecycle!=='open')throw new AccessError('Select an open PR in this repository.',404);const fresh=await api.request<{node_id:string;state:string;merged:boolean;user:User}>(`/repos/${fetched.repo.full_name}/pulls/${target.number}`);if(fresh.node_id!==target.id||fresh.state!=='open'||fresh.merged)throw new AccessError('This PR changed or is no longer open.',409);author=fresh.user;}
    const snapshot:WorkflowSnapshot={scope:planKey(fetched.repo),repository:fetched.repo.full_name,observedAt:new Date().toISOString(),complete:false,prs:fetched.workspace.prs.map(pr=>({id:pr.id,number:pr.number,stackId:pr.stackId,parentId:pr.parentId,author:{id:input.command.type==='configure_pr'&&input.command.prId===pr.id?String(author!.id):'',login:pr.author},lifecycle:pr.lifecycle,readiness:pr.readiness,githubGate:'unknown',reviewsComplete:false,reviews:[],requests:[],plannedReviewers:pr.plannedReviewerIdentities??[]}))};return {...fetched,snapshot};
  };
  const updateWorkflow=async(input:WorkflowInput)=>{
    if(options.readOnly&&(input.command.type==='start'||input.command.type==='auto'&&input.command.enabled||input.command.type==='enroll'&&input.command.autoProgress))throw new AccessError('This companion was started with --read-only. Restart without that flag to enable reviewed GitHub actions.',403);
    const settings=input.command.type==='configure_pr'||input.command.type==='enroll'&&!input.command.autoProgress||input.command.type==='auto'&&!input.command.enabled;
    const fetched=settings?await settingsView(input):await transport(input.repository).fetchView();const actor=await actorAccess(fetched.repo,await identity());
    if(['enroll','auto','start'].includes(input.command.type)&&!actor.canWrite)throw new AccessError('A repository writer must manage feature coordination and request reviews.');
    if(input.command.type==='start'){const targetId=input.command.prId;const target=fetched.workspace.prs.find(pr=>pr.id===targetId);if(!target||target.planVersion!==input.expectedPlanVersion||JSON.stringify(target.plannedReviewerIdentities??[])!==JSON.stringify(input.expectedReviewers))throw new AccessError('The reviewer plan changed after your preview. Refresh and review the recipients before starting.',409);}
    const document=await service.command(planKey(fetched.repo),fetched.snapshot,actor,input.command,input.version);
    return {workspace:hydrateWorkspace(fetched.workspace,document),coordination:coordination(actor),viewerLogin:actor.login};
  };
  const tick=async()=>{
    if(!active||options.readOnly||polling)return;polling=true;
    try{for(const selected of options.repositories){if(!active)break;await serialize(selected,async()=>{
      const repo=await repository(selected);const document=await service.read(planKey(repo));
      const needsPolling=Object.values(document.config.stacks).some(stack=>stack.enrolled&&stack.started&&stack.autoProgress)||document.actions.some(action=>['pending','claimed','uncertain'].includes(action.status))||Object.values(document.releases).some(release=>!release.rolledBack);
      if(!needsPolling)return;
      for(let step=0;step<4&&active;step++){const result=await service.runNext(planKey(repo),transport(selected),`local:${initial.id}`);if(!result.executed)break;}
    }).catch(()=>{/* Fresh access must succeed before any queued effect can proceed. */});}}finally{polling=false;}
  };
  const headers=(origin?:string)=>({'Cache-Control':'private, no-store',Pragma:'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',Vary:'Origin',...origin?{'Access-Control-Allow-Origin':origin}:undefined});
  const send=(response:ServerResponse,status:number,value?:unknown,origin?:string)=>{if(response.destroyed)return;response.writeHead(status,{...headers(origin),...value!==undefined?{'Content-Type':'application/json; charset=utf-8'}:undefined});response.end(value===undefined?undefined:JSON.stringify(value));};
  const readBody=async(request:IncomingMessage,limit:number):Promise<unknown>=>{
    if(!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type']??''))throw new AccessError('Expected JSON.',415);
    if(request.headers['content-encoding']&&request.headers['content-encoding']!=='identity')throw new AccessError('Compressed request bodies are not supported.',415);
    const length=Number(request.headers['content-length']??0);if(!Number.isSafeInteger(length)||length>limit)throw new AccessError('Request payload too large.',413);
    const chunks:Buffer[]=[];let size=0;for await(const chunk of request){size+=chunk.length;if(size>limit)throw new AccessError('Request payload too large.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AccessError('Invalid JSON.',400);}
  };
  const requestTasks=new Set<Promise<void>>();
  const server=createServer((request,response)=>{const controller=new AbortController();response.once('close',()=>{if(!response.writableEnded)controller.abort();});const task=requestContext.run(controller.signal,async()=>{
    const origin=request.headers.origin;
    if(request.headers.host!==`127.0.0.1:${port}`){send(response,403,{error:'The companion only accepts its exact loopback host.'});return;}
    if(origin!==options.origin){send(response,403,{error:'This application origin is not paired with the companion.'});return;}
    const url=new URL(request.url??'/',`http://127.0.0.1:${port}`);const expected=routes[url.pathname];
    if(!expected){send(response,404,{error:'Unknown companion endpoint.'},origin);return;}
    if(request.method==='OPTIONS'){
      const requestedHeaders=(request.headers['access-control-request-headers']??'').toString().toLowerCase().split(',').map(header=>header.trim()).filter(Boolean);
      if(request.headers['access-control-request-method']!==expected||requestedHeaders.some(header=>!['authorization','content-type'].includes(header))){send(response,403,{error:'Unsupported companion preflight.'},origin);return;}
      response.writeHead(204,{...headers(origin),'Access-Control-Allow-Methods':expected,'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Private-Network':'true','Access-Control-Max-Age':'600'});response.end();return;
    }
    if(request.method!==expected){send(response,405,{error:'Method not allowed.'},origin);return;}
    const authorization=request.headers.authorization;const expectedAuthorization=`Bearer ${capability}`;
    if(!active||typeof authorization!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(authorization)||!timingSafeEqual(Buffer.from(authorization),Buffer.from(expectedAuthorization))){send(response,401,{error:'Companion pairing is invalid or disconnected. Restart it and open the new pairing URL.'},origin);return;}
    if(pendingRequests>=8){send(response,429,{error:'The companion is busy. Retry shortly.'},origin);return;}pendingRequests++;
    try{
      if(url.pathname==='/api/session'){const user=await identity();send(response,200,{configured:true,authenticated:true,login:user.login,connection:'companion',readOnly:!!options.readOnly},origin);}
      else if(url.pathname==='/api/github/repositories'){await identity();const repositories=[];for(const selected of options.repositories)repositories.push(await repository(selected));send(response,200,{repositories},origin);}
      else if(url.pathname==='/api/github/reviewers'){await identity();const repo=await repository(url.searchParams.get('repository')??'');const result=await fetchReviewerSuggestions(repo,url.searchParams.get('prId')??'',api);send(response,200,result,origin);}
      else if(url.pathname==='/api/github/workspace'){const fetched=await view(url.searchParams.get('repository')??'');send(response,200,{workspace:hydrateWorkspace(fetched.workspace,await service.read(planKey(fetched.repo))),coordination:coordination(fetched.actor),viewerLogin:fetched.actor.login,warnings:[...fetched.warnings,'Local companion: plans and coordination are saved on this laptop. Updates and automation pause when it sleeps or the companion stops.']},origin);}
      else if(url.pathname==='/api/github/plans'){const body=await readBody(request,16000);const input=parsePlan(body);send(response,200,await serialize(input.repository.toLowerCase(),()=>savePlan(body)),origin);}
      else if(url.pathname==='/api/github/workflow'){const input=parseWorkflowInput(await readBody(request,64000));send(response,200,await serialize(input.repository.toLowerCase(),()=>updateWorkflow(input)),origin);void tick();}
      else{active=false;if(timer)clearInterval(timer);send(response,204,undefined,origin);}
    }catch(error){const status=error instanceof AccessError||error instanceof WorkflowError?error.status:502;send(response,status,{error:error instanceof Error?error.message:'The companion could not complete the operation.'},origin);}finally{pendingRequests--;}
  }).catch(()=>{if(!response.headersSent)send(response,500,{error:'Companion request failed.'});else response.end();});requestTasks.add(task);void task.finally(()=>requestTasks.delete(task));});
  server.headersTimeout=10000;server.requestTimeout=30000;server.maxHeadersCount=32;
  return {server,capability,identity:initial,async listen(){await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(options.port,'127.0.0.1',()=>{server.off('error',reject);resolve();});});port=(server.address() as {port:number}).port;timer=setInterval(()=>void tick(),options.pollIntervalMs??30000);timer.unref();return {port,pairUrl:`${options.origin}/#companion=${capability}&port=${port}`};},async close(){active=false;if(timer)clearInterval(timer);await new Promise<void>(resolve=>{if(!server.listening){resolve();return;}server.close(()=>resolve());server.closeIdleConnections();});await Promise.allSettled([...requestTasks,...operations.values()]);await ownedStore?.close();}};
}
