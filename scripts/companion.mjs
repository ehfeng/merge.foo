import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const bundle=resolve(root,'dist/companion/companion.mjs');
process.stdout.write('Building the local companion…\n');
const code=await new Promise((settle,reject)=>{const build=spawn(process.execPath,[resolve(root,'node_modules/vite/bin/vite.js'),'build','--config','vite.companion.config.ts'],{cwd:root,stdio:'inherit',shell:false});build.on('error',reject);build.on('close',settle);});
if(code!==0){process.exitCode=Number(code)||1;}else await import(bundle);
