import {canonicalOriginDecision} from './canonical-origin';
type AuthConfig = { origin: string; clientId: string; clientSecret: string; secret: string };
export type Session = { token: string; login: string; userId: string; expires: number };
export class AuthenticationError extends Error {readonly status=401;}
const SESSION_COOKIE = 'merge_session';
const FLOW_COOKIE = 'merge_flow';
export const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'Vary': 'Cookie', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };

export function configuration(): AuthConfig | null {
  const {APP_ORIGIN,GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET,AUTH_SECRET}=process.env;
  if (!APP_ORIGIN || !GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !AUTH_SECRET || AUTH_SECRET.length < 32) return null;
  let url: URL;
  try {url = new URL(APP_ORIGIN);} catch {return null;}
  if (!['http:','https:'].includes(url.protocol) || (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
  // Public product: legacy AUTH_ALLOWED_GITHUB_ID is intentionally ignored.
  return {origin:url.origin,clientId:GITHUB_CLIENT_ID,clientSecret:GITHUB_CLIENT_SECRET,secret:AUTH_SECRET};
}
export function installationUrl(): string | undefined {
  const slug=process.env.GITHUB_APP_SLUG;
  return slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length <= 100 ? `https://github.com/apps/${slug}/installations/new` : undefined;
}
export function cookieValue(request: Request, name: string) {
  return (request.headers.get('Cookie')??'').split(';').map(p=>p.trim()).find(p=>p.startsWith(`${name}=`))?.slice(name.length+1);
}
function encode(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function decode(value: string) { const raw=atob(value.replaceAll('-','+').replaceAll('_','/')); return Uint8Array.from(raw,c=>c.charCodeAt(0)); }
async function key(secret: string) { return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret)),{name:'AES-GCM'},false,['encrypt','decrypt']); }
export async function seal(value: unknown, secret: string): Promise<string> {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret),new TextEncoder().encode(JSON.stringify(value)));
  return `${encode(iv)}.${encode(new Uint8Array(bytes))}`;
}
export async function unseal<T>(value: string, secret: string): Promise<T | null> {
  try { const [iv,data]=value.split('.'); const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(iv)},await key(secret),decode(data)); return JSON.parse(new TextDecoder().decode(plain)); } catch {return null;}
}
function cookie(name: string, value: string, age: number, origin: string) {
  return `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${age}${origin.startsWith('https:')?'; Secure':''}`;
}
export function json(value: unknown, status=200) { return Response.json(value,{status,headers:PRIVATE_HEADERS}); }
function authOriginDecision(request:Request,config:AuthConfig,kind:'login'|'callback') {
  const decision=canonicalOriginDecision(request,{origin:config.origin,aliases:process.env.APP_ORIGIN_ALIASES},kind);
  return decision??(new URL(request.url).origin===config.origin?null:json({error:'Sign-in must start on the configured application origin.'},403));
}
export async function session(request: Request): Promise<Session|null> {
  const config=configuration(); if(!config) return null;
  const value=cookieValue(request,SESSION_COOKIE); if(!value) return null;
  const data=await unseal<Session>(value,config.secret);
  return data && typeof data.token==='string' && data.token.length>0 && data.token.length<=2048 && typeof data.login==='string' && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(data.login) && typeof data.userId==='string' && /^[1-9][0-9]*$/.test(data.userId) && Number.isFinite(data.expires) && data.expires>Date.now() && data.expires<=Date.now()+28800000 ? data:null;
}
export async function revalidateIdentity(data:Session):Promise<{id:number;login:string}> {
  const user=await github<{id:number;login:string}>(data.token,'/user');
  if(!Number.isSafeInteger(user.id) || user.id<=0 || String(user.id)!==data.userId || typeof user.login!=='string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(user.login)) throw new AuthenticationError('GitHub identity changed. Sign in again.');
  return user;
}
export async function github<T>(token: string, path: string): Promise<T> {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid GitHub path');
  const response=await fetch(`https://api.github.com${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'merge.foo'},cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(response.status===401)throw new AuthenticationError('GitHub session expired. Sign in again.');
  if (!response.ok) throw new Error(response.status===403?'GitHub permission or rate limit prevents this request.':`GitHub read failed (${response.status}).`);
  return response.json() as Promise<T>;
}
export async function beginLogin(request?:Request) {
  const config=configuration(); if(!config) return json({error:'GitHub sign-in is unavailable. The service operator needs to finish configuration.'},503);
  if(request){const decision=authOriginDecision(request,config,'login');if(decision)return decision;}
  const state=encode(crypto.getRandomValues(new Uint8Array(32)));
  const verifier=encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=encode(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  const url=new URL('https://github.com/login/oauth/authorize');
  for(const [k,v] of Object.entries({client_id:config.clientId,redirect_uri:`${config.origin}/api/auth/callback`,state,code_challenge:challenge,code_challenge_method:'S256'})) url.searchParams.set(k,v);
  // No OAuth repo scope, no offline_access, and no refresh token retained.
  return new Response(null,{status:302,headers:{...PRIVATE_HEADERS,Location:url.toString(),'Set-Cookie':cookie(FLOW_COOKIE,await seal({state,verifier,expires:Date.now()+600000},config.secret),600,config.origin)}});
}
export async function finishLogin(request: Request) {
  const config=configuration(); if(!config) return json({error:'Authentication is not configured.'},503);
  const decision=authOriginDecision(request,config,'callback');if(decision)return decision;
  const url=new URL(request.url);
  const flow=await unseal<{state:string;verifier:string;expires:number}>(cookieValue(request,FLOW_COOKIE)??'',config.secret);
  if(!flow || !Number.isFinite(flow.expires) || flow.expires<Date.now() || flow.expires>Date.now()+600000 || typeof flow.verifier!=='string' || !flow.verifier || !url.searchParams.get('state') || flow.state!==url.searchParams.get('state') || !url.searchParams.get('code')) return json({error:'Authorization expired or state did not match. Start sign-in again.'},400);
  try {
    const exchange=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:config.clientId,client_secret:config.clientSecret,code:url.searchParams.get('code'),redirect_uri:`${config.origin}/api/auth/callback`,code_verifier:flow.verifier}),signal:AbortSignal.timeout(15000)});
    const result=await exchange.json() as {access_token?:string;expires_in?:number;error?:string};
    if(!exchange.ok || typeof result.access_token!=='string' || !result.access_token || result.access_token.length>2048 || result.error || (result.expires_in!==undefined && (!Number.isFinite(result.expires_in) || result.expires_in<=0))) return json({error:'GitHub could not complete authorization. Start sign-in again.'},401);
    const user=await github<{id:number;login:string}>(result.access_token,'/user');
    if(!Number.isSafeInteger(user.id) || user.id<=0 || typeof user.login!=='string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(user.login)) return json({error:'GitHub identity could not be verified. Start sign-in again.'},401);
    const age=Math.min(Math.floor(result.expires_in??28800),28800);
    if(age<1) return json({error:'GitHub authorization has expired. Start sign-in again.'},401);
    const headers=new Headers({...PRIVATE_HEADERS,Location:config.origin});
    headers.append('Set-Cookie',cookie(SESSION_COOKIE,await seal({token:result.access_token,login:user.login,userId:String(user.id),expires:Date.now()+age*1000},config.secret),age,config.origin));
    headers.append('Set-Cookie',cookie(FLOW_COOKIE,'',0,config.origin));
    return new Response(null,{status:302,headers});
  } catch {return json({error:'GitHub authorization is temporarily unavailable. Try again.'},502);}
}
export async function logout(request: Request) {
  const config=configuration();
  const origin=config?.origin??new URL(request.url).origin;
  if(request.headers.get('Origin')!==origin) return json({error:'Invalid origin'},403);
  const headers=new Headers(PRIVATE_HEADERS); headers.append('Set-Cookie',cookie(SESSION_COOKIE,'',0,origin)); headers.append('Set-Cookie',cookie(FLOW_COOKIE,'',0,origin));
  return new Response(null,{status:204,headers});
}
