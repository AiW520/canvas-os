const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-team-beta-'));
  const base='http://127.0.0.1:4197';
  const service=spawn('python',['server.py','--port','4197'],{windowsHide:true,env:{...process.env,CANVAS_ASSET_DIR:path.join(temp,'assets'),CANVAS_AUTH_DB:path.join(temp,'auth.sqlite3')}});
  const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const errors=[];
  try{
    for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
    await require('./auth-helper.cjs').authenticate(page,base,{register:true});
    await page.goto(base+'/admin.html');page.on('dialog',dialog=>dialog.accept());
    await page.click('#createInvite');await page.locator('#inviteLink').waitFor({state:'visible'});
    const link=await page.locator('#inviteLink').inputValue();assert.match(link,/#invite=/);
    const guestContext=await browser.newContext();const guest=await guestContext.newPage();guest.on('pageerror',e=>errors.push(e.message));
    await guest.goto(link);await guest.locator('#nameField').waitFor({state:'visible'});
    assert.equal(new URL(guest.url()).hash,'');
    await guest.fill('#username','invited_member');await guest.fill('#name','受邀测试成员');await guest.fill('#password','Invited-member-password!');await guest.fill('#confirm','Invited-member-password!');
    await guest.click('#submitAuth');await guest.waitForURL(base+'/');await guest.waitForFunction(()=>document.getElementById('accountBtn')?.textContent==='受');
    assert.equal(await guest.locator('#adminBtn').isVisible(),false);
    await guestContext.close();
    await page.goto(base);
    const uploaded=await page.request.post(base+'/api/assets',{headers:{Origin:base,'Content-Type':'image/png'},data:await fs.readFile('qa/cinematic-cover.png')});const asset=await uploaded.json();
    let calls=0,requestId;
    await page.route('**/api/assets/generate',async route=>{
      calls++;const payload=route.request().postDataJSON();assert.equal(payload.prompt,'测试提示词，不调用付费接口');
      if(calls===1){requestId=payload.requestId;await route.fulfill({status:502,json:{error:'生成结果未确认',uncertain:true}});}
      else{assert.equal(payload.requestId,requestId);await route.fulfill({status:201,json:asset});}
    });
    await page.click('#generateMedia');await page.fill('#generatePrompt','测试提示词，不调用付费接口');await page.click('#submitGenerate');
    await page.waitForFunction(()=>document.getElementById('generateState').textContent==='生成结果未确认');
    await page.reload();await page.click('#generateMedia');await page.click('#checkGeneration');
    await page.waitForFunction(()=>document.querySelector('.media-card img')?.naturalWidth>0);
    assert.equal(calls,2);assert.equal(await page.locator('#checkGeneration').isVisible(),false);
    await page.click('#cancelGenerate');await page.click('#mediaLibrary');assert.equal(await page.locator('.media-library').evaluate(d=>d.open),true);
    await page.click('.library-close');
    await page.locator('[data-id="research"]').click();await page.click('#connectObject');await page.locator('.media-card .media-drag-handle').click();
    await page.reload();assert.match(await page.locator('#connectionMeta').innerText(),/^9 /);
    await page.screenshot({path:'qa/team-beta-canvas.png'});
    await page.goto(base+'/admin.html');await page.screenshot({path:'qa/team-beta-admin.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);console.log('PASS: invitation registration, member navigation, generation uncertainty/recovery with same request ID, material library entry, custom connection persistence, mobile admin layout. Provider is mocked; no paid API call.');
  }finally{await browser.close();service.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
