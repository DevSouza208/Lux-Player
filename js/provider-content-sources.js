(() => {
  'use strict';

  const VERSION = '20260914-provider-layer-1';
  if (window.__luxProviderContentSourcesInstalled === VERSION) return;
  window.__luxProviderContentSourcesInstalled = VERSION;

  const ANIYOMI_INDEX_URL = 'https://raw.githubusercontent.com/mojuru/anime-repo/repo/index.min.json';
  const AUTO_MERGE_SCORE = 95;
  const ROLE_WEIGHT = Object.freeze({ primary: 0, provider: 1000, secondary: 2000, fallback: 3000 });
  const adapters = new Map();
  let mergeRunning = false;
  let discoveredProviders = [];

  const safeCurrentUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  const normalizeText = value => String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(dublado|legendado|dual(?: audio)?|pt[- ]?br|4k|fhd|uhd|hd|sd|1080p|720p|480p)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  function contentTitle(item) {
    return String(item?.seriesName || item?.name || item?.title || '').trim();
  }

  function contentType(item) {
    const type = String(item?.type || '').toLowerCase();
    if (type === 'movie') return 'movies';
    if (type === 'tv') return 'live';
    return ['movies', 'series', 'live'].includes(type) ? type : type;
  }

  function contentYear(item) {
    const explicit = String(item?.year || item?.releaseDate || item?.release_date || item?.first_air_date || '');
    const match = `${explicit} ${contentTitle(item)}`.match(/\b(19\d{2}|20\d{2})\b/);
    return match ? match[1] : '';
  }

  function itemKey(item) {
    return `${contentType(item)}|${normalizeText(contentTitle(item))}|${contentYear(item)}`;
  }

  function roleWeight(role) {
    return ROLE_WEIGHT[String(role || '').toLowerCase()] ?? ROLE_WEIGHT.fallback;
  }

  function descriptorRank(source) {
    return roleWeight(source?.role) + Math.max(0, Number(source?.priority) || 0);
  }

  function sortDescriptors(list) {
    if (!Array.isArray(list)) return [];
    return list.sort((a, b) => descriptorRank(a) - descriptorRank(b));
  }

  function providerDescriptor(adapter, url = '') {
    return {
      id: adapter.id,
      name: adapter.name,
      priority: Number(adapter.priority) || 10,
      role: 'provider',
      tier: 1,
      url: String(url || '')
    };
  }

  function ensurePrimaryDescriptor(item) {
    if (!item || ['provider', 'secondary'].includes(String(item.luxSourceRole || '').toLowerCase())) return;
    item.luxSourceRole = 'primary';
    if (!Array.isArray(item.luxSources)) item.luxSources = [];
    if (!item.luxSources.some(source => source?.role === 'primary')) {
      item.luxSources.unshift({ id: 'principal', name: 'Lista principal', priority: 0, role: 'primary', tier: 0, url: String(item.url || '') });
    }
    sortDescriptors(item.luxSources);
  }

  function scoreCandidate(incoming, candidate) {
    try {
      if (window.LuxSecondarySources?.scoreCandidate) {
        return Number(window.LuxSecondarySources.scoreCandidate(incoming, candidate)) || 0;
      }
    } catch (_) {}

    if (contentType(incoming) !== contentType(candidate)) return 0;
    const a = normalizeText(contentTitle(incoming));
    const b = normalizeText(contentTitle(candidate));
    if (!a || !b) return 0;
    if (a === b) {
      const yearA = contentYear(incoming);
      const yearB = contentYear(candidate);
      if (yearA && yearB && yearA !== yearB) return 78;
      return 100;
    }
    return 0;
  }

  function bestCandidate(item, catalog) {
    let best = null;
    let score = 0;
    for (const candidate of catalog) {
      if (candidate === item) continue;
      const candidateScore = scoreCandidate(item, candidate);
      if (candidateScore > score) {
        best = candidate;
        score = candidateScore;
        if (score === 100) break;
      }
    }
    return { candidate: best, score };
  }

  function attachProviderAlternative(item, adapter, url = '') {
    if (!item) return;
    if (!Array.isArray(item.luxSources)) item.luxSources = [];
    if (!item.luxSources.some(entry => entry?.id === adapter.id && String(entry?.url || '') === String(url || ''))) {
      item.luxSources.push(providerDescriptor(adapter, url));
    }
    sortDescriptors(item.luxSources);
  }

  function promoteProviderOverSecondary(existing, incoming, adapter) {
    const previousDescriptor = {
      id: existing.luxSourceId || `secondary:${itemKey(existing)}`,
      name: existing.luxSourceName || 'Fonte secundária',
      priority: Number(existing?.luxSources?.find(source => source?.role === 'secondary')?.priority) || 10,
      role: 'secondary',
      tier: 2,
      url: String(existing.url || '')
    };

    const oldSources = Array.isArray(existing.luxSources) ? existing.luxSources.filter(source => source?.role !== 'provider') : [];
    const incomingSources = Array.isArray(incoming.luxSources) ? incoming.luxSources : [];
    const providerUrl = String(incoming.url || incomingSources.find(source => source?.url)?.url || '');

    Object.assign(existing, incoming, {
      luxSourceRole: 'provider',
      luxSourceId: adapter.id,
      luxSourceName: adapter.name,
      luxSources: [providerDescriptor(adapter, providerUrl), previousDescriptor, ...oldSources.filter(source => source?.role !== 'secondary')]
    });
    sortDescriptors(existing.luxSources);
  }

  function mergeSeries(primary, incoming, adapter) {
    attachProviderAlternative(primary, adapter, '');
    if (!incoming?.m3uEpisodes || typeof incoming.m3uEpisodes !== 'object') return;
    if (!primary.m3uEpisodes || typeof primary.m3uEpisodes !== 'object') primary.m3uEpisodes = {};

    Object.entries(incoming.m3uEpisodes).forEach(([season, incomingEpisodes]) => {
      if (!Array.isArray(incomingEpisodes)) return;
      if (!Array.isArray(primary.m3uEpisodes[season])) primary.m3uEpisodes[season] = [];
      const target = primary.m3uEpisodes[season];

      incomingEpisodes.forEach(episode => {
        const number = Number(episode?.episodeNum || episode?.episode_num || episode?.episode || 0);
        const existing = target.find(candidate => Number(candidate?.episodeNum || candidate?.episode_num || candidate?.episode || 0) === number && number > 0);
        if (existing) {
          if (existing.luxSourceRole === 'secondary') {
            promoteProviderOverSecondary(existing, episode, adapter);
          } else {
            attachProviderAlternative(existing, adapter, episode?.url || '');
          }
          return;
        }
        target.push({
          ...episode,
          luxSourceRole: 'provider',
          luxSourceId: adapter.id,
          luxSourceName: adapter.name,
          luxSources: [providerDescriptor(adapter, episode?.url || '')]
        });
      });
      target.sort((a, b) => Number(a?.episodeNum || a?.episode_num || a?.episode || 0) - Number(b?.episodeNum || b?.episode_num || b?.episode || 0));
    });
  }

  function mergeDuplicate(existing, incoming, adapter) {
    const existingRole = String(existing?.luxSourceRole || 'primary').toLowerCase();
    if (existingRole === 'secondary') {
      promoteProviderOverSecondary(existing, incoming, adapter);
      return;
    }
    ensurePrimaryDescriptor(existing);
    if (contentType(existing) === 'series' && incoming?.m3uEpisodes) {
      mergeSeries(existing, incoming, adapter);
      return;
    }
    attachProviderAlternative(existing, adapter, incoming?.url || '');
  }

  function prepareProviderItem(item, adapter) {
    const next = { ...(item || {}) };
    next.luxSourceRole = 'provider';
    next.luxSourceId = adapter.id;
    next.luxSourceName = adapter.name;
    next.luxSources = [providerDescriptor(adapter, next.url || '')];
    return next;
  }

  async function mergeAdapter(adapter, catalog) {
    const rawItems = await adapter.loadCatalog({ currentUser: safeCurrentUser(), adapter });
    const items = Array.isArray(rawItems) ? rawItems.map(item => prepareProviderItem(item, adapter)) : [];
    let added = 0;
    let merged = 0;

    for (const incoming of items) {
      const best = bestCandidate(incoming, catalog);
      if (best.candidate && best.score >= AUTO_MERGE_SCORE) {
        mergeDuplicate(best.candidate, incoming, adapter);
        merged += 1;
      } else {
        catalog.push(incoming);
        added += 1;
      }
    }

    return { added, merged, parsed: items.length };
  }

  function reassertPriority(catalog) {
    if (!Array.isArray(catalog)) return;
    catalog.forEach(item => {
      if (Array.isArray(item?.luxSources)) sortDescriptors(item.luxSources);
      if (item?.luxSourceRole === 'provider' && Array.isArray(item?.luxSources)) {
        const provider = item.luxSources.find(source => source?.role === 'provider');
        const primary = item.luxSources.find(source => source?.role === 'primary');
        if (primary) item.luxSourceRole = 'primary';
        else if (provider) {
          item.luxSourceId = provider.id;
          item.luxSourceName = provider.name;
          if (provider.url) item.url = provider.url;
        }
      }
    });
  }

  async function mergeIntoCurrentCatalog(options = {}) {
    if (mergeRunning) return { added: 0, merged: 0, adapters: 0, skipped: true };
    if (typeof allMediaItems === 'undefined' || !Array.isArray(allMediaItems)) return { added: 0, merged: 0, adapters: 0, skipped: true };

    mergeRunning = true;
    try {
      allMediaItems.forEach(ensurePrimaryDescriptor);
      const active = [...adapters.values()].filter(adapter => adapter.enabled !== false && typeof adapter.loadCatalog === 'function')
        .sort((a, b) => (Number(a.priority) || 10) - (Number(b.priority) || 10));
      const totals = { added: 0, merged: 0, adapters: 0, failures: [] };

      for (const adapter of active) {
        try {
          const result = await mergeAdapter(adapter, allMediaItems);
          totals.added += result.added;
          totals.merged += result.merged;
          totals.adapters += 1;
        } catch (error) {
          totals.failures.push(`${adapter.name}: ${error?.message || 'falha desconhecida'}`);
          console.warn('[LUX-IPTV-038] Provider indisponível:', adapter.name, error);
        }
      }

      reassertPriority(allMediaItems);
      if (options.refreshUi) {
        try {
          if (typeof window.setSection === 'function' && typeof currentSection !== 'undefined') window.setSection(currentSection);
        } catch (_) {}
      }
      return totals;
    } finally {
      mergeRunning = false;
    }
  }

  function registerAdapter(adapter) {
    if (!adapter || !adapter.id || !adapter.name || typeof adapter.loadCatalog !== 'function') {
      throw new Error('Provider inválido: informe id, name e loadCatalog().');
    }
    adapters.set(String(adapter.id), {
      priority: 10,
      enabled: true,
      ...adapter,
      id: String(adapter.id),
      name: String(adapter.name)
    });
    return adapters.get(String(adapter.id));
  }

  function unregisterAdapter(id) {
    return adapters.delete(String(id));
  }

  async function discoverAniyomiProviders({ language = 'pt-BR', includeNsfw = false } = {}) {
    const response = await fetch(ANIYOMI_INDEX_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Índice Aniyomi respondeu HTTP ${response.status}.`);
    const payload = await response.json();
    if (!Array.isArray(payload)) throw new Error('Índice Aniyomi em formato inesperado.');

    discoveredProviders = payload
      .filter(entry => String(entry?.lang || '') === language)
      .filter(entry => includeNsfw || Number(entry?.nsfw || 0) === 0)
      .filter(entry => !/\bdead\b/i.test(String(entry?.name || '')))
      .map(entry => ({
        name: String(entry?.name || '').replace(/^Aniyomi:\s*/i, '').trim(),
        pkg: String(entry?.pkg || ''),
        apk: String(entry?.apk || ''),
        lang: String(entry?.lang || ''),
        nsfw: Number(entry?.nsfw || 0),
        sources: Array.isArray(entry?.sources) ? entry.sources.map(source => ({
          name: String(source?.name || ''),
          lang: String(source?.lang || ''),
          id: String(source?.id || ''),
          baseUrl: String(source?.baseUrl || '')
        })) : []
      }));
    return discoveredProviders;
  }

  function renderProviderAdmin() {
    const panel = document.getElementById('adminTabSources');
    if (!panel || document.getElementById('luxProviderLayerCard')) return Boolean(document.getElementById('luxProviderLayerCard'));

    const card = document.createElement('section');
    card.id = 'luxProviderLayerCard';
    card.className = 'rounded-2xl border border-sky-900/50 bg-[#120c1f] p-4';
    card.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 class="text-sm font-bold text-white">Providers de conteúdo</h4>
          <p class="mt-1 max-w-3xl text-xs text-sky-200/80">Prioridade: <strong>Lista principal</strong> → <strong>Providers</strong> → <strong>M3U secundárias</strong>. O índice abaixo só descobre providers PT-BR; para tocar conteúdo cada provider precisa de um adaptador compatível com o Lux.</p>
        </div>
        <button id="luxProviderDiscover" type="button" class="rounded-xl border border-sky-700/60 bg-sky-950/50 px-3 py-2 text-xs font-bold text-sky-200 hover:bg-sky-900/60">Ver providers PT-BR</button>
      </div>
      <div id="luxProviderStatus" class="mt-3 text-xs text-sky-300">Camada pronta. Nenhum provider de reprodução foi ativado automaticamente.</div>
      <div id="luxProviderList" class="mt-3 hidden max-h-56 overflow-y-auto rounded-xl border border-sky-900/40 bg-[#0d0817] p-2"></div>`;

    panel.insertBefore(card, panel.firstChild);
    card.querySelector('#luxProviderDiscover')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const status = card.querySelector('#luxProviderStatus');
      const list = card.querySelector('#luxProviderList');
      button.disabled = true;
      status.textContent = 'Consultando índice público de providers...';
      try {
        const providers = await discoverAniyomiProviders();
        status.textContent = `${providers.length} providers PT-BR não-NSFW encontrados no índice.`;
        list.classList.remove('hidden');
        list.innerHTML = providers.length
          ? providers.map(provider => `<div class="border-b border-sky-950/70 px-2 py-2 last:border-b-0"><strong class="text-xs text-white">${escapeHtml(provider.name)}</strong><div class="mt-0.5 text-[10px] text-sky-300/70">${escapeHtml(provider.sources.map(source => source.name).filter(Boolean).join(' · ') || provider.pkg)}</div></div>`).join('')
          : '<p class="p-2 text-xs text-sky-300/70">Nenhum provider encontrado.</p>';
      } catch (error) {
        status.textContent = error?.message || 'Não foi possível consultar o índice.';
      } finally {
        button.disabled = false;
      }
    });
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function installLoadBridge() {
    const original = window.loadMediaSourcesInPriority;
    if (typeof original !== 'function') return false;
    if (original.__luxProviderLayerWrapped) return true;

    const wrapped = async function () {
      const lowerLayersLoaded = await original.apply(this, arguments);
      let provider = null;
      try { provider = await mergeIntoCurrentCatalog(); } catch (error) { console.warn('[LUX-IPTV-038] Falha ao aplicar providers:', error); }
      if (!lowerLayersLoaded && Number(provider?.added || 0) > 0) {
        try { if (typeof window.setMediaSourceState === 'function') window.setMediaSourceState('provider', 'Providers', allMediaItems.length); } catch (_) {}
        return true;
      }
      return lowerLayersLoaded;
    };
    wrapped.__luxProviderLayerWrapped = true;
    wrapped.__luxProviderLayerOriginal = original;
    window.loadMediaSourcesInPriority = wrapped;
    return true;
  }

  function installAdminBridge() {
    if (renderProviderAdmin()) return true;
    return false;
  }

  window.LuxSourcePriority = {
    version: VERSION,
    roles: ROLE_WEIGHT,
    rank: descriptorRank,
    sort: sortDescriptors,
    reassert: () => {
      try { if (typeof allMediaItems !== 'undefined') reassertPriority(allMediaItems); } catch (_) {}
    }
  };

  window.LuxProviderSources = {
    version: VERSION,
    registerAdapter,
    unregisterAdapter,
    listAdapters: () => [...adapters.values()],
    discoverAniyomiProviders,
    getDiscoveredProviders: () => [...discoveredProviders],
    mergeIntoCurrentCatalog,
    priority: { primary: 0, provider: 1, secondary: 2 }
  };

  let attempts = 0;
  const install = () => {
    const load = installLoadBridge();
    const admin = installAdminBridge();
    return load && admin;
  };

  if (!install()) {
    const timer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 240) clearInterval(timer);
    }, 50);
  }

  // A camada de providers carrega depois das M3Us secundárias e promove providers
  // sobre itens secundários equivalentes, sem substituir uma URL principal válida.
  setTimeout(() => {
    try {
      if (typeof allMediaItems !== 'undefined' && Array.isArray(allMediaItems)) {
        mergeIntoCurrentCatalog({ refreshUi: false })
          .then(() => reassertPriority(allMediaItems))
          .catch(error => console.warn('[LUX-IPTV-038] Aplicação tardia de providers falhou:', error));
      }
    } catch (_) {}
  }, 1800);
})();
