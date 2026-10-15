const body = document.body;
const cards = [...document.querySelectorAll('.object-card')];
const inspector = document.getElementById('inspector');
const inspectorTitle = document.getElementById('inspectorTitle');
const inspectorKind = document.getElementById('inspectorKind');
const inspectorIntent = document.getElementById('inspectorIntent');
const inspectorIcon = document.querySelector('.inspector-icon');
const selectionOutline = document.getElementById('selectionOutline');
const stage = document.getElementById('canvasStage');
const content = document.getElementById('canvasContent');
const edgeLayer = document.querySelector('.edge-layer');
const edgesGroup = document.getElementById('edges');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');
const syncLabel = document.getElementById('syncLabel');
const presentationOverlay = document.getElementById('presentationOverlay');
const palette = document.getElementById('commandPalette');
const paletteBackdrop = document.getElementById('paletteBackdrop');
const paletteInput = document.getElementById('paletteInput');
const commandSuggestions = document.getElementById('commandSuggestions');
let panX = 0;
let panY = 0;
let panSession = null;
let dragSession = null;
let connections = [
  { from: 'research', to: 'strategy', type: 'blue', label: '参考' },
  { from: 'strategy', to: 'pitch', type: 'purple', label: '生成' },
  { from: 'business', to: 'product', type: 'orange', label: '参考' },
  { from: 'product', to: 'roadmap', type: 'purple', label: '生成' },
  { from: 'pitch', to: 'app', type: 'green', label: '部署' },
  { from: 'roadmap', to: 'data', type: 'green', label: '写入' },
  { from: 'strategy', to: 'product', type: 'dash', label: '' },
  { from: 'roadmap', to: 'app', type: 'dash', label: '依赖' }
];
try { const savedConnections=JSON.parse(localStorage.getItem('canvas-connections-v1')||'null'); if(Array.isArray(savedConnections)) connections.push(...savedConnections.filter(c=>c&&typeof c.from==='string'&&typeof c.to==='string'&&c.from!==c.to).slice(0,500).map(c=>({from:c.from,to:c.to,type:'purple',label:'连接',custom:true}))); } catch {}
const cardById = Object.fromEntries(cards.map(card => [card.dataset.id, card]));
let connectSource = null;
function saveConnections(){try{localStorage.setItem('canvas-connections-v1',JSON.stringify(connections.filter(c=>c.custom).map(({from,to})=>({from,to}))));return true;}catch{showToast('连接保存失败，请检查浏览器存储');return false;}}
function cancelConnection(){connectSource?.classList.remove('connect-source');connectSource=null;document.body.classList.remove('connecting');}

function renderConnections() {
  const stageRect = stage.getBoundingClientRect();
  edgeLayer.setAttribute('viewBox', `0 0 ${stageRect.width} ${stageRect.height}`);
  const boxes = new Map();
  for(const c of cards) boxes.set(c.dataset.id,c.getBoundingClientRect());
  for (const connection of connections) {
    const source=boxes.get(connection.from),target=boxes.get(connection.to);
    if(!source||!target){connection.path?.remove();connection.element?.remove();continue;}
    const horizontal = Math.abs((target.left + target.right - source.left - source.right) / 2) >=
      Math.abs((target.top + target.bottom - source.top - source.bottom) / 2);
    const forward = horizontal
      ? target.left + target.right >= source.left + source.right
      : target.top + target.bottom >= source.top + source.bottom;
    const start = horizontal
      ? { x: (forward ? source.right : source.left) - stageRect.left, y: (source.top + source.bottom) / 2 - stageRect.top }
      : { x: (source.left + source.right) / 2 - stageRect.left, y: (forward ? source.bottom : source.top) - stageRect.top };
    const end = horizontal
      ? { x: (forward ? target.left : target.right) - stageRect.left, y: (target.top + target.bottom) / 2 - stageRect.top }
      : { x: (target.left + target.right) / 2 - stageRect.left, y: (forward ? target.top : target.bottom) - stageRect.top };
    const bend = Math.max(30, Math.abs(horizontal ? end.x - start.x : end.y - start.y) * 0.5);
    const path = connection.path || (connection.path = document.createElementNS('http://www.w3.org/2000/svg', 'path')); 
    path.setAttribute('class', `edge edge-${connection.type}`);
    path.setAttribute('d', horizontal
      ? `M${start.x} ${start.y} C${start.x + (forward ? bend : -bend)} ${start.y}, ${end.x - (forward ? bend : -bend)} ${end.y}, ${end.x} ${end.y}`
      : `M${start.x} ${start.y} C${start.x} ${start.y + (forward ? bend : -bend)}, ${end.x} ${end.y - (forward ? bend : -bend)}, ${end.x} ${end.y}`);
    if(!path.isConnected)edgesGroup.append(path);
    if (connection.label) {
      const label = connection.element || (connection.element = document.createElementNS('http://www.w3.org/2000/svg', 'text'));
      label.setAttribute('class', 'edge-label');
      label.setAttribute('x', (start.x + end.x) / 2);
      label.setAttribute('y', (start.y + end.y) / 2 - 8);
      label.textContent = connection.label;
      if(!label.isConnected)edgesGroup.append(label);
    }
  }
  document.getElementById('connectionMeta').textContent=`${connections.filter(c=>boxes.has(c.from)&&boxes.has(c.to)).length} 条连接`;
}

