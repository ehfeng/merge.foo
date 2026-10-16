import {test,expect,type Page} from '@playwright/test';
import {createFixture} from '../src/domain/fixtures';
const repo={id:1,installationId:10,full_name:'selected/repo',private:true};
function view(){const fixture=createFixture();fixture.workflowVersion=0;fixture.prs.forEach(pr=>{pr.canEditPlan=true;pr.author='alice';pr.plannedReviewerIds=[];pr.planVersion=0;});return {workspace:fixture,coordination:{canManage:true,writesEnabled:false,backgroundEnabled:false},warnings:[]};}
async function connected(page:Page){
  await page.route('**/api/session',route=>route.fulfill({json:{configured:true,authenticated:true,login:'alice'}}));
  await page.route('**/api/github/repositories',route=>route.fulfill({json:{repositories:[repo]}}));
  await page.route('**/api/github/reviewers?*',route=>route.fulfill({json:{suggestedReviewers:[],reviewers:[]}}));
}
async function selectRepository(page:Page){await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption(repo.full_name);await expect(page.getByTestId('pr-145')).toBeVisible();}
async function editPlan(page:Page,number=145){await page.getByRole('dialog',{name:`Details for #${number}`}).getByRole('button',{name:`Reviewers for #${number}`}).click();await page.getByRole('dialog',{name:`Reviewer plan for #${number}`}).getByRole('checkbox').first().click();}
async function signedOut(page:Page){await expect(page.getByRole('link',{name:'Continue with GitHub',exact:true})).toBeVisible();await expect(page.locator('.map-pr')).toHaveCount(0);await expect(page.getByRole('combobox',{name:'Repository'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Sign out',exact:true})).toHaveCount(0);}
test('an expired hosted session offers sign-in on first load and after reload',async({page})=>{
  await page.route('**/api/session',route=>route.fulfill({status:401,json:{configured:true,authenticated:false,error:'GitHub session expired. Sign in again.'}}));
  await page.goto('/');await signedOut(page);await expect(page.getByRole('alert')).toContainText('Sign in again');
  await page.reload();await signedOut(page);await expect(page.getByRole('alert')).toContainText('Sign in again');
});
for(const [name,body] of [['empty',''],['malformed','{'],['claims authenticated','{"configured":true,"authenticated":true,"login":"alice"}']] as const){
  test(`an expired hosted session with ${name} JSON still clears private state`,async({page})=>{
    await page.route('**/api/session',route=>route.fulfill({status:401,body}));
    await page.goto('/');await signedOut(page);await expect(page.getByRole('alert')).toContainText('Sign in again');
  });
}
for(const operation of ['workspace','plans','workflow'] as const){
  test(`${operation} authentication loss clears the connected view even without a JSON body`,async({page})=>{
    await connected(page);let reads=0;
    await page.route('**/api/github/workspace?*',route=>{reads++;return operation==='workspace'&&reads>1?route.fulfill({status:401,body:''}):route.fulfill({json:view()});});
    await page.route(`**/api/github/${operation==='workspace'?'unused':operation}`,route=>route.fulfill({status:401,body:''}));
    await selectRepository(page);
    if(operation==='workspace'){await page.getByRole('button',{name:'Map menu',exact:true}).click();await page.getByRole('button',{name:'Refresh repository',exact:true}).click();}
    else {await page.getByTestId('pr-145').getByRole('button').click();if(operation==='plans')await editPlan(page);else await page.getByRole('button',{name:'Add hold on #145',exact:true}).click();}
    await signedOut(page);await expect(page.getByRole('alert')).toContainText('Sign in again');
  });
}
for(const operation of ['plans','workflow'] as const){
  test(`a transient ${operation} failure preserves the graph and signed-in controls`,async({page})=>{
    await connected(page);await page.route('**/api/github/workspace?*',route=>route.fulfill({json:view()}));
    await page.route(`**/api/github/${operation}`,route=>route.fulfill({status:502,json:{error:'GitHub is temporarily unavailable.'}}));
    await selectRepository(page);await page.getByTestId('pr-145').getByRole('button').click();
    if(operation==='plans')await editPlan(page);else await page.getByRole('button',{name:'Add hold on #145',exact:true}).click();
    await expect(page.getByRole('alert')).toContainText('temporarily unavailable');await expect(page.getByTestId('pr-145')).toBeVisible();await expect(page.getByRole('dialog',{name:'Details for #145'})).toBeVisible();await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Continue with GitHub',exact:true})).toHaveCount(0);
  });
}
test('a late successful plan response cannot restore private state after another plan reports authentication loss',async({page})=>{
  await connected(page);await page.route('**/api/github/workspace?*',route=>route.fulfill({json:view()}));
  let release!:()=>void;let started!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const requested=new Promise<void>(resolve=>{started=resolve;});
  let finished!:()=>void;const completed=new Promise<void>(resolve=>{finished=resolve;});
  await page.route('**/api/github/plans',async route=>{const input=route.request().postDataJSON();if(input.prId==='pr-145'){started();await pending;await route.fulfill({json:{plan:{prId:input.prId,reviewerIds:input.reviewerIds,version:1,actor:'alice',updatedAt:new Date().toISOString()}}});finished();}else await route.fulfill({status:401,json:{error:'Sign in again.'}});});
  await selectRepository(page);await page.getByTestId('pr-145').getByRole('button').click();await editPlan(page);await requested;
  await page.getByRole('button',{name:'#144 Wire cache into endpoints',exact:true}).click();await editPlan(page,144);await signedOut(page);
  release();await completed;await expect(page.getByText('Planned assignment saved. No GitHub review request sent.',{exact:true})).toHaveCount(0);await signedOut(page);
});
