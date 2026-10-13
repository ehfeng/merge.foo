import type { Activity, Command, PullRequest, Workspace } from './types';

export function latestReviews(pr: PullRequest) {
  const latest = new Map<string, PullRequest['reviews'][number]>();
  const reviews=[...pr.reviews].filter(review=>review.decision!=='commented').sort((a,b)=>Date.parse(a.submittedAt??a.at)-Date.parse(b.submittedAt??b.at)||(/^\d+$/.test(a.eventId??'')&&/^\d+$/.test(b.eventId??'')?(BigInt(a.eventId!)<BigInt(b.eventId!)?-1:BigInt(a.eventId!)>BigInt(b.eventId!)?1:0):0));
  for (const review of reviews) latest.set(review.reviewerId, review);
  return [...latest.values()];
}
export function isApproved(pr: PullRequest): boolean {
  if(pr.approvalVerified===false||pr.observedGate==='unknown'||pr.observedGate==='review_required'||pr.observedGate==='changes_requested')return false;
  const reviews = latestReviews(pr).filter(r=>r.eligible!==false&&!r.dismissed&&r.reviewerId!==pr.author);
  return !reviews.some(r=>r.decision==='changes_requested')&&reviews.filter(r=>r.decision==='approved').length>=Math.max(1,pr.requiredApprovals);
}
export function ancestors(workspace: Workspace, pr: PullRequest): PullRequest[] {
  const found: PullRequest[] = [];
  const seen = new Set([pr.id]);
  let parentId = pr.parentId;
  while (parentId) {
    const parent = workspace.prs.find(p => p.id === parentId);
    if (!parent || seen.has(parent.id)) break;
    seen.add(parent.id); found.push(parent); parentId = parent.parentId;
  }
  return found;
}
export function blockers(workspace: Workspace, pr: PullRequest): string[] {
  const reasons: string[] = [];
  if (pr.lifecycle !== 'open') reasons.push(`PR is ${pr.lifecycle}`);
  if (pr.held) reasons.push('Author hold');
  if (!pr.plannedReviewerIds.length && !pr.release) reasons.push('Choose a reviewer');
  if (pr.parentId && !workspace.prs.some(p => p.id === pr.parentId)) reasons.push('Missing prerequisite');
  const parents = ancestors(workspace, pr);
  if (parents.some(p => p.lifecycle !== 'merged' && !isApproved(p))) reasons.push('Waiting for prerequisite approval');
  return reasons;
}
export function attention(workspace: Workspace, pr: PullRequest): boolean {
  return ancestors(workspace, pr).some(p => p.lifecycle !== 'merged' && !isApproved(p)) && pr.requests.length > 0;
}
export function stateOf(pr: PullRequest): string {
  if (pr.lifecycle !== 'open') return pr.lifecycle === 'merged' ? 'Merged' : 'Closed';
  if (pr.held) return 'Held';
  if (pr.approvalVerified===false) return 'Review uncertain';
  if (isApproved(pr)) return 'Approved';
  if (pr.observedGate === 'changes_requested' || latestReviews(pr).some(r => r.decision === 'changes_requested'&&!r.dismissed&&r.eligible!==false)) return 'Changes requested';
  if(pr.workflow?.uncertain)return 'Review uncertain';
  if(pr.workflow?.pending)return 'Release pending';
  if (pr.release && (!pr.release.readyCompleted || pr.release.completedReviewerIds.length < pr.release.requestTargets.length)) return 'Release pending';
  if (pr.requests.length) return 'In review';
  if (pr.observedGate) return pr.readiness === 'draft' ? 'Draft' : 'Ready';
  return 'Queued';
}
export function outstanding(pr: PullRequest) {
  if (pr.observedGate) return pr.requests; // GitHub's current requests are authoritative, including re-requests.
  const completed = new Set(latestReviews(pr).filter(r => r.decision !== 'commented' && !r.dismissed).map(r => r.reviewerId));
  return pr.requests.filter(r => !completed.has(r.reviewerId));
}
export function reviewerLoad(workspace: Workspace, reviewerId: string, now = new Date()) {
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const active = workspace.prs.filter(p => p.lifecycle === 'open' && outstanding(p).some(r => r.reviewerId === reviewerId));
  const planned = workspace.prs.filter(p => p.lifecycle === 'open' && !p.requests.some(r=>r.reviewerId===reviewerId) && p.plannedReviewerIds.includes(reviewerId));
  const sent = workspace.prs.flatMap(p => p.requests).filter(r => r.reviewerId === reviewerId && new Date(r.requestedAt).getTime() >= weekAgo);
  const completed = workspace.prs.flatMap(p => latestReviews(p)).filter(r => r.reviewerId === reviewerId && r.decision !== 'commented' && new Date(r.at).getTime() >= weekAgo);
  return { active: active.length, planned: planned.length, sent: sent.length, completed: completed.length,
    effectiveLines: active.reduce((n,p) => n+p.lines.added+p.lines.deleted-p.lines.discounted,0) };
}

