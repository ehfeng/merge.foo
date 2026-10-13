import {afterEach,describe,expect,it,vi} from 'vitest';
import {connectionFetch,parseCompanionUrl} from './client';
const pairing={capability:'x'.repeat(43),port:4318};
afterEach(()=>vi.unstubAllGlobals());
describe('companion browser transport',()=>{
  it('accepts only a base64url capability and a nonprivileged local port',()=>{
    expect(parseCompanionUrl(`https://merge.foo/#companion=${pairing.capability}`)).toEqual(pairing);
    for(const fragment of [`companion=short`,`companion=${pairing.capability}&port=80`,`companion=${pairing.capability}&port=65536`,`companion=${pairing.capability}&port=4318evil`,`companion=${pairing.capability}&companion=${pairing.capability}`,`companion=${pairing.capability}&port=4318&port=4319`])expect(parseCompanionUrl(`https://merge.foo/#${fragment}`)).toBeNull();
  });
  it('pins supported endpoints to loopback and omits cookies without forwarding redirects',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response('{}'));vi.stubGlobal('fetch',fetch);
    await connectionFetch(pairing,'/api/github/workspace?repository=kernel%2Fkernel',{headers:{'Content-Type':'application/json'},credentials:'include'});
    const [url,options]=fetch.mock.calls[0];expect(url).toBe('http://127.0.0.1:4318/api/github/workspace?repository=kernel%2Fkernel');
    expect(options).toMatchObject({credentials:'omit',cache:'no-store',redirect:'error',targetAddressSpace:'loopback'});expect(options.headers.get('Authorization')).toBe(`Bearer ${pairing.capability}`);
    for(const url of ['https://evil.example/api/session','//evil.example/api/session','/api/auth/login','/api/github/webhook','/api/session#fragment'])await expect(connectionFetch(pairing,url)).rejects.toThrow('not supported');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('keeps the hosted connection unchanged and explains local connection failures',async()=>{
    const fetch=vi.fn().mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new TypeError('Failed to fetch'));vi.stubGlobal('fetch',fetch);
    const options={credentials:'same-origin' as const};await connectionFetch(null,'/api/session',options);expect(fetch).toHaveBeenNthCalledWith(1,'/api/session',options);
    await expect(connectionFetch(pairing,'/api/session')).rejects.toThrow('allow local-network access');
  });
});
