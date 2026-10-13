/** Provider-neutral shared state. Authorization belongs to the caller, above this boundary. */
export type ResourceKind='plan'|'workflow'|'inbox'|'job';
export type StateActor={id:string;login:string};
export type StateRecord<T=unknown>={key:string;kind:ResourceKind;version:number;value:T;actor:StateActor;updatedAt:string};
export type StateAudit<T=unknown>=StateRecord<T>&{id:string};
export type ScopeSnapshot<T=unknown>={records:StateRecord<T>[];history:StateAudit<T>[]};
export interface StateStore {
  read<T>(scope:string,kind:ResourceKind,key:string):Promise<StateRecord<T>|null>;
  list<T>(scope:string,kind:ResourceKind):Promise<ScopeSnapshot<T>>;
  /** The expected-version decision, value replacement and audit append are atomic. */
  compareAndSwap<T>(scope:string,kind:ResourceKind,key:string,expectedVersion:number,value:T,actor:StateActor):Promise<StateRecord<T>|null>;
}
export type Plan={prId:string;reviewerIds:string[];reviewerIdentities?:{id:string;login:string}[];version:number;actor:string;actorId:string;updatedAt:string};
export type PlanHistory=Plan&{id:string|number};
export type PlansSnapshot={plans:Plan[];history:PlanHistory[]};
export function validateScope(scope:string) {
  if(!/^[1-9][0-9]*:[1-9][0-9]*$/.test(scope))throw new Error('Invalid installation/repository state scope.');
}
export function validateWrite(scope:string,key:string,version:number,value:unknown) {
  validateScope(scope);
  if(!key||key.length>200||!Number.isSafeInteger(version)||version<0)throw new Error('Invalid state key or version.');
  if(new TextEncoder().encode(JSON.stringify(value)).length>1500000)throw new Error('Repository state exceeds the safe storage bound.');
}
