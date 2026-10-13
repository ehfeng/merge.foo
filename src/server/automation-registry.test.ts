import {describe,it,expect,vi} from 'vitest';
import {registerAutomationRepository,findAutomationRepository,claimNextAutomationRepository} from './automation-registry';
import {AUTOMATION_REGISTRY_SCOPE,type ResourceKind,type StateActor,type StateRecord,type StateStore} from './state/types';
import type {Repo} from './github';

const actor={id:'1',login:'alice'};
const repo:Repo={id:4,installationId:9,full_name:'owner/repo',private:false};
function fixture(){
  const rows=new Map<string,StateRecord>();
  const id=(scope:string,kind:ResourceKind,key:string)=>`${scope}/${kind}/${key}`;
  const read=vi.fn(async<T>(scope:string,kind:ResourceKind,key:string)=>rows.get(id(scope,kind,key)) as StateRecord<T>??null);
  const scan=vi.fn(async<T>(scope:string,kind:ResourceKind,options:{after?:string;limit:number})=>[...rows.entries()].filter(([key,row])=>key.startsWith(`${scope}/${kind}/`)&&row.key>(options.after??'')).map(([,row])=>row).sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0).slice(0,options.limit) as StateRecord<T>[]);
  const compareAndSwap=vi.fn(async<T>(scope:string,kind:ResourceKind,key:string,expectedVersion:number,value:T,actor:StateActor)=>{
    const entry=id(scope,kind,key);const current=rows.get(entry);
    if((current?.version??0)!==expectedVersion)return null;
    const saved={key,kind,version:expectedVersion+1,value,actor,updatedAt:new Date().toISOString()};rows.set(entry,saved);return saved;
  });
  const list=vi.fn(()=>{throw new Error('Unbounded registry enumeration is forbidden.');});
  const store:StateStore={
    async read<T>(scope:string,kind:ResourceKind,key:string){return read(scope,kind,key) as Promise<StateRecord<T>|null>;},
    async scan<T>(scope:string,kind:ResourceKind,options:{after?:string;limit:number}){return scan(scope,kind,options) as Promise<StateRecord<T>[]>;},
    async compareAndSwap<T>(scope:string,kind:ResourceKind,key:string,version:number,value:T,actor:StateActor){return compareAndSwap(scope,kind,key,version,value,actor) as Promise<StateRecord<T>|null>;},
    list,
  };return {store,rows,read,scan,compareAndSwap,list};
}
describe('dynamic automation repository registry',()=>{
  it('registers only repository metadata and retries idempotently without extra writes',async()=>{
    const {store,rows,compareAndSwap}=fixture();
    expect(await registerAutomationRepository(store,{...repo,token:'do-not-store'} as Repo,actor)).toEqual(repo);
    expect(await registerAutomationRepository(store,repo,actor)).toEqual(repo);
    expect(compareAndSwap).toHaveBeenCalledTimes(1);
    expect([...rows.values()][0].value).toEqual(repo);
    const renamed={...repo,full_name:'new-owner/renamed',private:true};
    expect(await registerAutomationRepository(store,renamed,actor)).toEqual(renamed);
    expect(await findAutomationRepository(store,repo)).toEqual(renamed);
    expect(rows.size).toBe(1);
  });
  it('finds membership only by stable installation and repository IDs',async()=>{
    const {store}=fixture();
    expect(await findAutomationRepository(store,repo)).toBeNull();
    await registerAutomationRepository(store,repo,actor);
    expect(await findAutomationRepository(store,{...repo,full_name:'untrusted/input',private:true})).toEqual(repo);
    expect(await findAutomationRepository(store,{...repo,installationId:10})).toBeNull();
    expect(await findAutomationRepository(store,{...repo,id:5})).toBeNull();
  });
  it('concurrent registrations preserve one stable record',async()=>{
    const {store,rows}=fixture();
    expect(await Promise.all([registerAutomationRepository(store,repo,actor),registerAutomationRepository(store,repo,actor)])).toEqual([repo,repo]);
    expect(rows.size).toBe(1);expect([...rows.values()][0].version).toBe(1);
  });
  it.each([{...repo,id:0},{...repo,installationId:0},{...repo,id:Number.MAX_SAFE_INTEGER+1},{...repo,full_name:'../repo'},{...repo,full_name:'owner/repo/extra'},{...repo,private:undefined}])('rejects invalid registration metadata',async invalid=>{
    const {store,compareAndSwap}=fixture();
    await expect(registerAutomationRepository(store,invalid as Repo,actor)).rejects.toThrow('Invalid registered');
    expect(compareAndSwap).not.toHaveBeenCalled();
  });
  it('fails closed on a corrupted record identity',async()=>{
    const {store,rows}=fixture();await registerAutomationRepository(store,repo,actor);
    const record=rows.get(`${AUTOMATION_REGISTRY_SCOPE}/job/repository:9:4`)!;record.value={...repo,id:5};
    await expect(findAutomationRepository(store,repo)).rejects.toThrow('identity');
    await expect(claimNextAutomationRepository(store)).rejects.toThrow('identity');
  });
  it('rotates fairly across more than one hundred repositories without listing the registry',async()=>{
    const {store,scan,list}=fixture();const repos=Array.from({length:137},(_,i)=>({...repo,id:i+1,full_name:`owner/repo-${i+1}`}));
    for(const item of repos)await registerAutomationRepository(store,item,actor);
    const selected:Repo[]=[];for(let i=0;i<repos.length;i++)selected.push((await claimNextAutomationRepository(store)).repo!);
    expect(new Set(selected.map(r=>r.id)).size).toBe(repos.length);
    expect((await claimNextAutomationRepository(store)).repo).toEqual(selected[0]);
    expect(scan.mock.calls.every(call=>call[2].limit===1)).toBe(true);expect(list).not.toHaveBeenCalled();
  });
  it('discovers additions on both sides of the cursor and wraps when entries end',async()=>{
    const {store}=fixture();await registerAutomationRepository(store,{...repo,id:20},actor);
    expect((await claimNextAutomationRepository(store)).repo?.id).toBe(20);
    await registerAutomationRepository(store,{...repo,id:10},actor);await registerAutomationRepository(store,{...repo,id:30},actor);
    expect((await claimNextAutomationRepository(store)).repo?.id).toBe(30);
    expect((await claimNextAutomationRepository(store)).repo?.id).toBe(10);
    expect((await claimNextAutomationRepository(store)).repo?.id).toBe(20);
  });
  it('concurrent schedulers claim consecutive positions atomically',async()=>{
    const {store}=fixture();for(const id of [1,2,3])await registerAutomationRepository(store,{...repo,id},actor);
    const selected=await Promise.all([claimNextAutomationRepository(store),claimNextAutomationRepository(store)]);
    expect(selected.map(result=>result.repo?.id).sort()).toEqual([1,2]);
  });
  it('returns an empty registry without creating a cursor',async()=>{
    const {store,scan,compareAndSwap}=fixture();expect(await claimNextAutomationRepository(store)).toEqual({repo:null});
    expect(scan).toHaveBeenCalledTimes(1);expect(compareAndSwap).not.toHaveBeenCalled();
  });
  it('bounds cursor contention to eight attempts',async()=>{
    const {store,scan,compareAndSwap}=fixture();await registerAutomationRepository(store,repo,actor);
    compareAndSwap.mockClear();compareAndSwap.mockResolvedValue(null);
    await expect(claimNextAutomationRepository(store)).rejects.toThrow('Another scheduler');
    expect(compareAndSwap).toHaveBeenCalledTimes(8);expect(scan).toHaveBeenCalledTimes(8);
  });
  it('bounds registration contention and surfaces incomplete registration',async()=>{
    const {store,compareAndSwap}=fixture();compareAndSwap.mockResolvedValue(null);
    await expect(registerAutomationRepository(store,repo,actor)).rejects.toThrow('Retry the feature update');
    expect(compareAndSwap).toHaveBeenCalledTimes(8);
  });
  it('rejects an invalid cursor instead of letting it redirect registry lookup',async()=>{
    const {store,scan}=fixture();await store.compareAndSwap(AUTOMATION_REGISTRY_SCOPE,'workflow','scheduler-cursor',0,{after:'arbitrary'},actor);
    await expect(claimNextAutomationRepository(store)).rejects.toThrow('Invalid automation scheduler cursor');expect(scan).not.toHaveBeenCalled();
  });
});
