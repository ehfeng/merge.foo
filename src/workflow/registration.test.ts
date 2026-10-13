import {it,expect,vi} from 'vitest';
import {WorkflowService} from './service';
import type {WorkflowDocument,WorkflowSnapshot,WorkflowStore,WorkflowTransport} from './types';
const snapshot:WorkflowSnapshot={scope:'7:42',repository:'fixture/repo',observedAt:'2026-10-12T12:00:00Z',complete:true,prs:[{id:'p1',number:1,stackId:'feature',author:{id:'1',login:'alice'},lifecycle:'open',readiness:'draft',topologyVerified:true,githubGate:'none',reviewsComplete:true,reviews:[],requests:[],plannedReviewers:[{id:'2',login:'sam'}]}]};
const actor={id:'1',login:'alice',canWrite:true};
function setup(){let saved:WorkflowDocument|null=null;const writes:WorkflowDocument[]=[];const store:WorkflowStore={readWorkflow:async()=>saved?structuredClone(saved):null,compareAndSwapWorkflow:async(_,version,next)=>{if((saved?.version??0)!==version)return false;saved=structuredClone(next);writes.push(saved);return true;}};return {store,writes,service:new WorkflowService(store),read:()=>saved};}
it('requires durable discovery before enabling a feature and safely retries registration failure',async()=>{
  const f=setup();const index=vi.fn().mockRejectedValueOnce(new Error('Registry unavailable')).mockResolvedValue(undefined);
  await expect(f.service.command(snapshot.scope,snapshot,actor,{type:'enroll',stackId:'feature',enabled:true},0,index)).rejects.toThrow('Registry unavailable');expect(f.read()).toBeNull();expect(f.writes).toHaveLength(0);
  const document=await f.service.command(snapshot.scope,snapshot,actor,{type:'enroll',stackId:'feature',enabled:true},0,index);expect(index).toHaveBeenCalledTimes(2);expect(document.config.stacks.feature).toMatchObject({enrolled:true,started:false,autoProgress:false});expect(document.actions).toHaveLength(0);
});
it('rejects invalid authorization and stale versions before creating discovery entries',async()=>{
  const f=setup();const index=vi.fn();await expect(f.service.command(snapshot.scope,snapshot,{id:'9',login:'reader',canWrite:false},{type:'enroll',stackId:'feature',enabled:true},0,index)).rejects.toThrow('repository writer');expect(index).not.toHaveBeenCalled();
  await f.service.command(snapshot.scope,snapshot,actor,{type:'enroll',stackId:'feature',enabled:true},0,index);index.mockClear();await expect(f.service.command(snapshot.scope,snapshot,actor,{type:'auto',stackId:'feature',enabled:true},0,index)).rejects.toMatchObject({status:409});expect(index).not.toHaveBeenCalled();
});
it('a losing workflow CAS may leave discovery metadata but cannot authorize a review',async()=>{
  const f=setup();f.store.compareAndSwapWorkflow=async()=>false;const index=vi.fn();await expect(f.service.command(snapshot.scope,snapshot,actor,{type:'enroll',stackId:'feature',enabled:true},0,index)).rejects.toMatchObject({status:409});expect(index).toHaveBeenCalledOnce();expect(f.read()).toBeNull();
  const transport:WorkflowTransport={enabled:true,observe:vi.fn(async()=>snapshot),authorize:vi.fn(async()=>true),perform:vi.fn(async()=>({state:'applied' as const})),reconcile:vi.fn(async()=>({state:'unknown' as const}))};expect((await f.service.runNext(snapshot.scope,transport,'worker')).executed).toBe(false);expect(transport.perform).not.toHaveBeenCalled();
});
it('rechecks a changed management grant before dispatch without extra GitHub authorization calls',async()=>{
  const f=setup();let document=await f.service.command(snapshot.scope,snapshot,actor,{type:'enroll',stackId:'feature',enabled:true},0);document=await f.service.command(snapshot.scope,snapshot,actor,{type:'start',prId:'p1'},document.version);
  const transport:WorkflowTransport={enabled:true,observe:vi.fn(async()=>snapshot),authorize:vi.fn(async()=>true),reconcile:vi.fn(async()=>({state:'unknown' as const})),perform:vi.fn(async(action,fresh,fence)=>{const current=await f.service.read(snapshot.scope);current.config.stacks.feature.actorId='9';current.config.stacks.feature.actorLogin='new-writer';current.version++;expect(await f.store.compareAndSwapWorkflow(snapshot.scope,current.version-1,current)).toBe(true);expect(await fence?.(fresh,actor)).toBe(false);return {state:'not_applied' as const};})};
  expect((await f.service.runNext(snapshot.scope,transport,'worker')).executed).toBe(false);expect((await f.service.read(snapshot.scope)).actions[0].dispatchStarted).toBe(false);expect(transport.authorize).toHaveBeenCalledOnce();
});
