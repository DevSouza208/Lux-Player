// Lightweight genre navigation for Lux Player. No network requests and no catalogue duplication.
(function (root) {
  'use strict';

  var PREFIX = '__lux_genre_';
  var COLLECTION = '__lux_collection_';
  var CACHE_KEY = 'lux_smart_genres_v1';
  var CACHE_LIMIT = 1500;
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
    [37, 'Faroeste', /\b(faroeste|western)\b/]
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
    var year = (raw.match(/\b(?:19|20)\d{2}\b/) || [])[0] || '';
    var title = normalize(raw.replace(/\((?:19|20)\d{2}\)/g, ' ')
      .replace(/\b(2160p|1080p|720p|4k|uhd|fhd|dublado|legendado|dual audio|hevc|h265)\b/gi, ' '));
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

  function genreIds(item) {
    if (!item || item.isAdult || item.type !== 'movies') return [];
    var base = groupGenreIds(item.group);
    if (!tmdbByTitle.size) return base;
    var key = titleKey(item);
    var extra = tmdbByTitle.get(key);
    if (!extra || !extra.ids.length) return base;
    return base.length ? Array.from(new Set(base.concat(extra.ids))) : extra.ids;
  }

  function matches(item, key) {
    if (!item || item.type !== 'movies') return false;
    if (key.indexOf(PREFIX) === 0) {
      var genre = Number(key.slice(PREFIX.length));
      return !item.isAdult && genreIds(item).includes(genre);
    }
    if (key.indexOf(COLLECTION) === 0) return collectionYear(item.group) === key.slice(COLLECTION.length);
    return item.group === key;
  }

  function label(key) {
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
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var group = String(item.group || '');
      rawCounts.set(group, (rawCounts.get(group) || 0) + 1);
      if (item.isAdult) adultGroups.add(group);
      var year = collectionYear(group);
      if (year) {
        var yearKey = COLLECTION + year;
        counts.set(yearKey, (counts.get(yearKey) || 0) + 1);
      }
      var ids = genreIds(item);
      for (var j = 0; j < ids.length; j++) {
        var genreKey = PREFIX + ids[j];
        counts.set(genreKey, (counts.get(genreKey) || 0) + 1);
      }
    }
    var years = Array.from(counts.keys()).filter(function (k) { return k.indexOf(COLLECTION) === 0; })
      .sort(function (a, b) { return b.localeCompare(a); });
    var genreKeys = GENRES.map(function (g) { return PREFIX + g[0]; })
      .filter(function (k) { return (counts.get(k) || 0) > 0; });
    var other = orderedRawGroups.filter(function (group) {
      if (adultGroups.has(group) || isAdultGroup(group)) return true;
      return !collectionYear(group) && groupGenreIds(group).length === 0;
    });
    rawCounts.forEach(function (count, group) { counts.set(group, count); });
    return {
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
        if (!Array.isArray(row) || row.length !== 3 ||
            typeof row[0] !== 'string' || !Array.isArray(row[1]) ||
            typeof row[2] !== 'number' || now - row[2] > CACHE_TTL) return;
        var ids = row[1].filter(function (id) { return LABELS.has(id); });
        if (ids.length) tmdbByTitle.set(row[0], { ids: ids, at: row[2] });
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
          return [entry[0], entry[1].ids, entry[1].at];
        })));
      } catch (_) { /* Quota/storage failures must not affect playback. */ }
    }, 1500);
  }

  function learn(item, metadata) {
    if (!item || item.isAdult || item.type !== 'movies' || !metadata) return false;
    var key = titleKey(item);
    var actual = normalize(String(metadata.title || '').replace(/\((?:19|20)\d{2}\)/g, ' '));
    var wanted = key.split('|')[0];
    var expectedYear = key.split('|')[1];
    var receivedYear = String(metadata.releaseDate || '').slice(0, 4);
    // Refuse fuzzy or year-mismatched TMDB hits. Never assign genres to an uncertain title.
    if (!key || !actual || actual !== wanted || (expectedYear && receivedYear && expectedYear !== receivedYear)) return false;
    var ids = (Array.isArray(metadata.genreIds) ? metadata.genreIds : [])
      .map(Number).filter(function (id) { return LABELS.has(id); });
    if (!ids.length) return false;
    var old = tmdbByTitle.get(key);
    if (old && ids.length === old.ids.length && ids.every(function (id) { return old.ids.includes(id); })) return false;
    tmdbByTitle.delete(key);
    tmdbByTitle.set(key, { ids: ids, at: Date.now() });
    if (tmdbByTitle.size > CACHE_LIMIT) tmdbByTitle.delete(tmdbByTitle.keys().next().value);
    persistCache();
    return true;
  }

  loadCache();
  root.LuxSmartGenres = {
    navigation: navigation,
    matches: matches,
    label: label,
    learn: learn,
    genreIds: genreIds,
    genreKey: function (id) { return PREFIX + id; },
    collectionKey: function (year) { return COLLECTION + year; },
    isSmart: function (key) { return typeof key === 'string' && (key.indexOf(PREFIX) === 0 || key.indexOf(COLLECTION) === 0); }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.LuxSmartGenres;
})(typeof window !== 'undefined' ? window : globalThis);
