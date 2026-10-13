import {describe,it,expect,vi} from 'vitest';
import {resolve} from 'node:path';
import {COMPANION_VERSION} from '../version';
import {runCli,type CliDependencies} from './run';
import {SetupError} from './github';
import type {Terminal} from './terminal';

vi.mock('../server',()=>({createCompanion:vi.fn(()=>{throw new Error('Tests must provide a local connection.');})}));

function setup(){
  const session={identity:{id:1,login:'viewer'},listen:vi.fn(async()=>({port:4318,pairUrl:'https://merge.foo/#companion=private-pairing-link&port=4318'})),close:vi.fn(async()=>{})};
  const spinner={start:vi.fn(),stop:vi.fn(),error:vi.fn(),isCancelled:false};
  const ui:Terminal={intro:vi.fn(),outro:vi.fn(),note:vi.fn(),info:vi.fn(),success:vi.fn(),warn:vi.fn(),error:vi.fn(),cancel:vi.fn(),spinner:vi.fn(()=>spinner),select:vi.fn(async()=> 'kernel'),multiselect:vi.fn(async()=> ['kernel/kernel']),text:vi.fn(async()=> 'kernel'),confirm:vi.fn(async()=>true)};
  const repositories=[{fullName:'kernel/kernel',private:true,description:'A private repository'},{fullName:'kernel/tools',private:false,description:''}];
  const github={installed:vi.fn(async()=>{}),identity:vi.fn(async()=>session.identity),owners:vi.fn(async()=>({owners:[{login:'viewer',personal:true},{login:'kernel',personal:false}],limited:false})),repositories:vi.fn(async()=>({repositories,limited:false})),verifyRepositories:vi.fn(async(selected:string[])=>repositories.filter(repo=>selected.includes(repo.fullName)))};
  const deps:CliDependencies={interactive:true,ui,github,create:vi.fn(async()=>session),signIn:vi.fn(async()=>{}),open:vi.fn(async()=>true),output:vi.fn(),nodeVersion:'22.15.0',onReady:vi.fn(()=>{}),inspectLock:vi.fn(async()=>({state:'unlocked' as const,path:'/private/plans/process.lock'})),repairLock:vi.fn(async()=>({state:'unlocked' as const,path:'/private/plans/process.lock',repaired:true}))};
  return {session,spinner,ui,github,deps};
}

