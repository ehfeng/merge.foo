import {test,expect,type Page} from '@playwright/test';
const selectPr=async(page:Page,number:number)=>{await page.getByTestId(`pr-${number}`).getByRole('button').click();};
const mapMenu=async(page:Page,item:string)=>{await page.getByRole('button',{name:'Map menu',exact:true}).click();await page.getByRole('group',{name:'Map options'}).getByRole('button',{name:item,exact:true}).click();};
const openPlan=async(page:Page,number:number)=>{await selectPr(page,number);await page.getByRole('dialog',{name:`Details for #${number}`}).getByRole('button',{name:`Reviewers for #${number}`}).click();};
import {createFixture} from '../src/domain/fixtures';

// Keep acceptance fixtures independent of local/hosted user credentials.
test.beforeEach(async({page})=>{
  await page.route('**/api/session',r=>r.fulfill({json:{configured:false,authenticated:false}}));
  await page.route('**/api/github/reviewers?*',route=>route.request().method()==='GET'?route.fulfill({json:{suggestedReviewers:[],reviewers:[]}}):route.fallback());
});

test('default experience connects GitHub; fixture lab is explicit',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'Connect your GitHub'})).toBeVisible();
  await expect(page.getByTestId('pr-142')).toHaveCount(0);
  await page.getByRole('button',{name:'Setup',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'GitHub setup and permissions'})).toBeVisible();
  await expect(page.getByText('GitHub review actions: select a repository to check',{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'Explore the interaction lab'}).click();
  await expect(page.getByTestId('pr-142')).toContainText('In review');
  await expect(page.locator('.map-pr')).toHaveCount(9);expect(errors).toEqual([]);
});

test('approvals release after hold removal, stay unmerged, and repeated events are idempotent',async({page})=>{
  await page.goto('/?lab=1');await selectPr(page,142);
  const panel=page.getByRole('dialog',{name:'Details for #142'});
  await panel.getByRole('button',{name:'Approve #142 as elena',exact:true}).click();
  await expect(page.getByTestId('pr-142')).toContainText('Approved');
  await expect(page.getByTestId('pr-143')).toContainText('Held');
  await panel.getByRole('button',{name:'Replay last approval'}).click();
  await panel.getByRole('button',{name:'Replay last approval'}).click();
  await page.getByRole('button',{name:'Close details'}).click();
  await selectPr(page,143);await page.getByRole('button',{name:'Remove hold on #143'}).click();
  await expect(page.getByTestId('pr-143')).toContainText('In review');
  await selectPr(page,142);await expect(page.getByRole('dialog',{name:'Details for #142'})).toContainText('not merged');
  await mapMenu(page,'Reconcile');await mapMenu(page,'Reconcile');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('merge.foo.interaction-lab.v1')!));
  expect(saved.prs.find((p:{number:number})=>p.number===143).requests).toHaveLength(1);
  expect(saved.prs.find((p:{number:number})=>p.number===142).reviews).toHaveLength(1);
  expect(saved.prs.find((p:{number:number})=>p.number===144).requests).toHaveLength(0);
});

test('selected plans expose reviewer workload and picker dismissal preserves details',async({page})=>{
  await page.goto('/?lab=1');await openPlan(page,145);
  const picker=page.getByRole('dialog',{name:'Reviewer plan for #145'});
  await expect(picker).toContainText('active');await expect(picker).toContainText('upcoming');
  await picker.getByRole('checkbox',{name:/Maya Ellis/}).click();
  await expect(picker.getByRole('checkbox',{name:/Maya Ellis/})).toHaveAttribute('aria-checked','true');
  await page.keyboard.press('Escape');await expect(picker).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Details for #145'})).toBeVisible();
  await expect(page.getByTestId('pr-145').locator('.map-pr-reviewer')).toHaveAttribute('title',/Maya/);
});

test('selection highlights dependencies and closes on escape or navigation',async({page})=>{
  await page.goto('/?lab=1');await selectPr(page,143);
  await expect(page.getByTestId('pr-142')).toHaveClass(/related/);await expect(page.getByTestId('pr-144')).toHaveClass(/related/);
  await page.keyboard.press('Escape');await expect(page.getByRole('dialog',{name:/Details/})).toHaveCount(0);
  await expect(page.getByTestId('pr-143').getByRole('button')).toBeFocused();
  await selectPr(page,142);
  await mapMenu(page,'Activity');await expect(page.getByRole('dialog',{name:/Details/})).toHaveCount(0);
  await mapMenu(page,'Reviewer load');await expect(page.getByRole('dialog',{name:'Reviewer load'})).toBeVisible();
  await page.getByRole('button',{name:'Close context',exact:true}).click();await expect(page.getByTestId('pr-142')).toBeVisible();
});

