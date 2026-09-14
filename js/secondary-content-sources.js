(() => {
  'use strict';

  const VERSION = '20260914-secondary-sources-1';
  if (window.__luxSecondaryContentSourcesInstalled === VERSION) return;
  window.__luxSecondaryContentSourcesInstalled = VERSION;

  const FUNCTION_NAME = 'content-sources';
  const AUTO_MERGE_SCORE = 95;
  const REVIEW_SCORE = 75;
  const MAX_REVIEW_QUEUE = 60;
  let mergeRunning = false;
  let adminSources = [];
  let adminReviews = [];

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

  async function invoke(action, extra = {}) {
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) throw new Error('Serviço de nuvem indisponível.');
    const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
      body: authBody({ action, ...extra })
    });
    if (error) throw new Error(data?.error || error.message || 'Não foi possível acessar as fontes.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function functionUrl() {
    try {
      if (typeof SUPABASE_URL !== 'undefined' && SUPABASE_URL) return `${String(SUPABASE_URL).replace(/\/+$/, '')}/functions/v1/${FUNCTION_NAME}`;
    } catch (_) {}
    const base = String(supabaseClient?.supabaseUrl || '').replace(/\/+$/, '');
    return base ? `${base}/functions/v1/${FUNCTION_NAME}` : '';
  }

  function publishableKey() {
    try { if (typeof SUPABASE_PUBLISHABLE_KEY !== 'undefined') return SUPABASE_PUBLISHABLE_KEY; } catch (_) {}
    return String(supabaseClient?.supabaseKey || '');
  }

  async function fetchPlaylist(sourceId) {
    const endpoint = functionUrl();
    if (!endpoint) throw new Error('Endereço do serviço de fontes indisponível.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          apikey: publishableKey()
        },
        body: JSON.stringify(authBody({ action: 'playlist', id: sourceId }))
      });
      if (!response.ok) {
        let message = `Fonte respondeu HTTP ${response.status}.`;
        try { message = (await response.json())?.error || message; } catch (_) {}
        throw new Error(message);
      }
      return await response.text();
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error('A fonte demorou demais para responder.');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeText(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\([^)]*(?:dublado|legendado|dual|4k|fhd|uhd|hd|sd|1080p|720p|480p)[^)]*\)/gi, ' ')
      .replace(/\[[^\]]*(?:dublado|legendado|dual|4k|fhd|uhd|hd|sd|1080p|720p|480p)[^\]]*\]/gi, ' ')
      .replace(/\b(dublado|legendado|dual(?: audio)?|4k|fhd|uhd|hd|sd|h265|hevc|pt[- ]?br|1080p|720p|480p)\b/g, ' ')
      .replace(/\b(?:temporada|season)\s*\d+\b/g, ' ')
      .replace(/\bS\s*\d+\b/gi, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function contentTitle(item) {
    return String(item?.seriesName || item?.name || item?.title || '').trim();
  }

  function contentYear(item) {
    const explicit = String(item?.year || item?.releaseDate || item?.release_date || item?.first_air_date || '');
    const match = `${explicit} ${contentTitle(item)}`.match(/\b(19\d{2}|20\d{2})\b/);
    return match ? match[1] : '';
  }

  function contentType(item) {
    const type = String(item?.type || '').toLowerCase();
    if (type === 'movie') return 'movies';
    if (type === 'tv') return 'live';
    return ['movies', 'series', 'live'].includes(type) ? type : type;
  }

  function itemKey(item) {
    return `${contentType(item)}|${normalizeText(contentTitle(item))}|${contentYear(item)}`;
  }

  function stableFingerprint(source, item) {
    const episodes = item?.m3uEpisodes && typeof item.m3uEpisodes === 'object'
      ? Object.entries(item.m3uEpisodes).map(([season, list]) => `${season}:${Array.isArray(list) ? list.length : 0}`).join(',')
      : '';
    return `${source.id}|${itemKey(item)}|${episodes}`.slice(0, 300);
  }

  function tokenSimilarity(a, b) {
    const left = new Set(normalizeText(a).split(' ').filter(Boolean));
    const right = new Set(normalizeText(b).split(' ').filter(Boolean));
    if (!left.size || !right.size) return 0;
    let common = 0;
    left.forEach(token => { if (right.has(token)) common += 1; });
    return common / new Set([...left, ...right]).size;
  }

  function comparableId(item) {
    return String(item?.tmdb_id || item?.tmdbId || item?.tmdb?.id || item?.series_id_tmdb || '').trim();
  }

  function scoreCandidate(incoming, candidate) {
    const inType = contentType(incoming);
    const candidateType = contentType(candidate);
    if (!inType || inType !== candidateType) return 0;

    const incomingId = comparableId(incoming);
    const candidateId = comparableId(candidate);
    if (incomingId && candidateId && incomingId === candidateId) return 100;

    const a = normalizeText(contentTitle(incoming));
    const b = normalizeText(contentTitle(candidate));
    if (!a || !b) return 0;
    const yearA = contentYear(incoming);
    const yearB = contentYear(candidate);

    if (a === b) {
      if (inType === 'series') return 100;
      if (inType === 'live') return 98;
      if (yearA && yearB) return yearA === yearB ? 100 : 78;
      return 92;
    }

    const similarity = tokenSimilarity(a, b);
    let score = 0;
    if (similarity >= 0.92) score = 92;
    else if (similarity >= 0.82) score = 86;
    else if (similarity >= 0.70) score = 78;
    else if (similarity >= 0.62) score = 72;
    if (score && yearA && yearB) score += yearA === yearB ? 4 : -8;
    return Math.max(0, Math.min(100, score));
  }

  function bestCandidate(item, catalog) {
    let best = null;
    let score = 0;
    for (const candidate of catalog) {
      if (candidate === item || candidate?.luxSourceRole === 'secondary') continue;
      const candidateScore = scoreCandidate(item, candidate);
      if (candidateScore > score) {
        score = candidateScore;
        best = candidate;
        if (score === 100) break;
      }
    }
    return { candidate: best, score };
  }

  function sourceDescriptor(source, url = '') {
    return {
      id: source.id,
      name: source.name,
      priority: Number(source.priority) || 10,
      role: 'secondary',
      url: String(url || '')
    };
  }

  function ensurePrimaryDescriptor(item) {
    if (!item || item.luxSourceRole === 'secondary') return;
    item.luxSourceRole = 'primary';
    if (!Array.isArray(item.luxSources)) item.luxSources = [];
    if (!item.luxSources.some(source => source?.role === 'primary')) {
      item.luxSources.unshift({ id: 'principal', name: 'Lista principal', priority: 0, role: 'primary', url: String(item.url || '') });
    }
  }

  function attachAlternative(item, source, url = '') {
    if (!item) return;
    ensurePrimaryDescriptor(item);
    if (!Array.isArray(item.luxSources)) item.luxSources = [];
    if (!item.luxSources.some(entry => entry?.id === source.id && String(entry?.url || '') === String(url || ''))) {
      item.luxSources.push(sourceDescriptor(source, url));
    }
  }

  function mergeSeries(primary, incoming, source) {
    attachAlternative(primary, source, '');
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
          attachAlternative(existing, source, episode?.url || '');
          return;
        }
        target.push({
          ...episode,
          luxSourceRole: 'secondary',
          luxSourceId: source.id,
          luxSourceName: source.name,
          luxSources: [sourceDescriptor(source, episode?.url || '')]
        });
      });

      target.sort((a, b) => Number(a?.episodeNum || 0) - Number(b?.episodeNum || 0));
    });
  }

  function mergeDuplicate(primary, incoming, source) {
    if (contentType(primary) === 'series' && incoming?.m3uEpisodes) {
      mergeSeries(primary, incoming, source);
      return;
    }
    attachAlternative(primary, source, incoming?.url || '');
  }

  function animeEpisodeRewrite(item) {
    const original = String(item?.name || '').trim();
    if (!original) return item;
    if (/\b(?:S\s*\d+\s*E\s*\d+|T\s*\d+\s*E\s*\d+|\d+\s*[xX]\s*\d+)\b/i.test(original)) return item;

    const patterns = [
      /^(.*?)(?:\s*[-–|:]?\s*)(?:ep(?:is[oó]dio|isode)?\.?\s*)0*(\d{1,4})(?:\s*[-–|:]\s*(.*))?$/i,
      /^(.*?)(?:\s*[-–|:]\s*)E\s*0*(\d{1,4})(?:\s*[-–|:]\s*(.*))?$/i
    ];
    for (const pattern of patterns) {
      const match = original.match(pattern);
      if (!match) continue;
      const series = String(match[1] || '').trim();
      const episode = Number(match[2]) || 1;
      const title = String(match[3] || '').trim();
      if (!series) continue;
      return { ...item, originalName: original, name: `${series} S01E${episode}${title ? ` - ${title}` : ''}` };
    }
    return item;
  }

  function prepareSourceItems(parsed, source) {
    let items = Array.isArray(parsed) ? parsed.map(item => ({ ...item })) : [];
    const hint = String(source.source_type || 'auto').toLowerCase();

    items = items.map(item => {
      let next = item;
      if (hint === 'anime') next = animeEpisodeRewrite(next);
      if (hint === 'anime' || hint === 'series') next.type = 'series';
      if (hint === 'movies') next.type = 'movies';
      if (hint === 'live') next.type = 'live';
      next.luxSourceRole = 'secondary';
      next.luxSourceId = source.id;
      next.luxSourceName = source.name;
      next.luxSources = [sourceDescriptor(source, next.url || '')];
      return next;
    });

    if ((hint === 'anime' || hint === 'series' || hint === 'auto') && typeof window.groupM3uSeriesEpisodes === 'function') {
      try { items = window.groupM3uSeriesEpisodes(items); } catch (error) { console.warn('[LUX-IPTV-035] Falha ao agrupar episódios secundários:', error); }
    }
    if (typeof window.profileAllowsMedia === 'function') items = items.filter(item => window.profileAllowsMedia(item));
    return items;
  }

  function appendNewItem(item, source, catalog) {
    item.luxSourceRole = 'secondary';
    item.luxSourceId = source.id;
    item.luxSourceName = source.name;
    if (!Array.isArray(item.luxSources) || !item.luxSources.length) item.luxSources = [sourceDescriptor(source, item.url || '')];
    catalog.push(item);
  }

  function decisionMap(rows) {
    const map = new Map();
    (rows || []).forEach(row => map.set(`${row.source_id}|${row.fingerprint}`, row));
    return map;
  }

  async function queueReviews(source, rows) {
    if (!rows.length) return;
    try {
      await invoke('queue_reviews', { source_id: source.id, items: rows.slice(0, MAX_REVIEW_QUEUE) });
    } catch (error) {
      console.warn('[LUX-IPTV-035] Não foi possível enviar possíveis duplicados para revisão:', error);
    }
  }

  async function mergeSource(source, catalog, decisions) {
    const text = await fetchPlaylist(source.id);
    if (!text || typeof window.parseM3U !== 'function') throw new Error('Leitor M3U do Lux indisponível.');
    const parsed = window.parseM3U(text);
    if (!parsed?.length) throw new Error('A fonte não possui entradas M3U utilizáveis.');
    const items = prepareSourceItems(parsed, source);
    const reviewRows = [];
    let added = 0;
    let merged = 0;
    let pending = 0;

    for (const incoming of items) {
      const fingerprint = stableFingerprint(source, incoming);
      const savedDecision = decisions.get(`${source.id}|${fingerprint}`);
      const best = bestCandidate(incoming, catalog);

      if (savedDecision?.status === 'ignored') continue;
      if (savedDecision?.status === 'separate') {
        appendNewItem(incoming, source, catalog);
        added += 1;
        continue;
      }
      if (savedDecision?.status === 'merged') {
        const chosen = catalog.find(item => itemKey(item) === savedDecision.candidate_key) || best.candidate;
        if (chosen) {
          mergeDuplicate(chosen, incoming, source);
          merged += 1;
          continue;
        }
      }

      if (best.candidate && best.score >= AUTO_MERGE_SCORE) {
        mergeDuplicate(best.candidate, incoming, source);
        merged += 1;
        continue;
      }

      if (best.candidate && best.score >= REVIEW_SCORE) {
        if (source.review_duplicates !== false) {
          reviewRows.push({
            fingerprint,
            incoming_title: contentTitle(incoming),
            incoming_type: contentType(incoming),
            candidate_key: itemKey(best.candidate),
            candidate_title: contentTitle(best.candidate),
            score: best.score,
            incoming_meta: { year: contentYear(incoming), group: incoming.group || '', source: source.name },
            candidate_meta: { year: contentYear(best.candidate), group: best.candidate.group || '', source: 'Lista principal' }
          });
          pending += 1;
          continue;
        }
        if (source.fill_only !== false) continue;
      }

      appendNewItem(incoming, source, catalog);
      added += 1;
    }

    await queueReviews(source, reviewRows);
    return { parsed: parsed.length, grouped: items.length, added, merged, pending };
  }

  async function mergeIntoCurrentCatalog(options = {}) {
    if (mergeRunning) return { added: 0, merged: 0, pending: 0, skipped: true };
    const user = safeCurrentUser();
    if (!user?.user || !user?.pass) return { added: 0, merged: 0, pending: 0, skipped: true };
    if (typeof allMediaItems === 'undefined' || !Array.isArray(allMediaItems)) return { added: 0, merged: 0, pending: 0, skipped: true };

    mergeRunning = true;
    try {
      const payload = await invoke('list');
      const sources = Array.isArray(payload.sources) ? payload.sources : [];
      if (!sources.length) return { added: 0, merged: 0, pending: 0, sources: 0 };

      allMediaItems.forEach(ensurePrimaryDescriptor);
      const decisions = decisionMap(payload.decisions);
      const totals = { added: 0, merged: 0, pending: 0, sources: 0, failures: [] };

      for (const source of sources) {
        try {
          const result = await mergeSource(source, allMediaItems, decisions);
          totals.added += result.added;
          totals.merged += result.merged;
          totals.pending += result.pending;
          totals.sources += 1;
        } catch (error) {
          totals.failures.push(`${source.name}: ${error?.message || 'falha desconhecida'}`);
          console.warn('[LUX-IPTV-035] Fonte secundária indisponível:', source.name, error);
        }
      }

      try { if (typeof window.mergeSharedVodsIntoPlayer === 'function') window.mergeSharedVodsIntoPlayer(); } catch (_) {}
      if (options.refreshUi) {
        try {
          if (typeof window.setSection === 'function' && typeof currentSection !== 'undefined') window.setSection(currentSection);
        } catch (_) {}
      }
      console.info('[LUX-IPTV-035] Fontes secundárias aplicadas:', totals);
      return totals;
    } finally {
      mergeRunning = false;
    }
  }

  function installLoadBridge() {
    const original = window.loadMediaSourcesInPriority;
    if (typeof original !== 'function') return false;
    if (original.__luxSecondarySourcesWrapped) return true;

    const wrapped = async function () {
      const principalLoaded = await original.apply(this, arguments);
      let secondary = null;
      try { secondary = await mergeIntoCurrentCatalog(); } catch (error) { console.warn('[LUX-IPTV-035] Falha ao complementar catálogo:', error); }
      if (!principalLoaded && Number(secondary?.added || 0) > 0) {
        try { if (typeof window.setMediaSourceState === 'function') window.setMediaSourceState('secondary-m3u', 'Fontes secundárias', allMediaItems.length); } catch (_) {}
        return true;
      }
      return principalLoaded;
    };
    wrapped.__luxSecondarySourcesWrapped = true;
    wrapped.__luxSecondarySourcesOriginal = original;
    window.loadMediaSourcesInPriority = wrapped;
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function sourceStatusBadge(source) {
    const status = String(source.last_status || '').toLowerCase();
    if (status === 'success') return '<span class="rounded-full border border-emerald-700/60 bg-emerald-950/50 px-2 py-1 text-[10px] font-bold text-emerald-300">VALIDADA</span>';
    if (status === 'error') return '<span class="rounded-full border border-rose-700/60 bg-rose-950/50 px-2 py-1 text-[10px] font-bold text-rose-300">COM ERRO</span>';
    return '<span class="rounded-full border border-purple-800/60 bg-purple-950/50 px-2 py-1 text-[10px] font-bold text-purple-300">NÃO TESTADA</span>';
  }

  function ensureAdminUi() {
    const modal = document.getElementById('adminModal');
    if (!modal || document.getElementById('adminTabSources')) return Boolean(document.getElementById('adminTabSources'));
    const tabs = modal.querySelector('.admin-tab-btn')?.parentElement;
    const firstPanel = modal.querySelector('.admin-tab-panel');
    if (!tabs || !firstPanel) return false;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.adminTab = 'sources';
    button.className = 'admin-tab-btn bg-[#180f29] text-purple-200 hover:bg-[#23153b] px-3 py-2 rounded-xl text-[11px] font-bold';
    button.textContent = 'Fontes';
    button.addEventListener('click', async () => {
      window.switchAdminTab?.('sources');
      await refreshAdminSources();
    });
    tabs.appendChild(button);

    const panel = document.createElement('div');
    panel.id = 'adminTabSources';
    panel.className = 'admin-tab-panel hidden overflow-y-auto pr-1 space-y-4';
    panel.innerHTML = `
      <section class="rounded-2xl border border-purple-900/50 bg-[#180f29] p-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h4 class="text-sm font-bold text-white">Fontes secundárias de conteúdo</h4>
            <p class="mt-1 max-w-3xl text-xs text-purple-300">A lista principal continua soberana. Estas M3Us entram apenas como complemento e fallback; URLs válidas da principal nunca são substituídas.</p>
          </div>
          <button id="secondaryApplyNow" type="button" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500">Aplicar agora</button>
        </div>
        <form id="secondarySourceForm" class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          <input id="secondarySourceId" type="hidden">
          <label class="text-[11px] font-medium text-purple-300">Nome da fonte
            <input id="secondarySourceName" required maxlength="80" placeholder="Ex.: Anime complementar" class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white">
          </label>
          <label class="text-[11px] font-medium text-purple-300">Tipo
            <select id="secondarySourceType" class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white">
              <option value="auto">Automático</option><option value="anime">Anime</option><option value="series">Séries</option><option value="movies">Filmes</option><option value="live">TV ao vivo</option>
            </select>
          </label>
          <label class="md:col-span-2 text-[11px] font-medium text-purple-300">URL M3U / M3U8
            <input id="secondarySourceUrl" required type="url" placeholder="http:// ou https://" class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white">
            <span class="mt-1 block text-[10px] text-purple-400/80">O Lux busca a lista pelo servidor HTTPS, então uma origem HTTP não vira Mixed Content no navegador.</span>
          </label>
          <label class="text-[11px] font-medium text-purple-300">Prioridade secundária
            <input id="secondarySourcePriority" type="number" min="1" max="999" value="10" class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white">
          </label>
          <div class="flex flex-col justify-end gap-2 rounded-xl border border-purple-900/40 bg-[#120c1f]/60 p-3 text-xs text-purple-200">
            <label class="flex items-center gap-2"><input id="secondarySourceEnabled" type="checkbox" checked class="accent-purple-600"> Ativa</label>
            <label class="flex items-center gap-2"><input id="secondarySourceFillOnly" type="checkbox" checked class="accent-purple-600"> Somente preencher o que falta</label>
            <label class="flex items-center gap-2"><input id="secondarySourceReview" type="checkbox" checked class="accent-purple-600"> Revisar possíveis duplicados</label>
          </div>
          <div class="md:col-span-2 flex flex-wrap gap-2">
            <button id="secondarySourceSave" class="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-500">Salvar fonte</button>
            <button id="secondarySourceCancel" type="button" class="hidden rounded-xl border border-purple-800 px-4 py-2.5 text-xs font-bold text-purple-200">Cancelar edição</button>
          </div>
          <p id="secondarySourceStatus" role="status" class="md:col-span-2 min-h-[18px] text-xs text-purple-300"></p>
        </form>
      </section>
      <section class="rounded-2xl border border-purple-900/50 bg-[#120c1f] p-4">
        <div class="flex items-center justify-between gap-3"><h4 class="text-xs font-bold uppercase text-purple-300">Fontes cadastradas</h4><button id="secondarySourceRefresh" type="button" class="text-xs text-purple-300 hover:text-white">Atualizar</button></div>
        <div id="secondarySourcesList" class="mt-3 space-y-2"><p class="py-4 text-center text-xs text-purple-400/60">Carregando...</p></div>
      </section>
      <section class="rounded-2xl border border-amber-900/50 bg-[#120c1f] p-4">
        <div class="flex items-center justify-between gap-3"><div><h4 class="text-xs font-bold uppercase text-amber-300">Possíveis duplicados</h4><p class="mt-1 text-[11px] text-purple-300">O Lux segura itens duvidosos até você dizer se são o mesmo conteúdo.</p></div><button id="secondaryReviewRefresh" type="button" class="text-xs text-amber-300 hover:text-white">Atualizar</button></div>
        <div id="secondaryReviewsList" class="mt-3 space-y-2"><p class="py-4 text-center text-xs text-purple-400/60">Nenhuma revisão carregada.</p></div>
      </section>`;
    firstPanel.parentElement.appendChild(panel);

    panel.querySelector('#secondarySourceForm')?.addEventListener('submit', saveAdminSource);
    panel.querySelector('#secondarySourceCancel')?.addEventListener('click', resetSourceForm);
    panel.querySelector('#secondarySourceRefresh')?.addEventListener('click', refreshAdminSources);
    panel.querySelector('#secondaryReviewRefresh')?.addEventListener('click', refreshAdminReviews);
    panel.querySelector('#secondaryApplyNow')?.addEventListener('click', applySourcesNow);
    panel.querySelector('#secondarySourcesList')?.addEventListener('click', handleSourceListClick);
    panel.querySelector('#secondaryReviewsList')?.addEventListener('click', handleReviewListClick);
    try { window.lucide?.createIcons?.(); } catch (_) {}
    return true;
  }

  function resetSourceForm() {
    const form = document.getElementById('secondarySourceForm');
    form?.reset();
    const id = document.getElementById('secondarySourceId');
    const priority = document.getElementById('secondarySourcePriority');
    const enabled = document.getElementById('secondarySourceEnabled');
    const fill = document.getElementById('secondarySourceFillOnly');
    const review = document.getElementById('secondarySourceReview');
    if (id) id.value = '';
    if (priority) priority.value = '10';
    if (enabled) enabled.checked = true;
    if (fill) fill.checked = true;
    if (review) review.checked = true;
    document.getElementById('secondarySourceCancel')?.classList.add('hidden');
  }

  async function saveAdminSource(event) {
    event.preventDefault();
    const status = document.getElementById('secondarySourceStatus');
    const button = document.getElementById('secondarySourceSave');
    if (button) button.disabled = true;
    if (status) status.textContent = 'Salvando fonte...';
    try {
      await invoke('save', {
        id: document.getElementById('secondarySourceId')?.value || undefined,
        name: document.getElementById('secondarySourceName')?.value,
        source_url: document.getElementById('secondarySourceUrl')?.value,
        source_type: document.getElementById('secondarySourceType')?.value,
        priority: Number(document.getElementById('secondarySourcePriority')?.value) || 10,
        enabled: Boolean(document.getElementById('secondarySourceEnabled')?.checked),
        fill_only: Boolean(document.getElementById('secondarySourceFillOnly')?.checked),
        review_duplicates: Boolean(document.getElementById('secondarySourceReview')?.checked)
      });
      if (status) status.textContent = 'Fonte salva. Valide e depois clique em “Aplicar agora” para testar no catálogo.';
      resetSourceForm();
      await refreshAdminSources();
    } catch (error) {
      if (status) status.textContent = error?.message || 'Não foi possível salvar a fonte.';
    } finally {
      if (button) button.disabled = false;
    }
  }

  function renderAdminSources() {
    const root = document.getElementById('secondarySourcesList');
    if (!root) return;
    if (!adminSources.length) {
      root.innerHTML = '<p class="py-4 text-center text-xs text-purple-400/60">Nenhuma fonte secundária cadastrada.</p>';
      return;
    }
    root.innerHTML = adminSources.map(source => `
      <article class="rounded-2xl border border-purple-900/50 bg-[#180f29] p-3" data-source-card="${escapeHtml(source.id)}">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2"><strong class="text-sm text-white">${escapeHtml(source.name)}</strong>${sourceStatusBadge(source)}${source.enabled ? '' : '<span class="rounded-full bg-slate-800 px-2 py-1 text-[10px] text-slate-300">DESATIVADA</span>'}</div>
            <p class="mt-1 truncate text-[11px] text-purple-300" title="${escapeHtml(source.source_url)}">${escapeHtml(source.source_url)}</p>
            <p class="mt-1 text-[10px] text-purple-400">Tipo: ${escapeHtml(source.source_type)} · prioridade ${Number(source.priority) || 10} · ${source.fill_only ? 'só completa ausências' : 'complemento livre'}</p>
            ${source.last_error ? `<p class="mt-1 text-[10px] text-rose-300">${escapeHtml(source.last_error)}</p>` : ''}
          </div>
          <div class="flex gap-1.5">
            <button data-source-action="check" data-source-id="${escapeHtml(source.id)}" class="rounded-lg border border-emerald-800/60 bg-emerald-950/40 px-2.5 py-2 text-[10px] font-bold text-emerald-300">Validar</button>
            <button data-source-action="edit" data-source-id="${escapeHtml(source.id)}" class="rounded-lg border border-purple-800/60 bg-purple-950/50 px-2.5 py-2 text-[10px] font-bold text-purple-200">Editar</button>
            <button data-source-action="delete" data-source-id="${escapeHtml(source.id)}" class="rounded-lg border border-rose-800/60 bg-rose-950/40 px-2.5 py-2 text-[10px] font-bold text-rose-300">Excluir</button>
          </div>
        </div>
      </article>`).join('');
  }

  async function refreshAdminSources() {
    if (safeCurrentUser()?.role !== 'admin') return;
    ensureAdminUi();
    const root = document.getElementById('secondarySourcesList');
    if (root) root.innerHTML = '<p class="py-4 text-center text-xs text-purple-400/60">Carregando fontes...</p>';
    try {
      const data = await invoke('admin_list');
      adminSources = Array.isArray(data.sources) ? data.sources : [];
      renderAdminSources();
      await refreshAdminReviews();
    } catch (error) {
      if (root) root.innerHTML = `<p class="py-4 text-center text-xs text-rose-300">${escapeHtml(error?.message || 'Falha ao carregar fontes.')}</p>`;
    }
  }

  function editSource(id) {
    const source = adminSources.find(item => item.id === id);
    if (!source) return;
    document.getElementById('secondarySourceId').value = source.id;
    document.getElementById('secondarySourceName').value = source.name || '';
    document.getElementById('secondarySourceUrl').value = source.source_url || '';
    document.getElementById('secondarySourceType').value = source.source_type || 'auto';
    document.getElementById('secondarySourcePriority').value = String(source.priority || 10);
    document.getElementById('secondarySourceEnabled').checked = source.enabled !== false;
    document.getElementById('secondarySourceFillOnly').checked = source.fill_only !== false;
    document.getElementById('secondarySourceReview').checked = source.review_duplicates !== false;
    document.getElementById('secondarySourceCancel')?.classList.remove('hidden');
    document.getElementById('secondarySourceName')?.focus();
  }

  async function handleSourceListClick(event) {
    const button = event.target.closest('[data-source-action]');
    if (!button) return;
    const id = button.dataset.sourceId;
    const action = button.dataset.sourceAction;
    if (action === 'edit') return editSource(id);
    if (action === 'delete') {
      if (!confirm('Excluir esta fonte secundária? A lista principal não será alterada.')) return;
      button.disabled = true;
      try { await invoke('delete', { id }); await refreshAdminSources(); } catch (error) { alert(error?.message || 'Não foi possível excluir.'); button.disabled = false; }
      return;
    }
    if (action === 'check') {
      button.disabled = true;
      const old = button.textContent;
      button.textContent = 'Validando...';
      try {
        const result = await invoke('check', { id });
        alert(result.message || 'Fonte validada.');
      } catch (error) { alert(error?.message || 'A fonte não passou na validação.'); }
      finally { button.textContent = old; button.disabled = false; await refreshAdminSources(); }
    }
  }

  async function refreshAdminReviews() {
    if (safeCurrentUser()?.role !== 'admin') return;
    const root = document.getElementById('secondaryReviewsList');
    if (!root) return;
    root.innerHTML = '<p class="py-4 text-center text-xs text-purple-400/60">Carregando revisões...</p>';
    try {
      const data = await invoke('reviews');
      adminReviews = Array.isArray(data.reviews) ? data.reviews : [];
      if (!adminReviews.length) {
        root.innerHTML = '<p class="py-4 text-center text-xs text-emerald-300/80">Nenhum possível duplicado pendente.</p>';
        return;
      }
      root.innerHTML = adminReviews.map(review => `
        <article class="rounded-xl border border-amber-900/50 bg-amber-950/10 p-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1"><p class="text-xs font-bold text-white">${escapeHtml(review.incoming_title)}</p><p class="mt-1 text-[11px] text-purple-300">Pode ser o mesmo que <strong class="text-amber-200">${escapeHtml(review.candidate_title)}</strong></p><p class="mt-1 text-[10px] text-amber-300">Similaridade ${Number(review.score) || 0}%</p></div>
            <div class="flex flex-wrap gap-1.5">
              <button data-review-id="${review.id}" data-review-status="merged" class="rounded-lg bg-emerald-700 px-2.5 py-2 text-[10px] font-bold text-white">É o mesmo</button>
              <button data-review-id="${review.id}" data-review-status="separate" class="rounded-lg bg-purple-700 px-2.5 py-2 text-[10px] font-bold text-white">É diferente</button>
              <button data-review-id="${review.id}" data-review-status="ignored" class="rounded-lg border border-slate-700 px-2.5 py-2 text-[10px] font-bold text-slate-300">Ignorar</button>
            </div>
          </div>
        </article>`).join('');
    } catch (error) {
      root.innerHTML = `<p class="py-4 text-center text-xs text-rose-300">${escapeHtml(error?.message || 'Falha ao carregar revisões.')}</p>`;
    }
  }

  async function handleReviewListClick(event) {
    const button = event.target.closest('[data-review-id]');
    if (!button) return;
    button.disabled = true;
    try {
      await invoke('resolve_review', { id: Number(button.dataset.reviewId), status: button.dataset.reviewStatus });
      await refreshAdminReviews();
    } catch (error) {
      alert(error?.message || 'Não foi possível salvar sua decisão.');
      button.disabled = false;
    }
  }

  async function applySourcesNow() {
    const button = document.getElementById('secondaryApplyNow');
    const status = document.getElementById('secondarySourceStatus');
    if (button) button.disabled = true;
    if (status) status.textContent = 'Aplicando fontes secundárias ao catálogo atual...';
    try {
      const result = await mergeIntoCurrentCatalog({ refreshUi: true });
      if (status) status.textContent = `${result.added || 0} itens novos · ${result.merged || 0} mesclados · ${result.pending || 0} enviados para revisão.`;
      await refreshAdminReviews();
    } catch (error) {
      if (status) status.textContent = error?.message || 'Não foi possível aplicar as fontes.';
    } finally {
      if (button) button.disabled = false;
    }
  }

  function installAdminBridge() {
    if (!ensureAdminUi()) return false;
    const original = window.switchAdminTab;
    if (typeof original === 'function' && !original.__luxSecondarySourcesWrapped) {
      const wrapped = function (tab) {
        const result = original.apply(this, arguments);
        if (tab === 'sources') refreshAdminSources();
        return result;
      };
      wrapped.__luxSecondarySourcesWrapped = true;
      window.switchAdminTab = wrapped;
    }
    return true;
  }

  window.LuxSecondarySources = {
    version: VERSION,
    mergeIntoCurrentCatalog,
    refreshAdminSources,
    normalizeTitle: normalizeText,
    scoreCandidate
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
      if (install() || attempts >= 160) clearInterval(timer);
    }, 50);
  }

  // O módulo pode chegar depois do login porque ui-motion carrega extensões de forma assíncrona.
  // Se o catálogo principal já existe, completa uma única vez sem esperar outro reload.
  setTimeout(() => {
    const user = safeCurrentUser();
    try {
      if (user?.user && typeof allMediaItems !== 'undefined' && Array.isArray(allMediaItems) && allMediaItems.length) {
        mergeIntoCurrentCatalog({ refreshUi: true }).catch(error => console.warn('[LUX-IPTV-035] Complemento tardio falhou:', error));
      }
    } catch (_) {}
  }, 1200);
})();
