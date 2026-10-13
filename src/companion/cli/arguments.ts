import {homedir} from 'node:os';
import {isAbsolute,join,resolve} from 'node:path';
import type {CompanionOptions} from '../server';

export type Command={command:'connect'|'doctor'|'help'|'version';options:CompanionOptions;guided:boolean;openBrowser:boolean};
export const validOwner=(owner:string)=>/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner);
export const validRepository=(repository:string)=>/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)&&repository.split('/').every(part=>part!=='.'&&part!=='..')&&validOwner(repository.split('/')[0]);

export function defaultStateDirectory(platform=process.platform,env:Record<string,string|undefined>=process.env,home=homedir()):string {
  if(platform==='darwin')return join(home,'Library','Application Support','merge.foo','companion');
  if(platform==='win32')return join(env.LOCALAPPDATA&&isAbsolute(env.LOCALAPPDATA)?env.LOCALAPPDATA:join(home,'AppData','Local'),'merge.foo','companion');
  return join(env.XDG_DATA_HOME&&isAbsolute(env.XDG_DATA_HOME)?env.XDG_DATA_HOME:join(home,'.local','share'),'merge.foo','companion');
}

export function parseCommand(args:string[]):Command {
  const options:CompanionOptions={origin:'https://merge.foo',port:4318,repositories:[],stateDir:defaultStateDirectory()};
  const result:Command={command:'connect',options,guided:true,openBrowser:true};
  if(args.includes('--help')||args.includes('-h')||args[0]==='help'){result.command='help';return result;}
  if(args.includes('--version')||args.includes('-v')){result.command='version';return result;}
  let index=0;
  if(args[0]&&!args[0].startsWith('-')){
    if(!['connect','doctor'].includes(args[0]))throw new Error(`Unknown command: ${args[0]}. Run mergefoo --help for available commands.`);
    result.command=args[0] as 'connect'|'doctor';index++;
  }
  for(;index<args.length;index++){
    const flag=args[index];if(flag==='--')continue;
    if(flag==='--read-only'){options.readOnly=true;continue;}
    if(flag==='--no-open'){result.openBrowser=false;continue;}
    if(!['--repo','--origin','--port','--state-dir'].includes(flag))throw new Error(`Unknown option: ${flag}. Run mergefoo --help for available options.`);
    const value=args[++index];if(!value||value.startsWith('--'))throw new Error(`Provide a value for ${flag}.`);
    if(flag==='--repo'){
      result.guided=false;
      if(!validRepository(value))throw new Error('Use --repo owner/name, for example --repo kernel/kernel.');
      if(!options.repositories.some(repository=>repository.toLowerCase()===value.toLowerCase()))options.repositories.push(value);
    }else if(flag==='--origin')options.origin=value;
    else if(flag==='--state-dir')options.stateDir=resolve(value);
    else{
      if(!/^\d+$/.test(value)||Number(value)<1024||Number(value)>65535)throw new Error('Choose a port between 1024 and 65535.');
      options.port=Number(value);
    }
  }
  if(options.repositories.length>50)throw new Error('Choose up to 50 repositories for one local connection.');
  let url:URL;try{url=new URL(options.origin);}catch{throw new Error('Use an exact HTTPS origin, such as https://merge.foo.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash||url.origin!==options.origin||url.protocol==='http:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Use an exact HTTPS origin, or a local HTTP development origin.');
  return result;
}

/** Kept for callers of the original companion entry point. */
export function parseArguments(args:string[]):CompanionOptions|null {
  const result=parseCommand(args);return result.command==='help'||result.command==='version'?null:result.options;
}

export const CLI_HELP=`merge.foo — bring your GitHub account to the merge map

Usage
  mergefoo connect                     Guided setup, then open merge.foo
  mergefoo connect --repo owner/name    Connect a specific repository
  mergefoo doctor                      Check GitHub CLI and account access

Commands
  connect    Pick repositories and connect this computer (default)
  doctor     Check your setup without connecting or changing GitHub

Options
  --repo owner/name   Allow this repository; repeat for more (up to 50)
  --read-only         View and plan; disable GitHub actions and automation
  --no-open           Print the pairing link without opening a browser
  --origin URL        Application origin (default https://merge.foo)
  --port NUMBER       Local port (default 4318)
  --state-dir PATH    Override the private folder for saved plans
  --help, -h          Show this help
  --version, -v       Show the version

Start with mergefoo connect. No repository clone or pnpm is needed.
GitHub CLI must be installed: https://cli.github.com
Your GitHub sign-in stays on this computer. Only selected repositories are
available to merge.foo. Keep the terminal open while using your merge map.
Use --repo for noninteractive setup.
`;
