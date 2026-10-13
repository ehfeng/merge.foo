// Run once from any scheduler, or with --watch beside a long-running Node server.
// Tokens belong in the process environment; this script never prints them.
const origin=process.env.APP_ORIGIN;
const secret=process.env.CRON_SECRET||process.env.WORKFLOW_RECONCILE_SECRET;
if(!origin||!secret||secret.length<32)throw new Error('APP_ORIGIN and a strong WORKFLOW_RECONCILE_SECRET are required.');
const url=new URL(origin);
if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw new Error('APP_ORIGIN must be an exact HTTPS origin or local loopback origin.');
async function tick(){
  try{
    const response=await fetch(`${url.origin}/api/internal/reconcile`,{headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(55000)});
    if(!response.ok){console.error(`Reconciliation HTTP ${response.status}; persisted work will retry on the next wakeup.`);return true;}
    const result=await response.json();const executed=(result.results??[]).reduce((count,item)=>count+(Number.isSafeInteger(item.executed)?item.executed:0),0);
    if(executed)console.log(`${executed} GitHub step(s) confirmed.`);return false;
  }catch{console.error('Reconciliation unavailable; persisted work will retry on the next wakeup.');return true;}
}
if(process.argv.includes('--watch')){while(true){await tick();await new Promise(resolve=>setTimeout(resolve,30000));}}
else if(await tick())process.exitCode=1;
