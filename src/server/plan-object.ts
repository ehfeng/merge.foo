import type {Plan,PlanHistory,ResourceKind,StateActor,StateRecord,StateScan} from './state/types';
import {validateScan} from './state/types';
type Sql={exec<T=Record<string,unknown>>(query:string,...bindings:(string|number|null)[]):{toArray():T[]}};
type State={storage:{sql:Sql;transactionSync<T>(closure:()=>T):T}};
export class PlannedAssignments {
  private sql:Sql;
  constructor(private ctx:State) {
    this.sql=ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS plans (pr_id TEXT PRIMARY KEY, document TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS resources (kind TEXT NOT NULL, resource_key TEXT NOT NULL, version INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(kind,resource_key))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS resource_history (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, document TEXT NOT NULL)');
  }
  async fetch(request:Request):Promise<Response> {
    if(new URL(request.url).pathname==='/resources')return this.resources(request);
    if(request.method==='GET')return Response.json({plans:this.sql.exec<{document:string}>('SELECT document FROM plans ORDER BY pr_id').toArray().map(r=>JSON.parse(r.document) as Plan),history:this.sql.exec<{id:number;document:string}>('SELECT id,document FROM history ORDER BY id DESC LIMIT 100').toArray().map(r=>({...JSON.parse(r.document),id:r.id}) as PlanHistory)});
    if(request.method!=='PUT')return Response.json({error:'Method not allowed.'},{status:405});
    const incoming=await request.json() as Plan;
    // Synchronous transaction keeps the version check and history write atomic across sessions.
    return this.ctx.storage.transactionSync(()=>{
      const existing=this.sql.exec<{document:string}>('SELECT document FROM plans WHERE pr_id = ?',incoming.prId).toArray()[0];
      const current:Plan|undefined=existing?JSON.parse(existing.document):undefined;
      if(incoming.version!==(current?.version??0))return Response.json({error:'Someone changed this assignment. Refresh the repository before editing again.',plan:current},{status:409});
      const plan={...incoming,version:incoming.version+1};const document=JSON.stringify(plan);
      this.sql.exec('INSERT INTO plans (pr_id,document) VALUES (?,?) ON CONFLICT(pr_id) DO UPDATE SET document=excluded.document',plan.prId,document);
      this.sql.exec('INSERT INTO history (document) VALUES (?)',document);
      return Response.json({plan});
    });
  }
  private planRecord(plan:Plan):StateRecord<Plan> {
    return {key:plan.prId,kind:'plan',version:plan.version,value:plan,actor:{id:plan.actorId,login:plan.actor},updatedAt:plan.updatedAt};
  }
  private async resources(request:Request):Promise<Response> {
    if(request.method!=='POST')return Response.json({error:'Method not allowed.'},{status:405});
    const input=await request.json() as {operation:string;kind:ResourceKind;key:string;expectedVersion:number;value:unknown;actor:StateActor}&StateScan;
    if(!['plan','workflow','inbox','job'].includes(input.kind))return Response.json({error:'Invalid resource kind.'},{status:400});
    if(input.operation==='scan') {
      try{validateScan(input);}catch{return Response.json({error:'Invalid bounded state scan.'},{status:400});}
      const after=input.after??'';
      const rows=input.kind==='plan'
        ?this.sql.exec<{document:string}>('SELECT document FROM plans WHERE pr_id > ? ORDER BY pr_id LIMIT ?',after,input.limit).toArray().map(row=>this.planRecord(JSON.parse(row.document)))
        :this.sql.exec<{document:string}>('SELECT document FROM resources WHERE kind = ? AND resource_key > ? ORDER BY resource_key LIMIT ?',input.kind,after,input.limit).toArray().map(row=>JSON.parse(row.document));
      return Response.json(rows);
    }
    if(input.kind==='plan') {
      if(input.operation==='read') {
        const row=this.sql.exec<{document:string}>('SELECT document FROM plans WHERE pr_id = ?',input.key).toArray()[0];
        return Response.json(row?this.planRecord(JSON.parse(row.document)):null);
      }
      if(input.operation==='list')return Response.json({records:this.sql.exec<{document:string}>('SELECT document FROM plans ORDER BY pr_id').toArray().map(r=>this.planRecord(JSON.parse(r.document))),history:this.sql.exec<{id:number;document:string}>('SELECT id,document FROM history ORDER BY id DESC LIMIT 100').toArray().map(r=>({...this.planRecord(JSON.parse(r.document)),id:String(r.id)}))});
      if(input.operation==='cas') {
        const value=input.value as Plan;
        const response=await this.fetch(new Request('https://plans.internal/',{method:'PUT',body:JSON.stringify({...value,prId:input.key,version:input.expectedVersion,actor:input.actor.login,actorId:input.actor.id})}));
        if(response.status===409)return Response.json(null);
        const result=await response.json() as {plan:Plan};return Response.json(this.planRecord(result.plan));
      }
    } else {
      if(input.operation==='read') {
        const row=this.sql.exec<{document:string}>('SELECT document FROM resources WHERE kind = ? AND resource_key = ?',input.kind,input.key).toArray()[0];
        return Response.json(row?JSON.parse(row.document):null);
      }
      if(input.operation==='list')return Response.json({records:this.sql.exec<{document:string}>('SELECT document FROM resources WHERE kind = ? ORDER BY resource_key',input.kind).toArray().map(r=>JSON.parse(r.document)),history:this.sql.exec<{id:number;document:string}>('SELECT id,document FROM resource_history WHERE kind = ? ORDER BY id DESC LIMIT 100',input.kind).toArray().map(r=>({...JSON.parse(r.document),id:String(r.id)}))});
      if(input.operation==='cas')return this.ctx.storage.transactionSync(()=>{
        const current=this.sql.exec<{version:number}>('SELECT version FROM resources WHERE kind = ? AND resource_key = ?',input.kind,input.key).toArray()[0];
        if(input.expectedVersion!==(current?.version??0))return Response.json(null);
        const row:StateRecord={key:input.key,kind:input.kind,version:input.expectedVersion+1,value:input.value,actor:input.actor,updatedAt:new Date().toISOString()};
        const document=JSON.stringify(row);
        this.sql.exec('INSERT INTO resources(kind,resource_key,version,document) VALUES (?,?,?,?) ON CONFLICT(kind,resource_key) DO UPDATE SET version=excluded.version,document=excluded.document',input.kind,input.key,row.version,document);
        this.sql.exec('INSERT INTO resource_history(kind,document) VALUES (?,?)',input.kind,document);
        return Response.json(row);
      });
    }
    return Response.json({error:'Invalid storage operation.'},{status:400});
  }
}
