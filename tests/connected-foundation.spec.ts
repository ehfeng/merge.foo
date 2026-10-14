import {test,expect,type Page} from '@playwright/test';
import {createFixture} from '../src/domain/fixtures';
const installationUrl='https://github.com/apps/merge-foo-test/installations/new';
const repo={id:42,installationId:7,full_name:'owner/repo',private:false};
const added={id:43,installationId:7,full_name:'owner/added',private:false};
async function signedIn(page:Page){await page.route('**/api/session',route=>route.fulfill({json:{configured:true,authenticated:true,login:'alice',installationUrl}}));}
async function installationStub(page:Page){await page.context().route(installationUrl,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Installation fixture</title><p>No GitHub action occurs.</p>'}));}

test('installation and list refresh remain available with a populated picker and connected graph',async({page})=>{
  await signedIn(page);let reads=0;
  await page.route('**/api/github/repositories',route=>{reads++;return route.fulfill({json:{repositories:reads===1?[repo]:[repo,added]}});});
  await page.route('**/api/github/workspace?*',route=>route.fulfill({json:{workspace:createFixture(),warnings:[],coordination:{canManage:true,writesEnabled:false,backgroundEnabled:false}}}));
  await page.goto('/');await expect(page.getByRole('combobox',{name:'Repository'})).toContainText(repo.full_name);
  await expect(page.getByRole('link',{name:'Install or manage repository access',exact:true})).toHaveAttribute('href',installationUrl);
  await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await expect(page.getByRole('combobox',{name:'Repository'})).toContainText(added.full_name);
  await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await page.getByRole('button',{name:/^All stacks/}).click();await expect(page.getByTestId('pr-142')).toBeVisible();
  await expect(page.getByRole('link',{name:'Connect repository',exact:true})).toHaveAttribute('href',installationUrl);
  await expect(page.getByRole('button',{name:'Refresh repository list',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await expect.poll(()=>reads).toBe(3);await expect(page.getByTestId('pr-142')).toBeVisible();
});

test('an installation return refreshes once across focus and visibility without OAuth or reload',async({page})=>{
  await signedIn(page);await installationStub(page);let reads=0,sessionReads=0,oauth=0;
  await page.unroute('**/api/session');await page.route('**/api/session',route=>{sessionReads++;return route.fulfill({json:{configured:true,authenticated:true,login:'alice',installationUrl}});});
  await page.route('**/api/auth/login',route=>{oauth++;return route.fulfill({status:400});});
  await page.route('**/api/github/repositories',route=>{reads++;return route.fulfill({json:{repositories:reads===1?[repo]:[repo,added]}});});
  await page.goto('/');await expect(page.getByRole('combobox',{name:'Repository'})).toContainText(repo.full_name);
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Install or manage repository access',exact:true}).click();const popup=await popupPromise;await popup.close();
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByRole('combobox',{name:'Repository'})).toContainText(added.full_name);expect(reads).toBe(2);expect(sessionReads).toBe(1);expect(oauth).toBe(0);
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
  await page.waitForTimeout(100);expect(reads).toBe(2);
});

test('an installation return queues a fresh list behind a pending pre-installation refresh',async({page})=>{
  await signedIn(page);await installationStub(page);let reads=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/github/repositories',async route=>{reads++;const call=reads;if(call===2)await pending;await route.fulfill({json:{repositories:call<3?[repo]:[repo,added]}});});
  await page.goto('/');await expect(page.getByRole('combobox',{name:'Repository'})).toContainText(repo.full_name);
  await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await expect.poll(()=>reads).toBe(2);
  const popupPromise=page.waitForEvent('popup');await page.getByRole('link',{name:'Install or manage repository access',exact:true}).click();const popup=await popupPromise;await popup.close();
  await page.evaluate(()=>{window.dispatchEvent(new Event('focus'));document.dispatchEvent(new Event('visibilitychange'));});
  expect(reads).toBe(2);release();await expect(page.getByRole('combobox',{name:'Repository'})).toContainText(added.full_name);expect(reads).toBe(3);
});

test('a late repository refresh cannot restore signed-in data after logout',async({page})=>{
  await signedIn(page);let reads=0;let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/github/repositories',async route=>{reads++;if(reads===2)await pending;try{await route.fulfill({json:{repositories:[repo,added]}});}catch{/* Sign-out aborts the pending request. */}});
  await page.route('**/api/auth/logout',route=>route.fulfill({status:204}));
  await page.goto('/');await expect(page.getByRole('combobox',{name:'Repository'})).toContainText(repo.full_name);
  await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await expect.poll(()=>reads).toBe(2);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();release();await expect(page.getByRole('heading',{name:'Connect your GitHub',exact:true})).toBeVisible();await expect(page.getByRole('combobox',{name:'Repository'})).toHaveCount(0);
  await page.waitForTimeout(100);await expect(page.getByRole('combobox',{name:'Repository'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Sign out',exact:true})).toHaveCount(0);
});