describe('guided companion setup',()=>{
  it('uses explicit repository selection and review before starting or opening a browser',async()=>{
    const {deps,ui,github,session}=setup();
    await expect(runCli(['connect'],deps)).resolves.toBe(session);
    expect(github.repositories).toHaveBeenCalledWith('kernel');
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({repositories:['kernel/kernel'],origin:'https://merge.foo'}));
    expect(ui.note).toHaveBeenCalledWith(expect.stringContaining('Allowed repositories\n  kernel/kernel · private'),'Review your connection');
    expect(ui.note).not.toHaveBeenCalledWith(expect.stringContaining('kernel/tools'),'Review your connection');
    expect(ui.confirm).toHaveBeenCalledWith('Connect these repositories to merge.foo?',true);
    const confirm=vi.mocked(ui.confirm);const create=vi.mocked(deps.create);
    expect(Math.max(...confirm.mock.invocationCallOrder)).toBeLessThan(create.mock.invocationCallOrder[0]);
    expect(deps.open).toHaveBeenCalledWith('https://merge.foo/#companion=private-pairing-link&port=4318');
    expect(deps.onReady).toHaveBeenCalledWith(session);
    expect(vi.mocked(deps.onReady).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(deps.open).mock.invocationCallOrder[0]);
    expect(ui.outro).toHaveBeenCalledWith(expect.stringContaining('Keep this terminal open'));
    expect(session.close).not.toHaveBeenCalled();
  });
  it.each(['owner','repositories','review','browser'] as const)('cancels at %s with no running companion or browser effects',async(stage)=>{
    const {deps,ui}=setup();const cancel=Symbol('cancel');
    if(stage==='owner')vi.mocked(ui.select).mockResolvedValueOnce(cancel);
    if(stage==='repositories')vi.mocked(ui.multiselect).mockResolvedValueOnce(cancel);
    if(stage==='review')vi.mocked(ui.confirm).mockResolvedValueOnce(false);
    if(stage==='browser')vi.mocked(ui.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(cancel);
    await expect(runCli([],deps)).resolves.toBeUndefined();
    expect(deps.create).not.toHaveBeenCalled();expect(deps.open).not.toHaveBeenCalled();
    expect(ui.cancel).toHaveBeenCalledWith('Connection cancelled. Nothing is connected.');
  });
  it('does not grant any repository when the selected list is empty or includes an unlisted name',async()=>{
    for(const selected of [[],['another/private']]){
      const {deps,ui}=setup();vi.mocked(ui.multiselect).mockResolvedValueOnce(selected);
      await expect(runCli([],deps)).rejects.toThrow(/between 1 and 50/);expect(deps.create).not.toHaveBeenCalled();
    }
  });
  it('offers sign-in only when the user explicitly accepts it',async()=>{
    const {deps,github}=setup();github.identity.mockRejectedValueOnce(new SetupError('Sign in.','sign-in'));
    await runCli([],deps);expect(deps.signIn).toHaveBeenCalledTimes(1);expect(github.identity).toHaveBeenCalledTimes(2);
    const declined=setup();declined.github.identity.mockRejectedValueOnce(new SetupError('Run gh auth login.','sign-in'));vi.mocked(declined.ui.confirm).mockResolvedValueOnce(false);
    await expect(runCli([],declined.deps)).rejects.toThrow('Run gh auth login.');expect(declined.deps.signIn).not.toHaveBeenCalled();expect(declined.deps.create).not.toHaveBeenCalled();
  });
  it('opens no browser when the user declines and always prints the pairing link',async()=>{
    const {deps,ui}=setup();vi.mocked(ui.confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await runCli([],deps);expect(deps.open).not.toHaveBeenCalled();expect(ui.note).toHaveBeenCalledWith(expect.stringContaining('#companion='),'Your private pairing link');
  });
  it('guides repository selection with settings flags and skips the browser question with --no-open',async()=>{
    const {deps,ui,session}=setup();
    await expect(runCli(['connect','--origin','http://127.0.0.1:3000','--read-only','--no-open'],deps)).resolves.toBe(session);
    expect(ui.select).toHaveBeenCalled();expect(ui.multiselect).toHaveBeenCalled();
    expect(ui.confirm).toHaveBeenCalledExactlyOnceWith('Connect these repositories to merge.foo?',true);
    expect(deps.open).not.toHaveBeenCalled();
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({repositories:['kernel/kernel'],origin:'http://127.0.0.1:3000',readOnly:true}));
  });
  it('keeps the pairing link and a clear next step when opening the browser fails',async()=>{
    const {deps,ui,session}=setup();vi.mocked(deps.open).mockResolvedValueOnce(false);
    await expect(runCli([],deps)).resolves.toBe(session);expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining('Open the pairing link above'));expect(session.close).not.toHaveBeenCalled();
  });
  it('closes an initialized companion if the account changed or listening fails',async()=>{
    const changed=setup();vi.mocked(changed.deps.create).mockResolvedValueOnce({...changed.session,identity:{id:2,login:'other'}});
    await expect(runCli([],changed.deps)).rejects.toThrow('account changed');expect(changed.session.close).toHaveBeenCalledTimes(1);expect(changed.session.listen).not.toHaveBeenCalled();
    const busy=setup();busy.session.listen.mockRejectedValueOnce(Object.assign(new Error('address in use'),{code:'EADDRINUSE'}));
    await expect(runCli([],busy.deps)).rejects.toThrow('--port 4319');expect(busy.session.close).toHaveBeenCalledTimes(1);expect(busy.deps.open).not.toHaveBeenCalled();
  });
});

describe('standalone noninteractive commands',()=>{
  it('runs help and version without GitHub, prompts, repository files, or a supported Node runtime',async()=>{
    const {deps}=setup();deps.nodeVersion='18.0.0';
    await runCli(['--help'],deps);await runCli(['--version'],deps);
    expect(deps.output).toHaveBeenCalledWith(expect.stringContaining('mergefoo connect'));
    expect(deps.output).toHaveBeenCalledWith(expect.stringContaining('mergefoo repair'));
    expect(deps.output).toHaveBeenCalledWith(`mergefoo ${COMPANION_VERSION}\n`);expect(deps.github.installed).not.toHaveBeenCalled();expect(deps.create).not.toHaveBeenCalled();
    expect(deps.inspectLock).not.toHaveBeenCalled();expect(deps.repairLock).not.toHaveBeenCalled();
  });
  it('doctor reads account and explicit repository access without starting or changing anything',async()=>{
    const {deps,github,ui}=setup();await runCli(['doctor','--repo','kernel/kernel'],deps);
    expect(github.verifyRepositories).toHaveBeenCalledWith(['kernel/kernel']);expect(github.owners).not.toHaveBeenCalled();expect(ui.confirm).not.toHaveBeenCalled();expect(deps.create).not.toHaveBeenCalled();expect(deps.open).not.toHaveBeenCalled();expect(deps.signIn).not.toHaveBeenCalled();
    expect(deps.inspectLock).toHaveBeenCalledTimes(1);expect(deps.repairLock).not.toHaveBeenCalled();
  });
  it('explicit options never prompt or open a browser, even in a terminal',async()=>{
    const {deps,ui,session}=setup();await expect(runCli(['--repo','kernel/kernel','--read-only','--no-open'],deps)).resolves.toBe(session);
    expect(ui.select).not.toHaveBeenCalled();expect(ui.multiselect).not.toHaveBeenCalled();expect(ui.confirm).not.toHaveBeenCalled();expect(deps.open).not.toHaveBeenCalled();
    expect(deps.create).toHaveBeenCalledWith(expect.objectContaining({repositories:['kernel/kernel'],readOnly:true}));
  });
  it('fails with a useful command instead of prompting when input is piped',async()=>{
    const {deps}=setup();deps.interactive=false;
    await expect(runCli([],deps)).rejects.toThrow('mergefoo connect --repo owner/name');expect(deps.github.installed).not.toHaveBeenCalled();
  });
  it('keeps settings flags noninteractive when input is piped and explains the missing repository',async()=>{
    const {deps,ui}=setup();deps.interactive=false;
    await expect(runCli(['--origin','http://127.0.0.1:3000','--read-only'],deps)).rejects.toThrow('mergefoo connect --repo owner/name');
    expect(ui.confirm).not.toHaveBeenCalled();expect(deps.github.installed).not.toHaveBeenCalled();
  });
});

