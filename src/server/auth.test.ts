import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {beginLogin,configuration,finishLogin,github,logout,seal,session,unseal,revalidateIdentity,installationUrl} from './auth';
const secret='test-secret-with-at-least-thirty-two-characters';
beforeEach(()=>{vi.stubEnv('APP_ORIGIN','https://merge-test.example');vi.stubEnv('GITHUB_CLIENT_ID','test-client');vi.stubEnv('GITHUB_CLIENT_SECRET','client-secret');vi.stubEnv('AUTH_SECRET',secret);vi.stubEnv('AUTH_ALLOWED_GITHUB_ID','279398');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('public GitHub App authentication',()=>{
  it('fails closed without the required secret',()=>{vi.stubEnv('AUTH_SECRET','');expect(configuration()).toBeNull();});
  it('rejects insecure non-local origins',()=>{vi.stubEnv('APP_ORIGIN','http://example.com');expect(configuration()).toBeNull();});
  it('encrypts tokens and detects tampering or a wrong key',async()=>{const sealed=await seal({token:'private-token'},secret);expect(sealed).not.toContain('private-token');expect(await unseal(sealed,secret)).toEqual({token:'private-token'});expect(await unseal(sealed+'x',secret)).toBeNull();expect(await unseal(sealed,'wrong-key')).toBeNull();});
  it('rejects expired, unbounded and malformed sessions',async()=>{for(const patch of [{expires:Date.now()-1},{expires:Date.now()+28801000},{userId:'other'},{userId:1},{login:''},{token:''},{expires:'future'}]){const c=await seal({token:'private',expires:Date.now()+10000,userId:'123',login:'someone',...patch},secret);expect(await session(new Request('https://merge-test.example',{headers:{Cookie:`merge_session=${c}`}}))).toBeNull();}});
  it('accepts independently bound user sessions',async()=>{const c=await seal({token:'private',expires:Date.now()+10000,userId:'123',login:'someone'},secret);expect((await session(new Request('https://merge-test.example',{headers:{Cookie:`merge_session=${c}`}})))?.login).toBe('someone');});
  it('uses state and PKCE without repo or offline scopes',async()=>{const response=await beginLogin();const url=new URL(response.headers.get('location')!);expect(url.origin).toBe('https://github.com');expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('state')?.length).toBe(43);expect(url.searchParams.has('scope')).toBe(false);const c=response.headers.get('set-cookie')!;expect(c).toContain('HttpOnly');expect(c).toContain('Secure');expect(c).toContain('SameSite=Lax');});
  it('rejects callbacks without valid state before contacting GitHub',async()=>{const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const response=await finishLogin(new Request('https://merge-test.example/api/auth/callback?code=x&state=x'));expect(response.status).toBe(400);expect(fetch).not.toHaveBeenCalled();});
  it('sets a bounded secure session and discards the refresh token',async()=>{const fetch=vi.fn().mockResolvedValueOnce(Response.json({access_token:'ghu_fake',expires_in:28800,refresh_token:'must-not-retain'})).mockResolvedValueOnce(Response.json({id:279398,login:'ehfeng'}));vi.stubGlobal('fetch',fetch);const c=await seal({state:'state',verifier:'verifier',expires:Date.now()+10000},secret);const response=await finishLogin(new Request('https://merge-test.example/api/auth/callback?code=test&state=state',{headers:{Cookie:`merge_flow=${c}`}}));expect(response.status).toBe(302);const cookies=response.headers.get('set-cookie')!;expect(cookies).toContain('Max-Age=28800');expect(cookies).not.toContain('ghu_fake');const sessionCookie=cookies.split('merge_session=')[1].split(';')[0];expect(await unseal(sessionCookie,secret)).not.toHaveProperty('refresh_token');expect(JSON.parse(fetch.mock.calls[0][1].body)).toHaveProperty('code_verifier','verifier');});
  it('allows another account despite the legacy owner configuration',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(Response.json({access_token:'fake'})).mockResolvedValueOnce(Response.json({id:1,login:'someone'})));const c=await seal({state:'s',verifier:'v',expires:Date.now()+10000},secret);expect((await finishLogin(new Request('https://merge-test.example/api/auth/callback?code=x&state=s',{headers:{Cookie:`merge_flow=${c}`}}))).status).toBe(302);});
  it('prevents cross-site logout and clears the local session on same-origin logout',async()=>{expect((await logout(new Request('https://merge-test.example/api/auth/logout',{method:'POST',headers:{Origin:'https://evil.example'}}))).status).toBe(403);const r=await logout(new Request('https://merge-test.example/api/auth/logout',{method:'POST',headers:{Origin:'https://merge-test.example'}}));expect(r.status).toBe(204);expect(r.headers.get('set-cookie')).toContain('Max-Age=0');});
  it('GET-only REST helper does not leak tokens in upstream errors',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('private-token',{status:401})));await expect(github('private-token','/user')).rejects.toThrow('GitHub session expired');await expect(github('private-token','//evil.test')).rejects.toThrow('Invalid GitHub path');});
});

