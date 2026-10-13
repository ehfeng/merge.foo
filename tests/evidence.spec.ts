import {test,expect} from '@playwright/test';
test('capture the verified interaction model with mock data only',async({page})=>{
  await page.route('**/api/session',r=>r.fulfill({json:{configured:false,authenticated:false}}));
  await page.setViewportSize({width:1440,height:1080});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Setup',exact:true})).toBeEnabled();
  await page.screenshot({path:'docs/screenshots/connection.png'});
  await page.getByRole('button',{name:'Explore the interaction lab'}).click();
  await expect(page.locator('.map-pr')).toHaveCount(9);
  await page.screenshot({path:'docs/screenshots/work-map.png'});
});
