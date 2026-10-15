/* Shared renderer used by the editor, release preview and standalone HTML. */
function createSceneRuntime() {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function forecast(object) {
    return Array.from({ length: 6 }, (_, index) => Math.round(object.base * (1 + object.growth / 100) ** index));
  }
  const svgEl = (tag, attributes) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
    return node;
  };
  function trajectory(object) {
    const values = forecast(object), max = Math.max(...values, 1);
    const svg = svgEl('svg', { viewBox:'0 0 480 240', class:'trajectory', role:'img', 'aria-label':`六个月活跃成员预测：${values.join('、')}` });
    const points = values.map((value, i) => [20 + i * 88, 214 - value / max * 184]);
    [60, 120, 180, 214].forEach(y => svg.append(svgEl('path', {d:`M20 ${y} H460`,class:'trajectory-grid'})));
    const d = points.map(([x,y],i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ');
    svg.append(svgEl('path', { d:`${d} L460 214 L20 214 Z`,class:'trajectory-area' }));
    svg.append(svgEl('path', { d, class:'trajectory-line',pathLength:1 }));
    points.forEach(([cx,cy]) => svg.append(svgEl('circle', {cx,cy,r:4,class:'trajectory-dot'})));
    return svg;
  }
  function render(root, scene, objects, options = {}) {
    window.MediaRuntime?.dispose(root);
    root.getAnimations({subtree:true}).forEach(animation => animation.cancel());
    root.replaceChildren();
    root.className = `slide theme-${scene.theme} layout-${scene.layout}`;
    root.dataset.scene = scene.id;
    root.dataset.transition = scene.transition;
    root.dataset.animated = String(Boolean(options.animate && scene.transition !== 'none'));
    root.style.setProperty('--text-scale', scene.textScale || 1);
    const text = el('section', 'slide-text');
    text.append(el('p', 'slide-kicker', scene.kicker));
    const title = el('h1', 'slide-title');
    scene.headline.split('\n').forEach((line, i) => {
      if (i) title.append(document.createElement('br'));
      title.append(el(i ? 'em' : 'span', '', line));
    });
    text.append(title, el('p', 'slide-copy', scene.copy));
    const metrics = el('div', 'slide-metrics');
    scene.metrics.forEach(([value, label]) => {
      const metric = el('div');
      metric.append(el('strong', '', value), el('span', '', label));
      metrics.append(metric);
    });
    text.append(metrics);
    root.append(text);
    const object = objects[scene.objectId];
    if (scene.layout === 'media' && scene.media) {
      const visual=el('section','slide-visual slide-media');root.append(visual);
      window.MediaRuntime?.mount(visual,scene.media,{fit:scene.mediaFit||'contain',staticOnly:options.staticMedia,onPlay:options.onMediaPlay});
    } else if (scene.layout === 'cover' && object) {
      const hero = el('section', 'cover-visual');
      hero.append(el('p', 'visual-eyebrow', '每一个行动，都让未来不同。'));
      const number = el('div', 'cover-number');
      number.append(el('strong', '', (forecast(object)[5] / object.base).toFixed(1)), el('span', '', '倍'));
      hero.append(number, el('p', 'cover-caption', '第 6 个月预计成员 / 起始成员'), trajectory(object));
      const legend = el('div', 'trajectory-legend');
      legend.append(el('span','','现在'),el('span','',`每月增长假设 ${object.growth}%`),el('span','','6 个月后'));
      hero.append(legend); root.append(hero);
    } else if (scene.layout !== 'cover') {
      const visual = el('section', 'slide-visual');
      if (scene.layout === 'story') {
        visual.append(el('p', 'visual-eyebrow', '每日行动计划'));
        ['记录状态', '调整计划', '完成行动'].forEach((label, index) => {
          const step = el('div', 'story-step');
          step.append(el('span', 'step-number', `0${index + 1}`), el('h2', '', label));
          step.append(el('p', '', ['把睡眠、运动与感受放在一起。', '根据今天的状态，选择适合的强度。', '用当天的反馈改善下一次建议。'][index]));
          visual.append(step);
        });
      } else if (object) {
        const header = el('div', 'chart-heading');
        header.append(el('span', '', object.title), el('span', 'demo-badge', '示例数据'));
        visual.append(header);
        const total = el('strong', 'forecast-total');
        visual.append(total, el('p', 'forecast-caption', '第 6 个月预计活跃成员'));
        const bars = el('div', 'forecast-bars');
        visual.append(bars);
        const line = el('div', 'forecast-line');
        visual.append(line);
        bars.hidden = scene.chartType === 'line';
        line.hidden = !bars.hidden;
        const update = () => {
          const values = forecast(object), max = Math.max(...values, 1);
          total.textContent = values[5].toLocaleString('zh-CN');
          if (scene.chartType === 'line') line.replaceChildren(trajectory(object));
          values.forEach((value, i) => {
            let column = bars.children[i];
            if (!column) {
              column = el('div', 'forecast-column');
              column.append(el('small'), el('i'), el('span', '', `M${i + 1}`));
              bars.append(column);
            }
            const bar = column.querySelector('i');
            bar.style.height = `${Math.max(3, value / max * 100)}%`;
            bar.title = `第 ${i + 1} 月：${value}`;
            column.querySelector('small').textContent = value.toLocaleString('zh-CN');
          });
        };
        update();
        if (scene.layout === 'live') {
          const controls = el('label', 'live-control', '每月增长假设');
          const value = el('output', '', `${object.growth}%`);
          const input = el('input');
          input.type = 'range'; input.min = 0; input.max = 50; input.step = 1; input.value = object.growth;
          input.setAttribute('aria-label', '每月增长假设');
          input.addEventListener('input', () => {
            if (object.growth === Number(input.value)) return;
            options.onBeforeObjectChange?.(scene.objectId);
            object.growth = Number(input.value);
            value.textContent = `${object.growth}%`;
            update();
            options.onObjectChange?.(scene.objectId, object);
          });
          controls.append(value, input);
          visual.append(controls);
        }
      }
      root.append(visual);
    }
    const footer = el('footer', 'slide-footer');
    footer.append(el('span', '', 'ATLAS / 产品故事'), el('span', '', '示例项目 · 数据仅用于演示'), el('span', '', String(options.index + 1).padStart(2, '0')));
    root.append(footer);
    if (options.animate && scene.transition !== 'none' && document.body.dataset.motion !== 'off' && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.animate([{opacity:0,transform:scene.transition === 'focus'?'scale(.96)':'translateY(16px)'},{opacity:1,transform:'none'}], {duration:650,easing:'cubic-bezier(.2,.7,.2,1)'});
      root.querySelectorAll('.slide-kicker,.slide-title,.slide-copy,.slide-metrics > div,.cover-visual,.chart-heading,.forecast-total,.forecast-caption,.story-step,.live-control').forEach((node,i) => {
        node.animate([{opacity:0,transform:'translateY(22px)'},{opacity:1,transform:'none'}], {duration:750,delay:Math.min(i,7)*85,fill:'backwards',easing:'cubic-bezier(.16,1,.3,1)'});
      });
      root.querySelectorAll('.forecast-column i').forEach((node,i) => node.animate([{transform:'scaleY(0)'},{transform:'scaleY(1)'}],{duration:950,delay:200+i*90,fill:'backwards',easing:'cubic-bezier(.16,1,.3,1)'}));
      root.querySelector('.trajectory-line')?.animate([{strokeDashoffset:1},{strokeDashoffset:0}],{duration:1800,delay:300,fill:'backwards',easing:'ease-in-out'});
    }
  }
  function mountPlayer(deck) {
    // Capture only the clean template, before editor state or connection fields exist.
    const exportTemplate = document.documentElement.cloneNode(true);
    let editor;
    let undo = [], redo = [];
    const snapshot = () => ({deck:structuredClone(deck),index});
    const pushUndo = () => {undo.push(snapshot());if(undo.length>40)undo.shift();redo=[];};
    let index = 0, playing = false, elapsed = 0, last = performance.now();
    const root = document.getElementById('standaloneSlide');
    const next = document.getElementById('playerNext'), prev = document.getElementById('playerPrev');
    const play = document.getElementById('playerPlay'), counter = document.getElementById('playerCounter');
    const progress = document.getElementById('playerProgress');
    const sceneSelect = document.getElementById('playerSceneSelect');
    const motionButton = document.getElementById('playerMotion');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    let motion = !reducedMotion.matches;
    function updateMotion() {
      document.body.dataset.motion = motion ? 'on' : 'off';
      motionButton.textContent = motion ? '动态效果：开' : '动态效果：关';
      motionButton.setAttribute('aria-pressed', String(motion));
      if (!motion) root.getAnimations({subtree:true}).forEach(animation => animation.cancel());
    }
    motionButton.onclick = () => {
      motion = !motion; updateMotion();
      if (motion) draw(true);
    };
    reducedMotion.addEventListener('change', () => { motion = !reducedMotion.matches; updateMotion(); });
    updateMotion();
    deck.scenes.forEach((scene, n) => {
      const option = el('option', '', `${String(n + 1).padStart(2, '0')} · ${scene.title}`);
      option.value = n;
      sceneSelect.append(option);
    });
    function status() {
      const label = playing ? '暂停' : '自动播放';
      if (play.textContent !== label) play.textContent = label;
      play.setAttribute('aria-label', label);
      play.setAttribute('aria-pressed', String(playing));
      const pageLabel = `${index + 1} / ${deck.scenes.length}`;
      // Do not reannounce the page counter on every timer tick.
      if (counter.textContent !== pageLabel) counter.textContent = pageLabel;
      progress.max = deck.scenes[index].duration;
      progress.value = elapsed;
      progress.setAttribute('aria-valuetext', `${Math.floor(elapsed)} 秒，共 ${deck.scenes[index].duration} 秒`);
      sceneSelect.value = index;
      prev.disabled = index === 0; next.disabled = index === deck.scenes.length - 1;
    }
    function select(n) {
      index = Math.max(0, Math.min(deck.scenes.length - 1, n)); elapsed = 0; last = performance.now();
      draw(true); status();
    }
    function draw(animate=false) {
      render(root, deck.scenes[index], deck.objects, {index,animate,
        onMediaPlay:()=>{playing=false;status();},
        onBeforeObjectChange:pushUndo,
        onObjectChange:()=>{printSlides();editor?.refresh();}
      });
      editor?.refresh();
    }
    function printSlides() {
      const container=document.getElementById('printSlides');window.MediaRuntime?.dispose(container);container.replaceChildren();
      deck.scenes.forEach((scene,i)=>{const article=el('article');container.append(article);render(article,scene,structuredClone(deck.objects),{index:i,staticMedia:true});});
    }
    function restore(from,to) {
      if(!from.length)return;to.push(snapshot());const previous=from.pop();deck=previous.deck;index=previous.index;
      playing=false;elapsed=0;draw();printSlides();status();
    }
    function exportEdited() {
      const html=exportTemplate.cloneNode(true);
      html.querySelector('#deckData').textContent=JSON.stringify(deck).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
      const url=URL.createObjectURL(new Blob(['<!doctype html>'+html.outerHTML],{type:'text/html;charset=utf-8'}));
      const a=el('a');a.href=url;a.download='atlas-edited-presentation.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    function toggle() {
      if (!playing && elapsed >= deck.scenes[index].duration) select(index === deck.scenes.length - 1 ? 0 : index);
      playing = !playing; last = performance.now(); status();
    }
    function seek(seconds) {
      elapsed = Math.max(0, Math.min(deck.scenes[index].duration, seconds));
      last = performance.now(); status();
    }
    next.onclick = () => select(index + 1); prev.onclick = () => select(index - 1); play.onclick = toggle;
    sceneSelect.addEventListener('change', () => select(Number(sceneSelect.value)));
    progress.addEventListener('input', () => seek(Number(progress.value)));
    progress.addEventListener('keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); seek(elapsed + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); seek(elapsed - 1); }
      if (event.key === 'Home') { event.preventDefault(); seek(0); }
      if (event.key === 'End') { event.preventDefault(); seek(deck.scenes[index].duration); }
    });
    progress.addEventListener('pointerdown', () => { playing = false; status(); });
    progress.addEventListener('focus', () => { playing = false; status(); });
    document.getElementById('playerFullscreen').onclick = async () => {
      try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch (_) {}
    };
    document.addEventListener('keydown', e => {
      if (e.target.closest('.prompt-editor,video,.media-surface')) return;
      if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input,textarea,select,[contenteditable=true]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); select(index + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); select(index - 1); }
      if (e.key === 'PageDown') { e.preventDefault(); select(index + 1); }
      if (e.key === 'PageUp') { e.preventDefault(); select(index - 1); }
      if (e.key === 'Home') { e.preventDefault(); select(0); }
      if (e.key === 'End') { e.preventDefault(); select(deck.scenes.length - 1); }
      if (e.key.toLowerCase() === 'f') { e.preventDefault(); document.getElementById('playerFullscreen').click(); }
      if (e.code === 'Space' && !e.target.closest('button')) { e.preventDefault(); toggle(); }
    });
    let touchStart = null;
    const stage = document.querySelector('.standalone-stage');
    stage.addEventListener('pointerdown', event => {
      touchStart = null;
      if (root.dataset.promptMode !== 'true' && event.pointerType === 'touch' && event.isPrimary && !event.target.closest('input,button,select,textarea,a,video,.media-surface')) {
        touchStart = { id:event.pointerId, x:event.clientX, y:event.clientY };
      }
    });
    stage.addEventListener('pointerup', event => {
      if (!touchStart || event.pointerId !== touchStart.id) return;
      const { x, y } = touchStart; touchStart = null;
      const dx = event.clientX - x, dy = event.clientY - y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.25) select(index + (dx < 0 ? 1 : -1));
    });
    stage.addEventListener('pointercancel', () => { touchStart = null; });
    root.addEventListener('focusin', event => {
      if (event.target.matches('input')) { playing = false; status(); }
    });
    document.addEventListener('visibilitychange', () => { last = performance.now(); });
    setInterval(() => {
      const now = performance.now();
      if (playing && !document.hidden) {
        elapsed = Math.min(deck.scenes[index].duration, elapsed + (now - last) / 1000);
        if (elapsed >= deck.scenes[index].duration) {
          if (index < deck.scenes.length - 1) select(index + 1); else playing = false;
        }
        status();
      }
      last = now;
    }, 100);
    if (window.PromptEditor && document.getElementById('togglePromptEdit')) editor=window.PromptEditor.mount({
      root,host:document.body,toggle:document.getElementById('togglePromptEdit'),
      read:()=>({scene:structuredClone(deck.scenes[index]),objects:structuredClone(deck.objects),index,token:JSON.stringify(deck)}),
      pause:()=>{playing=false;status();},
      commit(candidate){pushUndo();playing=false;deck.scenes[index]=candidate.scene;deck.objects=candidate.objects;elapsed=0;draw();printSlides();status();return true;},
      undo:()=>restore(undo,redo),redo:()=>restore(redo,undo),history:()=>({undo:undo.length>0,redo:redo.length>0}),export:exportEdited,
      exportHint:deck.scenes.some(s=>s.media?.src?.startsWith('assets/'))?'已下载 HTML，请与原 assets 素材文件夹放在一起':'已下载修改后的 HTML'
    });
    printSlides(); select(0);
  }
  return { render, mountPlayer, forecast };
}
window.SceneRuntime = createSceneRuntime();
