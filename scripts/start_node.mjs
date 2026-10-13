// Provider-neutral long-running Node entry with an optional durable-work wakeup sidecar.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
let scopes;try{scopes=JSON.parse(process.env.WORKFLOW_REPOSITORIES??'[]');}catch{throw new Error('WORKFLOW_REPOSITORIES must be a JSON array.');}
if(!Array.isArray(scopes))throw new Error('WORKFLOW_REPOSITORIES must be a JSON array.');
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
if(scopes.length) {
  if(!process.env.WORKFLOW_RECONCILE_SECRET||process.env.WORKFLOW_RECONCILE_SECRET.length<32){stop(1);throw new Error('Configured workflow scopes require WORKFLOW_RECONCILE_SECRET for their wakeup runner.');}
  run('scripts/reconcile_workflows.mjs',['--watch']);
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
