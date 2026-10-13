import {createCompanion,type CompanionOptions} from '../server';
import {COMPANION_VERSION} from '../version';
import {CLI_HELP,parseCommand,validOwner} from './arguments';
import {openBrowser} from './browser';
import {createGitHub,SetupError,signInWithGitHub,type Identity,type Repository} from './github';
import {answer,Cancelled,createTerminal,type Terminal} from './terminal';

export type CompanionSession={identity:Identity;listen():Promise<{port:number;pairUrl:string}>;close():Promise<void>};
export type CliDependencies={
  interactive:boolean;ui:Terminal;github:ReturnType<typeof createGitHub>;
  create:(options:CompanionOptions)=>Promise<CompanionSession>;signIn:()=>Promise<void>;open:(url:string)=>Promise<boolean>;
  output:(message:string)=>void;nodeVersion:string;onReady:(session:CompanionSession)=>void|(()=>void);
};

async function step<T>(ui:Terminal,message:string,done:string,operation:()=>Promise<T>):Promise<T>{
  const spinner=ui.spinner();spinner.start(message);
  try{const result=await operation();if(spinner.isCancelled)throw new Cancelled();spinner.stop(done);return result;}
  catch(error){spinner.error(error instanceof Cancelled?'Cancelled.':'Could not finish this step.');throw error;}
}

async function account(deps:CliDependencies,guided:boolean):Promise<Identity>{
  await step(deps.ui,'Checking GitHub CLI…','GitHub CLI is installed.',()=>deps.github.installed());
  try{return await step(deps.ui,'Finding your GitHub account…','GitHub account verified.',()=>deps.github.identity());}
  catch(error){
    if(!(error instanceof SetupError)||error.reason!=='sign-in'||!guided)throw error;
    deps.ui.info('Sign in once with GitHub CLI to connect your repositories.');
    if(!answer(await deps.ui.confirm('Sign in to GitHub in your browser now?',true)))throw error;
    await deps.signIn();
    return step(deps.ui,'Checking your GitHub sign-in…','GitHub account verified.',()=>deps.github.identity());
  }
}

async function chooseRepositories(deps:CliDependencies,user:Identity):Promise<string[]>{
  const {owners,limited}=await step(deps.ui,'Finding your organizations…','Your account and organizations are ready.',()=>deps.github.owners(user));
  if(limited)deps.ui.warn('Showing the first 500 organizations. Choose “Another user or organization” to enter a name.');
  const ownerChoice=answer(await deps.ui.select('Where are your repositories?',[
    ...owners.map(owner=>({value:owner.login,label:owner.login,hint:owner.personal?'Your repositories':'Organization'})),
    {value:'__other__',label:'Another user or organization',hint:'Enter a GitHub name'},
  ]));
  const owner=ownerChoice==='__other__'?answer(await deps.ui.text('GitHub user or organization name','organization-name',value=>validOwner(value.trim())?undefined:'Enter a GitHub user or organization name.')).trim():ownerChoice;
  if(!validOwner(owner))throw new SetupError('Choose a valid GitHub user or organization name.');
  const found=await step(deps.ui,`Finding repositories in ${owner}…`,'Repositories are ready to choose.',()=>deps.github.repositories(owner));
  if(!found.repositories.length)throw new SetupError(`No active repositories are available in ${owner}.\nCheck your access: gh repo list ${owner}\nOr choose a repository directly: mergefoo connect --repo owner/name`);
  if(found.limited)deps.ui.warn(`Showing up to 1,000 repositories. If yours is missing, use mergefoo connect --repo ${owner}/repository-name.`);
  const selected=answer(await deps.ui.multiselect('Choose repositories to use in merge.foo',found.repositories.map(repo=>({value:repo.fullName,label:repo.fullName,hint:`${repo.private?'Private':'Public'}${repo.description?` · ${repo.description}`:''}`}))));
  // Defend the boundary as well as the prompt; never implicitly allow all repos.
  if(!selected.length||selected.length>50||selected.some(value=>!found.repositories.some(repo=>repo.fullName===value)))throw new SetupError('Choose between 1 and 50 repositories from the list.');
  return [...new Set(selected)];
}

function summary(user:Identity,repositories:Repository[],options:CompanionOptions):string{
  return `GitHub account   @${user.login}\n\nAllowed repositories\n${repositories.map(repo=>`  ${repo.fullName}${repo.private?' · private':''}`).join('\n')}\n\n${options.readOnly?'View and plan only. GitHub actions are disabled.':'Review actions in merge.foo before sending them to GitHub.\nAutomation runs only when you enable it.'}\nPlans are saved on this computer.`;
}

