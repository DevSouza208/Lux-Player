// Lightweight genre navigation for Lux Player. No network requests and no catalogue duplication.
(function (root) {
  'use strict';

  var PREFIX = '__lux_genre_';
  var COLLECTION = '__lux_collection_';
  var UNCLASSIFIED = '__lux_genre_unclassified__';
  var CACHE_KEY = 'lux_smart_genres_v1';
  var CACHE_LIMIT = 32000;
  var CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
  var GENRES = [
    [28, 'Ação', /\b(acao|action)\b/],
    [12, 'Aventura', /\b(adventure|aventura)\b/],
    [16, 'Animação', /\b(animacao|animation|anime)\b/],
    [35, 'Comédia', /\b(comedia|comedy)\b/],
    [80, 'Crime', /\b(crime|policial)\b/],
    [99, 'Documentários', /\b(documentario|documentarios|documentary)\b/],
    [18, 'Drama', /\bdrama\b/],
    [10751, 'Família', /\b(familia|family|infantil)\b/],
    [14, 'Fantasia', /\b(fantasia|fantasy)\b/],
    [36, 'História', /\b(historia|history|historico)\b/],
    [27, 'Terror', /\b(terror|horror)\b/],
    [10402, 'Música', /\b(musica|musical|music)\b/],
    [9648, 'Mistério', /\b(misterio|mystery)\b/],
    [10749, 'Romance', /\b(romance|romantico|romantica)\b/],
    [878, 'Ficção científica', /\b(ficcao cientifica|sci fi|scifi|science fiction)\b/],
    [10770, 'Cinema e TV', /\b(cinema tv|cinematv|telefilme|tv movie)\b/],
    [53, 'Suspense', /\b(suspense|thriller)\b/],
    [10752, 'Guerra', /\b(guerra|war)\b/],
    [37, 'Faroeste', /\b(faroeste|western)\b/],
    [10764, 'Reality Shows', /\b(reality|reality show)\b/],
    [10766, 'Novelas', /\b(novela|novelas|soap opera|soap)\b/],
    [10762, 'Infantil', /\b(kids|infantil|criancas)\b/],
    [10767, 'Talk Shows', /\b(talk show|entrevista|entrevistas)\b/]
  ];
  var LABELS = new Map(GENRES.map(function (g) { return [g[0], g[1]]; }));
  var groupCache = new Map();
  var itemKeys = new WeakMap();
  var tmdbByTitle = new Map();
  var saveTimer = 0;

  function normalize(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function titleKey(item) {
    if (itemKeys.has(item)) return itemKeys.get(item);
    var raw = String(item.name || '');
    var fromBrackets = raw.match(/[\[(]((?:19|20)\d{2})[\])]/);
    var fromSuffix = raw.match(/[\s|_-]((?:19|20)\d{2})\s*$/);
    var year = String(item.year || fromBrackets?.[1] || fromSuffix?.[1] || '');
    if (!/^(19|20)\d{2}$/.test(year)) year = '';
    var cleaned = raw.replace(/\((?:19|20)\d{2}\)/g, ' ')
      .replace(/\[(?:19|20)\d{2}\]/g, ' ')
      .replace(/\b(2160p|1080p|720p|4k|uhd|fhd|dublado|legendado|dual audio|hevc|h265|bluray|web dl|brrip)\b/gi, ' ');
    if (year) cleaned = cleaned.replace(new RegExp('(?:\\s|[|_-])' + year + '(?:\\s|$)', 'g'), ' ');
    var title = normalize(cleaned.replace(/\[[^\]]+\]/g, ' '));
    var key = title ? title + '|' + year : '';
    itemKeys.set(item, key);
    return key;
  }

  function cleanGroup(group) {
    return normalize(String(group || '').replace(/[⚡⭐★].*$/, '')
      .replace(/\b(plus|pll|premium|vip)\b/gi, ' '));
  }

  function groupGenreIds(group) {
    var name = String(group || '');
    if (groupCache.has(name)) return groupCache.get(name);
    var clean = cleanGroup(name);
    var ids = GENRES.filter(function (genre) { return genre[2].test(clean); })
      .map(function (genre) { return genre[0]; });
    groupCache.set(name, ids);
    return ids;
  }

  function collectionYear(group) {
    var match = cleanGroup(group).match(/\b(?:lancamentos?|novidades?|estreias?)\s*(20[2-3]\d)\b/);
    return match ? match[1] : '';
  }

  function isAdultGroup(group) {
    return /\b(adult|adulto|xxx|erotico|porn)\b|\+18|18\+/i.test(normalize(group)) ||
      /(?:^|\W)18\+(?:$|\W)/.test(String(group || ''));
  }

  function scopeKey(item) {
    var key = titleKey(item);
    return item.type === 'series' ? 'tv|' + key : key;
  }

  function canonicalGenreIds(ids, kind) {
    var mapped = [];
    for (var i = 0; i < (Array.isArray(ids) ? ids.length : 0); i++) {
      var id = Number(ids[i]);
      if (kind === 'series') {
        if (id === 10759) mapped.push(28, 12);
        else if (id === 10765) mapped.push(878, 14);
        else if (id === 10768) mapped.push(10752);
        else if (id === 10762) mapped.push(10762, 10751);
        else if (LABELS.has(id)) mapped.push(id);
      } else if (LABELS.has(id)) mapped.push(id);
    }
    return Array.from(new Set(mapped));
  }

  function genreIds(item) {
    if (!item || item.isAdult || (item.type !== 'movies' && item.type !== 'series')) return [];
    var base = groupGenreIds(item.group);
    var own = canonicalGenreIds(item.providerGenreIds, item.type);
    if (item.providerGenreText) own = own.concat(groupGenreIds(item.providerGenreText));
    if (!tmdbByTitle.size) return Array.from(new Set(base.concat(own)));
    var extra = tmdbByTitle.get(scopeKey(item));
    return Array.from(new Set(base.concat(own, extra?.ids || [])));
  }

  function matches(item, key) {
    if (!item || (item.type !== 'movies' && item.type !== 'series')) return false;
    if (key === UNCLASSIFIED) return !item.isAdult && genreIds(item).length === 0;
    if (key.indexOf(PREFIX) === 0) {
      var genre = Number(key.slice(PREFIX.length));
      return !item.isAdult && genreIds(item).includes(genre);
    }
    if (key.indexOf(COLLECTION) === 0) return !item.isAdult && collectionYear(item.group) === key.slice(COLLECTION.length);
    return item.group === key;
  }

  function label(key) {
    if (key === UNCLASSIFIED) return 'Sem gênero identificado';
    if (key.indexOf(PREFIX) === 0) return LABELS.get(Number(key.slice(PREFIX.length))) || 'Gênero';
    if (key.indexOf(COLLECTION) === 0) return 'Lançamentos ' + key.slice(COLLECTION.length);
    if (isAdultGroup(key)) return key;
    var cleaned = String(key || '').replace(/^\s*(?:filmes?|movies?)\s*[|»:-]\s*/i, '')
      .replace(/\s*[⚡⭐★]\s*(?:plus|pll|premium|vip)?\s*$/i, '').trim();
    if (normalize(cleaned) === 'filmes') return 'Catálogo geral';
    return cleaned || key;
  }

  function navigation(items, orderedRawGroups) {
    var counts = new Map();
    var rawCounts = new Map();
    var adultGroups = new Set();
    var unclassified = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var group = String(item.group || '');
      rawCounts.set(group, (rawCounts.get(group) || 0) + 1);
      if (item.isAdult) adultGroups.add(group);
      var year = collectionYear(group);
      if (year && !item.isAdult) {
        var yearKey = COLLECTION + year;
        counts.set(yearKey, (counts.get(yearKey) || 0) + 1);
      }
      var ids = genreIds(item);
      if (!item.isAdult && !ids.length) unclassified++;
      for (var j = 0; j < ids.length; j++) {
        var genreKey = PREFIX + ids[j];
        counts.set(genreKey, (counts.get(genreKey) || 0) + 1);
      }
    }
    var years = Array.from(counts.keys()).filter(function (k) { return k.indexOf(COLLECTION) === 0; })
      .sort(function (a, b) { return b.localeCompare(a); });
    // Keep genre filters visible while metadata is still being learned.
    // Counts are identified entries only; the UI adds '+' if classification is incomplete.
    var genreKeys = GENRES.map(function (g) { return PREFIX + g[0]; })
      .filter(function (key) { return (counts.get(key) || 0) > 0; });
    var other = orderedRawGroups.filter(function (group) {
      if (adultGroups.has(group) || isAdultGroup(group)) return true;
      return !collectionYear(group) && groupGenreIds(group).length === 0
        && !/^(filmes?|movies?|catalogo geral)$/i.test(cleanGroup(group));
    });
    rawCounts.forEach(function (count, group) { counts.set(group, count); });
    counts.set(UNCLASSIFIED, unclassified);
    if (unclassified) other.unshift(UNCLASSIFIED);
    return {
      unclassified: unclassified,
      counts: counts,
      sections: [
        { title: 'COLEÇÕES', keys: years },
        { title: 'GÊNEROS', keys: genreKeys },
        { title: 'OUTRAS CATEGORIAS', keys: other }
      ]
    };
  }

  function loadCache() {
    try {
      var saved = JSON.parse(root.localStorage.getItem(CACHE_KEY) || '[]');
      if (!Array.isArray(saved)) return;
      var now = Date.now();
      saved.slice(-CACHE_LIMIT).forEach(function (row) {
        if (!Array.isArray(row) || (row.length !== 3 && row.length !== 4) ||
            typeof row[0] !== 'string' || !Array.isArray(row[1]) ||
            typeof row[2] !== 'number' || now - row[2] > CACHE_TTL) return;
        var ids = row[1].filter(function (id) { return LABELS.has(id); });
        if (ids.length) tmdbByTitle.set(row[0], { ids: ids, at: row[2], source: row[3] === 'discover' ? 'discover' : 'detail' });
      });
    } catch (_) { /* Storage is optional. */ }
  }

  function persistCache() {
    if (saveTimer) return;
    saveTimer = root.setTimeout(function () {
      saveTimer = 0;
      try {
        var recent = Array.from(tmdbByTitle.entries()).slice(-CACHE_LIMIT);
        root.localStorage.setItem(CACHE_KEY, JSON.stringify(recent.map(function (entry) {
          return [entry[0], entry[1].ids, entry[1].at, entry[1].source || 'detail'];
        })));
      } catch (_) { /* Quota/storage failures must not affect playback. */ }
    }, 6000);
  }

  function learn(item, metadata) {
    if (!item || item.isAdult || (item.type !== 'movies' && item.type !== 'series') || !metadata) return false;
    var key = titleKey(item);
    var actual = normalize(String(metadata.title || '').replace(/\((?:19|20)\d{2}\)/g, ' '));
    var wanted = key.split('|')[0];
    var expectedYear = key.split('|')[1];
    var receivedYear = String(metadata.releaseDate || '').slice(0, 4);
    // Refuse fuzzy or year-mismatched TMDB hits. Never assign genres to an uncertain title.
    if (!key || !actual || actual !== wanted || (expectedYear && receivedYear && expectedYear !== receivedYear)) return false;
    var ids = canonicalGenreIds(metadata.genreIds, item.type);
    if (!ids.length) return false;
    var scoped = scopeKey(item);
    var old = tmdbByTitle.get(scoped);
    if (old && ids.length === old.ids.length && ids.every(function (id) { return old.ids.includes(id); })) return false;
    tmdbByTitle.delete(scoped);
    tmdbByTitle.set(scoped, { ids: ids, at: Date.now(), source: 'detail' });
    if (tmdbByTitle.size > CACHE_LIMIT) tmdbByTitle.delete(tmdbByTitle.keys().next().value);
    persistCache();
    return true;
  }

  // One index pass across the provider catalogue; incoming TMDB candidate
  // batches are matched in O(candidate-count), never O(31k * candidate-count).
  function createCatalogIndex(items) {
    var byTitle = new Map();
    var valid = 0;
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (!item || (item.type !== 'movies' && item.type !== 'series') || item.isAdult) continue;
      var key = titleKey(item);
      var name = key.split('|')[0];
      if (!name || (name.length < 4 && !key.split('|')[1])) continue;
      var bucket = byTitle.get(name);
      if (!bucket) { bucket = []; byTitle.set(name, bucket); }
      bucket.push({ item: item, key: scopeKey(item), year: key.split('|')[1] });
      valid++;
    }
    return { byTitle: byTitle, valid: valid, total: items.length,
      kind: items.find(function (item) { return item?.type === 'movies' || item?.type === 'series'; })?.type || 'movies' };
  }

  function ingestCandidates(index, candidates) {
    if (!index || !index.byTitle || !Array.isArray(candidates)) return 0;
    var identified = 0;
    for (var i = 0; i < candidates.length; i++) {
      var row = candidates[i];
      if (!row || row.adult) continue;
      var ids = canonicalGenreIds(row.genre_ids, index.kind);
      if (!ids.length) continue;
      var candidateYear = String(row.release_date || row.first_air_date || '').slice(0, 4);
      var names = new Set([normalize(row.title), normalize(row.original_title), normalize(row.name), normalize(row.original_name)].filter(Boolean));
      var matchedKeys = new Set();
      for (const name of names) {
        var bucket = index.byTitle.get(name);
        if (!bucket) continue;
        for (var j = 0; j < bucket.length; j++) {
          var match = bucket[j];
          if (matchedKeys.has(match.key)) continue;
          if (match.year && candidateYear && Math.abs(Number(match.year) - Number(candidateYear)) > 1) continue;
          var old = tmdbByTitle.get(match.key);
          // When provider year is unknown, keep the first (highest-ranked)
          // exact-title candidate instead of merging different remakes.
          if (old?.source === 'discover') continue;
          if (old && old.ids.length && old.ids.every(function (id) { return ids.includes(id); })) continue;
          var combined = old && old.source !== 'discover'
            ? Array.from(new Set(old.ids.concat(ids))) : ids;
          tmdbByTitle.set(match.key, { ids: combined, at: Date.now(), source: 'discover' });
          if (!old) identified++;
          matchedKeys.add(match.key);
        }
      }
    }
    while (tmdbByTitle.size > CACHE_LIMIT) tmdbByTitle.delete(tmdbByTitle.keys().next().value);
    if (identified) persistCache();
    return identified;
  }

  var indexState = { status: 'idle', processed: 0, total: 0, matched: 0 };
  function setIndexStatus(patch) {
    indexState = Object.assign({}, indexState, patch);
  }

  loadCache();
  root.LuxSmartGenres = {
    navigation: navigation,
    matches: matches,
    label: label,
    learn: learn,
    hasMetadata: function (item) { return tmdbByTitle.has(scopeKey(item)); },
    isGenre: function (key) { return typeof key === 'string' && key.indexOf(PREFIX) === 0 && key !== UNCLASSIFIED; },
    genreIds: genreIds,
    canonicalGenreIds: canonicalGenreIds,
    createCatalogIndex: createCatalogIndex,
    ingestCandidates: ingestCandidates,
    setIndexStatus: setIndexStatus,
    indexStatus: function () { return Object.assign({}, indexState); },
    genreKey: function (id) { return PREFIX + id; },
    collectionKey: function (year) { return COLLECTION + year; },
    isSmart: function (key) { return typeof key === 'string' && (key.indexOf(PREFIX) === 0 || key.indexOf(COLLECTION) === 0); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LuxSmartGenres;
})(typeof window !== 'undefined' ? window : globalThis);
