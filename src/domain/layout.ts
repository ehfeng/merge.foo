import type {Workspace,PullRequest} from './types';
/** Geometry depends on topology only. Review events and selection never move a node. */
export function layout(workspace:Workspace) {
  let top=0;
  return workspace.stacks.map(stack=>{
    const prs=workspace.prs.filter(p=>p.stackId===stack.id);
    const positions=new Map<string,{x:number;y:number}>();
    let lane=0;let depthMax=0;
    function visit(pr:PullRequest,depth:number) {
      if(positions.has(pr.id))return;
      const firstLane=lane;positions.set(pr.id,{x:depth*286,y:firstLane*211});depthMax=Math.max(depthMax,depth);
      const children=prs.filter(p=>p.parentId===pr.id).sort((a,b)=>a.number-b.number);
      if(!children.length)lane++;
      for(const child of children)visit(child,depth+1);
    }
    for(const root of prs.filter(p=>!p.parentId||!prs.some(q=>q.id===p.parentId)).sort((a,b)=>a.number-b.number))visit(root,0);
    for(const pr of prs)if(!positions.has(pr.id))visit(pr,0);
    const height=Math.max(1,lane)*211+35;
    const result={stack,prs,positions,top,width:Math.max(1110,depthMax*286+232),height};top+=height;
    return result;
  });
}
