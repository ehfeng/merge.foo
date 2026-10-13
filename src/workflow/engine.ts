import type {WorkflowDocument,WorkflowSnapshot,WorkflowPr,WorkflowReview,WorkflowAction,WorkflowActor,WorkflowCommand,Release,EffectOutcome} from './types';
import {WorkflowError} from './types';
import {forestGroups} from './topology';
export const emptyWorkflow=():WorkflowDocument=>({schemaVersion:1,version:0,config:{prs:{},stacks:{}},releases:{},actions:[],activity:[],handledEventIds:[]});
const numericCompare=(a:string,b:string)=>/^\d+$/.test(a)&&/^\d+$/.test(b)?(BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0):a.localeCompare(b);
export function decisiveReviews(reviews:WorkflowReview[]):WorkflowReview[] {
  const latest=new Map<string,WorkflowReview>();
  for(const review of [...reviews].filter(r=>r.state!=='commented').sort((a,b)=>Date.parse(a.submittedAt)-Date.parse(b.submittedAt)||numericCompare(a.id,b.id)))latest.set(review.reviewerId,review);
  return [...latest.values()];
}
export function approvalGate(pr:WorkflowPr,minimum=1):'passed'|'failed'|'unknown' {
  if(pr.lifecycle==='merged')return 'passed';if(pr.lifecycle==='closed')return 'failed';
  if(pr.githubGate==='changes_requested'||pr.githubGate==='review_required')return 'failed';
  if(!pr.reviewsComplete||pr.reviews.some(r=>r.state!=='commented'&&!Number.isFinite(Date.parse(r.submittedAt))))return 'unknown';
  const reviews=decisiveReviews(pr.reviews).filter(r=>r.eligible&&r.reviewerId!==pr.author.id);
  if(reviews.some(r=>r.state==='changes_requested')||reviews.filter(r=>r.state==='approved').length<Math.max(1,minimum))return 'failed';return pr.githubGate==='unknown'?'unknown':'passed';
}
export function effectivePr(pr:WorkflowPr,document:WorkflowDocument):WorkflowPr {
  const override=document.config.prs[pr.id];return override&&'parentId'in override?{...pr,parentId:override.parentId??undefined,topologyVerified:true}:pr;
}
export function prerequisiteGate(snapshot:WorkflowSnapshot,document:WorkflowDocument,pr:WorkflowPr):'passed'|'failed'|'unknown' {
  if(!snapshot.complete)return 'unknown';const seen=new Set([pr.id]);let current=effectivePr(pr,document);let result:'passed'|'failed'|'unknown'='passed';
  while(current.parentId){if(seen.has(current.parentId))return 'unknown';seen.add(current.parentId);const parent=snapshot.prs.find(p=>p.id===current.parentId);if(!parent)return 'unknown';const gate=approvalGate(parent,document.config.prs[parent.id]?.minimumApprovals??1);if(gate==='failed')result='failed';else if(gate==='unknown'&&result!=='failed')result='unknown';current=effectivePr(parent,document);}
  return result;
}
function upstreamHeld(snapshot:WorkflowSnapshot,document:WorkflowDocument,pr:WorkflowPr):boolean{let current=effectivePr(pr,document);const seen=new Set([pr.id]);while(current.parentId){if(seen.has(current.parentId))return true;seen.add(current.parentId);if(document.config.prs[current.parentId]?.held)return true;const next=snapshot.prs.find(p=>p.id===current.parentId);if(!next)return false;current=effectivePr(next,document);}return false;}
export function chainProblem(snapshot:WorkflowSnapshot,document:WorkflowDocument,stackId:string):string|null {
  const stack=document.config.stacks[stackId];if(!stack?.enrolled)return 'This feature is not enrolled.';
  if(!snapshot.complete)return 'Repository coverage could not be verified.';
  const nodes=stack.prIds.map(id=>snapshot.prs.find(p=>p.id===id)).filter((p):p is WorkflowPr=>!!p).map(p=>effectivePr(p,document));
  if(nodes.length!==stack.prIds.length||!nodes.length)return 'Managed PR coverage is incomplete.';
  const ids=new Set(nodes.map(p=>p.id));const children=new Map<string,number>();let roots=0;
  for(const node of nodes){if(node.topologyVerified!==true)return 'Confirm this PR’s dependency before enabling progression.';if(node.parentId){if(!ids.has(node.parentId))return 'A prerequisite is outside this managed feature.';children.set(node.parentId,(children.get(node.parentId)??0)+1);}else roots++;}
  if([...children.values()].some(count=>count>1))return 'Branching features require manual review starts.';
  if(roots!==1)return 'Automatic progression requires one connected simple chain.';
  for(const node of nodes){const seen=new Set([node.id]);let parent=node.parentId;while(parent){if(seen.has(parent))return 'Cyclic dependencies require correction.';seen.add(parent);parent=nodes.find(p=>p.id===parent)?.parentId;}}
  return null;
}
function activity(document:WorkflowDocument,at:string,actor:WorkflowActor,message:string,kind:WorkflowDocument['activity'][number]['kind'],prId?:string,stackId?:string){document.activity.unshift({id:`${at}:${document.version}:${document.activity.length}`,at,actorId:actor.id,actorLogin:actor.login,message,kind,prId,stackId});}
function stackFor(document:WorkflowDocument,prId:string):string|undefined{return Object.entries(document.config.stacks).find(([,s])=>s.enrolled&&s.prIds.includes(prId))?.[0];}
function enqueue(document:WorkflowDocument,release:Release,kind:WorkflowAction['kind'],at:string,reviewer?:WorkflowAction['reviewer']) {
  const id=`${release.prId}:${release.generation}:${kind}:${reviewer?.id??''}`;
  if(document.actions.some(a=>a.id===id))return;
  document.actions.push({id,prId:release.prId,stackId:release.stackId,generation:release.generation,kind,reviewer,mode:release.mode,status:'pending',attempts:0,dueAt:at});
}
function queueRelease(document:WorkflowDocument,pr:WorkflowPr,stackId:string,mode:Release['mode'],actor:WorkflowActor,at:string) {
  const previous=document.releases[pr.id];if(previous&&!previous.rolledBack)return;
  const release:Release={prId:pr.id,stackId,generation:(previous?.generation??0)+1,mode,priorReadiness:pr.readiness,targets:structuredClone(pr.plannedReviewers),requestReceipts:{},invalidated:false,rolledBack:false,createdAt:at,actorId:actor.id,actorLogin:actor.login};
  document.releases[pr.id]=release;if(pr.readiness==='draft')enqueue(document,release,'ready',at);
  for(const target of release.targets)if(!pr.requests.some(r=>r.reviewerId===target.id)&&!decisiveReviews(pr.reviews).some(review=>review.reviewerId===target.id&&review.eligible&&review.state==='approved'))enqueue(document,release,'request',at,target);
  activity(document,at,actor,`${mode==='automatic'?'Automatic':'Manual'} review release queued for #${pr.number}. No step is complete until GitHub confirms it.`,'release',pr.id,stackId);
}
export function reduceCommand(original:WorkflowDocument,snapshot:WorkflowSnapshot,actor:WorkflowActor,command:WorkflowCommand,at=snapshot.observedAt):WorkflowDocument {
  const document=structuredClone(original);
  if(command.type==='reconcile'){for(const action of document.actions)if(action.status==='failed'){if(action.uncertainOutcome){action.status='uncertain';action.reason='Manual read-only reconciliation requested; no notification will be replayed.';}else if(!action.dispatchStarted){action.status='pending';action.reason='Manual retry requested for a confirmed unsent step; fresh authorization is still required.';}else continue;action.attempts=0;action.dueAt=at;}return reconcileWorkflow(document,snapshot,command.eventId);}
  if(command.type==='configure_pr') {
    const pr=snapshot.prs.find(p=>p.id===command.prId);if(!pr)throw new WorkflowError('PR not found.',404);if(pr.author.id!==actor.id&&!actor.canWrite)throw new WorkflowError('Only the author or a repository writer can coordinate this PR.',403);
    const config=document.config.prs[pr.id]??{held:false,minimumApprovals:1,manualOverride:false};
    if(command.minimumApprovals!==undefined){if(pr.author.id!==actor.id)throw new WorkflowError('Only the PR author can change its approval minimum.',403);if(!Number.isSafeInteger(command.minimumApprovals)||command.minimumApprovals<1||command.minimumApprovals>20)throw new WorkflowError('Choose an approval minimum between 1 and 20.');config.minimumApprovals=command.minimumApprovals;}
    if(command.held!==undefined)config.held=command.held;
    if('parentId'in command){if(command.parentId===pr.id)throw new WorkflowError('A PR cannot depend on itself.');if(command.parentId&&!snapshot.prs.some(p=>p.id===command.parentId))throw new WorkflowError('Select a known prerequisite.');const currentStack=stackFor(document,pr.id);const parentStack=command.parentId?stackFor(document,command.parentId):undefined;if(currentStack&&parentStack&&currentStack!==parentStack)throw new WorkflowError('Disable or regroup the managed features before joining their dependencies.');config.parentId=command.parentId??null;}
    document.config.prs[pr.id]=config;
    // Reject a newly introduced cycle, even when automatic progression is off.
    for(const candidate of snapshot.prs){const seen=new Set([candidate.id]);let next=effectivePr(candidate,document).parentId;while(next){if(seen.has(next))throw new WorkflowError('This dependency would create a cycle.');seen.add(next);const parent=snapshot.prs.find(p=>p.id===next);next=parent?effectivePr(parent,document).parentId:undefined;}}
    activity(document,at,actor,`Coordination settings updated for #${pr.number}.`,'intent',pr.id,stackFor(document,pr.id));
  }
  if(command.type==='enroll') {
    const groups=forestGroups(snapshot.prs.map(pr=>effectivePr(pr,document)),document).groups;const ids=command.prIds??snapshot.prs.filter(p=>groups.get(p.id)===command.stackId).map(p=>p.id);
    if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!snapshot.prs.some(p=>p.id===id)))throw new WorkflowError('Select known PRs for this feature.');
    if(!actor.canWrite&&ids.some(id=>snapshot.prs.find(p=>p.id===id)!.author.id!==actor.id))throw new WorkflowError('A repository writer must manage a feature containing other authors’ PRs.',403);
    if(command.enabled&&Object.entries(document.config.stacks).some(([id,s])=>id!==command.stackId&&s.enrolled&&s.prIds.some(id=>ids.includes(id))))throw new WorkflowError('A PR is already enrolled in another feature.');
    const previous=document.config.stacks[command.stackId];document.config.stacks[command.stackId]={enrolled:command.enabled,autoProgress:command.enabled&&(command.autoProgress??false),started:previous?.started??false,prIds:ids,actorId:actor.id,actorLogin:actor.login};
    if(command.autoProgress&&command.enabled){const reason=chainProblem(snapshot,document,command.stackId);if(reason)throw new WorkflowError(reason);}
    activity(document,at,actor,`Feature ${command.enabled?'enrolled':'disabled'}; automatic progression ${document.config.stacks[command.stackId].autoProgress?'enabled':'off'}.`,'intent',undefined,command.stackId);
  }
  if(command.type==='auto') {
    const stack=document.config.stacks[command.stackId];if(!stack?.enrolled)throw new WorkflowError('Enroll this feature first.');if(!actor.canWrite&&stack.prIds.some(id=>snapshot.prs.find(p=>p.id===id)?.author.id!==actor.id))throw new WorkflowError('Only feature authors or repository writers can change progression.',403);
    if(command.enabled){const reason=chainProblem(snapshot,document,command.stackId);if(reason)throw new WorkflowError(reason);}stack.autoProgress=command.enabled;if(command.enabled){stack.actorId=actor.id;stack.actorLogin=actor.login;}
    activity(document,at,actor,`Automatic progression ${command.enabled?'enabled':'paused'}.`,'intent',undefined,command.stackId);
  }
  if(command.type==='start') {
    const pr=snapshot.prs.find(p=>p.id===command.prId);const stackId=stackFor(document,command.prId);if(!pr||!stackId)throw new WorkflowError('Enroll this PR’s feature before starting review.');if(pr.lifecycle!=='open')throw new WorkflowError('Only open PRs can start review.');if(pr.author.id!==actor.id&&!actor.canWrite)throw new WorkflowError('Only the PR author or a repository writer can start review.',403);
    if(document.config.prs[pr.id]?.held)throw new WorkflowError('Remove this PR’s hold before starting review.');if(!pr.plannedReviewers.length)throw new WorkflowError('Choose planned reviewers before starting review.');
    const upstream=prerequisiteGate(snapshot,document,pr);if(upstream!=='passed'&&!command.early)throw new WorkflowError('Prerequisite approval is unresolved. Explicitly confirm an early review to continue.');
    const existing=document.releases[pr.id];if(existing&&!existing.rolledBack){if(existing.invalidated)throw new WorkflowError('An earlier automatic release is still being rolled back. Reconcile it before starting a manual review.');if(document.actions.some(action=>action.prId===pr.id&&action.generation===existing.generation&&['pending','claimed','uncertain','failed'].includes(action.status)))throw new WorkflowError('A release is already pending. Reconcile its frozen reviewer targets before starting another review.');}
    document.config.stacks[stackId].started=true;
    if(command.early){const config=document.config.prs[pr.id]??{held:false,minimumApprovals:1,manualOverride:false};config.manualOverride=true;document.config.prs[pr.id]=config;activity(document,at,actor,'Manual early-review override recorded. Prerequisites remain unapproved.','intent',pr.id,stackId);}
    queueRelease(document,pr,stackId,'manual',actor,at);
  }
  return reconcileWorkflow(document,snapshot);
}
export function reconcileWorkflow(original:WorkflowDocument,snapshot:WorkflowSnapshot,eventId?:string):WorkflowDocument {
  const document=structuredClone(original);if(eventId&&document.handledEventIds.includes(eventId))return document;if(eventId)document.handledEventIds.push(eventId);
  if(!snapshot.complete)return document;
  for(const release of Object.values(document.releases)) {
    const pr=snapshot.prs.find(p=>p.id===release.prId);if(!pr)continue;
    if(release.mode==='automatic'&&!document.config.prs[pr.id]?.manualOverride&&pr.lifecycle==='open'&&(release.invalidated||prerequisiteGate(snapshot,document,pr)==='failed')) {
      if(!release.invalidated){release.invalidated=true;activity(document,snapshot.observedAt,{id:release.actorId,login:'merge.foo',canWrite:false},`Upstream approval failed; automatic release of #${pr.number} invalidated.`,'rollback',pr.id,release.stackId);}
      for(const action of document.actions.filter(a=>a.prId===pr.id&&a.generation===release.generation&&['ready','request'].includes(a.kind)&&a.status==='pending'))action.status='cancelled';
      release.rollbackBlocked=undefined;
      for(const [reviewerId,receipt] of Object.entries(release.requestReceipts)){const request=pr.requests.find(r=>r.reviewerId===reviewerId);const pending=document.actions.find(a=>a.prId===pr.id&&a.generation===release.generation&&a.kind==='remove_request'&&a.reviewer?.id===reviewerId&&a.status==='pending');
        if(pr.requestsComplete===false||request&&(!receipt.attributable||!receipt.eventId||!request.eventId)){release.rollbackBlocked='Current request provenance is incomplete. Reconciliation is required.';continue;}
        if(request&&receipt.eventId===request.eventId)enqueue(document,release,'remove_request',snapshot.observedAt,{id:reviewerId,login:request.login});else if(pending)pending.status='cancelled';
      }
      if(release.priorReadiness==='draft'&&release.readyReceipt&&pr.readiness==='ready'){if(!release.readyReceipt.attributable||!release.readyReceipt.eventId||!pr.readinessEvent?.id)release.rollbackBlocked='Current readiness provenance is incomplete. Reconciliation is required.';else if(pr.readinessEvent.id===release.readyReceipt.eventId)enqueue(document,release,'draft',snapshot.observedAt);else for(const action of document.actions.filter(a=>a.prId===pr.id&&a.generation===release.generation&&a.kind==='draft'&&a.status==='pending'))action.status='cancelled';}
      else if(pr.readiness==='draft')for(const action of document.actions.filter(a=>a.prId===pr.id&&a.generation===release.generation&&a.kind==='draft'&&a.status==='pending'))action.status='cancelled';
      const pending=document.actions.some(a=>a.prId===pr.id&&a.generation===release.generation&&['pending','claimed','uncertain','failed'].includes(a.status));
      if(!pending&&!release.rollbackBlocked)release.rolledBack=true;
    }
    if(pr.lifecycle!=='open')for(const action of document.actions.filter(a=>a.prId===pr.id&&a.generation===release.generation&&a.status==='pending'))action.status='cancelled';
  }
  for(const [stackId,stack] of Object.entries(document.config.stacks)) {
    if(!stack.enrolled||!stack.autoProgress||!stack.started||chainProblem(snapshot,document,stackId))continue;
    for(const id of stack.prIds){const original=snapshot.prs.find(p=>p.id===id)!;const pr=effectivePr(original,document);if(!pr.parentId||pr.lifecycle!=='open'||document.config.prs[id]?.held||!pr.plannedReviewers.length||pr.requests.length||approvalGate(pr,document.config.prs[id]?.minimumApprovals??1)==='passed'&&pr.readiness==='ready')continue;if(prerequisiteGate(snapshot,document,pr)==='passed'&&!upstreamHeld(snapshot,document,pr))queueRelease(document,pr,stackId,'automatic',{id:stack.actorId,login:stack.actorLogin,canWrite:false},snapshot.observedAt);}
  }
  for(const action of document.actions)if(action.status==='pending')action.reason=actionBlocker(action,document,snapshot)??undefined;
  return document;
}
export function actionBlocker(action:WorkflowAction,document:WorkflowDocument,snapshot:WorkflowSnapshot):string|null {
  const release=document.releases[action.prId];const pr=snapshot.prs.find(p=>p.id===action.prId);const stack=document.config.stacks[action.stackId];
  if(!release||release.generation!==action.generation)return 'Release generation changed.';if(!pr||!snapshot.complete)return 'Current repository observation is unavailable.';if(pr.lifecycle!=='open')return 'PR is no longer open.';if(!stack?.enrolled||!stack.prIds.includes(pr.id))return 'Managed scope was revoked.';
  const rollback=action.kind==='draft'||action.kind==='remove_request';
  if(rollback){if(!release.invalidated||release.mode!=='automatic'||document.config.prs[pr.id]?.manualOverride)return 'Automatic rollback is no longer authorized.';if(prerequisiteGate(snapshot,document,pr)==='unknown')return 'Upstream approval cannot be verified.';if(action.kind==='draft'&&(pr.readiness!=='ready'||!release.readyReceipt?.attributable||pr.readinessEvent?.id!==release.readyReceipt.eventId))return 'Readiness has changed outside this release.';if(action.kind==='remove_request'){const request=pr.requests.find(r=>r.reviewerId===action.reviewer?.id);const receipt=release.requestReceipts[action.reviewer?.id??''];if(!request||!receipt?.attributable||request.eventId!==receipt.eventId)return 'This request is no longer attributable to the automatic release.';}return null;}
  if(release.invalidated)return 'Release was invalidated.';if(document.config.prs[pr.id]?.held)return 'PR is held.';if(!document.config.prs[pr.id]?.manualOverride&&upstreamHeld(snapshot,document,pr))return 'An upstream PR is held.';
  if(action.mode==='automatic'){if(!stack.autoProgress||!stack.started)return 'Automatic progression is paused.';const problem=chainProblem(snapshot,document,action.stackId);if(problem)return problem;}
  if(!document.config.prs[pr.id]?.manualOverride&&prerequisiteGate(snapshot,document,pr)!=='passed')return 'Prerequisite approval is unresolved.';
  if(action.kind==='request'&&!pr.reviewsComplete)return 'Current review decisions could not be fully verified.';
  if(action.kind==='request'&&pr.requestsComplete===false)return 'Current reviewer requests could not be fully verified.';
  if(action.kind==='request'&&pr.readiness!=='ready')return 'PR is not ready yet.';
  return null;
}
export function completeAction(document:WorkflowDocument,action:WorkflowAction,outcome:EffectOutcome,at:string) {
  if(outcome.state==='not_applied'){action.dispatchStarted=false;action.effectActorId=undefined;action.baselineEventIds=undefined;action.startedAt=undefined;}action.uncertainOutcome=outcome.state==='unknown';action.status=outcome.state==='unknown'?'uncertain':outcome.state==='not_applied'?'pending':'done';action.reason=outcome.reason;action.claim=undefined;
  if(outcome.receipt){action.receipt=outcome.receipt;const release=document.releases[action.prId];if(release&&release.generation===action.generation&&outcome.state==='applied'){if(action.kind==='ready')release.readyReceipt=outcome.receipt;if(action.kind==='request'&&action.reviewer)release.requestReceipts[action.reviewer.id]=outcome.receipt;}}
  if(action.status==='done')activity(document,at,{id:outcome.receipt?.actorId??document.releases[action.prId]?.actorId??'',login:'merge.foo',canWrite:false},`${action.kind.replace('_',' ')} step confirmed${outcome.state==='already'?' from existing GitHub state':''}.`,'sync',action.prId,action.stackId);
}
