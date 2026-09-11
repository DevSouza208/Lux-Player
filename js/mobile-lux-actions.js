(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleActionBarInstalled) return;
  window.__luxConsoleActionBarInstalled = true;

  const VIEW_MODE_KEY = 'lux-play:console-view-mode';
  let mobileActionBusy = false;

  const actions = [
    {
      key: 'save',
      label: 'Salvar',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>'
    },
    {
      key: 'load',
      label: 'Carregar',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h7l2 2h9v10H3z"/><path d="M3 7V5h7l2 2"/></svg>'
    },
    {
      key: 'settings',
      label: 'Config.',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M2 12h3M19 12h3M4.93 19.07l2.12-2.12M16.95 7.05l2.12-2.12"/></svg>'
    },
    {
      key: 'exit',
      label: 'Sair',
      icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 4H5v16h5M14 8l4 4-4 4M18 12H9"/></svg>'
    }
  ];

  const activeGame = () => {
    try { return typeof activeEmulatorGame !== 'undefined' ? activeEmulatorGame : null; }
    catch (_) { return null; }
  };

  const activeUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; }
    catch (_) { return null; }
  };

  const getViewMode = () => {
    try {
      return localStorage.getItem(VIEW_MODE_KEY) === 'fullscreen' ? 'fullscreen' : 'frame';
    } catch (_) {
      return 'frame';
    }
  };

  const persistViewMode = mode => {
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch (_) {}
  };

  const applyViewMode = (mode, persist = true) => {
    const modal = document.getElementById('emulatorModal');
    if (!modal) return;
    const normalized = mode === 'fullscreen' ? 'fullscreen' : 'frame';

    modal.classList.remove('lux-console-view-frame', 'lux-console-view-fullscreen');
    modal.classList.add(normalized === 'fullscreen' ? 'lux-console-view-fullscreen' : 'lux-console-view-frame');
    modal.dataset.luxViewMode = normalized;
    if (persist) persistViewMode(normalized);

    document.querySelectorAll('.lux-console-mode-option').forEach(button => {
      const active = button.dataset.mode === normalized;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  const contextLayer = () => document.getElementById('luxConsoleContextLayer');

  const pauseForContext = () => {
    const context = contextLayer();
    if (!context) return;
    try { window.EJS_emulator?.pause?.(); } catch (_) {}
    try { if (typeof pauseGamePlayTimer === 'function') pauseGamePlayTimer(); } catch (_) {}
    context.dataset.luxPaused = '1';
  };

  const closeContextSheet = ({ resume = true } = {}) => {
    const context = contextLayer();
    if (!context) return;
    const shouldResume = context.dataset.luxPaused === '1';
    context.querySelectorAll('.lux-console-context-sheet, .lux-console-mode-sheet').forEach(node => node.remove());
    context.classList.remove('lux-context-open');
    delete context.dataset.luxPaused;

    if (resume && shouldResume && document.getElementById('emulatorModal')) {
      try { window.EJS_emulator?.resume?.(); } catch (_) {}
      try { if (typeof resumeGamePlayTimer === 'function') resumeGamePlayTimer(); } catch (_) {}
    }
  };

  const openModeSheet = () => {
    const context = contextLayer();
    if (!context) return;

    closeContextSheet({ resume: true });
    context.classList.add('lux-context-open');

    const sheet = document.createElement('div');
    sheet.className = 'lux-console-mode-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Modo de visualização');
    sheet.innerHTML = `
      <div class="lux-console-mode-sheet-head">
        <span class="lux-console-mode-sheet-title">Visual do Lux Console</span>
        <button type="button" class="lux-console-mode-sheet-close" aria-label="Fechar">×</button>
      </div>
      <div class="lux-console-mode-options">
        <button type="button" class="lux-console-mode-option" data-mode="frame" aria-pressed="false">
          <strong>Moldura</strong>
          <span>Tela menor, respiro e identidade Lux.</span>
        </button>
        <button type="button" class="lux-console-mode-option" data-mode="fullscreen" aria-pressed="false">
          <strong>Tela cheia</strong>
          <span>Jogo maior com os controles em overlay.</span>
        </button>
      </div>
    `;

    context.appendChild(sheet);
    applyViewMode(document.getElementById('emulatorModal')?.dataset.luxViewMode || getViewMode(), false);

    sheet.querySelector('.lux-console-mode-sheet-close')?.addEventListener('click', () => closeContextSheet());
    sheet.querySelectorAll('.lux-console-mode-option').forEach(button => {
      button.addEventListener('click', () => {
        applyViewMode(button.dataset.mode);
        closeContextSheet();
      });
    });
  };

  const slotTimestamp = (slots, slot) => {
    try {
      const info = slots?.[slot];
      if (typeof gameSlotDate === 'function') return gameSlotDate(info);
      return Math.max(Date.parse(info?.savedAt || '') || 0, Number(info?.cloudUpdatedAt) || 0);
    } catch (_) {
      return 0;
    }
  };

  const setStatus = (sheet, message, type = '') => {
    const status = sheet?.querySelector('.lux-console-context-status');
    if (!status) return;
    status.className = `lux-console-context-status${type ? ` is-${type}` : ''}`;
    status.textContent = message || '';
  };

  const setSheetBusy = (sheet, busy) => {
    sheet?.querySelectorAll('.lux-console-slot-button, .lux-console-context-close').forEach(button => {
      button.disabled = !!busy;
    });
  };

  const saveCurrentSlot = async (slot, sheet) => {
    const emulator = window.EJS_emulator;
    const game = activeGame();
    const user = activeUser();
    if (mobileActionBusy || !emulator?.gameManager || !game || !user) return false;

    mobileActionBusy = true;
    setSheetBusy(sheet, true);
    let savedLocally = false;

    try {
      setStatus(sheet, `Salvando no slot ${slot}...`);
      emulator.pause?.();
      if (typeof pauseGamePlayTimer === 'function') pauseGamePlayTimer();
      await new Promise(resolve => setTimeout(resolve, 80));

      if (activeGame() !== game || activeUser() !== user) throw new Error('A sessão do jogo mudou.');
      const state = await emulator.gameManager.getState();
      if (!state) throw new Error('O estado do jogo ainda não está pronto.');

      const updatedAt = Date.now();
      const previous = await readLocalGameSave(game, slot, user);
      await writeLocalGameSave(game, slot, state, updatedAt, true, user, previous?.cloudBaseAt ?? null);
      savedLocally = true;

      const record = await readLocalGameSave(game, slot, user);
      const slots = getGameSaveSlots(game);
      slots[slot] = { savedAt: new Date(updatedAt).toISOString() };
      slots.lastSlot = slot;
      localStorage.setItem(getGameSaveKey(game, user), JSON.stringify(slots));

      setStatus(sheet, 'Salvo neste dispositivo. Enviando para sua conta...');
      const result = await uploadLocalGameSave(record, user);
      if (activeGame() !== game || activeUser() !== user) return false;

      if (result?.newerCloud) {
        setStatus(sheet, 'Salvo neste dispositivo. A nuvem tem outro progresso; ao carregar, você poderá escolher qual usar.', 'warning');
      } else {
        setStatus(sheet, `Slot ${slot} salvo com sucesso.`, 'success');
      }
      return true;
    } catch (error) {
      setStatus(
        sheet,
        savedLocally
          ? 'Salvo neste dispositivo. A sincronização com a nuvem ficou pendente.'
          : (error?.message || 'Não foi possível salvar este slot.'),
        savedLocally ? 'warning' : 'error'
      );
      return savedLocally;
    } finally {
      mobileActionBusy = false;
      setSheetBusy(sheet, false);
    }
  };

  const loadCurrentSlot = async (slot, sheet) => {
    const emulator = window.EJS_emulator;
    const game = activeGame();
    const user = activeUser();
    if (mobileActionBusy || !emulator?.gameManager || !game || !user) return false;

    mobileActionBusy = true;
    setSheetBusy(sheet, true);

    try {
      setStatus(sheet, `Carregando slot ${slot}...`);
      let local = await readLocalGameSave(game, slot, user);
      let cloud;

      try {
        cloud = await loadCloudGameSave(game, slot, user);
      } catch (_) {
        if (!local) throw new Error('Não foi possível baixar o save. Confira a conexão e tente novamente.');
      }

      if (activeGame() !== game || activeUser() !== user) throw new Error('A sessão do jogo mudou.');

      if (cloud && local && !(await gameSaveStatesEqual(local.state, cloud.state))) {
        emulator.pause?.();
        if (typeof pauseGamePlayTimer === 'function') pauseGamePlayTimer();
        const choice = await chooseGameSaveSource(local.updatedAt, cloud.updatedAt);
        if (!choice || activeGame() !== game || activeUser() !== user) return false;

        if (choice === 'cloud') {
          local = cloud;
          await writeLocalGameSave(game, slot, cloud.state, cloud.updatedAt, false, user);
        } else {
          local = { ...local, updatedAt: Date.now() };
          await writeLocalGameSave(game, slot, local.state, local.updatedAt, true, user, cloud.updatedAt);
          const result = await uploadLocalGameSave(await readLocalGameSave(game, slot, user), user).catch(() => null);
          if (!result?.saved) setStatus(sheet, 'Usando o save deste dispositivo; sincronização pendente.', 'warning');
        }
      } else if (cloud && local) {
        await writeLocalGameSave(game, slot, local.state, local.updatedAt, false, user, cloud.updatedAt);
      } else if (cloud && !local) {
        local = cloud;
        await writeLocalGameSave(game, slot, cloud.state, cloud.updatedAt, false, user);
      }

      if (!local?.state) throw new Error('O save deste slot não está disponível.');

      const slots = getGameSaveSlots(game);
      slots[slot] = { savedAt: new Date(local.updatedAt).toISOString() };
      slots.lastSlot = slot;
      localStorage.setItem(getGameSaveKey(game, user), JSON.stringify(slots));

      await new Promise(resolve => setTimeout(resolve, 220));
      await emulator.gameManager.loadState(local.state);
      emulator.resume?.();
      if (typeof resumeGamePlayTimer === 'function') resumeGamePlayTimer();
      setStatus(sheet, `Slot ${slot} carregado.`, 'success');
      return true;
    } catch (error) {
      emulator?.pause?.();
      setStatus(sheet, error?.message || 'Não foi possível carregar este slot.', 'error');
      return false;
    } finally {
      mobileActionBusy = false;
      setSheetBusy(sheet, false);
    }
  };

  const fillSlotGrid = (sheet, mode) => {
    const game = activeGame();
    const grid = sheet.querySelector('.lux-console-slot-grid');
    if (!game || !grid) return;
    const slots = getGameSaveSlots(game);

    grid.innerHTML = [1, 2, 3].map(slot => {
      const timestamp = slotTimestamp(slots, slot);
      const empty = !timestamp;
      const meta = empty ? 'Vazio' : new Date(timestamp).toLocaleString('pt-BR');
      return `
        <button type="button" class="lux-console-slot-button" data-slot="${slot}" ${mode === 'load' && empty ? 'disabled' : ''}>
          <span class="lux-console-slot-name">Slot ${slot}</span>
          <span class="lux-console-slot-meta">${meta}</span>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.lux-console-slot-button:not(:disabled)').forEach(button => {
      button.addEventListener('click', async () => {
        const slot = Number(button.dataset.slot);
        if (!slot) return;
        if (mode === 'save') {
          const saved = await saveCurrentSlot(slot, sheet);
          if (saved && document.contains(sheet)) fillSlotGrid(sheet, mode);
          return;
        }

        const loaded = await loadCurrentSlot(slot, sheet);
        if (loaded && document.contains(sheet)) {
          setTimeout(() => closeContextSheet({ resume: false }), 220);
        }
      });
    });
  };

  const openSlotSheet = mode => {
    const context = contextLayer();
    const game = activeGame();
    if (!context || !game || !window.EJS_emulator?.gameManager) return;

    closeContextSheet({ resume: true });
    pauseForContext();
    context.classList.add('lux-context-open');

    const saveMode = mode === 'save';
    const sheet = document.createElement('div');
    sheet.className = 'lux-console-context-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', saveMode ? 'Salvar jogo' : 'Carregar jogo');
    sheet.innerHTML = `
      <div class="lux-console-context-head">
        <div class="lux-console-context-copy">
          <span class="lux-console-context-title">${saveMode ? 'Salvar jogo' : 'Carregar jogo'}</span>
          <span class="lux-console-context-subtitle">${saveMode ? 'Escolha um slot. Você pode sobrescrever um progresso existente.' : 'Escolha o progresso que deseja carregar agora.'}</span>
        </div>
        <button type="button" class="lux-console-context-close" aria-label="Fechar">×</button>
      </div>
      <div class="lux-console-slot-grid"></div>
      <div class="lux-console-context-status" aria-live="polite"></div>
    `;

    context.appendChild(sheet);
    fillSlotGrid(sheet, mode);
    sheet.querySelector('.lux-console-context-close')?.addEventListener('click', () => closeContextSheet());
  };

  const openExitFlow = () => {
    closeContextSheet({ resume: false });
    try { window.EJS_emulator?.pause?.(); } catch (_) {}
    try { if (typeof pauseGamePlayTimer === 'function') pauseGamePlayTimer(); } catch (_) {}

    if (typeof requestCloseGameEmulator === 'function') requestCloseGameEmulator();
    else if (typeof closeGameEmulator === 'function') closeGameEmulator();
  };

  const bindActionButton = (bar, key, handler, label) => {
    const button = bar?.querySelector(`.lux-console-action-${key}`);
    if (!button || button.dataset.luxBound === '1') return;
    button.dataset.luxBound = '1';
    button.disabled = false;
    button.tabIndex = 0;
    button.removeAttribute('aria-hidden');
    button.setAttribute('aria-label', label);
    button.addEventListener('click', handler);
  };

  const bindActionButtons = bar => {
    bindActionButton(bar, 'save', () => openSlotSheet('save'), 'Salvar jogo');
    bindActionButton(bar, 'load', () => openSlotSheet('load'), 'Carregar jogo');
    bindActionButton(bar, 'settings', openModeSheet, 'Configurar visual do Lux Console');
    bindActionButton(bar, 'exit', openExitFlow, 'Sair do jogo');
  };

  const ensureActionBar = () => {
    const controlsLayer = document.getElementById('luxConsoleControlsLayer');
    if (!controlsLayer) return false;

    let bar = document.getElementById('luxConsoleActionBar');
    if (!bar || bar.parentElement !== controlsLayer) {
      bar?.remove();
      bar = document.createElement('div');
      bar.id = 'luxConsoleActionBar';
      bar.className = 'lux-console-actionbar';
      bar.setAttribute('aria-label', 'Ações do Lux Console');
      bar.innerHTML = actions.map(action => `
        <button type="button" class="lux-console-action-button lux-console-action-${action.key}" aria-label="${action.label}">
          <span class="lux-console-action-icon">${action.icon}</span>
          <span class="lux-console-action-label">${action.label}</span>
        </button>
      `).join('');
      controlsLayer.appendChild(bar);
    }

    bindActionButtons(bar);

    const modal = document.getElementById('emulatorModal');
    if (modal && !modal.classList.contains('lux-console-view-frame') && !modal.classList.contains('lux-console-view-fullscreen')) {
      applyViewMode(getViewMode(), false);
    }
    return true;
  };

  document.addEventListener('click', event => {
    if (event.target?.id === 'luxConsoleContextLayer') closeContextSheet();
  });

  const observer = new MutationObserver(() => {
    ensureActionBar();
    if (!document.getElementById('emulatorModal')) closeContextSheet({ resume: false });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ensureActionBar();
})();
