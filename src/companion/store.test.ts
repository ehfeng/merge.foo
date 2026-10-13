import {afterEach,describe,it,expect} from 'vitest';
import {mkdtemp,readFile,rm,stat,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalStateStore} from './store';
import type {Plan} from '../server/state/types';

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
});