describe('identity and onboarding boundaries',()=>{
  it('does not require legacy operator ID configuration',()=>{vi.stubEnv('AUTH_ALLOWED_GITHUB_ID','');expect(configuration()).not.toBeNull();});
  it.each(['ftp://localhost','https://user:password@example.com','https://example.com/subpath','https://example.com?redirect=evil','https://example.com/#x'])('rejects malformed configured origin %s',(origin)=>{vi.stubEnv('APP_ORIGIN',origin);expect(configuration()).toBeNull();});
  it('exposes only a validated GitHub App installation link',()=>{vi.stubEnv('GITHUB_APP_SLUG','merge-foo-test');expect(installationUrl()).toBe('https://github.com/apps/merge-foo-test/installations/new');for(const slug of ['https://evil.example','../evil','bad?next=evil','-bad']){vi.stubEnv('GITHUB_APP_SLUG',slug);expect(installationUrl()).toBeUndefined();}});
  it('rejects a token whose actual identity differs from the sealed identity',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({id:2,login:'another'})));await expect(revalidateIdentity({token:'private',userId:'1',login:'someone',expires:Date.now()+10000})).rejects.toThrow('identity changed');});
  it('allows a renamed login when the actual numeric identity matches',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({id:1,login:'renamed'})));expect(await revalidateIdentity({token:'private',userId:'1',login:'someone',expires:Date.now()+10000})).toEqual({id:1,login:'renamed'});});
  it('rejects revoked tokens rather than trusting a valid cookie',async()=>{vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:401})));await expect(revalidateIdentity({token:'private',userId:'1',login:'someone',expires:Date.now()+10000})).rejects.toThrow('expired');});
  it.each([-1,0,'28800',null])('rejects invalid upstream expiry %s',async(expires_in)=>{const fetch=vi.fn().mockResolvedValueOnce(Response.json({access_token:'fake',expires_in}));vi.stubGlobal('fetch',fetch);const c=await seal({state:'s',verifier:'v',expires:Date.now()+10000},secret);expect((await finishLogin(new Request('https://merge-test.example/api/auth/callback?code=x&state=s',{headers:{Cookie:`merge_flow=${c}`}}))).status).toBe(401);expect(fetch).toHaveBeenCalledTimes(1);});
});

