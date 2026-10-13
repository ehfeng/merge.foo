import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
import {builtinModules} from 'node:module';

export default defineConfig({
  resolve:{alias:{'@mergefoo/platform-store':fileURLToPath(new URL('./src/server/state/platform-node.ts',import.meta.url))}},
  build:{target:'node22',outDir:'dist/companion',emptyOutDir:true,ssr:true,lib:{entry:fileURLToPath(new URL('./src/companion/main.ts',import.meta.url)),formats:['es'],fileName:()=> 'companion.mjs'},rollupOptions:{output:{entryFileNames:'companion.mjs'},external:[...builtinModules,...builtinModules.map(name=>`node:${name}`),'@neondatabase/serverless','pg']}},
});
