'use client';
import {useEffect,useId,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent,PointerEvent as ReactPointerEvent} from 'react';
import {AlertCircle,Check,Clock3,GitPullRequest,Pause} from 'lucide-react';
import type {PullRequest,Workspace} from '../domain/types';
import {ancestors,outstanding,stateOf} from '../domain/engine';
import {anchoredZoom,fitMap,mapLayout,mapTopologyKey,mapWorkspaceForAuthor,MAP_NODE_HEIGHT,MAP_NODE_WIDTH,type MapPoint} from '../domain/map-layout';

export type WorkMapProps={workspace:Workspace;selectedId:string|null;query:string;scope:'all'|'attention'|'mine';viewerLogin?:string;onSelect:(id:string|null)=>void;zoom:number;onZoom:(zoom:number)=>void;focusStackId?:string|null;fitRequest:number};
export const MAP_MIN_ZOOM=.15;
// My work must fit even a large set of independent stacks. Keep scaling positive for anchored zoom.
export const MAP_MY_WORK_MIN_ZOOM=Number.EPSILON;
export const MAP_MAX_ZOOM=1.8;
const clampZoom=(value:number,minimum:number)=>Math.max(minimum,Math.min(MAP_MAX_ZOOM,value));
type Gesture={kind:'drag';origin:MapPoint;pan:MapPoint}|{kind:'pinch';distance:number;zoom:number;world:MapPoint};
const center=(a:MapPoint,b:MapPoint)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
const distance=(a:MapPoint,b:MapPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
function waitingAge(at:string){const time=Date.parse(at);if(!Number.isFinite(time))return null;const hours=Math.max(0,Math.floor((Date.now()-time)/3600000));return hours<1?'<1h':hours<24?`${hours}h`:`${Math.floor(hours/24)}d`;}
function StatusMark({state}:{state:string}){const Icon=state==='Approved'||state==='Merged'?Check:state==='Held'?Pause:state==='In review'?Clock3:['Changes requested','Stale review','Review uncertain'].includes(state)?AlertCircle:GitPullRequest;return <Icon size={13} aria-hidden="true"/>;}

export default function WorkMap({workspace,selectedId,query,scope,viewerLogin,onSelect,zoom,onZoom,focusStackId,fitRequest}:WorkMapProps) {
  const surface=useRef<HTMLDivElement>(null);const targets=useRef(new Map<string,HTMLButtonElement>());const instructions=useId();
  const mapWorkspace=scope==='mine'?mapWorkspaceForAuthor(workspace,viewerLogin):workspace;
  const topology=`${scope==='mine'?'mine':'all'}:${mapTopologyKey(mapWorkspace)}`;
  // State updates can replace the workspace without recalculating or fitting its topology.
  const geometry=useMemo(()=>mapLayout(mapWorkspace),[topology]);
  const [size,setSize]=useState({width:0,height:0});const [pan,setPan]=useState<MapPoint>({x:0,y:0});const [dragging,setDragging]=useState(false);
  const panRef=useRef(pan);const zoomRef=useRef(zoom);const sizeRef=useRef(size);const onZoomRef=useRef(onZoom);onZoomRef.current=onZoom;sizeRef.current=size;
  const minimumZoomRef=useRef(MAP_MIN_ZOOM);minimumZoomRef.current=scope==='mine'?MAP_MY_WORK_MIN_ZOOM:MAP_MIN_ZOOM;
  const pointers=useRef(new Map<number,MapPoint>());const gesture=useRef<Gesture|null>(null);const moved=useRef(false);const fittedTopology=useRef('');const previousFitRequest=useRef(fitRequest);
  const moveCamera=(next:MapPoint)=>{panRef.current=next;setPan(next);};
  const applyZoom=(value:number,anchor?:MapPoint)=>{const next=clampZoom(value,minimumZoomRef.current);const viewport=sizeRef.current;moveCamera(anchoredZoom(panRef.current,zoomRef.current,next,anchor??{x:viewport.width/2,y:viewport.height/2}));zoomRef.current=next;onZoomRef.current(next);};
  function initialCamera(){
    const viewport=sizeRef.current;
    if(viewport.width>=600){fit();return;}
    const active=mapWorkspace.prs.find(pr=>pr.lifecycle==='open'&&stateOf(pr)==='In review'&&outstanding(pr).length>0)??mapWorkspace.prs.find(pr=>pr.lifecycle==='open');
    const point=active&&geometry.positions.get(active.id);if(!point){fit();return;}
    const readableZoom=.95;const top=Math.min(148,viewport.height*.22);const bottom=Math.min(132,viewport.height*.22);
    zoomRef.current=readableZoom;moveCamera({x:viewport.width/2-(point.x+MAP_NODE_WIDTH/2)*readableZoom,y:top+(viewport.height-top-bottom)/2-(point.y+MAP_NODE_HEIGHT/2)*readableZoom});onZoomRef.current(readableZoom);
  }
  function revealFocusedPr(prId:string){
    const point=geometry.positions.get(prId);const viewport=sizeRef.current;if(!point||!viewport.width||!viewport.height)return;
    // Overflow clipping prevents the browser from scrolling the canvas when Tab focuses a distant marker.
    // Bring only an offscreen/covered marker into the camera's usable region; leave visible markers stationary.
    const padding=18;const top=Math.min(viewport.width<600?148:166,viewport.height*.25);const bottom=viewport.height-Math.min(132,viewport.height*.25);
    const left=point.x*zoomRef.current+panRef.current.x;const right=left+MAP_NODE_WIDTH*zoomRef.current;
    const nodeTop=point.y*zoomRef.current+panRef.current.y;const nodeBottom=nodeTop+MAP_NODE_HEIGHT*zoomRef.current;
    const dx=left<padding?padding-left:right>viewport.width-padding?viewport.width-padding-right:0;
    const dy=nodeTop<top?top-nodeTop:nodeBottom>bottom?bottom-nodeBottom:0;
    if(dx||dy)moveCamera({x:panRef.current.x+dx,y:panRef.current.y+dy});
  }
  function fit(stackId?:string|null){
    const bounds=stackId?geometry.routes.find(route=>route.stackId===stackId)?.bounds??geometry.bounds:geometry.bounds;const viewport=sizeRef.current;
    const top=scope==='mine'?Math.min(viewport.width<600?148:166,viewport.height*.25):0;
    const bottom=scope==='mine'?Math.min(132,viewport.height*.25):0;
    const next=fitMap(bounds,{width:viewport.width,height:Math.max(1,viewport.height-top-bottom)},1.18,minimumZoomRef.current);
    zoomRef.current=next.zoom;moveCamera({x:next.x,y:next.y+top});onZoomRef.current(next.zoom);
  }

  useEffect(()=>{const element=surface.current;if(!element)return;const measure=()=>{const rect=element.getBoundingClientRect();setSize({width:rect.width,height:rect.height});};measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();},[]);
  useLayoutEffect(()=>{if(zoom!==zoomRef.current){const viewport=sizeRef.current;moveCamera(anchoredZoom(panRef.current,zoomRef.current,zoom,{x:viewport.width/2,y:viewport.height/2}));zoomRef.current=zoom;}},[zoom]);
  useEffect(()=>{if(!size.width||!size.height)return;if(fittedTopology.current!==topology){const wasMine=fittedTopology.current.startsWith('mine:');fittedTopology.current=topology;if(scope==='mine'||wasMine)fit();else initialCamera();}},[topology,size.width,size.height]);
  useEffect(()=>{if(scope==='mine'&&selectedId&&!mapWorkspace.prs.some(pr=>pr.id===selectedId))onSelect(null);},[scope,selectedId,topology,onSelect]);
  useEffect(()=>{if(previousFitRequest.current===fitRequest)return;previousFitRequest.current=fitRequest;if(sizeRef.current.width&&sizeRef.current.height)fit(focusStackId);},[fitRequest,focusStackId]);
  useEffect(()=>{
    const element=surface.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      event.preventDefault();const rect=element.getBoundingClientRect();const mode=event.deltaMode;
      const deltaX=event.deltaX*(mode===1?16:mode===2?rect.width:1);
      const deltaY=event.deltaY*(mode===1?16:mode===2?rect.height:1);
      // Browsers expose trackpad pinches as Ctrl-wheel; ordinary two-finger scrolling pans.
      if(event.ctrlKey||event.metaKey)applyZoom(zoomRef.current*Math.exp(-deltaY*.01),{x:event.clientX-rect.left,y:event.clientY-rect.top});
      else moveCamera({x:panRef.current.x-deltaX,y:panRef.current.y-deltaY});
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[]);

  const related=useMemo(()=>{const current=workspace.prs.find(pr=>pr.id===selectedId);if(!current)return new Set<string>();return new Set([current.id,...ancestors(workspace,current).map(pr=>pr.id),...workspace.prs.filter(pr=>ancestors(workspace,pr).some(parent=>parent.id===current.id)).map(pr=>pr.id)]);},[workspace,selectedId]);
  const text=query.trim().toLowerCase();
  function matches(pr:PullRequest){const state=stateOf(pr);const stack=workspace.stacks.find(stack=>stack.id===pr.stackId);return (!text||`${pr.number} ${pr.title} ${pr.author} ${pr.repository} ${pr.branch} ${stack?.title??''} ${stack?.description??''}`.toLowerCase().includes(text))&&(scope!=='mine'||pr.author.toLowerCase()===viewerLogin?.toLowerCase())&&(scope!=='attention'||['Held','Changes requested','Stale review','Review uncertain','Release pending'].includes(state));}
  const visible=new Set(mapWorkspace.prs.filter(matches).map(pr=>pr.id));
  const prById=new Map(workspace.prs.map(pr=>[pr.id,pr]));

  function position(event:ReactPointerEvent<HTMLDivElement>):MapPoint {const rect=surface.current!.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top};}
  function beginGesture(){const values=[...pointers.current.values()];if(values.length>=2){const middle=center(values[0],values[1]);gesture.current={kind:'pinch',distance:Math.max(1,distance(values[0],values[1])),zoom:zoomRef.current,world:{x:(middle.x-panRef.current.x)/zoomRef.current,y:(middle.y-panRef.current.y)/zoomRef.current}};}else if(values[0])gesture.current={kind:'drag',origin:values[0],pan:panRef.current};else gesture.current=null;}
  function pointerDown(event:ReactPointerEvent<HTMLDivElement>){if(event.button>1||(event.target as HTMLElement).closest('button,a,input,select'))return;event.preventDefault();surface.current?.focus({preventScroll:true});surface.current?.setPointerCapture(event.pointerId);pointers.current.set(event.pointerId,position(event));if(pointers.current.size===1)moved.current=false;beginGesture();setDragging(true);}
  function pointerMove(event:ReactPointerEvent<HTMLDivElement>){if(!pointers.current.has(event.pointerId)||!gesture.current)return;pointers.current.set(event.pointerId,position(event));const active=gesture.current;if(active.kind==='drag'){const current=[...pointers.current.values()][0];const dx=current.x-active.origin.x,dy=current.y-active.origin.y;if(Math.hypot(dx,dy)>4)moved.current=true;moveCamera({x:active.pan.x+dx,y:active.pan.y+dy});}else{const values=[...pointers.current.values()];if(values.length<2)return;const middle=center(values[0],values[1]);const next=clampZoom(active.zoom*distance(values[0],values[1])/active.distance,minimumZoomRef.current);moved.current=true;zoomRef.current=next;moveCamera({x:middle.x-active.world.x*next,y:middle.y-active.world.y*next});onZoomRef.current(next);}}
  function pointerUp(event:ReactPointerEvent<HTMLDivElement>){pointers.current.delete(event.pointerId);if(surface.current?.hasPointerCapture(event.pointerId))surface.current.releasePointerCapture(event.pointerId);beginGesture();setDragging(pointers.current.size>0);}
  function keyboard(event:KeyboardEvent<HTMLDivElement>){if(event.ctrlKey||event.metaKey||event.altKey)return;if((event.target as HTMLElement).closest('input,select,textarea'))return;const step=event.shiftKey?180:64;if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();moveCamera({x:panRef.current.x+(event.key==='ArrowLeft'?step:event.key==='ArrowRight'?-step:0),y:panRef.current.y+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0)});}else if(event.key==='+'||event.key==='='){event.preventDefault();applyZoom(zoomRef.current*1.15);}else if(event.key==='-'){event.preventDefault();applyZoom(zoomRef.current/1.15);}else if(event.key==='0'||event.key==='Home'){event.preventDefault();fit();}else if(event.key.toLowerCase()==='f'){event.preventDefault();fit(prById.get(selectedId??'')?.stackId??focusStackId);}else if(event.key==='Escape'){event.preventDefault();onSelect(null);}else if(event.key==='Enter'&&event.target===surface.current&&selectedId){event.preventDefault();targets.current.get(selectedId)?.focus({preventScroll:true});}}

  return <div ref={surface} className={`map-surface ${dragging?'dragging':''}`} role="region" aria-label="Pull request map" aria-describedby={instructions} tabIndex={0} data-zoom={zoom.toFixed(3)} style={{position:'relative',width:'100%',height:'100%',overflow:'clip',touchAction:'none'}} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onKeyDown={keyboard} onClick={event=>{if((event.target as HTMLElement).closest('button,a,input,select'))return;if(!moved.current)onSelect(null);moved.current=false;}}>
    <p id={instructions} className="map-instructions">Drag or two-finger scroll to pan. Pinch or Ctrl/Cmd-scroll to zoom. Arrow keys pan, plus and minus zoom, Home fits all PRs, F fits the selected feature, Escape clears selection. Tab selects a PR control.</p>
    <div className="map-world" style={{position:'absolute',left:0,top:0,width:geometry.bounds.x+geometry.bounds.width+80,height:geometry.bounds.y+geometry.bounds.height+80,transform:`translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,transformOrigin:'0 0',willChange:'transform'}}>
      <svg className="map-routes" width={geometry.bounds.x+geometry.bounds.width+80} height={geometry.bounds.y+geometry.bounds.height+80} aria-hidden="true" style={{position:'absolute',inset:0,overflow:'visible',pointerEvents:'none'}}>
        <defs><marker id={`map-arrow-${instructions.replaceAll(':','')}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L6 4L1 7" fill="none" stroke="currentColor" strokeWidth="1.3"/></marker></defs>
        {mapWorkspace.prs.filter(pr=>pr.parentId&&geometry.positions.has(pr.parentId)&&geometry.positions.has(pr.id)).map(pr=>{const from=geometry.positions.get(pr.parentId!)!;const to=geometry.positions.get(pr.id)!;const start={x:from.x+MAP_NODE_WIDTH+8,y:from.y+MAP_NODE_HEIGHT/2};const end={x:to.x-14,y:to.y+MAP_NODE_HEIGHT/2};const bend=Math.max(26,(end.x-start.x)*.48);return <path key={pr.id} className={`map-route ${selectedId&&related.has(pr.id)&&related.has(pr.parentId!)?'selected':''} ${(!visible.has(pr.id)&&!visible.has(pr.parentId!))?'dimmed':''}`} d={`M${start.x},${start.y} C${start.x+bend},${start.y} ${end.x-bend},${end.y} ${end.x},${end.y}`} fill="none" markerEnd={`url(#map-arrow-${instructions.replaceAll(':','')})`}/>;})}
      </svg>
      {geometry.routes.map(route=>{const stack=workspace.stacks.find(s=>s.id===route.stackId);return <div key={route.stackId} className={`map-route-label ${route.nodeIds.some(id=>visible.has(id))?'':'dimmed'} ${selectedId&&prById.get(selectedId)?.stackId===route.stackId?'selected':''}`} style={{position:'absolute',left:route.label.x,top:route.label.y,pointerEvents:'none'}}><span className="map-route-label-dot"/><strong>{stack?.title??'Related pull requests'}</strong><small>{route.nodeIds.length} PR{route.nodeIds.length===1?'':'s'}</small></div>;})}
      {mapWorkspace.prs.map(pr=>{const point=geometry.positions.get(pr.id)!;const state=stateOf(pr);const requests=outstanding(pr);const reviewerId=requests[0]?.reviewerId??pr.plannedReviewerIds[0];const reviewer=workspace.reviewers.find(person=>person.id===reviewerId);const age=requests[0]?waitingAge(requests[0].requestedAt):null;return <article key={pr.id} data-testid={`pr-${pr.number}`} data-pr-id={pr.id} className={`map-pr state-${state.toLowerCase().replaceAll(' ','-')} ${selectedId===pr.id?'selected':''} ${related.has(pr.id)&&selectedId!==pr.id?'related':''} ${!visible.has(pr.id)?'dimmed':''}`} style={{position:'absolute',left:point.x,top:point.y,width:MAP_NODE_WIDTH,height:MAP_NODE_HEIGHT}}>
        <button ref={element=>{if(element)targets.current.set(pr.id,element);else targets.current.delete(pr.id);}} className="map-pr-target node-title" aria-label={`${pr.title} · #${pr.number} · ${state}`} aria-pressed={selectedId===pr.id} onFocus={event=>{if(event.currentTarget.matches(':focus-visible'))revealFocusedPr(pr.id);}} onClick={()=>onSelect(pr.id)} title={`${pr.title}\n#${pr.number} · ${state} · ${pr.author}`}>
          <span className="map-pr-dot"><StatusMark state={state}/></span><span className="map-pr-number">#{pr.number}</span><span className="map-pr-title">{pr.title}</span>
          <span className="map-pr-meta"><span className="map-pr-state">{state}</span>{age&&<span className="map-pr-wait"><Clock3 size={10}/>{age}</span>}{reviewerId&&<span className="map-pr-reviewer" title={`${requests.length?'Requested':'Planned'}: ${reviewer?.name??reviewerId}`}>{reviewer?.initials??reviewerId.slice(0,2).toUpperCase()}</span>}</span>
        </button>
      </article>;})}
    </div>
    {!mapWorkspace.prs.length&&<div className="map-empty"><GitPullRequest size={28}/><h2>{scope==='mine'?'No pull requests of your own':'No open pull requests'}</h2><p>{scope==='mine'?`Pull requests authored by ${viewerLogin?`@${viewerLogin}`:'you'} will appear here.`:'Your repository’s PR network will appear here.'}</p></div>}
  </div>;
}
