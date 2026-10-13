import {json} from './auth';
import {AccessError} from './github';
import {backgroundRepo,validRunnerSecret} from './workflow-background';
import {boundedBody} from './request-body';
import {getStateStore} from './state/store';
import type {WebhookInbox} from './webhook-receipt';

const DELIVERY=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function timestamp(value:unknown):string|null {
  if(typeof value!=='string')return null;
  const date=Date.parse(value);return Number.isFinite(date)?new Date(date).toISOString():null;
}
/** Operator-only receipt inspection. It never lists resources, writes state or runs workflows. */
export async function inspectWebhookReceipts(request:Request):Promise<Response> {
  if(!await validRunnerSecret(request.headers.get('Authorization')))throw new AccessError('Webhook diagnostics authorization required.',401);
  const bytes=await boundedBody(request,4000);let input:unknown;
  try{input=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AccessError('Invalid webhook diagnostics JSON.',400);}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new AccessError('Invalid webhook diagnostics request.',400);
  const body=input as Record<string,unknown>;const repo=backgroundRepo(body.repository);
  const deliveries=body.deliveries;
  if(!Array.isArray(deliveries)||deliveries.length<1||deliveries.length>20||deliveries.some(value=>typeof value!=='string'||value.length!==36||!DELIVERY.test(value))||new Set(deliveries.map(value=>typeof value==='string'?value.toLowerCase():value)).size!==deliveries.length)throw new AccessError('Provide between one and twenty distinct GitHub delivery UUIDs.',400);
  let configured:unknown;try{configured=JSON.parse(process.env.WORKFLOW_REPOSITORIES??'[]');}catch{configured=null;}
  if(!Array.isArray(configured)||!configured.some(value=>value&&typeof value==='object'&&value.id===repo.id&&value.installationId===repo.installationId&&typeof value.full_name==='string'&&value.full_name.toLowerCase()===repo.full_name.toLowerCase()))throw new AccessError('Repository is outside the configured background scope.',403);
  const store=await getStateStore();const scope=`${repo.installationId}:${repo.id}`;
  const receipts=await Promise.all((deliveries as string[]).map(value=>value.toLowerCase()).map(async delivery=>{
    const record=await store.read<WebhookInbox>(scope,'inbox',`webhook:${delivery}`);
    return {delivery,persisted:record!==null,receivedAt:timestamp(record?.value.receivedAt),updatedAt:timestamp(record?.updatedAt),state:record?.value.state==='pending'||record?.value.state==='done'?record.value.state:null,version:Number.isSafeInteger(record?.version)&&Number(record?.version)>0?record!.version:null};
  }));
  return json({writesEnabled:process.env.GITHUB_WORKFLOW_WRITES_ENABLED==='true',receipts});
}
