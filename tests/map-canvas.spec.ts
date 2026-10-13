import {test,expect,type Page} from '@playwright/test';
import {createFixture} from '../src/domain/fixtures';
import type {Workspace} from '../src/domain/types';

test.beforeEach(async({page})=>{await page.route('**/api/session',route=>route.fulfill({json:{configured:false,authenticated:false}}));});

async function connectedMap(page:Page,ownNumbers:number[]=[143,144,129],workspace:Workspace=createFixture()){
  workspace.prs.forEach(pr=>{pr.author=ownNumbers.includes(pr.number)?'Alice':'colleague';pr.suggestedReviewers=[];});
  await page.route('**/api/session',route=>route.fulfill({json:{configured:true,authenticated:true,login:'alice'}}));
  await page.route('**/api/github/repositories',route=>route.fulfill({json:{repositories:[{id:1,full_name:'acme/platform',private:true}]}}));
  await page.route('**/api/github/workspace?*',route=>route.fulfill({json:{workspace,viewerLogin:'ALICE',warnings:[],coordination:{canManage:false,writesEnabled:false,backgroundEnabled:false}}}));
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption('acme/platform');
  await expect(page.locator('.map-pr')).toHaveCount(workspace.prs.length);
}

function manyOwnStacks(){
  const workspace=createFixture(),seed=workspace.prs[0],ownNumbers=Array.from({length:50},(_,i)=>1000+i);
  for(const number of ownNumbers){
    const stackId=`own-${number}`;
    workspace.stacks.push({id:stackId,title:`Independent feature ${number}`,description:'One independent pull request',autoProgress:false,color:'#8171d4'});
    workspace.prs.push({...seed,id:`pr-${number}`,number,title:`Independent change ${number}`,branch:`independent-${number}`,stackId,parentId:undefined,requests:[],reviews:[],plannedReviewerIds:[],readiness:'draft'});
  }
  return {workspace,ownNumbers};
}

async function expectMapNodesToFit(page:Page,unobscured=false){
  const viewport=await page.getByRole('region',{name:'Pull request map'}).boundingBox();expect(viewport).not.toBeNull();
  const top=unobscured?Math.min(viewport!.width<600?148:166,viewport!.height*.25):0,bottom=unobscured?Math.min(132,viewport!.height*.25):0;
  for(const node of await page.locator('.map-pr').all()){
    const box=await node.boundingBox();expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(viewport!.x-1);expect(box!.y).toBeGreaterThanOrEqual(viewport!.y+top-1);
    expect(box!.x+box!.width).toBeLessThanOrEqual(viewport!.x+viewport!.width+1);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport!.y+viewport!.height-bottom+1);
  }
}

test('My work hides other authors, clears their details, and fits only the remaining PRs',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await connectedMap(page);
  if(process.env.MERGEFOO_CAPTURE_MY_WORK==='1')await page.screenshot({path:'/private/tmp/mergefoo-my-work-before.png'});
  await page.getByTestId('pr-142').getByRole('button').click();await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();
  const map=page.getByRole('region',{name:'Pull request map'});await map.focus();
  for(let i=0;i<6;i++)await page.keyboard.press('ArrowLeft');await page.keyboard.press('-');await page.keyboard.press('-');
  const previousCamera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);
  const previousZoom=Number(await map.getAttribute('data-zoom'));
  await page.getByRole('button',{name:'My work',exact:true}).click();
  await expect(page.locator('.map-pr')).toHaveCount(3);await expect(page.locator('.map-pr.dimmed')).toHaveCount(0);
  for(const number of [143,144,129])await expect(page.getByTestId(`pr-${number}`)).toBeVisible();
  for(const number of [142,145,137,138,139,128])await expect(page.getByTestId(`pr-${number}`)).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Details for #142'})).toHaveCount(0);
  await expect(page.locator('.map-route')).toHaveCount(1);await expect(page.locator('.map-route-label')).toHaveCount(2);
  await expect(page.locator('.map-route-label').filter({hasText:'Reliable billing'})).toHaveCount(0);
  await expect(page.locator('.map-status-strip')).toContainText('0 in review');await expect(page.locator('.map-status-strip')).toContainText('2 queued');await expect(page.locator('.map-status-strip')).toContainText('1 held');
  await expect.poll(()=>page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(previousCamera);
  await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(previousZoom);await expectMapNodesToFit(page,true);
  if(process.env.MERGEFOO_CAPTURE_MY_WORK==='1')await page.screenshot({path:'/private/tmp/mergefoo-my-work-after.png'});
  await page.getByRole('button',{name:/^All stacks/}).click();await expect(page.locator('.map-pr')).toHaveCount(9);
  await expect(page.locator('.map-route')).toHaveCount(6);await expect(page.locator('.map-route-label')).toHaveCount(3);await expectMapNodesToFit(page);
});

