const {chromium}=require('playwright');
const assert=require('node:assert/strict');

(async()=>{
  const service=await require('../tests/auth-helper.cjs').startIsolated();
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const errors=[];
  try {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    page.on('pageerror',e=>errors.push(e.message));
    await service.login(page);
    await page.goto(service.url);await page.locator('#accountBtn').waitFor();
    await page.screenshot({path:'qa/redesign-canvas-desktop.png'});
    await page.goto(service.url+'?view=present');await page.locator('.scene-item').first().waitFor();
    await page.screenshot({path:'qa/redesign-ppt-desktop.png'});
    await page.setViewportSize({width:1280,height:800});
    await page.screenshot({path:'qa/redesign-ppt-compact.png'});
    await page.goto(service.url+'admin.html');await page.locator('.user-row').waitFor();
    await page.screenshot({path:'qa/redesign-admin-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'qa/redesign-admin-mobile.png',fullPage:true});
    await page.goto(service.url+'?view=present');await page.locator('.scene-item').first().waitFor();
    await page.screenshot({path:'qa/redesign-ppt-mobile.png',fullPage:true});
    await page.evaluate(()=>localStorage.removeItem('canvas-board-v1'));
    await page.goto(service.url);await page.locator('#accountBtn').waitFor();
    await page.locator('.canvas-controls [aria-label="适应画布"]').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'qa/redesign-canvas-mobile.png'});
    const guest=await browser.newPage({viewport:{width:390,height:844}});
    await guest.goto(service.url+'login.html');await guest.locator('#submitAuth').waitFor();
    await guest.screenshot({path:'qa/redesign-login-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: desktop and mobile visual review screenshots; no page errors or horizontal overflow.');
  } finally { await browser.close();service.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
