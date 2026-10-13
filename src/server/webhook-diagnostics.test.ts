import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {POST} from '../../app/api/internal/webhook-diagnostics/route';
const fixture=vi.hoisted(()=>({read:vi.fn(),list:vi.fn(),compareAndSwap:vi.fn(),getStore:vi.fn()}));
vi.mock('./state/store',()=>({getStateStore:fixture.getStore}));
const secret='webhook-diagnostics-fixture-secret-over-32-characters';
const repo={id:42,installationId:7,full_name:'fixture/repo',private:true};
const first='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const second='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const registration={key:'repository:7:42',kind:'job',version:1,updatedAt:'2026-10-12T12:00:00Z',value:repo};
function request(body:unknown={repository:repo,deliveries:[first]},authorization:string|null=`Bearer ${secret}`){
  return new Request('https://fixture.invalid/api/internal/webhook-diagnostics',{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify(body)});
}
beforeEach(()=>{
  vi.clearAllMocks();fixture.read.mockReset().mockImplementation(async(scope,kind,key)=>scope==='automation-registry'&&kind==='job'&&key===registration.key?registration:null);fixture.getStore.mockReset().mockResolvedValue(fixture);
  vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','false');vi.stubEnv('WORKFLOW_RECONCILE_SECRET',secret);vi.stubEnv('WORKFLOW_REPOSITORIES',JSON.stringify([repo]));vi.stubGlobal('fetch',vi.fn());
});
afterEach(()=>{
  expect(fixture.list).not.toHaveBeenCalled();expect(fixture.compareAndSwap).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllEnvs();vi.unstubAllGlobals();
});
describe('operator webhook receipt diagnostics',()=>{
  it('reads only requested scoped inbox keys and returns a safe projection',async()=>{
    fixture.read.mockResolvedValueOnce(registration).mockResolvedValueOnce({key:`webhook:${first}`,kind:'inbox',version:3,updatedAt:'2026-10-12T12:01:00Z',actor:{id:'private-person',login:'private-login'},value:{repo,event:'pull_request',delivery:first,receivedAt:'2026-10-12T12:00:00Z',state:'pending',lease:{id:'private-lease'},payload:'private-payload'}}).mockResolvedValueOnce(null);
    const response=await POST(request({repository:repo,deliveries:[first,second]}));
    expect(response.status).toBe(200);expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({writesEnabled:false,receipts:[{delivery:first,persisted:true,receivedAt:'2026-10-12T12:00:00.000Z',updatedAt:'2026-10-12T12:01:00.000Z',state:'pending',version:3},{delivery:second,persisted:false,receivedAt:null,updatedAt:null,state:null,version:null}]});
    expect(fixture.read.mock.calls).toEqual([['automation-registry','job','repository:7:42'],['7:42','inbox',`webhook:${first}`],['7:42','inbox',`webhook:${second}`]]);
  });
  it.each([null,'Bearer wrong','Basic wrong'])('rejects invalid authorization before body/storage access: %s',async authorization=>{
    const response=await POST(request({},authorization));expect(response.status).toBe(401);expect(fixture.getStore).not.toHaveBeenCalled();
  });
  it('requires a configured operator secret',async()=>{
    vi.stubEnv('WORKFLOW_RECONCILE_SECRET','');expect((await POST(request())).status).toBe(401);expect(fixture.getStore).not.toHaveBeenCalled();
  });
  it.each([{id:43},{installationId:8},{full_name:'fixture/other'}])('rejects scope mismatch before storage access: %s',async change=>{
    expect((await POST(request({repository:{...repo,...change},deliveries:[first]}))).status).toBe(403);expect(fixture.read.mock.calls.every(([,kind])=>kind==='job')).toBe(true);
  });
  it.each(['[]','invalid','{}'])('does not use the legacy operator list to gate a registered repository: %s',async scopes=>{
    vi.stubEnv('WORKFLOW_REPOSITORIES',scopes);expect((await POST(request())).status).toBe(200);
  });
  it('rejects an unregistered repository even when the legacy list includes it',async()=>{fixture.read.mockResolvedValue(null);expect((await POST(request())).status).toBe(403);expect(fixture.read).toHaveBeenCalledTimes(1);});
  it.each([[],[first,first],['webhook:arbitrary-key'],[first+'\n'],Array.from({length:21},(_,i)=>`${i.toString(16).padStart(8,'0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`)])('rejects invalid delivery lists before storage access: %s',async deliveries=>{
    expect((await POST(request({repository:repo,deliveries}))).status).toBe(400);expect(fixture.getStore).not.toHaveBeenCalled();
  });
  it.each([['true',true],['false',false],['TRUE',false],['',false]])('reports only the exact configured write-enabled flag: %s',async(value,enabled)=>{
    vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED',value);const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toHaveProperty('writesEnabled',enabled);
  });
  it('normalizes uppercase UUIDs to their stored delivery key',async()=>{
    expect((await POST(request({repository:repo,deliveries:[first.toUpperCase()]}))).status).toBe(200);expect(fixture.read).toHaveBeenCalledWith('7:42','inbox',`webhook:${first}`);
  });
  it('rejects repeated UUIDs with different casing',async()=>{
    expect((await POST(request({repository:repo,deliveries:[first,first.toUpperCase()]}))).status).toBe(400);expect(fixture.getStore).not.toHaveBeenCalled();
  });
  it('bounds the maximum read count to twenty',async()=>{
    const deliveries=Array.from({length:20},(_,i)=>`${i.toString(16).padStart(8,'0')}-aaaa-aaaa-aaaa-aaaaaaaaaaaa`);
    expect((await POST(request({repository:repo,deliveries}))).status).toBe(200);expect(fixture.read.mock.calls.filter(([,kind])=>kind==='inbox')).toHaveLength(20);
  });
  it.each([null,[],{}, {repository:{...repo,id:0},deliveries:[first]}])('rejects malformed requests: %s',async body=>{
    expect((await POST(request(body))).status).toBe(400);expect(fixture.getStore).not.toHaveBeenCalled();
  });
  it('rejects invalid JSON',async()=>{
    const input=request();const response=await POST(new Request(input.url,{method:'POST',headers:input.headers,body:'{'}));expect(response.status).toBe(400);expect(fixture.getStore).not.toHaveBeenCalled();
  });
  it('rejects oversized streamed bodies before storage access',async()=>{
    const input=request();const body=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('x'.repeat(4001)));controller.close();}});
    const response=await POST(new Request(input.url,{method:'POST',headers:input.headers,body,duplex:'half'} as RequestInit));expect(response.status).toBe(413);expect(fixture.getStore).not.toHaveBeenCalled();
  });
  it('does not expose raw error details on storage failure',async()=>{
    fixture.read.mockRejectedValue(new Error('private connection credential'));const response=await POST(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'Webhook receipt diagnostics unavailable.'});
  });
  it('normalizes unsupported stored metadata to null rather than exposing it',async()=>{
    fixture.read.mockResolvedValueOnce(registration).mockResolvedValue({version:'private-secret',updatedAt:'private-secret',value:{receivedAt:'private-secret',state:'private-secret'}});
    expect(await (await POST(request())).json()).toEqual({writesEnabled:false,receipts:[{delivery:first,persisted:true,receivedAt:null,updatedAt:null,state:null,version:null}]});
  });
});
