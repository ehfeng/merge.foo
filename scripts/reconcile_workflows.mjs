// Run once from any scheduler, or with --watch beside a long-running Node server.
// Tokens belong in the process environment; this script never prints them.
const origin=process.env.APP_ORIGIN;
const secret=process.env.WORKFLOW_RECONCILE_SECRET;
if(!origin||!secret||secret.length<32)throw new Error('APP_ORIGIN and a strong WORKFLOW_RECONCILE_SECRET are required.');
const url=new URL(origin);
if(url.username||url.password||url.pathname!=='/'||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname))))throw new Error('APP_ORIGIN must be an exact HTTPS origin or local loopback origin.');
let repositories;
try{repositories=JSON.parse(process.env.WORKFLOW_REPOSITORIES??'[]');}catch{throw new Error('WORKFLOW_REPOSITORIES must be a JSON array of repository scopes.');}
if(!Array.isArray(repositories)||!repositories.length||repositories.length>100||repositories.some(r=>!Number.isSafeInteger(r?.id)||r.id<=0||!Number.isSafeInteger(r?.installationId)||r.installationId<=0||typeof r?.full_name!=='string'||!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(r.full_name)))throw new Error('Provide selected repository id, installationId and full_name in WORKFLOW_REPOSITORIES.');
async function tick(){let failed=false;for(const repository of repositories){try{const response=await fetch(`${url.origin}/api/internal/reconcile`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(repository),signal:AbortSignal.timeout(55000)});if(!response.ok){failed=true;console.error(`${repository.full_name}: reconciliation HTTP ${response.status}; persisted work will retry on the next wakeup.`);}else{const result=await response.json();if(result.executed)console.log(`${repository.full_name}: ${result.executed} GitHub step(s) confirmed.`);}}catch{failed=true;console.error(`${repository.full_name}: reconciliation unavailable; persisted work will retry on the next wakeup.`);}}return failed;}
if(process.argv.includes('--watch')){while(true){await tick();await new Promise(resolve=>setTimeout(resolve,30000));}}
else if(await tick())process.exitCode=1;
