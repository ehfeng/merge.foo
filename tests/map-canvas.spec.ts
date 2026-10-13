import {test,expect,type Page} from '@playwright/test';
import {createFixture} from '../src/domain/fixtures';
import type {Workspace} from '../src/domain/types';

test.beforeEach(async({page})=>{await page.route('**/api/session',route=>route.fulfill({json:{configured:false,authenticated:false}}));});

async function connectedMap(page:Page,ownNumbers:number[]=[143,144,129],workspace:Workspace=createFixture(),allStacks=true){
  workspace.prs.forEach(pr=>{pr.author=ownNumbers.includes(pr.number)?'Alice':'colleague';pr.suggestedReviewers=[];});
  await page.route('**/api/session',route=>route.fulfill({json:{configured:true,authenticated:true,login:'alice'}}));
  await page.route('**/api/github/repositories',route=>route.fulfill({json:{repositories:[{id:1,full_name:'acme/platform',private:true}]}}));
  await page.route('**/api/github/workspace?*',route=>route.fulfill({json:{workspace,viewerLogin:'ALICE',warnings:[],coordination:{canManage:false,writesEnabled:false,backgroundEnabled:false}}}));
  await page.goto('/');await page.getByRole('combobox',{name:'Repository'}).selectOption('acme/platform');
  await expect(page.getByRole('button',{name:'My work',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('.map-pr')).toHaveCount(workspace.prs.filter(pr=>pr.author.toLowerCase()==='alice').length);
  if(allStacks){await page.getByRole('button',{name:/^All stacks/}).click();await expect(page.locator('.map-pr')).toHaveCount(workspace.prs.length);}
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
  await expect.poll(()=>page.getByRole('region',{name:'Pull request map'}).evaluate((surface,reserveControls)=>{
    const viewport=surface.getBoundingClientRect(),top=reserveControls?Math.min(viewport.width<600?148:166,viewport.height*.25):0,bottom=reserveControls?Math.min(132,viewport.height*.25):0;
    return [...surface.querySelectorAll('.map-pr')].every(node=>{const box=node.getBoundingClientRect();return box.x>=viewport.x-1&&box.y>=viewport.y+top-1&&box.right<=viewport.right+1&&box.bottom<=viewport.bottom-bottom+1;});
  },unobscured)).toBe(true);
  const viewport=await page.getByRole('region',{name:'Pull request map'}).boundingBox();expect(viewport).not.toBeNull();
  const top=unobscured?Math.min(viewport!.width<600?148:166,viewport!.height*.25):0,bottom=unobscured?Math.min(132,viewport!.height*.25):0;
  for(const node of await page.locator('.map-pr').all()){
    const box=await node.boundingBox();expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(viewport!.x-1);expect(box!.y).toBeGreaterThanOrEqual(viewport!.y+top-1);
    expect(box!.x+box!.width).toBeLessThanOrEqual(viewport!.x+viewport!.width+1);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport!.y+viewport!.height-bottom+1);
  }
}

async function mapCamera(page:Page){
  return page.locator('.map-world').evaluate(element=>{const matrix=new DOMMatrixReadOnly((element as HTMLElement).style.transform);return {x:matrix.e,y:matrix.f,zoom:matrix.a};});
}

async function canvasGap(page:Page){
  return page.getByRole('region',{name:'Pull request map'}).evaluate(surface=>{
    const viewport=surface.getBoundingClientRect();
    for(const y of [475,...Array.from({length:24},(_,i)=>180+i*20)]){
      if(y+30>=viewport.height-100)continue;
      const left={x:viewport.x+400,y:viewport.y+y},right={x:viewport.x+600,y:viewport.y+y};
      if([left,right].every(point=>{const target=document.elementFromPoint(point.x,point.y);return !!target&&surface.contains(target)&&!target.closest('button,a,input,select');}))return {left,right,midpoint:{x:500,y}};
    }
    throw new Error('No noninteractive canvas gap found for the two-touch gesture.');
  });
}

test('authenticated repository maps start with My work selected and only owned PRs',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await connectedMap(page,[143,144,129],createFixture(),false);
  await expect(page.getByRole('button',{name:'My work',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:/^All stacks/})).toHaveAttribute('aria-pressed','false');
  for(const number of [143,144,129])await expect(page.getByTestId(`pr-${number}`)).toBeVisible();
  await expect(page.getByTestId('pr-142')).toHaveCount(0);await expect(page.locator('.map-pr.dimmed')).toHaveCount(0);await expect(page.locator('.map-route-label')).toHaveCount(2);
  await expectMapNodesToFit(page,true);expect((await mapCamera(page)).zoom).toBeGreaterThan(0);
});

test('My work hides other authors, clears their details, and fits only the remaining PRs',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await connectedMap(page);
  if(process.env.MERGEFOO_CAPTURE_MY_WORK==='1')await page.screenshot({path:'/private/tmp/mergefoo-my-work-before.png'});
  if(process.env.MERGEFOO_CAPTURE_SPACING==='1'){await expectMapNodesToFit(page);await page.screenshot({path:'/private/tmp/mergefoo-spacing-overview.png'});}
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
  if(process.env.MERGEFOO_CAPTURE_SPACING==='1')await page.screenshot({path:'/private/tmp/mergefoo-spacing-my-work.png'});
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

test('the default My work view with no authored PRs starts empty and can show all stacks',async({page})=>{
  await connectedMap(page,[],createFixture(),false);
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
  await page.getByTestId('pr-142').getByRole('button').click();const camera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform),background=await canvasGap(page);
  await page.mouse.move(background.left.x,background.left.y);await page.mouse.down();await page.mouse.move(background.left.x+90,background.left.y+40,{steps:8});await page.mouse.up();
  await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(camera);
  await page.getByRole('button',{name:'Close details'}).click();await expect(page.getByTestId('pr-142').getByRole('button')).toBeFocused();
});

