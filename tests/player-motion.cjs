const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

(async () => {
  const isolated=await require('./auth-helper.cjs').startIsolated();
  const browser = await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const errors = [];
  try {
    await fs.mkdir('qa', {recursive:true});
    const editor = await browser.newPage();
    editor.on('pageerror', e => errors.push(e.message));
    await isolated.login(editor);
    await editor.goto(`${isolated.url}?view=present`);
    const pending = editor.waitForEvent('download');
    await editor.click('#exportPresentation');
    const target = path.resolve('qa/player-latest.html');
    await (await pending).saveAs(target);
    const context = await browser.newContext({offline:true,viewport:{width:1440,height:960}});
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(pathToFileURL(target).href);
    assert.equal(await page.locator('#standaloneSlide .trajectory-line').count(),1);
    assert.equal(await page.locator('#playerMotion').getAttribute('aria-pressed'),'true');
    assert.ok(await page.evaluate(() => document.getElementById('standaloneSlide').getAnimations({subtree:true}).length > 4), 'entrance must animate individual elements');
    await page.click('#playerMotion');
    assert.equal(await page.evaluate(() => document.getElementById('standaloneSlide').getAnimations({subtree:true}).length),0);
    await page.screenshot({path:'qa/cinematic-cover.png'});
    for (let i=0;i<8;i++) {
      await page.locator('#playerSceneSelect').selectOption(String(i));
      assert.equal(await page.evaluate(() => {
        const root=document.getElementById('standaloneSlide'), box=root.getBoundingClientRect();
        return [...root.querySelectorAll('.slide-text,.slide-visual,.cover-visual,.slide-footer')].every(el => {
          const r=el.getBoundingClientRect(); return r.top>=box.top && r.bottom<=box.bottom+1 && r.right<=box.right+1;
        });
      }),true,`scene ${i+1} content must fit`);
      await page.screenshot({path:`qa/cinematic-scene-${i+1}.png`});
    }
    await page.locator('#playerSceneSelect').selectOption('4');
    const slider=page.locator('#standaloneSlide .live-control input');
    const before=await page.locator('.forecast-total').first().innerText();
    await slider.fill('30');
    assert.notEqual(await page.locator('.forecast-total').first().innerText(),before);
    await slider.press('ArrowRight');
    assert.equal(await page.locator('#playerCounter').innerText(),'5 / 8');
    await page.click('#playerMotion');
    assert.ok(await page.evaluate(() => document.getElementById('standaloneSlide').getAnimations({subtree:true}).length > 4));
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.waitForFunction(() => document.body.dataset.motion === 'off');
    assert.equal(await page.evaluate(() => document.getElementById('standaloneSlide').getAnimations({subtree:true}).length),0);
    await page.emulateMedia({media:'print'});
    assert.equal(await page.locator('.player-header').isVisible(),false);
    assert.equal(await page.locator('#printSlides .slide').count(),8);
    await page.emulateMedia({media:'screen'});
    for (const width of [320,390,768,1280,1600]) {
      await page.setViewportSize({width,height:width<500?844:960});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px overflow`);
      assert.equal(await page.locator('#playerMotion').isVisible(),true);
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('#playerSceneSelect').selectOption('0');
    await page.screenshot({path:'qa/cinematic-mobile.png'});
    assert.deepEqual(errors,[]);
    console.log('PASS: offline motion export, staged entrances, motion toggle, live chart, reduced motion, 8 scene bounds, print and responsive playback.');
  } finally { await browser.close();isolated.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
