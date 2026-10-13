import { defineConfig } from "vite";
import vinext from "vinext";
import {fileURLToPath} from 'node:url';

export default defineConfig(async()=>{
  const target=process.env.MERGEFOO_TARGET??(process.env.VERCEL||process.env.NITRO_PRESET==='vercel'?'vercel':process.env.NITRO_PRESET?'node':'cloudflare');
  if(!['cloudflare','node','vercel'].includes(target))throw new Error('MERGEFOO_TARGET must be cloudflare, node or vercel.');
  const platform=target==='cloudflare'?'platform-cloudflare.ts':'platform-node.ts';
  const plugins=[vinext()];
  if(target==='cloudflare') {
    const {cloudflare}=await import('@cloudflare/vite-plugin');
    plugins.push(cloudflare({viteEnvironment:{name:'rsc',childEnvironments:['ssr']}}));
  } else {
    const {nitro}=await import('nitro/vite');
    plugins.push(nitro({preset:target==='vercel'?'vercel':'node-server'}));
  }
  return {plugins,resolve:{alias:{'@mergefoo/platform-store':fileURLToPath(new URL(`./src/server/state/${platform}`,import.meta.url))}}};
});
