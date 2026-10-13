import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {receiveWebhook,validRunnerSecret,reconcileScheduled,backgroundRepo} from './workflow-background';
const fixture=vi.hoisted(()=>({rows:new Map<string,{version:number;value:unknown}>(),writes:vi.fn()}));
vi.mock('./state/store',()=>({getStateStore:async()=>({read:async(scope:string,kind:string,key:string)=>fixture.rows.get(`${scope}/${kind}/${key}`)??null,compareAndSwap:async(scope:string,kind:string,key:string,expected:number,value:unknown)=>{fixture.writes(scope,kind,key);const id=`${scope}/${kind}/${key}`;const previous=fixture.rows.get(id);if((previous?.version??0)!==expected)return null;const result={version:expected+1,value};fixture.rows.set(id,result);return result;}})}));
const secret='test-webhook-secret-that-is-at-least-32-characters';
beforeEach(()=>{fixture.rows.clear();fixture.writes.mockClear();vi.stubEnv('GITHUB_WEBHOOK_SECRET',secret);vi.stubEnv('WORKFLOW_REPOSITORIES','[{"id":42,"installationId":7,"full_name":"owner/repo"}]');});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function delivery(body:string){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Request('https://merge.example/api/github/webhook',{method:'POST',headers:{'X-Hub-Signature-256':'sha256='+Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(body))).toString('hex'),'X-GitHub-Event':'pull_request_review','X-GitHub-Delivery':'12345678-1234-1234-1234-123456789abc'},body});}
it('durably queues signed deliveries and ACKs without calling GitHub; duplicate delivery is idempotent',async()=>{
  const network=vi.fn(()=>{throw new Error('Webhook ACK must not call GitHub.');});vi.stubGlobal('fetch',network);
  const body=JSON.stringify({installation:{id:7},repository:{id:42,full_name:'owner/repo',private:true}});
  expect(await (await receiveWebhook(await delivery(body))).json()).toMatchObject({queued:true});
  expect(await (await receiveWebhook(await delivery(body))).json()).toMatchObject({accepted:true});
  expect(fixture.writes).toHaveBeenCalledTimes(1);expect(network).not.toHaveBeenCalled();
  expect(fixture.rows.get('7:42/inbox/webhook:12345678-1234-1234-1234-123456789abc')).toMatchObject({value:{state:'pending',repo:{id:42,installationId:7}}});
});
it('invalid signatures cannot create inbox state, including otherwise valid repository IDs',async()=>{
  expect((await receiveWebhook(new Request('https://merge.example/api/github/webhook',{method:'POST',headers:{'X-GitHub-Event':'pull_request','X-Hub-Signature-256':'sha256='+'0'.repeat(64)},body:JSON.stringify({installation:{id:7},repository:{id:42,full_name:'owner/repo'}})}))).status).toBe(401);
  expect(fixture.writes).not.toHaveBeenCalled();
});
it('signed events outside the selected pilot scope are ignored without retaining repository metadata',async()=>{
  const body=JSON.stringify({installation:{id:7},repository:{id:43,full_name:'owner/other',private:true}});
  expect(await (await receiveWebhook(await delivery(body))).json()).toMatchObject({ignored:true});expect(fixture.writes).not.toHaveBeenCalled();expect(fixture.rows.size).toBe(0);
});
it('scheduler authorization and all configured scopes are checked before any work',async()=>{
  vi.stubEnv('WORKFLOW_RECONCILE_SECRET',secret);vi.stubEnv('WORKFLOW_REPOSITORIES','[{"id":42,"installationId":7,"full_name":"owner/repo"},{"id":0,"installationId":7,"full_name":"owner/other"}]');
  expect(await validRunnerSecret(`Bearer ${secret}`)).toBe(true);expect(await validRunnerSecret('Bearer wrong')).toBe(false);
  await expect(reconcileScheduled(new Request('https://merge.example/api/internal/reconcile'))).rejects.toThrow('authorization required');
  await expect(reconcileScheduled(new Request('https://merge.example/api/internal/reconcile',{headers:{Authorization:`Bearer ${secret}`}}))).rejects.toThrow('Invalid background repository scope');
  expect(fixture.writes).not.toHaveBeenCalled();
  expect(()=>backgroundRepo({id:42,installationId:7,full_name:'https://evil.example/repo'})).toThrow();
});
