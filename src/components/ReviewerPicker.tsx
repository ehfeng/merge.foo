import { useEffect,useRef,useState } from 'react';
import { Check,ChevronDown,UserPlus,X } from 'lucide-react';
import type { PullRequest,Workspace } from '../domain/types';
import { reviewerLoad } from '../domain/engine';
export function Avatar({name,color,size=24}:{name:string;color:string;size?:number}) {return <span className="avatar" style={{background:color,width:size,height:size}}>{name}</span>;}
export default function ReviewerPicker({workspace,pr,onChange,readOnly=false,saving=false}:{workspace:Workspace;pr:PullRequest;onChange:(ids:string[])=>void;readOnly?:boolean;saving?:boolean}) {
  const [open,setOpen]=useState(false);const [login,setLogin]=useState('');const ref=useRef<HTMLDivElement>(null);
  const editable=!readOnly||pr.canEditPlan;
  useEffect(()=>{if(!open)return;const close=(event:MouseEvent)=>{if(!ref.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.stopPropagation();setOpen(false);ref.current?.querySelector('button')?.focus();}};document.addEventListener('mousedown',close);document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',escape,true);};},[open]);
  const ids=pr.plannedReviewerIds;const requested=pr.requests.map(r=>r.reviewerId);
  const suggested=pr.suggestedReviewers??[];
  const candidates=[...new Set([...suggested.map(s=>s.reviewerId),...ids,...workspace.reviewers.map(r=>r.id)])].filter(id=>!readOnly||id.toLowerCase()!==pr.author.toLowerCase());
  return <div className="reviewer-control" ref={ref} onClick={e=>e.stopPropagation()}>
    <button className={`reviewer-button ${!ids.length?'unassigned':''}`} aria-label={`Reviewers for #${pr.number}`} aria-expanded={open} onClick={()=>setOpen(!open)}>
      <span className="avatar-group">{ids.length?ids.slice(0,2).map(id=>{const r=workspace.reviewers.find(r=>r.id===id);return <Avatar key={id} name={r?.initials??id.slice(0,2).toUpperCase()} color={r?.color??'#8674bd'} size={21}/>;}):<UserPlus size={15}/>}</span>
      <span><small>Planned</small> {ids.length?ids.map(id=>workspace.reviewers.find(r=>r.id===id)?.name.split(' ')[0]??id).join(', '):'Choose reviewer'}</span><ChevronDown size={12}/>
    </button>
    {requested.length>0&&<small className="requested-context">Requested in GitHub: {requested.join(', ')}</small>}
    {open&&<div className="reviewer-popover" role="dialog" aria-label={`Reviewer plan for #${pr.number}`}>
      <div className="popover-heading"><strong>Planned assignments</strong><button className="icon-button" aria-label="Close reviewer picker" onClick={()=>setOpen(false)}><X size={14}/></button></div>
      <p>{readOnly?'Shared repository plan. No GitHub review requests or notifications.':'Lab plan. No requests until review starts.'}</p>
      {readOnly&&<p>{suggested.length?'GitHub suggestions appear first, in GitHub’s returned order.':'GitHub returned no suggested reviewers. Choose an explicit repository collaborator.'}</p>}
      {!editable&&<p>Only the PR author or a repository writer can edit this open PR’s plan.</p>}
      {saving&&<p role="status">Saving planned assignment…</p>}
      {candidates.map(id=>{const reviewer=workspace.reviewers.find(r=>r.id===id);if(!reviewer)return null;const load=reviewerLoad(workspace,id);const checked=ids.includes(id);const suggestion=suggested.find(s=>s.reviewerId===id);const savedIdentity=pr.plannedReviewerIdentities?.find(r=>r.login===id);return <button key={id} className="reviewer-option" role="checkbox" aria-checked={checked} disabled={!editable||saving} onClick={()=>onChange(checked?ids.filter(i=>i!==id):[...ids,id])}>
        <Avatar name={reviewer.initials} color={reviewer.color} size={29}/><span><strong>{reviewer.name}</strong>{savedIdentity&&<small>Saved GitHub account #{savedIdentity.id} · login at assignment</small>}<small>{suggestion?`GitHub suggestion${suggestion.isAuthor?' · past commits':''}${suggestion.isCommenter?' · review comments':''}`:readOnly?'Observed review participant or saved assignment':'Lab reviewer'}</small><small>{load.active} active · {load.planned} upcoming · repository coverage only</small></span><span className={`checkbox ${checked?'checked':''}`}>{checked&&<Check size={11}/>}</span>
      </button>;})}
      {readOnly&&editable&&<form className="explicit-reviewer" onSubmit={e=>{e.preventDefault();const id=login.trim().replace(/^@/,'');if(id&&!ids.some(i=>i.toLowerCase()===id.toLowerCase())){onChange([...ids,id]);setLogin('');}}}><label>GitHub username<input aria-label={`Explicit reviewer for #${pr.number}`} value={login} onChange={e=>setLogin(e.target.value)} disabled={saving} placeholder="username"/></label><button className="text-button" disabled={saving||!login.trim()}>Add to plan</button></form>}
      {editable&&<button className="text-button" disabled={saving||!ids.length} onClick={()=>onChange([])}>Clear plan</button>}
      <div className="popover-foot">Assignments do not change active GitHub requests. Eligibility is checked when saving; observed workload is partial.</div>
    </div>}
  </div>;
}
