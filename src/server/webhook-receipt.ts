import type {StateStore} from './state/types';
import {readBoundedBody,RequestBodyError} from './request-body-core';

type Repository={id:number;installationId:number;full_name:string;private:boolean};
export type WebhookInbox={repo:Repository;event:string;delivery:string;receivedAt:string;state:'pending'|'done';lease?:{id:string;expiresAt:string}};
export type WebhookReceiptStage='entry'|'configuration'|'body'|'signature'|'decode'|'scope'|'store'|'store_read'|'store_write'|'store_confirm'|'complete';
export type WebhookReceiptDiagnostic={phase:'entry'|'outcome';stage:WebhookReceiptStage;delivery?:string;status?:number;elapsedMs:number;errorClass?:'timeout'|'configuration'|'body'|'signature'|'payload'|'storage'|'internal'};
export type WebhookReceiptOptions={secret?:string;scopes?:string;getStore:()=>Promise<StateStore>;acceptRepository?:(repo:Repository,store:StateStore)=>Promise<boolean>;deadlineMs?:number;diagnostic?:(diagnostic:WebhookReceiptDiagnostic)=>void};
class ReceiptDeadlineError extends Error {}
class ReceiptError extends Error {constructor(message:string,readonly status:number){super(message);}}
const EVENTS=new Set(['pull_request','pull_request_review','pull_request_review_comment']);
function json(value:unknown,status:number){return Response.json(value,{status,headers:{'Cache-Control':'private, no-store','Pragma':'no-cache','Vary':'Cookie','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'}});}
function repository(value:unknown):Repository {
  if(!value||typeof value!=='object')throw new ReceiptError('Invalid background repository scope.',400);
  const r=value as Record<string,unknown>;
  if(!Number.isSafeInteger(r.id)||Number(r.id)<=0||!Number.isSafeInteger(r.installationId)||Number(r.installationId)<=0||typeof r.full_name!=='string'||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.full_name))throw new ReceiptError('Invalid background repository scope.',400);
  return {id:Number(r.id),installationId:Number(r.installationId),full_name:r.full_name,private:r.private===true};
}
function scoped(repo:Repository,configured:string|undefined){
  try{const scopes:unknown=JSON.parse(configured??'[]');return Array.isArray(scopes)&&scopes.some(s=>s&&typeof s==='object'&&s.id===repo.id&&s.installationId===repo.installationId&&typeof s.full_name==='string'&&s.full_name.toLowerCase()===repo.full_name.toLowerCase());}catch{return false;}
}
export async function verifyWebhookSignature(body:Uint8Array,signature:string|null,secret:string):Promise<boolean> {
  if(secret.length<32||!signature||!/^sha256=[0-9a-f]{64}$/i.test(signature))return false;
  const bytes=Uint8Array.from(signature.slice(7).match(/../g)!,h=>parseInt(h,16));
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,bytes,body as Uint8Array<ArrayBuffer>);
}
function errorClassFor(error:unknown,stage:WebhookReceiptStage):WebhookReceiptDiagnostic['errorClass'] {
  if(error instanceof ReceiptDeadlineError)return 'timeout';
  if(error instanceof RequestBodyError)return 'body';
  if(stage==='configuration')return 'configuration';
  if(stage==='signature')return 'signature';
  if(stage==='decode')return 'payload';
  return stage.startsWith('store')?'storage':'internal';
}
/** Both hosts use this receipt protocol. It never invokes GitHub or executes workflow effects. */
export async function handleWebhookReceipt(request:Request,options:WebhookReceiptOptions):Promise<Response> {
  const started=Date.now();let stage:WebhookReceiptStage='entry';
  const candidate=request.headers.get('X-GitHub-Delivery');
  const deliveryId=candidate&&/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(candidate)?candidate:undefined;
  const report=(phase:'entry'|'outcome',status?:number,errorClass?:WebhookReceiptDiagnostic['errorClass'])=>{
    try{options.diagnostic?.({phase,stage,...(deliveryId?{delivery:deliveryId}:{}),...(status?{status}:{}),elapsedMs:Math.max(0,Date.now()-started),...(errorClass?{errorClass}:{})});}catch{/* Diagnostics must never change receipt semantics. */}
  };
  report('entry');
  const controller=new AbortController();
  const deadlineMs=Number.isFinite(options.deadlineMs)&&options.deadlineMs!>0?Math.min(options.deadlineMs!,7000):7000;
  let timer:ReturnType<typeof setTimeout>;
  const expired=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{
    const error=new ReceiptDeadlineError();reject(error);controller.abort(error);
  },deadlineMs);});
  const assertDeadline=()=>{
    // Timers cannot preempt synchronous work; also check elapsed time before advancing or ACKing.
    if(Date.now()-started>=deadlineMs&&!controller.signal.aborted)controller.abort(new ReceiptDeadlineError());
    controller.signal.throwIfAborted();
  };
  const at=(next:WebhookReceiptStage)=>{assertDeadline();stage=next;};
  const receive=async()=>{
    at('configuration');
    if(!options.secret||options.secret.length<32)throw new ReceiptError('GitHub webhook verification is not configured.',503);
    at('body');const body=await readBoundedBody(request,1000000,controller.signal);
    at('signature');
    if(!await verifyWebhookSignature(body,request.headers.get('X-Hub-Signature-256'),options.secret))throw new ReceiptError('Invalid GitHub webhook signature.',401);
    at('decode');
    const event=request.headers.get('X-GitHub-Event')??'';if(event==='ping'||!EVENTS.has(event))return json({accepted:true,ignored:true},202);
    const delivery=request.headers.get('X-GitHub-Delivery');if(!delivery||! /^[a-f\d-]{16,64}$/i.test(delivery))throw new ReceiptError('Missing GitHub delivery identity.',400);
    let input:{installation?:{id:number};repository?:{id:number;full_name:string;private:boolean}};
    try{input=JSON.parse(new TextDecoder().decode(body));}catch{throw new ReceiptError('Invalid webhook JSON.',400);}
    if(!input||typeof input!=='object')throw new ReceiptError('Invalid webhook JSON.',400);
    const repo=repository({...input.repository,installationId:input.installation?.id});
    at('scope');if(!options.acceptRepository&&!scoped(repo,options.scopes))return json({accepted:true,ignored:true},202);
    const scope=`${repo.installationId}:${repo.id}`,key=`webhook:${delivery}`;
    at('store');const store=await options.getStore();
    if(options.acceptRepository){at('scope');if(!await options.acceptRepository(repo,store))return json({accepted:true,ignored:true},202);}
    at('store_read');const previous=await store.read<WebhookInbox>(scope,'inbox',key);
    at('store_write');
    if(previous?.value.state==='done')return json({accepted:true,duplicate:true},202);
    if(!previous){
      const saved=await store.compareAndSwap<WebhookInbox>(scope,'inbox',key,0,{repo,event,delivery,receivedAt:new Date().toISOString(),state:'pending'},{id:'github',login:'GitHub webhook'});
      // An in-flight CAS may commit after a timeout. Redelivery uses the same durable key.
      at('store_confirm');
      if(!saved&&!await store.read<WebhookInbox>(scope,'inbox',key))throw new Error('No durable receipt.');
    }
    at('complete');return json({accepted:true,queued:true},202);
  };
  try {
    const response=await Promise.race([receive(),expired]);
    assertDeadline();stage='complete';report('outcome',response.status);return response;
  }catch(error){
    const errorClass=errorClassFor(error,stage);
    const status=error instanceof ReceiptError||error instanceof RequestBodyError?error.status:503;
    report('outcome',status,errorClass);
    if(error instanceof ReceiptError||error instanceof RequestBodyError)return json({error:error.message},status);
    return json({error:'Webhook receipt is unavailable. Manually redeliver in GitHub; scheduled polling can reconcile repository state.'},503);
  }finally{clearTimeout(timer!);}
}
