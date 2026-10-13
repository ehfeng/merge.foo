import {handleWebhookReceipt} from './webhook-receipt';
import {DurableObjectStateStore,type ObjectNamespace} from './state/durable-object';
import {PostgresStateStore,neonQuery} from './state/postgres';
import type {StateStore} from './state/types';

/** Native ingress receives configuration explicitly, before framework request setup. */
export async function nativeWebhookIngress(request:Request,environment:Record<string,unknown>):Promise<Response|null> {
  if(request.method!=='POST'||new URL(request.url).pathname!=='/api/github/webhook')return null;
  const stringValue=(key:string)=>typeof environment[key]==='string'?environment[key] as string:undefined;
  return handleWebhookReceipt(request,{
    secret:stringValue('GITHUB_WEBHOOK_SECRET'),
    scopes:stringValue('WORKFLOW_REPOSITORIES'),
    getStore:async():Promise<StateStore>=>{
      const connection=stringValue('DATABASE_URL');
      const mode=stringValue('STATE_STORE')||(connection?'postgres':'durable-object');
      if(mode==='postgres') {
        if(!connection)throw new Error('External shared state is unavailable.');
        return new PostgresStateStore(await neonQuery(connection));
      }
      if(mode!=='durable-object')throw new Error('Shared state configuration is unavailable.');
      const binding=environment.PLANNED_ASSIGNMENTS as ObjectNamespace|undefined;
      if(!binding)throw new Error('Shared durable storage is unavailable.');
      return new DurableObjectStateStore(binding);
    },
  });
}
