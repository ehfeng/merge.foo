import type {ResourceKind,ScopeSnapshot,StateActor,StateRecord,StateStore} from './types';
import {validateScope,validateWrite} from './types';
export interface ObjectNamespace {idFromName(name:string):unknown;get(id:unknown):{fetch(request:Request):Promise<Response>}}
/** Only this optional adapter uses the provider's fetch transport. Public store contracts do not. */
export class DurableObjectStateStore implements StateStore {
  constructor(private binding:ObjectNamespace) {}
  private async call(scope:string,method:string,operation:unknown) {
    validateScope(scope);
    const response=await this.binding.get(this.binding.idFromName(scope)).fetch(new Request('https://state.internal/resources',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(operation)}));
    if(!response.ok)throw new Error('Shared durable storage is unavailable.');
    return response.json();
  }
  async read<T>(scope:string,kind:ResourceKind,key:string):Promise<StateRecord<T>|null> {return this.call(scope,'POST',{operation:'read',kind,key});}
  async list<T>(scope:string,kind:ResourceKind):Promise<ScopeSnapshot<T>> {return this.call(scope,'POST',{operation:'list',kind});}
  async compareAndSwap<T>(scope:string,kind:ResourceKind,key:string,expectedVersion:number,value:T,actor:StateActor):Promise<StateRecord<T>|null> {
    validateWrite(scope,key,expectedVersion,value);
    return this.call(scope,'POST',{operation:'cas',kind,key,expectedVersion,value,actor});
  }
}
