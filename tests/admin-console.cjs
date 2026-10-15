const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawn,execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
(async()=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-admin-test-'));
  const service=spawn('python',['server.py','--port','4182'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,CANVAS_ASSET_DIR:path.join(temp,'assets'),CANVAS_AUTH_DB:path.join(temp,'auth.sqlite3')}});
  const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const base='http://127.0.0.1:4182',errors=[];
  try{
    for(let i=0;i<50;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
    const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));
    await require('./auth-helper.cjs').authenticate(page,base,{register:true});
    await page.goto(base);await page.click('#adminBtn');await page.waitForFunction(()=>document.getElementById('serviceState').textContent==='正常运行');
    assert.match(await page.locator('#assetList').innerText(),/还没有文件/);
    // Import a valid existing PNG into the isolated server only.
    const response=await page.request.post(base+'/api/assets',{headers:{Origin:base,'Content-Type':'image/png','X-File-Name':encodeURIComponent('控制台链路验证.png')},data:await fs.readFile('qa/cinematic-cover.png')});
    assert.equal(response.status(),201);const asset=await response.json();
    await page.click('#refreshAdmin');await page.locator('.asset-row').waitFor();
    await page.fill('#assetSearch','不存在');assert.equal(await page.locator('.asset-row').count(),0);
    await page.fill('#assetSearch','控制台');assert.equal(await page.locator('.asset-row').count(),1);
    await page.getByRole('button',{name:'预览',exact:true}).click();await page.locator('#previewMedia img').evaluate(img=>img.decode());await page.click('#closePreview');
    await page.getByRole('button',{name:'添加到画布',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.media-card img')?.naturalWidth>0);
    assert.equal(await page.locator('.media-card').count(),1);await page.reload();assert.equal(await page.locator('.media-card').count(),1,'refresh must not repeat admin action');
    await page.click('#adminBtn');await page.locator('.asset-row').waitFor();await page.getByRole('button',{name:'加入 PPT',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#slideRoot img')?.naturalWidth>0);assert.equal(await page.locator('.scene-item').count(),9);
    await page.reload();assert.equal(await page.locator('.scene-item').count(),9,'PPT handoff must be consumed');
    await page.goto(base+'/admin.html');await page.locator('.asset-row').waitFor();
    await page.evaluate(()=>localStorage.setItem('unrelated-api-key','SECRET_NOT_IN_BACKUP'));
    const downloaded=page.waitForEvent('download');await page.click('#createBackup');const backup=path.join(temp,'backup.zip');await(await downloaded).saveAs(backup);
    execFileSync('python',['-c',"import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);d=z.read('browser-data.json');assert b'SECRET_NOT_IN_BACKUP' not in d;assert 'presentation.json' in z.namelist();assert any(n.endswith('.png') for n in z.namelist())",backup]);
    // A missing binary is shown as actionable failure without enabling broken links.
    await fs.unlink(path.join(temp,'assets',asset.id+'.png'));await page.click('#refreshAdmin');await page.waitForFunction(()=>!document.getElementById('assetIssues').hidden);
    assert.equal(await page.getByRole('button',{name:'加入 PPT',exact:true}).isDisabled(),true);
    await page.screenshot({path:'qa/admin-console-desktop.png'});
    await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'qa/admin-console-mobile.png',fullPage:true});
    await page.setViewportSize({width:1440,height:1000});await page.getByRole('link',{name:'配置文本 AI 连接'}).click();await page.locator('#aiEndpoint').waitFor({state:'visible'});
    await page.goto(base+'/admin.html');await page.getByRole('link',{name:'发布检查与冻结版本'}).click();await page.waitForFunction(()=>document.querySelector('#releaseDialog')?.open||document.querySelector('dialog.deck-dialog')?.open);
    await page.goto(base+'/admin.html');await page.click('#openLibrary');await page.waitForFunction(()=>document.querySelector('.media-library')?.open);
    assert.deepEqual(errors,[]);console.log('PASS: admin entry/status, isolated inventory/search/preview, one-shot canvas/PPT handoff, full backup with assets and credential exclusion, missing file controls, responsive layout, AI/version/library shortcuts.');
  }finally{await browser.close();service.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
