import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const bundle=resolve(root,'dist/companion/mergefoo.mjs');
process.stdout.write('Building the local companion…\n');
const code=await new Promise((settle,reject)=>{const build=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'build','--config','vite.companion.config.ts'],{cwd:root,stdio:'inherit',shell:false});build.on('error',reject);build.on('close',settle);});
if(code!==0){process.exitCode=Number(code)||1;}else{
  const running=spawn(process.execPath,[bundle,...process.argv.slice(2)],{cwd:process.cwd(),stdio:'inherit',shell:false});
  const interrupt=()=>running.kill('SIGINT');const terminate=()=>running.kill('SIGTERM');
  process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
  process.exitCode=await new Promise((settle,reject)=>{running.once('error',reject);running.once('close',value=>settle(value??1));});
  process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
}
