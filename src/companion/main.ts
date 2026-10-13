import {resolve} from 'node:path';
import {createCompanion,type CompanionOptions} from './server';

const help=`Start merge.foo's local GitHub CLI companion.

Usage: pnpm companion --repo owner/name [--repo owner/another]

  --repo owner/name   Allow this repository (required; repeatable)
  --origin URL       Exact UI origin (default https://merge.foo)
  --port NUMBER      Loopback port (default 4318)
  --state-dir PATH   Private local intent store (default .mergefoo-companion)
  --read-only        Disable GitHub changes and automatic progression
  --help             Show this help

Authenticate first: gh auth login --hostname github.com
Open the printed pairing URL in merge.foo. Its fragment is a temporary local
capability; keep the URL private. Your GitHub credential stays in gh.
Only explicit reviewed actions or opted-in automation change GitHub.
Stop with Ctrl-C; stop and restart to revoke and replace a pairing URL.
`;

export function parseArguments(args:string[]):CompanionOptions|null {
  if(args.includes('--help')||args.includes('-h'))return null;
  const options:CompanionOptions={origin:'https://merge.foo',port:4318,repositories:[],stateDir:resolve('.mergefoo-companion')};
  for(let index=0;index<args.length;index++){
    const flag=args[index];if(flag==='--')continue;if(flag==='--read-only'){options.readOnly=true;continue;}
    if(!['--repo','--origin','--port','--state-dir'].includes(flag))throw new Error(`Unknown companion flag: ${flag}`);
    const value=args[++index];if(!value||value.startsWith('--'))throw new Error(`Provide a value for ${flag}.`);
    if(flag==='--repo')options.repositories.push(value);else if(flag==='--origin')options.origin=value;else if(flag==='--state-dir')options.stateDir=resolve(value);else{if(!/^\d+$/.test(value)||Number(value)<1024||Number(value)>65535)throw new Error('Choose a port between 1024 and 65535.');options.port=Number(value);}
  }
  return options;
}

async function main(){
  const options=parseArguments(process.argv.slice(2));if(!options){process.stdout.write(help);return;}
  const companion=await createCompanion(options);
  try{const {port,pairUrl}=await companion.listen();process.stdout.write(`merge.foo companion for @${companion.identity.login}\nRepositories: ${options.repositories.join(', ')}\nListening on http://127.0.0.1:${port}${options.readOnly?' (read-only)':''}\n\nPair this browser:\n${pairUrl}\n\nKeep this pairing URL private. GitHub authentication remains in gh.\n`);}catch(error){await companion.close();throw error;}
  let stopping=false;const stop=()=>{if(stopping)return;stopping=true;void companion.close().then(()=>{process.exitCode=0;}).catch(()=>{process.exitCode=1;});};process.once('SIGINT',stop);process.once('SIGTERM',stop);
}
void main().catch(error=>{process.stderr.write(`${error instanceof Error?error.message:'Companion startup failed.'}\n`);process.exitCode=1;});
