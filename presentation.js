(() => {
  const overlay = document.getElementById('presentationOverlay');
  const root = document.getElementById('slideRoot');
  const saveState = document.getElementById('presentationSaveState');
  const scenesKey = 'canvas-os-scenes-v2';
  const projectKey = 'canvas-os-project-v3';
  const objectsKey = 'canvas-os-objects-v1';
  const deckKey = 'canvas-os-deck-snapshots-v1';
  const defaults = structuredClone(window.defaultScenes || []).map((scene, index) => ({ ...scene, layout: [0,7].includes(index) ? 'cover' : index === 2 ? 'story' : index === 4 ? 'live' : 'chart', theme: index === 1 ? 'midnight' : index === 5 ? 'sage' : 'lilac', transition: index === 2 ? 'focus' : 'fade', objectId: 'cohort' }));
  const defaultObjects = { cohort: { title: '用户群组看板', base: 12400, growth: 18 } };
  let scenes = copy(defaults), objects = copy(defaultObjects), startupError = '';
  try {
    const saved = localStorage.getItem(projectKey);
    if (saved) ({ scenes, objects } = validate(JSON.parse(saved)));
    else {
      const legacy = localStorage.getItem(scenesKey) || localStorage.getItem('canvas-os-scenes-v1');
      if (legacy) {
        const old = JSON.parse(legacy).map((scene, i) => ({ ...defaults[i % defaults.length], ...scene, objectId: 'cohort' }));
        ({ scenes, objects } = validate({ version: 3, scenes: old, objects: load(objectsKey, defaultObjects) }));
      }
    }
  } catch (_) { startupError = '已打开示例；原草稿无法读取，尚未覆盖'; }
  let active = Math.min(3, scenes.length - 1);
  let undoStack = [], redoStack = [], editKey = null;
  let promptEditor;
  let playing = false, timerId, elapsed = 0, lastTick = performance.now();
  const dom = {
    list: document.getElementById('sceneList'), summary: document.getElementById('storySummary'), title: document.getElementById('sceneTitleInput'), kicker: document.getElementById('sceneKickerInput'), headline: document.getElementById('sceneHeadlineInput'), copy: document.getElementById('sceneCopyInput'), layout: document.getElementById('sceneLayoutInput'), theme: document.getElementById('sceneThemeInput'), transition: document.getElementById('sceneTransitionInput'), duration: document.getElementById('sceneDurationInput'), durationValue: document.getElementById('sceneDurationValue'), metrics: document.getElementById('metricFields'), notes: document.getElementById('sceneNotesInput'), base: document.getElementById('objectBaseInput'), growth: document.getElementById('objectGrowthInput'), counter: document.getElementById('sceneCounter'), timer: document.getElementById('sceneTimer'), progress: document.getElementById('sceneProgressBar'), play: document.getElementById('playScene'), notesPanel: document.getElementById('speakerNotes'), notesText: document.getElementById('speakerNotesText'), preflight: document.getElementById('scenePreflight')
  };
  function validateMedia(media) {
    if(!/^[a-f0-9]{32}$/.test(media.id) || !['image','video'].includes(media.kind) || !window.MediaRuntime.safe(media.src) || !media.src.startsWith('/assets/'))throw new Error('媒体引用无效');
    if(!media.src.includes(media.id))throw new Error('素材 ID 与文件不一致');
    return {id:media.id,kind:media.kind,name:String(media.name||'素材').slice(0,180),src:media.src,preview:window.MediaRuntime.safe(media.preview)&&media.preview.startsWith('/assets/')?media.preview:undefined,previewId:/^[a-f0-9]{32}$/.test(media.previewId)?media.previewId:undefined,size:Number.isFinite(media.size)?media.size:0};
  }
  function validate(data) {
    if (![2,3].includes(data?.version) || !Array.isArray(data.scenes) || !data.scenes.length || data.scenes.length > 100) throw new Error('项目版本或场景数量无效');
    const text = (value, max) => { if (typeof value !== 'string' || value.length > max) throw new Error('文本内容格式无效或过长'); return value; };
    const number = (value, min, max) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('数据超出有效范围'); return value; };
    const choice = (value, choices) => { if (!choices.includes(value)) throw new Error('不支持的场景属性'); return value; };
    const ids = new Set();
    const checked = data.scenes.map(item => {
      const id = text(item.id, 100); if (!id || ids.has(id)) throw new Error('场景标识重复'); ids.add(id);
      if (!Array.isArray(item.metrics) || item.metrics.length !== 3) throw new Error('指标数量无效');
      return { id, title: text(item.title,60), kicker:text(item.kicker,80), headline:text(item.headline,140), copy:text(item.copy,400), notes:text(item.notes || '',4000),
        duration:number(item.duration,5,90), layout:choice(item.layout,['cover','story','chart','live','media']), theme:choice(item.theme,['lilac','midnight','sage']), transition:choice(item.transition,['fade','focus','none']),
        media:item.media ? validateMedia(item.media) : null, mediaFit:choice(item.mediaFit || 'contain',['contain','cover']),
        chartType:choice(item.chartType ?? 'bars',['bars','line']), textScale:number(item.textScale ?? 1,.8,1.4),
        objectId:choice(item.objectId,['cohort']), metrics:item.metrics.map(m => { if (!Array.isArray(m) || m.length !== 2) throw new Error('指标格式无效'); return [text(m[0],30), text(m[1],40)]; }) };
    });
    const o = data.objects?.cohort; if (!o) throw new Error('关联对象缺失');
    return { version:3, scenes:checked, objects:{cohort:{title:text(o.title,60),base:number(o.base,1,10000000),growth:number(o.growth,0,50)}} };
  }
  function load(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return value || fallback; } catch (_) { return fallback; } }
  function copy(v) { return structuredClone(v); }
  function project() { return { version:3, scenes:copy(scenes), objects:copy(objects) }; }
  function state() { return { scenes:copy(scenes), objects:copy(objects), active }; }
  function pushUndo(previous) { undoStack.push(previous); redoStack=[]; if (undoStack.length > 40) undoStack.shift(); }
  function snapshot() { editKey = null; pushUndo(state()); }
  // One history entry per continuous edit; focus alone never changes history.
  function recordEdit(key) { if (editKey !== key) { pushUndo(state()); editKey = key; } else redoStack = []; }
  function commitEdit() { editKey = null; }
  function save(message = '本地已保存') {
    try { localStorage.setItem(projectKey,JSON.stringify(validate(project()))); flash(message); return true; }
    catch (_) { flash('保存失败：请备份项目后检查浏览器存储',true); return false; }
  }
  function flash(message, error = false) { saveState.textContent = message; saveState.classList.toggle('error', error); }
  function current() { return scenes[active]; }
  function metricFields() {
    dom.metrics.replaceChildren();
    current().metrics.forEach((metric, index) => {
      const value = document.createElement('input'); value.value = metric[0]; value.dataset.metric = `${index}:0`; value.maxLength = 15; value.placeholder = '数值';
      const label = document.createElement('input'); label.value = metric[1]; label.dataset.metric = `${index}:1`; label.maxLength = 20; label.placeholder = '标签';
      [value, label].forEach(input => input.addEventListener('input', event => { const [i, field] = event.target.dataset.metric.split(':').map(Number); if (current().metrics[i][field] === event.target.value) return; recordEdit(`${current().id}:metric:${i}:${field}`); current().metrics[i][field] = event.target.value; render(false, false); save(); }));
      value.setAttribute('aria-label', `指标 ${index + 1} 数值`); label.setAttribute('aria-label', `指标 ${index + 1} 标签`);
      dom.metrics.append(value, label);
    });
  }
  function render(animated = true, syncFields = true) {
    const scene = current(); const object = objects[scene.objectId] || objects.cohort;
    window.SceneRuntime.render(root, scene, objects, { index: active, animate: animated, onMediaPlay:stop, onBeforeObjectChange: () => recordEdit('object:cohort:live'), onObjectChange: (_, value) => { objects.cohort = value; dom.growth.value = value.growth; updateSource(); updateStatus(); save(); } });
    dom.list.replaceChildren();
    scenes.forEach((item, index) => {
      const button = document.createElement('button'); button.className = `scene-item${index === active ? ' active' : ''}`;
      const number = document.createElement('span'); number.className = 'scene-index'; number.textContent = String(index + 1).padStart(2, '0');
      const title = document.createElement('span'); title.textContent = item.title; const duration = document.createElement('small'); duration.textContent = `${item.duration}s`;
      button.append(number, title, duration); button.addEventListener('click', () => select(index)); dom.list.append(button);
    });
    dom.summary.textContent = `${scenes.length} 个场景 · ${scenes.reduce((sum, item) => sum + item.duration, 0)} 秒 · 已绑定 1 个实时对象`;
    if (syncFields) {
    dom.title.value = scene.title; dom.kicker.value = scene.kicker; dom.headline.value = scene.headline; dom.copy.value = scene.copy; dom.layout.value = scene.layout; dom.theme.value = scene.theme; dom.transition.value = scene.transition || 'fade'; dom.duration.value = scene.duration; dom.durationValue.textContent = `${scene.duration} 秒`; dom.notes.value = scene.notes;
    dom.base.value = object.base; dom.growth.value = object.growth; metricFields();
    }
    document.getElementById('sceneMediaFit').value=scene.mediaFit||'contain';
    dom.notesText.textContent = scene.notes; dom.durationValue.textContent = `${scene.duration} 秒`; updateSource(); updateStatus(); updatePreflight(); promptEditor?.refresh();
  }
  function formatTime(seconds) { seconds = Math.max(0,Math.ceil(seconds)); return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
  function updateSource() {
    const p = document.querySelector('[data-id="app"] > p'); if (p) p.textContent = `${objects.cohort.base.toLocaleString('zh-CN')} 位成员 · 月增长 ${objects.cohort.growth}%`;
    const pitch = document.querySelector('[data-id="pitch"] > p'); if (pitch) pitch.textContent = `${scenes.length} 个场景 · ${formatTime(scenes.reduce((n,s)=>n+s.duration,0))}`;
  }
  function updateStatus() {
    const scene=current(); dom.counter.textContent=`${String(active+1).padStart(2,'0')} / ${String(scenes.length).padStart(2,'0')}`;
    dom.timer.textContent=formatTime(scene.duration-elapsed); dom.progress.style.width=`${Math.min(100,elapsed/scene.duration*100)}%`; dom.play.textContent=playing?'暂停':'自动播放';
    document.getElementById('prevScene').disabled=active===0; document.getElementById('nextScene').disabled=active===scenes.length-1;
    document.getElementById('sceneUp').disabled=active===0; document.getElementById('sceneDown').disabled=active===scenes.length-1;
    document.getElementById('deleteScene').disabled=scenes.length===1; document.getElementById('undoScene').disabled=!undoStack.length; document.getElementById('redoScene').disabled=!redoStack.length;
  }
  function updatePreflight() {
    if (!dom.preflight) return;
    const scene = current();
    const { errors, warnings } = inspectScene(scene);
    dom.preflight.replaceChildren();
    const badge = document.createElement('strong');
    badge.className = errors.length ? 'preflight-error' : warnings.length ? 'preflight-warning' : 'preflight-ok';
    badge.textContent = errors.length ? `当前场景有 ${errors.length} 项必须修复` : warnings.length ? `当前场景有 ${warnings.length} 项建议` : '当前场景可以发布';
    dom.preflight.append(badge);
    [...errors.map(item => `必须：${item}`), ...warnings.map(item => `建议：${item}`)].forEach(item => {
      const line = document.createElement('span'); line.textContent = item; dom.preflight.append(line);
    });
  }
  function inspectScene(scene, boundObjects = objects) {
    const errors = [], warnings = [];
    if (scene.layout==='media' && !scene.media)errors.push('媒体页未绑定素材，请从画布加入');
    if (!scene.title.trim()) errors.push('场景名称为空');
    if (!scene.headline.trim()) errors.push('大标题为空');
    if (!scene.copy.trim()) errors.push('正文为空');
    if (scene.title.trim().length > 30) warnings.push('场景名称超过 30 个字');
    if (scene.headline.trim().length > 48 || scene.headline.split('\n').length > 3) warnings.push('大标题较长，请检查排版');
    scene.metrics.forEach((metric, index) => {
      if (!String(metric[0]).trim() || !String(metric[1]).trim()) errors.push(`指标 ${index + 1} 缺少数值或标签`);
    });
    if (!scene.notes.trim()) warnings.push('还没有讲稿备注');
    if (scene.duration < 8) warnings.push('时长偏短，建议至少 8 秒');
    if (scene.duration > 60) warnings.push('时长较长，建议拆分场景');
    if (['chart','live'].includes(scene.layout) && !boundObjects[scene.objectId]) errors.push('图表未绑定对象');
    return { errors, warnings };
  }
  function deckPreflight(input = { scenes, objects }) {
    const errors = [], warnings = [];
    input.scenes.forEach((scene, index) => {
      const result = inspectScene(scene, input.objects);
      result.errors.forEach(message => errors.push({ index, message: `第 ${index + 1} 页：${message}` }));
      result.warnings.forEach(message => warnings.push({ index, message: `第 ${index + 1} 页：${message}` }));
    });
    const duration = input.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    if (duration < 30) warnings.push({ index: null, message: '整份演示不足 30 秒，请确认自动播放节奏。' });
    if (duration > 1200) warnings.push({ index: null, message: '整份演示超过 20 分钟，建议按章节拆分。' });
    return { errors, warnings };
  }
  function renderDeckPreflight(report) {
    const target = document.getElementById('releaseIssues');
    target.replaceChildren();
    [...report.errors.map(issue => ({...issue, level: 'error'})), ...report.warnings.map(issue => ({...issue, level: 'warning'}))].forEach(issue => {
      const line = document.createElement(issue.index === null ? 'span' : 'button');
      line.className = `release-issue ${issue.level}`;
      line.textContent = `${issue.level === 'error' ? '必须' : '建议'}：${issue.message}${issue.index === null ? '' : ' → 定位'}`;
      if (issue.index !== null) line.onclick = () => {
        releaseDialog.close(); stop(); overlay.classList.add('composer-open');
        document.getElementById('toggleComposer').classList.add('active');
        select(issue.index); dom.preflight.scrollIntoView({block: 'nearest'}); dom.title.focus({preventScroll: true});
      };
      target.append(line);
    });
  }
  function select(index) { commitEdit(); active=Math.max(0,Math.min(scenes.length-1,index)); elapsed=0;lastTick=performance.now();render(true); }
  function move(delta) { const target = active + delta; if (target < 0 || target >= scenes.length) return; commitEdit(); snapshot(); [scenes[active], scenes[target]] = [scenes[target], scenes[active]]; active = target; save(); render(false); }
  function duplicate() { if(scenes.length>=100)return flash('最多支持 100 个场景',true); commitEdit(); snapshot(); const item = copy(current()); item.id = `scene-${Date.now()}`; item.title = `${item.title.slice(0,25)} 副本`; scenes.splice(active + 1, 0, item); active += 1; save(); render(false); }
  function remove() { if (scenes.length <= 1) return flash('至少保留一个场景', true); commitEdit(); snapshot(); scenes.splice(active, 1); active = Math.min(active, scenes.length - 1); save(); render(false); }
  function add() { if(scenes.length>=100)return flash('最多支持 100 个场景',true); commitEdit(); snapshot(); scenes.splice(active + 1, 0, { ...copy(defaults[3] || defaults[0]), id: `scene-${Date.now()}`, title: '新场景', headline: '写下你的下一页\n故事。', copy: '继续编辑这一页的内容，并绑定一个实时对象。', notes: '补充这一页要让观众记住的内容。', duration: 15 }); active += 1; save(); render(false); }
  function restore() { commitEdit(); const last = undoStack.pop(); if (!last) return flash('没有可撤销的操作'); redoStack.push(state()); scenes = last.scenes; objects = last.objects; active = Math.min(last.active, scenes.length - 1); elapsed=0; save(); render(false); }
  function redo() { commitEdit(); const next = redoStack.pop(); if (!next) return flash('没有可重做的操作'); undoStack.push(state()); scenes = next.scenes; objects = next.objects; active = Math.min(next.active, scenes.length - 1); elapsed=0; save(); render(false); }
  function stop() { playing=false;clearInterval(timerId);updateStatus(); }
  function togglePlay() {
    if(playing){stop();return;}
    if(active===scenes.length-1 && elapsed>=current().duration)select(0);
    playing=true;lastTick=performance.now();clearInterval(timerId);
    timerId=setInterval(()=>{
      const now=performance.now();
      if(!document.hidden)elapsed=Math.min(current().duration,elapsed+(now-lastTick)/1000);
      lastTick=now;
      if(elapsed>=current().duration){if(active<scenes.length-1)select(active+1);else stop();}
      updateStatus();
    },100); updateStatus();
  }
  document.addEventListener('visibilitychange',()=>{lastTick=performance.now();});
  function clearPreviews() {
    document.querySelectorAll('#releaseList iframe').forEach(frame=>frame.remove());
  }
  async function buildHtml(input = project(), mode='inline') {
    const deck = validate(copy(input));
    let previewBytes=0;
    for(const scene of deck.scenes) if(scene.media) {
      for(const key of ['src','preview']) if(scene.media[key]) {
        if(mode==='bundle')scene.media[key]=scene.media[key].slice(1);
        else if(mode==='inline' || mode==='preview') {
          const response=await fetch(scene.media[key]);if(!response.ok)throw new Error('媒体素材缺失，请重新导入');
          const blob=await response.blob();
          if(mode==='preview') {previewBytes+=blob.size;if(previewBytes>128*1024*1024)throw Error('预览素材超过 128 MB，请导出素材包后预览');}
          scene.media[key]=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
        }
      }
    }
    // Speaker notes are private and are excluded from the audience copy.
    deck.scenes.forEach(scene=>{delete scene.notes;});
    const sceneJson=JSON.stringify(deck).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
    const responses=await Promise.all([fetch('./presentation.css'),fetch('./scene-runtime.js'),fetch('./prompt-editor.js'),fetch('./media-runtime.js')]);
    if(responses.some(r=>!r.ok))throw new Error('无法加载导出资源');
    const [css,runtime,promptRuntime,mediaRuntime]=await Promise.all(responses.map(r=>r.text()));
    return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Atlas 产品故事</title><meta name="description" content="Atlas 产品故事 HTML 演示"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: 'self' file:; media-src 'self' file: data:; connect-src 'self'; base-uri 'none'; form-action 'none'"><style>${css}</style></head><body class="standalone"><header class="player-header"><label for="playerSceneSelect">演示目录</label><select id="playerSceneSelect" aria-label="跳转到场景"></select><small>← → 翻页 · 空格播放 · F 全屏</small><button id="togglePromptEdit" aria-pressed="false">点选修改</button><button id="playerMotion" aria-pressed="true">动态效果：开</button></header><main class="standalone-stage"><article id="standaloneSlide" class="slide"></article></main><nav class="player-controls" aria-label="演示控制"><button id="playerPrev" aria-label="上一页">上一页</button><button id="playerPlay" aria-label="自动播放">自动播放</button><button id="playerNext" aria-label="下一页">下一页</button><input id="playerProgress" type="range" min="0" max="1" step="0.1" value="0" aria-label="当前页进度" title="调整当前页播放进度" /><span id="playerCounter" aria-live="polite" aria-atomic="true"></span><button id="playerFullscreen" aria-label="全屏播放">全屏</button></nav><div class="print-slides" id="printSlides"></div><script>${mediaRuntime}</script><script>${runtime}</script><script>${promptRuntime}</script><script id="deckData" type="application/json">${sceneJson}</script><script>window.SceneRuntime.mountPlayer(JSON.parse(document.getElementById('deckData').textContent));</script></body></html>`;
  }
  function download(content,name,type) { const url=URL.createObjectURL(new Blob([content],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),60000); }
  async function exportHtml(input) {
    try {
      const deck = input || project(), report = deckPreflight(deck);
      if (report.errors.length) {
        if (!input) openReleases();
        throw new Error(`请先修复 ${report.errors.length} 项内容问题。${report.errors[0].message}`);
      }
      const assetIds=[...new Set(deck.scenes.flatMap(s=>s.media?[s.media.id,s.media.previewId].filter(Boolean):[]))];
      let total=0;
      for(const id of assetIds){const response=await fetch(`/assets/${id}/meta`);if(!response.ok)throw new Error('媒体文件缺失，请从画布替换');total+=(await response.json()).size;}
      const bundled=deck.scenes.some(s=>s.media?.kind==='video') || total>20*1024*1024;
      const html=await buildHtml(deck,bundled?'bundle':'inline');
      if(bundled){
        flash('正在打包 HTML 和素材…');
        const response=await fetch('/api/media/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html,assets:assetIds})});
        if(!response.ok)throw new Error((await response.json()).error);
        download(await response.blob(),'canvas-presentation.zip','application/zip');flash('已导出素材包，解压后打开 index.html');
      }else{download(html,'atlas-fitness-presentation.html','text/html;charset=utf-8');flash('已导出离线 HTML（不含讲稿）');}
    }
    catch(error){flash(`导出失败：${error.message}`,true);}
  }
  function backup() { download(JSON.stringify(project(),null,2),'atlas-fitness-deck.json','application/json');flash(scenes.some(s=>s.media)?'项目描述已下载（含讲稿）；素材请使用导出功能打包备份':'项目备份已下载（含讲稿）'); }
  async function importFile(event) {
    const file=event.target.files?.[0]; if(!file)return;event.target.value='';
    try { if(file.size>2000000)throw new Error('文件超过 2 MB');const data=validate(JSON.parse(await file.text()));snapshot();stop();scenes=data.scenes;objects=data.objects;active=0;elapsed=0;render(false);save('已导入并保存'); }
    catch(error){flash(`导入失败：${error.message}`,true);}
  }
  const releaseDialog = document.getElementById('releaseDialog');
  releaseDialog.addEventListener('close',clearPreviews);
  function openReleases() {
    stop(); commitEdit();
    const report = deckPreflight(), status = document.getElementById('releaseStatus');
    status.textContent = report.errors.length ? `发布检查：${report.errors.length} 项必须修复。点击问题定位；草稿仍可冻结备份。` : report.warnings.length ? `发布检查：通过，有 ${report.warnings.length} 项建议，可继续导出。` : '发布检查：全部场景可以导出。';
    status.className = report.errors.length ? 'release-status error' : report.warnings.length ? 'release-status warning' : 'release-status ok';
    document.getElementById('exportCheckedDeck').disabled = report.errors.length > 0;
    renderDeckPreflight(report); if (!releaseDialog.open) releaseDialog.showModal(); renderReleases();
  }
  document.getElementById('publishPresentation').onclick = openReleases;
  document.getElementById('closeReleaseDialog').onclick = () => releaseDialog.close();
  function releases() { const value=load(deckKey,[]);return Array.isArray(value)?value:[]; }
  function renderReleases() {
    clearPreviews();
    const list=document.getElementById('releaseList');list.replaceChildren();
    for(const item of releases()){
      const row=document.createElement('div');row.className='release-entry';const name=document.createElement('strong');name.textContent=item.name;
      const date=document.createElement('small');date.textContent=`${new Date(item.date).toLocaleString('zh-CN')} · ${item.scenes.length} 个场景`;
      const data={version:3,scenes:item.scenes,objects:item.objects};
      const preview=document.createElement('button');preview.textContent='本地预览';preview.onclick=async()=>{
        try { const html=await buildHtml(data,'preview');const frame=document.createElement('iframe');frame.title='冻结版本预览';frame.setAttribute('sandbox','allow-scripts');frame.style.cssText='width:100%;height:330px;border:0;margin-top:12px';frame.srcdoc=html;row.querySelector('iframe')?.remove();row.append(frame); }
        catch(error){flash(`预览失败：${error.message}`,true);}
      };
      const file=document.createElement('button');file.textContent='导出此版本';file.onclick=()=>exportHtml(data);
      const restoreButton=document.createElement('button');restoreButton.textContent='恢复到草稿';restoreButton.onclick=()=>{
        try { const checked=validate(data);snapshot();stop();scenes=checked.scenes;objects=checked.objects;active=0;elapsed=0;render(false);save('已恢复版本，可撤销');releaseDialog.close(); }catch(error){flash(error.message,true);}
      };
      row.append(name,date,preview,file,restoreButton);list.append(row);
    }
    if(!list.childNodes.length){const p=document.createElement('p');p.textContent='尚未创建本地版本。';list.append(p);}
  }
  document.getElementById('freezeDeck').onclick=()=>{
    try{const history=releases();history.unshift({name:`版本 ${new Date().toLocaleTimeString('zh-CN')}`,date:new Date().toISOString(),...validate(project())});localStorage.setItem(deckKey,JSON.stringify(history.slice(0,10)));renderReleases();flash('冻结版本已保存到本机');}
    catch(_){flash('版本保存失败：请导出 HTML 或备份项目',true);}
  };
  document.getElementById('exportCheckedDeck').onclick = () => exportHtml();
  document.getElementById('toggleComposer').onclick = event => { stop(); overlay.classList.toggle('composer-open'); event.currentTarget.classList.toggle('active', overlay.classList.contains('composer-open')); };
  document.getElementById('sceneMediaFit').onchange=e=>{snapshot();current().mediaFit=e.target.value;render(false);save();};
  document.getElementById('fullscreenScene').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await overlay.requestFullscreen(); } catch (_) {} };
  function close() {
    window.MediaRuntime?.pauseAll();promptEditor?.close();stop();commitEdit();overlay.classList.remove('open','composer-open');overlay.setAttribute('aria-hidden','true');document.body.classList.remove('presenting');document.querySelector('.app-shell').inert=false;
    document.getElementById('toggleComposer').classList.remove('active');
    if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});
    document.querySelectorAll('.mode-btn').forEach(b=>b.classList.toggle('active',b.dataset.mode==='think'));
    document.getElementById('presentBtn').focus();
  }
  document.getElementById('exitPresentation').onclick=close;
  document.getElementById('prevScene').onclick = () => select(active - 1); document.getElementById('nextScene').onclick = () => select(active + 1); document.getElementById('playScene').onclick = togglePlay;
  document.getElementById('speakerNotesBtn').onclick = () => dom.notesPanel.classList.toggle('open'); document.getElementById('addScene').onclick = add; document.getElementById('sceneUp').onclick = () => move(-1); document.getElementById('sceneDown').onclick = () => move(1); document.getElementById('duplicateScene').onclick = duplicate; document.getElementById('deleteScene').onclick = remove; document.getElementById('undoScene').onclick = restore; document.getElementById('redoScene').onclick = redo; document.getElementById('exportPresentation').onclick = () => exportHtml(); document.getElementById('backupDeck').onclick = backup; document.getElementById('importDeck').onclick = () => document.getElementById('deckFileInput').click(); document.getElementById('deckFileInput').onchange = importFile;
  const fields = [['title','title'],['kicker','kicker'],['headline','headline'],['copy','copy'],['layout','layout'],['theme','theme'],['transition','transition'],['duration','duration'],['notes','notes']];
  fields.forEach(([key, prop]) => dom[key].addEventListener('input', event => { const value = prop === 'duration' ? Number(event.target.value) : event.target.value; if (current()[prop] === value) return; if (event.target.matches('select')) commitEdit(); recordEdit(`${current().id}:${prop}`); current()[prop] = value; if (prop === 'duration') elapsed = Math.min(elapsed, value); save(); render(false, false); }));
  for(const [input,key,min,max] of [[dom.base,'base',1,10000000],[dom.growth,'growth',0,50]]){
    input.addEventListener('input',e=>{const value=Number(e.target.value);if(!e.target.value||!Number.isFinite(value)||value<min||value>max){flash(`请输入 ${min} 到 ${max} 的数值`,true);return;}if(objects.cohort[key]===value)return;recordEdit(`object:cohort:${key}`);objects.cohort[key]=value;save();render(false,false);});
    input.addEventListener('blur',()=>{input.value=objects.cohort[key];});
  }
  document.querySelector('.scene-inspector').addEventListener('focusin',e=>{if(e.target.matches('input,textarea,select'))stop();});
  document.querySelector('.scene-inspector').addEventListener('focusout',e=>{if(e.target.matches('input,textarea,select'))commitEdit();});
  root.addEventListener('focusin',e=>{if(e.target.matches('input'))stop();});
  root.addEventListener('focusout',e=>{if(e.target.matches('input'))commitEdit();});
  document.getElementById('saveSceneBtn').onclick=()=>save();
  document.addEventListener('keydown',e=>{
    if(!overlay.classList.contains('open')||releaseDialog.open)return;
    if(e.defaultPrevented || e.target.closest('.prompt-editor,video,.media-surface'))return;
    if(e.key==='Escape'){close();return;}
    if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key.toLowerCase()==='z'){e.preventDefault();redo();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();redo();return;}
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();restore();return;}
    if(e.target.closest('input,textarea,select,[contenteditable=true]'))return;
    if(e.key==='ArrowRight'){e.preventDefault();select(active+1);}
    if(e.key==='ArrowLeft'){e.preventDefault();select(active-1);}
    if(e.code==='Space'&&!e.target.closest('button')){e.preventDefault();togglePlay();}
  });
  window.Presentation = { run() { select(0); window.Presentation.open(); if(!playing)togglePlay(); }, openReleases, open(edit=false) { window.MediaRuntime?.pauseAll();document.body.classList.add('presenting');document.querySelector('.app-shell').inert=true;overlay.classList.add('open');overlay.setAttribute('aria-hidden','false');overlay.classList.toggle('composer-open',edit);document.getElementById('toggleComposer').classList.toggle('active',edit);render(false);document.getElementById('toggleComposer').focus(); }, exportHtml, addMedia(asset) {
    if(scenes.length>=100)return flash('最多支持 100 个场景',true);
    const media=validateMedia(asset);snapshot();stop();
    scenes.splice(active+1,0,{...copy(defaults[3]),id:'scene-'+crypto.randomUUID(),title:media.name.slice(0,30),kicker:'媒体展示',headline:media.name.replace(/\.[^.]+$/,'').slice(0,70),copy:media.kind==='video'?'点击画面中的播放按钮，观看视频。':'在演示中查看这份素材。',metrics:[[media.kind==='video'?'视频':'图片','媒体类型'],[(media.size/1024/1024).toFixed(1)+' MB','文件大小'],['原始比例','完整显示']],notes:'',layout:'media',media,mediaFit:'contain',duration:30});
    active++;save();window.Presentation.open(true);
  } };
  promptEditor = window.PromptEditor.mount({
    root, host:overlay, toggle:document.getElementById('togglePromptEdit'),
    read:() => ({scene:copy(current()),objects:copy(objects),index:active,token:JSON.stringify(project())}),
    pause:stop,
    commit(candidate) {
      const next=project(); next.scenes[active]=candidate.scene; next.objects=candidate.objects;
      const checked=validate(next);
      snapshot(); stop(); scenes=checked.scenes; objects=checked.objects; render(false);
      return save('点选修改已保存，可撤销');
    },
    undo:restore, redo, history:()=>({undo:undoStack.length>0,redo:redoStack.length>0})
  });
  render(false);
  if(startupError)flash(startupError,true);
  document.querySelector('[data-id="pitch"]').addEventListener('dblclick',()=>window.Presentation.open(true));
  document.querySelector('[data-id="app"]').addEventListener('dblclick',()=>{active=Math.max(0,scenes.findIndex(s=>s.layout==='live'));window.Presentation.open(true);});
  if(new URLSearchParams(location.search).get('view')==='present')window.Presentation.open(true);
  const adminMediaId=new URLSearchParams(location.search).get('adminMedia');
  if(adminMediaId) {
    const nextUrl=new URL(location.href);nextUrl.searchParams.delete('adminMedia');history.replaceState(null,'',nextUrl);
    if(!/^[a-f0-9]{32}$/.test(adminMediaId))flash('素材标识无效，请从控制台重新选择',true);
    else fetch(`/assets/${adminMediaId}/meta`).then(response=>response.ok?response.json():Promise.reject(new Error('素材不存在'))).then(asset=>window.Presentation.addMedia(asset)).catch(error=>flash(`无法加入 PPT：${error.message}`,true));
  }
  const adminOpen=new URLSearchParams(location.search).get('open');
  if(['ai-settings','versions'].includes(adminOpen)){
    const nextUrl=new URL(location.href);nextUrl.searchParams.delete('open');history.replaceState(null,'',nextUrl);
    window.Presentation.open(true);
    if(adminOpen==='ai-settings')promptEditor.openSettings();else openReleases();
  }
})();


