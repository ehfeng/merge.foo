import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';

const builtins=new Set([...builtinModules,...builtinModules.map(name=>`node:${name}`)]);
export default defineConfig({
  resolve:{alias:{'@mergefoo/platform-store':fileURLToPath(new URL('./src/server/state/platform-node.ts',import.meta.url))}},
  // SSR normally externalizes installed packages. The downloadable companion
  // must run with Node and gh alone, including its dynamically imported plans.
  ssr:{noExternal:true},
  build:{target:'node22',outDir:'dist/companion',emptyOutDir:true,ssr:true,lib:{entry:fileURLToPath(new URL('./src/companion/main.ts',import.meta.url)),formats:['es'],fileName:()=> 'mergefoo.mjs'},rollupOptions:{output:{entryFileNames:'mergefoo.mjs',codeSplitting:false,banner:'#!/usr/bin/env node'},external:(id)=>builtins.has(id)}},
});
