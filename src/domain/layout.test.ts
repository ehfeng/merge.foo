import {describe,it,expect} from 'vitest';
import {createFixture} from './fixtures';
import {layout} from './layout';
import {applyCommand} from './engine';
describe('stable dependency geometry',()=>{
  it('retains identical positions after decisions, plans and holds',()=>{const w=createFixture();const before=layout(w);const after=layout(applyCommand(w,{type:'hold',prId:'pr-143',held:false}));expect(after.map(s=>s.positions)).toEqual(before.map(s=>s.positions));});
  it('puts siblings at the same depth in separate lanes',()=>{const w=createFixture();w.prs.find(p=>p.number===144)!.parentId='pr-142';const graph=layout(w)[0];expect(graph.positions.get('pr-143')!.x).toBe(graph.positions.get('pr-144')!.x);expect(graph.positions.get('pr-143')!.y).not.toBe(graph.positions.get('pr-144')!.y);expect(graph.height).toBeGreaterThan(246);});
  it('keeps all independent chains in their own row',()=>{const graph=layout(createFixture());expect(graph.map(s=>s.top)).toEqual([0,246,492]);expect(graph[0].positions.get('pr-145')).toEqual({x:858,y:0});});
});
