(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxMobileEmulatorPolishV3) return;
  window.__luxMobileEmulatorPolishV3 = true;

  const RETROPAD = { B:0, Y:1, SELECT:2, START:3, UP:4, DOWN:5, LEFT:6, RIGHT:7, A:8, X:9, L:10, R:11 };
  const $ = id => document.getElementById(id);
  const modal = () => $('emulatorModal');
  const container = () => $('emulatorContainer');
  const luxMenu = () => document.querySelector('.lux-mobile-game-menu');
  let observer = null;

  function getLayout() {
    const type = String(typeof activeEmulatorGame !== 'undefined' ? activeEmulatorGame?.console || '' : '').toLowerCase();
    if (type === 'megadrive' || type === 'genesis') return 'megadrive';
    if (type === 'n64') return 'n64';
    return 'retro';
  }

  function inputIndex(input) {
    const layout = getLayout();
    if (layout === 'megadrive') {
      const map = { A:1, B:0, SELECT:2, START:3, UP:4, DOWN:5, LEFT:6, RIGHT:7, L:10, R:11 };
      return map[input];
    }
    if (layout === 'n64') {
      const map = { A:0, B:1, SELECT:2, START:3, UP:4, DOWN:5, LEFT:6, RIGHT:7, L:10, R:11 };
      return map[input];
    }
    return RETROPAD[input];
  }

  function sendInput(input, pressed) {
    const manager = window.EJS_emulator?.gameManager;
    const index = inputIndex(input);
    if (!manager || typeof manager.simulateInput !== 'function' || typeof index !== 'number') return;
    try { manager.simulateInput(0, index, pressed ? 1 : 0); } catch (_) {}
  }

  function bindPadButton(button) {
    if (!button || button.dataset.luxBound === '1') return;
    button.dataset.luxBound = '1';
    const input = button.dataset.input;
    const down = event => { event.preventDefault(); sendInput(input, true); };
    const up = event => { event.preventDefault(); sendInput(input, false); };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', event => { if (event.buttons) up(event); });
    button.addEventListener('contextmenu', event => event.preventDefault());
  }

  function ensureLuxPad() {
    const host = modal();
    if (!host || $('luxMobilePadOverlay')) return;
    const pad = document.createElement('div');
    pad.id = 'luxMobilePadOverlay';
    pad.className = 'lux-mobile-pad-overlay';
    pad.innerHTML = `
      <button class="lux-pad shoulder left" data-input="L">L</button>
      <button class="lux-pad shoulder right" data-input="R">R</button>
      <div class="lux-pad-dpad">
        <button class="lux-pad up" data-input="UP">▲</button>
        <button class="lux-pad left" data-input="LEFT">◀</button>
        <button class="lux-pad right" data-input="RIGHT">▶</button>
        <button class="lux-pad down" data-input="DOWN">▼</button>
      </div>
      <div class="lux-pad-actions">
        <button class="lux-pad b" data-input="B">B</button>
        <button class="lux-pad a" data-input="A">A</button>
      </div>
      <div class="lux-pad-center">
        <button class="lux-pad small" data-input="SELECT">Select</button>
        <button class="lux-pad small" data-input="START">Start</button>
      </div>`;
    host.appendChild(pad);
    pad.querySelectorAll('[data-input]').forEach(bindPadButton);
  }

  function deepElements(root) {
    const out = [];
    const visit = node => {
      if (!node?.querySelectorAll) return;
      node.querySelectorAll('*').forEach(el => {
        out.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
        if (el.tagName === 'IFRAME') { try { visit(el.contentDocument); } catch (_) {} }
      });
    };
    visit(root);
    return out;
  }

  function hideNativeChrome() {
    const root = container();
    if (!root) return;
    root.querySelectorAll('canvas,video').forEach(surface => surface.classList.add('lux-mobile-game-surface'));

    // Important: do NOT hide every EmulatorJS button. iOS uses a native
    // "Click to resume Emulator" control to unlock audio/game execution.
    // Hide only the chrome/touch controls that Lux replaces.
    deepElements(root).forEach(el => {
      if (!el?.classList) return;
      const text = String(el.textContent || '').trim();
      const meta = `${el.title || ''} ${el.getAttribute?.('aria-label') || ''} ${text}`.trim();
      const isButton = el.tagName === 'BUTTON' || el.getAttribute?.('role') === 'button' || el.classList.contains('ejs_menu_button');
      if (!isButton) return;

      const nativeTouch = /^(ESQ|DIR|L|R|A|B|Select|Start|Rápido|Rapido|Lento|▲|▼|◀|▶|↑|↓|←|→)$/i.test(text);
      const nativeMenu = el.classList.contains('ejs_menu_button') || /^☰$/.test(text) || /context\s*menu|menu\s*button/i.test(meta);
      const nativeSpeed = /fast\s*forward|slow\s*motion|rápido|rapido|lento/i.test(meta);
      if (nativeTouch || nativeMenu || nativeSpeed) el.classList.add('lux-native-hidden');
    });
  }

  function closeLuxMenu() {
    const menu = luxMenu();
    if (menu) menu.hidden = true;
    document.body.classList.remove('lux-mobile-overlay-open');
  }

  function ensureSlotSheet() {
    let sheet = $('luxGameSlotSheet');
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = 'luxGameSlotSheet';
    sheet.className = 'lux-game-slot-sheet';
    sheet.hidden = true;
    sheet.innerHTML = `<div class="lux-game-slot-card"><div class="lux-game-slot-head"><strong id="luxGameSlotTitle">Slots</strong><button id="luxGameSlotClose">✕</button></div><div id="luxGameSlotButtons" class="lux-game-slot-buttons"></div><div id="luxGameSlotStatus" class="lux-game-slot-status"></div></div>`;
    document.body.appendChild(sheet);
    $('luxGameSlotClose').onclick = () => { sheet.hidden = true; document.body.classList.remove('lux-mobile-overlay-open'); window.EJS_emulator?.resume?.(); try { resumeGamePlayTimer?.(); } catch (_) {} };
    return sheet;
  }

  function slotLabel(slot, slots) {
    const date = typeof gameSlotDate === 'function' ? gameSlotDate(slots?.[slot]) : 0;
    return date ? new Date(date).toLocaleString('pt-BR') : 'Vazio';
  }

  function openSlotSheet(mode) {
    closeLuxMenu();
    const sheet = ensureSlotSheet();
    const game = typeof activeEmulatorGame !== 'undefined' ? activeEmulatorGame : null;
    const slots = game && typeof getGameSaveSlots === 'function' ? getGameSaveSlots(game) : {};
    $('luxGameSlotTitle').textContent = mode === 'save' ? 'Salvar jogo' : 'Carregar jogo';
    $('luxGameSlotStatus').textContent = '';
    $('luxGameSlotButtons').innerHTML = [1,2,3].map(slot => `<button data-slot="${slot}"><strong>Slot ${slot}</strong><span>${slotLabel(slot, slots)}</span></button>`).join('');
    $('luxGameSlotButtons').querySelectorAll('button').forEach(button => {
      button.onclick = () => mode === 'save' ? saveSlot(Number(button.dataset.slot)) : loadSlot(Number(button.dataset.slot));
    });
    try { window.EJS_emulator?.pause?.(); pauseGamePlayTimer?.(); } catch (_) {}
    sheet.hidden = false;
    document.body.classList.add('lux-mobile-overlay-open');
  }

  async function saveSlot(slot) {
    const status = $('luxGameSlotStatus');
    const emulator = window.EJS_emulator;
    const game = typeof activeEmulatorGame !== 'undefined' ? activeEmulatorGame : null;
    const user = typeof currentUser !== 'undefined' ? currentUser : null;
    if (!emulator?.gameManager || !game || !user) { status.textContent = 'O jogo ainda não está pronto.'; return; }
    try {
      status.textContent = `Salvando no slot ${slot}...`;
      emulator.pause?.();
      const state = await emulator.gameManager.getState();
      if (!state) throw new Error('Estado indisponível.');
      const updatedAt = Date.now();
      const previous = typeof readLocalGameSave === 'function' ? await readLocalGameSave(game, slot, user) : null;
      if (typeof writeLocalGameSave !== 'function') throw new Error('Armazenamento indisponível.');
      await writeLocalGameSave(game, slot, state, updatedAt, true, user, previous?.cloudBaseAt ?? null);
      if (typeof getGameSaveSlots === 'function' && typeof getGameSaveKey === 'function') {
        const slots = getGameSaveSlots(game); slots[slot] = { savedAt: new Date(updatedAt).toISOString() }; slots.lastSlot = slot;
        localStorage.setItem(getGameSaveKey(game, user), JSON.stringify(slots));
      }
      status.textContent = `Salvo no slot ${slot}.`;
      setTimeout(() => { const sheet=$('luxGameSlotSheet'); if(sheet) sheet.hidden=true; document.body.classList.remove('lux-mobile-overlay-open'); emulator.resume?.(); try{resumeGamePlayTimer?.();}catch(_){} }, 650);
    } catch (error) { status.textContent = error?.message || 'Não foi possível salvar.'; }
  }

  async function loadSlot(slot) {
    const status = $('luxGameSlotStatus');
    const emulator = window.EJS_emulator;
    const game = typeof activeEmulatorGame !== 'undefined' ? activeEmulatorGame : null;
    const user = typeof currentUser !== 'undefined' ? currentUser : null;
    if (!emulator?.gameManager || !game || !user) { status.textContent = 'O jogo ainda não está pronto.'; return; }
    try {
      status.textContent = `Carregando slot ${slot}...`;
      let record = typeof readLocalGameSave === 'function' ? await readLocalGameSave(game, slot, user) : null;
      if (!record?.state && typeof loadCloudGameSave === 'function') record = await loadCloudGameSave(game, slot, user);
      if (!record?.state) throw new Error('Este slot está vazio.');
      await emulator.gameManager.loadState(record.state);
      const sheet=$('luxGameSlotSheet'); if(sheet) sheet.hidden=true;
      document.body.classList.remove('lux-mobile-overlay-open');
      emulator.resume?.(); try { resumeGamePlayTimer?.(); } catch (_) {}
    } catch (error) { status.textContent = error?.message || 'Não foi possível carregar.'; }
  }

  function nativeClick(patterns) {
    const root = container();
    if (!root) return false;
    const list = deepElements(root);
    for (const pattern of patterns) {
      const target = list.find(el => pattern.test(`${el.title||''} ${el.getAttribute?.('aria-label')||''} ${el.textContent||''}`));
      if (target) { try { target.click(); return true; } catch (_) {} }
    }
    return false;
  }

  function openNativePanel(type) {
    closeLuxMenu();
    const settingsPatterns = [/settings/i,/configura/i,/ajustes/i,/controls?/i,/controles?/i];
    const cheatPatterns = [/cheat/i,/trapaç/i];
    if (nativeClick(type === 'cheats' ? cheatPatterns : settingsPatterns)) return;
    const menuPatterns = [/menu/i,/☰/i,/context menu/i];
    if (nativeClick(menuPatterns)) setTimeout(() => nativeClick(type === 'cheats' ? cheatPatterns : settingsPatterns), 120);
    else alert(type === 'cheats' ? 'Este núcleo não disponibilizou trapaças.' : 'As configurações ainda não estão disponíveis.');
  }

  function polishLuxMenu() {
    const actions = document.querySelector('.lux-mobile-game-menu .lux-mobile-game-actions');
    if (!actions || actions.dataset.luxV3 === '1') return;
    actions.dataset.luxV3 = '1';
    actions.innerHTML = `
      <button type="button" class="primary" data-game-action="resume"><i data-lucide="play"></i> Continuar</button>
      <button type="button" data-lux-action="save"><i data-lucide="save"></i> Salvar jogo</button>
      <button type="button" data-lux-action="load"><i data-lucide="folder-open"></i> Carregar jogo</button>
      <button type="button" data-game-action="fast"><i data-lucide="fast-forward"></i> <span>Fast-forward</span></button>
      <button type="button" data-lux-action="cheats"><i data-lucide="sparkles"></i> Trapaças</button>
      <button type="button" data-lux-action="settings"><i data-lucide="settings"></i> Configurações</button>
      <button type="button" data-lux-action="reset"><i data-lucide="rotate-ccw"></i> Reiniciar</button>
      <button type="button" class="danger" data-game-action="save-exit"><i data-lucide="save"></i> Salvar / Sair</button>`;
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-lux-action]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    const action = button.dataset.luxAction;
    if (action === 'save') return openSlotSheet('save');
    if (action === 'load') return openSlotSheet('load');
    if (action === 'settings') return openNativePanel('settings');
    if (action === 'cheats') return openNativePanel('cheats');
    if (action === 'reset') { closeLuxMenu(); if (!nativeClick([/^reset$/i,/reiniciar/i])) { try { window.EJS_emulator?.gameManager?.restart?.(); } catch (_) {} } }
  }, true);

  function attach() {
    if (!modal() || !container()) return;
    ensureLuxPad();
    hideNativeChrome();
    polishLuxMenu();
    observer?.disconnect();
    observer = new MutationObserver(() => { hideNativeChrome(); polishLuxMenu(); });
    observer.observe(container(), { childList:true, subtree:true });
  }

  new MutationObserver(() => {
    if (modal()) attach();
    else { observer?.disconnect(); observer=null; $('luxGameSlotSheet')?.remove(); }
  }).observe(document.body, { childList:true, subtree:true });

  window.addEventListener('orientationchange', () => setTimeout(attach, 180));
  window.addEventListener('resize', () => setTimeout(attach, 100));
  attach();
})();
