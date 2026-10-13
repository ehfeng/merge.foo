import {describe,it,expect,vi} from 'vitest';
import {createGitHub,installationGuidance} from './github';
import {plainText} from './terminal';

describe('CLI GitHub discovery',()=>{
  it('checks the stored GitHub account and reads a bounded organization list without obtaining a token',async()=>{
    const runner=vi.fn(async(args:string[])=>{
      if(args[0]==='--version')return 'gh version 2.88.0';
      if(args.includes('/user'))return JSON.stringify({id:1,login:'viewer'});
      if(args.some(arg=>arg.startsWith('/user/orgs')))return JSON.stringify([{login:'kernel'},{login:'Kernel'},{login:'bad/org'}]);
      throw new Error('Unexpected operation');
    });
    const github=createGitHub(runner);await github.installed();const user=await github.identity();
    expect(await github.owners(user)).toEqual({owners:[{login:'viewer',personal:true},{login:'kernel',personal:false}],limited:false});
    expect(runner.mock.calls.flat(2).join(' ')).not.toMatch(/auth token|show-token|clone/);
    expect(runner.mock.calls.slice(1).every(([args])=>args.includes('GET'))).toBe(true);
  });
  it('stops after five pages of organizations',async()=>{
    const runner=vi.fn(async(_args:string[])=>JSON.stringify(Array.from({length:100},(_,index)=>({login:`org-${index}`}))));
    const result=await createGitHub(runner).owners({id:1,login:'viewer'});
    expect(result.limited).toBe(true);expect(runner).toHaveBeenCalledTimes(5);
    expect(runner.mock.calls[4]?.[0]).toContain('/user/orgs?per_page=100&page=5');
  });
  it('lists only active repositories of the chosen owner, sanitizing upstream descriptions',async()=>{
    const runner=vi.fn(async()=>JSON.stringify([
      {nameWithOwner:'kernel/kernel',isArchived:false,isPrivate:true,description:'\u001b[31mKernel\nwork'},
      {nameWithOwner:'kernel/archived',isArchived:true,isPrivate:true},
      {nameWithOwner:'another/repo',isArchived:false,isPrivate:true},
      {nameWithOwner:'kernel/malformed',isPrivate:true},
    ]));
    expect(await createGitHub(runner).repositories('kernel')).toEqual({repositories:[{fullName:'kernel/kernel',private:true,description:'Kernel work'}],limited:false});
    expect(runner).toHaveBeenCalledWith(['repo','list','kernel','--no-archived','--limit','1000','--json','nameWithOwner,isPrivate,isArchived,description']);
    await expect(createGitHub(runner).repositories('--malicious')).rejects.toThrow(/valid GitHub/);expect(runner).toHaveBeenCalledTimes(1);
  });
  it('preverifies an explicit repository and refuses renamed or archived repositories',async()=>{
    const runner=vi.fn(async(_args:string[])=>JSON.stringify({id:20,full_name:'Kernel/Kernel',private:true,archived:false}));
    expect(await createGitHub(runner).verifyRepositories(['kernel/kernel'])).toEqual([{fullName:'Kernel/Kernel',private:true,description:''}]);
    expect(runner.mock.calls[0]?.[0]).toContain('/repos/kernel/kernel');
    runner.mockResolvedValueOnce(JSON.stringify({id:20,full_name:'kernel/renamed',private:true,archived:false}));
    await expect(createGitHub(runner).verifyRepositories(['kernel/kernel'])).rejects.toThrow(/archived, renamed/);
    runner.mockResolvedValueOnce(JSON.stringify({id:20,full_name:'kernel/kernel',private:true,archived:true}));
    await expect(createGitHub(runner).verifyRepositories(['kernel/kernel'])).rejects.toThrow(/archived, renamed/);
  });
  it('provides actionable missing-CLI and missing-sign-in guidance without upstream response contents',async()=>{
    const github=createGitHub(async()=>{throw new Error('internal secret response');});
    await expect(github.installed()).rejects.toMatchObject({reason:'missing-gh',message:expect.stringContaining('https://cli.github.com')});
    await expect(github.identity()).rejects.toMatchObject({reason:'access',message:expect.stringContaining('Check your connection')});
    await expect(github.verifyRepositories(['kernel/kernel'])).rejects.toThrow('gh repo view kernel/kernel');
    expect(installationGuidance('win32')).toContain('winget install --id GitHub.cli');
    expect(plainText('\u001b[31mHello\u001b[0m\nworld\u202e')).toBe('Hello world');
  });
  it('offers sign-in only for a confirmed missing account or invalid sign-in, with no token in the status projection',async()=>{
    for(const status of [[],[{active:true,state:'error',error:'HTTP 401: Bad credentials'}]]){
      const runner=vi.fn(async(args:string[])=>{if(args[0]==='auth')return JSON.stringify(status);throw new Error('GitHub CLI access failed.');});
      await expect(createGitHub(runner).identity()).rejects.toMatchObject({reason:'sign-in',message:expect.stringContaining('gh auth login --hostname github.com --web')});
      expect(runner.mock.calls[1]?.[0]).toEqual(['auth','status','--hostname','github.com','--active','--json','hosts','--jq','.hosts["github.com"] // [] | map({active, state, error})']);
    }
    for(const status of [[{active:true,state:'timeout',error:'Timed out'}],[{active:true,state:'error',error:'HTTP 502: Bad Gateway'}],[{active:true,state:'error',error:'HTTP 403: API rate limit exceeded'}]]){
      const runner=vi.fn(async(args:string[])=>{if(args[0]==='auth')return JSON.stringify(status);throw new Error('GitHub is unavailable.');});
      await expect(createGitHub(runner).identity()).rejects.toMatchObject({reason:'access',message:expect.stringContaining('Check your connection')});
    }
  });
});
