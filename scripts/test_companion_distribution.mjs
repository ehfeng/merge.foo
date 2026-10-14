import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {chmod,copyFile,lstat,mkdir,mkdtemp,readFile,readdir,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function run(command,args,options={}){
  const child=spawn(command,args,{shell:false,stdio:['ignore','pipe','pipe'],...options});
  let stdout='';let stderr='';child.stdout.on('data',data=>{stdout+=data;});child.stderr.on('data',data=>{stderr+=data;});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});return {code,stdout,stderr};
}
if(!process.argv.includes('--no-build')){
  const build=await run(process.execPath,[join(root,'scripts/build_companion_distribution.mjs')],{cwd:root});
  if(build.code!==0)throw new Error(build.stdout+build.stderr);
}
const fixture=await mkdtemp(join(tmpdir(),'mergefoo-distribution-'));
let server;
try{
  // The executable is copied beyond the checkout and has no nearby node_modules.
  const isolated=join(fixture,'isolated');await mkdir(isolated);
  const executable=join(isolated,'mergefoo.mjs');await copyFile(join(root,'dist/companion/mergefoo.mjs'),executable);
  const help=await run(process.execPath,[executable,'--help'],{cwd:isolated,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(help.code,0,help.stderr);assert.match(help.stdout,/merge\.foo/i);

  const manifest=JSON.parse(await readFile(join(root,'public/cli/latest.json'),'utf8'));
  const version=await run(process.execPath,[executable,'--version'],{cwd:isolated,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(version.code,0,version.stderr);assert.match(version.stdout,new RegExp(manifest.version.replaceAll('.','\\.')));
  const originalRuntime=await readFile(executable);
  assert.equal(manifest.bundle.sha256,createHash('sha256').update(originalRuntime).digest('hex'));
  // Repair works without GitHub or repository dependencies, removes only a
  // dead process record, and retains plans and live process locks.
  const recovery=join(fixture,"private saved ' plans");await mkdir(recovery,{mode:0o700});
  const savedPlans=join(recovery,'state.json'),processLock=join(recovery,'process.lock');
  await writeFile(savedPlans,'preserve saved plans exactly\n',{mode:0o600});
  const exited=await run(process.execPath,['-e','process.stdout.write(String(process.pid))']);assert.equal(exited.code,0);
  await writeFile(processLock,JSON.stringify({pid:Number(exited.stdout)}),{mode:0o600});
  const repaired=await run(process.execPath,[executable,'repair','--state-dir',recovery],{cwd:isolated,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(repaired.code,0,repaired.stderr);assert.match(repaired.stdout,/saved plans were kept/i);await assert.rejects(lstat(processLock),{code:'ENOENT'});assert.equal(await readFile(savedPlans,'utf8'),'preserve saved plans exactly\n');
  await writeFile(processLock,JSON.stringify({pid:process.pid}),{mode:0o600});
  const alive=await run(process.execPath,[executable,'repair','--state-dir',recovery],{cwd:isolated,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(alive.code,1);assert.match(alive.stderr,/still running/i);assert.equal(JSON.parse(await readFile(processLock,'utf8')).pid,process.pid);
  const fakeBin=join(fixture,'test binaries');await mkdir(fakeBin);
  await symlink(process.execPath,join(fakeBin,'node'));
  await writeFile(join(fakeBin,'gh'),'#!/bin/sh\nexit 0\n',{mode:0o700});
  let currentManifest=manifest;let currentRuntime=originalRuntime;let bundleStatus=200;
  server=createServer((request,response)=>{
    if(request.url==='/cli/latest.json'){response.setHeader('Content-Type','application/json');response.end(JSON.stringify(currentManifest));}
    else if(request.url===manifest.bundle.path){response.statusCode=bundleStatus;response.end(currentRuntime);}
    else{response.statusCode=404;response.end('Unknown fixture.');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}`;
  const install=async(directory,env={})=>run('/bin/sh',[join(root,'scripts/install-companion.sh')],{cwd:isolated,env:{...process.env,PATH:`${fakeBin}:/usr/bin:/bin`,MERGEFOO_DOWNLOAD_BASE_URL:base,MERGEFOO_INSTALL_DIR:directory,...env}});
  const destination=join(fixture,"a quoted ' install path");
  const installed=await install(destination);assert.equal(installed.code,0,installed.stderr);
  assert.match(installed.stdout,/Installed merge\.foo/);
  assert.match(installed.stdout,/export PATH=/);
  const runtimePath=join(destination,'runtime.mjs');const wrapperPath=join(destination,'bin/mergefoo');
  assert.equal((await lstat(destination)).mode&0o777,0o700);
  assert.equal((await lstat(runtimePath)).mode&0o777,0o600);
  assert.equal((await lstat(wrapperPath)).mode&0o777,0o700);
  assert.deepEqual(await readFile(runtimePath),originalRuntime);
  const installedHelp=await run(wrapperPath,['--help'],{cwd:isolated,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(installedHelp.code,0,installedHelp.stderr);assert.match(installedHelp.stdout,/merge\.foo/i);
  const upgradedNodeBin=join(fixture,'upgraded node');await mkdir(upgradedNodeBin);
  const nodeMarker=join(fixture,'node lookup marker');
  const quote=value=>`'${value.replaceAll("'","'\\''")}'`;
  await writeFile(join(upgradedNodeBin,'node'),`#!/bin/sh\nprintf used > ${quote(nodeMarker)}\nexec ${quote(process.execPath)} "$@"\n`,{mode:0o700});
  const currentNode=await run(wrapperPath,['--version'],{cwd:isolated,env:{PATH:`${upgradedNodeBin}:/usr/bin:/bin`}});
  assert.equal(currentNode.code,0,currentNode.stderr);assert.equal(await readFile(nodeMarker,'utf8'),'used');
  const wrapper=await readFile(wrapperPath);
  const upgrade=await install(destination);assert.equal(upgrade.code,0,upgrade.stderr);
  assert.deepEqual(await readFile(wrapperPath),wrapper);
  assert.equal((await readdir(destination)).some(name=>name.startsWith('.install')),false);

  currentRuntime=Buffer.from('throw new Error("An unverified executable was executed");\n');
  const corrupt=await install(destination);assert.equal(corrupt.code,1);assert.match(corrupt.stderr,/SHA-256/);
  assert.deepEqual(await readFile(runtimePath),originalRuntime);assert.deepEqual(await readFile(wrapperPath),wrapper);
  const freshCorrupt=join(fixture,'fresh corrupt');await install(freshCorrupt);
  await assert.rejects(lstat(freshCorrupt),{code:'ENOENT'});
  currentRuntime=originalRuntime;

  currentManifest={...manifest,bundle:{...manifest.bundle,path:'https://other.example/mergefoo.mjs'}};
  const crossOrigin=await install(join(fixture,'different origin'));assert.equal(crossOrigin.code,1);assert.match(crossOrigin.stderr,/manifest is invalid/);
  currentManifest=manifest;
  const manifestOrigin=await install(join(fixture,'manifest origin'),{MERGEFOO_MANIFEST_URL:'https://other.example/manifest.json'});
  assert.equal(manifestOrigin.code,1);assert.match(manifestOrigin.stderr,/trusted download origin/);

  bundleStatus=404;const missing=await install(join(fixture,'missing download'));assert.equal(missing.code,1);assert.match(missing.stderr,/Download failed/);bundleStatus=200;
  const blocked=join(fixture,'not writable');await mkdir(blocked,{mode:0o500});
  const blockedInstall=await install(blocked);assert.equal(blockedInstall.code,1);assert.match(blockedInstall.stderr,/not writable/);await chmod(blocked,0o700);
  const unrelated=join(fixture,'unrelated existing directory');await mkdir(unrelated,{mode:0o755});await chmod(unrelated,0o755);
  await writeFile(join(unrelated,'keep.txt'),'Keep my files and permissions.');
  const sharedDirectory=await install(unrelated);assert.equal(sharedDirectory.code,1);assert.match(sharedDirectory.stderr,/dedicated MERGEFOO_INSTALL_DIR/);
  assert.equal((await lstat(unrelated)).mode&0o777,0o755);assert.deepEqual(await readdir(unrelated),['keep.txt']);assert.equal(await readFile(join(unrelated,'keep.txt'),'utf8'),'Keep my files and permissions.');
  const unrelatedBin=join(fixture,'unrelated existing bin');await mkdir(join(unrelatedBin,'bin'),{recursive:true});await chmod(unrelatedBin,0o755);
  await writeFile(join(unrelatedBin,'bin','another-command'),'Keep this command.');
  const sharedBin=await install(unrelatedBin);assert.equal(sharedBin.code,1);assert.match(sharedBin.stderr,/bin directory contains unrelated/);
  assert.equal((await lstat(unrelatedBin)).mode&0o777,0o755);assert.deepEqual(await readdir(join(unrelatedBin,'bin')),['another-command']);
  const symlinkDirectory=join(fixture,'symlink');await symlink(destination,symlinkDirectory);
  const symlinkInstall=await install(symlinkDirectory);assert.equal(symlinkInstall.code,1);assert.match(symlinkInstall.stderr,/regular directory/);
  const noGhBin=join(fixture,'node only');await mkdir(noGhBin);await symlink(process.execPath,join(noGhBin,'node'));
  const noGh=await install(join(fixture,'missing gh'),{PATH:`${noGhBin}:/usr/bin:/bin`});assert.equal(noGh.code,1);assert.match(noGh.stderr,/GitHub CLI is needed/);
  process.stdout.write('Companion distribution passed: isolated help/version, stale lock repair/live lock refusal with saved plans retained, quoted install path, private files, Node upgrades, reinstall, checksum failure, origin checks, missing download, non-writable/unrelated/symlink paths, and missing gh.\n');
}finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  await rm(fixture,{recursive:true,force:true});
}
