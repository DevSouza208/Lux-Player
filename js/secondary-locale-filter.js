(() => {
  'use strict';

  const VERSION = '20260914-secondary-locale1';
  if (window.__luxSecondaryLocaleInstalled === VERSION) return;
  window.__luxSecondaryLocaleInstalled = VERSION;

  const INTERNATIONAL_GROUP = '🌍 Internacional';

  const PT_RE = /(?:\bpt[-_ ]?br\b|\bpt[-_ ]?pt\b|\bportugu[eê]s(?:a)?\b|\bportuguese\b|\bbrasil(?:eiro|eira)?\b|\bbrazil(?:ian)?\b|\bportugal\b|\bdublado\b|\blegendado\b|\bdual\s*audio\s*pt\b|\b[aá]udio\s*pt\b)/i;
  const FOREIGN_RE = /(?:\benglish\b|\bingl[eê]s\b|\bspanish\b|\bespa[nñ]ol\b|\bespanhol\b|\blatino\b|\bfrench\b|\bfran[cç]ais\b|\bfranc[eê]s\b|\bgerman\b|\bdeutsch\b|\balem[aã]o\b|\bitalian\b|\bitaliano\b|\bjapanese\b|\bjapon[eê]s\b|\bkorean\b|\bcoreano\b|\bchinese\b|\bmandarin\b|\bchin[eê]s\b|\barabic\b|\b[aá]rabe\b|\brussian\b|\brusso\b|\bhindi\b|\bturkish\b|\bturco\b|\bdutch\b|\bholand[eê]s\b|\bpolish\b|\bpolon[eê]s\b|\bgreek\b|\bgrego\b|\bthai\b|\bvietnamese\b|\bindonesian\b|\bfilipino\b|\bukrainian\b|\bpersian\b|\bswedish\b|\bnorwegian\b|\bdanish\b|\bfinnish\b)/i;
  const GLOBAL_SOURCE_RE = /(?:\bglobal\b|\bworld\b|\bmundo\b|\binternacional\b|\binternational\b)/i;
  const PT_SOURCE_RE = /(?:\bpt[-_ ]?br\b|\bportugu[eê]s\b|\bbrasil\b|\bbrazil\b|\bportugal\b)/i;
  const JUNK_RE = /^(?:\s*(?:lista\s+)?atualizad[oa]\b|\s*voc[eê]\s+[eé]\s+premium\b|\s*seja\s+premium\b|\s*lista\s+exclusiva\b|\s*contato\s*[:\-]?\s*$|\s*whats?app\s*[:\-]?\s*$|\s*telegram\s*[:\-]?\s*$|\s*suporte\s*[:\-]?\s*$|\s*publicidade\s*$|\s*propaganda\s*$|\s*an[uú]ncio\s*$)/i;

  function text(value) {
    return String(value ?? '').trim();
  }

  function sourceName(item) {
    return text(item?.luxSourceName || item?.luxSources?.find?.(entry => entry?.role === 'secondary')?.name || '');
  }

  function signal(item) {
    return [
      item?.name,
      item?.title,
      item?.seriesName,
      item?.group,
      item?.category,
      item?.category_name,
      sourceName(item)
    ].map(text).filter(Boolean).join(' | ');
  }

  function isSecondary(item) {
    return item?.luxSourceRole === 'secondary' || Boolean(item?.luxSourceId);
  }

  function classify(item) {
    if (!isSecondary(item)) return 'primary';
    const combined = signal(item);
    const source = sourceName(item);

    // Sinais em português ganham sempre de sinais genéricos da fonte.
    if (PT_RE.test(combined) || PT_SOURCE_RE.test(source)) return 'pt';
    if (FOREIGN_RE.test(combined)) return 'international';

    // Fontes explicitamente globais ficam separadas quando o item não traz
    // nenhum indício de PT-BR/PT. Assim listas mundiais não poluem as categorias locais.
    if (GLOBAL_SOURCE_RE.test(source)) return 'international';
    return 'unknown';
  }

  function isJunk(item) {
    if (!isSecondary(item)) return false;
    const title = text(item?.seriesName || item?.name || item?.title);
    return Boolean(title && JUNK_RE.test(title));
  }

  function organizeItem(item) {
    if (!item || !isSecondary(item)) return false;
    const bucket = classify(item);
    let changed = item.luxLocaleBucket !== bucket;
    item.luxLocaleBucket = bucket;

    if (bucket === 'international') {
      if (!item.luxOriginalGroup) item.luxOriginalGroup = text(item.group || item.category || item.category_name);
      if (item.group !== INTERNATIONAL_GROUP) {
        item.group = INTERNATIONAL_GROUP;
        changed = true;
      }
      item.luxInternational = true;
    } else {
      item.luxInternational = false;
    }

    if (item?.m3uEpisodes && typeof item.m3uEpisodes === 'object') {
      Object.values(item.m3uEpisodes).forEach(episodes => {
        if (!Array.isArray(episodes)) return;
        episodes.forEach(episode => {
          if (!episode || !isSecondary(episode)) return;
          episode.luxLocaleBucket = classify(episode);
          episode.luxInternational = episode.luxLocaleBucket === 'international';
        });
      });
    }
    return changed;
  }

  function organizeCatalog() {
    let catalog;
    try { catalog = typeof allMediaItems !== 'undefined' ? allMediaItems : null; } catch (_) { catalog = null; }
    if (!Array.isArray(catalog) || !catalog.length) return { changed: 0, removed: 0, international: 0, pt: 0, unknown: 0 };

    let changed = 0;
    let removed = 0;
    const counts = { international: 0, pt: 0, unknown: 0 };

    for (let index = catalog.length - 1; index >= 0; index -= 1) {
      const item = catalog[index];
      if (!isSecondary(item)) continue;
      if (isJunk(item)) {
        catalog.splice(index, 1);
        removed += 1;
        continue;
      }
      if (organizeItem(item)) changed += 1;
      const bucket = item.luxLocaleBucket;
      if (bucket in counts) counts[bucket] += 1;
    }

    return { changed, removed, ...counts };
  }

  function installCategoryBridge() {
    const original = window.getSharedCategoryForItem;
    if (typeof original !== 'function') return false;
    if (original.__luxSecondaryLocaleWrapped) return true;

    const wrapped = function (item) {
      if (isSecondary(item)) {
        organizeItem(item);
        if (item?.luxLocaleBucket === 'international') return INTERNATIONAL_GROUP;
      }
      return original.apply(this, arguments);
    };
    wrapped.__luxSecondaryLocaleWrapped = true;
    wrapped.__luxSecondaryLocaleOriginal = original;
    window.getSharedCategoryForItem = wrapped;
    return true;
  }

  function installSectionBridge() {
    const original = window.setSection;
    if (typeof original !== 'function') return false;
    if (original.__luxSecondaryLocaleWrapped) return true;

    const wrapped = function () {
      organizeCatalog();
      return original.apply(this, arguments);
    };
    wrapped.__luxSecondaryLocaleWrapped = true;
    wrapped.__luxSecondaryLocaleOriginal = original;
    window.setSection = wrapped;
    return true;
  }

  function installMergeBridge() {
    const api = window.LuxSecondarySources;
    if (!api || typeof api.mergeIntoCurrentCatalog !== 'function') return false;
    const original = api.mergeIntoCurrentCatalog;
    if (original.__luxSecondaryLocaleWrapped) return true;

    const wrapped = async function () {
      const result = await original.apply(this, arguments);
      const locale = organizeCatalog();
      console.info('[LUX-IPTV-036] Organização PT/internacional aplicada:', locale);
      return { ...(result || {}), locale };
    };
    wrapped.__luxSecondaryLocaleWrapped = true;
    wrapped.__luxSecondaryLocaleOriginal = original;
    api.mergeIntoCurrentCatalog = wrapped;
    return true;
  }

  window.LuxSecondaryLocale = {
    version: VERSION,
    classify,
    organizeCatalog,
    internationalGroup: INTERNATIONAL_GROUP
  };

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    installCategoryBridge();
    installSectionBridge();
    installMergeBridge();
    organizeCatalog();
    if (attempts >= 120) clearInterval(timer);
  }, 250);

  // Também organiza novamente após o carregamento inicial das M3Us secundárias.
  setTimeout(() => {
    const result = organizeCatalog();
    console.info('[LUX-IPTV-036] Filtro de idioma das fontes secundárias:', result);
  }, 1800);
})();