const objectCopy = {
  research: '找出指向更自适应健康体验的关键信号。',
  strategy: '把分散的健康数据转成用户真正能坚持的自适应每日计划。',
  business: '围绕教练服务、进步反馈与信任，构建可持续的订阅引擎。',
  product: '让产品成为真正的个人健康操作系统。',
  pitch: '把机会讲成一个持续生长的产品故事，而不是静态幻灯片。',
  roadmap: '安排未来 6 周的工作，并让所有依赖关系清晰可见。',
  app: '提供一个实时工作面，让团队可以立即验证产品假设。',
  data: '让成员信号可查询、可授权，并随时支持运行时决策。'
};

function showToast(message, kind = 'success') {
  toastMessage.textContent = message;
  toast.querySelector('.toast-icon').textContent = kind === 'running' ? '↻' : '✓';
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2500);
}

function placeSelection(card) {
  const stageRect = stage.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();
  selectionOutline.style.left = `${cardRect.left - stageRect.left - 4}px`;
  selectionOutline.style.top = `${cardRect.top - stageRect.top - 4}px`;
  selectionOutline.style.width = `${cardRect.width + 8}px`;
  selectionOutline.style.height = `${cardRect.height + 8}px`;
  selectionOutline.style.opacity = '1';
}

function selectCard(card) {
  cards.forEach(item => item.classList.toggle('selected', item === card));
  if (!card) return;
  const id = card.dataset.id;
  inspector.classList.remove('hidden');
  inspectorTitle.textContent = card.dataset.title;
  inspectorKind.textContent = card.dataset.kind;
  inspectorIntent.textContent = objectCopy[id] || '让此对象持续连接到产品动态图谱。';
  inspectorIcon.className = `inspector-icon ${card.dataset.color === 'blue' ? 'blue-icon' : card.dataset.color === 'green' ? 'green-icon' : card.dataset.color === 'orange' ? 'orange-icon' : 'purple-icon'}`;
  inspectorIcon.textContent = id === 'research' ? '⌁' : id === 'business' ? '◒' : id === 'app' ? '▦' : id === 'data' ? '◫' : '✦';
  requestAnimationFrame(() => placeSelection(card));
}