test('root start is explicit, automation off requires manual release, and stacks stay independent',async({page})=>{
  await page.goto('/?lab=1');await selectPr(page,128);await page.getByRole('button',{name:'Start first review',exact:true}).click();
  await page.getByRole('button',{name:'Approve #128 as maya',exact:true}).click();
  await expect(page.getByTestId('pr-129')).toContainText('Queued');
  await page.getByRole('button',{name:'Close details'}).click();
  await selectPr(page,129);await page.getByRole('button',{name:'Release review',exact:true}).click();
  await expect(page.getByTestId('pr-129')).toContainText('In review');
  await expect(page.getByTestId('pr-143')).toContainText('Held');
});

test('rebases retain approvals; actual upstream changes requested roll back automatic descendants',async({page})=>{
  await page.goto('/?lab=1');await selectPr(page,143);await page.getByRole('button',{name:'Remove hold on #143'}).click();await selectPr(page,142);await page.getByRole('button',{name:'Approve #142 as elena',exact:true}).click();
  await page.getByRole('button',{name:'Change reviewed content'}).click();await expect(page.getByTestId('pr-142')).toContainText('Approved');await expect(page.getByTestId('pr-143')).toContainText('In review');
  await selectPr(page,143);await page.getByRole('button',{name:'Approve #143 as noah',exact:true}).click();await expect(page.getByTestId('pr-144')).toContainText('In review');
  await selectPr(page,142);await page.getByRole('button',{name:'Request changes to #142 as elena',exact:true}).click();await expect(page.getByTestId('pr-144')).toContainText('Queued');
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('merge.foo.interaction-lab.v1')!));
  for(const number of [143,144]){const pr=saved.prs.find((p:{number:number})=>p.number===number);expect(pr.readiness).toBe('draft');}
  expect(saved.prs.find((p:{number:number})=>p.number===143).reviews).toHaveLength(1);expect(saved.prs.find((p:{number:number})=>p.number===144).requests).toHaveLength(0);
});

test('filters and zoom preserve node coordinates; reset can be dismissed',async({page})=>{
  await page.goto('/?lab=1');const before=await page.getByTestId('pr-142').boundingBox();await page.getByRole('textbox',{name:'Search pull requests'}).fill('webhook');await expect(page.getByTestId('pr-142')).toHaveClass(/dimmed/);expect(await page.getByTestId('pr-142').boundingBox()).toEqual(before);
  const scale=Number(await page.locator('.map-surface').getAttribute('data-zoom'));await page.getByRole('button',{name:'Zoom out'}).click();await expect.poll(async()=>Number(await page.locator('.map-surface').getAttribute('data-zoom'))).toBeLessThan(scale);await page.getByRole('button',{name:'Fit all stacks'}).click();await expect.poll(async()=>Number(await page.locator('.map-surface').getAttribute('data-zoom'))).toBeCloseTo(scale,2);
  await mapMenu(page,'Reset lab');await page.getByRole('button',{name:'Keep exploring'}).click();await expect(page.getByRole('dialog',{name:'Reset interaction lab'})).toHaveCount(0);
});

test('unauthenticated API reads fail closed and never cache private data',async({request})=>{
  for(const path of ['/api/github/repositories','/api/github/workspace?repository=acme/platform']){const response=await request.get(path);expect(response.status()).toBe(401);expect(response.headers()['cache-control']).toContain('no-store');expect(await response.json()).toHaveProperty('error');}
  const response=await request.get('/api/session');expect(await response.json()).not.toHaveProperty('token');const plan=await request.put('/api/github/plans',{data:{repository:'acme/platform',prId:'P1',reviewerIds:['sam'],version:0}});expect(plan.status()).toBe(401);expect(plan.headers()['cache-control']).toContain('no-store');const workflow=await request.post('/api/github/workflow',{data:{repository:'acme/platform',version:0,command:{type:'reconcile'}}});expect(workflow.status()).toBe(401);expect(workflow.headers()['cache-control']).toContain('no-store');const cron=await request.get('/api/internal/reconcile');expect(cron.status()).toBe(401);expect(cron.headers()['cache-control']).toContain('no-store');
});

