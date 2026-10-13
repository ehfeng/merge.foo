import {describe,it,expect,vi} from 'vitest';
import {ghApi} from './gh-api';

describe('credential-preserving GitHub CLI adapter',()=>{
  it('uses argument arrays, github.com and raw JSON stdin without reading a token',async()=>{
    const runner=vi.fn(async()=>JSON.stringify({data:{answer:true}}));const api=ghApi(runner);
    const variables={login:'a $(echo bad)',number:12,enabled:false,nested:{reviewers:['one']}};
    expect(await api.graph('query Test($login:String!) {viewer {login}}',variables)).toEqual({answer:true});
    const [args,input]=runner.mock.calls[0] as unknown as [string[],string];
    expect(args.slice(0,5)).toEqual(['api','--hostname','github.com','--method','POST']);expect(args).toContain('/graphql');expect(args.slice(-2)).toEqual(['--input','-']);expect(JSON.parse(input).variables).toEqual(variables);expect(args.join(' ')).not.toContain('auth token');
  });
  it('rejects external or malformed API targets and unsupported methods before starting gh',async()=>{
    const runner=vi.fn(async()=> '{}');const api=ghApi(runner);
    for(const path of ['https://evil.example/user','//evil.example/user','/user\r\nHeader: bad','/repos\\evil'])await expect(api.request(path)).rejects.toMatchObject({status:400});
    await expect(api.request('/user','PUT')).rejects.toMatchObject({status:400});expect(runner).not.toHaveBeenCalled();
  });
  it('handles empty successful responses and rejects invalid or errored JSON',async()=>{
    expect(await ghApi(async()=> '').request('/repos/acme/work/pulls/1/requested_reviewers','DELETE',{reviewers:['one']})).toBeUndefined();
    await expect(ghApi(async()=> 'not json').request('/user')).rejects.toMatchObject({status:502});
    await expect(ghApi(async()=>JSON.stringify({errors:[{message:'private'}]})).graph('query Test {viewer {login}}',{})).rejects.toMatchObject({status:502});
  });
});