function bindCard(card) {
  card.addEventListener('click', () => {
    if(document.body.classList.contains('connecting')) {
      if(!connectSource){connectSource=card;card.classList.add('connect-source');showToast('已选择起点，请点击终点');return;}
      if(connectSource===card){connectSource.classList.remove('connect-source');connectSource=null;return;}
      const exists=connections.some(c=>c.from===connectSource.dataset.id&&c.to===card.dataset.id);
      if(!exists){connections.push({from:connectSource.dataset.id,to:card.dataset.id,type:'purple',label:'连接',custom:true});if(saveConnections()){renderConnections();showToast('连接已创建并保存');}else connections.pop();}else showToast('这两个对象已有连接');
      cancelConnection();return;
    }
    selectCard(card);
  });
  card.addEventListener('pointerdown', event => {
    if(document.body.classList.contains('connecting')){event.stopPropagation();return;}
    if (event.button !== 0 || event.target.closest('button,input,select,video,a,.media-surface')) return;
    event.stopPropagation();
    selectCard(card);
    dragSession = { card, startX: event.clientX, startY: event.clientY, x: Number(card.dataset.dragX || 0), y: Number(card.dataset.dragY || 0), moved: false };
    card.classList.add('dragging');
    card.setPointerCapture?.(event.pointerId);
  });
  card.addEventListener('pointermove', event => {
    if (!dragSession || dragSession.card !== card) return;
    const dx = event.clientX - dragSession.startX;
    const dy = event.clientY - dragSession.startY;
    if (Math.abs(dx) + Math.abs(dy) < 3) return;
    dragSession.moved = true;
    const scale = zoom / 100;
    const nextX = dragSession.x + dx / scale;
    const nextY = dragSession.y + dy / scale;
    card.dataset.dragX = nextX.toFixed(2);
    card.dataset.dragY = nextY.toFixed(2);
    card.style.transform = `translate(${nextX}px, ${nextY}px)`;
    scheduleCanvas();
  });
  card.addEventListener('pointerup', event => {
    if (!dragSession || dragSession.card !== card) return;
    card.classList.remove('dragging');
    card.releasePointerCapture?.(event.pointerId);
    if (dragSession.moved) showToast(`${card.dataset.title} 已移动`);
    dragSession = null;saveCanvas();
  });
  card.addEventListener('pointercancel', () => { card.classList.remove('dragging'); dragSession = null; saveCanvas(); });
}
cards.forEach(bindCard);

stage.addEventListener('pointerdown', event => {
  if (event.button !== 0 || event.target.closest('.object-card, button, input, .canvas-controls, .canvas-toolbar, .canvas-footer')) return;
  panSession = { startX: event.clientX, startY: event.clientY, x: panX, y: panY, moved: false };
  stage.classList.add('panning');
  stage.setPointerCapture?.(event.pointerId);
});
stage.addEventListener('pointermove', event => {
  if (!panSession) return;
  const dx = event.clientX - panSession.startX;
  const dy = event.clientY - panSession.startY;
  if (Math.abs(dx) + Math.abs(dy) < 2) return;
  panSession.moved = true;
  panX = panSession.x + dx;
  panY = panSession.y + dy;
  applyCanvasTransform();
  const selected = document.querySelector('.object-card.selected');
  if (selected) placeSelection(selected);
});
stage.addEventListener('pointerup', event => {
  if (!panSession) return;
  stage.classList.remove('panning');
  stage.releasePointerCapture?.(event.pointerId);
  if (panSession.moved) showToast('画布已移动');
  panSession = null;saveCanvas();
});
stage.addEventListener('pointercancel', () => { stage.classList.remove('panning'); panSession = null; });
stage.addEventListener('wheel', event => {
  if (event.target.closest('button, input, .object-card')) return;
  event.preventDefault();
  setZoom(zoom + (event.deltaY < 0 ? 4 : -4));
}, { passive: false });
window.addEventListener('resize', () => {
  const selected = document.querySelector('.object-card.selected');
  if (selected) placeSelection(selected);
  renderConnections();
});

document.querySelectorAll('.mode-btn').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('.mode-btn').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  const mode = button.dataset.mode;
  document.documentElement.dataset.mode = mode;
  if (mode === 'build') showToast('构建模式已就绪 · 运行图谱已连接');
  if (mode === 'think') showToast('思考模式 · 画布就是上下文');
  if (mode === 'present') openPresentation();
}));

document.getElementById('closeInspector').addEventListener('click', () => { inspector.classList.add('hidden'); selectionOutline.style.opacity = '0'; });
document.getElementById('contextBtn').addEventListener('click', () => {
  showToast('上下文视图 · 3 个来源正在影响此决策');
  inspector.classList.remove('hidden');
});

document.getElementById('runBtn').addEventListener('click', () => window.Presentation.run());

