import {describe,it,expect,vi,afterEach} from 'vitest';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {ghApi,runGh} from './gh-api';
const processMock=vi.hoisted(()=>({spawn:vi.fn()}));
vi.mock('node:child_process',()=>({spawn:processMock.spawn}));

afterEach(()=>{vi.useRealTimers();vi.clearAllMocks();});
function childProcess(){
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});processMock.spawn.mockReturnValue(child);return child;
}

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
  it('marks gateway and timeout responses for smaller read batches while retaining uncertain write outcomes',async()=>{
    for(const status of [502,503,504]){
      const child=childProcess();const result=runGh(['api','--method','POST','/graphql']);child.stderr.write(`gh: HTTP ${status}: private upstream details`);child.emit('close',1);
      await expect(result).rejects.toMatchObject({outcome:'uncertain',readRetryable:true,upstreamStatus:status,message:`GitHub CLI request failed (${status}).`});
    }
  });
  it('never treats authentication, access or rate limits as an adaptive read retry',async()=>{
    for(const [status,message,outcome] of [[401,'Bad credentials','rejected'],[403,'Access denied','rejected'],[403,'API rate limit exceeded','retryable'],[429,'Too many requests','retryable']] as const){
      const child=childProcess();const result=runGh(['api','/user']);child.stderr.write(`gh: HTTP ${status}: ${message}`);child.emit('close',1);
      await expect(result).rejects.toMatchObject({outcome,readRetryable:false,upstreamStatus:status});
    }
  });
  it('marks a killed timed-out process for read recovery without replaying the process itself',async()=>{
    vi.useFakeTimers();const child=childProcess();const result=runGh(['api','/graphql']);const assertion=expect(result).rejects.toMatchObject({outcome:'uncertain',readRetryable:true});
    await vi.advanceTimersByTimeAsync(25000);await assertion;expect(child.kill).toHaveBeenCalledWith('SIGKILL');expect(processMock.spawn).toHaveBeenCalledTimes(1);
  });
  it('rejects partial GraphQL data and distinguishes deadlines from access or rate errors',async()=>{
    const deadline=ghApi(async()=>JSON.stringify({data:{answer:'partial'},errors:[{message:"We couldn't respond to your request in time"}]}));
    await expect(deadline.graph('query WorkMap {viewer {login}}',{})).rejects.toMatchObject({readRetryable:true});
    for(const message of ['API rate limit exceeded','Resource not accessible by integration','Syntax Error: Unexpected Name'])await expect(ghApi(async()=>JSON.stringify({data:{answer:'partial'},errors:[{message}]})).graph('query WorkMap {viewer {login}}',{})).rejects.toMatchObject({status:502});
  });
  it('does not replay failed write requests and adds only operation names to diagnostics',async()=>{
    const failure=Object.assign(new Error('GitHub CLI request failed (502).'),{readRetryable:true,outcome:'uncertain'});const runner=vi.fn(async()=>{throw failure;});
    await expect(ghApi(runner).request('/graphql','POST',{query:'mutation PrivateWrite($secret:String!) {viewer {login}}',variables:{secret:'private repository details'}})).rejects.toThrow(/GraphQL PrivateWrite/);
    expect(runner).toHaveBeenCalledTimes(1);expect(failure.message).not.toContain('private repository details');
  });
});
