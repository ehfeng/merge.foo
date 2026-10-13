export type CanonicalOriginValues={origin?:string;aliases?:unknown};
type RedirectKind='ui'|'login'|'callback';
const headers={'Cache-Control':'private, no-store','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
function exactOrigin(value:unknown):string|null {
  if(typeof value!=='string'||/[\s%\\]/.test(value))return null;
  try {
    const url=new URL(value);
    if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||!['https:','http:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname))return null;
    return value===url.origin||value===`${url.origin}/`?url.origin:null;
  }catch{return null;}
}
function aliases(value:unknown):string[] {
  if(value===undefined||value==='')return [];
  let configured:unknown=value;
  if(typeof value==='string'){try{configured=JSON.parse(value);}catch{return [];}}
  if(!Array.isArray(configured)||configured.length>16)return [];
  const parsed=configured.map(exactOrigin);
  return parsed.some(origin=>origin===null)?[]:[...new Set(parsed as string[])];
}
/** Redirect only operator-approved aliases; never use a request host as the target. */
export function canonicalOriginDecision(request:Request,values:CanonicalOriginValues,kind:RedirectKind='ui'):Response|null {
  if(request.method!=='GET'&&request.method!=='HEAD')return null;
  const source=new URL(request.url);
  let effective=kind;
  if(kind==='ui') {
    if(source.pathname==='/api/auth/login')effective='login';
    else if(source.pathname==='/api/auth/callback')effective='callback';
    else if(/^\/api(?:\/|$)/i.test(source.pathname))return null;
  }
  const origin=exactOrigin(values.origin);
  if(!origin&&kind==='ui')return null; // The auth route retains its unavailable-configuration response.
  if(origin&&source.origin===origin)return null;
  if(!origin||!aliases(values.aliases).includes(source.origin))return effective==='ui'?null:Response.json({error:'Sign-in must start on the configured application origin.'},{status:403,headers});
  const target=new URL(origin);
  if(effective==='login'||effective==='callback')target.pathname='/api/auth/login';
  else {target.pathname=source.pathname;target.search=source.search;}
  return new Response(null,{status:307,headers:{...headers,Location:target.toString()}});
}
