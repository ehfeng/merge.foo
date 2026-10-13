import type {Repo} from './github';
import type {StateActor,StateRecord,StateStore} from './state/types';
import {AUTOMATION_REGISTRY_SCOPE} from './state/types';

type Cursor={after:string};
const schedulerActor={id:'scheduler',login:'merge.foo scheduler'};
const CURSOR_KEY='scheduler-cursor';
const ATTEMPTS=8;
/** Discovery metadata is not an authorization grant. GitHub permissions are rechecked before effects. */
function repository(value:unknown):Repo {
  if(!value||typeof value!=='object')throw new Error('Invalid registered automation repository.');
  const repo=value as Record<string,unknown>;
  if(!Number.isSafeInteger(repo.id)||Number(repo.id)<=0||!Number.isSafeInteger(repo.installationId)||Number(repo.installationId)<=0||typeof repo.full_name!=='string'||! /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(repo.full_name)||typeof repo.private!=='boolean')throw new Error('Invalid registered automation repository.');
  return {id:Number(repo.id),installationId:Number(repo.installationId),full_name:repo.full_name,private:repo.private};
}
function repositoryKey(repo:Repo){return `repository:${repo.installationId}:${repo.id}`;}
function savedRepository(record:StateRecord<Repo>):Repo {
  const repo=repository(record.value);
  if(record.kind!=='job'||record.key!==repositoryKey(repo))throw new Error('Invalid registered automation repository identity.');
  return repo;
}
/** Call only after validating an authorized feature enrollment. Discovery may precede workflow CAS; runners still require the persisted feature opt-in. */
export async function registerAutomationRepository(store:StateStore,input:Repo,actor:StateActor):Promise<Repo> {
  const repo=repository(input);const key=repositoryKey(repo);
  for(let attempt=0;attempt<ATTEMPTS;attempt++){
    const previous=await store.read<Repo>(AUTOMATION_REGISTRY_SCOPE,'job',key);
    if(previous){
      const current=savedRepository(previous);
      if(current.full_name===repo.full_name&&current.private===repo.private)return current;
    }
    const saved=await store.compareAndSwap(AUTOMATION_REGISTRY_SCOPE,'job',key,previous?.version??0,repo,actor);
    if(saved)return savedRepository(saved);
  }
  throw new Error('Repository automation registration changed concurrently. Retry the feature update.');
}
/** Stable GitHub IDs identify membership; callers cannot replace the saved repository name or visibility. */
export async function findAutomationRepository(store:StateStore,input:Repo):Promise<Repo|null> {
  const repo=repository(input);const current=await store.read<Repo>(AUTOMATION_REGISTRY_SCOPE,'job',repositoryKey(repo));
  return current?savedRepository(current):null;
}
/** One fair repository per wakeup; scans and cursor contention are bounded regardless of registry size. */
export async function claimNextAutomationRepository(store:StateStore):Promise<{repo:Repo|null}> {
  for(let attempt=0;attempt<ATTEMPTS;attempt++){
    const current=await store.read<Cursor>(AUTOMATION_REGISTRY_SCOPE,'workflow',CURSOR_KEY);
    const after=current?.value?.after;
    if(after!==undefined&&(typeof after!=='string'||! /^repository:[1-9][0-9]*:[1-9][0-9]*$/.test(after)||after.length>200))throw new Error('Invalid automation scheduler cursor.');
    let next=(await store.scan<Repo>(AUTOMATION_REGISTRY_SCOPE,'job',{...(after?{after}:{}),limit:1}))[0];
    if(!next&&after)next=(await store.scan<Repo>(AUTOMATION_REGISTRY_SCOPE,'job',{limit:1}))[0];
    if(!next)return {repo:null};
    const repo=savedRepository(next);
    if(await store.compareAndSwap(AUTOMATION_REGISTRY_SCOPE,'workflow',CURSOR_KEY,current?.version??0,{after:next.key},schedulerActor))return {repo};
  }
  throw new Error('Another scheduler is selecting the next repository. Retry on the next wakeup.');
}
