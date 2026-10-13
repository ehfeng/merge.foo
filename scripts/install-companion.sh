#!/bin/sh
# Downloaded from merge.foo. No npm install, repository checkout, or elevated
# privileges are required. The Node bootstrap verifies bytes before installing.
set -eu

printf '\n  merge.foo\n  Your GitHub workspace, connected from this computer.\n\n'
if ! command -v node >/dev/null 2>&1; then
  printf 'Node.js 22 or newer is needed.\n\n  macOS: brew install node\n  Linux: https://nodejs.org/en/download\n\nThen run this installer again.\n' >&2
  exit 1
fi
node --input-type=module - <<'MERGEFOO_INSTALL_NODE'
import {constants} from 'node:fs';
import {access,chmod,lstat,mkdir,mkdtemp,open,readFile,readdir,rename,rm,rmdir,unlink,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

const fail=message=>{throw new Error(message);};
const errorCode=error=>error?.code;
const major=Number(process.versions.node.split('.')[0]);
let runtimeStage;
let wrapperStage;
let installLock;
let runtimeChanged=false;
let wrapperChanged=false;
let priorRuntime=false;
let priorWrapper=false;
let runtimePath;
let wrapperPath;
let createdDirectories=[];
async function existingFile(path){
  try{const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())fail(`Choose a regular file location: ${path}`);return true;}catch(error){if(errorCode(error)==='ENOENT')return false;throw error;}
}
async function ensureDirectory(path,privateDirectory=false){
  const missing=[];
  let current=path;
  for(;;){
    try{const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())fail(`Choose a regular directory: ${current}`);if((info.mode&0o222)===0)fail(`Installation directory is not writable: ${current}`);await access(current,constants.W_OK);break;}catch(error){if(errorCode(error)!=='ENOENT')throw error;missing.push(current);current=dirname(current);}
  }
  await mkdir(path,{recursive:true,mode:0o700});createdDirectories.push(...missing.reverse());
  if(privateDirectory)await chmod(path,0o700);
}
async function requireDedicatedDirectory(path,custom){
  try{
    const info=await lstat(path);
    if(!info.isDirectory()||info.isSymbolicLink())fail(`Choose a regular directory: ${path}`);
    const expected=new Set(['runtime.mjs','.install.lock',...(custom?['bin']:[])]);
    if((await readdir(path)).some(name=>!expected.has(name)&&!/^\.install-[A-Za-z0-9]{6}$/.test(name)))fail(`Choose a dedicated MERGEFOO_INSTALL_DIR; this directory contains unrelated files: ${path}`);
    if(custom){
      try{
        const bin=join(path,'bin');const info=await lstat(bin);
        if(!info.isDirectory()||info.isSymbolicLink())fail(`Choose a regular directory: ${bin}`);
        if((await readdir(bin)).some(name=>name!=='mergefoo'&&!/^\.mergefoo-install-[A-Za-z0-9]{6}$/.test(name)))fail(`Choose a dedicated MERGEFOO_INSTALL_DIR; its bin directory contains unrelated files: ${bin}`);
      }catch(error){if(errorCode(error)!=='ENOENT')throw error;}
    }
  }catch(error){if(errorCode(error)!=='ENOENT')throw error;}
}
const shellQuote=value=>`'${value.replaceAll("'","'\\''")}'`;
async function download(url,limit){
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)fail(`Download failed (${response.status}): ${url.pathname}`);
  if(Number(response.headers.get('content-length'))>limit)fail('The download exceeds its expected size.');
  const reader=response.body.getReader();let size=0;const pieces=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('The download exceeds its expected size.');}pieces.push(value);}
  return Buffer.concat(pieces);
}

