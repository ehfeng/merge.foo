import {github} from './auth';
import {AccessError,type Repo} from './github';
import type {Identity,WorkflowAction,WorkflowDocument} from '../workflow/types';
export {verifyWebhookSignature as validWebhookSignature} from './webhook-receipt';

const encoder=new TextEncoder();
function base64url(bytes:Uint8Array){return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
function der(tag:number,bytes:Uint8Array):Uint8Array {
  const size:number[]=[];let n=bytes.length;do{size.unshift(n&255);n>>>=8;}while(n);
  const length=bytes.length<128?[bytes.length]:[128|size.length,...size];
  return Uint8Array.from([tag,...length,...bytes]);
}
function privateKeyBytes(pem:string):Uint8Array {
  const normalized=pem.replaceAll('\\n','\n').trim();
  const match=normalized.match(/^-----BEGIN (RSA PRIVATE KEY|PRIVATE KEY)-----\s+([A-Za-z0-9+/=\s]+)\s+-----END \1-----$/);
  if(!match)throw new AccessError('The operator must configure a valid GitHub App private key.',503);
  const raw=Uint8Array.from(atob(match[2].replace(/\s/g,'')),c=>c.charCodeAt(0));
  // GitHub downloads PKCS#1 PEM; Web Crypto imports the equivalent PKCS#8 envelope.
  return match[1]==='PRIVATE KEY'?raw:der(48,Uint8Array.from([2,1,0,48,13,6,9,42,134,72,134,247,13,1,1,1,5,0,...der(4,raw)]));
}
export async function appJwt(issuer:string,pem:string,now=Date.now()):Promise<string> {
  if(!/^[A-Za-z0-9_.-]{1,100}$/.test(issuer))throw new AccessError('The operator must configure the GitHub App client ID.',503);
  const key=await crypto.subtle.importKey('pkcs8',privateKeyBytes(pem) as Uint8Array<ArrayBuffer>,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const second=Math.floor(now/1000);const encoded=`${base64url(encoder.encode(JSON.stringify({alg:'RS256',typ:'JWT'})))}.${base64url(encoder.encode(JSON.stringify({iss:issuer,iat:second-60,exp:second+540})))}`;
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,encoder.encode(encoded));
  return `${encoded}.${base64url(new Uint8Array(signature))}`;
}
/** Operator readiness is shared by every connected repository; GitHub grants remain repo scoped. */
export function backgroundConfigured(_repo?:Repo){
  return !!(process.env.GITHUB_APP_PRIVATE_KEY&&(process.env.GITHUB_APP_ID||process.env.GITHUB_CLIENT_ID)&&(process.env.GITHUB_WEBHOOK_SECRET?.length??0)>=32&&(process.env.WORKFLOW_RECONCILE_SECRET?.length??0)>=32);
}
export async function installationPrincipal(repo:Repo):Promise<{token:string;bot:Identity}> {
  if(!Number.isSafeInteger(repo.id)||repo.id<=0||!Number.isSafeInteger(repo.installationId)||repo.installationId<=0)throw new AccessError('Invalid installation scope.',400);
  const pem=process.env.GITHUB_APP_PRIVATE_KEY,issuer=process.env.GITHUB_APP_ID||process.env.GITHUB_CLIENT_ID;
  if(!pem||!issuer)throw new AccessError('Background review needs the operator’s GitHub App private key.',503);
  const jwt=await appJwt(issuer,pem);
  const app=await github<{id:number;slug:string}>(jwt,'/app');
  if(!app.slug||!Number.isSafeInteger(app.id)||app.id<=0)throw new AccessError('GitHub App identity could not be verified.',503);
  const installation=await github<{id:number;suspended_at:string|null;app_id:number;permissions?:{pull_requests?:string}}>(jwt,`/app/installations/${repo.installationId}`);
  if(installation.id!==repo.installationId||installation.app_id!==app.id||installation.suspended_at||installation.permissions?.pull_requests!=='write')throw new AccessError('The GitHub App installation is unavailable.');
  const response=await fetch(`https://api.github.com/app/installations/${repo.installationId}/access_tokens`,{method:'POST',headers:{Authorization:`Bearer ${jwt}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'merge.foo'},cache:'no-store',signal:AbortSignal.timeout(15000),body:JSON.stringify({repository_ids:[repo.id],permissions:{pull_requests:'write',checks:'read',statuses:'read',metadata:'read'}})});
  if(!response.ok)throw new AccessError('GitHub did not grant the scoped review permissions. Check the App installation.',503);
  const result=await response.json() as {token?:string;expires_at?:string;permissions?:{pull_requests?:string}};
  const expiry=typeof result.expires_at==='string'?Date.parse(result.expires_at):NaN;
  if(typeof result.token!=='string'||!result.token||result.token.length>4096||result.permissions?.pull_requests!=='write'||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+3660000)throw new AccessError('GitHub returned an unusable installation token.',503);
  const current=await github<{id:number;full_name:string;archived:boolean}>(result.token,`/repos/${repo.full_name}`);
  if(current.id!==repo.id||typeof current.full_name!=='string'||current.full_name.toLowerCase()!==repo.full_name.toLowerCase())throw new AccessError('Repository identity changed. Reconnect before enabling review.');
  if(current.archived!==false)throw new AccessError('The repository is archived or its current status could not be verified.');
  const bot=await github<{id:number;login:string;type:string}>(result.token,`/users/${encodeURIComponent(`${app.slug}[bot]`)}`);
  if(!Number.isSafeInteger(bot.id)||bot.id<=0||bot.type!=='Bot'||typeof bot.login!=='string'||bot.login.toLowerCase()!==`${app.slug}[bot]`.toLowerCase())throw new AccessError('GitHub App bot identity could not be verified.',503);
  return {token:result.token,bot:{id:String(bot.id),login:bot.login}};
}
export async function authorizeBackgroundGrant(token:string,repo:Repo,action:WorkflowAction,document:WorkflowDocument):Promise<boolean> {
  const grant=document.config.stacks[action.stackId];
  if(!grant?.enrolled||!grant.prIds.includes(action.prId)||!grant.actorId||!grant.actorLogin)return false;
  const permission=await github<{permission:string;user?:{id:number;login:string}}>(token,`/repos/${repo.full_name}/collaborators/${encodeURIComponent(grant.actorLogin)}/permission`);
  if(!permission.user||String(permission.user.id)!==grant.actorId||!['admin','maintain','write'].includes(permission.permission))return false;
  if(action.mode==='manual'){
    const release=document.releases[action.prId];if(!release?.actorLogin||!release.actorId)return false;
    if(release.actorId!==grant.actorId){const requester=await github<{permission:string;user?:{id:number}}>(token,`/repos/${repo.full_name}/collaborators/${encodeURIComponent(release.actorLogin)}/permission`);if(!requester.user||String(requester.user.id)!==release.actorId||!['admin','maintain','write'].includes(requester.permission))return false;}
  }
  return true;
}
