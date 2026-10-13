import {afterEach,it,expect,vi} from 'vitest';
import {nativeWebhookIngress} from './webhook-native';
const postgres=vi.hoisted(()=>({query:vi.fn(async()=>{throw new Error('Fixture database is intentionally unavailable.');})}));
vi.mock('./state/postgres',()=>({neonQuery:postgres.query,PostgresStateStore:class {}}));
const secret='native-webhook-fixture-secret-at-least-32-characters';
const scopes='[{"id":42,"installationId":7,"full_name":"owner/repo"}]';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.clearAllMocks();});
async function request(event='pull_request_review') {
  const body=JSON.stringify({installation:{id:7},repository:{id:42,full_name:'owner/repo',private:false}});
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('hex');
  return new Request('https://merge.example/api/github/webhook',{method:'POST',headers:{'X-Hub-Signature-256':`sha256=${signature}`,'X-GitHub-Event':event,'X-GitHub-Delivery':'12345678-1234-1234-1234-123456789abc'},body});
}
it('only intercepts the exact POST webhook endpoint',async()=>{
  expect(await nativeWebhookIngress(new Request('https://merge.example/api/github/webhook'),{})).toBeNull();
  expect(await nativeWebhookIngress(new Request('https://merge.example/api/github/webhook/',{method:'POST'}),{})).toBeNull();
  expect(await nativeWebhookIngress(new Request('https://merge.example/api/github/workspace',{method:'POST'}),{})).toBeNull();
});
it('uses explicit native configuration and persists before ACK without GitHub requests',async()=>{
  vi.stubEnv('GITHUB_WEBHOOK_SECRET','wrong-ambient-secret-that-is-at-least-32-characters');
  vi.stubEnv('WORKFLOW_REPOSITORIES','[]');vi.stubEnv('STATE_STORE','postgres');
  const network=vi.fn(()=>{throw new Error('Receipt must not call GitHub.');});vi.stubGlobal('fetch',network);
  const records=new Map<string,unknown>();const calls:string[]=[];
  const binding={idFromName:(scope:string)=>{calls.push(scope);return scope;},get:()=>({fetch:async(input:Request)=>{
    const operation=await input.json() as {operation:string;key:string;value:unknown;expectedVersion:number};
    if(operation.operation==='read'&&operation.key==='repository:7:42')return Response.json({kind:'job',key:operation.key,version:1,value:{id:42,installationId:7,full_name:'owner/repo',private:false}});
    if(operation.operation==='read')return Response.json(records.get(operation.key)??null);
    const record={key:operation.key,kind:'inbox',version:operation.expectedVersion+1,value:operation.value};records.set(operation.key,record);return Response.json(record);
  }})};
  const response=await nativeWebhookIngress(await request(),{GITHUB_WEBHOOK_SECRET:secret,WORKFLOW_REPOSITORIES:scopes,PLANNED_ASSIGNMENTS:binding});
  expect(response?.status).toBe(202);expect(response?.headers.get('Cache-Control')).toContain('no-store');
  expect(records.size).toBe(1);expect(calls).toContain('automation-registry');expect(calls.filter(scope=>scope==='7:42')).toHaveLength(2);expect(network).not.toHaveBeenCalled();expect(postgres.query).not.toHaveBeenCalled();
});
it('honors the explicit PostgreSQL selection and fails without acknowledging missing persistence',async()=>{
  const binding={idFromName:vi.fn(),get:vi.fn()};
  const response=await nativeWebhookIngress(await request(),{GITHUB_WEBHOOK_SECRET:secret,WORKFLOW_REPOSITORIES:scopes,DATABASE_URL:'postgres://fixture@database.example/fixture',PLANNED_ASSIGNMENTS:binding});
  expect(response?.status).toBe(503);expect(postgres.query).toHaveBeenCalledWith('postgres://fixture@database.example/fixture');expect(binding.get).not.toHaveBeenCalled();
  const missing=await nativeWebhookIngress(await request(),{GITHUB_WEBHOOK_SECRET:secret,WORKFLOW_REPOSITORIES:scopes,STATE_STORE:'postgres',PLANNED_ASSIGNMENTS:binding});
  expect(missing?.status).toBe(503);expect(binding.get).not.toHaveBeenCalled();
});
it('ignores signed ping without requiring state and rejects missing configuration',async()=>{
  expect((await nativeWebhookIngress(await request('ping'),{GITHUB_WEBHOOK_SECRET:secret}))?.status).toBe(202);
  expect((await nativeWebhookIngress(await request('ping'),{}))?.status).toBe(503);
});

it('logs native ingress and outcome using only safe structured receipt metadata',async()=>{
  const log=vi.spyOn(console,'info').mockImplementation(()=>{});
  const input=await request('ping');expect((await nativeWebhookIngress(input,{GITHUB_WEBHOOK_SECRET:secret}))?.status).toBe(202);
  expect(log).toHaveBeenCalledTimes(2);
  const entries=log.mock.calls.map(([value])=>JSON.parse(String(value)));
  expect(entries[0]).toMatchObject({event:'github_webhook_receipt',phase:'entry',stage:'entry',delivery:'12345678-1234-1234-1234-123456789abc'});
  expect(entries[1]).toMatchObject({event:'github_webhook_receipt',phase:'outcome',stage:'complete',status:202});
  expect(JSON.stringify(entries)).not.toMatch(/native-webhook-fixture|sha256|owner\/repo|private/);
});
