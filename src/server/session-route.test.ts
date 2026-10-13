import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {GET} from '../../app/api/session/route';
import {seal} from './auth';

const secret='test-secret-with-at-least-thirty-two-characters';
beforeEach(()=>{
  vi.stubEnv('APP_ORIGIN','https://merge-test.example');vi.stubEnv('GITHUB_CLIENT_ID','fixture');
  vi.stubEnv('GITHUB_CLIENT_SECRET','fixture-secret');vi.stubEnv('AUTH_SECRET',secret);
  vi.stubEnv('AUTH_ALLOWED_GITHUB_ID','279398');vi.stubEnv('GITHUB_APP_SLUG','merge-fixture');
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function request(id:string) {
  const value=await seal({token:`private-${id}`,userId:id,login:`person-${id}`,expires:Date.now()+10000},secret);
  return new Request('https://merge-test.example/api/session',{headers:{Cookie:`merge_session=${value}`}});
}
describe('public session route',()=>{
  it('returns safe onboarding state for independently authenticated users',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({id:1,login:'first'})).mockResolvedValueOnce(Response.json({id:2,login:'second'}));vi.stubGlobal('fetch',fetch);
    for(const [id,login] of [['1','first'],['2','second']]) {
      const result=await GET(await request(id));expect(result.status).toBe(200);
      expect(await result.json()).toEqual({configured:true,authenticated:true,login,installationUrl:'https://github.com/apps/merge-fixture/installations/new'});
      expect(result.headers.get('Cache-Control')).toContain('no-store');
    }
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer private-1');
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer private-2');
  });
  it('rejects a mismatched identity without exposing session data',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({id:2,login:'second'})));
    const result=await GET(await request('1'));expect(result.status).toBe(401);
    expect(await result.json()).toEqual({configured:true,authenticated:false,error:'GitHub session expired. Sign in again.'});
  });
  it('marks revoked GitHub credentials as unauthenticated',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status:401})));
    const result=await GET(await request('1'));expect(result.status).toBe(401);expect(await result.json()).toHaveProperty('authenticated',false);
  });
  it.each([403,429,500,503])('keeps identity status unknown on upstreamHTTP%s instead of claiming expiry',async status=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status})));
    const result=await GET(await request('1'));expect(result.status).toBe(502);expect(result.headers.get('Cache-Control')).toContain('no-store');const body=await result.json();expect(body).not.toHaveProperty('authenticated');expect(body).not.toHaveProperty('login');expect(body).not.toHaveProperty('token');
  });
  it('distinguishes missing operator configuration from an ordinary logged-out session',async()=>{
    vi.stubEnv('GITHUB_CLIENT_SECRET','');
    const result=await GET(new Request('https://merge-test.example/api/session'));
    expect(await result.json()).toEqual({configured:false,authenticated:false,installationUrl:'https://github.com/apps/merge-fixture/installations/new'});
  });
});