export async function runCli(args:string[],overrides:Partial<CliDependencies>={}):Promise<CompanionSession|undefined>{
  const command=parseCommand(args);
  const output=overrides.output??((message:string)=>{process.stdout.write(message);});
  if(command.command==='help'){output(CLI_HELP);return;}
  if(command.command==='version'){output(`mergefoo ${COMPANION_VERSION}\n`);return;}
  const deps:CliDependencies={interactive:!!process.stdin.isTTY&&!!process.stdout.isTTY,ui:createTerminal(),github:createGitHub(),create:createCompanion,signIn:signInWithGitHub,open:openBrowser,output,nodeVersion:process.versions.node,onReady:()=>{},...overrides};
  if(Number(deps.nodeVersion.split('.')[0])<22)throw new SetupError('merge.foo needs Node.js 22 or newer. Install the current LTS from https://nodejs.org, then try again.');
  const guided=command.command==='connect'&&command.guided&&deps.interactive;
  if(command.command==='connect'&&!guided&&!command.options.repositories.length)throw new SetupError('Choose a repository: mergefoo connect --repo owner/name\nFor guided setup, run mergefoo connect in an interactive terminal.');
  deps.ui.intro(`merge.foo · ${command.command==='doctor'?'setup check':'local connection'}`);
  let session:CompanionSession|undefined;
  const lifecycle:{removeStopHandlers?:()=>void}={};
  try{
    if(guided)deps.ui.note('Choose your GitHub account and repositories.\nYour sign-in stays on this computer. No organization app installation needed.','Your merge map, connected locally');
    const user=await account(deps,guided);deps.ui.success(`Connected as @${user.login}`);
    if(command.command==='doctor'){
      deps.ui.success(`Node.js ${deps.nodeVersion} is supported.`);
      if(command.options.repositories.length){const repositories=await step(deps.ui,'Checking repository access…','Repository access verified.',()=>deps.github.verifyRepositories(command.options.repositories));deps.ui.note(repositories.map(repo=>repo.fullName).join('\n'),'Available repositories');}
      deps.ui.info(`Saved plans folder: ${command.options.stateDir}`);
      deps.ui.outro('Your setup is ready. Run mergefoo connect to choose repositories.');return;
    }
    if(guided)command.options.repositories=await chooseRepositories(deps,user);
    const repositories=await step(deps.ui,'Checking selected repository access…','Selected repository access verified.',()=>deps.github.verifyRepositories(command.options.repositories));
    command.options.repositories=repositories.map(repo=>repo.fullName);
    deps.ui.note(summary(user,repositories,command.options),'Review your connection');
    let shouldOpen=false;
    if(guided){
      if(!answer(await deps.ui.confirm('Connect these repositories to merge.foo?',true)))throw new Cancelled();
      if(command.openBrowser)shouldOpen=answer(await deps.ui.confirm('Open merge.foo in your browser?',true));
    }
    // No prompts remain after starting the server, so cancelling setup cannot
    // leave background work running while waiting for an answer.
    const spinner=deps.ui.spinner();spinner.start('Starting your local connection…');
    try{
      session=await deps.create(command.options);
      if(session.identity.id!==user.id||session.identity.login.toLowerCase()!==user.login.toLowerCase())throw new SetupError('Your GitHub account changed during setup. Run mergefoo connect again.');
      const connection=await session.listen();
      if(spinner.isCancelled)throw new Cancelled();
      lifecycle.removeStopHandlers=deps.onReady(session)||undefined;
      spinner.stop('Local connection is ready.');
      deps.ui.note(connection.pairUrl,'Your private pairing link');
      deps.ui.info('In merge.foo, click “Connect this computer”. Allow local network access if your browser asks.');
      if(shouldOpen&&command.openBrowser){if(await deps.open(connection.pairUrl))deps.ui.success('Opened merge.foo in your browser.');else deps.ui.warn('Could not open your browser. Open the pairing link above to continue.');}
      deps.ui.outro('Keep this terminal open while using merge.foo. Press Ctrl-C to disconnect.');
      return session;
    }catch(error){spinner.error(error instanceof Cancelled?'Connection cancelled.':'Could not start the local connection.');throw error;}
  }catch(error){
    lifecycle.removeStopHandlers?.();
    if(session)await session.close();
    if(error instanceof Cancelled){deps.ui.cancel('Connection cancelled. Nothing is connected.');return;}
    if((error as NodeJS.ErrnoException)?.code==='EADDRINUSE')throw new SetupError(`Port ${command.options.port} is already in use. Stop the other companion, or choose another port:\n  mergefoo connect --repo ${command.options.repositories[0]} --port ${command.options.port===65535?4318:command.options.port+1}`);
    throw error;
  }
}
