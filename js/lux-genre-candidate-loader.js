// Nonblocking TMDB Discover matching for the original Lux Player.
// Only public TMDB data is downloaded; private playlist URLs remain on-device.
(function (root) {
  'use strict';
  var ROUNDS = 3;
  var BATCHES_BY_KIND = { movies: 5, series: 4 };
  var TTL = 3 * 24 * 60 * 60 * 1000;
  var inFlight = false;
  var retryAfter = 0;
  var resumeContext = null;

  function storageRead(key) {
    try { return JSON.parse(root.localStorage.getItem(key) || '{}') || {}; }
    catch (_) { return {}; }
  }
  function storageWrite(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); }
    catch (_) { /* cache is optional */ }
  }
  function signature(items) {
    return [items.length, items[0]?.id || '', items[items.length - 1]?.id || ''].join(':');
  }
  function status(value) {
    root.LuxSmartGenres?.setIndexStatus(value);
    try { resumeContext?.onUpdate?.(); } catch (_) { /* UI optional */ }
  }
  function stillActive(ctx) {
    return typeof ctx.isActive === 'function' && ctx.isActive();
  }

  async function run(items, ctx) {
    if (inFlight || Date.now() < retryAfter || !root.LuxSmartGenres?.createCatalogIndex
        || !Array.isArray(items) || !items.length || !stillActive(ctx)) return false;
    const genres = root.LuxSmartGenres;
    const kind = ctx.kind === 'series' ? 'series' : 'movies';
    const BATCHES = BATCHES_BY_KIND[kind];
    const TOTAL = BATCHES * ROUNDS;
    const cacheKey = 'lux_discover_index_v5:' + kind + ':' + signature(items);
    const stored = storageRead(cacheKey);
    const fresh = Number(stored.at) > 0 && Date.now() - Number(stored.at) < TTL
      && Number(stored.cursor) >= 0;
    let cursor = fresh ? Math.max(0, Math.min(TOTAL, Number(stored.cursor) || 0)) : 0;
    if (cursor >= TOTAL) {
      status({ status: 'ready', processed: TOTAL, total: TOTAL });
      return true;
    }

    inFlight = true;
    resumeContext = { items, ctx, onUpdate: ctx.onUpdate };
    let added = 0;
    const index = genres.createCatalogIndex(items);
    status({ status: 'loading', processed: cursor, total: TOTAL, matched: 0 });

    try {
      while (cursor < TOTAL && stillActive(ctx)) {
        const batch = cursor % BATCHES;
        const round = Math.floor(cursor / BATCHES);
        const controller = new AbortController();
        const deadline = root.setTimeout(() => controller.abort(), 16000);
        let payload;
        try {
          const response = await root.fetch('/api/tmdb-movie-candidates?kind=' + kind + '&batch=' + batch + '&round=' + round, {
            signal: controller.signal,
            credentials: 'omit'
          });
          if (!response.ok) throw new Error('TMDB candidate cache: HTTP ' + response.status);
          payload = await response.json();
          if (payload?.version !== 1 || payload?.kind !== kind || !Array.isArray(payload.rows)) throw new Error('Invalid candidate payload');
          if (payload.complete === false) throw new Error('TMDB candidate batch incomplete; retry later');
        } finally {
          root.clearTimeout(deadline);
        }
        added += genres.ingestCandidates(index, payload.rows);
        cursor++;
        storageWrite(cacheKey, { cursor, at: Date.now() });
        status({ status: 'loading', processed: cursor, total: TOTAL, matched: added });
        // Yield to rendering and playback between small CDN requests.
        await new Promise(resolve => root.setTimeout(resolve, 500));
      }
      status({ status: cursor >= TOTAL ? 'ready' : 'paused', processed: cursor, total: TOTAL, matched: added });
      return cursor >= TOTAL;
    } catch (error) {
      console.warn('[Lux Genres] TMDB discovery unavailable; using provider categories.', error);
      retryAfter = Date.now() + 2 * 60 * 1000;
      status({ status: 'error', processed: cursor, total: TOTAL, matched: added });
      return false;
    } finally {
      inFlight = false;
    }
  }

  root.document?.addEventListener('visibilitychange', function () {
    if (root.document.hidden || inFlight || !resumeContext) return;
    const context = resumeContext;
    if (stillActive(context.ctx)) void run(context.items, context.ctx);
  });
  root.LuxGenreCandidateLoader = {
    start: function (items, ctx) { return run(items, ctx); },
    isBusy: function () { return inFlight; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
