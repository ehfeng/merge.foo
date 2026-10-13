import {describe,expect,it} from 'vitest';
import {createFixture} from './fixtures';
import {anchoredZoom,boundsForNodes,fitMap,mapLayout,mapTopologyKey,MAP_NODE_HEIGHT,MAP_NODE_WIDTH} from './map-layout';

describe('continuous work map geometry',()=>{
  it('aligns linear chains on rows and equivalent depths on shared columns',()=>{
    const workspace=createFixture();const map=mapLayout(workspace);const columns=new Map<number,number>();
    for(const route of map.routes){
      const prs=workspace.prs.filter(pr=>pr.stackId===route.stackId);const root=prs.find(pr=>!pr.parentId)!;const rootPoint=map.positions.get(root.id)!;
      for(const pr of prs){
        let depth=0;let current=pr;while(current.parentId){current=prs.find(parent=>parent.id===current.parentId)!;depth++;}
        const point=map.positions.get(pr.id)!;expect(point.y).toBe(rootPoint.y);
        if(columns.has(depth))expect(point.x).toBe(columns.get(depth));else columns.set(depth,point.x);
      }
      expect(route.label.x).toBe(rootPoint.x);
    }
  });
  it('preserves positions and topology identity through reviews, plans, holds and API ordering',()=>{
    const original=createFixture();const first=mapLayout(original);const changed=structuredClone(original);
    changed.prs.reverse();changed.prs.forEach(pr=>{pr.held=!pr.held;pr.readiness='ready';pr.plannedReviewerIds=['another-person'];pr.reviews.push({reviewerId:'someone',decision:'approved',at:'2026-10-12T10:00:00Z',contentVersion:1});});
    expect(mapTopologyKey(changed)).toBe(mapTopologyKey(original));expect([...mapLayout(changed).positions]).toEqual([...first.positions]);
  });
  it('places dependencies from left to right and branching siblings on separate lanes without overlap',()=>{
    const workspace=createFixture();const branch=structuredClone(workspace.prs.find(pr=>pr.number===145)!);branch.id='branch';branch.number=999;branch.parentId='pr-143';workspace.prs.push(branch);
    const map=mapLayout(workspace);expect(map.positions.get('branch')!.y-map.positions.get('pr-144')!.y).toBeGreaterThan(MAP_NODE_HEIGHT);
    for(const pr of workspace.prs){expect(map.positions.has(pr.id)).toBe(true);if(pr.parentId)expect(map.positions.get(pr.id)!.x-map.positions.get(pr.parentId)!.x).toBeGreaterThan(MAP_NODE_WIDTH);}
    const entries=[...map.positions.values()];for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){const a=entries[i],b=entries[j];expect(Math.abs(a.x-b.x)>=MAP_NODE_WIDTH||Math.abs(a.y-b.y)>=MAP_NODE_HEIGHT).toBe(true);}
  });
  it('covers missing parents and defensive cycles without losing a PR',()=>{
    const workspace=createFixture();workspace.prs[0].parentId='pr-144';workspace.prs[5].parentId='missing-parent';const map=mapLayout(workspace);expect(map.positions.size).toBe(workspace.prs.length);expect([...map.positions.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).toBe(true);
  });
  it('fits graph and feature bounds inside viewport padding',()=>{
    const map=mapLayout(createFixture());const viewport={width:1200,height:780};
    for(const bounds of [map.bounds,boundsForNodes(map.positions,map.routes[0].nodeIds)]){const camera=fitMap(bounds,viewport);expect(bounds.x*camera.zoom+camera.x).toBeGreaterThanOrEqual(59);expect(bounds.y*camera.zoom+camera.y).toBeGreaterThanOrEqual(59);expect((bounds.x+bounds.width)*camera.zoom+camera.x).toBeLessThanOrEqual(viewport.width-59);expect((bounds.y+bounds.height)*camera.zoom+camera.y).toBeLessThanOrEqual(viewport.height-59);}
  });
  it('keeps the exact map coordinate beneath a zoom anchor',()=>{
    const before={x:-120,y:70};const anchor={x:430,y:290};const from=.8,to=1.35;const after=anchoredZoom(before,from,to,anchor);
    expect((anchor.x-after.x)/to).toBeCloseTo((anchor.x-before.x)/from,10);expect((anchor.y-after.y)/to).toBeCloseTo((anchor.y-before.y)/from,10);
  });
  it('returns finite bounds for an empty repository',()=>{const workspace=createFixture();workspace.prs=[];const map=mapLayout(workspace);expect(map.positions.size).toBe(0);expect(map.routes).toHaveLength(0);expect(fitMap(map.bounds,{width:800,height:600}).zoom).toBeGreaterThan(0);});
});
