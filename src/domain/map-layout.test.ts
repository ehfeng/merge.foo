import {describe,expect,it} from 'vitest';
import {createFixture} from './fixtures';
import {anchoredZoom,boundsForNodes,fitMap,mapLayout,mapTopologyKey,mapWorkspaceForAuthor,MAP_NODE_HEIGHT,MAP_NODE_WIDTH} from './map-layout';

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
  it('compacts my work without inventing dependencies through another author’s PR',()=>{
    const workspace=createFixture();workspace.prs.forEach(pr=>pr.author='someone-else');
    for(const number of [142,144,145])workspace.prs.find(pr=>pr.number===number)!.author=number===144?'ALICE':'Alice';
    const originalParents=workspace.prs.map(pr=>pr.parentId);const mine=mapWorkspaceForAuthor(workspace,'alice');const map=mapLayout(mine);
    expect(mine.prs.map(pr=>pr.number)).toEqual([142,144,145]);
    expect(map.routes).toHaveLength(1);expect(map.routes[0].nodeIds).toEqual(['pr-142','pr-144','pr-145']);
    expect(map.positions.has('pr-143')).toBe(false);
    expect(mine.prs.find(pr=>pr.id==='pr-144')!.parentId).toBe('pr-143');
    expect(map.positions.get('pr-144')!.x).toBe(map.positions.get('pr-142')!.x);
    expect(map.positions.get('pr-145')!.x-map.positions.get('pr-144')!.x).toBeGreaterThan(MAP_NODE_WIDTH);
    expect(map.bounds.width).toBeLessThan(mapLayout(workspace).bounds.width);
    expect(map.bounds.height).toBeLessThan(mapLayout(workspace).bounds.height);
    expect(workspace.prs.map(pr=>pr.parentId)).toEqual(originalParents);
  });
  it('preserves my work geometry through review updates and returns finite cameras when none is owned',()=>{
    const workspace=createFixture();workspace.prs.forEach(pr=>pr.author=pr.number===145?'viewer':'other');
    const mine=mapWorkspaceForAuthor(workspace,'viewer');const first=mapLayout(mine);workspace.prs[3].held=true;workspace.prs[3].title='A new title';workspace.prs[3].plannedReviewerIds=['new-reviewer'];
    expect(mapTopologyKey(mapWorkspaceForAuthor(workspace,'viewer'))).toBe(mapTopologyKey(mine));
    expect([...mapLayout(mapWorkspaceForAuthor(workspace,'viewer')).positions]).toEqual([...first.positions]);
    for(const login of ['no-matches',undefined]){const empty=mapLayout(mapWorkspaceForAuthor(workspace,login));expect(empty.positions.size).toBe(0);expect(empty.routes).toHaveLength(0);expect(Object.values(fitMap(empty.bounds,{width:390,height:640})).every(Number.isFinite)).toBe(true);}
  });
  it('fits every owned node across many independent stacks without changing the default zoom floor',()=>{
    const workspace=createFixture();const seed=workspace.prs[0];workspace.prs=Array.from({length:50},(_,index)=>({...structuredClone(seed),id:`own-${index}`,number:1000+index,stackId:`stack-${index}`,author:'viewer'}));
    const map=mapLayout(mapWorkspaceForAuthor(workspace,'viewer'));
    for(const viewport of [{width:1200,height:780},{width:390,height:640}]){
      expect(fitMap(map.bounds,viewport).zoom).toBe(.15);
      const top=Math.min(viewport.width<600?148:166,viewport.height*.25);const bottom=Math.min(132,viewport.height*.25);
      const usable={width:viewport.width,height:viewport.height-top-bottom};const camera=fitMap(map.bounds,usable,1.18,Number.EPSILON);expect(camera.zoom).toBeGreaterThan(0);expect(camera.zoom).toBeLessThan(.15);
      for(const point of map.positions.values()){
        expect(point.x*camera.zoom+camera.x).toBeGreaterThanOrEqual(59);
        expect(point.y*camera.zoom+camera.y+top).toBeGreaterThanOrEqual(top+59);
        expect((point.x+MAP_NODE_WIDTH)*camera.zoom+camera.x).toBeLessThanOrEqual(viewport.width-59);
        expect((point.y+MAP_NODE_HEIGHT)*camera.zoom+camera.y+top).toBeLessThanOrEqual(viewport.height-bottom-59);
      }
    }
  });
});
