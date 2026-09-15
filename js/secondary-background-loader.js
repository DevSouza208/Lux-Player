(() => {
  'use strict';

  const VERSION = '20260914-secondary-background-7';
  if (window.__luxSecondaryBackgroundLoaderInstalled === VERSION) return;
  window.__luxSecondaryBackgroundLoaderInstalled = VERSION;

  function loadGroupingModule() {
    if (window.__luxSecondaryGroupingInstalled || document.querySelector('script[data-lux-secondary-grouping]')) return;
    const script = document.createElement('script');
    script.src = 'js/secondary-grouping.js?v=20260914-1';
    script.async = true;
    script.dataset.luxSecondaryGrouping = '1';
    document.head.appendChild(script);
  }

  function loadLocalePreviewModule() {
    if (window.__luxSecondaryLocalePreviewInstalled === '20260914-secondary-locale-preview2' || document.querySelector('script[data-lux-secondary-locale-preview]')) return;
    const script = document.createElement('script');
    script.src = 'js/secondary-locale-preview.js?v=20260914-2';
    script.async = true;
    script.dataset.luxSecondaryLocalePreview = '1';
    document.head.appendChild(script);
  }

  function loadUiFixesModule() {
    if (window.__luxSecondaryUiFixesInstalled === '20260914-secondary-ui-fixes2' || document.querySelector('script[data-lux-secondary-ui-fixes]')) return;
    const script = document.createElement('script');
    script.src = 'js/secondary-ui-fixes.js?v=20260914-2';
    script.async = true;
    script.dataset.luxSecondaryUiFixes = '1';
    document.head.appendChild(script);
  }

  function unwrapLoadFunction(fn) {
    let current = fn;
    const seen = new Set();
    while (typeof current === 'function' && !seen.has(current)) {
      seen.add(current);
      if (current.__luxProviderLayerOriginal) {
        current = current.__luxProviderLayerOriginal;
        continue;
      }
      if (current.__luxSecondarySourcesOriginal) {
        current = current.__luxSecondarySourcesOriginal;
        continue;
      }
      if (current.__luxNonBlockingBase) {
        current = current.__luxNonBlockingBase;
        continue;
      }
      break;
    }
    return current;
  }

  let backgroundRun = null;
  function runComplementInBackground() {
    if (backgroundRun) return backgroundRun;
    backgroundRun = new Promise(resolve => setTimeout(resolve, 0))
      .then(async () => {
        try {
          if (window.LuxSecondarySources?.mergeIntoCurrentCatalog) {
            await window.LuxSecondarySources.mergeIntoCurrentCatalog({ refreshUi: true });
          }
          if (window.LuxSecondaryUiFixes?.repair) {
            await window.LuxSecondaryUiFixes.repair({ refreshUi: true });
          }
        } catch (error) {
          console.warn('[LUX-IPTV-039] Fontes secundárias falharam em segundo plano:', error);
        }
        // Providers estão desativados nesta fase. Não tentamos carregá-los em background.
      })
      .finally(() => { backgroundRun = null; });
    return backgroundRun;
  }

  function install() {
    const current = window.loadMediaSourcesInPriority;
    if (typeof current !== 'function') return false;
    if (current.__luxNonBlockingSources) return true;

    const base = unwrapLoadFunction(current);
    if (typeof base !== 'function') return false;

    const wrapped = async function () {
      const principalLoaded = await base.apply(this, arguments);
      runComplementInBackground();
      return principalLoaded;
    };

    wrapped.__luxNonBlockingSources = true;
    wrapped.__luxNonBlockingBase = base;
    window.loadMediaSourcesInPriority = wrapped;
    console.info('[LUX-IPTV-039] Lista principal preservada; complementos externos carregam em segundo plano.');
    return true;
  }

  function protectCanonicalSyncModal(modal) {
    if (!modal || modal.dataset.secondarySafeMode === '1') return;
    modal.dataset.secondarySafeMode = '1';

    const principal = modal.querySelector('#luxSyncPrincipal');
    const providers = modal.querySelector('#luxSyncProviders');
    const secondary = modal.querySelector('#luxSyncSecondary');
    const secondaryItems = [...modal.querySelectorAll('[data-secondary-sync]')];

    if (principal) {
      principal.checked = false;
      principal.disabled = true;
      const card = principal.closest('label');
      card?.classList.add('opacity-60');
      const help = card?.querySelector('p');
      if (help) help.textContent = 'Preservada pelo carregamento normal do Lux. Não é reprocessada neste teste.';
    }

    if (providers) {
      providers.checked = false;
      providers.disabled = true;
      const card = providers.closest('label');
      card?.classList.add('opacity-50');
      const help = card?.querySelector('p');
      if (help) help.textContent = 'Providers desativados por enquanto.';
    }

    if (secondary) {
      const hasEnabledSecondary = secondaryItems.some(node => !node.disabled);
      secondary.checked = hasEnabledSecondary;
      secondary.disabled = !hasEnabledSecondary;
    }

    secondaryItems.forEach(node => {
      node.addEventListener('change', () => {
        if (!secondary) return;
        secondary.checked = secondaryItems.some(item => item.checked && !item.disabled);
      });
    });

    const status = modal.querySelector('#luxCanonicalStatus');
    if (status && !status.textContent.trim()) {
      status.textContent = 'Modo seguro: somente fontes secundárias serão sincronizadas. A lista principal fica intacta.';
      status.className = 'mt-3 min-h-[20px] text-xs text-emerald-300';
    }
  }

  function installModalGuard() {
    const existing = document.getElementById('luxCanonicalSyncModal');
    if (existing) protectCanonicalSyncModal(existing);

    if (window.__luxSecondaryModalObserver) return;
    const observer = new MutationObserver(() => {
      const modal = document.getElementById('luxCanonicalSyncModal');
      if (modal) {
        if (modal.querySelector('#luxSyncSecondary')) protectCanonicalSyncModal(modal);
        else setTimeout(() => {
          const current = document.getElementById('luxCanonicalSyncModal');
          if (current?.querySelector('#luxSyncSecondary')) protectCanonicalSyncModal(current);
        }, 120);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__luxSecondaryModalObserver = observer;
  }

  // Mantém as ações globais de catálogo no topo do painel e deixa VODs/R2
  // somente com ações relacionadas a VOD/R2.
  function relocateAdminSyncControls() {
    const catalogButton = document.getElementById('adminPlaylistCatalogSyncButton');
    if (!catalogButton) return false;

    const adminRoot = document.getElementById('adminModal') || document.body;
    const heading = [...adminRoot.querySelectorAll('h2,h3,h4,strong')]
      .find(node => /sincroniza[cç][aã]o e categorias/i.test(String(node.textContent || '').trim()));
    if (!heading) return false;

    const card = heading.closest('section, .rounded-2xl, .rounded-xl') || heading.parentElement?.parentElement;
    if (!card) return false;

    const categoryButton = [...card.querySelectorAll('button')]
      .find(button => /sincronizar categorias/i.test(String(button.textContent || '').trim()));
    if (!categoryButton) return false;

    let actions = card.querySelector('[data-lux-global-sync-actions]');
    if (!actions) {
      actions = document.createElement('div');
      actions.dataset.luxGlobalSyncActions = '1';
      actions.className = 'flex shrink-0 flex-col gap-2';
      categoryButton.parentElement?.insertBefore(actions, categoryButton);
      actions.appendChild(categoryButton);
    }

    catalogButton.textContent = 'Atualizar catálogo';
    catalogButton.className = 'min-w-[190px] bg-fuchsia-600 hover:bg-fuchsia-500 text-white font-bold py-2.5 px-5 rounded-xl text-xs transition-all disabled:opacity-50';
    actions.appendChild(catalogButton);

    const catalogStatus = document.getElementById('adminPlaylistCatalogSyncStatus');
    if (catalogStatus) {
      catalogStatus.className = 'max-w-[260px] min-h-[18px] text-[11px] text-purple-300';
      actions.appendChild(catalogStatus);
    }

    const duplicateCategoryButton = document.getElementById('adminCategorySyncButton');
    if (duplicateCategoryButton && duplicateCategoryButton !== categoryButton) {
      duplicateCategoryButton.classList.add('hidden');
      duplicateCategoryButton.setAttribute('aria-hidden', 'true');
    }

    const duplicateCategoryStatus = document.getElementById('adminCategorySyncStatus');
    if (duplicateCategoryStatus && !card.contains(duplicateCategoryStatus)) {
      duplicateCategoryStatus.classList.add('hidden');
    }

    return true;
  }

  function installAdminSyncLayout() {
    relocateAdminSyncControls();
    if (window.__luxAdminSyncLayoutObserver) return;
    const observer = new MutationObserver(() => relocateAdminSyncControls());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.__luxAdminSyncLayoutObserver = observer;
  }

  let attempts = 0;
  loadGroupingModule();
  loadLocalePreviewModule();
  loadUiFixesModule();
  install();
  installModalGuard();
  installAdminSyncLayout();
  const timer = setInterval(() => {
    attempts += 1;
    loadGroupingModule();
    loadLocalePreviewModule();
    loadUiFixesModule();
    install();
    installModalGuard();
    installAdminSyncLayout();
    const modal = document.getElementById('luxCanonicalSyncModal');
    if (modal?.querySelector('#luxSyncSecondary')) protectCanonicalSyncModal(modal);
    if (attempts >= 120) clearInterval(timer);
  }, 100);
})();
