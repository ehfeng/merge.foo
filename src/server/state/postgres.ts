import type {ResourceKind,ScopeSnapshot,StateActor,StateRecord,StateStore} from './types';
import {validateScope,validateWrite} from './types';
export type SqlQuery=(text:string,parameters:unknown[])=>Promise<Record<string,unknown>[]>;
type Row={resource_key:string;kind:ResourceKind;version:number;document:unknown;actor_id:string;actor_login:string;updated_at:string|Date;id?:number|string};
function record<T>(row:Row):StateRecord<T> {
  return {key:row.resource_key,kind:row.kind,version:Number(row.version),value:row.document as T,actor:{id:row.actor_id,login:row.actor_login},updatedAt:new Date(row.updated_at).toISOString()};
}
export class PostgresStateStore implements StateStore {
  constructor(private query:SqlQuery) {}
  async read<T>(scope:string,kind:ResourceKind,key:string):Promise<StateRecord<T>|null> {
    validateScope(scope);
    const rows=await this.query('SELECT * FROM merge_state WHERE scope=$1 AND kind=$2 AND resource_key=$3',[scope,kind,key]);
    return rows[0]?record<T>(rows[0] as Row):null;
  }
  async list<T>(scope:string,kind:ResourceKind):Promise<ScopeSnapshot<T>> {
    validateScope(scope);
    const [snapshot]=await this.query(`SELECT
      COALESCE((SELECT jsonb_agg(r) FROM (SELECT * FROM merge_state WHERE scope=$1 AND kind=$2 ORDER BY resource_key) r),'[]'::jsonb) AS records,
      COALESCE((SELECT jsonb_agg(h) FROM (SELECT * FROM merge_state_audit WHERE scope=$1 AND kind=$2 ORDER BY id DESC LIMIT 100) h),'[]'::jsonb) AS history`,[scope,kind]);
    const rows=snapshot.records as Row[];const history=snapshot.history as (Row&{id:string})[];
    return {records:rows.map(r=>record<T>(r as Row)),history:history.map(r=>({...record<T>(r as Row),id:String(r.id)}))};
  }
  async compareAndSwap<T>(scope:string,kind:ResourceKind,key:string,expectedVersion:number,value:T,actor:StateActor):Promise<StateRecord<T>|null> {
    validateWrite(scope,key,expectedVersion,value);
    // One statement/transaction: a stale writer cannot write the value or append audit history.
    const rows=await this.query(`WITH updated AS (
      UPDATE merge_state SET version=version+1,document=$5::jsonb,actor_id=$6,actor_login=$7,updated_at=clock_timestamp()
      WHERE scope=$1 AND kind=$2 AND resource_key=$3 AND version=$4 AND $4>0 RETURNING *
    ), inserted AS (
      INSERT INTO merge_state(scope,kind,resource_key,version,document,actor_id,actor_login)
      SELECT $1,$2,$3,1,$5::jsonb,$6,$7 WHERE $4=0 ON CONFLICT(scope,kind,resource_key) DO NOTHING RETURNING *
    ), saved AS (SELECT * FROM updated UNION ALL SELECT * FROM inserted), audit AS (
      INSERT INTO merge_state_audit(scope,kind,resource_key,version,document,actor_id,actor_login,updated_at)
      SELECT scope,kind,resource_key,version,document,actor_id,actor_login,updated_at FROM saved RETURNING id
    ) SELECT saved.* FROM saved CROSS JOIN audit`,[scope,kind,key,expectedVersion,JSON.stringify(value),actor.id,actor.login]);
    return rows[0]?record<T>(rows[0] as Row):null;
  }
}
export async function neonQuery(connectionString:string):Promise<SqlQuery> {
  let url:URL;try{url=new URL(connectionString);}catch{throw new Error('A valid external PostgreSQL DATABASE_URL is required.');}
  if(!['postgres:','postgresql:'].includes(url.protocol)||!url.hostname||!url.username||!url.pathname.slice(1))throw new Error('A valid external PostgreSQL DATABASE_URL is required.');
  const {neon}=await import('@neondatabase/serverless');
  let sql:ReturnType<typeof neon>;
  try{sql=neon(connectionString);}catch{throw new Error('The external PostgreSQL configuration is invalid.');}
  return async(text,parameters)=>{
    try{return await sql.query(text,parameters,{fetchOptions:{signal:AbortSignal.timeout(15000)}}) as Record<string,unknown>[];}
    catch{throw new Error('Shared PostgreSQL storage is unavailable. The operator should check database configuration.');}
  };
}
