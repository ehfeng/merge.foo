import {describe,it,expect,vi,afterEach} from 'vitest';
import {generateKeyPairSync,verify} from 'node:crypto';
import {appJwt,authorizeBackgroundGrant,installationPrincipal,validWebhookSignature} from './github-app';
import type {WorkflowAction,WorkflowDocument} from '../workflow/types';
const secret='test-only-webhook-secret-with-32-characters';
const repo={id:42,installationId:7,full_name:'owner/repo',private:true};
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe('background GitHub credentials',()=>{
  it.each(['pkcs1','pkcs8'] as const)('signs GitHub JWT using %s PEM with bounded lifetime',async type=>{
    const keys=generateKeyPairSync('rsa',{modulusLength:2048});
    const jwt=await appJwt('Iv1_fixture',keys.privateKey.export({type,format:'pem'}).toString(),1700000000000);
    const [header,payload,signature]=jwt.split('.');
    expect(JSON.parse(Buffer.from(header,'base64url').toString())).toEqual({alg:'RS256',typ:'JWT'});
    expect(JSON.parse(Buffer.from(payload,'base64url').toString())).toEqual({iss:'Iv1_fixture',iat:1699999940,exp:1700000540});
    expect(verify('RSA-SHA256',Buffer.from(`${header}.${payload}`),keys.publicKey,Buffer.from(signature,'base64url'))).toBe(true);
  });
  it('mints a token for only the selected repository and rejects changed identity',async()=>{
    const keys=generateKeyPairSync('rsa',{modulusLength:2048});
    vi.stubEnv('GITHUB_APP_PRIVATE_KEY',keys.privateKey.export({format:'pem',type:'pkcs1'}).toString());vi.stubEnv('GITHUB_APP_ID','99');
    const fetcher=vi.fn(async(url:string,options?:RequestInit)=>{
      if(url.endsWith('/app'))return Response.json({id:99,slug:'merge-foo'});
      if(url.endsWith('/app/installations/7'))return Response.json({id:7,app_id:99,suspended_at:null});
      if(url.endsWith('/access_tokens')){expect(JSON.parse(options?.body as string)).toEqual({repository_ids:[42],permissions:{pull_requests:'write',checks:'read',statuses:'read',metadata:'read'}});return Response.json({token:'fixture-token',expires_at:new Date(Date.now()+3600000).toISOString(),permissions:{pull_requests:'write'}});}
      return Response.json({id:43,full_name:'owner/repo'});
    });vi.stubGlobal('fetch',fetcher);
    await expect(installationPrincipal(repo)).rejects.toThrow('Repository identity changed');
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it('rechecks numeric enrollment actor identity and current write permission',async()=>{
    const document={config:{stacks:{s:{enrolled:true,prIds:['p'],actorId:'5',actorLogin:'writer'}}}} as unknown as WorkflowDocument;
    const action={stackId:'s',prId:'p'} as WorkflowAction;
    const fetcher=vi.fn().mockResolvedValueOnce(Response.json({permission:'read',user:{id:5,login:'writer'}})).mockResolvedValueOnce(Response.json({permission:'write',user:{id:6,login:'writer'}})).mockResolvedValueOnce(Response.json({permission:'write',user:{id:5,login:'writer'}}));vi.stubGlobal('fetch',fetcher);
    expect(await authorizeBackgroundGrant('fixture',repo,action,document)).toBe(false);
    expect(await authorizeBackgroundGrant('fixture',repo,action,document)).toBe(false);
    expect(await authorizeBackgroundGrant('fixture',repo,action,document)).toBe(true);
    document.config.stacks.s.enrolled=false;
    expect(await authorizeBackgroundGrant('fixture',repo,action,document)).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('rejects invalid installation expiry before using the returned credential',async()=>{
    const keys=generateKeyPairSync('rsa',{modulusLength:2048});vi.stubEnv('GITHUB_APP_PRIVATE_KEY',keys.privateKey.export({format:'pem',type:'pkcs8'}).toString());vi.stubEnv('GITHUB_APP_ID','99');
    const network=vi.fn().mockResolvedValueOnce(Response.json({id:99,slug:'merge-foo'})).mockResolvedValueOnce(Response.json({id:7,app_id:99,suspended_at:null})).mockResolvedValueOnce(Response.json({token:'fixture',expires_at:'invalid',permissions:{pull_requests:'write'}}));vi.stubGlobal('fetch',network);
    await expect(installationPrincipal(repo)).rejects.toThrow('unusable installation token');expect(network).toHaveBeenCalledTimes(3);
  });
});
describe('webhook authenticity',()=>{
  it('verifies raw bytes and rejects a changed payload, signature, or secret',async()=>{
    const body=new TextEncoder().encode('{"action":"submitted"}');
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const signature='sha256='+Buffer.from(await crypto.subtle.sign('HMAC',key,body)).toString('hex');
    expect(await validWebhookSignature(body,signature,secret)).toBe(true);
    expect(await validWebhookSignature(new TextEncoder().encode('{"action":"dismissed"}'),signature,secret)).toBe(false);
    expect(await validWebhookSignature(body,'sha1=fixture',secret)).toBe(false);
    expect(await validWebhookSignature(body,signature,'short')).toBe(false);
  });
});
