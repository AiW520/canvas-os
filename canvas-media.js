(() => {
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  const stage=document.getElementById('canvasStage'), content=document.getElementById('canvasContent');
  const input=document.createElement('input');input.type='file';input.accept='image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';input.multiple=true;input.hidden=true;input.id='mediaFileInput';document.body.append(input);
  const button=el('button','context-chip','＋ 图片 / 视频');button.id='importMedia';button.onclick=()=>input.click();document.querySelector('.canvas-toolbar').append(button);
  const generateButton=el('button','context-chip','✦ 生成图片');generateButton.id='generateMedia';document.querySelector('.canvas-toolbar').append(generateButton);
  const banner=el('div','media-import-status');banner.id='mediaImportStatus';banner.setAttribute('role','status');stage.append(banner);
  const dialog=document.createElement('dialog');dialog.className='media-viewer';dialog.innerHTML='<div class="media-viewer-head"><strong></strong><button>关闭预览</button></div><div class="media-viewer-body"></div>';document.body.append(dialog);
  const generateDialog=document.createElement('dialog');generateDialog.className='media-generator';generateDialog.innerHTML='<h2>生成图片素材</h2><p>使用 gpt-image-2 按提示词生成图片。生成会消耗服务商额度，结果保存到共享素材库。</p><label>中文提示词<textarea id="generatePrompt" rows="5" maxlength="4000" placeholder="例如：深色紫蓝渐变的健康科技数据流背景，无文字，适合 16:9 HTML PPT"></textarea></label><button type="button" id="checkGeneration" hidden>查看上次生成结果</button><p id="generateState" role="status"></p><div class="media-dialog-actions"><button type="button" id="cancelGenerate">取消</button><button type="button" id="submitGenerate">生成并加入画布</button></div>';document.body.append(generateDialog);
  dialog.querySelector('button').onclick=()=>dialog.close();dialog.addEventListener('close',()=>MediaRuntime.dispose(dialog));
  generateButton.onclick=()=>{generateDialog.showModal();document.getElementById('generatePrompt').focus();};
  document.getElementById('cancelGenerate').onclick=()=>generateDialog.close();
  let generationBusy=false;
  const generationKey='canvas-pending-generation-v1';
  const generationState=document.getElementById('generateState'), generationSubmit=document.getElementById('submitGenerate'), checkGeneration=document.getElementById('checkGeneration');
  let pendingGeneration;
  try{pendingGeneration=JSON.parse(sessionStorage.getItem(generationKey)||'null');}catch{}
  checkGeneration.hidden=!pendingGeneration;
  async function generateImage(recover=false){
    if(generationBusy)return;
    const prompt=document.getElementById('generatePrompt').value.trim();
    if(!recover && prompt.length<3){generationState.textContent='请输入至少 3 个字符的提示词';return;}
    if(!recover && pendingGeneration && !confirm('上次生成尚未确认。新建请求可能再次消耗额度，建议先查看上次结果。仍要新建？'))return;
    const payload=recover?pendingGeneration:{prompt,name:'AI 生成图片',requestId:crypto.randomUUID().replaceAll('-','')};
    if(!payload)return;
    try{sessionStorage.setItem(generationKey,JSON.stringify(payload));}catch{generationState.textContent='无法保存请求标识，请检查浏览器存储后再生成';return;}
    pendingGeneration=payload;generationBusy=true;generationSubmit.disabled=checkGeneration.disabled=true;checkGeneration.hidden=false;
    generationState.textContent=recover?'正在查询上次结果…':'正在生成图片，请稍候。关闭窗口不会取消生成。';
    try{
      const response=await fetch('/api/assets/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(270000)});
      const data=await response.json();
      if(!response.ok){if(!data.uncertain && response.status!==409){pendingGeneration=null;sessionStorage.removeItem(generationKey);checkGeneration.hidden=true;}throw Error(data.error||'生成失败');}
      if(!MediaRuntime.safe(data.src)||data.kind!=='image')throw Error('素材响应无效，请检查素材库');
      const added=addAsset(data);pendingGeneration=null;sessionStorage.removeItem(generationKey);checkGeneration.hidden=true;
      generationState.textContent=added?'图片已保存到素材库并加入画布，可预览或加入 PPT。':'图片已保存到素材库，但画布保存失败；请从素材库重新添加。';
    }catch(error){generationState.textContent=error.name==='TimeoutError'||error.name==='TypeError'?'连接中断或等待超时，结果尚未确认；请查看上次结果，避免重复生成。':error.message;}
    finally{generationBusy=false;generationSubmit.disabled=checkGeneration.disabled=false;}
  }
  generationSubmit.onclick=()=>generateImage();checkGeneration.onclick=()=>generateImage(true);
  let records=[];const key='canvas-media-nodes-v1';
  try{const data=JSON.parse(localStorage.getItem(key)||'[]');if(Array.isArray(data))records=data.filter(r=>r?.asset&&/^[a-f0-9]{32}$/.test(r.asset.id)&&/^media-[a-f0-9-]+$/.test(r.id));}catch{banner.textContent='媒体列表读取失败，请从素材库重新添加';}
  function persist(){try{localStorage.setItem(key,JSON.stringify(records));return true;}catch{banner.textContent='画布保存失败，请备份项目，避免关闭页面';return false;}}
  function preview(asset){MediaRuntime.pauseAll();dialog.querySelector('strong').textContent=asset.name;dialog.showModal();MediaRuntime.mount(dialog.querySelector('.media-viewer-body'),asset);}
  function card(record){
    const asset=record.asset,node=el('article','object-card media-card');node.dataset.id=record.id;node.dataset.title=asset.name;node.dataset.kind=asset.kind==='video'?'视频素材':'图片素材';node.dataset.color='purple';
    node.style.left=`${record.x||0}px`;node.style.top=`${record.y||0}px`;
    const header=el('div','object-head media-drag-handle');header.append(el('span','object-icon',asset.kind==='video'?'▶':'▧'),el('strong','',asset.name));header.title='拖动此处移动素材';
    const surface=el('div','media-card-surface');
    const actions=el('div','media-card-actions');
    const action=(name,fn)=>{const b=el('button','',name);b.onclick=fn;actions.append(b);return b;};
    action('预览',()=>preview(record.asset));action('加入 PPT',()=>window.Presentation.addMedia(record.asset));
    action('替换',()=>{const replacement=document.createElement('input');replacement.type='file';replacement.accept=input.accept;replacement.onchange=async()=>{try{const next=await upload(replacement.files[0]);const previous=record.asset;record.asset=next;if(!persist()){record.asset=previous;return;}MediaRuntime.dispose(node);CanvasBoard.remove(node,{preservePosition:true});card(record);banner.textContent='素材已替换，画布位置已保留';}catch(e){banner.textContent=e.message;}};replacement.click();});
    action('移出画布',()=>{const previous=records;records=records.filter(r=>r!==record);if(!persist()){records=previous;return;}MediaRuntime.dispose(node);CanvasBoard.remove(node);banner.textContent='已移出画布；原文件仍保留在本机素材库，PPT 引用不受影响';});
    node.append(header,surface,el('p','',`${asset.kind==='video'?'视频':'图片'} · ${(asset.size/1024/1024).toFixed(1)} MB · 本机已保存`),actions);content.append(node);CanvasBoard.register(node);MediaRuntime.mount(surface,asset,{thumbnail:true});
  }
  async function probe(file){
    if(!file || !['image/png','image/jpeg','image/webp','image/gif','video/mp4','video/webm'].includes(file.type))throw new Error('请选择 PNG、JPEG、WebP、GIF、MP4 或 WebM');
    if(file.size>100*1024*1024)throw new Error('单个素材不能超过 100 MB');
    const url=URL.createObjectURL(file),media=document.createElement(file.type.startsWith('image/')?'img':'video');
    try {
      await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('素材解码超时，请检查视频编码')),12000);const done=fn=>()=>{clearTimeout(timer);fn();};media.onerror=done(()=>reject(new Error('浏览器无法解码此文件，请转为 PNG、JPEG、H.264 MP4 或 VP8/VP9 WebM')));media[media.tagName==='IMG'?'onload':'onloadeddata']=done(resolve);if(media.tagName==='VIDEO'){media.preload='auto';media.muted=true;media.playsInline=true;}media.src=url;});
      const width=media.naturalWidth||media.videoWidth,height=media.naturalHeight||media.videoHeight;
      if(!width||!height||width*height>80000000)throw new Error('素材尺寸无效或超过 8000 万像素');
      const canvas=document.createElement('canvas'),scale=Math.min(1,720/Math.max(width,height));canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);canvas.getContext('2d').drawImage(media,0,0,canvas.width,canvas.height);
      const thumbnail=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.8));
      return {width,height,thumbnail};
    }finally{if(media.pause)media.pause();media.removeAttribute('src');if(media.load)media.load();URL.revokeObjectURL(url);}
  }
  function send(file,name,previewId){return new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('POST','/api/assets');xhr.setRequestHeader('Content-Type',file.type);xhr.setRequestHeader('X-File-Name',encodeURIComponent(name));if(previewId)xhr.setRequestHeader('X-Preview-Id',previewId);xhr.timeout=120000;xhr.ontimeout=()=>reject(new Error('上传超时，请重试'));xhr.upload.onprogress=e=>{if(e.lengthComputable)banner.textContent=`保存 ${name} · ${Math.round(e.loaded/e.total*100)}%`;};xhr.onerror=()=>reject(new Error('上传失败，请检查本机服务'));xhr.onload=()=>{try{const data=JSON.parse(xhr.responseText);if(xhr.status!==201)throw new Error(data.error||'素材保存失败');resolve(data);}catch(e){reject(e);}};xhr.send(file);});}
  async function upload(file){banner.textContent=`正在检查 ${file?.name||'素材'}…`;const info=await probe(file);const preview=info.thumbnail?await send(info.thumbnail,'preview.jpg'):null;const asset=await send(file,file.name,preview?.id);asset.width=info.width;asset.height=info.height;return asset;}
  async function importFiles(files,point){button.disabled=true;try{let offset=0;for(const file of files){try{const asset=await upload(file);const center=point||CanvasBoard.center();const record={id:'media-'+crypto.randomUUID(),asset,x:center.x-160+offset,y:center.y-130+offset};records.push(record);if(!persist()){records.pop();break;}card(record);offset+=36;banner.textContent=`${asset.name} 已保存，可预览或加入 PPT`;}catch(e){banner.textContent=`${file.name}：${e.message}`;break;}}}finally{button.disabled=false;}}
  input.onchange=()=>{const files=[...input.files];input.value='';importFiles(files);};
  stage.addEventListener('dragover',e=>{if([...e.dataTransfer.types].includes('Files')){e.preventDefault();stage.classList.add('media-drop');}});
  stage.addEventListener('dragleave',e=>{if(!stage.contains(e.relatedTarget))stage.classList.remove('media-drop');});
  stage.addEventListener('drop',e=>{e.preventDefault();stage.classList.remove('media-drop');importFiles([...e.dataTransfer.files],CanvasBoard.point(e.clientX,e.clientY));});
  const library=el('button','context-chip','素材库');library.id='mediaLibrary';document.querySelector('.canvas-toolbar').append(library);
  const listing=document.createElement('dialog');listing.className='media-library';listing.innerHTML='<h2>本机素材库</h2><p>素材文件保存在本机，可重复添加到画布。</p><button class="library-close">关闭</button><div class="library-items"></div>';document.body.append(listing);listing.querySelector('button').onclick=()=>listing.close();
  library.onclick=async()=>{listing.showModal();const items=listing.querySelector('.library-items');items.textContent='加载中…';try{const response=await fetch('/api/assets');if(!response.ok)throw new Error('无法连接素材库');const data=await response.json();items.replaceChildren();for(const asset of data.assets.filter(a=>a.name!=='preview.jpg')){const b=el('button','',`${asset.name} · 添加到画布`);b.onclick=()=>{const center=CanvasBoard.center(),record={id:'media-'+crypto.randomUUID(),asset,x:center.x-160,y:center.y-130};records.push(record);if(!persist()){records.pop();listing.close();return;}card(record);listing.close();};items.append(b);}if(!items.childNodes.length)items.textContent='还没有素材，点击“图片 / 视频”导入。';}catch(e){items.textContent=e.message;}};
  records.forEach(card);
  function addAsset(asset){const center=CanvasBoard.center(),record={id:'media-'+crypto.randomUUID(),asset,x:center.x-160,y:center.y-130};records.push(record);if(!persist()){records.pop();return false;}card(record);banner.textContent=`${asset.name} 已加入画布`;return true;}
  window.CanvasMedia={assets:()=>records.map(r=>r.asset),pause:()=>MediaRuntime.pauseAll(),preview,addAsset};
  const incoming=new URL(location.href), assetId=incoming.searchParams.get('addAsset');
  if(incoming.searchParams.get('open')==='media-library'){incoming.searchParams.delete('open');history.replaceState(null,'',incoming);setTimeout(()=>library.click(),0);}
  if(assetId){
    incoming.searchParams.delete('addAsset');history.replaceState(null,'',incoming);
    if(!/^[a-f0-9]{32}$/.test(assetId))banner.textContent='素材标识无效，请从控制台重新选择';
    else fetch(`/assets/${assetId}/meta`).then(r=>r.ok?r.json():Promise.reject(new Error('素材不存在'))).then(asset=>{if(!MediaRuntime.safe(asset.src))throw new Error('素材地址无效');addAsset(asset);}).catch(e=>banner.textContent=`添加失败：${e.message}`);
  }
})();