describe('companion process lock guidance',()=>{
  it('repairs a stale lock without GitHub, prompts, browser, or connection startup',async()=>{
    const {deps,ui,github}=setup();deps.interactive=false;
    const directory=resolve('saved plans');
    await runCli(['repair','--state-dir','saved plans'],deps);
    expect(deps.repairLock).toHaveBeenCalledExactlyOnceWith(directory);
    expect(deps.inspectLock).not.toHaveBeenCalled();
    expect(github.installed).not.toHaveBeenCalled();expect(github.identity).not.toHaveBeenCalled();expect(github.verifyRepositories).not.toHaveBeenCalled();
    expect(deps.create).not.toHaveBeenCalled();expect(deps.signIn).not.toHaveBeenCalled();expect(deps.open).not.toHaveBeenCalled();expect(ui.confirm).not.toHaveBeenCalled();
    expect(ui.success).toHaveBeenCalledWith(expect.stringContaining('saved plans were kept'));
    expect(ui.outro).toHaveBeenCalledWith(`Run mergefoo connect --state-dir '${directory}' to start a new local connection.`);
  });
  it('reports an already unlocked folder without claiming to have removed a lock',async()=>{
    const {deps,ui}=setup();vi.mocked(deps.repairLock).mockResolvedValueOnce({state:'unlocked',path:'/private/plans/process.lock',repaired:false});
    await runCli(['repair'],deps);
    expect(ui.success).toHaveBeenCalledWith('The saved plans folder is unlocked. Your saved plans were kept.');
    expect(ui.outro).toHaveBeenCalledWith('Run mergefoo connect to start a new local connection.');
  });
  it.each(['running','unknown','invalid'] as const)('refuses to claim a repair when the lock is %s',async(state)=>{
    const {deps,ui,github}=setup();vi.mocked(deps.repairLock).mockResolvedValueOnce({state,path:'/private/plans/process.lock',pid:123,message:'The process cannot be verified.'});
    await expect(runCli(['repair'],deps)).rejects.toThrow('lock was kept');
    expect(github.installed).not.toHaveBeenCalled();expect(deps.create).not.toHaveBeenCalled();expect(deps.signIn).not.toHaveBeenCalled();expect(deps.open).not.toHaveBeenCalled();
    expect(ui.success).not.toHaveBeenCalled();expect(ui.outro).not.toHaveBeenCalled();
  });
  it('reports a running companion PID and asks to stop its original terminal',async()=>{
    const {deps,ui}=setup();vi.mocked(deps.inspectLock).mockResolvedValueOnce({state:'running',path:'/private/plans/process.lock',pid:456});
    await runCli(['doctor'],deps);
    expect(ui.warn).toHaveBeenCalledWith(expect.stringContaining('Companion process 456 is still running. Stop it with Ctrl-C in its original terminal'));
    expect(ui.outro).toHaveBeenCalledWith('Your GitHub setup is ready. Resolve the process lock above before connecting.');
    expect(deps.repairLock).not.toHaveBeenCalled();
  });
  it('reports a stale lock before GitHub checks and prints a safely quoted custom folder command',async()=>{
    const {deps,ui,github}=setup();const directory=resolve("a folder's saved plans");
    vi.mocked(deps.inspectLock).mockResolvedValueOnce({state:'stale',path:`${directory}/process.lock`,pid:789});
    github.installed.mockRejectedValueOnce(new SetupError('Install GitHub CLI.'));
    await expect(runCli(['doctor','--state-dir',"a folder's saved plans"],deps)).rejects.toThrow('Install GitHub CLI.');
    expect(deps.inspectLock).toHaveBeenCalledExactlyOnceWith(directory);
    const warning=`Companion process 789 has exited, but its process lock remains.\nRun: mergefoo repair --state-dir '${directory.replace(/'/g,"'\\''")}'`;
    expect(ui.warn).toHaveBeenCalledWith(warning);
    expect(vi.mocked(ui.warn).mock.invocationCallOrder[0]).toBeLessThan(github.installed.mock.invocationCallOrder[0]);
    expect(deps.repairLock).not.toHaveBeenCalled();expect(deps.create).not.toHaveBeenCalled();
  });
});
