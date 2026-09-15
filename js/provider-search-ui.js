(() => {
  'use strict';

  const VERSION = '20260914-provider-search-4-animefire-only';
  if (window.__luxProviderSearchUiInstalled === VERSION) return;
  window.__luxProviderSearchUiInstalled = VERSION;

  if (!window.LuxCanonicalCatalog && !document.querySelector('script[data-lux-canonical-catalog-sync]')) {
    const canonical = document.createElement('script');
    canonical.src = 'js/canonical-catalog-sync.js?v=20260914-canonical-catalog-1';
    canonical.async = true;
    canonical.setAttribute('data-lux-canonical-catalog-sync', '1');
    document.head.appendChild(canonical);
  }

  if (!window.LuxProviderCatalog && !document.querySelector('script[data-lux-provider-catalog-bridge]')) {
    const bridge = document.createElement('script');
    bridge.src = 'js/provider-catalog-bridge.js?v=20260914-provider-catalog-4-animefire-only';
    bridge.async = true;
    bridge.setAttribute('data-lux-provider-catalog-bridge', '1');
    document.head.appendChild(bridge);
  }

  const FUNCTION_NAME = 'provider-search';
  let lastResults = [];

  const safeCurrentUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));

  function authBody(extra = {}) {
    const user = safeCurrentUser();
    return {
      username: String(user?.user || '').trim(),
      password: String(user?.pass || ''),
      ...extra
    };
  }

  async function searchProviders(query, provider = 'animefire', page = 1) {
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) throw new Error('Serviço de nuvem indisponível.');
    const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
      body: authBody({ action: 'search', query, provider: provider === 'animefire' ? 'animefire' : 'animefire', page })
    });
    if (error) throw new Error(data?.error || error.message || 'Falha ao pesquisar Anime Fire.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function resultCard(item) {
    const poster = item?.poster
      ? `<img src="${escapeHtml(item.poster)}" alt="" loading="lazy" class="h-20 w-14 shrink-0 rounded-lg object-cover bg-[#180f29]" onerror="this.style.display='none'">`
      : '<div class="h-20 w-14 shrink-0 rounded-lg bg-[#180f29] flex items-center justify-center text-[10px] text-sky-300/50">sem capa</div>';
    const variant = item?.variant === 'dub'
      ? '<span class="rounded-full border border-amber-800/40 bg-amber-950/30 px-2 py-0.5 text-[9px] font-bold text-amber-300">DUBLADO</span>'
      : '';
    return `
      <article class="flex gap-3 rounded-xl border border-sky-900/40 bg-[#0d0817] p-2.5" data-provider-result>
        ${poster}
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <strong class="text-xs text-white">${escapeHtml(item?.title || 'Sem título')}</strong>
            <span class="rounded-full border border-sky-800/50 bg-sky-950/40 px-2 py-0.5 text-[9px] font-bold text-sky-300">Anime Fire</span>
            <span class="rounded-full border border-emerald-800/40 bg-emerald-950/30 px-2 py-0.5 text-[9px] font-bold text-emerald-300">PT-BR</span>
            ${variant}
          </div>
          <p class="mt-1 break-all text-[10px] text-purple-400/80">${escapeHtml(item?.url || '')}</p>
          <div class="mt-2 flex flex-wrap gap-2">
            <button type="button" data-provider-open="${escapeHtml(item?.url || '')}" class="rounded-lg border border-sky-800/60 bg-sky-950/40 px-2.5 py-1.5 text-[10px] font-bold text-sky-200">Abrir fonte</button>
          </div>
        </div>
      </article>`;
  }

  function renderResults(data) {
    const root = document.getElementById('luxProviderSearchResults');
    const status = document.getElementById('luxProviderSearchStatus');
    if (!root || !status) return;
    lastResults = Array.isArray(data?.results) ? data.results : [];
    root.innerHTML = lastResults.length
      ? lastResults.map(resultCard).join('')
      : '<p class="rounded-xl border border-sky-900/30 bg-[#0d0817] p-3 text-xs text-sky-200/70">Nenhum resultado encontrado no Anime Fire.</p>';
    status.textContent = `${lastResults.length} resultado(s) encontrado(s) no Anime Fire`;
  }

  async function syncResultsToCatalog(results) {
    if (!Array.isArray(results) || !results.length) return null;
    let attempts = 0;
    while (!window.LuxProviderCatalog?.mergeSearchResults && attempts < 40) {
      attempts += 1;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!window.LuxProviderCatalog?.mergeSearchResults) return null;
    return window.LuxProviderCatalog.mergeSearchResults(results);
  }

  async function handleSearch(event) {
    event?.preventDefault?.();
    const input = document.getElementById('luxProviderSearchInput');
    const button = document.getElementById('luxProviderSearchButton');
    const status = document.getElementById('luxProviderSearchStatus');
    const root = document.getElementById('luxProviderSearchResults');
    const query = String(input?.value || '').trim();
    if (query.length < 2) {
      if (status) status.textContent = 'Digite pelo menos 2 caracteres.';
      input?.focus();
      return;
    }

    if (button) button.disabled = true;
    if (status) status.textContent = `Pesquisando “${query}” no Anime Fire...`;
    if (root) root.innerHTML = '<p class="rounded-xl border border-sky-900/30 bg-[#0d0817] p-3 text-xs text-sky-200/70">Consultando o índice atual do Anime Fire...</p>';
    try {
      const data = await searchProviders(query, 'animefire');
      renderResults(data);
      if (Array.isArray(data?.results) && data.results.length) {
        const baseText = status?.textContent || '';
        try {
          const merged = await syncResultsToCatalog(data.results);
          if (status && merged) status.textContent = `${baseText} · catálogo Lux: ${Number(merged.added || 0)} novo(s), ${Number(merged.merged || 0)} combinado(s)`;
        } catch (mergeError) {
          console.warn('[LUX-IPTV-041] Busca funcionou, mas a mesclagem no catálogo falhou:', mergeError);
          if (status) status.textContent = `${baseText} · busca OK; catálogo será atualizado em segundo plano`;
        }
      }
    } catch (error) {
      if (status) status.textContent = error?.message || 'Falha ao pesquisar Anime Fire.';
      if (root) root.innerHTML = `<p class="rounded-xl border border-rose-900/40 bg-rose-950/10 p-3 text-xs text-rose-300">${escapeHtml(error?.message || 'Falha ao pesquisar Anime Fire.')}</p>`;
    } finally {
      if (button) button.disabled = false;
    }
  }

  function enforceAnimeFireOnlyInSync() {
    document.querySelectorAll('[data-provider-sync][value="dattebayobr"]').forEach(input => {
      input.closest('label')?.remove();
    });
    document.querySelectorAll('[data-provider-sync][value="animefire"]').forEach(input => {
      input.checked = true;
      input.disabled = true;
    });
  }

  function installUi() {
    const card = document.getElementById('luxProviderLayerCard');
    if (!card) return false;
    const previous = document.getElementById('luxProviderSearchBox');
    if (previous) {
      if (previous.dataset.providerUiVersion === VERSION) return true;
      previous.remove();
    }

    const section = document.createElement('div');
    section.id = 'luxProviderSearchBox';
    section.dataset.providerUiVersion = VERSION;
    section.className = 'mt-4 rounded-xl border border-sky-900/40 bg-[#0d0817] p-3';
    section.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-3"><div>
        <h5 class="text-xs font-bold uppercase text-sky-300">Buscar conteúdo no Anime Fire</h5>
        <p class="mt-1 text-[10px] text-sky-200/60">Anime Fire está ativo como provider de teste. Dattebayo BR está temporariamente desativado. Resultados encontrados também podem ser mesclados ao catálogo do Lux.</p>
      </div></div>
      <form id="luxProviderSearchForm" class="mt-3 grid grid-cols-1 gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto]">
        <select id="luxProviderSearchSelect" disabled class="rounded-xl border border-sky-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white opacity-80"><option value="animefire" selected>Anime Fire</option></select>
        <input id="luxProviderSearchInput" type="search" autocomplete="off" placeholder="Ex.: Naruto, Bleach, Sword Art Online..." class="rounded-xl border border-sky-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white placeholder:text-sky-200/30">
        <button id="luxProviderSearchButton" type="submit" class="rounded-xl bg-sky-700 px-4 py-2 text-xs font-bold text-white hover:bg-sky-600 disabled:opacity-50">Buscar</button>
      </form>
      <p id="luxProviderSearchStatus" class="mt-2 min-h-[18px] text-[10px] text-sky-300/80">Digite um anime para testar o Anime Fire.</p>
      <div id="luxProviderSearchResults" class="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2"></div>`;
    const providerList = document.getElementById('luxProviderList');
    if (providerList) card.insertBefore(section, providerList); else card.appendChild(section);
    section.querySelector('#luxProviderSearchForm')?.addEventListener('submit', handleSearch);
    section.querySelector('#luxProviderSearchResults')?.addEventListener('click', event => {
      const button = event.target.closest('[data-provider-open]');
      if (!button) return;
      const url = String(button.dataset.providerOpen || '');
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer');
    });
    return true;
  }

  window.LuxProviderSearch = { version: VERSION, search: searchProviders, getLastResults: () => [...lastResults] };

  const observer = new MutationObserver(() => enforceAnimeFireOnlyInSync());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  enforceAnimeFireOnlyInSync();

  let attempts = 0;
  if (!installUi()) {
    const timer = setInterval(() => {
      attempts += 1;
      enforceAnimeFireOnlyInSync();
      if (installUi() || attempts >= 240) clearInterval(timer);
    }, 50);
  }
})();
