(() => {
  'use strict';

  const VERSION = '20260917-custom-layout-v2';
  const MEDIA = '(max-width: 767px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px) and (pointer: coarse)';
  if (!window.matchMedia(MEDIA).matches || window.__luxCustomLayoutV2 === VERSION) return;
  window.__luxCustomLayoutV2 = VERSION;
  // Prevent the legacy grouped editor from installing after this one.
  window.__luxMobileCustomControlsInstalled = VERSION;

  const MODE_KEY = 'lux-play:console-view-mode';
  const KEY_PREFIX = 'lux-play:custom-controls:v2';
  const groups = {
    screen: ['Tela', .45, 1.60], dpad: ['Direcional', .60, 1.40], face: ['A / B', .60, 1.40],
    l: ['L', .60, 1.40], r: ['R', .60, 1.40], extra: ['Extra', .60, 1.40],
    select: ['Select', .60, 1.40], start: ['Start', .60, 1.40]
  };

  let editing = false, selected = 'screen', draft = null, original = null, drag = null, lastOrientation = '';
  const baseCache = new Map();
  const root = () => document.getElementById('emulatorModal');
  const context = () => document.getElementById('luxConsoleContextLayer');
  const orient = () => innerWidth > innerHeight ? 'landscape' : 'portrait';
  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
  const clone = v => JSON.parse(JSON.stringify(v || {}));
  const system = () => {
    const cls = [...(root()?.classList || [])].find(v => v.startsWith('lux-console-system-'));
    if (cls) return cls.slice(19) || 'gba';
    try { return String(activeEmulatorGame?.console || 'gba').toLowerCase().replace(/[^a-z0-9]/g, ''); } catch (_) { return 'gba'; }
  };
  const storageKey = () => `${KEY_PREFIX}:${orient()}:${system()}`;
  const selector = key => `[data-lux-custom-v2="${key}"]`;

  function markTargets() {
    const modal = root();
    if (!modal) return;
    modal.querySelectorAll('[data-lux-custom-v2]').forEach(el => el.removeAttribute('data-lux-custom-v2'));
    modal.querySelectorAll('[data-lux-custom-screen-copy]').forEach(el => el.removeAttribute('data-lux-custom-screen-copy'));
    const mark = (el, key) => { if (el) el.dataset.luxCustomV2 = key; };
    mark(modal.querySelector('.lux-console-screen-layer'), 'screen');
    const bezel = modal.querySelector('.lux-console-bezel-window');
    if (bezel) bezel.dataset.luxCustomScreenCopy = '1';
    mark(modal.querySelector('.lux-console-dpad'), 'dpad');
    mark(modal.querySelector('.lux-console-face'), 'face');

    const shoulders = [...modal.querySelectorAll('.lux-console-shoulders .lux-shoulder')];
    shoulders.forEach((button, i) => {
      const text = String(button.textContent || '').trim().toUpperCase();
      if (text === 'L') mark(button, 'l');
      else if (text === 'R') mark(button, 'r');
      else if (/^(Z|L2|R2)$/.test(text)) mark(button, 'extra');
      else mark(button, i === 0 ? 'l' : i === shoulders.length - 1 ? 'r' : 'extra');
    });

    const systemButtons = [...modal.querySelectorAll('.lux-console-system-buttons .lux-system-button')];
    systemButtons.forEach((button, i) => {
      const text = String(button.textContent || '').trim().toUpperCase();
      if (text.includes('SELECT')) mark(button, 'select');
      else if (text.includes('START') || systemButtons.length === 1) mark(button, 'start');
      else mark(button, i === 0 ? 'select' : 'start');
    });
  }

  const target = key => { markTargets(); return root()?.querySelector(selector(key)) || null; };
  const available = () => Object.keys(groups).filter(key => !!target(key));
  const label = key => key === 'extra' ? (target(key)?.textContent || groups[key][0]).trim() : (groups[key]?.[0] || key);

  function fallback() {
    if (orient() === 'landscape') return {
      screen:{x:20,y:3,scale:.9}, dpad:{x:3,y:34,scale:.9}, face:{x:80,y:34,scale:.9},
      l:{x:3,y:5,scale:.9}, r:{x:85,y:5,scale:.9}, extra:{x:46,y:5,scale:.85},
      select:{x:3,y:78,scale:.9}, start:{x:85,y:78,scale:.9}
    };
    return {
      screen:{x:4,y:7,scale:1}, dpad:{x:5,y:61,scale:.9}, face:{x:61,y:61,scale:.9},
      l:{x:5,y:51,scale:.9}, r:{x:68,y:51,scale:.9}, extra:{x:42,y:51,scale:.85},
      select:{x:27,y:87,scale:.9}, start:{x:53,y:87,scale:.9}
    };
  }

  function captureFrameLayout(force = false) {
    const modal = root();
    if (!modal) return fallback();
    const cacheKey = storageKey();
    if (!force && baseCache.has(cacheKey)) return clone(baseCache.get(cacheKey));
    const state = {
      frame: modal.classList.contains('lux-console-view-frame'), full: modal.classList.contains('lux-console-view-fullscreen'),
      custom: modal.classList.contains('lux-console-view-custom'), edit: modal.classList.contains('lux-controls-editing')
    };
    modal.classList.remove('lux-console-view-fullscreen', 'lux-console-view-custom', 'lux-controls-editing');
    modal.classList.add('lux-console-view-frame');
    markTargets();
    const out = {}, vw = Math.max(1, innerWidth), vh = Math.max(1, innerHeight);
    available().forEach(key => {
      const rect = target(key)?.getBoundingClientRect();
      if (rect?.width && rect?.height) out[key] = { x: clamp(rect.left / vw * 100, 0, 98), y: clamp(rect.top / vh * 100, 0, 98), scale: 1 };
    });
    modal.classList.remove('lux-console-view-frame', 'lux-console-view-fullscreen', 'lux-console-view-custom', 'lux-controls-editing');
    if (state.custom) modal.classList.add('lux-console-view-frame', 'lux-console-view-custom');
    else if (state.full) modal.classList.add('lux-console-view-fullscreen');
    else if (state.frame) modal.classList.add('lux-console-view-frame');
    if (state.edit) modal.classList.add('lux-controls-editing');
    const fb = fallback();
    available().forEach(key => { if (!out[key]) out[key] = fb[key]; });
    if (Object.keys(out).length >= 4) baseCache.set(cacheKey, clone(out));
    return out;
  }

  function normalize(value) {
    const base = captureFrameLayout(), out = {};
    new Set([...Object.keys(base), ...Object.keys(value || {})]).forEach(key => {
      if (!groups[key]) return;
      const v = value?.[key] || base[key];
      if (!v) return;
      out[key] = { x: clamp(v.x, 0, 98), y: clamp(v.y, 0, 98), scale: clamp(v.scale ?? 1, groups[key][1], groups[key][2]) };
    });
    return out;
  }

  function readLayout() {
    try { const raw = localStorage.getItem(storageKey()); return raw ? normalize(JSON.parse(raw)) : normalize(captureFrameLayout()); }
    catch (_) { return normalize(captureFrameLayout()); }
  }
  function saveLayout(value) { const v = normalize(value); try { localStorage.setItem(storageKey(), JSON.stringify(v)); } catch (_) {} return v; }

  function applyLayout(value) {
    const modal = root(); if (!modal) return;
    markTargets(); const layout = value ? value : readLayout();
    Object.entries(layout).forEach(([key, v]) => {
      modal.style.setProperty(`--lux-cv2-${key}-x`, `${v.x}vw`);
      modal.style.setProperty(`--lux-cv2-${key}-y`, `${v.y}dvh`);
      modal.style.setProperty(`--lux-cv2-${key}-scale`, String(v.scale));
    });
  }

  function setCustom(persist = true) {
    const modal = root(); if (!modal) return;
    modal.classList.remove('lux-console-view-fullscreen');
    modal.classList.add('lux-console-view-frame', 'lux-console-view-custom');
    modal.dataset.luxViewMode = 'custom';
    if (persist) try { localStorage.setItem(MODE_KEY, 'custom'); } catch (_) {}
    applyLayout(editing && draft ? draft : readLayout());
  }
  function leaveCustom() { root()?.classList.remove('lux-console-view-custom', 'lux-controls-editing'); }
  const storedMode = () => { try { return localStorage.getItem(MODE_KEY) || 'frame'; } catch (_) { return 'frame'; } };

  function injectSettings(sheet) {
    if (!sheet || sheet.dataset.luxCustomV2 === '1') return;
    const chooser = sheet.querySelector('.lux-layout-selector'), group = sheet.querySelector('.lux-setting-group');
    if (!chooser || !group) return;
    sheet.dataset.luxCustomV2 = '1'; chooser.classList.add('lux-layout-selector-3');
    const custom = document.createElement('button');
    custom.type = 'button'; custom.dataset.value = 'custom'; custom.textContent = 'Personalizado'; custom.setAttribute('aria-pressed', 'false');
    chooser.appendChild(custom);
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'lux-setting-row lux-custom-controls-edit hidden';
    edit.innerHTML = '<span><strong>Editar layout</strong><small>Mova e redimensione a tela e cada botão separadamente.</small></span><span class="lux-setting-row-side"><span>Editar</span><span>›</span></span>';
    const card = chooser.closest('.lux-setting-card');
    if (card?.nextSibling) group.insertBefore(edit, card.nextSibling); else group.appendChild(edit);

    const refresh = () => {
      const isCustom = storedMode() === 'custom';
      chooser.querySelectorAll('button').forEach(b => {
        const active = isCustom ? b.dataset.value === 'custom' : b.dataset.value === (root()?.dataset.luxViewMode || storedMode());
        b.classList.toggle('is-active', active); b.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      edit.classList.toggle('hidden', !isCustom);
    };
    custom.onclick = event => { event.preventDefault(); event.stopPropagation(); setCustom(true); refresh(); };
    chooser.querySelectorAll('[data-value="frame"],[data-value="fullscreen"]').forEach(b => b.addEventListener('click', () => { leaveCustom(); setTimeout(refresh, 0); }, true));
    edit.onclick = event => { event.preventDefault(); event.stopPropagation(); openEditor(sheet); };
    if (storedMode() === 'custom') setCustom(false);
    refresh();
  }

  function resumeGame() {
    const emulator = window.EJS_emulator, manager = emulator?.gameManager;
    try {
      if (emulator?.paused === true && typeof emulator.togglePlaying === 'function') emulator.togglePlaying(true); else manager?.toggleMainLoop?.(1);
      if (emulator) emulator.paused = false;
    } catch (_) { try { manager?.toggleMainLoop?.(1); } catch (_) {} }
    try { if (typeof resumeGamePlayTimer === 'function') resumeGamePlayTimer(); } catch (_) {}
  }

  function toolbarRefresh() {
    const bar = document.querySelector('.lux-cv2-toolbar'); if (!bar) return;
    const list = available(); if (!list.includes(selected)) selected = list[0] || 'screen';
    bar.querySelectorAll('[data-cv2-group]').forEach(b => { const show = list.includes(b.dataset.cv2Group); b.hidden = !show; b.classList.toggle('is-active', show && b.dataset.cv2Group === selected); });
    const cfg = draft?.[selected], def = groups[selected];
    const title = bar.querySelector('.lux-cv2-selected'); if (title) title.textContent = label(selected);
    const slider = bar.querySelector('.lux-cv2-size'), value = bar.querySelector('.lux-cv2-size-value');
    if (slider && cfg && def) { slider.min = Math.round(def[1]*100); slider.max = Math.round(def[2]*100); slider.value = Math.round(cfg.scale*100); }
    if (value && cfg) value.textContent = `${Math.round(cfg.scale*100)}%`;
    root()?.querySelectorAll('.lux-cv2-selected-target').forEach(el => el.classList.remove('lux-cv2-selected-target'));
    target(selected)?.classList.add('lux-cv2-selected-target');
  }

  function closeEditor(keep) {
    const modal = root(); if (!editing || !modal) return;
    draft = keep ? saveLayout(draft) : clone(original || readLayout()); applyLayout(draft);
    editing = false; drag = null; modal.classList.remove('lux-controls-editing');
    modal.querySelectorAll('.lux-cv2-selected-target').forEach(el => el.classList.remove('lux-cv2-selected-target'));
    context()?.querySelector('.lux-cv2-toolbar')?.remove(); context()?.classList.remove('lux-control-editor-context','lux-context-open');
    setTimeout(resumeGame, 0);
  }

  function openEditor(sheet) {
    const modal = root(), ctx = context(); if (!modal || !ctx) return;
    setCustom(true); markTargets(); original = clone(readLayout()); draft = clone(original); selected = available()[0] || 'screen'; editing = true; applyLayout(draft);
    sheet?.remove(); ctx.querySelectorAll('.lux-cv2-toolbar').forEach(el => el.remove()); ctx.classList.add('lux-context-open','lux-control-editor-context'); modal.classList.add('lux-controls-editing');
    const bar = document.createElement('div'); bar.className = 'lux-cv2-toolbar';
    bar.innerHTML = `<div class="lux-cv2-head"><span><strong>Editar layout</strong><small>Arraste a peça selecionada na tela.</small></span><b class="lux-cv2-selected">Tela</b></div>
      <div class="lux-cv2-groups">${Object.entries(groups).map(([k,v])=>`<button type="button" data-cv2-group="${k}">${v[0]}</button>`).join('')}</div>
      <div class="lux-cv2-scale"><span>Tamanho</span><input class="lux-cv2-size" type="range" step="5"><b class="lux-cv2-size-value">100%</b></div>
      <div class="lux-cv2-actions"><button data-cv2-action="reset">Padrão</button><button data-cv2-action="cancel">Cancelar</button><button class="primary" data-cv2-action="save">Salvar</button></div>`;
    ctx.appendChild(bar);
    bar.querySelectorAll('[data-cv2-group]').forEach(b => b.onclick = () => { selected = b.dataset.cv2Group; toolbarRefresh(); });
    bar.querySelector('.lux-cv2-size').oninput = e => { const cfg = draft?.[selected], def = groups[selected]; if (!cfg || !def) return; cfg.scale = clamp(+e.target.value/100, def[1], def[2]); applyLayout(draft); toolbarRefresh(); };
    bar.querySelector('[data-cv2-action="reset"]').onclick = () => { baseCache.delete(storageKey()); draft = normalize(captureFrameLayout(true)); applyLayout(draft); toolbarRefresh(); };
    bar.querySelector('[data-cv2-action="cancel"]').onclick = () => closeEditor(false);
    bar.querySelector('[data-cv2-action="save"]').onclick = () => closeEditor(true);
    toolbarRefresh();
  }

  function beginDrag(event) {
    if (!editing || event.button > 0 || !(event.target instanceof Element)) return;
    const el = event.target.closest('[data-lux-custom-v2]'), key = el?.dataset.luxCustomV2;
    if (!key || !draft?.[key]) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation(); selected = key;
    const rect = el.getBoundingClientRect();
    drag = { id:event.pointerId, key, sx:event.clientX, sy:event.clientY, x:draft[key].x, y:draft[key].y, w:rect.width/innerWidth*100, h:rect.height/innerHeight*100 };
    try { el.setPointerCapture?.(event.pointerId); } catch (_) {} toolbarRefresh();
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.id || !editing) return; event.preventDefault();
    const cfg = draft?.[drag.key]; if (!cfg) return;
    cfg.x = clamp(drag.x + (event.clientX-drag.sx)/Math.max(1,innerWidth)*100, 0, Math.max(0,100-drag.w));
    cfg.y = clamp(drag.y + (event.clientY-drag.sy)/Math.max(1,innerHeight)*100, 0, Math.max(0,100-drag.h)); applyLayout(draft);
  }
  function endDrag(event) { if (drag && event.pointerId === drag.id) drag = null; }

  function styles() {
    if (document.getElementById('luxCustomLayoutV2Styles')) return;
    const style = document.createElement('style'); style.id = 'luxCustomLayoutV2Styles';
    const transforms = Object.keys(groups).map(key => `#emulatorModal.lux-console-mobile-stage1.lux-console-view-custom ${selector(key)}{position:fixed!important;inset:auto!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;margin:0!important;transform-origin:top left!important;transform:translate3d(var(--lux-cv2-${key}-x,0vw),var(--lux-cv2-${key}-y,0dvh),0) scale(var(--lux-cv2-${key}-scale,1))!important}`).join('');
    style.textContent = `@media ${MEDIA}{
      #emulatorModal.lux-console-mobile-stage1 .lux-layout-selector-3{grid-template-columns:repeat(3,minmax(0,1fr))}.lux-custom-controls-edit.hidden{display:none!important}${transforms}
      #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom ${selector('screen')}{width:var(--lux-screen-width)!important;height:var(--lux-screen-height)!important;max-width:none!important;max-height:none!important;z-index:10!important}
      #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom [data-lux-custom-screen-copy="1"]{position:fixed!important;inset:auto!important;left:0!important;top:0!important;width:var(--lux-visible-screen-width)!important;height:var(--lux-visible-screen-height)!important;transform-origin:top left!important;transform:translate3d(var(--lux-cv2-screen-x,0vw),var(--lux-cv2-screen-y,0dvh),0) scale(var(--lux-cv2-screen-scale,1))!important}
      #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-shoulders,#emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-system-buttons{pointer-events:none!important}
      #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-shoulders .lux-game-control,#emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-system-buttons .lux-game-control{pointer-events:auto!important}
      #emulatorModal.lux-console-mobile-stage1.lux-controls-editing [data-lux-custom-v2]{pointer-events:auto!important;touch-action:none!important;outline:1px dashed rgba(216,180,254,.62)!important;outline-offset:5px!important;cursor:move!important}
      #emulatorModal.lux-console-mobile-stage1.lux-controls-editing .lux-cv2-selected-target{outline:2px solid #c084fc!important;box-shadow:0 0 0 5px rgba(147,51,234,.14),0 0 24px rgba(147,51,234,.3)!important}
      #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-context.lux-context-open{background:rgba(7,3,13,.12)!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;pointer-events:none!important}
      #emulatorModal.lux-console-mobile-stage1 .lux-cv2-toolbar{position:fixed;left:50%;bottom:calc(8px + env(safe-area-inset-bottom,0px));z-index:90;transform:translateX(-50%);width:min(94vw,560px);max-height:58dvh;overflow:auto;padding:10px;border:1px solid rgba(216,180,254,.32);border-radius:18px;background:linear-gradient(180deg,rgba(31,12,53,.97),rgba(12,5,23,.98));box-shadow:0 18px 44px rgba(0,0,0,.44);color:#fff;pointer-events:auto!important;box-sizing:border-box}
      .lux-cv2-head,.lux-cv2-scale{display:flex;align-items:center;justify-content:space-between;gap:9px}.lux-cv2-head strong{display:block;font-size:11px}.lux-cv2-head small{display:block;font-size:8px;color:#d8b4fe99}.lux-cv2-selected{font-size:9px;color:#d8b4fe}.lux-cv2-groups{display:grid;grid-template-columns:repeat(4,1fr);gap:5px;margin-top:8px}.lux-cv2-groups button,.lux-cv2-actions button{min-height:30px;border:1px solid #d8b4fe2e;border-radius:10px;background:#ffffff0a;color:#e9d5ffb8;font-size:8px;font-weight:800}.lux-cv2-groups button.is-active{border-color:#c084fcb8;background:#7e22ce47;color:#fff}.lux-cv2-scale{margin-top:8px;font-size:9px;color:#d8b4fe}.lux-cv2-size{flex:1;pointer-events:auto}.lux-cv2-actions{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:8px}.lux-cv2-actions .primary{background:linear-gradient(135deg,#9333ea,#7c3aed);color:#fff}
      @media(orientation:landscape){#emulatorModal.lux-console-mobile-stage1 .lux-cv2-toolbar{width:min(72vw,620px);padding:8px}.lux-cv2-groups,.lux-cv2-scale,.lux-cv2-actions{margin-top:5px}.lux-cv2-groups button,.lux-cv2-actions button{min-height:27px}}
    }`;
    document.head.appendChild(style);
  }

  styles(); document.addEventListener('pointerdown', beginDrag, true); window.addEventListener('pointermove', moveDrag, {capture:true,passive:false}); window.addEventListener('pointerup', endDrag, true); window.addEventListener('pointercancel', endDrag, true);
  const observer = new MutationObserver(mutations => {
    markTargets(); if (storedMode() === 'custom' && root()) setCustom(false);
    mutations.forEach(m => m.addedNodes.forEach(node => { if (!(node instanceof Element)) return; if (node.matches('.lux-console-settings-sheet')) injectSettings(node); node.querySelectorAll?.('.lux-console-settings-sheet').forEach(injectSettings); }));
  });
  observer.observe(document.body,{childList:true,subtree:true}); document.querySelectorAll('.lux-console-settings-sheet').forEach(injectSettings);
  lastOrientation = orient(); window.addEventListener('resize', () => { const now=orient(); if(now===lastOrientation)return; lastOrientation=now; baseCache.clear(); if(storedMode()==='custom'&&root()){ draft=editing?readLayout():null; setCustom(false); if(editing){original=clone(readLayout());draft=clone(original);toolbarRefresh();}} }, {passive:true});
  window.LuxMobileCustomControls = { version:VERSION, open:()=>openEditor(document.querySelector('.lux-console-settings-sheet')), get:readLayout, reset:()=>{baseCache.delete(storageKey());const v=saveLayout(captureFrameLayout(true));applyLayout(v);return v;}, groups:available };
  console.info('[Lux Console] Personalizado v2: tela, L/R e Select/Start independentes.');
})();