test('authenticated read-only view uses real API routes and exposes no write controls',async({page})=>{
  const fixture=createFixture();fixture.stacks.forEach(s=>s.autoProgress=false);fixture.prs.forEach(p=>{p.observedGate='review_required';p.plannedReviewerIds=[];});
  await page.route('**/api/session',r=>r.fulfill({json:{configured:true,authenticated:true,login:'ehfeng'}}));await page.route('**/api/github/repositories',r=>r.fulfill({json:{repositories:[{id:1,full_name:'selected/repo',private:true}]}}));await page.route('**/api/github/workspace?*',r=>r.fulfill({json:{workspace:fixture,warnings:['Read-only snapshot. No GitHub writes.']}}));
  await page.goto('/');await page.getByRole('combobox').selectOption('selected/repo');await expect(page.getByText('GITHUB CONNECTED',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Add hold on #142'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Automatic progression for A faster API'})).toHaveCount(0);
  await selectPr(page,142);await expect(page.getByRole('button',{name:/Approve #142/})).toHaveCount(0);await expect(page.getByRole('dialog',{name:'Details for #142'})).toContainText('Planned assignments are shared');
});

test('mobile navigation and panel dismissal remain usable',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Explore the interaction lab'}).click();await selectPr(page,142);await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();await page.getByRole('button',{name:'Close details'}).click();await expect(page.getByRole('dialog')).toHaveCount(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
});


test('connection check repeats safely without credentials and setup dismisses outside',async({page})=>{
  const requests:{path:string;cookie:string|undefined}[]=[];
  await page.unroute('**/api/session');
  await page.route('**/api/**',async route=>{requests.push({path:new URL(route.request().url()).pathname,cookie:route.request().headers()['cookie']});await route.continue();});
  await page.goto('/');await page.getByRole('button',{name:'Setup',exact:true}).click();
  const button=page.getByRole('button',{name:'Check connection & access protection'});
  await button.click();const results=page.getByRole('status',{name:'Connection results'});
  await expect(results).toContainText('App server · HTTP 200');await expect(results).toContainText('Repository protection · HTTP 401');await expect(results).toContainText('PR protection · HTTP 401');
  await button.click();await expect(results).toContainText('PR protection · HTTP 401');
  expect(requests.filter(r=>r.path==='/api/github/repositories')).toHaveLength(2);
  expect(requests.filter(r=>r.path.startsWith('/api/github/')).every(r=>!r.cookie)).toBe(true);
  await expect(page.getByRole('link',{name:'Open local registration'})).toHaveCount(0);
  await page.locator('.modal-backdrop').click({position:{x:3,y:3}});await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('connected onboarding shows installation guidance and never exposes operator setup',async({page})=>{
  await page.route('**/api/session',r=>r.fulfill({json:{configured:true,authenticated:true,login:'alice',installationUrl:'https://github.com/apps/merge-foo/installations/new'}}));
  await page.route('**/api/github/repositories',r=>r.fulfill({json:{repositories:[]}}));
  await page.goto('/');await expect(page.getByText('No connected repositories available.',{exact:false})).toBeVisible();await expect(page.getByRole('link',{name:'Install or manage repository access'})).toHaveAttribute('href','https://github.com/apps/merge-foo/installations/new');
  await page.getByRole('button',{name:'Setup',exact:true}).click();await expect(page.getByRole('dialog')).not.toContainText('pnpm');await expect(page.getByRole('dialog')).not.toContainText('client secret');
});

test('GitHub suggestion order is preserved and accepted plans persist without GitHub writes',async({page})=>{
  let plan:string[]=[];let version=0;const updates:unknown[]=[];
  const snapshot=()=>{const fixture=createFixture();fixture.stacks.forEach(s=>s.autoProgress=false);fixture.prs.forEach(p=>{p.observedGate='review_required';p.canEditPlan=true;p.planVersion=0;p.plannedReviewerIds=[];});const pr=fixture.prs.find(p=>p.number===145)!;pr.planVersion=version;pr.plannedReviewerIds=plan;pr.suggestedReviewers=[{reviewerId:'noah',isAuthor:true,isCommenter:false},{reviewerId:'maya',isAuthor:false,isCommenter:true}];return fixture;};
  await page.route('**/api/session',r=>r.fulfill({json:{configured:true,authenticated:true,login:'alice'}}));await page.route('**/api/github/repositories',r=>r.fulfill({json:{repositories:[{id:1,full_name:'selected/repo',private:true}]}}));await page.route('**/api/github/workspace?*',r=>r.fulfill({json:{workspace:snapshot(),warnings:['Shared plans. No GitHub writes.']}}));
  await page.route('**/api/github/plans',async r=>{const body=r.request().postDataJSON();updates.push(body);expect(body.version).toBe(version);plan=body.reviewerIds;version++;await r.fulfill({json:{plan:{prId:body.prId,reviewerIds:plan,version,actor:'alice',updatedAt:'2026-10-12T12:00:00Z'}}});});
  await page.goto('/');await page.getByRole('combobox').selectOption('selected/repo');await openPlan(page,145);const picker=page.getByRole('dialog',{name:'Reviewer plan for #145'});
  await expect(picker.getByRole('checkbox').nth(0)).toContainText('Noah');await expect(picker.getByRole('checkbox').nth(1)).toContainText('Maya');await expect(picker.getByRole('checkbox').nth(0)).toContainText('past commits');await expect(picker.getByRole('checkbox').nth(1)).toContainText('review comments');
  await picker.getByRole('checkbox').nth(0).click();await expect(picker.getByRole('checkbox').nth(0)).toHaveAttribute('aria-checked','true');await expect(page.getByRole('status').filter({hasText:'Planned assignment saved'})).toBeVisible();expect(updates).toHaveLength(1);
  await page.reload();await page.getByRole('combobox').selectOption('selected/repo');await expect(page.getByTestId('pr-145').locator('.map-pr-reviewer')).toHaveAttribute('title',/Noah/);await openPlan(page,145);await expect(page.getByRole('dialog',{name:'Reviewer plan for #145'}).getByRole('checkbox').nth(0)).toHaveAttribute('aria-checked','true');
});

test('stale repository responses and sign-out cannot restore private workspace',async({page})=>{
  const fixture=createFixture();let completeSlow:()=>void=()=>{};let waitSlow=new Promise<void>(resolve=>{completeSlow=resolve;});
  await page.route('**/api/session',r=>r.fulfill({json:{configured:true,authenticated:true,login:'alice'}}));await page.route('**/api/github/repositories',r=>r.fulfill({json:{repositories:[{id:1,full_name:'slow/repo',private:true},{id:2,full_name:'fast/repo',private:true}]}}));
  await page.route('**/api/github/workspace?*',async r=>{const repository=new URL(r.request().url()).searchParams.get('repository');if(repository==='slow/repo')await waitSlow;await r.fulfill({json:{workspace:{...fixture,prs:fixture.prs.map(p=>({...p,title:`${repository} ${p.title}`}))},warnings:['Snapshot']}});});
  await page.route('**/api/auth/logout',r=>r.fulfill({json:{ok:true}}));
  await page.goto('/');await page.getByRole('combobox').selectOption('slow/repo');await page.getByRole('combobox').selectOption('fast/repo');await expect(page.getByTestId('pr-142')).toContainText('fast/repo');completeSlow();await expect(page.getByTestId('pr-142')).not.toContainText('slow/repo');
  waitSlow=new Promise<void>(resolve=>{completeSlow=resolve;});await page.getByRole('combobox',{name:'Repository'}).selectOption('slow/repo');await page.getByRole('button',{name:'Sign out',exact:true}).click();completeSlow();await expect(page.getByRole('link',{name:'Continue with GitHub'})).toBeVisible();await expect(page.locator('.map-pr')).toHaveCount(0);
});

test('conflicting plan changes show a refresh action without claiming success',async({page})=>{
 const fixture=createFixture();fixture.prs.forEach(p=>{p.canEditPlan=true;p.plannedReviewerIds=[];p.planVersion=0;});await page.route('**/api/session',r=>r.fulfill({json:{configured:true,authenticated:true,login:'alice'}}));await page.route('**/api/github/repositories',r=>r.fulfill({json:{repositories:[{id:1,full_name:'selected/repo',private:true}]}}));await page.route('**/api/github/workspace?*',r=>r.fulfill({json:{workspace:fixture,warnings:['Shared plan']}}));await page.route('**/api/github/plans',r=>r.fulfill({status:409,json:{error:'Someone changed this assignment. Refresh the repository before editing again.'}}));
 await page.goto('/');await page.getByRole('combobox').selectOption('selected/repo');await openPlan(page,145);await page.getByRole('dialog',{name:'Reviewer plan for #145'}).getByRole('checkbox').nth(0).click();await expect(page.getByRole('alert')).toContainText('Someone changed');await expect(page.getByRole('button',{name:'Refresh repository',exact:true})).toBeVisible();await expect(page.getByRole('status').filter({hasText:'Planned assignment saved'})).toHaveCount(0);
});