for(const mobile of [false,true])test(`My work fits 50 independent stacks in the ${mobile?'mobile':'desktop'} viewport`,async({page})=>{
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1280,height:720});
  const {workspace,ownNumbers}=manyOwnStacks();await connectedMap(page,ownNumbers,workspace);
  await page.getByRole('button',{name:'My work',exact:true}).click();await expect(page.locator('.map-pr')).toHaveCount(50);
  await expect(page.locator('.map-route')).toHaveCount(0);await expect(page.locator('.map-route-label')).toHaveCount(50);
  const map=page.getByRole('region',{name:'Pull request map'});
  await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeLessThan(.15);
  expect(Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(0);await expectMapNodesToFit(page,true);
  expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toMatch(/NaN|Infinity/);
});

test('My work refits on both mode switches when every PR is authored by the viewer',async({page})=>{
  await page.setViewportSize({width:1280,height:720});const workspace=createFixture();await connectedMap(page,workspace.prs.map(pr=>pr.number),workspace);
  const map=page.getByRole('region',{name:'Pull request map'});await page.getByRole('button',{name:'Fit all stacks',exact:true}).click();await expectMapNodesToFit(page);
  const fittedCamera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);
  await map.focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('+');
  const displacedCamera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);expect(displacedCamera).not.toBe(fittedCamera);
  await page.getByRole('button',{name:'My work',exact:true}).click();await expect(page.locator('.map-pr')).toHaveCount(9);
  await expect.poll(()=>page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(displacedCamera);await expectMapNodesToFit(page,true);
  const mineCamera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);
  await map.focus();await page.keyboard.press('ArrowDown');await page.keyboard.press('+');
  expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(mineCamera);
  await page.getByRole('button',{name:/^All stacks/}).click();await expect(page.locator('.map-pr')).toHaveCount(9);
  await expect.poll(()=>page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).toBe(fittedCamera);await expectMapNodesToFit(page);
});

test('search within My work preserves its compact topology and camera',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await connectedMap(page);const fullCamera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);await page.getByRole('button',{name:'My work',exact:true}).click();
  await expect(page.locator('.map-pr')).toHaveCount(3);const map=page.getByRole('region',{name:'Pull request map'});
  await expect.poll(()=>page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(fullCamera);await expectMapNodesToFit(page,true);await map.focus();await page.keyboard.press('ArrowLeft');await page.keyboard.press('+');
  const camera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);
  const positions=await page.locator('.map-pr').evaluateAll(nodes=>nodes.map(node=>({id:node.getAttribute('data-pr-id'),style:node.getAttribute('style')})));
  await page.getByRole('textbox',{name:'Search pull requests'}).fill('Add the cache layer');
  await expect(page.getByTestId('pr-143')).not.toHaveClass(/dimmed/);await expect(page.getByTestId('pr-144')).toHaveClass(/dimmed/);await expect(page.getByTestId('pr-129')).toHaveClass(/dimmed/);
  await expect(page.locator('.map-pr')).toHaveCount(3);await expect(page.getByTestId('pr-142')).toHaveCount(0);await expect(page.locator('.map-route-label')).toHaveCount(2);
  expect(await page.locator('.map-pr').evaluateAll(nodes=>nodes.map(node=>({id:node.getAttribute('data-pr-id'),style:node.getAttribute('style')})))).toEqual(positions);
  expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).toBe(camera);
  await page.getByRole('button',{name:'Clear search'}).click();await expect(page.locator('.map-pr.dimmed')).toHaveCount(0);
  expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).toBe(camera);
});

test('My work with no authored PRs shows an empty map and restores all stacks',async({page})=>{
  await connectedMap(page,[]);await page.getByRole('button',{name:'My work',exact:true}).click();
  await expect(page.locator('.map-pr')).toHaveCount(0);await expect(page.locator('.map-route')).toHaveCount(0);await expect(page.locator('.map-route-label')).toHaveCount(0);
  await expect(page.locator('.map-empty')).toBeVisible();await expect(page.locator('.map-empty')).toContainText(/No .*pull requests/i);await expect(page.locator('.map-empty')).toContainText(/My work|authored|your own/i);
  const map=page.getByRole('region',{name:'Pull request map'});expect(Number.isFinite(Number(await map.getAttribute('data-zoom')))).toBe(true);
  expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toMatch(/NaN|Infinity/);
  await page.getByRole('button',{name:'Fit all stacks',exact:true}).click();expect(Number.isFinite(Number(await map.getAttribute('data-zoom')))).toBe(true);
  await page.getByRole('button',{name:/^All stacks/}).click();await expect(page.locator('.map-pr')).toHaveCount(9);await expect(page.locator('.map-empty')).toHaveCount(0);await expectMapNodesToFit(page);
});