document.getElementById('presentBtn').addEventListener('click', () => window.Presentation.open());
document.getElementById('adminBtn')?.addEventListener('click', () => { location.href = './admin.html'; });
function openPresentation() { window.Presentation.open(); }
window.addEventListener('keydown', event => {
  if(event.key==='Escape')cancelConnection();
  if (event.target.closest('input, textarea, select, [contenteditable=true]')) return;
  if (event.key === 'Escape' && palette.classList.contains('open')) closePalette();
  if (presentationOverlay.classList.contains('open')) return;
  if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') || event.key === '/') { event.preventDefault(); openPalette(); }
});

function openPalette() {
  paletteBackdrop.classList.add('open');
  palette.classList.add('open');
  paletteInput.value = '';
  setTimeout(() => paletteInput.focus(), 50);
}
function closePalette() {
  paletteBackdrop.classList.remove('open');
  palette.classList.remove('open');
}
paletteBackdrop.addEventListener('click', closePalette);
document.getElementById('commandInput').addEventListener('click', () => commandSuggestions.classList.toggle('open'));
document.getElementById('commandInput').addEventListener('dblclick', openPalette);
document.querySelectorAll('.command-suggestions button').forEach(button => button.addEventListener('click', () => {
  commandSuggestions.classList.remove('open');
  showToast(`${button.dataset.command} · AI 正在构建图谱`);
}));
document.querySelectorAll('.palette-grid button').forEach(button => button.addEventListener('click', () => {
  const action = button.dataset.action;
  closePalette();
  if (action === 'present') openPresentation();
  else showToast(action === 'seed' ? '想法种子已创建 · 选择一个生长方向' : action === 'build' ? '构建模块已放置到画布' : '研究上下文已关联到当前选择');
}));

