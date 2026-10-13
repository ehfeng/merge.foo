import {env} from 'cloudflare:workers';
import type {StateStore} from './types';
import {DurableObjectStateStore,type ObjectNamespace} from './durable-object';
export async function durableObjectStore():Promise<StateStore> {
  const binding=env.PLANNED_ASSIGNMENTS as ObjectNamespace|undefined;
  if(!binding)throw new Error('Shared assignment storage is unavailable. Please contact the operator.');
  return new DurableObjectStateStore(binding);
}
