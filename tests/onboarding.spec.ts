import {test,expect,type Page} from '@playwright/test';

async function session(page:Page,authenticated=false){
  await page.route('**/api/session',route=>route.fulfill({json:{configured:true,authenticated,login:authenticated?'fixture-user':undefined,installationUrl:'https://github.com/apps/merge-foo/installations/new'}}));
  await page.route('**/api/github/repositories',route=>route.fulfill({json:{repositories:[]}}));
}
async function fits(page:Page,width:number,height:number){
  const card=await page.locator('.map-connect-card').boundingBox();expect(card).not.toBeNull();expect(card!.x).toBeGreaterThanOrEqual(0);expect(card!.y).toBeGreaterThanOrEqual(0);expect(card!.x+card!.width).toBeLessThanOrEqual(width);expect(card!.y+card!.height).toBeLessThanOrEqual(height);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(width);
}

test('login gives local companion and GitHub App equal visible entry points',async({page})=>{
  await session(page);
  for(const mobile of [false,true]){
    const width=mobile?390:1440,height=mobile?844:1000;await page.setViewportSize({width,height});await page.goto('/');
    const local=page.getByRole('region',{name:'Local companion',exact:true});const app=page.getByRole('region',{name:'GitHub App',exact:true});
    await expect(local.getByRole('button',{name:'Use local companion'})).toBeVisible();await expect(app.getByRole('link',{name:'Continue with GitHub'})).toBeVisible();
    await expect(local).toContainText('No organization app to install.');await expect(app).toContainText('Organization access may need admin approval.');
    await expect(page.locator('.map-connect-card')).not.toContainText('pnpm');await fits(page,width,height);
    await page.screenshot({path:`docs/screenshots/companion-login-choice${mobile?'-mobile':''}.png`});
  }
});

test('local setup offers copyable install and connect commands, with manual pairing as a fallback',async({page})=>{
  await session(page);await page.addInitScript(()=>{const copied:string[]=[];Object.defineProperty(window,'copiedCommands',{value:copied});Object.defineProperty(navigator,'clipboard',{value:{writeText:async(value:string)=>{copied.push(value);}}});});
  await page.goto('/');await page.getByRole('button',{name:'Use local companion',exact:true}).click();const setup=page.getByRole('region',{name:'Local companion setup'});
  await expect(setup).toContainText('curl -fsSL https://merge.foo/install.sh | sh');await expect(setup).toContainText('~/.local/bin/mergefoo connect --origin http://127.0.0.1:3000');await expect(setup).toContainText('For macOS and Linux. Requires Node.js 22+ and GitHub CLI');
  await expect(setup.getByLabel('Pairing URL')).toHaveCount(0);await expect(page.getByRole('region',{name:'GitHub App',exact:true})).toBeHidden();
  await setup.getByRole('button',{name:'Copy install command',exact:true}).click();await expect(setup.getByRole('button',{name:'Install command copied'})).toBeVisible();
  await setup.getByRole('button',{name:'Copy connect command',exact:true}).click();await expect(setup.getByRole('button',{name:'Connect command copied'})).toBeVisible();
  expect(await page.evaluate(()=>(window as typeof window&{copiedCommands:string[]}).copiedCommands)).toEqual(['curl -fsSL https://merge.foo/install.sh | sh','~/.local/bin/mergefoo connect --origin http://127.0.0.1:3000']);
  await setup.getByRole('button',{name:'Browser didn’t open? Paste the pairing URL',exact:true}).click();await expect(setup.getByLabel('Pairing URL')).toBeVisible();
  await setup.getByRole('button',{name:'Connection options',exact:true}).click();await expect(page.getByRole('link',{name:'Continue with GitHub',exact:true})).toBeVisible();
});

test('local setup remains readable on desktop and mobile',async({page})=>{
  await session(page);
  for(const mobile of [false,true]){
    const width=mobile?390:1440,height=mobile?844:1000;await page.setViewportSize({width,height});await page.goto('/');await page.getByRole('button',{name:'Use local companion',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Choose your repositories'})).toBeVisible();await fits(page,width,height);await page.screenshot({path:`docs/screenshots/companion-install-setup${mobile?'-mobile':''}.png`});
  }
});

test('signed-in repository onboarding and setup expose the companion alternative',async({page})=>{
  await session(page,true);await page.goto('/');await expect(page.getByRole('combobox',{name:'Repository'})).toBeVisible();await expect(page.getByRole('link',{name:'Install or manage repository access',exact:true})).toBeVisible();
  await expect(page.locator('.map-connect-card').getByRole('button',{name:'Use local companion',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Setup',exact:true}).click();const setup=page.getByRole('dialog',{name:'GitHub setup and permissions'});await setup.getByRole('button',{name:'Use local companion',exact:true}).click();await expect(setup.getByRole('heading',{name:'Connect from your computer'})).toBeVisible();await expect(setup).toContainText('https://merge.foo/install.sh');await expect(setup).not.toContainText('pnpm');await page.keyboard.press('Escape');await expect(setup).toHaveCount(0);
});
