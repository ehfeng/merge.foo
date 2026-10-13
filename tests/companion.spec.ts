import {test,expect,type Page} from '@playwright/test';
import {createFixture} from '../src/domain/fixtures';

const capability='a'.repeat(43);const fragment=`#companion=${capability}&port=4318`;
const repo={id:123,full_name:'kernel/kernel',private:true};
const headers={'access-control-allow-origin':'http://127.0.0.1:3000'};
function snapshot(title='Kernel pull request'){
  const workspace=createFixture();workspace.prs.forEach(pr=>{pr.title=`${title} ${pr.number}`;pr.canEditPlan=true;pr.planVersion=0;});
  return {workspace,coordination:{canManage:true,writesEnabled:true,backgroundEnabled:true,source:'companion'},viewerLogin:'alice',warnings:[]};
}
async function hosted(page:Page,authenticated=false){
  await page.route('http://127.0.0.1:3000/api/session',route=>route.fulfill({json:{configured:authenticated,authenticated,login:authenticated?'hosted-user':undefined,installationUrl:'https://github.com/apps/merge-foo/installations/new'}}));
  await page.route('http://127.0.0.1:3000/api/github/repositories',route=>route.fulfill({json:{repositories:[]}}));
}
async function local(page:Page){
  const requests:string[]=[];
  await page.route('http://127.0.0.1:4318/**',async route=>{
    const request=route.request();requests.push(request.url());expect(request.headers().authorization).toBe(`Bearer ${capability}`);expect(request.headers().cookie).toBeUndefined();
    const path=new URL(request.url()).pathname;
    const json=path==='/api/session'?{configured:true,authenticated:true,connection:'companion',login:'alice'}:path==='/api/github/repositories'?{repositories:[repo]}:path==='/api/github/reviewers'?{suggestedReviewers:[],reviewers:[]}:snapshot();
    await route.fulfill({headers,json});
  });return requests;
}

test('pairing works without hosted auth or an installation and waits for a connection click',async({page})=>{
  await hosted(page);const requests=await local(page);
  await page.goto(`/${fragment}`);await expect(page.getByRole('button',{name:'Connect this computer',exact:true})).toBeVisible();expect(new URL(page.url()).hash).toBe('');expect(requests).toEqual([]);
  expect(await page.evaluate(()=>sessionStorage.getItem('merge.foo.companion.v1'))).toBeNull();
  await page.getByRole('button',{name:'Connect this computer',exact:true}).click();await expect(page.getByRole('combobox',{name:'Repository'})).toBeVisible();
  await expect(page.getByRole('link',{name:/Install or manage repository access/})).toHaveCount(0);
  await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.getByTestId('pr-145')).toContainText('Kernel pull request');await expect(page.locator('.map-mode')).toHaveText('LOCAL GITHUB CLI');
  await expect(page.getByRole('link',{name:'Connect repository',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Setup',exact:true}).click();
  const setup=page.getByRole('dialog',{name:'GitHub setup and permissions'});await expect(setup).toContainText('Personal assignments and coordination are saved on this device.');await expect(setup.getByRole('link',{name:'Manage repository access'})).toHaveCount(0);
  await expect(setup.getByRole('button',{name:'Check connection & access protection'})).toHaveCount(0);
  const stored=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('merge.foo.companion.v1')??'null'));expect(stored).toEqual({capability,port:4318});
});