try{
  if(major<22)fail(`Node.js 22 or newer is needed; this computer has ${process.versions.node}.\n\n  macOS: brew upgrade node\n  Linux: https://nodejs.org/en/download\n\nThen run this installer again.`);
  if(!['darwin','linux'].includes(process.platform))fail('This installer supports macOS and Linux. Download the .mjs executable from https://merge.foo/cli/latest.json and run it with Node.js on Windows.');
  const gh=spawnSync('gh',['--version'],{stdio:'ignore',shell:false});
  if(gh.error||gh.status!==0)fail('GitHub CLI is needed to keep your GitHub login on this computer.\n\n  macOS: brew install gh\n  Linux: https://cli.github.com/manual/installation\n\nThen run this installer again.');
  const configuredBase=process.env.MERGEFOO_DOWNLOAD_BASE_URL;
  const base=new URL(configuredBase||'https://merge.foo');
  const testLoopback=!!configuredBase&&base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname);
  if((base.protocol!=='https:'&&!testLoopback)||base.username||base.password||base.pathname!=='/'||base.search||base.hash)fail('The download base must be an HTTPS origin.');
  const manifestUrl=new URL(process.env.MERGEFOO_MANIFEST_URL||'/cli/latest.json',base);
  if(manifestUrl.origin!==base.origin||manifestUrl.username||manifestUrl.password||manifestUrl.hash)fail('The release manifest must use the trusted download origin.');
  process.stdout.write('  Checking the latest companion…\n');
  const manifest=JSON.parse((await download(manifestUrl,64*1024)).toString('utf8'));
  if(manifest.schemaVersion!==1||!/^\d+\.\d+\.\d+$/.test(manifest.version)||!Number.isSafeInteger(manifest.minimumNodeMajor)||manifest.minimumNodeMajor<22||!manifest.bundle||typeof manifest.bundle.path!=='string'||manifest.bundle.path!==`/cli/v${manifest.version}/mergefoo.mjs`||!/^[a-f0-9]{64}$/.test(manifest.bundle.sha256)||!Number.isSafeInteger(manifest.bundle.bytes)||manifest.bundle.bytes<1||manifest.bundle.bytes>20*1024*1024)fail('The release manifest is invalid. No files were installed.');
  if(major<manifest.minimumNodeMajor)fail(`This release requires Node.js ${manifest.minimumNodeMajor} or newer. Upgrade Node and run the installer again.`);
  const bundleUrl=new URL(manifest.bundle.path,base);
  if(bundleUrl.origin!==base.origin)fail('The executable must use the trusted download origin.');
  process.stdout.write(`  Downloading merge.foo ${manifest.version}…\n`);
  const runtime=await download(bundleUrl,manifest.bundle.bytes);
  if(runtime.length!==manifest.bundle.bytes||createHash('sha256').update(runtime).digest('hex')!==manifest.bundle.sha256)fail('The download failed its SHA-256 check. No files were installed. Try again.');
  const custom=process.env.MERGEFOO_INSTALL_DIR;
  if(custom&&!isAbsolute(custom))fail('MERGEFOO_INSTALL_DIR must be an absolute directory path.');
  const runtimeDirectory=custom?resolve(custom):join(homedir(),'.local/share/mergefoo');
  const wrapperDirectory=custom?join(runtimeDirectory,'bin'):join(homedir(),'.local/bin');
  runtimePath=join(runtimeDirectory,'runtime.mjs');wrapperPath=join(wrapperDirectory,'mergefoo');
  // Do not privatize an unrelated existing folder such as /tmp or a checkout.
  await requireDedicatedDirectory(runtimeDirectory,!!custom);
  await ensureDirectory(runtimeDirectory,true);await ensureDirectory(wrapperDirectory);
  priorRuntime=await existingFile(runtimePath);priorWrapper=await existingFile(wrapperPath);
  installLock=await open(join(runtimeDirectory,'.install.lock'),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  runtimeStage=await mkdtemp(join(runtimeDirectory,'.install-'));wrapperStage=await mkdtemp(join(wrapperDirectory,'.mergefoo-install-'));
  await chmod(runtimeStage,0o700);await chmod(wrapperStage,0o700);
  if(priorRuntime)await writeFile(join(runtimeStage,'previous'),await readFile(runtimePath),{mode:0o600});
  if(priorWrapper)await writeFile(join(wrapperStage,'previous'),await readFile(wrapperPath),{mode:0o700});
  await writeFile(join(runtimeStage,'runtime.mjs'),runtime,{mode:0o600});
  // Follow the current Node on PATH across package-manager upgrades. The known
  // installer Node is a fallback for terminals whose PATH omits Node entirely.
  const wrapper=`#!/bin/sh\nif command -v node >/dev/null 2>&1; then\n  exec node ${shellQuote(runtimePath)} "$@"\nelif [ -x ${shellQuote(process.execPath)} ]; then\n  exec ${shellQuote(process.execPath)} ${shellQuote(runtimePath)} "$@"\nfi\nprintf 'Node.js 22 or newer is needed. Install it from https://nodejs.org, then try again.\\n' >&2\nexit 1\n`;
  await writeFile(join(wrapperStage,'mergefoo'),wrapper,{mode:0o700});
  await rename(join(runtimeStage,'runtime.mjs'),runtimePath);runtimeChanged=true;
  await rename(join(wrapperStage,'mergefoo'),wrapperPath);wrapperChanged=true;
  process.stdout.write(`  ✓ Installed merge.foo ${manifest.version}\n\n`);
  const onPath=(process.env.PATH||'').split(':').some(entry=>resolve(entry||'.')===wrapperDirectory);
  if(onPath){process.stdout.write('  Next: mergefoo connect\n\n');}
  else{
    process.stdout.write(`  Next: ${shellQuote(wrapperPath)} connect\n\n  To use “mergefoo” from any terminal, add this to your shell profile:\n\n    export PATH=${shellQuote(wrapperDirectory)}:"$PATH"\n\n`);
  }
}catch(error){
  if(wrapperChanged){try{if(priorWrapper)await rename(join(wrapperStage,'previous'),wrapperPath);else await unlink(wrapperPath);}catch{process.stderr.write('Could not restore the previous command; reinstall to repair it.\n');}}
  if(runtimeChanged){try{if(priorRuntime)await rename(join(runtimeStage,'previous'),runtimePath);else await unlink(runtimePath);}catch{process.stderr.write('Could not restore the previous runtime; reinstall to repair it.\n');}}
  process.stderr.write(`\n  ${error?.message||'Installation failed.'}\n`);process.exitCode=1;
}finally{
  if(runtimeStage)await rm(runtimeStage,{recursive:true,force:true});
  if(wrapperStage)await rm(wrapperStage,{recursive:true,force:true});
  if(installLock){await installLock.close();await unlink(join(dirname(runtimePath),'.install.lock')).catch(()=>{});}
  if(process.exitCode)for(const path of createdDirectories.reverse())try{await rmdir(path);}catch{}
}
MERGEFOO_INSTALL_NODE
