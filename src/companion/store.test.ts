import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,readFile,rm,stat,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalStateStore} from './store';
import type {Plan} from '../server/state/types';
import {AUTOMATION_REGISTRY_SCOPE} from '../server/state/types';

const directories:string[]=[];const stores:LocalStateStore[]=[];
afterEach(async()=>{for(const store of stores.splice(0))await store.close();for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
const directory=async()=>{const path=await mkdtemp(join(tmpdir(),'mergefoo-store-test-'));directories.push(path);return path;};
const openStore=async(path:string)=>{const store=await LocalStateStore.create(path);stores.push(store);return store;};
const actor={id:'11',login:'alice'};const plan=(version:number):Plan=>({prId:'PR_node',reviewerIds:['reviewer'],reviewerIdentities:[{id:'22',login:'reviewer'}],version,actor:'alice',actorId:'11',updatedAt:'2026-10-12T01:00:00Z'});

describe('private durable local coordination store',()=>{
  it('makes the version decision and replacement atomic, then survives restart',async()=>{
    const path=await directory();const store=await openStore(path);
    const results=await Promise.all([store.compareAndSwap('11:99','plan','PR_node',0,plan(1),actor),store.compareAndSwap('11:99','plan','PR_node',0,plan(1),actor)]);
    expect(results.filter(Boolean)).toHaveLength(1);expect((await store.list<Plan>('11:99','plan')).history).toHaveLength(1);await store.close();
    const reopened=await openStore(path);expect((await reopened.read<Plan>('11:99','plan','PR_node'))?.value).toEqual(plan(1));
    expect((await stat(path)).mode&0o777).toBe(0o700);expect((await stat(join(path,'state.json'))).mode&0o777).toBe(0o600);expect(await readFile(join(path,'state.json'),'utf8')).not.toContain('token');
  });
  it('rejects a second process store and guards unrelated directories and symlinks',async()=>{
    const path=await directory();await openStore(path);await expect(LocalStateStore.create(path)).rejects.toThrow('Another companion');
    const unrelated=await directory();await writeFile(join(unrelated,'keep.txt'),'keep');const previous=(await stat(unrelated)).mode&0o777;await expect(LocalStateStore.create(unrelated)).rejects.toThrow('dedicated');expect((await stat(unrelated)).mode&0o777).toBe(previous);
    const parent=await directory();await symlink(unrelated,join(parent,'linked'));await expect(LocalStateStore.create(join(parent,'linked'))).rejects.toThrow('regular private directory');
  });
  it('isolates GitHub user/repository scopes and permits only intent resource kinds',async()=>{
    const store=await openStore(await directory());await store.compareAndSwap('11:99','plan','PR_node',0,plan(1),actor);expect(await store.read('12:99','plan','PR_node')).toBeNull();
    await expect(store.compareAndSwap('11:99','job','snapshot',0,{version:1},actor)).rejects.toThrow('only persists');await expect(store.compareAndSwap('bad','plan','PR_node',0,plan(1),actor)).rejects.toThrow('Invalid');
    await expect(store.compareAndSwap('11:99','plan','PR_node',1,plan(8),actor)).rejects.toThrow('increase exactly once');expect((await store.read<Plan>('11:99','plan','PR_node'))?.version).toBe(1);
  });
  it('scans current intent in ascending key order with an exclusive bounded cursor and no audit history',async()=>{
    const path=await directory();const store=await openStore(path);
    for(const key of ['PR_3','PR_1','PR_2'])await store.compareAndSwap('11:99','plan',key,0,{...plan(1),prId:key},actor);
    await store.compareAndSwap('11:99','plan','PR_1',1,{...plan(2),prId:'PR_1'},actor);
    const first=await store.scan<Plan>('11:99','plan',{limit:2});
    expect(first.map(record=>[record.key,record.version])).toEqual([['PR_1',2],['PR_2',1]]);
    expect(first[0]).toMatchObject({kind:'plan',actor,value:{prId:'PR_1',actorId:'11',version:2}});
    expect(first[0]).not.toHaveProperty('history');expect(first[0]).not.toHaveProperty('id');
    first[0].value.reviewerIds.push('mutated');expect((await store.read<Plan>('11:99','plan','PR_1'))?.value.reviewerIds).toEqual(['reviewer']);
    expect((await store.scan('11:99','plan',{after:first[1].key,limit:2})).map(record=>record.key)).toEqual(['PR_3']);
    expect(await store.scan('11:99','plan',{after:'PR_3',limit:2})).toEqual([]);
    await store.close();const reopened=await openStore(path);
    expect((await reopened.scan('11:99','plan',{after:'PR_1',limit:1})).map(record=>record.key)).toEqual(['PR_2']);
  });
  it('waits for pending state writes and isolates scan results by user, repository and intent kind',async()=>{
    const store=await openStore(await directory());
    await store.compareAndSwap('12:99','plan','PR_other_user',0,plan(1),actor);
    await store.compareAndSwap('11:100','plan','PR_other_repo',0,plan(1),actor);
    await store.compareAndSwap('11:99','workflow','PR_workflow',0,{version:1},actor);
    const pending=store.compareAndSwap('11:99','plan','PR_pending',0,plan(1),actor);
    expect((await store.scan('11:99','plan',{limit:100})).map(record=>record.key)).toEqual(['PR_pending']);await pending;
    expect((await store.scan('11:99','workflow',{limit:1})).map(record=>record.key)).toEqual(['PR_workflow']);
    await expect(store.scan('11:99','job',{limit:1})).rejects.toThrow('only persists');
    await expect(store.scan(AUTOMATION_REGISTRY_SCOPE,'workflow',{limit:1})).rejects.toThrow('scope');
    await expect(store.compareAndSwap(AUTOMATION_REGISTRY_SCOPE,'workflow','cursor',0,{version:1},actor)).rejects.toThrow('scope');
  });
  it.each([0,-1,101,1.5,Number.NaN])('rejects an invalid scan bound %s',async(limit)=>{
    const store=await openStore(await directory());await expect(store.scan('11:99','plan',{limit})).rejects.toThrow('bounded state scan');
  });
  it.each(['','x'.repeat(201)])('rejects an invalid scan cursor',async(after)=>{
    const store=await openStore(await directory());await expect(store.scan('11:99','plan',{after,limit:1})).rejects.toThrow('bounded state scan');
  });
});
