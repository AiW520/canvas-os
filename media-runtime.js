/* Native media lifecycle shared by canvas, presentation, and offline exports. */
(() => {
  const instances=new Map();
  const safe=src=>typeof src==='string' && (/^(?:\/assets\/|assets\/)[a-f0-9]{32}\.(png|jpg|webp|gif|mp4|webm)$/.test(src)||/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(src));
  function pauseAll(except) { for(const entry of instances.values())if(entry.video && entry.video!==except)entry.video.pause(); }
  function dispose(root) {
    for(const [host,entry] of instances) if(host===root || root.contains(host)) {
      entry.observer?.disconnect();if(entry.video){entry.video.pause();entry.video.removeAttribute('src');entry.video.load();}instances.delete(host);
    }
  }
  function mount(host,asset,{fit='contain',thumbnail=false,staticOnly=false,onPlay}={}) {
    dispose(host);host.replaceChildren();host.classList.add('media-surface');host.dataset.fit=fit;
    const entry={};instances.set(host,entry);
    const status=document.createElement('span');status.className='media-status';status.textContent='加载中…';host.append(status);
    const fail=()=>{status.hidden=false;status.textContent='无法读取素材，请重试或替换文件';};
    const source=thumbnail&&asset.preview?asset.preview:asset.src;
    const embeddedVideo=asset.kind==='video' && /^data:video\/(mp4|webm);base64,[A-Za-z0-9+/=]+$/.test(asset.src);
    if(!safe(asset.src) && !embeddedVideo){fail();return;}
    if(asset.kind==='video'&&!staticOnly) {
      const video=document.createElement('video');entry.video=video;video.controls=true;video.playsInline=true;video.preload='none';video.src=asset.src;
      if(safe(asset.preview))video.poster=asset.preview;
      video.setAttribute('aria-label',asset.name||'视频');
      status.textContent='点击播放视频';
      video.addEventListener('loadeddata',()=>status.hidden=true);
      video.addEventListener('play',()=>{pauseAll(video);onPlay?.();status.hidden=true;});
      video.addEventListener('error',fail);host.prepend(video);
      entry.observer=new IntersectionObserver(entries=>{if(entries.some(e=>!e.isIntersecting)){
        video.pause();if(video.readyState){entry.time=video.currentTime;video.removeAttribute('src');video.load();}
      }else if(!video.getAttribute('src')){video.src=asset.src;if(entry.time)video.addEventListener('loadedmetadata',()=>{video.currentTime=entry.time;},{once:true});}},{threshold:0});
      entry.observer.observe(host);
    } else {
      const img=document.createElement('img');img.alt=asset.name||'媒体素材';img.decoding='async';img.loading='lazy';img.draggable=false;
      const src=asset.kind==='video'?asset.preview:source;
      if(!safe(src)){status.textContent='视频（打印仅显示封面）';return;}
      img.onload=()=>status.hidden=true;img.onerror=fail;img.src=src;host.prepend(img);
    }
    const retry=document.createElement('button');retry.className='media-retry';retry.textContent='重新加载';retry.onclick=()=>mount(host,asset,{fit,thumbnail,staticOnly,onPlay});host.append(retry);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseAll();});
  window.addEventListener('pagehide',()=>pauseAll());
  window.MediaRuntime={mount,dispose,pauseAll,safe};
})();
