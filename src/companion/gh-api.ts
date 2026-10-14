import {spawn} from 'node:child_process';
import type {GitHubApi} from '../server/github';
import {AccessError,isTransientGraphFailure} from '../server/github';
import {WorkflowTransportError} from '../workflow/types';

export type GhRunner=(args:string[],input?:string)=>Promise<string>;

/** Classifies a failed upstream read without changing uncertain write outcomes. */
export class GhRequestError extends WorkflowTransportError {
  constructor(message:string,outcome:'rejected'|'retryable'|'uncertain',readonly readRetryable=false,readonly upstreamStatus?:number){super(message,outcome);}
}

/** gh owns authentication. Its stored credential is never read or returned here. */
export const runGh:GhRunner=(args,input)=>new Promise((resolve,reject)=>{
  const env:NodeJS.ProcessEnv={...process.env,GH_HOST:'github.com',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GH_PAGER:'cat'};
  // Ambient tokens take precedence over gh's account. Always use the stored login.
  delete env.GH_TOKEN;delete env.GITHUB_TOKEN;delete env.GH_ENTERPRISE_TOKEN;delete env.GITHUB_ENTERPRISE_TOKEN;
  const child=spawn('gh',args,{env,stdio:['pipe','pipe','pipe'],shell:false});
  const chunks:Buffer[]=[];let size=0;let stderr='';let settled=false;
  const finish=(error?:Error,value?:string)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(value??'');};
  const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new GhRequestError('GitHub CLI timed out while waiting for GitHub. Try loading the repository again.','uncertain',true));},25000);
  child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>16*1024*1024){child.kill('SIGKILL');finish(new WorkflowTransportError('GitHub CLI response exceeded the safe size limit.','uncertain'));}else chunks.push(chunk);});
  child.stderr.on('data',(chunk:Buffer)=>{if(stderr.length<16000)stderr+=chunk.toString('utf8').slice(0,16000-stderr.length);});
  child.on('error',()=>finish(new AccessError('GitHub CLI is unavailable. Install gh and run gh auth login --hostname github.com.',503)));
  child.on('close',code=>{if(code!==0){const status=Number(stderr.match(/\bHTTP (\d{3})\b/)?.[1]);const limited=status===429||status===403&&/rate limit|secondary rate|abuse detection/i.test(stderr);finish(new GhRequestError(status?`GitHub CLI request failed (${status}).`:'GitHub CLI access failed. Check gh auth status --hostname github.com.',limited?'retryable':status>=400&&status<500?'rejected':'uncertain',[502,503,504].includes(status),status||undefined));}else finish(undefined,Buffer.concat(chunks).toString('utf8'));});
  child.stdin.on('error',()=>{});child.stdin.end(input);
});

export function ghApi(runner:GhRunner=runGh):GitHubApi {
  const request=async<T>(path:string,method='GET',body?:unknown):Promise<T>=>{
    if(!path.startsWith('/')||path.startsWith('//')||path.includes('://')||/[\r\n\\]/.test(path)||!['GET','POST','DELETE'].includes(method))throw new AccessError('Unsupported GitHub operation.',400);
    const args=['api','--hostname','github.com','--method',method,'--header','Accept: application/vnd.github+json','--header','X-GitHub-Api-Version: 2026-03-10',path];
    if(body!==undefined)args.push('--input','-');
    const started=Date.now();let text:string;
    try{text=await runner(args,body===undefined?undefined:JSON.stringify(body));}catch(error){
      // Safe diagnostic names contain neither variables nor repository/PR data.
      const query=path==='/graphql'&&(body as {query?:unknown})?.query;const operation=typeof query==='string'?query.match(/^\s*(?:query|mutation)\s+([A-Za-z][A-Za-z0-9_]*)/)?.[1]:undefined;
      if(error instanceof Error&&operation)error.message+=` GraphQL ${operation} (${Date.now()-started} ms).`;throw error;
    }
    if(!text.trim())return undefined as T;
    try{return JSON.parse(text) as T;}catch{throw new AccessError('GitHub CLI returned an invalid response.',502);}
  };
  return {request,async graph<T>(query:string,variables:Record<string,unknown>):Promise<T>{
    const result=await request<{data?:T;errors?:unknown[]}>('/graphql','POST',{query,variables});
    if(result.errors||!result.data){
      if(isTransientGraphFailure(result.errors))throw new GhRequestError('GitHub could not complete this graph read in time. Try loading the repository again.','uncertain',true);
      throw new AccessError('GitHub could not verify this repository. Check the CLI account and repository access.',502);
    }
    return result.data;
  }};
}