let zoom = 68;
function applyCanvasTransform() {
  const scale = zoom / 100;
  content.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${scale})`;
  stage.style.backgroundPosition = `${panX}px ${panY}px, ${panX}px ${panY}px, center, center`;
  scheduleCanvas();
}

function setZoom(next) {
  zoom = Math.max(20, Math.min(200, next));
  document.getElementById('zoomValue').textContent = `${zoom}%`;
  document.querySelector('.zoom-percent').textContent = `${zoom}%`;
  applyCanvasTransform();
  const selected = document.querySelector('.object-card.selected');
  if (selected) requestAnimationFrame(() => placeSelection(selected));
  saveCanvas();
}
document.getElementById('zoomOut').addEventListener('click', () => setZoom(zoom - 8));
document.getElementById('zoomIn').addEventListener('click', () => setZoom(zoom + 8));
document.getElementById('zoomReset').addEventListener('click', () => {panX=0;panY=0;setZoom(100);saveCanvas();});

function fitCanvas() {
  if (!cards.length) return;
  const bounds=cards.map(card=>({x:card.offsetLeft+Number(card.dataset.dragX||0),y:card.offsetTop+Number(card.dataset.dragY||0),w:card.offsetWidth,h:card.offsetHeight}));
  const left=Math.min(...bounds.map(b=>b.x)),top=Math.min(...bounds.map(b=>b.y));
  const right=Math.max(...bounds.map(b=>b.x+b.w)),bottom=Math.max(...bounds.map(b=>b.y+b.h));
  const scale=Math.max(.2,Math.min(1,(stage.clientWidth-48)/(right-left),(stage.clientHeight-190)/(bottom-top)));
  // Account for the centered CSS transform origin when positioning the content.
  panX=stage.clientWidth/2-(left+right)/2*scale-(1-scale)*content.offsetWidth/2;
  panY=(stage.clientHeight-20)/2-(top+bottom)/2*scale-(1-scale)*content.offsetHeight/2;
  setZoom(Math.round(scale*100));
}
document.querySelector('.canvas-controls [aria-label="适应画布"]').addEventListener('click',fitCanvas);

document.getElementById('applySuggestion').addEventListener('click', event => { event.currentTarget.textContent = '已应用'; event.currentTarget.style.color = '#73dfa9'; showToast('建议已应用到产品路线图'); });
document.getElementById('editObject').addEventListener('click', () => showToast('编辑模式已开启 · 可直接在模块中输入'));
document.getElementById('shareBtn').addEventListener('click', async () => {
  const url=location.href;
  try { await navigator.clipboard.writeText(url); showToast('本机入口已复制；分享作品请导出 HTML / ZIP'); }
  catch { const input=document.createElement('input');input.value=url;document.body.append(input);input.select();let ok=false;try{ok=document.execCommand('copy');}catch{}input.remove();showToast(ok?'本机入口已复制；分享作品请导出 HTML / ZIP':'复制失败，请手动复制地址',ok?'success':'error'); }
});
document.getElementById('connectObject').addEventListener('click', () => { cancelConnection();connectSource=cards.find(c=>c.classList.contains('selected'));connectSource?.classList.add('connect-source');document.body.classList.add('connecting'); showToast(connectSource?'请选择目标对象 · Esc 取消':'先点起点，再点终点 · Esc 取消'); });
document.getElementById('moreObject').addEventListener('click', () => openPalette());

let framePending=false;
function scheduleCanvas(){if(framePending)return;framePending=true;requestAnimationFrame(()=>{framePending=false;renderConnections();const selected=cards.find(c=>c.classList.contains('selected'));if(selected&&!inspector.classList.contains('hidden'))placeSelection(selected);});}
let canvasSaved={};
try {canvasSaved=JSON.parse(localStorage.getItem('canvas-board-v1')||'{}');}catch{}
function saveCanvas(){try{localStorage.setItem('canvas-board-v1',JSON.stringify(canvasSaved={panX,panY,zoom,positions:{...canvasSaved.positions,...Object.fromEntries(cards.map(c=>[c.dataset.id,{x:Number(c.dataset.dragX||0),y:Number(c.dataset.dragY||0)}]))}}));}catch{showToast('画布位置保存失败，请检查本机存储');}}
function restoreCard(card){const pos=canvasSaved.positions?.[card.dataset.id];if(pos&&Number.isFinite(pos.x)&&Number.isFinite(pos.y)){card.dataset.dragX=pos.x;card.dataset.dragY=pos.y;card.style.transform=`translate(${pos.x}px,${pos.y}px)`;}}
cards.forEach(restoreCard);
const hasSavedView=Number.isFinite(canvasSaved.zoom);
const savedZoom=hasSavedView?canvasSaved.zoom:100;
panX=Number.isFinite(canvasSaved.panX)?canvasSaved.panX:0;panY=Number.isFinite(canvasSaved.panY)?canvasSaved.panY:0;
selectCard(document.querySelector('.strategy-card'));
setZoom(savedZoom);
if(!hasSavedView&&matchMedia('(max-width:760px)').matches)requestAnimationFrame(fitCanvas);
renderConnections();
const canvasResizeObserver = new ResizeObserver(() => {
  renderConnections();
  const selected = document.querySelector('.object-card.selected');
  if (selected && !inspector.classList.contains('hidden')) placeSelection(selected);
});
canvasResizeObserver.observe(stage);
cards.forEach(card => canvasResizeObserver.observe(card));

function canvasPoint(x,y){const rect=content.getBoundingClientRect();return {x:(x-rect.left)/(zoom/100),y:(y-rect.top)/(zoom/100)};}
window.CanvasBoard={
 register(card){cards.push(card);cardById[card.dataset.id]=card;restoreCard(card);bindCard(card);canvasResizeObserver.observe(card);scheduleCanvas();document.getElementById('canvasMeta').textContent=`${cards.length} 个对象`;},
 remove(card,{preservePosition=false}={}){canvasResizeObserver.unobserve(card);cards.splice(cards.indexOf(card),1);delete cardById[card.dataset.id];if(!preservePosition)delete canvasSaved.positions?.[card.dataset.id];card.remove();selectionOutline.style.opacity='0';saveCanvas();scheduleCanvas();document.getElementById('canvasMeta').textContent=`${cards.length} 个对象`;},
 point:canvasPoint,center(){const r=stage.getBoundingClientRect();return canvasPoint(r.left+r.width/2,r.top+r.height/2);}
};
document.getElementById('canvasMeta').textContent=`${cards.length} 个对象`;
