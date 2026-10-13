import { Circle,CheckCircle2,Clock3,Pause,AlertCircle,GitPullRequest,Shield,Layers,Play,Check } from 'lucide-react';
import type { Command,PullRequest,Workspace } from '../domain/types';
import {attention,blockers,stateOf} from '../domain/engine';
import ReviewerPicker from './ReviewerPicker';

export function StateIcon({state,size=14}:{state:string;size?:number}) {
  const Icon=state==='Approved'||state==='Merged'?CheckCircle2:state==='In review'?Clock3:state==='Held'?Pause:state==='Queued'?Circle:AlertCircle;
  return <Icon size={size}/>;
}
export function waitLabel(at:string) {
  if(!at)return 'Age unknown'; const hours=Math.max(0,Math.floor((Date.now()-new Date(at).getTime())/3600000));return hours<1?'<1h':hours<24?`${hours}h`:`${Math.floor(hours/24)}d ${hours%24}h`;
}
export default function PrNode({workspace,pr,selected,related,dimmed,dispatch,onSelect,readOnly,planSaving=false}:{workspace:Workspace;pr:PullRequest;selected:boolean;related:boolean;dimmed:boolean;dispatch:(c:Command)=>void;onSelect:()=>void;readOnly:boolean;planSaving?:boolean}) {
  const state=stateOf(pr);const paused=attention(workspace,pr);const reasons=blockers(workspace,pr);
  const canStart=!readOnly&&!pr.requests.length&&pr.lifecycle==='open'&&!pr.held;
  const active=state==='In review';
  const effective=pr.lines.added+pr.lines.deleted-pr.lines.discounted;
  return <article className={`pr-node ${selected?'selected':''} ${related?'related':''} ${dimmed?'dimmed':''} ${paused?'needs-attention':''}`} data-testid={`pr-${pr.number}`} aria-label={`Pull request #${pr.number}: ${pr.title}`}>
    <div className="node-top"><button className="pr-number" onClick={onSelect}><GitPullRequest size={13}/><span>#{pr.number}</span></button><span className={`state-badge state-${state.toLowerCase().replaceAll(' ','-')}`}><StateIcon state={state}/>{state}</span></div>
    <button className="node-title" onClick={onSelect}>{pr.title}</button>
    <div className="node-signals"><span title={`${effective} effective lines; ${pr.lines.added+pr.lines.deleted} raw lines`}><Layers size={12}/>{effective} <small>{readOnly?'LOC':'eff. LOC'}</small></span><span title={`${pr.risk} risk: ${pr.riskReason}`}><Shield size={12}/>{pr.risk==='Unknown'?'Unassessed':`${pr.risk} risk`}</span></div>
    <ReviewerPicker workspace={workspace} pr={pr} readOnly={readOnly} saving={planSaving} onChange={ids=>dispatch({type:'plan',prId:pr.id,reviewerIds:ids})}/>
    <div className="node-bottom">
      {readOnly?<span className="read-label">{pr.readiness==='draft'?'Draft':'Ready'} · GitHub snapshot</span>:<div className="intent-controls"><button className={`mini-button ${pr.readiness==='ready'?'ready':''}`} aria-label={`Mark #${pr.number} ${pr.readiness==='ready'?'draft':'ready'}`} onClick={()=>dispatch({type:'ready',prId:pr.id,readiness:pr.readiness==='ready'?'draft':'ready'})}>{pr.readiness==='ready'?<Check size={11}/>:<Circle size={11}/>} {pr.readiness==='ready'?'Ready':'Draft'}</button><button className={`mini-button ${pr.held?'held':''}`} aria-label={`${pr.held?'Remove':'Add'} hold on #${pr.number}`} onClick={()=>dispatch({type:'hold',prId:pr.id,held:!pr.held})}><Pause size={11}/>{pr.held?'Held':'Hold'}</button></div>}
      {active?<span className="wait-time"><Clock3 size={11}/>{waitLabel(pr.requests[0]?.requestedAt??'')}</span>:canStart?<button className="start-inline" disabled={reasons.length>0} title={reasons.join(' · ')||'Activates mock requests only'} onClick={()=>dispatch({type:'start',prId:pr.id})}><Play size={10}/>{pr.parentId?'Release':'Start review'}</button>:state==='Changes requested'?<span className="author-wait">Author’s turn</span>:state==='Approved'?<span className="approved-note">Unmerged</span>:null}
    </div>
    {paused&&<button className="node-warning" onClick={onSelect}><AlertCircle size={11}/>Prerequisite needs attention</button>}
    {!pr.plannedReviewerIds.length&&!pr.requests.length&&!readOnly&&<span className="node-flag">Reviewer needed</span>}
  </article>;
}
