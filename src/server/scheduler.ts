/** Thin wakeup only: durable scopes, claims and retries remain in the shared state service. */
export async function scheduledReconciliation(invoke:(request:Request)=>Promise<Response>,values:Record<string,unknown>=process.env):Promise<void> {
  const origin=values.APP_ORIGIN;const secret=values.CRON_SECRET||values.WORKFLOW_RECONCILE_SECRET;
  if(typeof origin!=='string'||typeof secret!=='string'||secret.length<32)return;
  let url:URL;try{url=new URL(origin);}catch{throw new Error('Scheduled APP_ORIGIN is invalid.');}
  if(!['http:','https:'].includes(url.protocol)||url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Scheduled APP_ORIGIN must be an exact HTTPS or localhost origin.');
  const response=await invoke(new Request(`${url.origin}/api/internal/reconcile`,{headers:{Authorization:`Bearer ${secret}`}}));
  if(!response.ok)throw new Error(`Scheduled reconciliation failed (${response.status}); durable work remains queued.`);
}
