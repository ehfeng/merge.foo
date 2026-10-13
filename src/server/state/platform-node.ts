import type {StateStore} from './types';
export async function durableObjectStore():Promise<StateStore> {
  throw new Error('Durable Object storage requires the Cloudflare build. Configure external PostgreSQL on this host.');
}
