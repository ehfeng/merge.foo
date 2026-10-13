import {afterEach,it,expect,vi} from 'vitest';
import {readBoundedBody} from './request-body-core';
import {handleWebhookReceipt,type WebhookReceiptOptions} from './webhook-receipt';
import type {StateStore,StateRecord,StateActor,ResourceKind} from './state/types';
const secret='synthetic-hook-secret-at-least-32-characters';
const scopes='[{"id":42,"installationId":7,"full_name":"owner/repo"}]';
const body=JSON.stringify({installation:{id:7},repository:{id:42,full_name:'owner/repo',private:true}});
async function request(text=body,event='pull_request',id=crypto.randomUUID()){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)));
  return new Request('https://fixture.invalid/api/github/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':'sha256='+[...digest].map(b=>b.toString(16).padStart(2,'0')).join(''),'X-GitHub-Event':event,'X-GitHub-Delivery':id},body:text});
}
function fixture(){
  const rows=new Map<string,StateRecord>();
  const store:StateStore={
    async read<T>(scope:string,kind:ResourceKind,key:string){await Promise.resolve();return rows.get(`${scope}/${kind}/${key}`) as StateRecord<T>|undefined??null;},
    async list<T>(){return {records:[...rows.values()] as StateRecord<T>[],history:[]};},
    async scan<T>(scope:string,kind:ResourceKind,{after,limit}:{after?:string;limit:number}){return [...rows.values()].filter(row=>row.kind===kind&&rows.has(`${scope}/${kind}/${row.key}`)&&(!after||row.key>after)).sort((a,b)=>a.key.localeCompare(b.key)).slice(0,limit) as StateRecord<T>[];},
    async compareAndSwap<T>(scope:string,kind:ResourceKind,key:string,version:number,value:T,actor:StateActor){await Promise.resolve();const path=`${scope}/${kind}/${key}`;if((rows.get(path)?.version??0)!==version)return null;const row={key,kind,version:version+1,value,actor,updatedAt:new Date().toISOString()};rows.set(path,row);return row;},
  };
  return {rows,store,options:{secret,scopes,getStore:async()=>store} satisfies WebhookReceiptOptions};
}
it('ACKs concurrent distinct and duplicate receipts only after shared durable state exists',async()=>{
  const f=fixture();const ids=Array.from({length:8},()=>crypto.randomUUID());
  const requests=await Promise.all([...ids,...ids].map(id=>request(body,'pull_request_review',id)));
  const responses=await Promise.all(requests.map(req=>handleWebhookReceipt(req,f.options)));
  expect(responses.every(response=>response.status===202)).toBe(true);expect(f.rows.size).toBe(8);
  for(const row of f.rows.values())expect(row).toMatchObject({version:1,value:{state:'pending',repo:{id:42,installationId:7,private:true}}});
  expect([...f.rows.values()].every(row=>!JSON.stringify(row).includes('synthetic-hook-secret'))).toBe(true);
});
it('does not ACK before CAS completes, and returns retryable sanitized503 if durability fails',async()=>{
  const f=fixture();let release!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});
  const save=f.store.compareAndSwap.bind(f.store);f.store.compareAndSwap=async(...args)=>{await waiting;return save(...args);};
  let completed=false;const pending=handleWebhookReceipt(await request(),f.options).then(response=>{completed=true;return response;});
  await new Promise(resolve=>setTimeout(resolve,0));expect(completed).toBe(false);expect(f.rows.size).toBe(0);release();expect((await pending).status).toBe(202);
  f.store.compareAndSwap=async()=>{throw new Error('internal-database-url-and-password');};
  const failed=await handleWebhookReceipt(await request(),f.options);expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('internal-database');
});
it('rejects a lost CAS without a durable winner instead of acknowledging missing work',async()=>{
  const f=fixture();f.store.compareAndSwap=async()=>null;
  expect((await handleWebhookReceipt(await request(),f.options)).status).toBe(503);expect(f.rows.size).toBe(0);
});
it('verifies signatures before ignoring ping/unsupported events and never obtains storage for ignored events',async()=>{
  const getStore=vi.fn(async()=>{throw new Error('No storage should be opened.');});const options={secret,scopes,getStore};
  for(const event of ['ping','push']){const response=await handleWebhookReceipt(await request('{}',event),options);expect(response.status).toBe(202);expect(await response.json()).toMatchObject({ignored:true});}
  const invalid=await request('{}','ping');invalid.headers.set('X-Hub-Signature-256','sha256='+'0'.repeat(64));expect((await handleWebhookReceipt(invalid,options)).status).toBe(401);
  expect(getStore).not.toHaveBeenCalled();
});
it('matches exact numeric install/repository scopes and full name; malformed signed payloads are controlled400',async()=>{
  const f=fixture();
  for(const text of ['null','[]','{',JSON.stringify({installation:{id:7},repository:{id:42,full_name:'https://evil.invalid/repo'}})])expect((await handleWebhookReceipt(await request(text),f.options)).status).toBe(400);
  for(const text of [body.replace('"id":7','"id":8'),body.replace('"id":42','"id":43'),body.replace('owner/repo','owner/other')])expect(await (await handleWebhookReceipt(await request(text),f.options)).json()).toMatchObject({ignored:true});
  const missing=await request();missing.headers.delete('X-GitHub-Delivery');expect((await handleWebhookReceipt(missing,f.options)).status).toBe(400);expect(f.rows.size).toBe(0);
});
it('limits declared and chunked bodies at ingress before opening storage',async()=>{
  const getStore=vi.fn(async()=>{throw new Error('No storage should be opened.');});const options={secret,scopes,getStore};
  const declared=await request();declared.headers.set('Content-Length','1000001');expect((await handleWebhookReceipt(declared,options)).status).toBe(413);
  let cancelled=false;let chunks=0;const stream=new ReadableStream<Uint8Array>({pull(controller){chunks++;controller.enqueue(new Uint8Array(600000));},cancel(){cancelled=true;}});
  const chunked=new Request('https://fixture.invalid/api/github/webhook',{method:'POST',body:stream,duplex:'half'} as RequestInit);
  expect((await handleWebhookReceipt(chunked,options)).status).toBe(413);expect(cancelled).toBe(true);expect(chunks).toBeLessThan(5);expect(getStore).not.toHaveBeenCalled();
});

afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
async function timedFixture(){
  const input=await request();const f=fixture();const diagnostics:unknown[]=[];
  vi.useFakeTimers();
  vi.spyOn(crypto.subtle,'importKey').mockResolvedValue({} as CryptoKey);
  vi.spyOn(crypto.subtle,'verify').mockResolvedValue(true);
  return {...f,input,diagnostics,options:{...f.options,diagnostic:(entry:unknown)=>diagnostics.push(entry)}};
}
it('uses one total deadline across store setup and reads and never starts a late write',async()=>{
  const f=await timedFixture();const cas=vi.spyOn(f.store,'compareAndSwap');
  f.options.getStore=()=>new Promise(resolve=>setTimeout(()=>resolve(f.store),4000));
  const read=vi.spyOn(f.store,'read').mockImplementation(()=>new Promise(resolve=>setTimeout(()=>resolve(null),4000)));
  const pending=handleWebhookReceipt(f.input,f.options);await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(4000);expect(read).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(3000);const response=await pending;expect(response.status).toBe(503);
  expect(f.diagnostics.at(-1)).toMatchObject({phase:'outcome',stage:'store_read',status:503,elapsedMs:7000,errorClass:'timeout'});
  await vi.advanceTimersByTimeAsync(1000);expect(cas).not.toHaveBeenCalled();expect(f.rows.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
});
it('times out hung body reads without waiting for a hung cancellation or obtaining storage',async()=>{
  const f=await timedFixture();const cancel=vi.fn(()=>new Promise<void>(()=>{}));
  const stream=new ReadableStream<Uint8Array>({pull(){return new Promise<void>(()=>{});},cancel});
  const input=new Request(f.input.url,{method:'POST',headers:f.input.headers,body:stream,duplex:'half'} as RequestInit);
  const getStore=vi.spyOn(f.options,'getStore');const pending=handleWebhookReceipt(input,f.options);
  await vi.advanceTimersByTimeAsync(7000);expect((await pending).status).toBe(503);expect(cancel).toHaveBeenCalledOnce();
  expect(input.body?.locked).toBe(false);expect(getStore).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  expect(f.diagnostics.at(-1)).toMatchObject({stage:'body',errorClass:'timeout'});
});
it('allows a late CAS to persist but never ACKs it, and redelivery deduplicates the durable receipt',async()=>{
  const f=await timedFixture();let finish!:()=>void;const late=new Promise<void>(resolve=>{finish=resolve;});
  const save=f.store.compareAndSwap.bind(f.store);const cas=vi.spyOn(f.store,'compareAndSwap').mockImplementation(async(...args)=>{await late;return save(...args);});
  const pending=handleWebhookReceipt(f.input,f.options);await vi.advanceTimersByTimeAsync(0);expect(cas).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(7000);expect((await pending).status).toBe(503);expect(f.rows.size).toBe(0);
  finish();await vi.advanceTimersByTimeAsync(0);expect(f.rows.size).toBe(1);expect(f.diagnostics).toHaveLength(2);
  vi.useRealTimers();vi.restoreAllMocks();
  const duplicate=await request(body,'pull_request',f.input.headers.get('X-GitHub-Delivery')!);
  expect((await handleWebhookReceipt(duplicate,f.options)).status).toBe(202);expect(f.rows.size).toBe(1);
});
it('bounds confirmation of a concurrent winner and does not ACK an unconfirmed lost CAS',async()=>{
  const f=await timedFixture();let reads=0;
  vi.spyOn(f.store,'read').mockImplementation(async()=>{if(++reads===1)return null;return new Promise(()=>{});});
  vi.spyOn(f.store,'compareAndSwap').mockResolvedValue(null);
  const pending=handleWebhookReceipt(f.input,f.options);await vi.advanceTimersByTimeAsync(7000);
  expect((await pending).status).toBe(503);expect(f.diagnostics.at(-1)).toMatchObject({stage:'store_confirm',errorClass:'timeout'});
});
it('bounds a hung signature verification without opening storage',async()=>{
  const f=await timedFixture();vi.spyOn(crypto.subtle,'verify').mockImplementation(()=>new Promise(()=>{}));
  const getStore=vi.spyOn(f.options,'getStore');const pending=handleWebhookReceipt(f.input,f.options);await vi.advanceTimersByTimeAsync(7000);
  expect((await pending).status).toBe(503);expect(getStore).not.toHaveBeenCalled();expect(f.diagnostics.at(-1)).toMatchObject({stage:'signature',errorClass:'timeout'});
});
it('emits only allowlisted diagnostics and does not depend on a working log sink',async()=>{
  const f=fixture();const logs:unknown[]=[];f.store.read=async()=>{throw new Error('private-db-password-and-repository-url');};
  const input=await request();input.headers.set('X-GitHub-Delivery','untrusted-secret-header-value');
  expect((await handleWebhookReceipt(input,{...f.options,diagnostic:entry=>logs.push(entry)})).status).toBe(400);
  expect(logs).toEqual([{phase:'entry',stage:'entry',elapsedMs:expect.any(Number)},{phase:'outcome',stage:'decode',elapsedMs:expect.any(Number),status:400,errorClass:'payload'}]);
  const failed=await handleWebhookReceipt(await request(),{...f.options,diagnostic:entry=>logs.push(entry)});expect(failed.status).toBe(503);
  expect(JSON.stringify(logs)).not.toMatch(/untrusted-secret|private-db|synthetic-hook-secret|owner\/repo|sha256/);
  expect((await handleWebhookReceipt(await request(),{...fixture().options,diagnostic:()=>{throw new Error('Broken logger');}})).status).toBe(202);
});
it('cleans up the deadline timer on prompt success and rejection',async()=>{
  const f=await timedFixture();expect((await handleWebhookReceipt(f.input,f.options)).status).toBe(202);expect(vi.getTimerCount()).toBe(0);
  const input=new Request('https://fixture.invalid/api/github/webhook',{method:'POST',body:'{}'});
  expect((await handleWebhookReceipt(input,f.options)).status).toBe(401);expect(vi.getTimerCount()).toBe(0);
});
it('releases bounded-body locks and rejects abortion without waiting for source cancellation',async()=>{
  const controller=new AbortController();const cancel=vi.fn(()=>new Promise<void>(()=>{}));
  const stream=new ReadableStream<Uint8Array>({cancel});
  const input=new Request('https://fixture.invalid',{method:'POST',body:stream,duplex:'half'} as RequestInit);
  const read=readBoundedBody(input,100,controller.signal);const observed=expect(read).rejects.toThrow('Stopped');controller.abort(new Error('Stopped'));await observed;
  expect(cancel).toHaveBeenCalledOnce();expect(input.body?.locked).toBe(false);
});

it('enforces elapsed time even when synchronous work prevents the timer callback from running',async()=>{
  const f=await timedFixture();const cas=vi.spyOn(f.store,'compareAndSwap');
  vi.spyOn(f.store,'read').mockImplementation(async()=>{vi.setSystemTime(Date.now()+8000);return null;});
  expect((await handleWebhookReceipt(f.input,f.options)).status).toBe(503);expect(cas).not.toHaveBeenCalled();
  expect(f.diagnostics.at(-1)).toMatchObject({stage:'store_read',elapsedMs:8000,errorClass:'timeout'});expect(vi.getTimerCount()).toBe(0);
});
