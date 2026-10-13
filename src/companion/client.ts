export type CompanionPairing={capability:string;port:number};
const STORAGE_KEY='merge.foo.companion.v1';
const CAPABILITY=/^[A-Za-z0-9_-]{43}$/;
const ENDPOINTS=new Set(['/api/session','/api/github/repositories','/api/github/workspace','/api/github/reviewers','/api/github/plans','/api/github/workflow','/api/auth/logout']);

function validPairing(value:unknown):value is CompanionPairing {
  if(!value||typeof value!=='object')return false;
  const pairing=value as CompanionPairing;
  return typeof pairing.capability==='string'&&CAPABILITY.test(pairing.capability)&&Number.isInteger(pairing.port)&&pairing.port>=1024&&pairing.port<=65535;
}

export function parseCompanionUrl(value:string):CompanionPairing|null {
  try {
    const url=new URL(value);const fragment=new URLSearchParams(url.hash.slice(1));
    if(fragment.getAll('companion').length!==1||fragment.getAll('port').length>1)return null;
    const port=fragment.get('port')??'4318';if(!/^\d{4,5}$/.test(port))return null;
    const pairing={capability:fragment.get('companion')??'',port:Number(port)};
    return validPairing(pairing)?pairing:null;
  }catch{return null;}
}

// Remove the capability before any navigation or external links can expose it.
export function consumeCompanionFragment():CompanionPairing|null {
  if(typeof window==='undefined')return null;
  const fragment=new URLSearchParams(location.hash.slice(1));if(!fragment.has('companion'))return null;
  const pairing=parseCompanionUrl(location.href);
  history.replaceState(history.state,'',location.pathname+location.search);
  return pairing;
}

export function readCompanionPairing():CompanionPairing|null {
  try{const value:unknown=JSON.parse(sessionStorage.getItem(STORAGE_KEY)??'null');return validPairing(value)?value:null;}catch{return null;}
}
export function saveCompanionPairing(pairing:CompanionPairing|null):void {
  try{if(pairing)sessionStorage.setItem(STORAGE_KEY,JSON.stringify(pairing));else sessionStorage.removeItem(STORAGE_KEY);}catch{/* Pairing still works for this visit when storage is unavailable. */}
}

export async function connectionFetch(pairing:CompanionPairing|null,path:string,init:RequestInit={}):Promise<Response> {
  if(!pairing)return fetch(path,init);
  const endpoint=new URL(path,'https://merge.foo');
  if(endpoint.origin!=='https://merge.foo'||!ENDPOINTS.has(endpoint.pathname)||endpoint.hash)throw new Error('This request is not supported by the local GitHub CLI companion.');
  const headers=new Headers(init.headers);headers.set('Authorization',`Bearer ${pairing.capability}`);
  // Large private repositories need several bounded GitHub queries to produce a complete map.
  const deadline=AbortSignal.timeout(endpoint.pathname==='/api/github/workspace'||endpoint.pathname==='/api/github/workflow'?120000:30000);
  const options:RequestInit&{targetAddressSpace:'loopback'}={...init,headers,credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback',signal:init.signal?AbortSignal.any([init.signal,deadline]):deadline};
  try{return await fetch(`http://127.0.0.1:${pairing.port}${endpoint.pathname}${endpoint.search}`,options);}
  catch(error){if(init.signal?.aborted)throw error;throw new Error('Could not reach your local GitHub CLI companion. Keep its terminal running and allow local-network access in your browser, then retry. If you restarted it, paste its new pairing URL.');}
}
