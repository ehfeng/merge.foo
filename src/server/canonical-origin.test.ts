import {it,expect} from 'vitest';
import {canonicalOriginDecision} from './canonical-origin';
const values={origin:'https://merge.foo',aliases:['https://merge-foo.eric.workers.dev','https://merge.foo']};
const old='https://merge-foo.eric.workers.dev';
it('redirects approved UI GET/HEAD visits with a pinned authority and private headers',()=>{
  for(const method of ['GET','HEAD']){
    const response=canonicalOriginDecision(new Request(`${old}/features?selected=123`,{method}),values)!;
    expect(response.status).toBe(307);expect(response.headers.get('Location')).toBe('https://merge.foo/features?selected=123');expect(response.headers.get('Cache-Control')).toContain('no-store');expect(response.headers.has('Set-Cookie')).toBe(false);
  }
  const response=canonicalOriginDecision(new Request(`${old}//evil.example/path?next=https://evil.example`),values)!;
  expect(new URL(response.headers.get('Location')!).origin).toBe('https://merge.foo');
});
it('restarts alias OAuth entry and callback without forwarding code, state or redirect parameters',()=>{
  for(const path of ['/api/auth/login','/api/auth/callback']){
    const response=canonicalOriginDecision(new Request(`${old}${path}?code=private&state=private&next=https://evil.example`),values)!;
    expect(response.headers.get('Location')).toBe('https://merge.foo/api/auth/login');expect(response.headers.has('Set-Cookie')).toBe(false);
  }
});
it('leaves canonical, unrecognized UI hosts and every other API request untouched',()=>{
  expect(canonicalOriginDecision(new Request('https://merge.foo/'),values)).toBeNull();
  expect(canonicalOriginDecision(new Request('https://untrusted.example/'),values)).toBeNull();
  for(const path of ['/api','/api/github/webhook','/api/internal/reconcile','/api/session','/api/auth/logout','/API/internal/reconcile']){
    expect(canonicalOriginDecision(new Request(`${old}${path}`,{headers:{Authorization:'Bearer fixture'}}),values)).toBeNull();
  }
});
it('never redirects mutations or forwards their bodies and bearer credentials',()=>{
  for(const method of ['POST','PUT','PATCH','DELETE']){
    expect(canonicalOriginDecision(new Request(`${old}/api/auth/login`,{method,headers:{Authorization:'Bearer fixture'},body:'fixture'}),values)).toBeNull();
    expect(canonicalOriginDecision(new Request(`${old}/features`,{method,body:'fixture'}),values)).toBeNull();
  }
});
it('accepts JSON or native binding arrays and rejects malformed alias collections completely',()=>{
  const request=new Request(`${old}/api/auth/login`);
  expect(canonicalOriginDecision(request,{...values,aliases:JSON.stringify(values.aliases)},'login')?.status).toBe(307);
  for(const aliases of ['bad','{}',['https://merge-foo.eric.workers.dev/path'],[old,'https://evil.example/path'],['https://user:password@merge-foo.eric.workers.dev'],['http://merge-foo.eric.workers.dev'],['https://merge-foo.eric.workers.dev?next=evil'],['https://merge-foo.eric.workers.dev\\']]){
    const response=canonicalOriginDecision(request,{origin:values.origin,aliases},'login')!;
    expect(response.status).toBe(403);expect(response.headers.has('Location')).toBe(false);expect(response.headers.has('Set-Cookie')).toBe(false);
  }
});
it('keeps missing configuration on the normal route and rejects unknown auth hosts',()=>{
  expect(canonicalOriginDecision(new Request(`${old}/api/auth/login`),{})).toBeNull();
  for(const kind of ['login','callback'] as const){
    const response=canonicalOriginDecision(new Request('https://evil.example/api/auth/login'),values,kind)!;
    expect(response.status).toBe(403);expect(response.headers.has('Location')).toBe(false);
  }
});
it('uses the same trusted list before and after switching the canonical host',()=>{
  const before=canonicalOriginDecision(new Request('https://merge.foo/api/auth/login'),{origin:old,aliases:values.aliases})!;
  expect(before.headers.get('Location')).toBe(`${old}/api/auth/login`);
  const after=canonicalOriginDecision(new Request(`${old}/api/auth/login`),values)!;
  expect(after.headers.get('Location')).toBe('https://merge.foo/api/auth/login');
});
