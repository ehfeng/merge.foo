import {constants,closeSync,fstatSync,lstatSync,openSync,readSync,realpathSync,unlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,join,resolve} from 'node:path';

export type LockInspection={state:'unlocked'|'running'|'stale'|'unknown'|'invalid';path:string;pid?:number;message?:string;repaired?:boolean};
type FileIdentity={dev:number;ino:number;mtimeMs:number;size:number};
type Snapshot={inspection:LockInspection;directory?:string;file?:FileIdentity};
const code=(error:unknown)=>(error as NodeJS.ErrnoException)?.code;
const sameFile=(a:FileIdentity,b:FileIdentity)=>a.dev===b.dev&&a.ino===b.ino&&a.mtimeMs===b.mtimeMs&&a.size===b.size;
const noFollow=constants.O_NOFOLLOW??0;
const invalid=(path:string,message:string):Snapshot=>({inspection:{state:'invalid',path,message}});

function snapshot(input:string):Snapshot {
  let directory=resolve(input);let path=join(directory,'process.lock');
  try {
    const original=lstatSync(directory);
    if(!original.isDirectory()||original.isSymbolicLink())return invalid(path,'The saved plans folder must be a regular directory.');
    directory=realpathSync(directory);path=join(directory,'process.lock');const canonical=lstatSync(directory);
    if(!sameFile(original,canonical))return invalid(path,'The saved plans folder changed. Retry after it stops changing.');
    if(typeof process.getuid!=='function')return invalid(path,'Safe lock repair requires macOS or Linux ownership checks.');
    const uid=process.getuid();
    if(canonical.uid!==uid||(canonical.mode&0o077)!==0)return invalid(path,'The saved plans folder must belong to your user and be private.');
    let descriptor:number|undefined;
    try {
      descriptor=openSync(path,constants.O_RDONLY|noFollow|(constants.O_NONBLOCK??0));const file=fstatSync(descriptor);
      if(!file.isFile()||file.nlink!==1||file.uid!==uid||(file.mode&0o077)!==0||file.size<1||file.size>4096)return invalid(path,'The lock file is not a private, regular process record.');
      const buffer=Buffer.alloc(4097);const size=readSync(descriptor,buffer,0,buffer.length,0);
      if(size!==file.size||size>4096)return invalid(path,'The lock record changed or exceeds its size limit.');
      let data:unknown;try{data=JSON.parse(buffer.subarray(0,size).toString('utf8'));}catch{return invalid(path,'The lock record is invalid. No files were changed.');}
      const pid=data&&typeof data==='object'?(data as {pid?:unknown}).pid:undefined;
      if(!Number.isSafeInteger(pid)||Number(pid)<1||Number(pid)>2147483647)return invalid(path,'The lock record does not contain a valid process ID.');
      const current=lstatSync(path);if(current.isSymbolicLink()||!sameFile(file,current))return invalid(path,'The lock changed while it was being checked. Retry.');
      let state:LockInspection['state']='running';let message:string|undefined;
      try{process.kill(Number(pid),0);}catch(error){
        if(code(error)==='ESRCH')state='stale';
        else if(code(error)==='EPERM'){state='unknown';message='The recorded process may still be running; access to inspect it was denied.';}
        else {state='unknown';message='The recorded process could not be verified. No files were changed.';}
      }
      return {inspection:{state,path,pid:Number(pid),...(message?{message}:{})},directory,file};
    } finally {if(descriptor!==undefined)closeSync(descriptor);}
  } catch(error) {
    if(code(error)==='ENOENT')return {inspection:{state:'unlocked',path},directory};
    return invalid(path,'The saved plans lock could not be safely inspected. No files were changed.');
  }
}

/** Read-only; never opens saved plans or workflow state. */
export async function inspectStateLock(directory:string):Promise<LockInspection>{return snapshot(directory).inspection;}

/** Remove a dead process's lock only, with all cooperating repairs serialized.
 * The synchronous critical section cannot yield to another repair in this
 * process. Normal companions cannot replace an existing stale process.lock. */
export async function repairStateLock(directory:string):Promise<LockInspection> {
  const before=snapshot(directory);if(before.inspection.state!=='stale')return before.inspection;
  const claim=join(dirname(before.directory!),`.mergefoo-repair-${createHash('sha256').update(before.directory!).digest('hex')}.lock`);
  let descriptor:number|undefined;let claimed:FileIdentity|undefined;
  try {
    try{descriptor=openSync(claim,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|noFollow,0o600);claimed=fstatSync(descriptor);writeFileSync(descriptor,JSON.stringify({pid:process.pid}));}
    catch(error){if(code(error)==='EEXIST')return {...before.inspection,state:'unknown',message:`Another repair is in progress or was interrupted. Recovery record: ${claim}`};throw error;}
    // Re-read ownership after obtaining the exclusive repair claim. A process
    // started in the meantime, or any replacement lock, must remain untouched.
    const fresh=snapshot(before.directory!);
    if(fresh.inspection.state!=='stale')return fresh.inspection;
    if(!fresh.file||!sameFile(before.file!,fresh.file)||fresh.inspection.pid!==before.inspection.pid)return {...fresh.inspection,state:'unknown',message:'The lock changed before recovery. Run mergefoo repair again.'};
    const current=lstatSync(fresh.inspection.path);
    if(current.isSymbolicLink()||!sameFile(fresh.file,current))return {...fresh.inspection,state:'unknown',message:'The lock changed before recovery. No files were changed.'};
    // Repeat the liveness check immediately before unlink. Alive, reused and
    // inaccessible PIDs all fail closed; repair never sends a terminating signal.
    try{process.kill(fresh.inspection.pid!,0);return {...fresh.inspection,state:'running'};}
    catch(error){if(code(error)!=='ESRCH')return {...fresh.inspection,state:'unknown',message:'The recorded process could not be verified. No files were changed.'};}
    unlinkSync(fresh.inspection.path);
    return {state:'unlocked',path:fresh.inspection.path,repaired:true};
  } catch {return {...before.inspection,state:'unknown',message:'The lock could not be safely repaired. No saved plans were changed.'};}
  finally {
    if(descriptor!==undefined)closeSync(descriptor);
    if(claimed){try{const current=lstatSync(claim);if(current.dev===claimed.dev&&current.ino===claimed.ino&&!current.isSymbolicLink())unlinkSync(claim);}catch{/* Preserve an uncertain or replaced claim. */}}
  }
}
