import {describe,it,expect} from 'vitest';
import {resolve} from 'node:path';
import {defaultStateDirectory,parseArguments,parseCommand} from './arguments';

describe('standalone companion commands',()=>{
  it('starts guided setup by default and keeps help/version independent of configuration',()=>{
    expect(parseCommand([])).toMatchObject({command:'connect',guided:true,options:{origin:'https://merge.foo',port:4318,repositories:[]}});
    expect(parseCommand(['connect'])).toMatchObject({command:'connect',guided:true});
    expect(parseCommand(['doctor']).command).toBe('doctor');
    expect(parseArguments(['--help'])).toBeNull();expect(parseCommand(['--version']).command).toBe('version');
  });
  it('preserves explicit flags without any interactive setup or duplicated access',()=>{
    const parsed=parseCommand(['connect','--repo','Kernel/Kernel','--repo','kernel/kernel','--repo','kernel/tools','--origin','http://localhost:3000','--port','4321','--state-dir','test-state','--read-only','--no-open']);
    expect(parsed).toMatchObject({guided:false,openBrowser:false,options:{repositories:['Kernel/Kernel','kernel/tools'],origin:'http://localhost:3000',port:4321,stateDir:resolve('test-state'),readOnly:true}});
  });
  it('keeps guided repository selection when flags only configure the connection',()=>{
    expect(parseCommand(['connect','--origin','http://127.0.0.1:3000','--read-only','--no-open','--port','4320'])).toMatchObject({guided:true,openBrowser:false,options:{origin:'http://127.0.0.1:3000',readOnly:true,port:4320,repositories:[]}});
  });
  it.each([
    ['--repo'],['--repo','../../etc/passwd'],['--repo','owner/name?bad=1'],['--repo','owner/name\n'],
    ['--origin','http://example.com'],['--origin','https://merge.foo/extra'],['--origin','https://merge.foo/'],['--origin','https://user:password@merge.foo'],
    ['--port','0'],['--port','4318oops'],['--port','65536'],['--unknown'],['publish'],
  ])('rejects invalid input before GitHub or local state access: %j',(...args)=>{
    expect(()=>parseCommand(args)).toThrow();
  });
  it('bounds the explicit repository allowlist',()=>{
    expect(()=>parseCommand(Array.from({length:51},(_,index)=>['--repo',`owner/repo-${index}`]).flat())).toThrow(/50/);
  });
  it('stores plans outside the working directory with platform-specific defaults',()=>{
    expect(defaultStateDirectory('darwin',{},'/users/eric')).toBe('/users/eric/Library/Application Support/merge.foo/companion');
    expect(defaultStateDirectory('linux',{},'/users/eric')).toBe('/users/eric/.local/share/merge.foo/companion');
    expect(defaultStateDirectory('linux',{XDG_DATA_HOME:'/data'},'/users/eric')).toBe('/data/merge.foo/companion');
    expect(defaultStateDirectory('linux',{XDG_DATA_HOME:'relative'},'/users/eric')).toBe('/users/eric/.local/share/merge.foo/companion');
    expect(defaultStateDirectory('win32',{LOCALAPPDATA:'/local'},'/users/eric')).toBe('/local/merge.foo/companion');
  });
});