test('map owns the viewport and background drag preserves selection',async({page})=>{
  await page.setViewportSize({width:1440,height:1080});await page.goto('/?lab=1');
  await expect(page.locator('.map-pr')).toHaveCount(9);await expect(page.locator('.sidebar')).toHaveCount(0);
  const viewport=await page.locator('.map-surface').boundingBox();expect(viewport?.width).toBe(1440);expect(viewport?.height).toBe(1080);
  await page.getByTestId('pr-142').getByRole('button').click();const camera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);
  await page.mouse.move(710,410);await page.mouse.down();await page.mouse.move(800,450,{steps:8});await page.mouse.up();
  await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(camera);
  await page.getByRole('button',{name:'Close details'}).click();await expect(page.getByTestId('pr-142').getByRole('button')).toBeFocused();
});

test('search, attention, and review updates retain topology and camera',async({page})=>{
  await page.goto('/?lab=1');await expect(page.getByTestId('pr-142')).toBeVisible();const camera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);const position=await page.getByTestId('pr-142').getAttribute('style');
  await page.getByRole('textbox',{name:'Search pull requests'}).fill('A faster API');await expect(page.getByTestId('pr-142')).not.toHaveClass(/dimmed/);await expect(page.getByTestId('pr-137')).toHaveClass(/dimmed/);
  await page.getByRole('button',{name:'Clear search'}).click();await page.getByRole('button',{name:'Needs attention',exact:true}).click();
  await expect(page.locator('.map-pr')).toHaveCount(9);await expect(page.getByTestId('pr-143')).not.toHaveClass(/dimmed/);await expect(page.getByTestId('pr-145')).toHaveClass(/dimmed/);
  expect(await page.getByTestId('pr-142').getAttribute('style')).toBe(position);expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).toBe(camera);
  await page.getByRole('button',{name:/^All stacks/}).click();await page.getByTestId('pr-142').getByRole('button').click();await page.getByRole('button',{name:'Approve #142 as elena',exact:true}).click();
  expect(await page.getByTestId('pr-142').getAttribute('style')).toBe(position);expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).toBe(camera);
});

test('map keyboard shortcuts stay out of search and support fit',async({page})=>{
  await page.goto('/?lab=1');await expect(page.locator('.map-pr')).toHaveCount(9);const map=page.getByRole('region',{name:'Pull request map'});const initial=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);
  await page.getByRole('textbox',{name:'Search pull requests'}).focus();await page.keyboard.press('ArrowRight');expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).toBe(initial);
  await map.focus();await page.keyboard.press('ArrowRight');expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(initial);
  await page.keyboard.press('Home');await expect.poll(()=>page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).toBe(initial);
  const zoom=Number(await map.getAttribute('data-zoom'));await page.keyboard.press('+');await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(zoom);
});

test('mobile begins at a readable review point and opens temporary details',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/?lab=1');const map=page.getByRole('region',{name:'Pull request map'});
  await expect.poll(async()=>Number(await map.getAttribute('data-zoom'))).toBeGreaterThan(.75);await page.getByTestId('pr-142').getByRole('button').click();const panel=page.getByRole('dialog',{name:'Details for #142'});await expect(panel).toBeVisible();
  const bounds=await panel.boundingBox();expect(bounds?.width).toBeLessThan(390);expect(bounds?.height).toBeLessThan(700);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('button',{name:'Close details'}).click();await page.getByRole('button',{name:'Fit all stacks'}).click();
  const viewport=await map.boundingBox();for(const node of await page.locator('.map-pr').all()){const box=await node.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(viewport!.x);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport!.x+viewport!.width+1);}
});


test('offscreen keyboard focus reveals a PR without scrolling the document',async({page})=>{
 await page.goto('/?lab=1');await expect(page.locator('.map-pr')).toHaveCount(9);const map=page.getByRole('region',{name:'Pull request map'});await map.focus();
 for(let i=0;i<12;i++)await page.keyboard.press('ArrowLeft');
 const camera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);
 await page.getByTestId('pr-145').getByRole('button').focus();
 await expect.poll(()=>page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(camera);
 const viewport=await map.boundingBox();const node=await page.getByTestId('pr-145').boundingBox();expect(node!.x).toBeGreaterThanOrEqual(viewport!.x);expect(node!.x+node!.width).toBeLessThanOrEqual(viewport!.x+viewport!.width);
 expect(await page.evaluate(()=>window.scrollX+window.scrollY)).toBe(0);
});
