import {it,expect,vi} from 'vitest';
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
