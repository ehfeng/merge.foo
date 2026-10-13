import {constants} from 'node:fs';
import {chmod,lstat,mkdir,open,readdir,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ResourceKind,ScopeSnapshot,StateActor,StateAudit,StateRecord,StateStore} from '../server/state/types';
import {validateScope,validateWrite} from '../server/state/types';

type FileData={schemaVersion:1;records:Record<string,StateRecord>;history:Record<string,StateAudit[]>};
const empty=():FileData=>({schemaVersion:1,records:{},history:{}});
const MAX_FILE=20*1024*1024;
const code=(error:unknown)=>(error as NodeJS.ErrnoException)?.code;
const kindCheck=(kind:ResourceKind)=>{if(kind!=='plan'&&kind!=='workflow')throw new Error('The companion only persists plans and workflow intent.');};

/** An isolated store: numeric scope prefix is the CLI user ID, never an App installation. */
export class LocalStateStore implements StateStore {
  private data=empty();private tail:Promise<unknown>=Promise.resolve();private lockPath:string;private path:string;private closed=false;
  private constructor(private directory:string){this.path=join(directory,'state.json');this.lockPath=join(directory,'process.lock');}
  static async create(directory:string){
    const store=new LocalStateStore(resolve(directory));await mkdir(store.directory,{recursive:true,mode:0o700});
    const info=await lstat(store.directory);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Companion state must use a regular private directory.');
    if((await readdir(store.directory)).some(name=>!['state.json','process.lock'].includes(name)&&!/^\.state-[a-f0-9-]+\.tmp$/.test(name)))throw new Error('Choose a dedicated companion state directory; it contains unrelated files.');
    await chmod(store.directory,0o700);
    await store.acquireLock();
    try{const file=await open(store.path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const info=await file.stat();if(!info.isFile()||info.size>MAX_FILE)throw new Error('Companion state file is invalid or too large.');const parsed=JSON.parse(await file.readFile('utf8')) as FileData;if(parsed.schemaVersion!==1||!parsed.records||!parsed.history||Array.isArray(parsed.records)||Array.isArray(parsed.history))throw new Error('Companion state format is invalid.');store.data=parsed;await file.chmod(0o600);}finally{await file.close();}}catch(error){if(code(error)!=='ENOENT'){await store.close();throw error;}}
    return store;
  }
  private async acquireLock(){
    try{const file=await open(this.lockPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{await file.writeFile(JSON.stringify({pid:process.pid}));await file.sync();}finally{await file.close();}}
    catch(error){
      if(code(error)!=='EEXIST')throw error;
      // Automatically unlinking a stale lock can race another restart and allow
      // two writers. Fail closed; graceful shutdown removes our own lock.
      throw new Error('Another companion owns this state directory. If it crashed, verify its process has exited before removing process.lock.');
    }
  }
  private key(scope:string,kind:ResourceKind,key:string){validateScope(scope);kindCheck(kind);return `${scope}/${kind}/${key}`;}
  async read<T>(scope:string,kind:ResourceKind,key:string):Promise<StateRecord<T>|null>{await this.tail;return structuredClone(this.data.records[this.key(scope,kind,key)]??null) as StateRecord<T>|null;}
  async list<T>(scope:string,kind:ResourceKind):Promise<ScopeSnapshot<T>>{await this.tail;const prefix=this.key(scope,kind,'');return structuredClone({records:Object.entries(this.data.records).filter(([key])=>key.startsWith(prefix)).map(([,value])=>value),history:this.data.history[`${scope}/${kind}`]??[]}) as ScopeSnapshot<T>;}
  compareAndSwap<T>(scope:string,kind:ResourceKind,key:string,expectedVersion:number,value:T,actor:StateActor):Promise<StateRecord<T>|null>{
    const operation=this.tail.then(async()=>{
      if(this.closed)throw new Error('Companion state is closed.');validateWrite(scope,key,expectedVersion,value);const id=this.key(scope,kind,key);const previous=this.data.records[id];if((previous?.version??0)!==expectedVersion)return null;
      const version=(value as {version?:number})?.version;if(version!==expectedVersion+1)throw new Error('State version must increase exactly once.');
      const record:StateRecord<T>={key,kind,version,value:structuredClone(value),actor:structuredClone(actor),updatedAt:new Date().toISOString()};const next=structuredClone(this.data);next.records[id]=record;
      // Plan history is useful to the map. Workflow has its own bounded activity log.
      if(kind==='plan'){const historyKey=`${scope}/${kind}`;next.history[historyKey]=[{...record,id:randomUUID()},...(next.history[historyKey]??[])].slice(0,500);}
      const serialized=JSON.stringify(next);if(Buffer.byteLength(serialized)>MAX_FILE)throw new Error('Companion coordination state exceeded its storage limit.');
      const temporary=join(this.directory,`.state-${randomUUID()}.tmp`);const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      try{await file.writeFile(serialized);await file.sync();await file.close();await rename(temporary,this.path);this.data=next;const directory=await open(this.directory,constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}}catch(error){await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});throw error;}
      return structuredClone(record);
    });this.tail=operation.catch(()=>{});return operation;
  }
  async close(){await this.tail;if(this.closed)return;this.closed=true;await unlink(this.lockPath).catch(error=>{if(code(error)!=='ENOENT')throw error;});}
}
