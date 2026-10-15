/* Shared account controls. Cookies are HttpOnly; identity stays in memory. */
(() => {
  const $ = id => document.getElementById(id);
  let identity, pending = false;
  const loginURL = () => '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
  async function request(url, data) {
    const response = await fetch(url, {cache:'no-store', signal:AbortSignal.timeout(15000),
      ...(data === undefined ? {} : {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)})});
    const result = await response.json();
    if (response.status === 401) location.replace(loginURL());
    if (!response.ok) throw Error(result.error || '账号操作失败，请重试');
    return result;
  }
  const style = document.createElement('style');
  style.textContent = `
    .account-dialog{color-scheme:dark;width:min(430px,calc(100% - 28px));max-height:90dvh;overflow:auto;padding:24px;border:1px solid #596281;border-radius:16px;color:#eef1ff;background:#101625;box-shadow:0 24px 80px #0008;font-family:inherit}
    .account-dialog::backdrop{background:#05080ddb;backdrop-filter:blur(5px)}
    .account-dialog .preview-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.account-dialog h2{margin:0;font-size:20px}.account-dialog .eyebrow{color:#9b8cff;font-size:10px;letter-spacing:.15em;margin:0 0 7px}
    .account-dialog label{display:block;margin-top:16px;color:#bec8e4;font-size:12px}.account-dialog input{display:block;width:100%;box-sizing:border-box;margin-top:7px;padding:12px;border:1px solid #ffffff20;border-radius:8px;background:#0a0e18;color:#f2f4ff;font:inherit}
    .account-dialog button{padding:9px 12px;border:1px solid #ffffff20;border-radius:8px;background:#ffffff08;color:#e0e5fa;font:inherit;font-size:12px;cursor:pointer}.account-dialog button:disabled{opacity:.45;cursor:wait}.account-dialog button.primary{background:#8776ee;color:white;width:auto;margin:0}
    .account-dialog .dialog-help{color:#8b96b4;font-size:12px;line-height:1.7}.account-dialog .dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}.account-dialog #passwordState{min-height:18px;margin:12px 0 0;font-size:12px;line-height:1.5;color:#ffabb5}.account-dialog #passwordState.ok{color:#8ce8bd}
    #adminBtn[hidden]{display:none!important}#accountBtn{cursor:pointer;border:1px solid #9b8cff66;color:#ddd5ff;background:#9b8cff22}#accountBtn:focus-visible,.account-dialog :focus-visible{outline:2px solid #9b8cff;outline-offset:3px}
    .account-dialog .account-identity{padding:12px;border-radius:9px;background:#9b8cff12;overflow-wrap:anywhere;color:#c9c1ff;font-size:13px;line-height:1.7}.account-dialog #accountLogout{margin-top:18px;width:100%;color:#ffb1bb}.account-dialog .account-note{font-size:11px;line-height:1.7;color:#8b96b4}
  `;
  document.head.append(style);
  let dialog = $('passwordDialog');
  if (!dialog) {
    dialog = document.createElement('dialog'); dialog.id='passwordDialog'; dialog.className='account-dialog';
    dialog.innerHTML=`<form id="passwordForm"><div class="preview-head"><div><p class="eyebrow">CANVAS OS / ACCOUNT</p><h2>账号与安全</h2></div><button type="button" id="closePassword">关闭</button></div><p class="account-identity" id="accountIdentity"></p><p class="dialog-help">修改密码后，其他登录会话将失效。</p><label>当前密码<input id="oldPassword" type="password" autocomplete="current-password" minlength="10" maxlength="128" required></label><label>新密码<input id="newPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label><label>确认新密码<input id="confirmPassword" type="password" autocomplete="new-password" minlength="10" maxlength="128" required></label><p id="passwordState" role="status" aria-live="polite"></p><div class="dialog-actions"><button type="button" id="cancelPassword">取消</button><button class="primary" type="submit">保存新密码</button></div></form><p class="account-note">当前为共享工作区，素材共享；同一浏览器中的草稿不会因切换账号而隔离。</p><button type="button" id="accountLogout">退出登录</button>`;
    document.body.append(dialog);
  }
  dialog.setAttribute('aria-label','账号与安全');
  function openAccount(){
    $('passwordForm').reset(); $('passwordState').textContent=''; $('passwordState').className='';
    if ($('accountIdentity') && identity) $('accountIdentity').textContent=`${identity.name} · @${identity.username} · ${identity.role==='admin'?'管理员':'成员'}`;
    dialog.showModal();
  }
  const avatar = document.querySelector('.rail-bottom .avatar');
  if (avatar) {
    const button=document.createElement('button');button.className=avatar.className;button.id='accountBtn';button.title='账号与安全';button.setAttribute('aria-label','账号与安全');button.textContent='…';button.onclick=openAccount;avatar.replaceWith(button);
  }
  if ($('currentUser')) {
    const button=document.createElement('button');button.id='currentUser';button.className='user-badge';button.textContent='读取账号…';button.title='点击修改密码';button.onclick=openAccount;$('currentUser').replaceWith(button);
  }
  $('closePassword').onclick=$('cancelPassword').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{$('passwordForm').reset();$('passwordState').textContent='';});
  let channel;
  try { channel=new BroadcastChannel('canvas-account');channel.onmessage=()=>check(); } catch {}
  async function logout(event){
    const button=event.currentTarget;button.disabled=true;
    try {await request('/api/auth/logout',{});channel?.postMessage('changed');location.replace('/login.html');}
    catch {button.disabled=false;button.textContent='退出失败，点击重试';}
  }
  if ($('logoutBtn')) $('logoutBtn').onclick=logout;
  if ($('accountLogout')) $('accountLogout').onclick=logout;
  $('passwordForm').onsubmit=async event=>{
    event.preventDefault(); if(pending)return;
    const output=$('passwordState');output.className='';
    if($('newPassword').value!==$('confirmPassword').value){output.textContent='两次输入的新密码不一致';return;}
    pending=true;const button=$('passwordForm').querySelector('[type=submit]');button.disabled=true;output.textContent='正在保存…';
    try{await request('/api/auth/password',{oldPassword:$('oldPassword').value,newPassword:$('newPassword').value});$('passwordForm').reset();output.className='ok';output.textContent='密码已修改，其他登录会话已撤销。';channel?.postMessage('changed');}
    catch(e){output.textContent=e.name==='TimeoutError'?'请求超时，请重试':e.message;}
    finally{pending=false;button.disabled=false;}
  };
  let checking=false;
  async function check(){
    if(checking||document.hidden)return;checking=true;
    try{
      const status=await request('/api/auth/status');
      const user=status.user;
      if(!user){location.replace(loginURL());return;}
      if(identity && (identity.id!==user.id||identity.role!==user.role)){location.reload();return;}
      identity=user;
      if($('currentUser'))$('currentUser').textContent=`${user.name} · ${user.role==='admin'?'管理员':'成员'}`;
      if($('accountBtn'))$('accountBtn').textContent=user.name.slice(0,1).toUpperCase();
      if($('adminBtn'))$('adminBtn').hidden=user.role!=='admin';
      if(location.pathname==='/admin.html'&&user.role!=='admin')location.replace('/?notice=admin-required');
    }catch{/* Keep the draft open during an offline interruption. */}
    finally{checking=false;}
  }
  document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);setInterval(check,60000);check();
})();