test('diagonal trackpad scrolling over a PR pans in screen pixels without zooming or changing selection',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await page.goto('/?lab=1');await expect(page.locator('.map-pr')).toHaveCount(9);
  await page.getByTestId('pr-142').getByRole('button').click();await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();
  const target=await page.getByTestId('pr-143').getByRole('button').boundingBox();expect(target).not.toBeNull();
  const cursor={x:target!.x+target!.width/2,y:target!.y+target!.height/2};
  expect(await page.evaluate(point=>document.elementFromPoint(point.x,point.y)?.closest('.map-pr')?.getAttribute('data-pr-id'),cursor)).toBe('pr-143');
  const before=await mapCamera(page);await page.mouse.move(cursor.x,cursor.y);await page.mouse.wheel(92,-48);
  await expect.poll(async()=>(await mapCamera(page)).x).toBeCloseTo(before.x-92,3);await expect.poll(async()=>(await mapCamera(page)).y).toBeCloseTo(before.y+48,3);
  expect((await mapCamera(page)).zoom).toBe(before.zoom);await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();
  await expect(page.getByTestId('pr-142').getByRole('button')).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('pr-143').getByRole('button')).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>({x:window.scrollX,y:window.scrollY}))).toEqual({x:0,y:0});
});

test('trackpad pinch wheel zooms around the cursor while preventing browser zoom and page scrolling',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await page.goto('/?lab=1');await expect(page.locator('.map-pr')).toHaveCount(9);
  const map=page.getByRole('region',{name:'Pull request map'}),viewport=await map.boundingBox();expect(viewport).not.toBeNull();
  const cursor={x:viewport!.x+620,y:viewport!.y+360},anchor={x:cursor.x-viewport!.x,y:cursor.y-viewport!.y};
  const before=await mapCamera(page),worldAnchor={x:(anchor.x-before.x)/before.zoom,y:(anchor.y-before.y)/before.zoom};
  const browserBefore=await page.evaluate(()=>({x:window.scrollX,y:window.scrollY,width:window.innerWidth,height:window.innerHeight,scale:window.visualViewport?.scale??1}));
  await page.evaluate(()=>{document.addEventListener('wheel',event=>{(window as typeof window&{observedWheel?:{prevented:boolean;pinch:boolean}}).observedWheel={prevented:event.defaultPrevented,pinch:event.ctrlKey};},{once:true});});
  await page.mouse.move(cursor.x,cursor.y);await page.keyboard.down('Control');try{await page.mouse.wheel(0,-100);}finally{await page.keyboard.up('Control');}
  await expect.poll(async()=>(await mapCamera(page)).zoom).toBeGreaterThan(before.zoom);const after=await mapCamera(page);
  expect((anchor.x-after.x)/after.zoom).toBeCloseTo(worldAnchor.x,2);expect((anchor.y-after.y)/after.zoom).toBeCloseTo(worldAnchor.y,2);
  expect(await page.evaluate(()=>(window as typeof window&{observedWheel?:{prevented:boolean;pinch:boolean}}).observedWheel)).toEqual({prevented:true,pinch:true});
  expect(await page.evaluate(()=>({x:window.scrollX,y:window.scrollY,width:window.innerWidth,height:window.innerHeight,scale:window.visualViewport?.scale??1}))).toEqual(browserBefore);
});

test('two touch points can pan and pinch simultaneously while preserving selection',async({page})=>{
  await page.setViewportSize({width:1280,height:720});await page.goto('/?lab=1');await expect(page.locator('.map-pr')).toHaveCount(9);
  await page.getByTestId('pr-142').getByRole('button').click();await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();
  const map=page.getByRole('region',{name:'Pull request map'}),viewport=await map.boundingBox();expect(viewport).not.toBeNull();const before=await mapCamera(page),background=await canvasGap(page);
  const initialMidpoint=background.midpoint,nextMidpoint={x:initialMidpoint.x+60,y:initialMidpoint.y+30},worldAnchor={x:(initialMidpoint.x-before.x)/before.zoom,y:(initialMidpoint.y-before.y)/before.zoom};
  for(const point of [background.left,background.right]){
    expect(await page.evaluate(({x,y})=>{const target=document.elementFromPoint(x,y);return !!target?.closest('.map-surface')&&!target.closest('button,a,input,select');},point)).toBe(true);
  }
  const client=await page.context().newCDPSession(page);await client.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
  try{
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,...background.left},{id:2,...background.right}]});
    await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:background.left.x+10,y:background.left.y+30},{id:2,x:background.right.x+110,y:background.right.y+30}]});
    await expect.poll(async()=>(await mapCamera(page)).zoom).toBeCloseTo(before.zoom*1.5,3);const after=await mapCamera(page);
    expect((nextMidpoint.x-after.x)/after.zoom).toBeCloseTo(worldAnchor.x,2);expect((nextMidpoint.y-after.y)/after.zoom).toBeCloseTo(worldAnchor.y,2);
  }finally{await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await client.detach();}
  await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();await expect(page.getByTestId('pr-142').getByRole('button')).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>({x:window.scrollX,y:window.scrollY,scale:window.visualViewport?.scale??1}))).toEqual({x:0,y:0,scale:1});
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
