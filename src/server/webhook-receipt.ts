import type {StateStore} from './state/types';
import {readBoundedBody,RequestBodyError} from './request-body-core';

type Repository={id:number;installationId:number;full_name:string;private:boolean};
export type WebhookInbox={repo:Repository;event:string;delivery:string;receivedAt:string;state:'pending'|'done';lease?:{id:string;expiresAt:string}};
export type WebhookReceiptOptions={secret?:string;scopes?:string;getStore:()=>Promise<StateStore>};
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
/** Both hosts use this receipt protocol. It never invokes GitHub or executes workflow effects. */
export async function handleWebhookReceipt(request:Request,options:WebhookReceiptOptions):Promise<Response> {
  try {
    if(!options.secret||options.secret.length<32)throw new ReceiptError('GitHub webhook verification is not configured.',503);
    const body=await readBoundedBody(request,1000000);
    if(!await verifyWebhookSignature(body,request.headers.get('X-Hub-Signature-256'),options.secret))throw new ReceiptError('Invalid GitHub webhook signature.',401);
    const event=request.headers.get('X-GitHub-Event')??'';if(event==='ping'||!EVENTS.has(event))return json({accepted:true,ignored:true},202);
    const delivery=request.headers.get('X-GitHub-Delivery');if(!delivery||! /^[a-f\d-]{16,64}$/i.test(delivery))throw new ReceiptError('Missing GitHub delivery identity.',400);
    let input:{installation?:{id:number};repository?:{id:number;full_name:string;private:boolean}};
    try{input=JSON.parse(new TextDecoder().decode(body));}catch{throw new ReceiptError('Invalid webhook JSON.',400);}
    if(!input||typeof input!=='object')throw new ReceiptError('Invalid webhook JSON.',400);
    const repo=repository({...input.repository,installationId:input.installation?.id});
    if(!scoped(repo,options.scopes))return json({accepted:true,ignored:true},202);
    const scope=`${repo.installationId}:${repo.id}`,key=`webhook:${delivery}`;
    const store=await options.getStore();const previous=await store.read<WebhookInbox>(scope,'inbox',key);
    if(previous?.value.state==='done')return json({accepted:true,duplicate:true},202);
    if(!previous){
      const saved=await store.compareAndSwap<WebhookInbox>(scope,'inbox',key,0,{repo,event,delivery,receivedAt:new Date().toISOString(),state:'pending'},{id:'github',login:'GitHub webhook'});
      // A concurrent receipt may win the CAS. Confirm its durable row before ACK.
      if(!saved&&!await store.read<WebhookInbox>(scope,'inbox',key))throw new Error('No durable receipt.');
    }
    return json({accepted:true,queued:true},202);
  }catch(error){
    if(error instanceof ReceiptError||error instanceof RequestBodyError)return json({error:error.message},error.status);
    return json({error:'Webhook receipt is unavailable. GitHub may retry this delivery.'},503);
  }
}
