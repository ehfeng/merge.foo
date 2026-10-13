import {test,expect,type Page} from '@playwright/test';
import {createFixture} from '../src/domain/fixtures';
const selected={id:1,installationId:10,full_name:'selected/repo',private:true};
const other={id:2,installationId:10,full_name:'other/repo',private:true};
async function authenticated(page:Page){
  await page.route('**/api/session',route=>route.fulfill({json:{configured:true,authenticated:true,login:'alice',installationUrl:'https://github.com/apps/merge-foo/installations/new'}}));
  await page.route('**/api/auth/logout',route=>route.fulfill({json:{ok:true}}));
}
function workspace(name=selected.full_name){const fixture=createFixture();fixture.prs.forEach(pr=>{pr.canEditPlan=false;pr.plannedReviewerIds=['maya'];pr.title=`${name} ${pr.title}`;});return {workspace:fixture,coordination:{canManage:false,writesEnabled:false,backgroundEnabled:false},warnings:[]};}
test('refreshing accessible repositories preserves the selected graph, plans, details and camera',async({page})=>{
  await authenticated(page);let reads=0;let list=[selected];
  await page.route('**/api/github/repositories',route=>route.fulfill({json:{repositories:list}}));
  await page.route('**/api/github/workspace?*',route=>{reads++;return route.fulfill({json:workspace()});});
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption(selected.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();await page.getByTestId('pr-145').getByRole('button').click();
  const camera=await page.locator('.map-world').getAttribute('style');const marker=page.getByTestId('pr-145').locator('.map-pr-reviewer');await expect(marker).toHaveAttribute('title',/Maya/);
  list=[selected,other];await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Repository'}).getByRole('option',{name:other.full_name})).toHaveCount(1);
  await expect(page.getByRole('combobox',{name:'Repository'})).toHaveValue(selected.full_name);await expect(page.getByRole('dialog',{name:'Details for #145'})).toBeVisible();await expect(marker).toHaveAttribute('title',/Maya/);
  expect(await page.locator('.map-world').getAttribute('style')).toBe(camera);expect(reads).toBe(1);
});
test('a revoked or recreated repository clears private data and rejects its delayed workspace response',async({page})=>{
  await authenticated(page);let list=[selected];let finish:()=>void=()=>{};let started:()=>void=()=>{};const waiting=new Promise<void>(resolve=>{finish=resolve;});const requested=new Promise<void>(resolve=>{started=resolve;});
  await page.route('**/api/github/repositories',route=>route.fulfill({json:{repositories:list}}));
  await page.route('**/api/github/workspace?*',async route=>{started();await waiting;await route.fulfill({json:workspace()}).catch(()=>{});});
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption(selected.full_name);await requested;
  list=[{...selected,id:999}];await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await expect(page.getByRole('combobox',{name:'Repository'})).toHaveValue('');
  finish();await expect(page.locator('.map-pr')).toHaveCount(0);await expect(page.getByRole('combobox',{name:'Repository'})).toHaveValue('');
});
test('refresh completion validates the latest selection instead of clearing another authorized repository',async({page})=>{
  await authenticated(page);let calls=0;let finish:()=>void=()=>{};let started:()=>void=()=>{};const pending=new Promise<void>(resolve=>{finish=resolve;});const requested=new Promise<void>(resolve=>{started=resolve;});
  await page.route('**/api/github/repositories',async route=>{calls++;if(calls>1){started();await pending;}await route.fulfill({json:{repositories:calls===1?[selected,other]:[other]}});});
  await page.route('**/api/github/workspace?*',route=>route.fulfill({json:workspace(new URL(route.request().url()).searchParams.get('repository')??'')}));
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption(selected.full_name);await expect(page.getByTestId('pr-145')).toContainText(selected.full_name);
  await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await requested;await page.getByRole('combobox',{name:'Repository'}).selectOption(other.full_name);await expect(page.getByTestId('pr-145')).toContainText(other.full_name);
  finish();await expect(page.getByRole('combobox',{name:'Repository'}).getByRole('option')).toHaveCount(1);await expect(page.getByRole('combobox',{name:'Repository'})).toHaveValue(other.full_name);await expect(page.getByTestId('pr-145')).toContainText(other.full_name);
});
test('a transient list error preserves the graph, while confirmed authentication loss clears it',async({page})=>{
  await authenticated(page);let status=200;
  await page.route('**/api/github/repositories',route=>route.fulfill({status,json:status===200?{repositories:[selected]}:{error:status===401?'Sign in again.':'GitHub is temporarily unavailable.'}}));
  await page.route('**/api/github/workspace?*',route=>route.fulfill({json:workspace()}));
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption(selected.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();
  status=502;await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await expect(page.getByRole('alert')).toContainText('temporarily unavailable');await expect(page.getByTestId('pr-145')).toBeVisible();
  status=401;await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await expect(page.getByRole('link',{name:'Continue with GitHub'})).toBeVisible();await expect(page.locator('.map-pr')).toHaveCount(0);await expect(page.getByRole('combobox',{name:'Repository'})).toHaveCount(0);
});
test('a list failure during a pending plan cannot mislabel the later plan conflict retry',async({page})=>{
  await authenticated(page);let reads=0;let releasePlan:()=>void=()=>{};let planStarted:()=>void=()=>{};const pendingPlan=new Promise<void>(resolve=>{releasePlan=resolve;});const requestedPlan=new Promise<void>(resolve=>{planStarted=resolve;});
  await page.route('**/api/github/repositories',route=>{reads++;return route.fulfill({status:reads===1?200:502,json:reads===1?{repositories:[selected]}:{error:'GitHub is temporarily unavailable.'}});});
  const fixture=createFixture();fixture.prs.forEach(pr=>{pr.canEditPlan=true;pr.plannedReviewerIds=[];pr.planVersion=0;});
  await page.route('**/api/github/workspace?*',route=>route.fulfill({json:{workspace:fixture,coordination:{canManage:true,writesEnabled:false,backgroundEnabled:false},warnings:[]}}));
  await page.route('**/api/github/plans',async route=>{planStarted();await pendingPlan;await route.fulfill({status:409,json:{error:'Someone changed this assignment. Refresh the repository before editing again.'}});});
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption(selected.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();
  await page.getByTestId('pr-145').getByRole('button').click();await page.getByRole('dialog',{name:'Details for #145'}).getByRole('button',{name:'Reviewers for #145'}).click();await page.getByRole('dialog',{name:'Reviewer plan for #145'}).getByRole('checkbox').first().click();
  await requestedPlan;await page.getByRole('button',{name:'Refresh repository list',exact:true}).click();await expect(page.getByRole('button',{name:'Retry repository list',exact:true})).toBeVisible();releasePlan();
  await expect(page.getByRole('alert')).toContainText('Someone changed');await expect(page.getByRole('button',{name:'Refresh repository',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Retry repository list',exact:true})).toHaveCount(0);
});
