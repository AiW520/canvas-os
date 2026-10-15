// Regression accounts must live in an isolated test service, never port 4173.
exports.authenticate=async function(page,base,{register=false}={}){
  const origin=new URL(base).origin;
  if(new URL(base).port==='4173')throw Error('Run against an isolated TEST_URL; regression must not create or reuse real accounts.');
  const response=await page.request.post(origin+'/api/auth/'+(register?'register':'login'),{
    headers:{Origin:origin},data:{username:'regression_admin',name:'回归测试管理员',password:'Isolated-regression-password!'}
  });
  if(!response.ok())throw Error('Test authentication failed: '+response.status()+' '+await response.text());
};

exports.startIsolated=async function(){
  const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-ppt-regression-'));
  const process=spawn('python',['server.py','--port','0'],{windowsHide:true,env:{...global.process.env,CANVAS_AUTH_DB:path.join(dir,'auth.sqlite3'),CANVAS_ASSET_DIR:path.join(dir,'assets')}});
  const url=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>{process.kill();reject(Error('Isolated service startup timed out'));},15000);
    let output='';process.stdout.on('data',data=>{output+=data.toString();const match=output.match(/http:\/\/127\.0\.0\.1:\d+\//);if(match){clearTimeout(timer);resolve(match[0]);}});
    process.on('error',error=>{clearTimeout(timer);reject(error);});process.on('exit',code=>{clearTimeout(timer);reject(Error('Isolated service exited: '+code));});
  });
  let registered=false;
  return {url,async login(page){await exports.authenticate(page,url,{register:!registered});registered=true;},close(){process.kill();}};
};
