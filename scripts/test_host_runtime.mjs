// Runs the emitted Vercel web handler with fake configuration and no outbound network.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const target=process.argv[2]??'vercel';
if(target!=='vercel')throw new Error('This direct-handler probe expects the Vercel native build; Node smoke uses its generated server entry.');
const output=resolve(process.argv[3]??'.vercel/output');
const directory=join(output,'functions/__server.func');
process.env.APP_ORIGIN='https://host-fixture.example';process.env.GITHUB_CLIENT_ID='fixture';
process.env.GITHUB_CLIENT_SECRET='fixture-secret';process.env.AUTH_SECRET='fixture-secret-at-least-thirty-two-characters';
process.env.DATABASE_URL='';process.env.STATE_STORE='postgres';
process.env.GITHUB_APP_PRIVATE_KEY='';process.env.GITHUB_WEBHOOK_SECRET='fixture-webhook-secret-at-least-thirty-two-characters';
process.env.GITHUB_WORKFLOW_WRITES_ENABLED='false';process.env.WORKFLOW_REPOSITORIES='[]';
globalThis.fetch=async()=>{throw new Error('The hosting fixture must not make outbound requests.');};
const handler=(await import(pathToFileURL(join(directory,'index.mjs')).href)).default;
async function inspectFiles(path){
  for(const item of await readdir(path,{withFileTypes:true})) {
    if(item.name==='node_modules')continue;
    const full=join(path,item.name);
    if(item.isDirectory())await inspectFiles(full);
    else if(item.name.endsWith('.mjs'))assert.doesNotMatch(await readFile(full,'utf8'),/cloudflare:workers|class\s+PlannedAssignments/,'Cloudflare-only code cannot enter the Vercel executable bundle');
  }
}
await inspectFiles(directory);
for(const [path,method,status] of [['/','GET',200],['/api/session','GET',200],['/api/github/repositories','GET',401],['/api/github/workspace?repository=fixture/repo','GET',401],['/api/github/plans','PUT',401],['/api/github/workflow','POST',401],['/api/github/webhook','POST',401],['/api/internal/reconcile','GET',401],['/api/internal/reconcile','POST',401],['/api/auth/callback?code=fake&state=fake','GET',400]]) {
  const response=await handler.fetch(new Request('https://host-fixture.example'+path,{method}));
  assert.equal(response.status,status,path);assert.ok(response.headers.get('cache-control')?.includes('no-store'),path);
  if(path==='/')assert.match(await response.text(),/merge/);
  if(path==='/api/session')assert.deepEqual(await response.json(),{configured:true,authenticated:false});
}
const login=await handler.fetch(new Request('https://host-fixture.example/api/auth/login'));
assert.equal(login.status,302);assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
const location=new URL(login.headers.get('location'));assert.equal(location.origin,'https://github.com');
assert.equal(location.searchParams.get('redirect_uri'),'https://host-fixture.example/api/auth/callback');
assert.equal(location.searchParams.get('code_challenge_method'),'S256');
const logout=await handler.fetch(new Request('https://host-fixture.example/api/auth/logout',{method:'POST',headers:{Origin:'https://host-fixture.example'}}));
assert.equal(logout.status,204);assert.ok(logout.headers.get('set-cookie').includes('Max-Age=0'));
const blocked=await handler.fetch(new Request('https://host-fixture.example/api/auth/logout',{method:'POST',headers:{Origin:'https://other-fixture.example'}}));assert.equal(blocked.status,403);
const config=JSON.parse(await readFile(join(output,'config.json'),'utf8'));
assert.equal(config.version,3);assert.ok(config.routes.some(r=>r.dest==='/__server'));
assert.ok((await readdir(join(output,'static/_next/static'))).length);
console.log('Vercel native handler passed: SSR/static output, no Cloudflare imports, protected APIs, OAuth state/PKCE/cookies and same-origin logout; zero outbound calls.');
