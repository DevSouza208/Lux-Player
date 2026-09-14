(() => {
  'use strict';

  const VERSION = '20260914-provider-catalog-1';
  if (window.__luxProviderCatalogBridgeInstalled === VERSION) return;
  window.__luxProviderCatalogBridgeInstalled = VERSION;

  const FUNCTION_NAME = 'provider-search';
  const providerDefs = [
    { id: 'provider:animefire', slug: 'animefire', name: 'Anime Fire', priority: 10 },
    { id: 'provider:dattebayobr', slug: 'dattebayobr', name: 'Dattebayo BR', priority: 20 }
  ];
  const extraResults = new Map();
  const catalogCache = new Map();
  const episodeCache = new Map();
  let registered = false;

  const safeCurrentUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  function authBody(extra = {}) {
    const user = safeCurrentUser();
    return {
      username: String(user?.user || '').trim(),
      password: String(user?.pass || ''),
      ...extra
    };
  }

  async function invokeProvider(action, payload = {}) {
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) {
      throw new Error('Serviço de providers indisponível.');
    }
    const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
      body: authBody({ action, ...payload })
    });
    if (error) throw new Error(data?.error || error.message || 'Falha ao consultar provider.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function stripDubTitle(value) {
    return String(value || '')
      .replace(/\s*[-–—:]?\s*\b(dublado|dub|legendado|sub)\b.*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toLuxItem(raw, def) {
    const title = String(raw?.title || '').trim();
    const variant = String(raw?.variant || 'default');
    return {
      id: `provider:${def.slug}:${encodeURIComponent(raw?.url || title)}`,
      name: title,
      seriesName: title,
      type: 'series',
      group: variant === 'dub' ? 'Animes · Dublado' : 'Animes · Providers',
      logo: String(raw?.poster || ''),
      url: String(raw?.url || ''),
      isAdult: false,
      providerUrl: String(raw?.url || ''),
      providerSlug: def.slug,
      providerName: def.name,
      providerVariant: variant,
      providerBaseTitle: stripDubTitle(title),
      luxProviderCatalog: true
    };
  }

  async function loadCatalogFor(def) {
    let base = catalogCache.get(def.slug);
    if (!base) {
      const data = await invokeProvider('catalog', { provider: def.slug });
      base = Array.isArray(data?.results) ? data.results : [];
      catalogCache.set(def.slug, base);
    }
    const extras = extraResults.get(def.slug) || [];
    const seen = new Set();
    return [...base, ...extras]
      .filter(item => {
        const key = String(item?.url || `${item?.title}|${item?.variant || ''}`);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map(item => toLuxItem(item, def));
  }

  async function fetchProviderEpisodes(provider, url, variant = 'default') {
    const key = `${provider}|${url}`;
    if (episodeCache.has(key)) return episodeCache.get(key);
    const promise = invokeProvider('episodes', { provider, url }).then(data => {
      const prefix = variant === 'dub' ? '[DUBLADO] ' : (variant === 'sub' ? '[LEGENDADO] ' : '');
      return (Array.isArray(data?.episodes) ? data.episodes : []).map((episode, index) => ({
        ...episode,
        id: String(episode?.id || `${provider}:${index + 1}`),
        episode_num: Number(episode?.episode_num ?? episode?.episode ?? index + 1),
        episode: Number(episode?.episode ?? episode?.episode_num ?? index + 1),
        title: `${prefix}${String(episode?.title || `Episódio ${index + 1}`)}`.trim(),
        url: String(episode?.pageUrl || ''),
        providerPageUrl: String(episode?.pageUrl || ''),
        providerSlug: provider,
        luxProviderEpisode: true
      }));
    }).catch(error => {
      episodeCache.delete(key);
      throw error;
    });
    episodeCache.set(key, promise);
    return promise;
  }

  function providerSlugFromSource(source) {
    const id = String(source?.id || '');
    if (id.startsWith('provider:')) return id.slice('provider:'.length);
    return String(source?.providerSlug || '');
  }

  function getProviderRefs(series) {
    const refs = [];
    const push = (slug, name, url, variant = 'default') => {
      if (!slug || !/^https?:\/\//i.test(String(url || ''))) return;
      const key = `${slug}|${url}`;
      if (refs.some(ref => ref.key === key)) return;
      refs.push({ key, slug, name: name || slug, url: String(url), variant: variant || 'default' });
    };

    if (String(series?.luxSourceRole || '') === 'provider') {
      const slug = String(series?.providerSlug || '').trim() || String(series?.luxSourceId || '').replace(/^provider:/, '');
      push(slug, series?.providerName || series?.luxSourceName, series?.providerUrl || series?.url, series?.providerVariant || (String(series?.url || '').includes('dublado') ? 'dub' : 'default'));
    }

    (Array.isArray(series?.luxSources) ? series.luxSources : []).forEach(source => {
      if (source?.role !== 'provider') return;
      const slug = providerSlugFromSource(source);
      const variant = /dublad|\/anime-dublado\//i.test(String(source?.url || '')) ? 'dub' : 'default';
      push(slug, source?.name, source?.url, variant);
    });

    return refs;
  }

  async function hydratedProviderSeries(series, ref) {
    const episodes = await fetchProviderEpisodes(ref.slug, ref.url, ref.variant);
    return {
      ...series,
      id: `provider:${ref.slug}:${encodeURIComponent(ref.url)}`,
      series_id: '',
      name: ref.variant === 'dub' && !/dublad/i.test(String(series?.name || ''))
        ? `${series.name} · Dublado`
        : series.name,
      group: ref.variant === 'dub' ? 'Animes · Dublado' : (series.group || 'Animes · Providers'),
      url: ref.url,
      providerUrl: ref.url,
      providerSlug: ref.slug,
      providerName: ref.name,
      providerVariant: ref.variant,
      luxSourceRole: 'provider',
      m3uEpisodes: { '1': episodes }
    };
  }

  function installSeriesBridge() {
    const originalOpen = window.openSeriesModal;
    if (typeof originalOpen !== 'function' || originalOpen.__luxProviderCatalogWrapped) return Boolean(originalOpen?.__luxProviderCatalogWrapped);

    const wrappedOpen = async function(series, resumeState = null, autoPlayResume = false) {
      const refs = getProviderRefs(series);
      if (String(series?.luxSourceRole || '') === 'provider' && refs.length) {
        try {
          const hydrated = await hydratedProviderSeries(series, refs[0]);
          return await originalOpen.call(this, hydrated, resumeState, autoPlayResume);
        } catch (error) {
          console.warn('[LUX-IPTV-041] Falha ao carregar episódios do provider:', error);
          return await originalOpen.call(this, series, resumeState, autoPlayResume);
        }
      }

      const result = await originalOpen.call(this, series, resumeState, autoPlayResume);
      if (!refs.length) return result;

      const seasons = document.getElementById('seriesSeasonsContainer');
      if (!seasons || seasons.querySelector('[data-lux-provider-variants]')) return result;
      const bar = document.createElement('div');
      bar.setAttribute('data-lux-provider-variants', '1');
      bar.className = 'w-full flex flex-wrap items-center gap-2 pb-2';
      bar.innerHTML = '<span class="text-[10px] font-bold uppercase tracking-wide text-sky-300/80">Outras fontes:</span>';
      refs.forEach(ref => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rounded-lg border border-sky-800/50 bg-sky-950/40 px-2.5 py-1.5 text-[10px] font-bold text-sky-200 hover:bg-sky-900/60';
        button.textContent = `${ref.variant === 'dub' ? 'Dublado · ' : ''}${ref.name}`;
        button.onclick = async () => {
          const oldText = button.textContent;
          button.disabled = true;
          button.textContent = 'Carregando episódios...';
          try {
            const hydrated = await hydratedProviderSeries(series, ref);
            await originalOpen.call(window, hydrated, null, false);
          } catch (error) {
            alert(error?.message || 'Não foi possível carregar os episódios deste provider.');
          } finally {
            button.disabled = false;
            button.textContent = oldText;
          }
        };
        bar.appendChild(button);
      });
      seasons.prepend(bar);
      return result;
    };
    wrappedOpen.__luxProviderCatalogWrapped = true;
    wrappedOpen.__luxProviderCatalogOriginal = originalOpen;
    window.openSeriesModal = wrappedOpen;
    return true;
  }

  function installEpisodeBridge() {
    const originalBuild = window.buildSeriesEpisodeItem;
    if (typeof originalBuild === 'function' && !originalBuild.__luxProviderEpisodeWrapped) {
      const wrappedBuild = function(series, seasonNum, ep, index, episodes) {
        const item = originalBuild.apply(this, arguments);
        if (ep?.luxProviderEpisode) {
          item.luxProviderEpisode = true;
          item.providerPageUrl = ep.providerPageUrl || ep.url || '';
          item.providerSlug = ep.providerSlug || series?.providerSlug || '';
          item.providerName = series?.providerName || '';
        }
        return item;
      };
      wrappedBuild.__luxProviderEpisodeWrapped = true;
      window.buildSeriesEpisodeItem = wrappedBuild;
    }

    const originalPlayer = window.openVodPlayer;
    if (typeof originalPlayer === 'function' && !originalPlayer.__luxProviderEpisodeWrapped) {
      const wrappedPlayer = function(item) {
        if (item?.luxProviderEpisode) {
          const url = String(item.providerPageUrl || item.url || '');
          if (/^https?:\/\//i.test(url)) {
            window.open(url, '_blank', 'noopener,noreferrer');
            return;
          }
        }
        return originalPlayer.apply(this, arguments);
      };
      wrappedPlayer.__luxProviderEpisodeWrapped = true;
      window.openVodPlayer = wrappedPlayer;
    }
  }

  function registerAdapters() {
    if (registered || !window.LuxProviderSources?.registerAdapter) return false;
    providerDefs.forEach(def => {
      try { window.LuxProviderSources.unregisterAdapter?.(def.id); } catch (_) {}
      window.LuxProviderSources.registerAdapter({
        id: def.id,
        name: def.name,
        priority: def.priority,
        enabled: true,
        loadCatalog: () => loadCatalogFor(def)
      });
    });
    registered = true;
    return true;
  }

  async function mergeSearchResults(items) {
    const list = Array.isArray(items) ? items : [];
    list.forEach(item => {
      const slug = String(item?.provider || '');
      if (!providerDefs.some(def => def.slug === slug)) return;
      const bucket = extraResults.get(slug) || [];
      const key = String(item?.url || '');
      if (key && !bucket.some(existing => String(existing?.url || '') === key)) bucket.push(item);
      extraResults.set(slug, bucket);
    });
    if (registerAdapters() && window.LuxProviderSources?.mergeIntoCurrentCatalog) {
      return window.LuxProviderSources.mergeIntoCurrentCatalog({ refreshUi: true });
    }
    return { added: 0, merged: 0, adapters: 0, skipped: true };
  }

  async function syncCatalogNow() {
    if (!registerAdapters() || !window.LuxProviderSources?.mergeIntoCurrentCatalog) return { skipped: true };
    catalogCache.clear();
    return window.LuxProviderSources.mergeIntoCurrentCatalog({ refreshUi: true });
  }

  window.LuxProviderCatalog = {
    version: VERSION,
    mergeSearchResults,
    syncCatalogNow,
    fetchEpisodes: fetchProviderEpisodes,
    clearCache: () => { catalogCache.clear(); episodeCache.clear(); }
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const adaptersReady = registerAdapters();
    const seriesReady = installSeriesBridge();
    installEpisodeBridge();
    if (adaptersReady && seriesReady && attempts > 10) clearInterval(timer);
    if (attempts >= 240) clearInterval(timer);
  }, 100);

  setTimeout(() => {
    try {
      registerAdapters();
      if (typeof allMediaItems !== 'undefined' && Array.isArray(allMediaItems) && allMediaItems.length && window.LuxProviderSources?.mergeIntoCurrentCatalog) {
        window.LuxProviderSources.mergeIntoCurrentCatalog({ refreshUi: true }).catch(error => console.warn('[LUX-IPTV-041] Catálogo inicial dos providers falhou:', error));
      }
    } catch (_) {}
  }, 2200);
})();
