(() => {
  'use strict';

  const VERSION = '20260915-home-series-internal-router-1';
  if (window.__luxHomeSeriesInternalRouter === VERSION) return;
  window.__luxHomeSeriesInternalRouter = VERSION;

  const normalize = value => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(dublado|legendado|dual|4k|fhd|uhd|hd|sd|h265|hevc|pt-br)\b/g, ' ')
    .replace(/^[\s\-–—]+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const resolutionCache = new Map();

  function localSeries() {
    try {
      return Array.isArray(allMediaItems)
        ? allMediaItems.filter(item => String(item?.type || '').toLowerCase() === 'series')
        : [];
    } catch (_) {
      return [];
    }
  }

  function tmdbIdOf(item) {
    const raw = item?.tmdb_id ?? item?.tmdbId ?? item?.metadata?.tmdb_id ?? item?.metadata?.tmdbId;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function matchByNames(names) {
    const aliases = [...new Set((names || []).map(normalize).filter(Boolean))];
    if (!aliases.length) return null;
    const series = localSeries();

    for (const alias of aliases) {
      const exact = series.find(item => normalize(item?.seriesName || item?.name) === alias);
      if (exact) return exact;
    }

    for (const alias of aliases) {
      if (alias.length < 5) continue;
      const relaxed = series.find(item => {
        const name = normalize(item?.seriesName || item?.name);
        return name && (name.startsWith(alias + ' ') || alias.startsWith(name + ' '));
      });
      if (relaxed) return relaxed;
    }
    return null;
  }

  async function tmdbDetails(id) {
    if (!id || typeof TMDB_API_KEY === 'undefined' || !TMDB_API_KEY) return null;
    try {
      const url = 'https://api.themoviedb.org/3/tv/' + encodeURIComponent(id)
        + '?api_key=' + encodeURIComponent(TMDB_API_KEY)
        + '&language=pt-BR&append_to_response=alternative_titles,translations';
      const response = await fetch(url);
      if (!response.ok) return null;
      return await response.json();
    } catch (_) {
      return null;
    }
  }

  function aliasesFromTmdb(details, fallbackTitle = '') {
    const names = [fallbackTitle, details?.name, details?.original_name];
    (details?.alternative_titles?.results || []).forEach(item => {
      names.push(item?.title, item?.name);
    });
    (details?.translations?.translations || []).forEach(item => {
      names.push(item?.data?.name, item?.data?.title);
    });
    return names.filter(Boolean);
  }

  async function searchTmdbId(title) {
    try {
      if (typeof fetchTmdbMetadata === 'function') {
        const metadata = await fetchTmdbMetadata({ type: 'series', name: title, seriesName: title });
        const id = Number(metadata?.id);
        if (Number.isFinite(id) && id > 0) return id;
      }
    } catch (_) {}
    return null;
  }

  async function resolveSeries(title) {
    const key = normalize(title);
    if (!key) return null;
    if (resolutionCache.has(key)) return resolutionCache.get(key);

    const task = (async () => {
      let local = matchByNames([title]);
      if (local) return local;

      const tmdbId = await searchTmdbId(title);
      if (tmdbId) {
        local = localSeries().find(item => tmdbIdOf(item) === tmdbId) || null;
        if (local) return local;

        const details = await tmdbDetails(tmdbId);
        local = matchByNames(aliasesFromTmdb(details, title));
        if (local) {
          if (!tmdbIdOf(local)) local.tmdb_id = tmdbId;
          return local;
        }
      }

      return null;
    })();

    resolutionCache.set(key, task);
    const result = await task;
    if (!result) setTimeout(() => resolutionCache.delete(key), 30_000);
    return result;
  }

  function cardTitle(card) {
    const heading = card?.querySelector('h5');
    return String(heading?.getAttribute('title') || heading?.textContent || '')
      .replace(/^\s*[-–—]\s*/, '')
      .trim();
  }

  function isAutomaticCard(card) {
    return [...(card?.querySelectorAll('span') || [])]
      .some(span => /^(tmdb|imdb)$/i.test(String(span.textContent || '').trim()));
  }

  function openInternal(item) {
    if (!item) return false;
    try {
      if (typeof openSeriesModal === 'function') {
        openSeriesModal(item);
        return true;
      }
      if (typeof openVodPlayer === 'function') {
        openVodPlayer(item);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function unavailable(title) {
    try {
      if (typeof showToast === 'function') return showToast(`“${title}” ainda não está disponível no catálogo do Lux.`);
    } catch (_) {}
    try {
      if (typeof showNotification === 'function') return showNotification(`“${title}” ainda não está disponível no catálogo do Lux.`);
    } catch (_) {}
    alert(`“${title}” ainda não está disponível no catálogo do Lux.`);
  }

  document.addEventListener('click', async event => {
    const container = event.target?.closest?.('#homeSeriesLancamentosContainer');
    if (!container) return;

    let card = event.target;
    while (card && card.parentElement !== container) card = card.parentElement;
    if (!card || !isAutomaticCard(card)) return;

    const title = cardTitle(card);
    if (!title) return;

    // Impede o handler original de abrir TMDB/IMDb. A resolução acontece
    // somente contra o catálogo atual do Lux, no momento do clique.
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (card.dataset.luxResolving === '1') return;
    card.dataset.luxResolving = '1';
    const previousOpacity = card.style.opacity;
    card.style.opacity = '0.72';

    try {
      const item = await resolveSeries(title);
      if (!openInternal(item)) unavailable(title);
    } finally {
      card.dataset.luxResolving = '0';
      card.style.opacity = previousOpacity;
    }
  }, true);
})();
