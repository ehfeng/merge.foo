// Provider-neutral long-running Node entry with an optional durable-work wakeup sidecar.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const wakeupSecret=process.env.CRON_SECRET||process.env.WORKFLOW_RECONCILE_SECRET;
const wakeupConfigured=!!process.env.APP_ORIGIN&&typeof wakeupSecret==='string'&&wakeupSecret.length>=32;
const children=[];let stopping=false;let forced;
function stop(code=0){
  if(stopping)return;stopping=true;process.exitCode=code;
  for(const child of children)child.kill('SIGTERM');
  forced=setTimeout(()=>{for(const child of children)child.kill('SIGKILL');},5000);forced.unref();
}
function run(path,args=[]){
  const child=spawn(process.execPath,[path,...args],{cwd:root,env:process.env,stdio:'inherit'});children.push(child);
  child.on('error',()=>stop(1));child.on('exit',code=>{if(!stopping)stop(code||1);});return child;
}
run('.output/server/index.mjs');
if(wakeupConfigured)run('scripts/reconcile_workflows.mjs',['--watch']);
else if(process.env.GITHUB_WORKFLOW_WRITES_ENABLED==='true'){stop(1);throw new Error('Review automation requires APP_ORIGIN and a strong runner secret for scheduled wakeups.');}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
