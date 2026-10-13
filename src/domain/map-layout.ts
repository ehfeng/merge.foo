import type {PullRequest, Workspace} from './types';

export const MAP_NODE_WIDTH = 196;
export const MAP_NODE_HEIGHT = 72;
const STEP_X = 274;
const STEP_Y = 136;
export type MapPoint = {x: number; y: number};
export type MapBounds = {x: number; y: number; width: number; height: number};
export type MapRoute = {stackId: string; label: MapPoint; bounds: MapBounds; nodeIds: string[]};
export type MapGeometry = {positions: Map<string, MapPoint>; routes: MapRoute[]; bounds: MapBounds};

/** Only identities and dependency topology place nodes. Review state and filters never move them. */
export function mapTopologyKey(workspace: Workspace): string {
  return [...new Set(workspace.prs.map(pr=>pr.repository))].sort().join('|') + ':' +
    workspace.prs.map(pr=>`${pr.id}:${pr.parentId??''}:${pr.stackId}`).sort().join('|');
}
export function boundsForNodes(positions: Map<string, MapPoint>, ids: string[]): MapBounds {
  const points=ids.map(id=>positions.get(id)).filter((point):point is MapPoint=>!!point);
  if(!points.length)return {x:0,y:0,width:MAP_NODE_WIDTH,height:MAP_NODE_HEIGHT};
  const x=Math.min(...points.map(p=>p.x));const y=Math.min(...points.map(p=>p.y));
  return {x,y,width:Math.max(...points.map(p=>p.x))+MAP_NODE_WIDTH-x,height:Math.max(...points.map(p=>p.y))+MAP_NODE_HEIGHT-y};
}
export function mapLayout(workspace: Workspace): MapGeometry {
  const positions=new Map<string,MapPoint>();const routes:MapRoute[]=[];
  const groups=new Map<string,PullRequest[]>();
  for(const pr of workspace.prs){const group=groups.get(pr.stackId)??[];group.push(pr);groups.set(pr.stackId,group);}
  let bandY=116;
  // Stable PR number ordering also handles snapshots returned in a different API page order.
  const ordered=[...groups.entries()].sort((a,b)=>Math.min(...a[1].map(p=>p.number))-Math.min(...b[1].map(p=>p.number))||a[0].localeCompare(b[0]));
  for(const [stackId,prs] of ordered) {
    const ids=new Set(prs.map(pr=>pr.id));const children=new Map<string,PullRequest[]>();
    for(const pr of prs)if(pr.parentId&&ids.has(pr.parentId)){const list=children.get(pr.parentId)??[];list.push(pr);children.set(pr.parentId,list);}
    for(const list of children.values())list.sort((a,b)=>a.number-b.number||a.id.localeCompare(b.id));
    const originX=110;const local=new Map<string,MapPoint>();let lane=0;
    function visit(pr:PullRequest,depth:number) {
      if(local.has(pr.id))return;
      const currentLane=lane;
      local.set(pr.id,{x:originX+depth*STEP_X,y:bandY+currentLane*STEP_Y});
      const descendants=(children.get(pr.id)??[]).filter(child=>!local.has(child.id));
      if(!descendants.length)lane++;
      for(const child of descendants)visit(child,depth+1);
    }
    const roots=prs.filter(pr=>!pr.parentId||!ids.has(pr.parentId)).sort((a,b)=>a.number-b.number||a.id.localeCompare(b.id));
    for(const root of roots)visit(root,0);
    // Defensive cycle coverage keeps every PR inspectable without an infinite traversal.
    for(const pr of [...prs].sort((a,b)=>a.number-b.number||a.id.localeCompare(b.id)))if(!local.has(pr.id))visit(pr,0);
    for(const [id,point] of local)positions.set(id,point);
    const bounds=boundsForNodes(local,prs.map(p=>p.id));
    routes.push({stackId,label:{x:originX,y:bounds.y-48},bounds,nodeIds:prs.map(p=>p.id)});
    bandY=bounds.y+bounds.height+164;
  }
  const nodes=boundsForNodes(positions,[...positions.keys()]);
  return {positions,routes,bounds:{x:nodes.x-28,y:nodes.y-72,width:nodes.width+56,height:nodes.height+104}};
}

export function fitMap(bounds: MapBounds, viewport: {width:number;height:number}, maxZoom=1.18) {
  const padding=60;
  const zoom=Math.max(.15,Math.min(maxZoom,Math.max(1,viewport.width-padding*2)/Math.max(1,bounds.width),Math.max(1,viewport.height-padding*2)/Math.max(1,bounds.height)));
  return {zoom,x:viewport.width/2-(bounds.x+bounds.width/2)*zoom,y:viewport.height/2-(bounds.y+bounds.height/2)*zoom};
}
/** Keep the same graph coordinate beneath a screen anchor while scaling. */
export function anchoredZoom(pan:MapPoint,previousZoom:number,nextZoom:number,anchor:MapPoint):MapPoint {
  const scale=nextZoom/previousZoom;
  return {x:anchor.x-(anchor.x-pan.x)*scale,y:anchor.y-(anchor.y-pan.y)*scale};
}
