import {test,expect} from '@playwright/test';

test.beforeEach(async({page})=>{await page.route('**/api/session',route=>route.fulfill({json:{configured:false,authenticated:false}}));});

test('map owns the viewport and background drag preserves selection',async({page})=>{
  await page.setViewportSize({width:1440,height:1080});await page.goto('/?lab=1');
  await expect(page.locator('.map-pr')).toHaveCount(9);await expect(page.locator('.sidebar')).toHaveCount(0);
  const viewport=await page.locator('.map-surface').boundingBox();expect(viewport?.width).toBe(1440);expect(viewport?.height).toBe(1080);
  await page.getByTestId('pr-142').getByRole('button').click();const camera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);
  await page.mouse.move(710,410);await page.mouse.down();await page.mouse.move(800,450,{steps:8});await page.mouse.up();
  await expect(page.getByRole('dialog',{name:'Details for #142'})).toBeVisible();expect(await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform)).not.toBe(camera);
  await page.getByRole('button',{name:'Close details'}).click();await expect(page.getByTestId('pr-142').getByRole('button')).toBeFocused();
});

test('search and review updates retain topology and camera',async({page})=>{
  await page.goto('/?lab=1');await expect(page.getByTestId('pr-142')).toBeVisible();const camera=await page.locator('.map-world').evaluate(e=>(e as HTMLElement).style.transform);const position=await page.getByTestId('pr-142').getAttribute('style');
  await page.getByRole('textbox',{name:'Search pull requests'}).fill('A faster API');await expect(page.getByTestId('pr-142')).not.toHaveClass(/dimmed/);await expect(page.getByTestId('pr-137')).toHaveClass(/dimmed/);
  await page.getByRole('button',{name:'Clear search'}).click();await page.getByTestId('pr-142').getByRole('button').click();await page.getByRole('button',{name:'Approve #142 as elena',exact:true}).click();
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
