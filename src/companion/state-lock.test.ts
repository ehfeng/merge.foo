import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {inspectStateLock,repairStateLock} from './state-lock';

describe('explicit companion state lock recovery',()=>{
  let parent:string,directory:string,lock:string;const deadPid=2147483646;
  beforeEach(()=>{parent=mkdtempSync(join(tmpdir(),'mergefoo-repair-'));directory=join(parent,'saved plans');mkdirSync(directory,{mode:0o700});lock=join(directory,'process.lock');writeFileSync(join(directory,'state.json'),'private saved plans and workflow intent\n',{mode:0o600});});
  afterEach(()=>{vi.restoreAllMocks();rmSync(parent,{recursive:true,force:true});});
  const absent=()=>{throw Object.assign(new Error('No such process'),{code:'ESRCH'});};
  const record=(path:string,pid:number)=>writeFileSync(path,JSON.stringify({pid}),{mode:0o600});
  const claim=(parent:string,directory:string)=>join(parent,`.mergefoo-repair-${createHash('sha256').update(realpathSync(directory)).digest('hex')}.lock`);

  it('diagnoses a stale lock without changing any files',async()=>{
    record(lock,deadPid);const contents=readFileSync(lock,'utf8');vi.spyOn(process,'kill').mockImplementation(absent);
    expect(await inspectStateLock(directory)).toMatchObject({state:'stale',pid:deadPid});expect(readFileSync(lock,'utf8')).toBe(contents);expect(readdirSync(parent)).toEqual(['saved plans']);
  });
  it('removes only a verified dead lock and preserves plans byte for byte',async()=>{
    record(lock,deadPid);const saved=readFileSync(join(directory,'state.json'));const probe=vi.spyOn(process,'kill').mockImplementation(absent);
    expect(await repairStateLock(directory)).toMatchObject({state:'unlocked',repaired:true});expect(existsSync(lock)).toBe(false);expect(readFileSync(join(directory,'state.json'))).toEqual(saved);expect(readdirSync(parent)).toEqual(['saved plans']);expect(probe.mock.calls.every(([,signal])=>signal===0)).toBe(true);
  });
  it('does not alter a live or reused process PID',async()=>{
    record(lock,process.pid);const before=readFileSync(lock);expect(await repairStateLock(directory)).toMatchObject({state:'running',pid:process.pid});expect(readFileSync(lock)).toEqual(before);expect(readdirSync(parent)).toEqual(['saved plans']);
  });
  it.each(['EPERM','EINVAL'])('does not remove a process whose liveness returns %s',async errorCode=>{
    record(lock,deadPid);vi.spyOn(process,'kill').mockImplementation(()=>{throw Object.assign(new Error('Unknown process'),{code:errorCode});});expect(await repairStateLock(directory)).toMatchObject({state:'unknown',pid:deadPid});expect(existsSync(lock)).toBe(true);
  });
  it.each(['','not json','{"pid":0}','{"pid":-1}','{"pid":"1"}','{"pid":2147483648}','x'.repeat(4097)])('preserves malformed process records',async value=>{
    writeFileSync(lock,value,{mode:0o600});expect(await repairStateLock(directory)).toMatchObject({state:'invalid'});expect(readFileSync(lock,'utf8')).toBe(value);
  });
  it('refuses symlinked locks and saved plans directories',async()=>{
    const target=join(parent,'other-file');record(target,deadPid);symlinkSync(target,lock);expect(await repairStateLock(directory)).toMatchObject({state:'invalid'});expect(readFileSync(target,'utf8')).toBe(JSON.stringify({pid:deadPid}));
    const alias=join(parent,'alias');symlinkSync(directory,alias);expect(await inspectStateLock(alias)).toMatchObject({state:'invalid'});
  });
  it('refuses non-private lock and folder permissions',async()=>{
    record(lock,deadPid);chmodSync(lock,0o644);expect(await repairStateLock(directory)).toMatchObject({state:'invalid'});chmodSync(lock,0o600);chmodSync(directory,0o755);expect(await repairStateLock(directory)).toMatchObject({state:'invalid'});expect(existsSync(lock)).toBe(true);
  });
  it('does not compete with another repair claim or remove it',async()=>{
    record(lock,deadPid);vi.spyOn(process,'kill').mockImplementation(absent);const owner=claim(parent,directory);record(owner,process.pid);expect(await repairStateLock(directory)).toMatchObject({state:'unknown'});expect(existsSync(lock)).toBe(true);expect(readFileSync(owner,'utf8')).toBe(JSON.stringify({pid:process.pid}));
  });
  it('rechecks the process under the claim before removing a stale lock',async()=>{
    record(lock,deadPid);let probes=0;vi.spyOn(process,'kill').mockImplementation(()=>{if(++probes===1)return absent();return true;});expect(await repairStateLock(directory)).toMatchObject({state:'running'});expect(existsSync(lock)).toBe(true);expect(readdirSync(parent)).toEqual(['saved plans']);
  });
  it('preserves a replacement lock that appeared after the initial check',async()=>{
    record(lock,deadPid);const replaced=join(parent,'new-lock');record(replaced,12345);let probes=0;
    vi.spyOn(process,'kill').mockImplementation(()=>{if(++probes===1)renameSync(replaced,lock);return absent();});expect(await repairStateLock(directory)).toMatchObject({state:'unknown'});expect(readFileSync(lock,'utf8')).toBe(JSON.stringify({pid:12345}));expect(readdirSync(parent)).toEqual(['saved plans']);
  });
  it('does not create folders or files when no lock exists',async()=>{
    expect(await repairStateLock(directory)).toMatchObject({state:'unlocked'});const missing=join(parent,'missing');expect(await repairStateLock(missing)).toMatchObject({state:'unlocked'});expect(existsSync(missing)).toBe(false);expect(readdirSync(parent)).toEqual(['saved plans']);
  });
});
