import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runCli} from './cli/run';
import {createTerminal} from './cli/terminal';

export {parseArguments} from './cli/arguments';
export {runCli} from './cli/run';

// Importing the CLI must not start a connection. realpath supports installed
// commands that are symlinks to the bundled executable.
function isEntryPoint(){
  try{return !!process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url));}
  catch{return false;}
}

if(isEntryPoint()){
  void runCli(process.argv.slice(2),{onReady:session=>{
    let stopping=false;
    const remove=()=>{process.off('SIGINT',stop);process.off('SIGTERM',stop);};
    const stop=()=>{
      if(stopping)return;stopping=true;remove();
      void session.close().then(()=>{createTerminal().outro('Disconnected. Your plans are saved for next time.');process.exitCode=0;})
        .catch(()=>{process.stderr.write('Could not finish closing the local connection.\n');process.exitCode=1;});
    };
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    return remove;
  }}).catch(error=>{
    createTerminal().error(error instanceof Error?error.message:'Could not start the local connection. Run mergefoo doctor to check your setup.');
    process.exitCode=1;
  });
}
