/* Local administration: explicit reads, one-shot handoffs, and bounded lists. */
(() => {
  const $=id=>document.getElementById(id), make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  $('checkReadiness').onclick=async()=>{
    $('checkReadiness').disabled=true;$('readinessList').textContent='正在检查…';
    try{const data=await request('/api/admin/readiness',{},20000);$('readinessList').replaceChildren();for(const item of data.checks){const row=make('p',item.ok?'ok-text':'error-text',`${item.ok?'✓':'待处理'} · ${item.title}：${item.detail}`);$('readinessList').append(row);}$('readinessList').append(make('p','muted',data.note));}
    catch(e){$('readinessList').textContent=e.message;}finally{$('checkReadiness').disabled=false;}
  };
  const keys=['canvas-board-v1','canvas-connections-v1','canvas-media-nodes-v1','canvas-os-project-v3','canvas-os-deck-snapshots-v1','canvas-os-scenes-v2','canvas-os-scenes-v1','canvas-os-objects-v1'];
  const format=b=>{if(!Number.isFinite(b))return '—';if(b>=1024**3)return `${(b/1024**3).toFixed(1)} GB`;if(b>=1024**2)return `${(b/1024**2).toFixed(1)} MB`;return `${Math.round(b/1024)} KB`;};
  const date=v=>new Date(v).toLocaleString('zh-CN');let state,pageIndex=0,connected=false;const pageSize=12;
  let usersPage=1, usersData, userRequest=0, userBusy=false, currentUser;
  const userState=make('p','user-state');userState.id='userState';userState.setAttribute('role','status');userState.setAttribute('aria-live','polite');$('userList').before(userState);
  const invites=make('div','invite-tools'),createInvite=make('button','','生成单次邀请'),revokeInvites=make('button','','撤销未使用邀请'),inviteLink=make('input');
  createInvite.id='createInvite';revokeInvites.id='revokeInvites';inviteLink.id='inviteLink';inviteLink.readOnly=true;inviteLink.hidden=true;inviteLink.setAttribute('aria-label','单次邀请链接');inviteLink.onclick=()=>inviteLink.select();
  invites.append(createInvite,revokeInvites,inviteLink);userState.before(invites);
  createInvite.onclick=async()=>{
    if(!confirm('生成邀请后将关闭公开注册。邀请在 72 小时内有效，只能使用一次；新成员可访问共享素材。'))return;
    createInvite.disabled=true;
    try{const data=await request('/api/admin/invites',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});inviteLink.value=location.origin+'/login.html#invite='+data.invite;inviteLink.hidden=false;inviteLink.select();userMessage('邀请已生成，请复制链接发送给成员；链接需要在团队可访问的 HTTPS 域名下使用；本机预览地址不能跨设备访问。');await loadUsers();}
    catch(e){userMessage(e.message,true);}finally{createInvite.disabled=false;}
  };
  revokeInvites.onclick=async()=>{
    if(!confirm('撤销所有尚未使用的邀请？已注册成员不受影响。'))return;
    revokeInvites.disabled=true;try{await request('/api/admin/invites/revoke',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});inviteLink.value='';inviteLink.hidden=true;userMessage('未使用邀请已全部撤销。');}catch(e){userMessage(e.message,true);}finally{revokeInvites.disabled=false;}
  };
  const accountAudit=make('details','account-audit'),auditTitle=make('summary','','账号安全记录'),auditList=make('div','event-list');accountAudit.append(auditTitle,auditList);$('userList').parentElement.append(accountAudit);
  function userMessage(message,error=false){userState.textContent=message;userState.className=error?'user-state error-text':'user-state ok-text';}
  function renderUsers(){
    const list=$('userList');list.replaceChildren();if(!usersData)return;
    $('userCount').textContent=`共 ${usersData.total} 个用户 · 第 ${usersData.page} / ${Math.max(1,Math.ceil(usersData.total/20))} 页`;
    $('prevUserPage').disabled=userBusy||usersData.page<=1;$('nextUserPage').disabled=userBusy||usersData.page*20>=usersData.total;
    $('toggleRegistration').disabled=userBusy;$('toggleRegistration').textContent=usersData.registrationOpen?'注册已开放 · 关闭注册':'注册已关闭 · 开放注册';
    if(!usersData.users.length)list.append(make('div','empty','没有找到匹配的用户。'));
    for(const user of usersData.users){
      const own=user.id===currentUser?.id,row=make('article',`user-row ${user.active?'':'inactive'}`),identity=make('div','user-identity'),meta=make('div','user-meta'),actions=make('div','user-actions');row.dataset.userId=user.id;
      identity.append(make('strong','',user.name+(own?'（当前账号）':'')),make('small','',`@${user.username} · 注册于 ${date(user.created*1000)}`),make('small','',user.last_login?`最近登录 ${date(user.last_login*1000)}`:'尚未登录'));
      meta.append(make('span',`role-pill ${user.role}`,user.role==='admin'?'管理员':'成员'),make('span',`status-pill ${user.active?'active':'inactive'}`,user.active?'已启用':'已停用'));
      const role=make('button','',user.role==='admin'?'设为成员':'设为管理员'),active=make('button','',user.active?'停用账号':'启用账号');
      role.disabled=active.disabled=own||userBusy;if(own){role.title=active.title='不能修改当前账号的角色或启用状态';}
      role.onclick=()=>updateUser(user,{role:user.role==='admin'?'member':'admin',active:!!user.active});active.onclick=()=>updateUser(user,{role:user.role,active:!user.active});actions.append(role,active);row.append(identity,meta,actions);list.append(row);
    }
    auditList.replaceChildren();for(const event of usersData.events){const row=make('div','event-row');row.append(make('strong','',event.action),make('small','',`${event.actor} → ${event.target} · ${date(event.at*1000)}`));auditList.append(row);}
    if(!usersData.events.length)auditList.append(make('p','empty','暂无账号安全记录。'));
  }
  async function loadUsers(){
    const sequence=++userRequest;
    try{const [identity,data]=await Promise.all([request('/api/auth/status'),request(`/api/admin/users?page=${usersPage}&q=${encodeURIComponent($('userSearch').value.trim())}`)]);if(sequence!==userRequest)return;currentUser=identity.user;usersData=data;usersPage=data.page;renderUsers();}
    catch(e){if(sequence!==userRequest)return;userMessage(e.message,true);$('userList').replaceChildren(make('div','empty','用户列表加载失败，请点击刷新状态重试。'));}
  }
  async function updateUser(user,change){
    if(userBusy)return;
    const action=change.active!==!!user.active?(change.active?'启用账号':'停用账号'):(change.role==='admin'?'设为管理员':'设为成员');
    if(!confirm(`将「${user.name}（@${user.username}）」${action}？\n${change.role==='admin'?'管理员可管理全部共享素材、备份和账号。\n':''}该账号的现有登录会话将被撤销。`))return;
    userBusy=true;renderUsers();userMessage('正在更新账号…');
    try{await request('/api/admin/users/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id,...change})});userMessage(`已${action}：${user.name}`);await loadUsers();}
    catch(e){userMessage(e.message,true);}
    finally{userBusy=false;renderUsers();}
  }
  $('toggleRegistration').onclick=async()=>{
    if(!usersData||userBusy)return;userBusy=true;renderUsers();
    try{const enabled=!usersData.registrationOpen;await request('/api/admin/registration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled})});userMessage(enabled?'注册已开放，新账号将默认成为成员。':'注册已关闭，已有账号仍可正常登录。');await loadUsers();}
    catch(e){userMessage(e.message,true);}finally{userBusy=false;renderUsers();}
  };
  let searchTimer;$('userSearch').oninput=()=>{clearTimeout(searchTimer);userRequest++;searchTimer=setTimeout(()=>{usersPage=1;loadUsers();},250);};
  $('prevUserPage').onclick=()=>{usersPage--;loadUsers();};$('nextUserPage').onclick=()=>{usersPage++;loadUsers();};
  function toast(message,error=false){$('backupState').textContent=message;$('backupState').className=error?'error-text':'ok-text';}
  function collectStorage(){const result={};for(const key of keys){const value=localStorage.getItem(key);if(value!==null)result[key]=value;}return result;}
  function browserSummary(){try{const data=collectStorage(),project=JSON.parse(data['canvas-os-project-v3']||'{}'),scenes=project.scenes||JSON.parse(data['canvas-os-scenes-v2']||data['canvas-os-scenes-v1']||'[]'),nodes=JSON.parse(data['canvas-media-nodes-v1']||'[]'),versions=JSON.parse(data['canvas-os-deck-snapshots-v1']||'[]');if(![scenes,nodes,versions].every(Array.isArray))throw Error();$('browserSummary').textContent=`已保存 ${scenes.length} 页演示 · ${nodes.length} 个媒体节点 · ${versions.length} 个冻结版本`;}catch{$('browserSummary').textContent='浏览器草稿读取失败，可先下载原始项目数据排查。';}}
  function navigate(asset,target){if(connected&&asset.available)location.href=target==='canvas'?`./?addAsset=${asset.id}`:`./?view=present&adminMedia=${asset.id}`;}
  function preview(asset){if(!connected||!asset.available)return;$('previewName').textContent=asset.name;$('assetPreview').showModal();MediaRuntime.mount($('previewMedia'),asset);}
  $('closePreview').onclick=()=>$('assetPreview').close();$('assetPreview').addEventListener('close',()=>MediaRuntime.dispose($('previewMedia')));
  function renderAssets(){const list=$('assetList');list.replaceChildren();if(!state)return;const q=$('assetSearch').value.trim().toLocaleLowerCase(),filter=$('assetFilter').value,assets=state.assets.filter(a=>(!a.auxiliary||$('showAuxiliary').checked)&&a.name.toLocaleLowerCase().includes(q)&&(filter==='all'||filter===a.kind||(filter==='issues'&&a.issue))),pages=Math.max(1,Math.ceil(assets.length/pageSize));pageIndex=Math.min(pageIndex,pages-1);$('assetCount').textContent=`${assets.length} 个结果 · 第 ${pageIndex+1} / ${pages} 页`;$('prevAssetPage').disabled=pageIndex===0;$('nextAssetPage').disabled=pageIndex>=pages-1;if(!assets.length){list.append(make('div','empty',state.assets.length?'没有符合条件的素材。':'素材库还没有文件。从画布导入图片或视频后，会显示在这里。'));return;}
    for(const asset of assets.slice(pageIndex*pageSize,(pageIndex+1)*pageSize)){const row=make('article',`asset-row ${asset.issue?'has-issue':''}`),icon=make('span',`asset-icon ${asset.kind}`,asset.kind==='video'?'▶':'▧'),body=make('div','asset-main'),actions=make('div','asset-actions');const source=asset.preview||(asset.kind==='image'&&asset.size<2*1024**2?asset.src:null);if(asset.available&&source&&MediaRuntime.safe(source)){const image=make('img');image.src=source;image.alt='';image.loading='lazy';image.onerror=()=>image.remove();icon.append(image);}body.append(make('strong','',asset.name),make('small','',`${asset.auxiliary?'预览文件':asset.kind==='video'?'视频':'图片'} · ${format(asset.size)} · ${asset.available?'文件存在':'文件缺失'}`));if(asset.issue)body.append(make('em','',asset.issue));for(const [label,fn] of [['预览',()=>preview(asset)],['添加到画布',()=>navigate(asset,'canvas')],['加入 PPT',()=>navigate(asset,'ppt')]]){const b=make('button','',label);b.disabled=!connected||!asset.available;b.onclick=fn;actions.append(b);}if(asset.available&&connected){const link=make('a','text-link','下载原文件');link.href=asset.src;link.download=asset.name;actions.append(link);}row.append(icon,body,actions);list.append(row);}}
  function renderIssues(){const box=$('assetIssues'),items=state.issues;box.hidden=!items.length;box.querySelector('summary').textContent=`发现 ${items.length} 项异常 · 展开查看文件`;const body=box.querySelector('div');body.replaceChildren();items.slice(0,20).forEach(i=>body.append(make('p','',`${i.file}：${i.message}`)));if(items.length>20)body.append(make('p','',`另有 ${items.length-20} 项，请先备份后检查素材目录。`));}
  function renderEvents(){const list=$('eventList');list.replaceChildren();if(!state.events.length){list.append(make('div','empty','本次服务启动后还没有操作记录。'));return;}state.events.forEach(e=>{const row=make('div','event-row');row.append(make('span',`event-dot ${e.ok?'ok':'fail'}`),make('strong','',e.action),make('small','',`${date(e.time)} · ${e.ok?'成功':'失败'} · HTTP ${e.status}`));list.append(row);});}
  function render(){document.querySelector('.local-badge').textContent=state.mode==='team'?'● 团队内测':'● 仅本机';document.querySelector('.admin-notice strong').textContent=state.mode==='team'?'受邀团队共享工作区':'本机管理模式';document.querySelector('.admin-notice span').textContent='管理员管理账号与共享素材；每位成员的 PPT 草稿保存在各自浏览器。';const originals=state.assets.filter(a=>!a.auxiliary);$('serviceState').textContent='正常运行';$('serviceDetail').textContent='本机服务已响应 · 手动刷新检查';$('storageValue').textContent=format(state.storage.used);$('storageDetail').textContent=`上限 ${format(state.storage.limit)} · 磁盘可用 ${format(state.storage.freeDisk)}`;$('assetValue').textContent=`${originals.filter(a=>a.available&&!a.issue).length} 个`;$('assetDetail').textContent=`共 ${originals.length} 个原素材 · ${state.issues.length?state.issues.length+' 项异常':'记录完整'}`;$('uptimeValue').textContent=state.uptime<60?`${state.uptime} 秒`:state.uptime<3600?`${Math.floor(state.uptime/60)} 分钟`:`${Math.floor(state.uptime/3600)} 小时`;$('checkedValue').textContent=`检查于 ${date(state.checkedAt)}`;renderIssues();renderAssets();renderEvents();browserSummary();}
  async function request(url,options={},timeout=15000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const response=await fetch(url,{...options,cache:'no-store',signal:controller.signal}),data=await response.json().catch(()=>{throw Error('接口未返回有效数据，请确认已启动最新的 server.py');});if(response.status===401)location.replace('/login.html?next=admin.html');if(response.status===403)location.replace('/?notice=admin-required');if(!response.ok)throw Error(data.error||'本机服务请求失败');return data;}catch(e){throw Error(e.name==='AbortError'?'请求超时，请稍后重试':e.message);}finally{clearTimeout(timer);}}
  async function refresh(){ $('refreshAdmin').disabled=true;$('serviceState').textContent='检查中';try{const result=await Promise.all([request('/api/admin/status'),loadUsers()]);state=result[0];connected=true;render();}catch(e){connected=false;$('serviceState').textContent='连接失败';$('serviceDetail').textContent=e.message;renderAssets();}finally{$('refreshAdmin').disabled=false;}}
  function download(href,name){const a=make('a');a.href=href;a.download=name;document.body.append(a);a.click();a.remove();}
  async function backup(){if($('createBackup').disabled)return;$('createBackup').disabled=true;toast('正在打包，请保持页面打开。');try{const data=await request('/api/admin/backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storage:collectStorage()})},120000);if(!/^\/api\/admin\/backups\/[a-f0-9]{32}$/.test(data.download))throw Error('备份下载地址无效');download(data.download,'canvas-workspace-backup.zip');toast(`备份已生成（${format(data.size)}），请在浏览器下载列表中确认。`);refresh();}catch(e){toast(e.message,true);}finally{$('createBackup').disabled=false;}}
  $('downloadBrowserData').onclick=()=>{try{const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,createdAt:new Date().toISOString(),storage:collectStorage()},null,2)],{type:'application/json'}));download(url,'browser-data.json');setTimeout(()=>URL.revokeObjectURL(url),10000);toast('已请求下载项目数据；此 JSON 不包含素材文件。');}catch{toast('无法读取浏览器项目数据，请检查存储权限。',true);}};
  ['assetSearch','assetFilter','showAuxiliary'].forEach(id=>$(id).addEventListener(id==='assetSearch'?'input':'change',()=>{pageIndex=0;renderAssets();}));$('prevAssetPage').onclick=()=>{pageIndex--;renderAssets();};$('nextAssetPage').onclick=()=>{pageIndex++;renderAssets();};$('refreshAdmin').onclick=refresh;$('createBackup').onclick=backup;$('openLibrary').onclick=()=>location.href='./?open=media-library';window.addEventListener('storage',browserSummary);browserSummary();refresh();
})();
