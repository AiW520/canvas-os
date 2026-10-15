const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
const {chromium}=require('playwright');

(async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-media-test-'));
  const server=spawn('python',['server.py','--port','4181'],{cwd:path.resolve('.'),env:{...process.env,CANVAS_ASSET_DIR:path.join(dir,'assets'),CANVAS_AUTH_DB:path.join(dir,'auth.sqlite3')},windowsHide:true});
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const base='http://127.0.0.1:4181';
  const errors=[];
  try{
    for(let i=0;i<40;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>errors.push(e.message));
    await require('./auth-helper.cjs').authenticate(page,base,{register:true});
    await page.goto(base);
    assert.equal(await page.evaluate(()=>new DOMMatrix(getComputedStyle(document.getElementById('canvasContent')).transform).a),1);
    await page.locator('#mediaFileInput').setInputFiles(path.resolve('qa/cinematic-cover.png'));
    await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===1);
    const image=page.locator('.media-card').first();await image.locator('img').waitFor();
    await page.waitForFunction(()=>document.querySelector('.media-card img').naturalWidth>0);
    const imgId=await image.getAttribute('data-id');
    const handle=await image.locator('.media-drag-handle').boundingBox();
    await page.evaluate(()=>{window.edgeMutations=0;new MutationObserver(ms=>window.edgeMutations+=ms.filter(m=>m.type==='childList').length).observe(document.getElementById('edges'),{childList:true});});
    await page.mouse.move(handle.x+50,handle.y+18);await page.mouse.down();await page.mouse.move(handle.x+120,handle.y+78,{steps:20});await page.mouse.up();
    const dx=Number(await image.getAttribute('data-drag-x'));assert.ok(Math.abs(dx-70)<2);
    assert.equal(await page.evaluate(()=>window.edgeMutations),0,'drag should reuse edge nodes');
    await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===1);
    assert.equal(Number(await page.locator(`[data-id="${imgId}"]`).getAttribute('data-drag-x')),dx);
    await page.reload();assert.equal(Number(await page.locator(`[data-id="${imgId}"]`).getAttribute('data-drag-x')),dx,'position survives repeated reload');
    const choose=page.waitForEvent('filechooser');await page.locator('.media-card').getByRole('button',{name:'替换',exact:true}).click();await(await choose).setFiles(path.resolve('qa/cinematic-cover.png'));
    await page.waitForFunction(()=>document.getElementById('mediaImportStatus').textContent.includes('素材已替换'));
    assert.equal(Number(await page.locator(`[data-id="${imgId}"]`).getAttribute('data-drag-x')),dx,'replacement preserves position');
    await page.locator('.media-card').getByRole('button',{name:'加入 PPT',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#slideRoot img')?.naturalWidth>0);
    assert.equal(await page.locator('#sceneLayoutInput').inputValue(),'media');
    await page.selectOption('#sceneMediaFit','cover');assert.equal(await page.locator('#slideRoot .media-surface').getAttribute('data-fit'),'cover');
    await page.click('#publishPresentation');await page.click('#freezeDeck');await page.getByRole('button',{name:'本地预览',exact:true}).click();
    const frozen=page.frameLocator('iframe[title="冻结版本预览"]');await frozen.locator('#playerSceneSelect').selectOption('4');
    await frozen.locator('#standaloneSlide img').evaluate(img=>img.decode());
    await page.click('#closeReleaseDialog');
    const exported=page.waitForEvent('download');await page.click('#exportPresentation');const single=path.join(dir,'images.html');await(await exported).saveAs(single);
    const offline=await browser.newContext({offline:true});const player=await offline.newPage();player.on('pageerror',e=>errors.push(e.message));await player.goto(pathToFileURL(single).href);await player.selectOption('#playerSceneSelect','4');
    await player.waitForFunction(()=>document.querySelector('#standaloneSlide img')?.naturalWidth>0);
    await offline.close();
    await page.click('#exitPresentation');
    await page.bringToFront();
    // Committed 2.2-second VP8 browser recording avoids headless capture throttling.
    const videoPath=path.resolve('tests/fixtures/media-pattern.webm');
    const bytes=await fs.readFile(videoPath);
    await page.locator('#mediaFileInput').setInputFiles(videoPath);
    try{await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===2);}
    catch(error){throw Error(`Video import failed (${bytes.length} bytes): ${await page.locator('#mediaImportStatus').textContent()}; page errors: ${errors.join('; ')}`);}
    const videoCard=page.locator('.media-card').last(),video=videoCard.locator('video');
    assert.equal(await video.getAttribute('preload'),'none');assert.match(await video.getAttribute('poster'),/^\/assets\//);
    const pos=await videoCard.getAttribute('data-drag-x');await video.evaluate(v=>v.play());await page.waitForFunction(()=>document.querySelector('.media-card video').currentTime>.1);
    assert.equal(await videoCard.getAttribute('data-drag-x'),pos);
    const assetSrc=await video.getAttribute('src');const range=await page.request.get(base+assetSrc,{headers:{Range:'bytes=0-15'}});assert.equal(range.status(),206);assert.equal((await range.body()).byteLength,16);
    await videoCard.getByRole('button',{name:'预览',exact:true}).click();assert.equal(await video.evaluate(v=>v.paused),true);
    await page.locator('.media-viewer video').evaluate(v=>v.play());await page.getByRole('button',{name:'关闭预览'}).click();
    await videoCard.getByRole('button',{name:'加入 PPT',exact:true}).click();
    const slideVideo=page.locator('#slideRoot video');await slideVideo.evaluate(v=>v.play());
    await page.click('#publishPresentation');await page.click('#freezeDeck');await page.getByRole('button',{name:'本地预览',exact:true}).first().click();
    const frozenVideo=page.frameLocator('iframe[title="冻结版本预览"]');await frozenVideo.locator('#playerSceneSelect').selectOption('5');
    await frozenVideo.locator('#standaloneSlide video').evaluate(v=>v.play());
    await frozenVideo.locator('#standaloneSlide video').evaluate(v=>new Promise((resolve,reject)=>{if(v.currentTime>0)return resolve();const timer=setTimeout(()=>reject(Error('Frozen video did not play')),5000);v.ontimeupdate=()=>{if(v.currentTime>0){clearTimeout(timer);resolve();}};}));
    await page.click('#closeReleaseDialog');
    await page.click('#nextScene');assert.equal(await page.locator('#slideRoot video').count(),0);
    await page.click('#prevScene');
    const zipDownload=page.waitForEvent('download');await page.click('#exportPresentation');const zip=path.join(dir,'deck.zip');await(await zipDownload).saveAs(zip);
    const extracted=path.join(dir,'bundle');execFileSync('python',['-m','zipfile','-e',zip,extracted]);
    const context=await browser.newContext({offline:true,viewport:{width:1280,height:900}});const viewer=await context.newPage();viewer.on('pageerror',e=>errors.push(e.message));
    await viewer.goto(pathToFileURL(path.join(extracted,'index.html')).href);await viewer.selectOption('#playerSceneSelect','5');
    await viewer.locator('#standaloneSlide video').evaluate(v=>v.play());await viewer.waitForFunction(()=>document.querySelector('#standaloneSlide video').currentTime>.1);
    await viewer.selectOption('#playerSceneSelect','4');await viewer.waitForFunction(()=>document.querySelector('#standaloneSlide img')?.naturalWidth>0);
    await viewer.emulateMedia({reducedMotion:'reduce'});
    await viewer.screenshot({path:'qa/media-offline-presentation.png'});
    await page.click('#exitPresentation');await page.screenshot({path:'qa/media-canvas-ready.png'});
    await page.locator('#mediaFileInput').setInputFiles({name:'bad.png',mimeType:'image/png',buffer:Buffer.from('not an image')});
    await page.waitForFunction(()=>document.getElementById('mediaImportStatus').textContent.includes('无法解码'));
    assert.equal(await page.locator('.media-card').count(),2);
    await videoCard.getByRole('button',{name:'移出画布'}).click();await page.reload();assert.equal(await page.locator('.media-card').count(),1);
    assert.deepEqual(errors,[]);console.log('PASS: media import/decode, disk storage, thumbnail/poster, repeated reload and drag persistence, edge reuse, range seek, playback isolation, PPT fit, embedded image export, ZIP video offline playback, invalid media, remove.');
  }finally{await browser.close();server.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
