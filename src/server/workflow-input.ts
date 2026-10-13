import {configuration} from './auth';
import {AccessError} from './github';
import type {WorkflowCommand} from '../workflow/types';
import {boundedBody} from './request-body';
export type WorkflowInput={repository:string;version:number;command:WorkflowCommand;expectedPlanVersion?:number;expectedReviewers?:{id:string;login:string}[]};

function object(value:unknown):Record<string,unknown> {if(!value||typeof value!=='object'||Array.isArray(value))throw new AccessError('Invalid coordination request.',400);return value as Record<string,unknown>;}
function identifier(value:unknown):value is string{return typeof value==='string'&&value.length>0&&value.length<=200;}
function only(value:Record<string,unknown>,allowed:string[]){if(Object.keys(value).some(k=>!allowed.includes(k)))throw new AccessError('Unexpected coordination field.',400);}
export function parseWorkflowInput(value:unknown):WorkflowInput {
  const input=object(value);only(input,['repository','version','command','expectedPlanVersion','expectedReviewers']);
  if(typeof input.repository!=='string'||! /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository)||!Number.isSafeInteger(input.version)||Number(input.version)<0)throw new AccessError('Select a repository and its current coordination version.',400);
  const c=object(input.command);
  switch(c.type){
    case 'configure_pr':
      only(c,['type','prId','held','minimumApprovals','parentId']);
      if(!identifier(c.prId)||(c.held!==undefined&&typeof c.held!=='boolean')||(c.minimumApprovals!==undefined&&(!Number.isSafeInteger(c.minimumApprovals)||Number(c.minimumApprovals)<1||Number(c.minimumApprovals)>20))||(c.parentId!==undefined&&c.parentId!==null&&!identifier(c.parentId))||!['held','minimumApprovals','parentId'].some(k=>Object.hasOwn(c,k)))throw new AccessError('Invalid PR coordination settings.',400);
      break;
    case 'enroll':
      only(c,['type','stackId','enabled','autoProgress','prIds']);
      if(!identifier(c.stackId)||typeof c.enabled!=='boolean'||(c.autoProgress!==undefined&&typeof c.autoProgress!=='boolean')||(c.prIds!==undefined&&(!Array.isArray(c.prIds)||!c.prIds.length||c.prIds.length>5000||c.prIds.some(p=>!identifier(p))||new Set(c.prIds).size!==c.prIds.length)))throw new AccessError('Invalid stack enrollment.',400);
      break;
    case 'auto':
      only(c,['type','stackId','enabled']);if(!identifier(c.stackId)||typeof c.enabled!=='boolean')throw new AccessError('Invalid progression setting.',400);break;
    case 'start':
      only(c,['type','prId','early']);if(!identifier(c.prId)||(c.early!==undefined&&typeof c.early!=='boolean'))throw new AccessError('Invalid review release.',400);
      if(!Number.isSafeInteger(input.expectedPlanVersion)||Number(input.expectedPlanVersion)<0||!Array.isArray(input.expectedReviewers)||input.expectedReviewers.length<1||input.expectedReviewers.length>20)throw new AccessError('Refresh and preview the current reviewer plan before starting review.',400);
      for(const raw of input.expectedReviewers){const reviewer=object(raw);only(reviewer,['id','login']);if(typeof reviewer.id!=='string'||! /^[1-9][0-9]{0,19}$/.test(reviewer.id)||typeof reviewer.login!=='string'||! /^[a-z\d](?:[a-z\d-]{0,38})$/i.test(reviewer.login))throw new AccessError('Preview verified GitHub reviewer identities before starting review.',400);}
      if(new Set(input.expectedReviewers.map(r=>object(r).id)).size!==input.expectedReviewers.length)throw new AccessError('Preview distinct reviewers before starting review.',400);break;
    case 'reconcile':only(c,['type']);break;
    default:throw new AccessError('Unknown coordination action.',400);
  }
  if(c.type!=='start'&&(Object.hasOwn(input,'expectedPlanVersion')||Object.hasOwn(input,'expectedReviewers')))throw new AccessError('Reviewer preview is only valid for a review release.',400);
  return {repository:input.repository,version:Number(input.version),command:c as WorkflowCommand,...c.type==='start'?{expectedPlanVersion:Number(input.expectedPlanVersion),expectedReviewers:input.expectedReviewers as {id:string;login:string}[]}:undefined};
}
export async function readWorkflowInput(request:Request) {
  const origin=configuration()?.origin;
  if(!origin||request.headers.get('Origin')!==origin||new URL(request.url).origin!==origin||request.headers.get('Sec-Fetch-Site')==='cross-site')throw new AccessError('Coordination updates must come from this site.',403);
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AccessError('Expected a JSON coordination request.',415);
  const text=new TextDecoder().decode(await boundedBody(request,64000));
  let input:unknown;try{input=JSON.parse(text);}catch{throw new AccessError('Invalid JSON.',400);}
  return parseWorkflowInput(input);
}
