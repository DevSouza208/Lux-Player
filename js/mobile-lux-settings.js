(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleSettingsInstalled) return;
  window.__luxConsoleSettingsInstalled = true;

  const VIEW_MODE_KEY = 'lux-play:console-view-mode';
  const SPEED_KEY = 'lux-play:console-speed';
  let contextWasOpen = false;
  let lastEmulator = null;

  const contextLayer = () => document.getElementById('luxConsoleContextLayer');

  const activeGame = () => {
    try { return typeof activeEmulatorGame !== 'undefined' ? activeEmulatorGame : null; }
    catch (_) { return null; }
  };

  const activeUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; }
    catch (_) { return null; }
  };

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const getViewMode = () => {
    try { return localStorage.getItem(VIEW_MODE_KEY) === 'fullscreen' ? 'fullscreen' : 'frame'; }
    catch (_) { return 'frame'; }
  };

  const setViewMode = mode => {
    const normalized = mode === 'fullscreen' ? 'fullscreen' : 'frame';
    const modal = document.getElementById('emulatorModal');
    if (modal) {
      modal.classList.remove('lux-console-view-frame', 'lux-console-view-fullscreen');
      modal.classList.add(normalized === 'fullscreen' ? 'lux-console-view-fullscreen' : 'lux-console-view-frame');
      modal.dataset.luxViewMode = normalized;
    }
    try { localStorage.setItem(VIEW_MODE_KEY, normalized); } catch (_) {}
    return normalized;
  };

  const getSpeedMode = () => {
    try { return localStorage.getItem(SPEED_KEY) === '2x' ? '2x' : '1x'; }
    catch (_) { return '1x'; }
  };

  const setSpeedMode = mode => {
    const normalized = mode === '2x' ? '2x' : '1x';
    try { localStorage.setItem(SPEED_KEY, normalized); } catch (_) {}

    const emulator = window.EJS_emulator;
    const manager = emulator?.gameManager;
    if (!manager) return normalized;

    try { manager.toggleSlowMotion?.(0); } catch (_) {}
    try { if (emulator) emulator.isSlowMotion = false; } catch (_) {}

    if (normalized === '2x') {
      try { manager.setFastForwardRatio?.(2); } catch (_) {}
      try { manager.toggleFastForward?.(1); } catch (_) {}
      try { emulator.isFastForward = true; } catch (_) {}
      try { if (typeof emulatorFastForward !== 'undefined') emulatorFastForward = true; } catch (_) {}
    } else {
      try { manager.toggleFastForward?.(0); } catch (_) {}
      try { emulator.isFastForward = false; } catch (_) {}
      try { if (typeof emulatorFastForward !== 'undefined') emulatorFastForward = false; } catch (_) {}
    }

    return normalized;
  };

  const gameIdentity = () => {
    const game = activeGame();
    if (!game) return 'unknown';
    try {
      if (typeof getCloudGameSaveKey === 'function') return getCloudGameSaveKey(game);
    } catch (_) {}
    return game.id || game.url || game.name || 'unknown';
  };

  const cheatStorageKey = () => {
    const user = activeUser();
    const userId = encodeURIComponent(user?.user || 'guest');
    let profile = '';
    try { if (typeof profileLocalSuffix === 'function') profile = profileLocalSuffix(user) || ''; } catch (_) {}
    return `lux-play:mobile-cheats:${userId}${profile}:${encodeURIComponent(gameIdentity())}`;
  };

  const readCheats = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(cheatStorageKey()) || '{}');
      return {
        enabled: parsed.enabled !== false,
        items: Array.isArray(parsed.items) ? parsed.items.filter(item => item?.code).map(item => ({
          id: String(item.id || `${Date.now()}-${Math.random()}`),
          name: String(item.name || 'Cheat'),
          code: String(item.code || ''),
          enabled: item.enabled !== false
        })) : []
      };
    } catch (_) {
      return { enabled: true, items: [] };
    }
  };

  const writeCheats = state => {
    try { localStorage.setItem(cheatStorageKey(), JSON.stringify(state)); } catch (_) {}
  };

  const applyCheats = () => {
    const manager = window.EJS_emulator?.gameManager;
    if (!manager || typeof manager.resetCheat !== 'function' || typeof manager.setCheat !== 'function') return false;
    const state = readCheats();

    try { manager.resetCheat(); }
    catch (_) { return false; }

    if (!state.enabled) return true;
    state.items.forEach((item, index) => {
      try { manager.setCheat(index, item.enabled ? 1 : 0, item.code); }
      catch (error) { console.warn('Lux Console: cheat não pôde ser aplicado.', error); }
    });
    return true;
  };

  const pauseEmulatorForMenu = () => {
    const emulator = window.EJS_emulator;
    const manager = emulator?.gameManager;
    if (!emulator || !manager) return;

    try {
      if (emulator.paused === false && typeof emulator.togglePlaying === 'function') emulator.togglePlaying(true);
      else manager.toggleMainLoop?.(0);
      emulator.paused = true;
    } catch (_) {
      try { manager.toggleMainLoop?.(0); } catch (_) {}
    }
    try { if (typeof pauseGamePlayTimer === 'function') pauseGamePlayTimer(); } catch (_) {}
  };

  const forceResumeGame = () => {
    const emulator = window.EJS_emulator;
    const manager = emulator?.gameManager;
    if (!document.getElementById('emulatorModal') || !emulator || !manager) return;

    try {
      if (emulator.paused === true && typeof emulator.togglePlaying === 'function') {
        emulator.togglePlaying(true);
      } else {
        manager.toggleMainLoop?.(1);
        emulator.paused = false;
      }
    } catch (_) {
      try { manager.toggleMainLoop?.(1); } catch (_) {}
      try { emulator.paused = false; } catch (_) {}
    }

    try { if (typeof resumeGamePlayTimer === 'function') resumeGamePlayTimer(); } catch (_) {}
  };

  const closeSettingsLayer = ({ resume = true } = {}) => {
    const context = contextLayer();
    if (!context) return;
    context.querySelectorAll('.lux-console-settings-sheet, .lux-console-cheats-sheet').forEach(node => node.remove());
    context.classList.remove('lux-context-open');
    if (resume) setTimeout(forceResumeGame, 0);
  };

  const updateSegment = (sheet, selector, value) => {
    sheet?.querySelectorAll(selector).forEach(button => {
      const active = button.dataset.value === value;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  const openSettingsSheet = () => {
    const context = contextLayer();
    if (!context || !document.getElementById('emulatorModal')) return;

    context.querySelectorAll('.lux-console-context-sheet, .lux-console-mode-sheet, .lux-console-settings-sheet, .lux-console-cheats-sheet').forEach(node => node.remove());
    pauseEmulatorForMenu();
    context.classList.add('lux-context-open');

    const sheet = document.createElement('div');
    sheet.className = 'lux-console-context-sheet lux-console-settings-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Configurações do Lux Console');

    const cheatState = readCheats();
    sheet.innerHTML = `
      <div class="lux-console-context-head">
        <div class="lux-console-context-copy">
          <span class="lux-console-context-title">Configurações</span>
          <span class="lux-console-context-subtitle">Ajustes rápidos do jogo atual.</span>
        </div>
        <button type="button" class="lux-console-context-close" aria-label="Fechar">×</button>
      </div>

      <div class="lux-setting-group">
        <div class="lux-setting-card">
          <span class="lux-setting-label">Velocidade</span>
          <div class="lux-segmented lux-speed-selector">
            <button type="button" data-value="1x" aria-pressed="false">1x Normal</button>
            <button type="button" data-value="2x" aria-pressed="false">2x Fast Forward</button>
          </div>
        </div>

        <div class="lux-setting-card">
          <span class="lux-setting-label">Layout</span>
          <div class="lux-segmented lux-layout-selector">
            <button type="button" data-value="frame" aria-pressed="false">Moldura</button>
            <button type="button" data-value="fullscreen" aria-pressed="false">Tela cheia</button>
          </div>
        </div>

        <button type="button" class="lux-setting-row lux-cheats-open">
          <span><strong>Cheats</strong><small>Adicionar, ativar ou remover códigos.</small></span>
          <span class="lux-setting-row-side"><span>${cheatState.enabled ? 'Ligado' : 'Desligado'}</span><span>›</span></span>
        </button>
      </div>
    `;

    context.appendChild(sheet);
    updateSegment(sheet, '.lux-speed-selector button', getSpeedMode());
    updateSegment(sheet, '.lux-layout-selector button', getViewMode());

    sheet.querySelector('.lux-console-context-close')?.addEventListener('click', () => closeSettingsLayer());

    sheet.querySelectorAll('.lux-speed-selector button').forEach(button => {
      button.addEventListener('click', () => {
        const value = setSpeedMode(button.dataset.value);
        updateSegment(sheet, '.lux-speed-selector button', value);
      });
    });

    sheet.querySelectorAll('.lux-layout-selector button').forEach(button => {
      button.addEventListener('click', () => {
        const value = setViewMode(button.dataset.value);
        updateSegment(sheet, '.lux-layout-selector button', value);
      });
    });

    sheet.querySelector('.lux-cheats-open')?.addEventListener('click', openCheatsSheet);
  };

  const renderCheatList = sheet => {
    const state = readCheats();
    const list = sheet.querySelector('.lux-cheat-list');
    const masterLabel = sheet.querySelector('.lux-cheat-master-label');
    const masterToggle = sheet.querySelector('.lux-cheat-master-toggle');
    if (!list) return;

    if (masterLabel) masterLabel.textContent = state.enabled ? 'Ligado' : 'Desligado';
    masterToggle?.classList.toggle('is-on', state.enabled);

    if (!state.items.length) {
      list.innerHTML = '<div class="lux-cheat-empty">Nenhum cheat adicionado para este jogo.</div>';
      return;
    }

    list.innerHTML = state.items.map(item => `
      <div class="lux-cheat-item" data-id="${escapeHtml(item.id)}">
        <span><strong>${escapeHtml(item.name || 'Cheat')}</strong><code>${escapeHtml(item.code)}</code></span>
        <button type="button" class="lux-cheat-switch" aria-label="${item.enabled ? 'Desativar' : 'Ativar'} ${escapeHtml(item.name || 'cheat')}"><span class="lux-toggle ${item.enabled ? 'is-on' : ''}"></span></button>
        <button type="button" class="lux-cheat-delete" aria-label="Remover ${escapeHtml(item.name || 'cheat')}">×</button>
      </div>
    `).join('');

    list.querySelectorAll('.lux-cheat-switch').forEach(button => {
      button.addEventListener('click', () => {
        const row = button.closest('.lux-cheat-item');
        const next = readCheats();
        const item = next.items.find(entry => entry.id === row?.dataset.id);
        if (!item) return;
        item.enabled = !item.enabled;
        writeCheats(next);
        applyCheats();
        renderCheatList(sheet);
      });
    });

    list.querySelectorAll('.lux-cheat-delete').forEach(button => {
      button.addEventListener('click', () => {
        const row = button.closest('.lux-cheat-item');
        const next = readCheats();
        next.items = next.items.filter(entry => entry.id !== row?.dataset.id);
        writeCheats(next);
        applyCheats();
        renderCheatList(sheet);
      });
    });
  };

  function openCheatsSheet() {
    const context = contextLayer();
    if (!context) return;
    context.querySelectorAll('.lux-console-settings-sheet, .lux-console-cheats-sheet').forEach(node => node.remove());
    context.classList.add('lux-context-open');

    const state = readCheats();
    const sheet = document.createElement('div');
    sheet.className = 'lux-console-context-sheet lux-console-cheats-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Cheats do jogo');
    sheet.innerHTML = `
      <div class="lux-console-context-head">
        <div class="lux-console-context-copy">
          <button type="button" class="lux-cheat-back">‹ Configurações</button>
          <span class="lux-console-context-title">Cheats</span>
          <span class="lux-console-context-subtitle">Os formatos de código aceitos dependem do console e do core do jogo.</span>
        </div>
        <button type="button" class="lux-console-context-close" aria-label="Fechar">×</button>
      </div>

      <button type="button" class="lux-setting-row lux-cheat-master-row">
        <span><strong>Cheats deste jogo</strong><small>Ativa ou desativa todos de uma vez.</small></span>
        <span class="lux-setting-row-side"><span class="lux-cheat-master-label">${state.enabled ? 'Ligado' : 'Desligado'}</span><span class="lux-toggle lux-cheat-master-toggle ${state.enabled ? 'is-on' : ''}"></span></span>
      </button>

      <div class="lux-cheat-form">
        <input class="lux-cheat-input" type="text" maxlength="60" placeholder="Nome do cheat (opcional)">
        <textarea class="lux-cheat-code" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="Cole o código do cheat"></textarea>
        <button type="button" class="lux-cheat-add">Adicionar cheat</button>
      </div>

      <div class="lux-cheat-list"></div>
      <div class="lux-cheat-note">Alguns cheats podem exigir reiniciar o jogo para serem totalmente desativados.</div>
    `;

    context.appendChild(sheet);
    renderCheatList(sheet);

    sheet.querySelector('.lux-console-context-close')?.addEventListener('click', () => closeSettingsLayer());
    sheet.querySelector('.lux-cheat-back')?.addEventListener('click', openSettingsSheet);
    sheet.querySelector('.lux-cheat-master-row')?.addEventListener('click', () => {
      const next = readCheats();
      next.enabled = !next.enabled;
      writeCheats(next);
      applyCheats();
      renderCheatList(sheet);
    });

    sheet.querySelector('.lux-cheat-add')?.addEventListener('click', () => {
      const nameInput = sheet.querySelector('.lux-cheat-input');
      const codeInput = sheet.querySelector('.lux-cheat-code');
      const code = String(codeInput?.value || '').trim();
      if (!code) {
        codeInput?.focus();
        return;
      }

      const next = readCheats();
      next.items.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: String(nameInput?.value || '').trim() || `Cheat ${next.items.length + 1}`,
        code,
        enabled: true
      });
      writeCheats(next);
      applyCheats();
      if (nameInput) nameInput.value = '';
      if (codeInput) codeInput.value = '';
      renderCheatList(sheet);
    });
  }

  /* Replace only the Config action. Save/Load/Exit keep their tested handlers. */
  document.addEventListener('click', event => {
    const settings = event.target?.closest?.('.lux-console-action-settings');
    if (!settings) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    openSettingsSheet();
  }, true);

  /* Guarantee resume when a Lux context menu closes, including Save/Load menus. */
  const resumeObserver = new MutationObserver(() => {
    const context = contextLayer();
    const open = !!context?.classList.contains('lux-context-open');
    const saveExit = document.getElementById('saveExitModal');
    const saveExitVisible = !!saveExit && !saveExit.classList.contains('hidden');

    if (contextWasOpen && !open && document.getElementById('emulatorModal') && !saveExitVisible) {
      setTimeout(forceResumeGame, 0);
    }
    contextWasOpen = open;
  });
  resumeObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

  /* Apply persisted speed and cheats to each fresh EmulatorJS instance. */
  const readyTimer = setInterval(() => {
    const emulator = window.EJS_emulator;
    if (!document.getElementById('emulatorModal') || !emulator?.gameManager) {
      lastEmulator = null;
      return;
    }
    if (lastEmulator === emulator) return;
    lastEmulator = emulator;
    setTimeout(() => {
      setSpeedMode(getSpeedMode());
      applyCheats();
    }, 180);
  }, 250);

  window.addEventListener('beforeunload', () => clearInterval(readyTimer), { once: true });
})();