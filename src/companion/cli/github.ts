import {spawn} from 'node:child_process';
import {ghApi,runGh,type GhRunner} from '../gh-api';
import {validOwner,validRepository} from './arguments';
import {plainText} from './terminal';

export type Identity={id:number;login:string};
export type Owner={login:string;personal:boolean};
export type Repository={fullName:string;private:boolean;description:string};
export class SetupError extends Error {constructor(message:string,readonly reason:'missing-gh'|'sign-in'|'access'='access'){super(message);}}

export const installationGuidance=(platform=process.platform)=>platform==='darwin'
  ?'Install GitHub CLI with: brew install gh\nOr visit https://cli.github.com, then run mergefoo connect again.'
  :platform==='win32'?'Install GitHub CLI with: winget install --id GitHub.cli\nOr visit https://cli.github.com, then run mergefoo connect again.'
  :'Install GitHub CLI: https://github.com/cli/cli/blob/trunk/docs/install_linux.md\nThen run mergefoo connect again.';

const signInError=()=>new SetupError('Sign in to GitHub CLI, then try again:\n  gh auth login --hostname github.com --web\nTo check or switch accounts:\n  gh auth status --hostname github.com\n  gh auth switch --hostname github.com','sign-in');

export function createGitHub(runner:GhRunner=runGh){
  const api=ghApi(runner);
  return {
    async installed(){
      try{await runner(['--version']);}catch{throw new SetupError(`GitHub CLI is not available.\n${installationGuidance()}`,'missing-gh');}
    },
    async identity():Promise<Identity>{
      let user:Identity;
      try{user=await api.request<Identity>('/user');}
      catch(error){
        // A failed API call alone does not mean the user needs to sign in again.
        // The status projection contains no token; network and rate-limit
        // failures get retry guidance rather than an unnecessary login prompt.
        let needsSignIn=error instanceof Error&&/request failed \(401\)/.test(error.message);
        if(!needsSignIn){
          try{
            const status:unknown=JSON.parse(await runner(['auth','status','--hostname','github.com','--active','--json','hosts','--jq','.hosts["github.com"] // [] | map({active, state, error})']));
            if(Array.isArray(status))needsSignIn=status.length===0||status.some(entry=>entry?.active===true&&entry.state==='error'&&typeof entry.error==='string'&&/\b(?:HTTP )?401\b|bad credentials/i.test(entry.error));
          }catch{/* An unavailable status check does not imply missing authentication. */}
        }
        if(needsSignIn)throw signInError();
        throw new SetupError('Could not reach or verify your GitHub account. Check your connection and try again.\nYou can check GitHub CLI with: gh auth status --hostname github.com\nRun mergefoo doctor to retry.');
      }
      if(!Number.isSafeInteger(user?.id)||user.id<=0||typeof user.login!=='string'||!validOwner(user.login))throw new SetupError('GitHub could not verify your account. Run gh auth status --hostname github.com.');
      return user;
    },
    async owners(user:Identity):Promise<{owners:Owner[];limited:boolean}>{
      const owners:Owner[]=[{login:user.login,personal:true}];let limited=false;
      for(let page=1;page<=5;page++){
        const organizations=await api.request<{login:string}[]>(`/user/orgs?per_page=100&page=${page}`);
        if(!Array.isArray(organizations))throw new SetupError('GitHub could not list your organizations. Try mergefoo connect --repo owner/name.');
        for(const org of organizations)if(typeof org?.login==='string'&&validOwner(org.login)&&!owners.some(owner=>owner.login.toLowerCase()===org.login.toLowerCase()))owners.push({login:org.login,personal:false});
        if(organizations.length<100)break;if(page===5)limited=true;
      }
      return {owners,limited};
    },
    async repositories(owner:string):Promise<{repositories:Repository[];limited:boolean}>{
      if(!validOwner(owner))throw new SetupError('Choose a valid GitHub user or organization name.');
      let raw:unknown;try{raw=JSON.parse(await runner(['repo','list',owner,'--no-archived','--limit','1000','--json','nameWithOwner,isPrivate,isArchived,description']));}
      catch{throw new SetupError(`Could not list repositories for ${owner}. Check access with gh repo list ${owner}.\nYou can also connect directly: mergefoo connect --repo ${owner}/repository-name`);}
      if(!Array.isArray(raw))throw new SetupError('GitHub CLI returned an unexpected repository list. Run mergefoo doctor.');
      const repositories:Repository[]=[];
      for(const row of raw){
        if(typeof row?.nameWithOwner!=='string'||!validRepository(row.nameWithOwner)||row.nameWithOwner.split('/')[0].toLowerCase()!==owner.toLowerCase()||row.isArchived!==false||typeof row.isPrivate!=='boolean')continue;
        if(!repositories.some(repo=>repo.fullName.toLowerCase()===row.nameWithOwner.toLowerCase()))repositories.push({fullName:row.nameWithOwner,private:row.isPrivate,description:typeof row.description==='string'?plainText(row.description,90):''});
      }
      repositories.sort((a,b)=>a.fullName.localeCompare(b.fullName));
      return {repositories,limited:raw.length>=1000};
    },
    async verifyRepositories(selected:string[]):Promise<Repository[]>{
      const repositories:Repository[]=[];
      for(const repository of selected){
        if(!validRepository(repository))throw new SetupError('Choose a repository using owner/name.');
        let metadata:{id:number;full_name:string;archived:boolean;private:boolean;description?:string};
        try{metadata=await api.request(`/repos/${repository}`);}catch{throw new SetupError(`Your GitHub account cannot access ${repository}.\nCheck access: gh repo view ${repository}\nIf your organization uses SSO, authorize your GitHub CLI sign-in on GitHub, then try again.`);}
        if(!Number.isSafeInteger(metadata?.id)||metadata.id<=0||typeof metadata.full_name!=='string'||metadata.full_name.toLowerCase()!==repository.toLowerCase()||!validRepository(metadata.full_name)||metadata.archived!==false||typeof metadata.private!=='boolean')throw new SetupError(`${repository} is archived, renamed, or could not be verified. Choose its current repository name.`);
        repositories.push({fullName:metadata.full_name,private:metadata.private,description:typeof metadata.description==='string'?plainText(metadata.description,90):''});
      }
      return repositories;
    },
  };
}

/** This only runs after an explicit choice to sign in through GitHub CLI. */
export function signInWithGitHub():Promise<void>{
  const env:NodeJS.ProcessEnv={...process.env,GH_HOST:'github.com',GH_NO_UPDATE_NOTIFIER:'1'};
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN','GITHUB_ENTERPRISE_TOKEN','GH_PROMPT_DISABLED'])delete env[key];
  return new Promise((resolve,reject)=>{
    const child=spawn('gh',['auth','login','--hostname','github.com','--web'],{env,stdio:'inherit',shell:false});
    child.once('error',()=>reject(new SetupError(`GitHub CLI is not available.\n${installationGuidance()}`,'missing-gh')));
    child.once('exit',code=>code===0?resolve():reject(new SetupError('GitHub sign-in did not finish. Run gh auth login --hostname github.com --web, then mergefoo connect.','sign-in')));
  });
}