test('manual connection validates the pairing URL and works when hosted auth is unavailable',async({page})=>{
  await hosted(page);const requests=await local(page);await page.goto('/');await page.getByRole('button',{name:'Use local companion',exact:true}).click();await page.getByRole('button',{name:'Browser didn’t open? Paste the pairing URL',exact:true}).click();
  await page.getByLabel('Pairing URL').fill(`https://merge.foo/#companion=${capability}&port=80`);await page.getByRole('button',{name:'Connect this computer',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Paste the full pairing URL');expect(requests).toEqual([]);
  await page.getByLabel('Pairing URL').fill(`https://merge.foo/${fragment}`);await page.getByRole('button',{name:'Connect this computer',exact:true}).click();await expect(page.getByRole('combobox',{name:'Repository'})).toBeVisible();
  await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();
});

test('disconnect clears private data and pairing, and a delayed local workspace cannot replace hosted state',async({page})=>{
  await hosted(page,true);await local(page);let started:()=>void=()=>{};let finish:()=>void=()=>{};const requested=new Promise<void>(resolve=>{started=resolve;});const pending=new Promise<void>(resolve=>{finish=resolve;});let hostedLogout=0;
  await page.route('http://127.0.0.1:3000/api/auth/logout',route=>{hostedLogout++;return route.fulfill({json:{ok:true}});});
  await page.route('http://127.0.0.1:4318/api/github/workspace?*',async route=>{started();await pending;await route.fulfill({headers,json:snapshot('Stale local data')}).catch(()=>{});});
  await page.goto(`/${fragment}`);await page.getByRole('button',{name:'Connect this computer',exact:true}).click();await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await requested;
  await page.getByRole('button',{name:'Disconnect local GitHub CLI',exact:true}).first().click();await expect(page.getByRole('button',{name:'Use local companion',exact:true})).toBeVisible();finish();
  await expect(page.locator('.map-pr')).toHaveCount(0);await expect(page.getByRole('combobox',{name:'Repository'})).toHaveValue('');expect(await page.evaluate(()=>sessionStorage.getItem('merge.foo.companion.v1'))).toBeNull();expect(hostedLogout).toBe(0);
  await expect(page.getByRole('link',{name:/Install or manage repository access/})).toBeVisible();
});

test('a delayed hosted session cannot overwrite a newly paired local session',async({page})=>{
  let finish:()=>void=()=>{};const pending=new Promise<void>(resolve=>{finish=resolve;});
  await page.route('http://127.0.0.1:3000/api/session',async route=>{await pending;await route.fulfill({json:{configured:true,authenticated:false}}).catch(()=>{});});await local(page);
  await page.goto(`/${fragment}`);await page.getByRole('button',{name:'Connect this computer',exact:true}).click();await expect(page.getByRole('combobox',{name:'Repository'})).toBeVisible();finish();
  await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.locator('.map-mode')).toHaveText('LOCAL GITHUB CLI');await expect(page.getByRole('link',{name:'Continue with GitHub'})).toHaveCount(0);
});

test('companion polling pauses for PR edits and stops after disconnect',async({page})=>{
  await hosted(page);let reads=0;await local(page);await page.route('http://127.0.0.1:4318/api/github/workspace?*',route=>{reads++;return route.fulfill({headers,json:snapshot()});});
  await page.clock.install();await page.goto(`/${fragment}`);await page.getByRole('button',{name:'Connect this computer',exact:true}).click();await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();expect(reads).toBe(1);
  await page.clock.fastForward(60001);await expect.poll(()=>reads).toBe(2);await page.getByTestId('pr-145').getByRole('button').click();await expect(page.getByRole('dialog',{name:'Details for #145'})).toBeVisible();
  await page.clock.fastForward(120001);expect(reads).toBe(2);await page.getByRole('button',{name:'Disconnect local GitHub CLI',exact:true}).click();await page.clock.fastForward(120001);expect(reads).toBe(2);
});

for(const operation of ['reviewers','poll'] as const){
  test(`local ${operation} authentication loss clears private data without requiring a JSON body`,async({page})=>{
    await hosted(page);await local(page);let reads=0;
    if(operation==='reviewers')await page.route('http://127.0.0.1:4318/api/github/reviewers?*',route=>route.fulfill({headers,status:401,body:''}));
    else {
      await page.clock.install();
      await page.route('http://127.0.0.1:4318/api/github/workspace?*',route=>++reads===1?route.fulfill({headers,json:snapshot()}):route.fulfill({headers,status:401,body:''}));
    }
    await page.goto(`/${fragment}`);await page.getByRole('button',{name:'Connect this computer',exact:true}).click();await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();
    if(operation==='reviewers')await page.getByTestId('pr-145').getByRole('button').click();else await page.clock.fastForward(60001);
    await expect(page.locator('.map-pr')).toHaveCount(0);await expect(page.getByRole('combobox',{name:'Repository'})).toHaveCount(0);await expect(page.getByRole('alert')).toContainText(/pairing.*expired/i);await expect(page.getByRole('region',{name:'Local companion connection'}).getByRole('status')).toHaveText('OFFLINE');
  });
}

test('reviewer suggestions load only for the selected PR and preserve the personal plan',async({page})=>{
  await hosted(page);await local(page);let reads=0;let finish:()=>void=()=>{};const pending=new Promise<void>(resolve=>{finish=resolve;});
  const fixture=snapshot();fixture.workspace.prs.find(pr=>pr.number===145)!.plannedReviewerIds=['maya'];
  await page.route('http://127.0.0.1:4318/api/github/workspace?*',route=>route.fulfill({headers,json:fixture}));
  await page.route('http://127.0.0.1:4318/api/github/reviewers?*',async route=>{reads++;expect(new URL(route.request().url()).searchParams.get('prId')).toBe('pr-145');await pending;await route.fulfill({headers,json:{suggestedReviewers:[{reviewerId:'hint',isAuthor:false,isCommenter:true},{reviewerId:'noah',isAuthor:true,isCommenter:false}],reviewers:[{id:'hint',name:'Hint Person',initials:'HP',color:'#8674bd',specialty:'GitHub suggestion'}]}}).catch(()=>{});});
  await page.goto(`/${fragment}`);await page.getByRole('button',{name:'Connect this computer',exact:true}).click();await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();expect(reads).toBe(0);
  await page.getByTestId('pr-145').getByRole('button').click();await page.getByRole('button',{name:'Reviewers for #145'}).click();const picker=page.getByRole('dialog',{name:'Reviewer plan for #145'});await expect(picker.getByRole('status')).toHaveText('Loading GitHub reviewer suggestions…');finish();
  await expect(picker.getByRole('checkbox').first()).toContainText('Hint Person');await expect(picker.getByRole('checkbox').nth(1)).toContainText('Noah Chen');await expect(picker.getByRole('checkbox').filter({hasText:'Maya Ellis'})).toHaveAttribute('aria-checked','true');expect(reads).toBe(1);
});

test('a delayed reviewer suggestion cannot modify a different selected PR',async({page})=>{
  await hosted(page);await local(page);let finish:()=>void=()=>{};let started:()=>void=()=>{};const pending=new Promise<void>(resolve=>{finish=resolve;});const requested=new Promise<void>(resolve=>{started=resolve;});
  await page.route('http://127.0.0.1:4318/api/github/reviewers?*',async route=>{const prId=new URL(route.request().url()).searchParams.get('prId');if(prId==='pr-145'){started();await pending;await route.fulfill({headers,json:{suggestedReviewers:[{reviewerId:'stale',isAuthor:false,isCommenter:true}],reviewers:[{id:'stale',name:'Stale Candidate',initials:'SC',color:'#8674bd',specialty:'GitHub suggestion'}]}}).catch(()=>{});}else await route.fulfill({headers,json:{suggestedReviewers:[],reviewers:[]}});});
  await page.goto(`/${fragment}`);await page.getByRole('button',{name:'Connect this computer',exact:true}).click();await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();await page.getByTestId('pr-145').getByRole('button').click();await requested;
  await page.getByRole('dialog',{name:'Details for #145'}).getByRole('button',{name:/#144/}).click();await page.getByRole('button',{name:'Reviewers for #144'}).click();const picker=page.getByRole('dialog',{name:'Reviewer plan for #144'});await expect(picker).toContainText('GitHub returned no suggested reviewers.');finish();
  await expect(picker).not.toContainText('Stale Candidate');await expect(picker.getByRole('checkbox').first()).toContainText('Elena Park');
});

test('local companion connection fits desktop and mobile screens',async({page})=>{
  await hosted(page);await local(page);
  for(const mobile of [false,true]){
    await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000});
    await page.goto(`/${fragment}`);const connect=page.getByRole('button',{name:'Connect this computer',exact:true});await expect(connect).toBeVisible();
    const card=await page.locator('.map-connect-card').boundingBox();expect(card).not.toBeNull();expect(card!.x).toBeGreaterThanOrEqual(0);expect(card!.y).toBeGreaterThanOrEqual(0);expect(card!.x+card!.width).toBeLessThanOrEqual(mobile?390:1440);expect(card!.y+card!.height).toBeLessThanOrEqual(mobile?844:1000);
    await connect.scrollIntoViewIfNeeded();await page.screenshot({path:`docs/screenshots/companion-onboarding${mobile?'-mobile':''}.png`});
    await connect.click();await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();await expect(page.locator('.map-mode')).toHaveText('LOCAL GITHUB CLI');
    await page.screenshot({path:`docs/screenshots/companion-connected${mobile?'-mobile':''}.png`});
  }
});
