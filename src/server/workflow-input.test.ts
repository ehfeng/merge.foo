import {it,expect,vi,afterEach} from 'vitest';
import {parseWorkflowInput,readWorkflowInput} from './workflow-input';
afterEach(()=>vi.unstubAllEnvs());
it('rejects caller-injected identities, event IDs and ambiguous enrollment payloads',()=>{
  for(const command of [{type:'enroll',stackId:'s',enabled:true,actorId:'victim'},{type:'reconcile',eventId:'trusted-delivery'},{type:'enroll',stackId:'s',enabled:true,prIds:['p','p']},{type:'configure_pr',prId:'p',minimumApprovals:0}])expect(()=>parseWorkflowInput({repository:'owner/repo',version:0,command})).toThrow();
  expect(parseWorkflowInput({repository:'owner/repo',version:2,command:{type:'configure_pr',prId:'p',parentId:null}}).command).toEqual({type:'configure_pr',prId:'p',parentId:null});
});
it('checks exact trusted origin before parsing or invoking GitHub',async()=>{
  vi.stubEnv('APP_ORIGIN','http://127.0.0.1:3000');vi.stubEnv('GITHUB_CLIENT_ID','fixture');vi.stubEnv('GITHUB_CLIENT_SECRET','fixture');vi.stubEnv('AUTH_SECRET','fixture-secret-long-enough-for-tests');
  const body=JSON.stringify({repository:'owner/repo',version:0,command:{type:'start',prId:'p'},expectedPlanVersion:1,expectedReviewers:[{id:'2',login:'reviewer'}]});
  for(const origin of ['https://evil.example','http://localhost:3000'])await expect(readWorkflowInput(new Request('http://127.0.0.1:3000/api/github/workflow',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body}))).rejects.toThrow('must come from this site');
  await expect(readWorkflowInput(new Request('http://127.0.0.1:3000/api/github/workflow',{method:'POST',headers:{Origin:'http://127.0.0.1:3000','Content-Type':'application/json'},body}))).resolves.toMatchObject({command:{type:'start',prId:'p'}});
});
