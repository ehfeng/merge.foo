import {useEffect,useState} from 'react';
import {AlertCircle,Pause,Play,RefreshCw} from 'lucide-react';
import type {PullRequest,Workspace} from '../domain/types';
import {ancestors,isApproved} from '../domain/engine';
import type {WorkflowCommand} from '../workflow/types';
export type CoordinationAccess={canManage:boolean;writesEnabled:boolean;backgroundEnabled:boolean;backgroundReason?:string};
export default function CoordinationControls({workspace,pr,access,viewerLogin,saving,onCommand,onVerifyPlan}:{workspace:Workspace;pr:PullRequest;access:CoordinationAccess;viewerLogin?:string;saving:boolean;onCommand:(command:WorkflowCommand)=>void;onVerifyPlan?:()=>void}) {
  const stack=workspace.stacks.find(s=>s.id===pr.stackId);
  const canEdit=!!pr.canEditPlan;
  const [preview,setPreview]=useState(false);const [early,setEarly]=useState(false);const [minimum,setMinimum]=useState(Math.max(1,pr.requiredApprovals));
  useEffect(()=>{setMinimum(Math.max(1,pr.requiredApprovals));setPreview(false);setEarly(false);},[pr.id,pr.requiredApprovals,pr.planVersion,workspace.workflowVersion]);
  const upstream=ancestors(workspace,pr).filter(p=>p.lifecycle!=='merged'&&!isApproved(p));
  const enrolled=pr.workflow?.enrolled??stack?.enrolled??false;
  const recipients=pr.plannedReviewerIds;
  const verifiedPlan=!!pr.plannedReviewerIdentities?.length&&pr.plannedReviewerIdentities.length===recipients.length&&pr.plannedReviewerIdentities.every((r,index)=>r.login.toLowerCase()===recipients[index].toLowerCase());
  return <div className="coordination-controls">
    {canEdit&&<>
      <div className="selected-pr-controls"><button className="button subtle" disabled={saving||pr.lifecycle!=='open'} aria-label={`${pr.held?'Remove':'Add'} hold on #${pr.number}`} onClick={()=>onCommand({type:'configure_pr',prId:pr.id,held:!pr.held})}><Pause size={13}/>{pr.held?'Remove hold':'Hold review'}</button></div>
      <label className="coordination-field">Depends on PR<select aria-label={`Dependency for #${pr.number}`} disabled={saving} value={pr.parentId??''} onChange={e=>onCommand({type:'configure_pr',prId:pr.id,parentId:e.target.value||null})}><option value="">No prerequisite</option>{workspace.prs.filter(p=>p.id!==pr.id).map(p=><option key={p.id} value={p.id} disabled={!!(enrolled&&p.workflow?.enrolled&&p.stackId!==pr.stackId)}>#{p.number} {p.title}</option>)}</select></label>
      {pr.dependencySource&&<p className="microcopy">Dependency source: {pr.dependencySource==='declared'?'declared in merge.foo':pr.dependencySource==='observed'?'observed GitHub branch relationship':'not verified'}.</p>}
      <p className="microcopy">Changing a dependency rechecks review eligibility. Automatic releases may be rolled back when an upstream approval is lost.</p>
      {viewerLogin?.toLowerCase()===pr.author.toLowerCase()&&<label className="coordination-field">Minimum approvals<div className="coordination-input-row"><input aria-label={`Minimum approvals for #${pr.number}`} type="number" min={1} max={20} value={minimum} disabled={saving} onChange={e=>setMinimum(Number(e.target.value))}/><button className="button subtle" disabled={saving||!Number.isInteger(minimum)||minimum<1||minimum>20||minimum===Math.max(1,pr.requiredApprovals)} onClick={()=>onCommand({type:'configure_pr',prId:pr.id,minimumApprovals:minimum})}>Save</button></div></label>}
    </>}
    {access.canManage&&stack&&<div className="coordination-feature"><button className="button subtle full" disabled={saving} onClick={()=>onCommand({type:'enroll',stackId:stack.id,enabled:!enrolled,prIds:workspace.prs.filter(p=>p.stackId===stack.id).map(p=>p.id)})}>{enrolled?'Disable feature coordination':'Enable feature coordination'}</button><p className="microcopy">Enrollment records this feature’s PRs. Its first review starts explicitly.</p>{enrolled&&<button className="selected-auto" aria-label={`Automatic progression for ${stack.title}`} aria-pressed={stack.autoProgress} disabled={saving||(!stack.autoProgress&&(!access.writesEnabled||!access.backgroundEnabled))} onClick={()=>onCommand({type:'auto',stackId:stack.id,enabled:!stack.autoProgress})}>Automatic progression <strong>{stack.autoProgress?'On':'Off'}</strong></button>}</div>}
    {!access.writesEnabled&&<p className="microcopy">Review plans, holds and dependencies are saved. The operator still needs to enable GitHub review actions.</p>}
    {access.writesEnabled&&!access.backgroundEnabled&&<p className="microcopy">{access.backgroundReason??'Review actions need background GitHub setup for this repository.'}</p>}
    {pr.workflow?.reason&&<div className="notice warning"><AlertCircle size={15}/><span>{pr.workflow.reason}</span></div>}
    {pr.workflow?.targets?.length&&(pr.workflow.pending||pr.workflow.uncertain)?<p className="microcopy">Queued release recipients: {pr.workflow.targets.map(r=>`@${r.login}`).join(', ')}. Editing the plan changes future releases.</p>:null}
    {pr.workflow?.uncertain&&<p className="microcopy">An external result needs reconciliation. Refreshing will check GitHub before any retry.</p>}
    {canEdit&&access.canManage&&enrolled&&access.writesEnabled&&access.backgroundEnabled&&pr.lifecycle==='open'&&!isApproved(pr)&&<>
      {!verifiedPlan&&recipients.length>0&&onVerifyPlan&&<><p className="microcopy">Verify this saved plan’s GitHub identities before requesting review.</p><button className="button subtle full" disabled={saving} onClick={onVerifyPlan}>Verify planned reviewers</button></>}
      {pr.workflow?.pending||pr.workflow?.uncertain?<button className="button subtle full" disabled={saving} onClick={()=>onCommand({type:'reconcile'})}><RefreshCw size={14}/>Reconcile pending review</button>:!pr.requests.length&&<button className="button primary full" disabled={saving||pr.held||!recipients.length||!verifiedPlan} onClick={()=>setPreview(v=>!v)}><Play size={14}/>Preview review request</button>}
      {preview&&<div className="review-preview"><strong>Start review of #{pr.number}</strong><p>{pr.readiness==='draft'?'This makes the PR ready and requests review from ':'Requests review from '}{recipients.map(id=>`@${id}`).join(', ')}. GitHub may also request required code owners when a draft becomes ready.</p>{upstream.length>0&&<><div className="notice warning"><AlertCircle size={15}/><span>{upstream.map(p=>`#${p.number}`).join(', ')} still need approval. Starting early keeps those prerequisites unapproved and records an override.</span></div><label className="coordination-check"><input type="checkbox" checked={early} onChange={e=>setEarly(e.target.checked)}/>Start this review early</label></>}<div className="coordination-input-row"><button className="button subtle" onClick={()=>setPreview(false)}>Cancel</button><button className="button primary" disabled={saving||pr.held||(!early&&upstream.length>0)} onClick={()=>{setPreview(false);onCommand({type:'start',prId:pr.id,early});}}>Start GitHub review</button></div></div>}
    </>}
  </div>;
}
