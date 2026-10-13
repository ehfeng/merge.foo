import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {GET} from '../../app/api/github/repositories/route';
import {seal} from './auth';
const secret='repository-route-fixture-secret-at-least-32-characters';
beforeEach(()=>{vi.stubEnv('APP_ORIGIN','https://merge.example');vi.stubEnv('GITHUB_CLIENT_ID','fixture');vi.stubEnv('GITHUB_CLIENT_SECRET','fixture');vi.stubEnv('AUTH_SECRET',secret);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
async function request(){return new Request('https://merge.example/api/github/repositories',{headers:{Cookie:`merge_session=${await seal({token:'fixture-token',login:'alice',userId:'1',expires:Date.now()+10000},secret)}`}});}
it.each([401,'identity'])('marks confirmed authentication loss %s as401 before loading repositories',async failure=>{
  const network=vi.fn().mockResolvedValue(failure===401?new Response(null,{status:401}):Response.json({id:2,login:'different'}));vi.stubGlobal('fetch',network);
  const response=await GET(await request());expect(response.status).toBe(401);expect(response.headers.get('Cache-Control')).toContain('no-store');expect(network).toHaveBeenCalledTimes(1);expect(await response.json()).not.toHaveProperty('repositories');
});
it.each([403,429,500,503])('does not claim authentication loss for upstreamHTTP%s',async status=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(null,{status})));
  const response=await GET(await request());expect(response.status).toBe(502);expect(await response.json()).not.toHaveProperty('repositories');
});
it('refreshes installed repositories with current user authority without a workflow allowlist filter',async()=>{
  const network=vi.fn().mockResolvedValueOnce(Response.json({id:1,login:'alice'})).mockResolvedValueOnce(Response.json({installations:[{id:10},{id:20}]})).mockResolvedValueOnce(Response.json({repositories:[{id:101,full_name:'alice/one',private:false}]})).mockResolvedValueOnce(Response.json({repositories:[{id:102,full_name:'organization/two',private:true}]}));vi.stubGlobal('fetch',network);
  vi.stubEnv('WORKFLOW_REPOSITORIES','[]');vi.stubEnv('GITHUB_WORKFLOW_WRITES_ENABLED','false');
  const response=await GET(await request());expect(response.status).toBe(200);expect(await response.json()).toEqual({repositories:[{id:101,full_name:'alice/one',private:false,installationId:10},{id:102,full_name:'organization/two',private:true,installationId:20}]});
  expect(network.mock.calls.every(([,options])=>options.headers.Authorization==='Bearer fixture-token')).toBe(true);
});