describe('canonical sign-in origins',()=>{
  it('starts OAuth only on the configured origin and uses that callback/cookie host',async()=>{
    const response=await beginLogin(new Request('https://merge-test.example/api/auth/login'));
    expect(response.status).toBe(302);expect(new URL(response.headers.get('Location')!).searchParams.get('redirect_uri')).toBe('https://merge-test.example/api/auth/callback');expect(response.headers.get('Set-Cookie')).toContain('merge_flow=');
  });
  it('redirects a trusted alias to fresh canonical sign-in before creating flow cookies',async()=>{
    vi.stubEnv('APP_ORIGIN_ALIASES','["https://old.example"]');const network=vi.fn();vi.stubGlobal('fetch',network);
    const response=await beginLogin(new Request('https://old.example/api/auth/login?next=https://evil.example&code=private&state=private'));
    expect(response.status).toBeGreaterThanOrEqual(300);expect(response.status).toBeLessThan(400);expect(response.headers.get('Location')).toBe('https://merge-test.example/api/auth/login');expect(response.headers.has('Set-Cookie')).toBe(false);expect(network).not.toHaveBeenCalled();
  });
  it('restarts a trusted alias callback before decrypting cookies or forwarding code/state',async()=>{
    vi.stubEnv('APP_ORIGIN_ALIASES','["https://old.example"]');const network=vi.fn();vi.stubGlobal('fetch',network);
    const response=await finishLogin(new Request('https://old.example/api/auth/callback?code=private-code&state=private-state',{headers:{Cookie:'merge_flow=invalid-encrypted-cookie'}}));
    expect(response.status).toBeGreaterThanOrEqual(300);expect(response.status).toBeLessThan(400);expect(response.headers.get('Location')).toBe('https://merge-test.example/api/auth/login');expect(response.headers.has('Set-Cookie')).toBe(false);expect(await response.text()).not.toContain('private-code');expect(network).not.toHaveBeenCalled();
  });
  it('does not exchange a valid flow arriving through an untrusted callback origin',async()=>{
    const flow=await seal({state:'valid-state',verifier:'valid-verifier',expires:Date.now()+10000},secret);const network=vi.fn();vi.stubGlobal('fetch',network);
    const response=await finishLogin(new Request('https://evil.example/api/auth/callback?code=private-code&state=valid-state',{headers:{Cookie:`merge_flow=${flow}`}}));
    expect(response.status).toBe(403);expect(response.headers.has('Set-Cookie')).toBe(false);expect(network).not.toHaveBeenCalled();
  });
  it('fails closed for noncanonical non-GET auth calls instead of bypassing the redirect helper',async()=>{
    vi.stubEnv('APP_ORIGIN_ALIASES','["https://old.example"]');const network=vi.fn();vi.stubGlobal('fetch',network);
    const flow=await seal({state:'valid-state',verifier:'valid-verifier',expires:Date.now()+10000},secret);
    const login=await beginLogin(new Request('https://old.example/api/auth/login',{method:'POST'}));
    const callback=await finishLogin(new Request('https://old.example/api/auth/callback?code=private-code&state=valid-state',{method:'POST',headers:{Cookie:`merge_flow=${flow}`}}));
    expect(login.status).toBe(403);expect(callback.status).toBe(403);expect(login.headers.has('Set-Cookie')).toBe(false);expect(callback.headers.has('Set-Cookie')).toBe(false);expect(network).not.toHaveBeenCalled();
  });
  it.each([undefined,'[]','invalid','["https://evil.example/path"]','["https://old.example"]'])('rejects untrusted request hosts for login and callback with aliases=%s',async aliases=>{
    vi.stubEnv('APP_ORIGIN_ALIASES',aliases??'');const network=vi.fn();vi.stubGlobal('fetch',network);
    for(const response of [await beginLogin(new Request('https://evil.example/api/auth/login')),await finishLogin(new Request('https://evil.example/api/auth/callback?code=private&state=private',{headers:{Cookie:'merge_flow=invalid'}}))]){expect(response.status).toBe(403);expect(response.headers.has('Set-Cookie')).toBe(false);expect(response.headers.has('Location')).toBe(false);}
    expect(network).not.toHaveBeenCalled();
  });
  it('supports an apex transition without starting an OAuth flow on the temporary alias',async()=>{
    vi.stubEnv('APP_ORIGIN','https://merge-foo.eric.workers.dev');vi.stubEnv('APP_ORIGIN_ALIASES','["https://merge.foo"]');
    const before=await beginLogin(new Request('https://merge.foo/api/auth/login'));expect(before.headers.get('Location')).toBe('https://merge-foo.eric.workers.dev/api/auth/login');expect(before.headers.has('Set-Cookie')).toBe(false);
    vi.stubEnv('APP_ORIGIN','https://merge.foo');vi.stubEnv('APP_ORIGIN_ALIASES','["https://merge-foo.eric.workers.dev"]');
    const after=await beginLogin(new Request('https://merge-foo.eric.workers.dev/api/auth/login'));expect(after.headers.get('Location')).toBe('https://merge.foo/api/auth/login');expect(after.headers.has('Set-Cookie')).toBe(false);
    const canonical=await beginLogin(new Request('https://merge.foo/api/auth/login'));expect(new URL(canonical.headers.get('Location')!).searchParams.get('redirect_uri')).toBe('https://merge.foo/api/auth/callback');expect(canonical.headers.get('Set-Cookie')).toContain('Secure');
  });
});
