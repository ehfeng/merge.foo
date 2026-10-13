import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {GET as workspace} from '../../app/api/github/workspace/route';
import {PUT as plans} from '../../app/api/github/plans/route';
import {POST as workflow} from '../../app/api/github/workflow/route';
import {seal} from './auth';

const storage=vi.hoisted(()=>vi.fn(()=>{throw new Error('Storage must not run before authorization.');}));
vi.mock('./state/store',()=>({getStateStore:storage}));
const origin='https://merge.example';
const secret='live-route-fixture-secret-at-least-32-characters';
const routes=[
  {name:'workspace',handler:workspace,method:'GET',body:undefined},
  {name:'plans',handler:plans,method:'PUT',body:{repository:'fixture/repo',prId:'P1',reviewerIds:['sam'],version:0}},
  {name:'workflow',handler:workflow,method:'POST',body:{repository:'fixture/repo',version:0,command:{type:'reconcile'}}},
];
beforeEach(()=>{
  vi.stubEnv('APP_ORIGIN',origin);vi.stubEnv('GITHUB_CLIENT_ID','fixture');
  vi.stubEnv('GITHUB_CLIENT_SECRET','fixture');vi.stubEnv('AUTH_SECRET',secret);
  storage.mockClear();
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function request(route:typeof routes[number],authenticated=true){
  const headers:Record<string,string>={Origin:origin,'Content-Type':'application/json'};
  if(authenticated)headers.Cookie=`merge_session=${await seal({token:'fixture-token',login:'alice',userId:'1',expires:Date.now()+60000},secret)}`;
  return new Request(`${origin}/api/github/${route.name}?repository=fixture/repo`,{method:route.method,headers,...route.body?{body:JSON.stringify(route.body)}:undefined});
}
for(const route of routes)describe(`${route.name} live authorization`,()=>{
  it.each([401,'identity'])('returns 401 for confirmed authentication loss %s before repository or storage access',async failure=>{
    const network=vi.fn().mockResolvedValue(failure===401?new Response(null,{status:401}):Response.json({id:2,login:'different'}));vi.stubGlobal('fetch',network);
    const response=await route.handler(await request(route));
    expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual({error:failure===401?'GitHub session expired. Sign in again.':'GitHub identity changed. Sign in again.'});
    expect(network).toHaveBeenCalledTimes(1);expect(String(network.mock.calls[0][0])).toBe('https://api.github.com/user');
    expect(storage).not.toHaveBeenCalled();
  });
  it.each([403,429,500,503])('retains unknown identity on GitHub HTTP %s by returning 502',async status=>{
    const network=vi.fn().mockResolvedValue(new Response(null,{status}));vi.stubGlobal('fetch',network);
    const response=await route.handler(await request(route));expect(response.status).toBe(502);
    const body=await response.json();expect(body).not.toHaveProperty('workspace');expect(body).not.toHaveProperty('authenticated');expect(body).not.toHaveProperty('token');
    expect(network).toHaveBeenCalledTimes(1);expect(storage).not.toHaveBeenCalled();
  });
  it('rejects a missing session without GitHub or storage access',async()=>{
    const network=vi.fn();vi.stubGlobal('fetch',network);
    const response=await route.handler(await request(route,false));expect(response.status).toBe(401);
    expect(network).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();
  });
  it('preserves repository access rejection as 403 rather than treating it as authentication loss',async()=>{
    const network=vi.fn().mockResolvedValueOnce(Response.json({id:1,login:'alice'})).mockResolvedValueOnce(Response.json({installations:[]}));vi.stubGlobal('fetch',network);
    const response=await route.handler(await request(route));expect(response.status).toBe(403);
    expect(await response.json()).toHaveProperty('error');expect(network).toHaveBeenCalledTimes(2);expect(storage).not.toHaveBeenCalled();
  });
});
