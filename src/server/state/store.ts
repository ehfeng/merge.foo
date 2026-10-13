import {durableObjectStore} from '@mergefoo/platform-store';
import {PostgresStateStore,neonQuery} from './postgres';
import type {StateStore} from './types';
/** No process-local authoritative state. Both hosts use the same external database when configured. */
export async function getStateStore():Promise<StateStore> {
  const mode=process.env.STATE_STORE||(process.env.DATABASE_URL?'postgres':'durable-object');
  if(mode==='postgres') {
    const connection=process.env.DATABASE_URL;
    if(!connection)throw new Error('External PostgreSQL DATABASE_URL is required for shared state.');
    return new PostgresStateStore(await neonQuery(connection));
  }
  if(mode==='durable-object')return durableObjectStore();
  throw new Error('Unsupported STATE_STORE. Choose postgres or durable-object.');
}
