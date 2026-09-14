(() => {
  'use strict';

  const VERSION = '20260914-provider-routing-1';
  if (window.__luxProviderCatalogRoutingInstalled === VERSION) return;
  window.__luxProviderCatalogRoutingInstalled = VERSION;

  const SERIES_GROUP = 'Séries | Animes ⚡ PLUS';
  const MOVIE_GROUP = 'Filmes | Anime ⚡ PLUS';

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function inferProviderType(item) {
    const explicit = String(item?.providerMediaType || item?.mediaType || item?.type || '').toLowerCase();
    if (['movies', 'movie', 'film', 'filme'].includes(explicit)) return 'movies';
    if (['series', 'serie', 'anime'].includes(explicit)) return 'series';

    const title = normalize(item?.name || item?.title || item?.seriesName);
    const url = normalize(item?.providerUrl || item?.url);
    const combined = `${title} ${url}`;

    if (/\/(filmes?|movies?)\//i.test(String(item?.providerUrl || item?.url || ''))) return 'movies';
    if (/\b(filme|movie|gekijouban|the movie|longa metragem|longa-metragem)\b/i.test(combined)) return 'movies';
    return 'series';
  }

  function routeProviderItem(item) {
    if (!item || String(item?.luxSourceRole || '') !== 'provider') return item;
    const type = inferProviderType(item);
    item.type = type;
    item.group = type === 'movies' ? MOVIE_GROUP : SERIES_GROUP;
    item.providerMediaType = type;
    return item;
  }

  function routeAll() {
    try {
      if (typeof allMediaItems === 'undefined' || !Array.isArray(allMediaItems)) return 0;
      let changed = 0;
      allMediaItems.forEach(item => {
        if (String(item?.luxSourceRole || '') !== 'provider') return;
        const oldType = item.type;
        const oldGroup = item.group;
        routeProviderItem(item);
        if (oldType !== item.type || oldGroup !== item.group) changed += 1;
      });
      if (changed) {
        try {
          if (typeof renderCategories === 'function') renderCategories();
          if (typeof filterMedia === 'function') filterMedia();
        } catch (_) {}
      }
      return changed;
    } catch (_) {
      return 0;
    }
  }

  window.LuxProviderRouting = {
    version: VERSION,
    routeItem: routeProviderItem,
    routeAll,
    inferType: inferProviderType,
    groups: { series: SERIES_GROUP, movies: MOVIE_GROUP }
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    routeAll();
    if (attempts >= 180) clearInterval(timer);
  }, 250);
})();
