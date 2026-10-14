import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {DurableObjectStateStore} from './durable-object';
import {PlannedAssignments} from '../plan-object';
import {workflowStore} from './workflow';
import {PostgresStateStore} from './postgres';
import {AUTOMATION_REGISTRY_SCOPE} from './types';
import {vi} from 'vitest';
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

describe('bounded shared-state scans',()=>{
  it('scans repository keys in order, excludes the cursor, and preserves typed records',async()=>{
    const {db,store}=fixture();try{
      const actor={id:'scheduler',login:'merge.foo scheduler'};
      for(const key of ['repository:9:3','repository:9:1','repository:9:2'])await store.compareAndSwap(AUTOMATION_REGISTRY_SCOPE,'job',key,0,{key},actor);
      await store.compareAndSwap(AUTOMATION_REGISTRY_SCOPE,'workflow','scheduler-cursor',0,{after:'repository:9:1'},actor);
      expect((await store.scan(AUTOMATION_REGISTRY_SCOPE,'job',{limit:2})).map(r=>r.key)).toEqual(['repository:9:1','repository:9:2']);
      expect((await store.scan(AUTOMATION_REGISTRY_SCOPE,'job',{after:'repository:9:2',limit:1})).map(r=>r.key)).toEqual(['repository:9:3']);
      expect(await store.scan(AUTOMATION_REGISTRY_SCOPE,'job',{after:'repository:9:3',limit:1})).toEqual([]);
      expect((await store.list(AUTOMATION_REGISTRY_SCOPE,'job')).history).toHaveLength(3);
    }finally{db.close();}
  });
  it('scans legacy plan rows without changing migration or histories',async()=>{
    const {db,object,store}=fixture();try{
      for(const prId of ['P3','P1','P2'])await object.fetch(new Request('https://plans.internal/',{method:'PUT',body:JSON.stringify({prId,version:0,reviewerIds:[],actor:'alice',actorId:'1',updatedAt:new Date().toISOString()})}));
      expect((await store.scan('9:4','plan',{after:'P1',limit:1})).map(r=>[r.key,r.version])).toEqual([['P2',1]]);
      expect((await store.list('9:4','plan')).history).toHaveLength(3);
    }finally{db.close();}
  });
  it.each([0,-1,101,1.5,NaN])('rejects an invalid provider scan limit %s',async limit=>{
    const {db,store,object}=fixture();try{
      await expect(store.scan('9:4','job',{limit})).rejects.toThrow('bounded state scan');
      const response=await object.fetch(new Request('https://state.internal/resources',{method:'POST',body:JSON.stringify({operation:'scan',kind:'job',limit})}));expect(response.status).toBe(400);
    }finally{db.close();}
  });
  it('validates the reserved scope and empty or oversized cursors',async()=>{
    const {db,store}=fixture();try{
      await expect(store.scan('automation-registry-attacker','job',{limit:1})).rejects.toThrow('scope');
      await expect(store.scan(AUTOMATION_REGISTRY_SCOPE,'job',{after:'',limit:1})).rejects.toThrow('scan');
      await expect(store.scan(AUTOMATION_REGISTRY_SCOPE,'job',{after:'x'.repeat(201),limit:1})).rejects.toThrow('scan');
    }finally{db.close();}
  });
  it('pushes the keyset and bound into the PostgreSQL query',async()=>{
    const query=vi.fn(async()=>[{resource_key:'repository:9:2',kind:'job',version:1,document:{id:2},actor_id:'1',actor_login:'alice',updated_at:'2026-10-12T00:00:00Z'}]);
    const store=new PostgresStateStore(query);
    expect((await store.scan(AUTOMATION_REGISTRY_SCOPE,'job',{after:'repository:9:1',limit:1}))[0]).toMatchObject({key:'repository:9:2',kind:'job',version:1,value:{id:2}});
    expect(query).toHaveBeenCalledWith(expect.stringContaining('resource_key>$3 ORDER BY resource_key LIMIT $4'),[AUTOMATION_REGISTRY_SCOPE,'job','repository:9:1',1]);
    await expect(store.scan(AUTOMATION_REGISTRY_SCOPE,'job',{limit:101})).rejects.toThrow('scan');expect(query).toHaveBeenCalledTimes(1);
  });
});
