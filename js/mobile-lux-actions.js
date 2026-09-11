(() => {
  'use strict';

  if (!window.matchMedia('(max-width: 767px)').matches || window.__luxConsoleActionBarInstalled) return;
  window.__luxConsoleActionBarInstalled = true;

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

  const ensureActionBar = () => {
    const controlsLayer = document.getElementById('luxConsoleControlsLayer');
    if (!controlsLayer) return false;

    let bar = document.getElementById('luxConsoleActionBar');
    if (bar && bar.parentElement === controlsLayer) return true;
    bar?.remove();

    bar = document.createElement('div');
    bar.id = 'luxConsoleActionBar';
    bar.className = 'lux-console-actionbar';
    bar.setAttribute('aria-hidden', 'true');
    bar.innerHTML = actions.map(action => `
      <button type="button" class="lux-console-action-button lux-console-action-${action.key}" disabled tabindex="-1" aria-hidden="true">
        <span class="lux-console-action-icon">${action.icon}</span>
        <span class="lux-console-action-label">${action.label}</span>
      </button>
    `).join('');

    controlsLayer.appendChild(bar);
    return true;
  };

  const observer = new MutationObserver(ensureActionBar);
  observer.observe(document.body, { childList: true, subtree: true });
  ensureActionBar();
})();
