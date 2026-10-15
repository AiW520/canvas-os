/* Shared point-and-prompt editor. Only validated data changes reach a renderer. */
(() => {
  const clone = value => structuredClone(value);
  const names = {scene:'当前页面',headline:'大标题',copy:'正文',kicker:'主题短句',chart:'图表',metric:'指标'};
  const selectors = {headline:'.slide-title',copy:'.slide-copy',kicker:'.slide-kicker',chart:'.slide-visual,.cover-visual'};
  function label(target) { return target.type === 'metric' ? `指标 ${target.index + 1} · ${target.field ? '标签' : '数值'}` : names[target.type]; }
  function validatePatch(patch, snapshot, target) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('修改结果必须是结构化对象');
    const textFields = {headline:140,copy:400,kicker:80};
    const choices = {theme:['lilac','midnight','sage'],layout:['cover','story','chart','live'],transition:['fade','focus','none'],chartType:['bars','line']};
    const allowed = new Set(target.type === 'scene' ? [...Object.keys(textFields),...Object.keys(choices),'duration','textScale'] : target.type === 'chart' ? ['chartType','layout','growth','base'] : target.type === 'metric' ? ['metricValue'] : [target.type,...(target.type==='headline'?['textScale']:[])]);
    const scene = clone(snapshot.scene), objects = clone(snapshot.objects), changes = [];
    for (const [key,value] of Object.entries(patch)) {
      if (!allowed.has(key)) throw new Error(`该修改超出已选区域：${key}`);
      if (key in textFields || key === 'metricValue') {
        const max = textFields[key] || (target.field ? 40 : 30);
        if (typeof value !== 'string' || !value.trim() || value.length>max) throw new Error(`文本需要为 1–${max} 个字符`);
      } else if (key in choices) {
        if (!choices[key].includes(value)) throw new Error(`不支持的 ${key} 值`);
      } else {
        const bounds = {duration:[5,90],textScale:[.8,1.4],growth:[0,50],base:[1,10000000]}[key];
        if (typeof value !== 'number' || !Number.isFinite(value) || !bounds || value<bounds[0] || value>bounds[1]) throw new Error(`${key} 超出允许范围`);
      }
      let before;
      if (key === 'metricValue') {
        if (!Number.isInteger(target.index) || ![0,1,2].includes(target.index) || ![0,1].includes(target.field)) throw new Error('指标目标已失效');
        before=scene.metrics[target.index][target.field]; scene.metrics[target.index][target.field]=value;
      } else if (key === 'growth' || key === 'base') { before=objects.cohort[key]; objects.cohort[key]=value; }
      else { before=scene[key]; scene[key]=value; }
      if (before !== value) changes.push({key,before,after:value});
    }
    if (target.type === 'chart' && !['chart','live'].includes(scene.layout) && ('chartType' in patch || 'layout' in patch)) throw new Error('选中的图表只能使用数据图表或交互图表版式');
    if ('chartType' in patch && !['chart','live'].includes(scene.layout)) throw new Error('请先将页面切换为图表版式，再更换图表类型');
    if (!changes.length) throw new Error('内容没有变化');
    return {scene,objects,changes};
  }
  // Exact, complete commands only. Ambiguous/compound rewrites are delegated to AI.
  function local(command, target, snapshot) {
    const q=command.trim(); let m;
    const replacements = [
      ['headline',/^(?:把)?(?:大标题|标题)(?:改成|改为|替换为|设置为)\s*[：:]?\s*([\s\S]+)$/],
      ['copy',/^(?:把)?(?:正文|文案)(?:改成|改为|替换为|设置为)\s*[：:]?\s*([\s\S]+)$/],
      ['kicker',/^(?:把)?主题短句(?:改成|改为|替换为|设置为)\s*[：:]?\s*([\s\S]+)$/]
    ];
    const unquote = text => { const s=text.trim(); return (/^“[\s\S]*”$|^"[\s\S]*"$|^「[\s\S]*」$/).test(s) ? s.slice(1,-1) : s; };
    const vague = text => /^(?:更|更加|简洁|精简|简短|口语|有冲击力|高级|专业|一半|短一点|长一点)/.test(text.trim());
    // A literal needs an explicit delimiter if it also looks like another instruction.
    const needsAI = text => vague(text) || /(?:同时|然后|并且|并|再|顺便|以及|还要|而且).*(?:改|换|放大|缩小|调整|精简|加|删|保留)|[，,；;].*(?:把|将|让|换成|改成|放大|缩小)/.test(text);
    const explicit = /(?:改成|改为|替换为|设置为)\s*(?:[：:]|[“"「])/.test(q);
    for (const [key,re] of replacements) if ((m=q.match(re))) {
      if (target.type !== 'scene' && target.type !== key) throw new Error(`先点选${names[key]}，再修改它`);
      if (needsAI(m[1]) && !explicit) return null;
      return {[key]:unquote(m[1])};
    }
    if ((m=q.match(/^(?:改成|改为|替换为|设置为)\s*[：:]?\s*([\s\S]+)$/)) && ['headline','copy','kicker','metric'].includes(target.type)) {
      // A quoted value or colon explicitly requests replacement, never a style change.
      if (/^(?:深色|浅色|绿色|科技|折线|柱状|交互)/.test(m[1]) && !/[：:“"「]/.test(q)) return null;
      if (needsAI(m[1]) && !explicit) return null;
      return {[target.type==='metric'?'metricValue':target.type]:unquote(m[1])};
    }
    if (target.type==='scene') {
      if (/^(?:把(?:页面|主题))?(?:换成|改成|改为|切换为)(?:深色科技风|深色|午夜蓝)[。！]?$/u.test(q)) return {theme:'midnight'};
      if (/^(?:把(?:页面|主题))?(?:换成|改成|改为|切换为)(?:浅色|晨光紫|紫色)[。！]?$/u.test(q)) return {theme:'lilac'};
      if (/^(?:把(?:页面|主题))?(?:换成|改成|改为|切换为)(?:绿色|鼠尾草绿)[。！]?$/u.test(q)) return {theme:'sage'};
      if (/^(?:关闭|取消)(?:所有)?动画[。！]?$/.test(q)) return {transition:'none'};
      if (/^(?:开启|打开)动画[。！]?$/.test(q)) return {transition:'fade'};
      if ((m=q.match(/^(?:把)?(?:时长|播放时长)(?:改成|改为|设为|设置为)\s*(\d+)\s*秒[。！]?$/))) return {duration:Number(m[1])};
    }
    if (target.type==='chart' || target.type==='scene') {
      if (/^(?:把图表)?(?:换成|改成|改为)(?:折线图|柱状图)[。！]?$/.test(q)) {
        if (!['chart','live'].includes(snapshot.scene.layout)) throw new Error('这一页使用封面/流程版式；请先在页面属性切换为图表版式');
        return {chartType:q.includes('折线')?'line':'bars'};
      }
      if (target.type==='chart' && (m=q.match(/^(?:把)?(?:增长率|增长假设|月增长率|月增长假设)(?:改成|改为|设为|设置为)\s*(\d+(?:\.\d+)?)\s*%[。！]?$/))) return {growth:Number(m[1])};
    }
    if (target.type==='headline' && /^(?:把标题)?(?:放大|大一点|缩小|小一点)[。！]?$/.test(q)) return {textScale:Math.round(((snapshot.scene.textScale||1)+( /缩小|小一点/.test(q)?-.1:.1))*10)/10};
    return null;
  }
  function mount(adapter) {
    const host=adapter.host, root=adapter.root, toggle=adapter.toggle;
    const panel=document.createElement('section'); panel.id='promptEditor'; panel.className='prompt-editor'; panel.hidden=true; panel.setAttribute('aria-label','点选与对话编辑');
    panel.innerHTML=`<div class="prompt-editor-head"><div><strong>点选 · 说出修改</strong><small>明确指令即时修改，创意改写由 AI 生成</small></div><button id="closePromptEditor" aria-label="关闭点选修改">×</button></div>
      <div class="prompt-context"><span id="promptTargetLabel"></span><button id="promptWholePage">选择整页</button></div><p id="promptCurrent"></p>
      <details id="promptDirect" hidden><summary>直接编辑选中文字 <span>无需 AI</span></summary><label for="promptDirectInput">替换为</label><textarea id="promptDirectInput" rows="3"></textarea><div class="prompt-actions"><small id="promptDirectCount"></small><button id="applyDirect">保存文字</button></div></details>
      <label for="promptInput">你想怎么改？</label><textarea id="promptInput" rows="3" maxlength="2000" placeholder="改成：今天开始行动\n也可以说：写得更有冲击力"></textarea>
      <div class="prompt-examples"></div><div class="prompt-editor-foot"><span>Ctrl / ⌘ + Enter</span><button id="applyPrompt" class="primary">应用修改</button><button id="cancelPrompt" hidden>取消请求</button></div>
      <p id="promptHint" role="status" aria-live="polite"></p>
      <section id="promptProposal" hidden><strong>AI 修改预览</strong><div class="prompt-compare" role="group" aria-label="预览版本"><button id="previewBefore" aria-pressed="false">原版</button><button id="previewAfter" aria-pressed="true">修改版</button></div><article class="slide" id="promptPreview"></article><p id="promptPreviewLabel">修改版 · 尚未应用</p><div id="promptDiff"></div><div class="prompt-actions"><button id="acceptPrompt" class="primary">应用这个版本</button><button id="discardPrompt">放弃</button></div></section>
      <div class="prompt-history"><button id="promptUndo">撤销</button><button id="promptRedo">重做</button>${adapter.export?'<button id="promptSave">下载修改后 HTML</button>':''}</div>
      <details class="prompt-settings"><summary>AI 连接设置 <span id="aiConnectionState">未配置</span></summary>
      <p>复杂指令会将已选内容发给你配置的服务。讲稿和其他页不会发送。密钥仅保留在当前页面内存。</p>
      <label for="aiEndpoint">完整 Chat Completions 接口地址</label><input id="aiEndpoint" type="url" placeholder="https://你的服务地址/v1/chat/completions" autocomplete="off">
      <label for="aiModel">文本模型名</label><input id="aiModel" placeholder="填写服务提供的模型名" autocomplete="off">
      <label for="aiKey">API Key</label><input id="aiKey" type="password" autocomplete="new-password" placeholder="只在本次页面使用">
      <div class="prompt-actions"><button id="saveAISettings">使用此连接</button><button id="clearAISettings">清除</button></div><p id="aiSettingsStatus" role="status"></p></details>`;
    host.append(panel);
    const $=id=>panel.querySelector('#'+id), hint=$('promptHint'), input=$('promptInput');
    let enabled=false, target={type:'scene'}, selectedId=adapter.read().scene.id, config=null, request=null, proposal=null, serial=0;
    const drafts = new Map();
    let directSource='', directContext='';
    const contextKey=()=>`${selectedId}:${JSON.stringify(target)}`;
    const rememberDraft=()=>{ drafts.set(contextKey(),input.value);if(drafts.size>100)drafts.delete(drafts.keys().next().value); };
    function info(message) { hint.textContent=message; }
    function fingerprint() { const s=adapter.read(); return `${s.scene.id}:${s.token}:${JSON.stringify(s.scene)}:${JSON.stringify(s.objects)}`; }
    function clearProposal() { window.MediaRuntime?.dispose($('promptPreview'));proposal=null; $('promptProposal').hidden=true; $('promptPreview').replaceChildren(); $('promptDiff').replaceChildren(); }
    function showPreview(before=false) {
      if(!proposal)return;
      const data=before?proposal.original:proposal.candidate;
      window.SceneRuntime.render($('promptPreview'),data.scene,clone(data.objects),{index:proposal.index,staticMedia:true});
      // Preview controls must never mutate the pending candidate.
      $('promptPreview').querySelectorAll('input,button').forEach(node=>node.disabled=true);
      $('previewBefore').setAttribute('aria-pressed',String(before));$('previewAfter').setAttribute('aria-pressed',String(!before));
      $('promptPreviewLabel').textContent=before?'原版 · 当前已保存内容':'修改版 · 尚未应用';
    }
    function cancel(message='已取消 AI 请求') { serial++; if(request) {request.abort();request=null;info(message);} $('applyPrompt').disabled=false; $('cancelPrompt').hidden=true; }
    function examples() {
      const group=panel.querySelector('.prompt-examples'); group.replaceChildren();
      const items=target.type==='scene'?['换成深色科技风','关闭动画']:target.type==='chart'?['换成折线图','月增长率改为25%']:target.type==='headline'?['放大','写得更有冲击力']:target.type==='copy'?['缩短一半','改得更口语化']:['改成：新内容'];
      items.forEach(text=>{const button=document.createElement('button');button.textContent=text;button.type='button';button.onclick=()=>{input.value=text;input.focus();};group.append(button);});
    }
    function nodes() {
      const found=[];
      for(const [type,selector] of Object.entries(selectors)) root.querySelectorAll(selector).forEach(node=>{if(node.classList.contains('slide-media'))return;found.push({node,target:{type}});});
      root.querySelectorAll('.slide-metrics > div').forEach((node,index)=>[node.querySelector('strong'),node.querySelector('span')].forEach((part,field)=>{if(part)found.push({node:part,target:{type:'metric',index,field}});}));
      return found;
    }
    function refresh() {
      const state=adapter.read();
      if (selectedId!==state.scene.id) { rememberDraft();cancel('已切换页面，取消上一页请求'); clearProposal(); target={type:'scene'};selectedId=state.scene.id;input.value=drafts.get(contextKey())||'';examples(); }
      if (proposal && proposal.fingerprint!==fingerprint()) {clearProposal();info('内容已变化，请重新生成 AI 预览');}
      if (target.type==='chart' && !root.querySelector(selectors.chart)) target={type:'scene'};
      $('promptTargetLabel').textContent=`第 ${state.index+1} 页 · ${label(target)}`;
      const value=target.type==='metric'?state.scene.metrics[target.index][target.field]:state.scene[target.type];
      const canEdit=['headline','copy','kicker','metric'].includes(target.type);
      $('promptDirect').hidden=!canEdit;
      if(canEdit) {
        if(directContext!==contextKey() || directSource!==value) {
          $('promptDirectInput').value=value;directSource=value;directContext=contextKey();
        }
        $('promptDirectInput').maxLength=({headline:140,copy:400,kicker:80})[target.type] || (target.field?40:30);
        updateDirectCount();
      }
      $('promptCurrent').textContent=typeof value==='string'?value:target.type==='chart'?'图表数据为共享对象；修改增长假设会同步到其他引用页。':'点选标题、正文、指标或图表，限定修改区域。';
      nodes().forEach(({node,target:t})=>{
        if(enabled) { node.dataset.promptTarget=JSON.stringify(t);node.tabIndex=0;node.setAttribute('role','button');node.setAttribute('aria-label',`编辑${label(t)}`); }
        else {delete node.dataset.promptTarget;node.removeAttribute('tabindex');node.removeAttribute('role');node.removeAttribute('aria-label');}
        node.classList.toggle('prompt-selected',enabled && JSON.stringify(t)===JSON.stringify(target));
      });
      const h=adapter.history(); $('promptUndo').disabled=!h.undo; $('promptRedo').disabled=!h.redo;
    }
    function choose(next) { if(!enabled)return;rememberDraft();cancel();clearProposal();target=next;input.value=drafts.get(contextKey())||'';refresh();examples();input.focus({preventScroll:true}); }
    function open() { enabled=true;adapter.pause();host.classList.add('prompt-open');panel.hidden=false;toggle.setAttribute('aria-pressed','true');root.dataset.promptMode='true';refresh();examples(); }
    function close() { rememberDraft();enabled=false;cancel();clearProposal();host.classList.remove('prompt-open');panel.hidden=true;toggle.setAttribute('aria-pressed','false');delete root.dataset.promptMode;refresh();toggle.focus({preventScroll:true}); }
    root.addEventListener('click',e=>{if(!enabled || e.target.closest('input,button,select,a'))return;const node=e.target.closest('[data-prompt-target]');choose(node?JSON.parse(node.dataset.promptTarget):{type:'scene'});});
    root.addEventListener('keydown',e=>{if(!enabled||!['Enter',' '].includes(e.key)||e.target.closest('input'))return;const node=e.target.closest('[data-prompt-target]');if(node){e.preventDefault();e.stopPropagation();choose(JSON.parse(node.dataset.promptTarget));}});
    toggle.onclick=()=>enabled?close():open(); $('closePromptEditor').onclick=close;
    $('promptWholePage').onclick=()=>choose({type:'scene'});
    $('promptUndo').onclick=()=>{cancel();clearProposal();adapter.undo();refresh();info('已撤销');};
    $('promptRedo').onclick=()=>{cancel();clearProposal();adapter.redo();refresh();info('已重做');};
    $('promptSave')?.addEventListener('click',()=>{try{adapter.export();info(adapter.exportHint||'已下载修改后的 HTML');}catch(e){info(e.message);}});
    function commit(candidate) { const saved=adapter.commit(candidate);refresh();info(saved===false?'修改已生效，但本地保存失败；请备份或下载。':'已应用修改，可以撤销。');input.value='';drafts.delete(contextKey()); }
    function updateDirectCount() { const field=$('promptDirectInput');$('promptDirectCount').textContent=`${field.value.length} / ${field.maxLength} 字`; }
    $('promptDirectInput').addEventListener('input',updateDirectCount);
    $('applyDirect').onclick=()=>{
      try {
        adapter.pause();cancel();clearProposal();
        const key=target.type==='metric'?'metricValue':target.type;
        const candidate=validatePatch({[key]:$('promptDirectInput').value},adapter.read(),target);
        commit(candidate);
      } catch(e) {info(e.message);}
    };
    async function apply() {
      const command=input.value.trim(); if(!command||request)return;
      adapter.pause();clearProposal();const s=adapter.read(), selected=clone(target), stamp=fingerprint();
      try {
        const patch=local(command,selected,s);
        if(patch) {commit(validatePatch(patch,s,selected));return;}
        if(!config) { info('这句需要 AI 理解，请先填写下方的 AI 连接设置。');panel.querySelector('.prompt-settings').open=true;return; }
        if(location.protocol==='file:') {info('离线文件支持本地修改；AI 改写请在本机创作页面中使用。');return;}
        const controller=new AbortController();request=controller;const ticket=++serial;
        $('applyPrompt').disabled=true;$('cancelPrompt').hidden=false;info('AI 正在生成修改预览…');
        const timeout=setTimeout(()=>controller.abort(),65000);
        try {
          // Only selected content goes to the model, without speaker notes.
          const content=selected.type==='scene'?Object.fromEntries(Object.entries(s.scene).filter(([key])=>!['notes','id','objectId','media'].includes(key))):selected.type==='chart'?{layout:s.scene.layout,chartType:s.scene.chartType||'bars',...s.objects.cohort}:selected.type==='metric'?{metricValue:s.scene.metrics[selected.index][selected.field]}:{[selected.type]:s.scene[selected.type]};
          const response=await fetch('/api/presentation/rewrite',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connection:config,command,target:selected,content}),signal:controller.signal});
          const data=await response.json().catch(()=>{throw new Error('AI 服务响应无效，请使用 server.py 启动创作页面');});
          if(!response.ok)throw new Error(data.error || 'AI 服务请求失败');
          if(ticket!==serial)return;
          if(stamp!==fingerprint())throw new Error('页面在生成期间已改变，已丢弃旧结果。请重新提交');
          const candidate=validatePatch(data.patch,s,selected);proposal={candidate,original:clone(s),index:s.index,fingerprint:stamp};
          showPreview();
          const labels={headline:'大标题',copy:'正文',kicker:'主题短句',metricValue:'选中指标',chartType:'图表类型',theme:'主题',layout:'版式',textScale:'标题大小',duration:'时长',transition:'过渡',growth:'共享月增长率',base:'共享初始成员'};
          candidate.changes.forEach(change=>{const row=document.createElement('div');const title=document.createElement('strong');title.textContent=labels[change.key];const before=document.createElement('del');before.textContent=String(change.before??'默认');const after=document.createElement('ins');after.textContent=String(change.after);row.append(title,before,after);$('promptDiff').append(row);});
          $('promptProposal').hidden=false;info('预览已生成。确认后才会修改当前页面。');
        } catch(e) {if(ticket===serial)throw e;}
        finally {clearTimeout(timeout);if(ticket===serial){request=null;$('applyPrompt').disabled=false;$('cancelPrompt').hidden=true;}}
      } catch(e) {info(e.name==='AbortError'?'请求已取消或超时，内容未改动。':e.message);}
    }
    $('applyPrompt').onclick=apply; $('cancelPrompt').onclick=()=>cancel();
    $('previewBefore').onclick=()=>showPreview(true);$('previewAfter').onclick=()=>showPreview(false);
    $('acceptPrompt').onclick=()=>{try{if(!proposal||proposal.fingerprint!==fingerprint())throw new Error('页面已变化，请重新生成预览');const candidate=proposal.candidate;clearProposal();commit(candidate);}catch(e){clearProposal();info(e.message);}};
    $('discardPrompt').onclick=()=>{clearProposal();info('已放弃预览，原内容未改动。');};
    panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}else if(e.target===input&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();apply();} });
    $('saveAISettings').onclick=()=>{
      try {
        const endpoint=new URL($('aiEndpoint').value.trim());
        if(endpoint.protocol!=='https:' && !(endpoint.protocol==='http:' && ['127.0.0.1','localhost'].includes(endpoint.hostname)))throw new Error('接口必须使用 HTTPS，或本机 HTTP 测试地址');
        if(endpoint.username||endpoint.password||endpoint.search||endpoint.hash)throw new Error('接口地址不能含凭据、查询参数或片段');
        const model=$('aiModel').value.trim(), key=$('aiKey').value.trim();if(!model)throw new Error('请填写模型名');if(!key)throw new Error('请填写 API Key');
        cancel();clearProposal();config={endpoint:endpoint.href,model,key};$('aiKey').value='';$('aiConnectionState').textContent='已配置';$('aiSettingsStatus').textContent='已配置，尚未验证连接。下一次 AI 修改会使用此服务。';
      }catch(e){$('aiSettingsStatus').textContent=e.message;}
    };
    $('clearAISettings').onclick=()=>{cancel();config=null;['aiEndpoint','aiModel','aiKey'].forEach(id=>$(id).value='');$('aiConnectionState').textContent='未配置';$('aiSettingsStatus').textContent='已清除连接与密钥';};
    refresh(); examples();
    return {open,close,refresh,openSettings(){open();panel.querySelector('.prompt-settings').open=true;$('aiEndpoint').focus();}};
  }
  window.PromptEditor={mount,validatePatch,local};
})();
