import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {DurableObjectStateStore} from './durable-object';
import {PlannedAssignments} from '../plan-object';
import {workflowStore} from './workflow';
import type {WorkflowDocument} from '../../workflow/types';
function fixture(){
  const db=new DatabaseSync(':memory:');
  const object=new PlannedAssignments({storage:{sql:{exec<T>(query:string,...values:(string|number|null)[]){const statement=db.prepare(query);if(/^SELECT/i.test(query))return {toArray:()=>statement.all(...values) as T[]};statement.run(...values);return {toArray:()=>[] as T[]};}},transactionSync<T>(fn:()=>T){db.exec('BEGIN');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}}}});
  const store=new DurableObjectStateStore({idFromName:name=>name,get:()=>object});return {db,object,store};
}
describe('provider-neutral durable state',()=>{
  it('retains legacy planned assignments while serving neutral typed reads',async()=>{
    const {db,object,store}=fixture();try{
      const plan={prId:'P1',version:0,reviewerIds:['sam'],actor:'alice',actorId:'1',updatedAt:'2026-10-12T12:00:00Z'};
      await object.fetch(new Request('https://plans.internal/',{method:'PUT',body:JSON.stringify(plan)}));
      const result=await store.list<typeof plan>('9:4','plan');expect(result.records[0].version).toBe(1);expect(result.records[0].value.reviewerIds).toEqual(['sam']);expect(result.history).toHaveLength(1);
    }finally{db.close();}
  });
  it('atomically fences workflow claims, audit history and delivery replay',async()=>{
    const {db,store}=fixture();try{
      const actor={id:'1',login:'alice'};
      expect(await store.compareAndSwap('9:4','workflow','repository',0,{generation:1,status:'pending'},actor)).not.toBeNull();
      const claims=await Promise.all(['a','b'].map(owner=>store.compareAndSwap('9:4','workflow','repository',1,{generation:1,status:'claimed',owner},actor)));
      expect(claims.filter(Boolean)).toHaveLength(1);expect((await store.list('9:4','workflow')).history).toHaveLength(2);
      expect(await store.compareAndSwap('9:4','inbox','delivery',0,{received:true},actor)).not.toBeNull();
      expect(await store.compareAndSwap('9:4','inbox','delivery',0,{received:true},actor)).toBeNull();
      expect((await store.list('9:4','inbox')).history).toHaveLength(1);
    }finally{db.close();}
  });
  it('rejects invalid scopes and inconsistent workflow versions',async()=>{
    const {db,store}=fixture();try{
      await expect(store.list('other/repo','plan')).rejects.toThrow('scope');
      await expect(store.compareAndSwap('9:4','job','key',-1,{}, {id:'1',login:'alice'})).rejects.toThrow('version');
      await expect(workflowStore(store).compareAndSwapWorkflow('9:4',0,{version:3} as WorkflowDocument)).rejects.toThrow('increase exactly once');
    }finally{db.close();}
  });
});
