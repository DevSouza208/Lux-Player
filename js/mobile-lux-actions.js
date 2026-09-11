(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleActionBarInstalled) return;
  window.__luxConsoleActionBarInstalled = true;

  const VIEW_MODE_KEY = 'lux-play:console-view-mode';

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

  const closeModeSheet = () => {
    const context = document.getElementById('luxConsoleContextLayer');
    if (!context) return;
    context.classList.remove('lux-context-open');
    context.querySelector('.lux-console-mode-sheet')?.remove();
  };

  const openModeSheet = () => {
    const context = document.getElementById('luxConsoleContextLayer');
    if (!context) return;

    context.querySelector('.lux-console-mode-sheet')?.remove();
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

    sheet.querySelector('.lux-console-mode-sheet-close')?.addEventListener('click', closeModeSheet);
    sheet.querySelectorAll('.lux-console-mode-option').forEach(button => {
      button.addEventListener('click', () => {
        applyViewMode(button.dataset.mode);
        closeModeSheet();
      });
    });
  };

  const bindSettingsButton = bar => {
    const settings = bar?.querySelector('.lux-console-action-settings');
    if (!settings || settings.dataset.luxBound === '1') return;
    settings.dataset.luxBound = '1';
    settings.disabled = false;
    settings.tabIndex = 0;
    settings.removeAttribute('aria-hidden');
    settings.setAttribute('aria-label', 'Configurar visual do Lux Console');
    settings.addEventListener('click', openModeSheet);
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
      bar.innerHTML = actions.map(action => {
        const settings = action.key === 'settings';
        return `
          <button type="button" class="lux-console-action-button lux-console-action-${action.key}" ${settings ? '' : 'disabled tabindex="-1" aria-hidden="true"'}>
            <span class="lux-console-action-icon">${action.icon}</span>
            <span class="lux-console-action-label">${action.label}</span>
          </button>
        `;
      }).join('');
      controlsLayer.appendChild(bar);
    }

    bindSettingsButton(bar);

    const modal = document.getElementById('emulatorModal');
    if (modal && !modal.classList.contains('lux-console-view-frame') && !modal.classList.contains('lux-console-view-fullscreen')) {
      applyViewMode(getViewMode(), false);
    }
    return true;
  };

  const contextClickHandler = event => {
    if (event.target?.id === 'luxConsoleContextLayer') closeModeSheet();
  };

  document.addEventListener('click', contextClickHandler);

  const observer = new MutationObserver(() => {
    ensureActionBar();
    if (!document.getElementById('emulatorModal')) closeModeSheet();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  ensureActionBar();
})();
