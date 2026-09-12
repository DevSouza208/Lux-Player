(() => {
  'use strict';

  const MOBILE_MEDIA = '(max-width: 767px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px) and (pointer: coarse)';
  if (!window.matchMedia(MOBILE_MEDIA).matches || window.__luxMobileCustomControlsInstalled) return;
  window.__luxMobileCustomControlsInstalled = true;

  const VIEW_MODE_KEY = 'lux-play:console-view-mode';
  const LAYOUT_PREFIX = 'lux-play:custom-controls';
  const MIN_SCALE = 0.60;
  const MAX_SCALE = 1.40;

  const GROUPS = {
    dpad: { selector: '.lux-console-dpad', label: 'Direcional' },
    face: { selector: '.lux-console-face', label: 'A / B' },
    shoulders: { selector: '.lux-console-shoulders', label: 'L / R' },
    system: { selector: '.lux-console-system-buttons', label: 'Start / Select' }
  };

  let editing = false;
  let selectedGroup = 'dpad';
  let workingLayout = null;
  let originalLayout = null;
  let dragState = null;
  let lastOrientation = '';

  const modal = () => document.getElementById('emulatorModal');
  const contextLayer = () => document.getElementById('luxConsoleContextLayer');
  const orientation = () => window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';

  const currentSystem = () => {
    const root = modal();
    const className = [...(root?.classList || [])].find(name => name.startsWith('lux-console-system-'));
    if (className) return className.replace('lux-console-system-', '') || 'gba';
    try {
      if (typeof activeEmulatorGame !== 'undefined' && activeEmulatorGame?.console) {
        return String(activeEmulatorGame.console).toLowerCase().replaceAll(' ', '');
      }
    } catch (_) {}
    return 'gba';
  };

  const layoutKey = () => `${LAYOUT_PREFIX}:${orientation()}:${currentSystem()}`;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
  const cloneLayout = value => JSON.parse(JSON.stringify(value));

  const defaultLayout = () => {
    const landscape = orientation() === 'landscape';
    const compact = Math.min(window.innerWidth, window.innerHeight) <= 375 || (landscape && window.innerHeight <= 360);
    const base = compact ? 0.80 : 1;

    if (landscape) {
      return {
        dpad: { x: 3, y: 34, scale: base },
        face: { x: compact ? 77 : 80, y: 34, scale: base },
        shoulders: { x: 29, y: 5, scale: compact ? 0.76 : 0.88 },
        system: { x: 36, y: compact ? 80 : 84, scale: compact ? 0.76 : 0.88 }
      };
    }

    return {
      dpad: { x: 5, y: compact ? 58 : 61, scale: base },
      face: { x: compact ? 58 : 61, y: compact ? 58 : 61, scale: base },
      shoulders: { x: 16, y: compact ? 48 : 50, scale: compact ? 0.78 : 0.90 },
      system: { x: 27, y: compact ? 84 : 87, scale: compact ? 0.78 : 0.90 }
    };
  };

  const normalizeLayout = value => {
    const defaults = defaultLayout();
    const normalized = {};
    Object.keys(GROUPS).forEach(key => {
      const source = value?.[key] || defaults[key];
      normalized[key] = {
        x: clamp(source.x, 0, 94),
        y: clamp(source.y, 0, 94),
        scale: clamp(source.scale, MIN_SCALE, MAX_SCALE)
      };
    });
    return normalized;
  };

  const readLayout = () => {
    try {
      const saved = localStorage.getItem(layoutKey());
      return saved ? normalizeLayout(JSON.parse(saved)) : defaultLayout();
    } catch (_) {
      return defaultLayout();
    }
  };

  const saveLayout = value => {
    const normalized = normalizeLayout(value);
    try { localStorage.setItem(layoutKey(), JSON.stringify(normalized)); } catch (_) {}
    return normalized;
  };

  const applyLayout = value => {
    const root = modal();
    if (!root) return;
    const layout = normalizeLayout(value || readLayout());
    Object.entries(layout).forEach(([key, config]) => {
      root.style.setProperty(`--lux-custom-${key}-x`, `${config.x}vw`);
      root.style.setProperty(`--lux-custom-${key}-y`, `${config.y}dvh`);
      root.style.setProperty(`--lux-custom-${key}-scale`, String(config.scale));
    });
  };

  const storedMode = () => {
    try { return localStorage.getItem(VIEW_MODE_KEY) || 'frame'; }
    catch (_) { return 'frame'; }
  };

  const setStoredMode = mode => {
    try { localStorage.setItem(VIEW_MODE_KEY, mode); } catch (_) {}
  };

  const applyCustomMode = (persist = true) => {
    const root = modal();
    if (!root) return;
    root.classList.remove('lux-console-view-fullscreen');
    root.classList.add('lux-console-view-frame', 'lux-console-view-custom');
    root.dataset.luxViewMode = 'custom';
    if (persist) setStoredMode('custom');
    applyLayout(editing && workingLayout ? workingLayout : readLayout());
  };

  const leaveCustomMode = () => {
    modal()?.classList.remove('lux-console-view-custom', 'lux-controls-editing');
  };

  const updateSettingsUi = sheet => {
    if (!sheet) return;
    const custom = storedMode() === 'custom';
    sheet.querySelectorAll('.lux-layout-selector button').forEach(button => {
      const active = custom ? button.dataset.value === 'custom' : button.dataset.value === (modal()?.dataset.luxViewMode || storedMode());
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    sheet.querySelector('.lux-custom-controls-edit')?.classList.toggle('hidden', !custom);
  };

  const injectSettings = sheet => {
    if (!sheet || sheet.dataset.luxCustomControlsReady === '1') return;
    const selector = sheet.querySelector('.lux-layout-selector');
    const group = sheet.querySelector('.lux-setting-group');
    if (!selector || !group) return;
    sheet.dataset.luxCustomControlsReady = '1';

    selector.classList.add('lux-layout-selector-3');
    const customButton = document.createElement('button');
    customButton.type = 'button';
    customButton.dataset.value = 'custom';
    customButton.setAttribute('aria-pressed', 'false');
    customButton.textContent = 'Personalizado';
    selector.appendChild(customButton);

    const layoutCard = selector.closest('.lux-setting-card');
    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'lux-setting-row lux-custom-controls-edit hidden';
    editButton.innerHTML = '<span><strong>Editar controles</strong><small>Arraste os blocos e ajuste o tamanho para este aparelho.</small></span><span class="lux-setting-row-side"><span>Editar</span><span>›</span></span>';
    if (layoutCard?.nextSibling) group.insertBefore(editButton, layoutCard.nextSibling);
    else group.appendChild(editButton);

    customButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      applyCustomMode(true);
      updateSettingsUi(sheet);
    });

    selector.querySelectorAll('button[data-value="frame"], button[data-value="fullscreen"]').forEach(button => {
      button.addEventListener('click', () => {
        leaveCustomMode();
        setTimeout(() => updateSettingsUi(sheet), 0);
      }, true);
    });

    editButton.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      startEditor(sheet);
    });

    if (storedMode() === 'custom') applyCustomMode(false);
    updateSettingsUi(sheet);
  };

  const selectedConfig = () => workingLayout?.[selectedGroup] || null;

  const updateEditorToolbar = () => {
    const toolbar = document.querySelector('.lux-control-editor-toolbar');
    if (!toolbar) return;
    const config = selectedConfig();
    toolbar.querySelectorAll('[data-control-group]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.controlGroup === selectedGroup);
    });
    const name = toolbar.querySelector('.lux-control-editor-selected');
    if (name) name.textContent = GROUPS[selectedGroup]?.label || 'Controles';
    const slider = toolbar.querySelector('.lux-control-editor-size');
    const value = toolbar.querySelector('.lux-control-editor-size-value');
    if (slider && config) slider.value = String(Math.round(config.scale * 100));
    if (value && config) value.textContent = `${Math.round(config.scale * 100)}%`;

    const root = modal();
    root?.querySelectorAll('.lux-control-edit-selected').forEach(node => node.classList.remove('lux-control-edit-selected'));
    root?.querySelector(GROUPS[selectedGroup]?.selector)?.classList.add('lux-control-edit-selected');
  };

  const closeEditor = save => {
    const root = modal();
    if (!editing || !root) return;

    if (save) workingLayout = saveLayout(workingLayout);
    else workingLayout = cloneLayout(originalLayout || readLayout());
    applyLayout(workingLayout);

    editing = false;
    dragState = null;
    root.classList.remove('lux-controls-editing');
    root.querySelectorAll('.lux-control-edit-selected').forEach(node => node.classList.remove('lux-control-edit-selected'));

    const context = contextLayer();
    context?.querySelector('.lux-control-editor-toolbar')?.remove();
    context?.classList.remove('lux-control-editor-context', 'lux-context-open');
  };

  const startEditor = sheet => {
    const root = modal();
    const context = contextLayer();
    if (!root || !context) return;

    applyCustomMode(true);
    originalLayout = cloneLayout(readLayout());
    workingLayout = cloneLayout(originalLayout);
    selectedGroup = 'dpad';
    editing = true;
    applyLayout(workingLayout);

    sheet?.remove();
    context.querySelectorAll('.lux-control-editor-toolbar').forEach(node => node.remove());
    context.classList.add('lux-context-open', 'lux-control-editor-context');
    root.classList.add('lux-controls-editing');

    const toolbar = document.createElement('div');
    toolbar.className = 'lux-control-editor-toolbar';
    toolbar.innerHTML = `
      <div class="lux-control-editor-head">
        <span><strong>Editar controles</strong><small>Arraste os blocos pela tela.</small></span>
        <span class="lux-control-editor-selected">Direcional</span>
      </div>
      <div class="lux-control-editor-groups">
        ${Object.entries(GROUPS).map(([key, info]) => `<button type="button" data-control-group="${key}">${info.label}</button>`).join('')}
      </div>
      <div class="lux-control-editor-scale-row">
        <span>Tamanho</span>
        <input class="lux-control-editor-size" type="range" min="60" max="140" step="5" value="100" aria-label="Tamanho do bloco selecionado">
        <strong class="lux-control-editor-size-value">100%</strong>
      </div>
      <div class="lux-control-editor-actions">
        <button type="button" data-editor-action="reset">Padrão</button>
        <button type="button" data-editor-action="cancel">Cancelar</button>
        <button type="button" class="is-primary" data-editor-action="save">Salvar</button>
      </div>
    `;
    context.appendChild(toolbar);

    toolbar.querySelectorAll('[data-control-group]').forEach(button => {
      button.addEventListener('click', () => {
        selectedGroup = button.dataset.controlGroup;
        updateEditorToolbar();
      });
    });

    toolbar.querySelector('.lux-control-editor-size')?.addEventListener('input', event => {
      const config = selectedConfig();
      if (!config) return;
      config.scale = clamp(Number(event.target.value) / 100, MIN_SCALE, MAX_SCALE);
      applyLayout(workingLayout);
      updateEditorToolbar();
    });

    toolbar.querySelector('[data-editor-action="reset"]')?.addEventListener('click', () => {
      workingLayout = cloneLayout(defaultLayout());
      applyLayout(workingLayout);
      updateEditorToolbar();
    });
    toolbar.querySelector('[data-editor-action="cancel"]')?.addEventListener('click', () => closeEditor(false));
    toolbar.querySelector('[data-editor-action="save"]')?.addEventListener('click', () => closeEditor(true));

    updateEditorToolbar();
  };

  const groupFromTarget = target => {
    if (!(target instanceof Element)) return null;
    return Object.entries(GROUPS).find(([, info]) => target.closest(info.selector))?.[0] || null;
  };

  const beginDrag = event => {
    if (!editing || event.button > 0) return;
    const group = groupFromTarget(event.target);
    if (!group || !workingLayout?.[group]) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    selectedGroup = group;
    const config = workingLayout[group];
    const element = modal()?.querySelector(GROUPS[group].selector);
    const rect = element?.getBoundingClientRect();
    dragState = {
      id: event.pointerId,
      group,
      startX: event.clientX,
      startY: event.clientY,
      x: config.x,
      y: config.y,
      widthPercent: rect ? (rect.width / Math.max(1, window.innerWidth)) * 100 : 10,
      heightPercent: rect ? (rect.height / Math.max(1, window.innerHeight)) * 100 : 10
    };
    updateEditorToolbar();
  };

  const moveDrag = event => {
    if (!editing || !dragState || event.pointerId !== dragState.id) return;
    event.preventDefault();
    const config = workingLayout?.[dragState.group];
    if (!config) return;

    const dx = ((event.clientX - dragState.startX) / Math.max(1, window.innerWidth)) * 100;
    const dy = ((event.clientY - dragState.startY) / Math.max(1, window.innerHeight)) * 100;
    config.x = clamp(dragState.x + dx, 0, Math.max(0, 100 - dragState.widthPercent));
    config.y = clamp(dragState.y + dy, 0, Math.max(0, 100 - dragState.heightPercent));
    applyLayout(workingLayout);
  };

  const endDrag = event => {
    if (!dragState || event.pointerId !== dragState.id) return;
    dragState = null;
  };

  const ensureStyles = () => {
    if (document.getElementById('luxMobileCustomControlsStyles')) return;
    const style = document.createElement('style');
    style.id = 'luxMobileCustomControlsStyles';
    style.textContent = `
      @media ${MOBILE_MEDIA} {
        #emulatorModal.lux-console-mobile-stage1 .lux-layout-selector-3 {
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-custom-controls-edit.hidden { display: none !important; }

        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-dpad,
        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-face,
        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-shoulders,
        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-system-buttons {
          position: fixed !important;
          right: auto !important;
          bottom: auto !important;
          margin: 0 !important;
          transform-origin: top left !important;
        }

        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-dpad {
          left: 0 !important;
          top: 0 !important;
          transform: translate3d(var(--lux-custom-dpad-x, 5vw), var(--lux-custom-dpad-y, 61dvh), 0) scale(var(--lux-custom-dpad-scale, 1)) !important;
        }

        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-face {
          left: 0 !important;
          top: 0 !important;
          transform: translate3d(var(--lux-custom-face-x, 61vw), var(--lux-custom-face-y, 61dvh), 0) scale(var(--lux-custom-face-scale, 1)) !important;
        }

        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-shoulders {
          left: 0 !important;
          top: 0 !important;
          width: min(260px, 70vw) !important;
          transform: translate3d(var(--lux-custom-shoulders-x, 16vw), var(--lux-custom-shoulders-y, 50dvh), 0) scale(var(--lux-custom-shoulders-scale, .9)) !important;
        }

        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-system-buttons {
          left: 0 !important;
          top: 0 !important;
          inset: auto !important;
          width: max-content !important;
          height: auto !important;
          display: flex !important;
          align-items: center !important;
          gap: 14px !important;
          transform: translate3d(var(--lux-custom-system-x, 27vw), var(--lux-custom-system-y, 87dvh), 0) scale(var(--lux-custom-system-scale, .9)) !important;
        }

        #emulatorModal.lux-console-mobile-stage1.lux-console-view-custom .lux-console-system-buttons .lux-system-button {
          position: static !important;
          left: auto !important;
          right: auto !important;
          top: auto !important;
          bottom: auto !important;
          transform: none !important;
        }

        #emulatorModal.lux-console-mobile-stage1.lux-controls-editing .lux-console-dpad,
        #emulatorModal.lux-console-mobile-stage1.lux-controls-editing .lux-console-face,
        #emulatorModal.lux-console-mobile-stage1.lux-controls-editing .lux-console-shoulders,
        #emulatorModal.lux-console-mobile-stage1.lux-controls-editing .lux-console-system-buttons {
          pointer-events: auto !important;
          outline: 1px dashed rgba(216,180,254,.55);
          outline-offset: 5px;
          border-radius: 12px;
          touch-action: none !important;
        }

        #emulatorModal.lux-console-mobile-stage1.lux-controls-editing .lux-control-edit-selected {
          outline: 2px solid rgba(192,132,252,.95) !important;
          box-shadow: 0 0 0 5px rgba(147,51,234,.14), 0 0 24px rgba(147,51,234,.22);
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-context.lux-context-open {
          background: rgba(7,3,13,.14);
          -webkit-backdrop-filter: none;
          backdrop-filter: none;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-toolbar {
          position: fixed;
          left: 50%;
          bottom: calc(10px + env(safe-area-inset-bottom, 0px));
          z-index: 80;
          transform: translateX(-50%);
          width: min(94vw, 420px);
          box-sizing: border-box;
          padding: 11px;
          border: 1px solid rgba(216,180,254,.32);
          border-radius: 18px;
          background: linear-gradient(180deg, rgba(31,12,53,.97), rgba(12,5,23,.98));
          box-shadow: 0 18px 44px rgba(0,0,0,.44), 0 0 24px rgba(126,34,206,.15);
          color: #fff;
          pointer-events: auto;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-head,
        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-scale-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 9px;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-head strong { display:block; font-size:11px; }
        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-head small { display:block; margin-top:2px; color:rgba(216,180,254,.62); font-size:8px; }
        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-selected { color:#d8b4fe; font-size:9px; font-weight:900; }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-groups {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 5px;
          margin-top: 9px;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-groups button,
        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-actions button {
          appearance:none;
          min-height:34px;
          border:1px solid rgba(216,180,254,.18);
          border-radius:10px;
          background:rgba(255,255,255,.04);
          color:rgba(233,213,255,.72);
          font:inherit;
          font-size:8px;
          font-weight:800;
          pointer-events:auto;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-groups button.is-active {
          border-color:rgba(192,132,252,.70);
          background:rgba(126,34,206,.28);
          color:#fff;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-scale-row {
          margin-top:9px;
          font-size:9px;
          color:#d8b4fe;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-size {
          appearance:none;
          -webkit-appearance:none;
          flex:1;
          height:5px;
          border-radius:999px;
          background:linear-gradient(90deg, rgba(147,51,234,.92), rgba(216,180,254,.28));
          pointer-events:auto;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-size::-webkit-slider-thumb {
          appearance:none;
          -webkit-appearance:none;
          width:18px;
          height:18px;
          border-radius:50%;
          border:2px solid #e9d5ff;
          background:#9333ea;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-actions {
          display:grid;
          grid-template-columns:repeat(3,1fr);
          gap:6px;
          margin-top:9px;
        }

        #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-actions button.is-primary {
          background:linear-gradient(135deg,#9333ea,#7c3aed);
          border-color:rgba(216,180,254,.36);
          color:#fff;
        }

        @media (orientation: landscape) {
          #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-toolbar {
            width:min(64vw, 460px);
            padding:8px 10px;
            bottom:calc(5px + env(safe-area-inset-bottom, 0px));
          }
          #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-groups { margin-top:6px; }
          #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-scale-row,
          #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-actions { margin-top:6px; }
          #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-groups button,
          #emulatorModal.lux-console-mobile-stage1 .lux-control-editor-actions button { min-height:28px; }
        }
      }
    `;
    document.head.appendChild(style);
  };

  ensureStyles();

  document.addEventListener('pointerdown', beginDrag, true);
  window.addEventListener('pointermove', moveDrag, { capture: true, passive: false });
  window.addEventListener('pointerup', endDrag, true);
  window.addEventListener('pointercancel', endDrag, true);

  const syncCustomMode = () => {
    if (storedMode() !== 'custom') return;
    const root = modal();
    if (!root) return;
    applyCustomMode(false);
  };

  const observer = new MutationObserver(mutations => {
    syncCustomMode();
    for (const mutation of mutations) {
      mutation.addedNodes.forEach(node => {
        if (!(node instanceof Element)) return;
        if (node.matches('.lux-console-settings-sheet')) injectSettings(node);
        node.querySelectorAll?.('.lux-console-settings-sheet').forEach(injectSettings);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('.lux-console-settings-sheet').forEach(injectSettings);
  syncCustomMode();

  lastOrientation = orientation();
  window.addEventListener('resize', () => {
    const now = orientation();
    if (now === lastOrientation) return;
    lastOrientation = now;
    if (storedMode() !== 'custom') return;
    if (editing) {
      originalLayout = cloneLayout(readLayout());
      workingLayout = cloneLayout(originalLayout);
      applyLayout(workingLayout);
      updateEditorToolbar();
    } else {
      applyLayout(readLayout());
    }
  }, { passive: true });

  window.LuxMobileCustomControls = {
    open: () => startEditor(document.querySelector('.lux-console-settings-sheet')),
    reset: () => {
      const layout = defaultLayout();
      saveLayout(layout);
      applyLayout(layout);
      return layout;
    },
    get: readLayout
  };
})();
