import {test,expect} from '@playwright/test';
import {createFixture} from '../src/domain/fixtures';
test.beforeEach(async({page})=>{
  await page.route('**/api/github/reviewers?*',route=>route.request().method()==='GET'?route.fulfill({json:{suggestedReviewers:[],reviewers:[]}}):route.fallback());
});
test('connected settings persist; release preview names recipients and requires an explicit early override',async({page})=>{
  let fixture=createFixture();fixture.workflowVersion=0;fixture.prs.forEach(p=>{p.canEditPlan=true;p.author='alice';p.plannedReviewerIdentities=p.plannedReviewerIds.map(login=>({login,id:String(['elena','noah','maya'].indexOf(login)+1)}));p.planVersion=0;p.workflow={enrolled:true,manualOverride:false,pending:false,uncertain:false};});fixture.stacks.forEach(s=>s.enrolled=true);
  const commands:Record<string,unknown>[]=[];
  await page.route('**/api/session',r=>r.fulfill({json:{configured:true,authenticated:true,login:'alice'}}));
  await page.route('**/api/github/repositories',r=>r.fulfill({json:{repositories:[{id:1,full_name:'selected/repo',private:true}]}}));
  await page.route('**/api/github/workspace?*',r=>r.fulfill({json:{workspace:fixture,coordination:{canManage:true,writesEnabled:true,backgroundEnabled:true},warnings:[]}}));
  await page.route('**/api/github/workflow',r=>{const input=r.request().postDataJSON();expect(input.version).toBe(fixture.workflowVersion);commands.push(input.command);const pr=fixture.prs.find(p=>p.id===input.command.prId);if(input.command.type==='start')expect(input).toMatchObject({expectedPlanVersion:0,expectedReviewers:[{id:'2',login:'noah'}]});if(input.command.type==='configure_pr'&&pr){if(input.command.held!==undefined)pr.held=input.command.held;if(input.command.parentId!==undefined)pr.parentId=input.command.parentId??undefined;if(input.command.minimumApprovals!==undefined)pr.requiredApprovals=input.command.minimumApprovals;}fixture={...fixture,workflowVersion:(fixture.workflowVersion??0)+1};return r.fulfill({json:{workspace:fixture,coordination:{canManage:true,writesEnabled:true,backgroundEnabled:true}}});});
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption('selected/repo');await page.getByTestId('pr-143').getByRole('button').click();
  await page.getByRole('button',{name:'Remove hold on #143'}).click();await expect(page.getByRole('button',{name:'Add hold on #143'})).toBeVisible();
  await page.getByRole('button',{name:'Preview review request'}).click();await expect(page.locator('.review-preview')).toContainText('@noah');await expect(page.getByRole('button',{name:'Start GitHub review',exact:true})).toBeDisabled();
  await page.getByRole('checkbox',{name:'Start this review early'}).check();await page.getByRole('button',{name:'Start GitHub review',exact:true}).click();
  expect(commands).toEqual([{type:'configure_pr',prId:'pr-143',held:false},{type:'start',prId:'pr-143',early:true}]);
  await page.getByRole('combobox',{name:'Dependency for #143'}).selectOption('');await expect(page.getByRole('combobox',{name:'Dependency for #143'})).toHaveValue('');expect(commands.at(-1)).toEqual({type:'configure_pr',prId:'pr-143',parentId:null});
});
test('operator-disabled writes leave settings available and hide notification controls',async({page})=>{
  const fixture=createFixture();fixture.workflowVersion=0;fixture.prs.forEach(p=>p.canEditPlan=true);
  await page.route('**/api/session',r=>r.fulfill({json:{configured:true,authenticated:true,login:'alice'}}));await page.route('**/api/github/repositories',r=>r.fulfill({json:{repositories:[{id:1,full_name:'selected/repo',private:true}]}}));await page.route('**/api/github/workspace?*',r=>r.fulfill({json:{workspace:fixture,coordination:{canManage:true,writesEnabled:false,backgroundEnabled:false},warnings:[]}}));
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption('selected/repo');await page.getByRole('button',{name:/^All stacks/}).click();await page.getByTestId('pr-143').getByRole('button').click();await expect(page.getByRole('button',{name:'Remove hold on #143'})).toBeVisible();await expect(page.getByRole('button',{name:'Enable feature coordination'})).toBeVisible();await expect(page.getByRole('button',{name:'Preview review request'})).toHaveCount(0);
});
