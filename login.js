(() => {
  const $=id=>document.getElementById(id), form=$('authForm');
  let mode='login', busy=false, status;
  const invitation=new URLSearchParams(location.hash.slice(1)).get('invite')||'';
  // Keep bearer invitations out of requests and browser history after reading.
  if(invitation)history.replaceState(null,'',location.pathname+location.search);
  function destination(user){
    const value=new URLSearchParams(location.search).get('next')||'/';
    try{
      const target=new URL(value,location.origin+'/');
      if(target.origin!==location.origin || !['/','/index.html','/admin.html'].includes(target.pathname))return '/';
      if(target.pathname==='/admin.html'&&user.role!=='admin')return '/?notice=admin-required';
      return target.pathname+target.search+target.hash;
    }catch{return '/';}
  }
  function setMode(nextMode){
    if(busy)return;mode=nextMode;
    $('loginTab').classList.toggle('active',mode==='login');$('registerTab').classList.toggle('active',mode==='register');
    $('loginTab').setAttribute('aria-pressed',String(mode==='login'));$('registerTab').setAttribute('aria-pressed',String(mode==='register'));
    $('nameField').hidden=$('confirmField').hidden=mode==='login';$('name').required=$('confirm').required=mode==='register';
    $('password').autocomplete=mode==='login'?'current-password':'new-password';
    $('submitAuth').textContent=mode==='login'?'登录':status?.setupRequired?'创建管理员账号':'创建账号';$('authMessage').textContent='';
  }
  function message(text,error=true){$('authMessage').textContent=text;$('authMessage').style.color=error?'#ffabb5':'#8ce8bd';}
  async function check(){
    $('submitAuth').disabled=true;
    try{
      const r=await fetch('/api/auth/status',{cache:'no-store',signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw Error();status=await r.json();
      document.querySelector('.auth-subtitle').textContent=status.mode==='team'?'受邀成员可登录团队共享工作区。':'本机账号用于保护画布、素材和 HTML PPT。';
      document.querySelector('footer').textContent=status.mode==='team'?'受邀团队内测 · 素材共享，草稿保存在当前浏览器':'本机服务 · 密码只在服务端验证，不保存到浏览器 localStorage';
      if(status.user){location.replace(destination(status.user));return;}
      $('setupHint').hidden=!status.setupRequired;
      $('registerTab').disabled=!status.registrationOpen&&!status.setupRequired&&!invitation;
      if(status.setupRequired||invitation)setMode('register');
      if(invitation)message('受邀加入共享工作区：素材在团队中共享，邀请仅可使用一次。',false);
      if($('registerTab').disabled){$('registerTab').title='管理员已关闭注册';message('当前已关闭新账号注册，已有账号可正常登录。',false);}
    }catch{message('无法连接账号服务，请确认服务正在运行后刷新重试。');}
    finally{$('submitAuth').disabled=false;}
  }
  $('loginTab').onclick=()=>setMode('login');$('registerTab').onclick=()=>setMode('register');
  form.onsubmit=async event=>{
    event.preventDefault();if(busy)return;
    const username=$('username').value.trim(),password=$('password').value,name=$('name').value.trim(),submittedMode=mode;
    if(mode==='register'&&password!==$('confirm').value)return message('两次输入的密码不一致');
    busy=true;$('submitAuth').disabled=$('loginTab').disabled=$('registerTab').disabled=true;message('正在验证…',false);
    try{
      const r=await fetch(`/api/auth/${submittedMode}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password,name,invite:invitation}),signal:AbortSignal.timeout(15000)}),data=await r.json();
      if(!r.ok)throw Error(data.error||'操作失败');
      form.reset();message(submittedMode==='login'?'登录成功，正在打开工作区。':'账号已创建，正在打开工作区。',false);location.replace(destination(data.user));
    }catch(error){message(error.name==='TimeoutError'?'请求超时，请稍后重试':error.message);}
    finally{busy=false;$('submitAuth').disabled=$('loginTab').disabled=false;$('registerTab').disabled=status&&!status.registrationOpen&&!status.setupRequired&&!invitation;}
  };
  setMode('login');check();
})();