/** Pure fixture workflow. The real GitHub adapter is read-only and never calls this engine. */
export function applyCommand(original: Workspace, command: Command, at = new Date().toISOString()): Workspace {
  const workspace = structuredClone(original);
  const pr = 'prId' in command ? workspace.prs.find(p => p.id === command.prId) : undefined;
  function log(stackId: string, message: string, kind: Activity['kind'], prId?: string) {
    workspace.activity.unshift({ id: `${at}-${workspace.activity.length}`, at, stackId, prId, message, kind });
  }
  function release(target: PullRequest,mode:'automatic'|'manual'='manual',early=false) {
    if(early)target.manualOverride=true;
    const reasons = blockers(workspace, target).filter(reason=>!early||reason!=='Waiting for prerequisite approval');
    if (reasons.length) { log(target.stackId, `#${target.number}: ${reasons.join(' · ')}`, 'pause', target.id); return; }
    // Snapshot the plan at release time. Editing a future plan never changes existing requests.
    target.release ??= { key: `review:${target.id}:${workspace.activity.length}`, generation:workspace.activity.length+1, provenance:mode, priorReadiness:target.readiness, createdReviewerIds:[], requestTargets: [...target.plannedReviewerIds], readyCompleted: false, completedReviewerIds: [] };
    const action = target.release;
    if (!action.readyCompleted) {
      if (target.syncFailure === 'ready') { delete target.syncFailure; log(target.stackId, `#${target.number}: readiness failed; safe retry available`, 'sync', target.id); return; }
      target.readiness = 'ready'; action.readyCompleted = true;
    }
    for (const reviewerId of action.requestTargets) {
      if (action.completedReviewerIds.includes(reviewerId)) continue;
      if (target.syncFailure === 'request') { delete target.syncFailure; log(target.stackId, `#${target.number}: ready succeeded; review request pending`, 'sync', target.id); return; }
      const key = `${action.key}:${reviewerId}`;
      if (!target.requests.some(r => r.key === key)) {target.requests.push({ reviewerId, key, requestedAt: at });action.createdReviewerIds??=[];action.createdReviewerIds.push(reviewerId);}
      action.completedReviewerIds.push(reviewerId);
      log(target.stackId, `#${target.number}: requested ${workspace.reviewers.find(r => r.id === reviewerId)?.name ?? reviewerId} (mock)`, 'release', target.id);
    }
  }
  if (command.type === 'review' && pr) {
    if (workspace.handledEventIds.includes(command.eventId)) return original;
    workspace.handledEventIds.push(command.eventId);
    pr.reviews.push({ reviewerId: command.reviewerId, decision: command.decision, contentVersion: command.contentVersion ?? pr.contentVersion, at:command.submittedAt??at,submittedAt:command.submittedAt, eventId: command.eventId, dismissed:command.dismissed,eligible:command.eligible });
    log(pr.stackId, `#${pr.number}: ${command.decision.replace('_', ' ')} by ${workspace.reviewers.find(r => r.id === command.reviewerId)?.name}`, 'review', pr.id);
  }
  if (command.type === 'hold' && pr) { pr.held = command.held; log(pr.stackId, `#${pr.number}: ${pr.held ? 'hold added' : 'hold removed'}`, 'intent', pr.id); }
  if (command.type === 'ready' && pr) { pr.readiness = command.readiness;if(pr.release&&command.readiness==='ready')pr.release.priorReadiness='ready'; log(pr.stackId, `#${pr.number}: author marked ${command.readiness}`, 'intent', pr.id); }
  if (command.type === 'plan' && pr) { pr.plannedReviewerIds = command.reviewerIds.filter(id => workspace.reviewers.some(r => r.id === id)); log(pr.stackId, `#${pr.number}: planned assignment updated`, 'intent', pr.id); }
  if (command.type === 'auto') { const stack = workspace.stacks.find(s => s.id === command.stackId); if (stack) { stack.autoProgress = command.enabled; log(stack.id, `Automatic progression ${command.enabled ? 'enabled' : 'paused'}`, 'intent'); } }
  if (command.type === 'invalidate' && pr) { pr.validity = command.validity; if (command.validity === 'stale') pr.contentVersion++; log(pr.stackId, `#${pr.number}: content changed; existing approvals remain valid unless dismissed or superseded`, 'sync', pr.id); }
  if (command.type === 'fail' && pr) pr.syncFailure = command.step;
  if (command.type === 'start' && pr) {if(command.early)log(pr.stackId,`#${pr.number}: manual early review; prerequisites remain unapproved`,'intent',pr.id);release(pr,'manual',command.early);}
  if(command.type==='approval-minimum'&&pr){if(Number.isSafeInteger(command.minimum)&&command.minimum>=1&&command.minimum<=20)pr.requiredApprovals=command.minimum;}
  if(command.type==='dependency'&&pr){if(command.parentId!==pr.id&&(!command.parentId||workspace.prs.some(p=>p.id===command.parentId))){const previous=pr.parentId;pr.parentId=command.parentId;if(ancestors(workspace,pr).some(p=>p.parentId===pr.id))pr.parentId=previous;}}
  for(const target of workspace.prs){const action=target.release;if(!action||action.provenance!=='automatic'||target.manualOverride||target.lifecycle!=='open')continue;const parents=ancestors(workspace,target);const failed=parents.some(parent=>parent.lifecycle!=='merged'&&parent.approvalVerified!==false&&parent.observedGate!=='unknown'&&!isApproved(parent));if(!failed)continue;const active=new Set(outstanding(target).map(request=>request.key));target.requests=target.requests.filter(request=>!action.createdReviewerIds?.includes(request.reviewerId)||!active.has(request.key)||!request.key.startsWith(action.key));if(action.priorReadiness==='draft'&&action.readyCompleted)target.readiness='draft';target.release=undefined;log(target.stackId,`#${target.number}: automatic release rolled back after upstream approval loss; planned reviewers and completed reviews preserved`,'pause',target.id);}
  // Roots always require an explicit start. Independent chains reconcile independently.
  for (const stack of workspace.stacks.filter(s => s.autoProgress)) {
    for (const next of workspace.prs.filter(p => p.stackId === stack.id && p.parentId && p.lifecycle === 'open')) {
      const finished = next.release && next.release.readyCompleted && next.release.completedReviewerIds.length === next.release.requestTargets.length;
      if (!finished && !next.requests.length && blockers(workspace, next).length === 0) release(next,'automatic');
      else if (next.release && !finished && blockers(workspace, next).length === 0) release(next,'automatic');
    }
  }
  return workspace;
}
