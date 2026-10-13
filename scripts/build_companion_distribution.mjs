import {build} from 'vite';
import {builtinModules} from 'node:module';
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=await readFile(join(root,'src/companion/version.ts'),'utf8');
const version=source.match(/COMPANION_VERSION\s*=\s*['"]([\d]+\.[\d]+\.[\d]+)['"]/u)?.[1];
if(!version)throw new Error('The companion needs a valid release version.');
const results=await build({root,configFile:join(root,'vite.companion.config.ts')});
const outputs=(Array.isArray(results)?results:[results]).flatMap(result=>'output' in result?result.output:[]);
const chunks=outputs.filter(output=>output.type==='chunk');
if(chunks.length!==1||chunks[0].fileName!=='mergefoo.mjs')throw new Error('The companion must be one self-contained executable bundle.');
const builtin=new Set([...builtinModules,...builtinModules.map(name=>`node:${name}`)]);
for(const dependency of [...chunks[0].imports,...chunks[0].dynamicImports])if(!builtin.has(dependency)&&dependency!==chunks[0].fileName)throw new Error(`The companion unexpectedly requires ${dependency}.`);

// Preserve dependency license texts next to the executable. Rollup records only
// modules actually included in this release, so unrelated app packages stay out.
const dependencies=new Map();
for(const id of Object.keys(chunks[0].modules)){
  if(!id.includes('/node_modules/'))continue;
  let directory=dirname(id.replace(/^\0/u,''));
  while(directory!==dirname(directory)&&directory.includes('/node_modules')){
    try{
      const metadata=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
      if(typeof metadata.name==='string'&&typeof metadata.version==='string'){
        const key=`${metadata.name}@${metadata.version}`;
        if(!dependencies.has(key)){
          let license='';
          for(const name of ['LICENSE','LICENSE.md','LICENSE.txt','license','license.md','license.txt','COPYING']){
            try{license=await readFile(join(directory,name),'utf8');break;}catch(error){if(error.code!=='ENOENT')throw error;}
          }
          dependencies.set(key,{metadata,license});
        }
        break;
      }
    }catch(error){if(error.code!=='ENOENT')throw error;}
    directory=dirname(directory);
  }
}
const notices=[`merge.foo companion ${version}`,`Third-party software included in this executable.`,`Source: https://github.com/ehfeng/merge.foo`,...Array.from(dependencies).sort(([a],[b])=>a.localeCompare(b)).map(([name,{metadata,license}])=>`${name}\nLicense: ${typeof metadata.license==='string'?metadata.license:JSON.stringify(metadata.license??'See package source')}\n${license.trim()||`Package source: https://www.npmjs.com/package/${metadata.name}/v/${metadata.version}`}`)].join('\n\n---\n\n')+'\n';

const releasePath=`/cli/v${version}`;
const releaseDirectory=join(root,'public',releasePath);
await mkdir(releaseDirectory,{recursive:true});
const runtime=Buffer.concat([await readFile(join(root,'dist/companion/mergefoo.mjs')),Buffer.from(`\n/*\n${notices.replaceAll('*/','* /')}*/\n`)]);
// Every installed copy carries its included packages' full license notices.
await writeFile(join(root,'dist/companion/mergefoo.mjs'),runtime);
const sha256=createHash('sha256').update(runtime).digest('hex');
const destination=join(releaseDirectory,'mergefoo.mjs');
// Bump COMPANION_VERSION for published changes. Versioned download URLs remain
// independent of latest.json and make the checked release explicit to clients.
await writeFile(destination,runtime);
await writeFile(join(releaseDirectory,'SHA256SUMS'),`${sha256}  mergefoo.mjs\n`);
await writeFile(join(releaseDirectory,'THIRD_PARTY_NOTICES.txt'),notices);
await copyFile(join(root,'scripts/install-companion.sh'),join(root,'public/install.sh'));
const manifest={schemaVersion:1,version,minimumNodeMajor:22,bundle:{path:`${releasePath}/mergefoo.mjs`,sha256,bytes:runtime.length},notices:`${releasePath}/THIRD_PARTY_NOTICES.txt`};
await writeFile(join(root,'public/cli/latest.json'),JSON.stringify(manifest,null,2)+'\n');
process.stdout.write(`Companion ${version}: ${Math.round(runtime.length/1024)} KiB, one executable, ${dependencies.size} bundled dependencies.\nPublished assets: /install.sh and ${releasePath}/mergefoo.mjs\n`);
