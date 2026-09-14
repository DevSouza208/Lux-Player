(() => {
  'use strict';

  const VERSION = '20260914-canonical-catalog-1';
  if (window.__luxCanonicalCatalogInstalled === VERSION) return;
  window.__luxCanonicalCatalogInstalled = VERSION;
  window.__luxCanonicalCatalogBackendEnabled = true;

  const SYNC_FUNCTION = 'content-catalog-sync';
  const SNAPSHOT_FUNCTION = 'content-catalog-snapshot';
  let reloadPromise = null;
  let autoReloadedForUser = '';

  const safeCurrentUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  const authBody = extra => {
    const user = safeCurrentUser();
    return {
      username: String(user?.user || '').trim(),
      password: String(user?.pass || ''),
      ...(extra || {})
    };
  };

  async function invokeFunction(name, body) {
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) throw new Error('Serviço de nuvem indisponível.');
    const { data, error } = await supabaseClient.functions.invoke(name, { body: authBody(body) });
    if (error) throw new Error(data?.error || error.message || 'Falha no serviço de catálogo.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function normalizeTitle(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\.(mkv|mp4|avi|ts|m3u8?)\b/gi, ' ')
      .replace(/\([^)]*(?:dublado|legendado|dual|4k|fhd|uhd|hd|sd|1080p|720p|480p)[^)]*\)/gi, ' ')
      .replace(/\[[^\]]*(?:dublado|legendado|dual|4k|fhd|uhd|hd|sd|1080p|720p|480p)[^\]]*\]/gi, ' ')
      .replace(/\b(dublado|legendado|dual(?: audio)?|pt[- ]?br|4k|fhd|uhd|hd|sd|h265|hevc|1080p|720p|480p)\b/gi, ' ')
      .replace(/\b(?:temporada|season)\s*\d+\b/gi, ' ')
      .replace(/\b(?:s\s*\d+\s*e\s*\d+|t\s*\d+\s*e\s*\d+|\d+\s*x\s*\d+)\b/gi, ' ')
      .replace(/^[+\-–—\s]+/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function typeOf(item) {
    const type = String(item?.type || item?.media_type || '').toLowerCase();
    if (type === 'movie') return 'movies';
    if (type === 'tv') return 'live';
    return ['movies', 'series', 'live'].includes(type) ? type : type;
  }

  function itemTitle(item) {
    return String(item?.seriesName || item?.name || item?.title || item?.canonical_title || '').trim();
  }

  function itemKey(item) {
    return `${typeOf(item)}|${normalizeTitle(itemTitle(item))}`;
  }

  function titleOnlyKey(item) {
    return normalizeTitle(itemTitle(item));
  }

  function sourceRank(source) {
    const layer = String(source?.source_layer || source?.role || 'secondary');
    const base = layer === 'principal' ? 0 : layer === 'provider' ? 1000 : 2000;
    return base + (Number(source?.priority) || 0);
  }

  function bestSource(sources) {
    return [...(sources || [])].sort((a, b) => sourceRank(a) - sourceRank(b))[0] || null;
  }

  function sourceDescriptor(source) {
    return {
      id: String(source?.source_id || ''),
      name: String(source?.source_name || ''),
      priority: Number(source?.priority) || 10,
      role: String(source?.source_layer || 'secondary'),
      tier: source?.source_layer === 'provider' ? 1 : 2,
      url: String(source?.url || ''),
      language: String(source?.language || ''),
      audio: String(source?.audio || '')
    };
  }

  function attachSource(item, source) {
    if (!item || !source) return;
    if (!Array.isArray(item.luxSources)) item.luxSources = [];
    const descriptor = sourceDescriptor(source);
    if (!item.luxSources.some(row => row?.id === descriptor.id && String(row?.url || '') === descriptor.url)) {
      item.luxSources.push(descriptor);
      item.luxSources.sort((a, b) => sourceRank({ source_layer: a.role, priority: a.priority }) - sourceRank({ source_layer: b.role, priority: b.priority }));
    }
  }

  function animeGroup(title) {
    const isAnime = title?.metadata?.anime === true || Boolean(title?.anilist_id) || Boolean(title?.mal_id);
    if (!isAnime) return '';
    return title.media_type === 'movies' ? 'Filmes | Animes ⚡ PLUS' : 'Séries | Animes ⚡ PLUS';
  }

  function fallbackGroup(title, sources) {
    const anime = animeGroup(title);
    if (anime) return anime;
    for (const source of sources || []) {
      const group = String(source?.metadata?.group || '').trim();
      if (group) return group;
    }
    return title.media_type === 'movies' ? 'Filmes | Outros' : title.media_type === 'live' ? 'TV | Outros' : 'Séries | Outros';
  }

  function ensureSeriesEpisodes(item) {
    if (!item.m3uEpisodes || typeof item.m3uEpisodes !== 'object') item.m3uEpisodes = {};
    return item.m3uEpisodes;
  }

  function mergeEpisodeSource(item, source) {
    const ep = source?.episode;
    if (!ep || item?.type !== 'series') return;
    const season = String(Number(ep.season) || 1);
    const episodeNum = Number(ep.episode);
    if (!Number.isFinite(episodeNum) || episodeNum <= 0) return;
    const seasons = ensureSeriesEpisodes(item);
    if (!Array.isArray(seasons[season])) seasons[season] = [];
    let existing = seasons[season].find(row => Number(row?.episodeNum || row?.episode_num || row?.episode || 0) === episodeNum);
    if (!existing) {
      existing = {
        id: `canonical:${item.canonicalId || item.id}:s${season}e${episodeNum}`,
        name: ep.title || `Episódio ${episodeNum}`,
        episodeTitle: ep.title || `Episódio ${episodeNum}`,
        episodeNum,
        episode_num: episodeNum,
        episode: episodeNum,
        seasonNum: Number(season),
        seriesName: item.name,
        type: 'series',
        url: String(source.url || ''),
        logo: item.logo || '',
        group: item.group,
        luxSourceRole: source.source_layer,
        luxSourceId: source.source_id,
        luxSourceName: source.source_name,
        luxSources: []
      };
      seasons[season].push(existing);
      seasons[season].sort((a, b) => Number(a?.episodeNum || 0) - Number(b?.episodeNum || 0));
    }
    attachSource(existing, source);
    if (!existing.url || sourceRank(source) < sourceRank({ source_layer: existing.luxSourceRole, priority: existing?.luxSources?.[0]?.priority })) {
      existing.url = String(source.url || existing.url || '');
      existing.luxSourceRole = source.source_layer;
      existing.luxSourceId = source.source_id;
      existing.luxSourceName = source.source_name;
    }
  }

  function makeCanonicalItem(title) {
    const sources = Array.isArray(title?.sources) ? title.sources : [];
    const titleSources = sources.filter(source => !source?.episode);
    const best = bestSource(titleSources.length ? titleSources : sources);
    const group = fallbackGroup(title, sources);
    const item = {
      id: `canonical:${title.id}`,
      canonicalId: title.id,
      name: title.canonical_title || 'Sem título',
      seriesName: title.canonical_title || 'Sem título',
      type: title.media_type,
      group,
      logo: title.poster || '',
      url: String(best?.url || ''),
      year: title.year || '',
      anilist_id: title.anilist_id || null,
      mal_id: title.mal_id || null,
      tmdb_id: title.tmdb_id || null,
      canonicalFormat: title.format || '',
      luxCanonical: true,
      luxSourceRole: best?.source_layer || 'provider',
      luxSourceId: best?.source_id || '',
      luxSourceName: best?.source_name || '',
      luxSources: []
    };
    if (best?.source_layer === 'provider') {
      item.providerSlug = String(best.source_id || '').replace(/^provider:/, '');
      item.providerUrl = String(best.url || '');
      item.providerName = String(best.source_name || '');
      item.providerVariant = String(best?.metadata?.variant || 'default');
    }
    titleSources.forEach(source => attachSource(item, source));
    sources.filter(source => source?.episode).forEach(source => mergeEpisodeSource(item, source));
    return item;
  }

  function mergeCanonicalTitle(title, existingByKey, existingByTitle, catalog) {
    const sources = Array.isArray(title?.sources) ? title.sources : [];
    const canonicalKey = `${String(title.media_type || '')}|${String(title.normalized_title || normalizeTitle(title.canonical_title))}`;
    const titleKey = String(title.normalized_title || normalizeTitle(title.canonical_title));
    let existing = existingByKey.get(canonicalKey) || existingByTitle.get(titleKey) || null;

    if (!existing && title.has_principal) return { added: 0, merged: 0, skipped: 1 };
    if (!existing) {
      const item = makeCanonicalItem(title);
      catalog.push(item);
      existingByKey.set(itemKey(item), item);
      if (!existingByTitle.has(titleOnlyKey(item))) existingByTitle.set(titleOnlyKey(item), item);
      return { added: 1, merged: 0, skipped: 0 };
    }

    existing.canonicalId = title.id;
    existing.luxCanonical = true;
    if (!existing.anilist_id && title.anilist_id) existing.anilist_id = title.anilist_id;
    if (!existing.mal_id && title.mal_id) existing.mal_id = title.mal_id;
    if (!existing.tmdb_id && title.tmdb_id) existing.tmdb_id = title.tmdb_id;
    if ((!existing.logo || /placeholder/i.test(existing.logo)) && title.poster) existing.logo = title.poster;
    const anime = animeGroup(title);
    if (anime && (!existing.group || /outros|providers/i.test(existing.group))) existing.group = anime;
    sources.filter(source => !source?.episode).forEach(source => {
      attachSource(existing, source);
      if (source.source_layer === 'provider') {
        existing.providerSlug ||= String(source.source_id || '').replace(/^provider:/, '');
        existing.providerUrl ||= String(source.url || '');
        existing.providerName ||= String(source.source_name || '');
      }
    });
    sources.filter(source => source?.episode).forEach(source => mergeEpisodeSource(existing, source));
    return { added: 0, merged: 1, skipped: 0 };
  }

  async function fetchSnapshot() {
    const items = [];
    let offset = 0;
    const limit = 250;
    for (let page = 0; page < 80; page++) {
      const data = await invokeFunction(SNAPSHOT_FUNCTION, { action: 'page', offset, limit });
      const batch = Array.isArray(data?.items) ? data.items : [];
      items.push(...batch);
      if (!data?.has_more || batch.length < limit) break;
      offset += batch.length;
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    return items;
  }

  async function reload(options = {}) {
    if (reloadPromise) return reloadPromise;
    reloadPromise = (async () => {
      const user = safeCurrentUser();
      if (!user?.user || !user?.pass) return { added: 0, merged: 0, skipped: true };
      if (typeof allMediaItems === 'undefined' || !Array.isArray(allMediaItems)) return { added: 0, merged: 0, skipped: true };
      const snapshot = await fetchSnapshot();
      const byKey = new Map();
      const byTitle = new Map();
      allMediaItems.forEach(item => {
        const key = itemKey(item);
        const tkey = titleOnlyKey(item);
        if (key && !byKey.has(key)) byKey.set(key, item);
        if (tkey && !byTitle.has(tkey)) byTitle.set(tkey, item);
      });
      const totals = { added: 0, merged: 0, skipped: 0, titles: snapshot.length };
      for (let i = 0; i < snapshot.length; i++) {
        const result = mergeCanonicalTitle(snapshot[i], byKey, byTitle, allMediaItems);
        totals.added += result.added;
        totals.merged += result.merged;
        totals.skipped += result.skipped;
        if (i && i % 150 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
      try { if (typeof window.mergeSharedVodsIntoPlayer === 'function') window.mergeSharedVodsIntoPlayer(); } catch (_) {}
      if (options.refreshUi !== false) {
        try {
          if (typeof window.setSection === 'function' && typeof currentSection !== 'undefined') window.setSection(currentSection);
        } catch (_) {}
      }
      console.info('[LUX-CATALOG] Catálogo canônico aplicado.', totals);
      return totals;
    })().finally(() => { reloadPromise = null; });
    return reloadPromise;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
  }

  function closeModal() {
    document.getElementById('luxCanonicalSyncModal')?.remove();
  }

  function renderTaskRows(tasks) {
    return tasks.map((task, index) => `
      <div data-sync-task="${index}" class="flex items-center justify-between gap-3 rounded-xl border border-purple-900/40 bg-[#120c1f] px-3 py-2 text-xs">
        <span class="text-purple-100">${escapeHtml(task.name)}</span>
        <span data-sync-task-status class="text-purple-400">Aguardando</span>
      </div>`).join('');
  }

  async function runSync(modal, options) {
    const startButton = modal.querySelector('#luxCanonicalStart');
    const closeButton = modal.querySelector('#luxCanonicalClose');
    const status = modal.querySelector('#luxCanonicalStatus');
    const progressBar = modal.querySelector('#luxCanonicalProgressBar');
    const principal = Boolean(modal.querySelector('#luxSyncPrincipal')?.checked);
    const providers = Boolean(modal.querySelector('#luxSyncProviders')?.checked);
    const secondary = Boolean(modal.querySelector('#luxSyncSecondary')?.checked);
    const providerIds = [...modal.querySelectorAll('[data-provider-sync]:checked')].map(node => node.value);
    const secondaryIds = [...modal.querySelectorAll('[data-secondary-sync]:checked')].map(node => node.value);
    if (!principal && !providers && !secondary) {
      status.textContent = 'Selecione pelo menos uma camada.';
      return;
    }
    startButton.disabled = true;
    closeButton.disabled = true;
    status.textContent = 'Montando plano de sincronização...';
    try {
      const begin = await invokeFunction(SYNC_FUNCTION, {
        action: 'begin',
        layers: { principal, providers, secondary },
        provider_ids: providerIds,
        secondary_ids: secondaryIds
      });
      const tasks = Array.isArray(begin?.tasks) ? begin.tasks : [];
      modal.querySelector('#luxCanonicalTasks').innerHTML = renderTaskRows(tasks);
      let success = 0;
      let failures = 0;
      for (let index = 0; index < tasks.length; index++) {
        const task = tasks[index];
        const row = modal.querySelector(`[data-sync-task="${index}"]`);
        const taskStatus = row?.querySelector('[data-sync-task-status]');
        if (taskStatus) { taskStatus.textContent = 'Sincronizando...'; taskStatus.className = 'text-sky-300'; }
        status.textContent = `Sincronizando ${task.name} (${index + 1}/${tasks.length})...`;
        try {
          const result = await invokeFunction(SYNC_FUNCTION, { action: 'sync_task', run_id: begin.run_id, kind: task.kind, id: task.id });
          success++;
          if (taskStatus) {
            taskStatus.textContent = `${Number(result.processed || 0)} itens · ${Number(result.new_titles || 0)} novos`;
            taskStatus.className = 'text-emerald-300';
          }
        } catch (error) {
          failures++;
          if (taskStatus) { taskStatus.textContent = error?.message || 'Falhou'; taskStatus.className = 'text-rose-300'; }
        }
        const pct = tasks.length ? Math.round(((index + 1) / tasks.length) * 82) : 82;
        progressBar.style.width = `${pct}%`;
        await new Promise(resolve => setTimeout(resolve, 20));
      }

      status.textContent = 'Identificando animes novos no AniList...';
      let identified = 0;
      for (let round = 0; round < 3; round++) {
        try {
          const enriched = await invokeFunction(SYNC_FUNCTION, { action: 'enrich', limit: 12 });
          identified += Number(enriched?.matched || 0);
          if (!Number(enriched?.remaining || 0) || !Number(enriched?.checked || 0)) break;
        } catch (_) { break; }
      }
      progressBar.style.width = '94%';
      const finished = await invokeFunction(SYNC_FUNCTION, { action: 'finish', run_id: begin.run_id });
      status.textContent = 'Atualizando catálogo visível do Lux...';
      const applied = await reload({ refreshUi: true }).catch(() => ({ added: 0, merged: 0 }));
      progressBar.style.width = '100%';
      const stats = finished?.run?.stats || {};
      status.textContent = `Concluído: ${Number(stats.processed || 0)} processados · ${Number(stats.new_titles || 0)} obras novas · ${identified} IDs AniList · ${Number(applied.added || 0)} cards adicionados ao app${failures ? ` · ${failures} falha(s)` : ''}.`;
      status.className = failures ? 'text-xs text-amber-300' : 'text-xs text-emerald-300';
    } catch (error) {
      status.textContent = error?.message || 'Não foi possível sincronizar o catálogo.';
      status.className = 'text-xs text-rose-300';
    } finally {
      startButton.disabled = false;
      closeButton.disabled = false;
    }
  }

  async function openSyncModal() {
    if (safeCurrentUser()?.role !== 'admin' && safeCurrentUser()?.accountRole !== 'admin') return;
    closeModal();
    const overlay = document.createElement('div');
    overlay.id = 'luxCanonicalSyncModal';
    overlay.className = 'fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm';
    overlay.innerHTML = `
      <section class="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-3xl border border-purple-800/60 bg-[#0d0817] p-5 shadow-2xl">
        <div class="flex items-start justify-between gap-4">
          <div><h3 class="text-lg font-black text-white">Sincronizar conteúdos</h3><p class="mt-1 text-xs text-purple-300">Escolha quais camadas o Lux deve revisar. O processamento pesado acontece no servidor e o app recebe o catálogo já normalizado.</p></div>
          <button id="luxCanonicalClose" class="text-2xl text-purple-300 hover:text-white" type="button">×</button>
        </div>
        <div id="luxCanonicalOptions" class="mt-4"><p class="text-xs text-purple-300">Carregando opções...</p></div>
        <div id="luxCanonicalTasks" class="mt-4 space-y-2"></div>
        <div class="mt-4 h-2 overflow-hidden rounded-full bg-purple-950"><div id="luxCanonicalProgressBar" class="h-full w-0 rounded-full bg-purple-500 transition-all"></div></div>
        <p id="luxCanonicalStatus" class="mt-3 min-h-[20px] text-xs text-purple-300"></p>
        <div class="mt-4 flex justify-end"><button id="luxCanonicalStart" type="button" class="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-500 disabled:opacity-50">Sincronizar selecionados</button></div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#luxCanonicalClose')?.addEventListener('click', closeModal);
    overlay.addEventListener('click', event => { if (event.target === overlay) closeModal(); });
    try {
      const options = await invokeFunction(SYNC_FUNCTION, { action: 'options' });
      const secondary = Array.isArray(options?.secondary) ? options.secondary : [];
      const providers = Array.isArray(options?.providers) ? options.providers : [];
      const enabledSecondary = secondary.filter(source => source.enabled);
      const root = overlay.querySelector('#luxCanonicalOptions');
      root.innerHTML = `
        <div class="grid gap-3 md:grid-cols-3">
          <label class="rounded-2xl border border-purple-800/50 bg-[#120c1f] p-3 ${options?.principal?.available ? '' : 'opacity-50'}">
            <div class="flex items-center gap-2"><input id="luxSyncPrincipal" type="checkbox" ${options?.principal?.available ? 'checked' : 'disabled'} class="accent-purple-600"><strong class="text-sm text-white">Fonte principal</strong></div>
            <p class="mt-1 text-[10px] text-purple-300">Reconstrói a identidade canônica da lista principal. Prioridade 0.</p>
          </label>
          <label class="rounded-2xl border border-sky-800/50 bg-[#0e1320] p-3">
            <div class="flex items-center gap-2"><input id="luxSyncProviders" type="checkbox" checked class="accent-sky-500"><strong class="text-sm text-white">Providers</strong></div>
            <p class="mt-1 text-[10px] text-sky-300">${providers.length} provider(s) suportados.</p>
          </label>
          <label class="rounded-2xl border border-emerald-800/50 bg-[#0d1817] p-3 ${enabledSecondary.length ? '' : 'opacity-60'}">
            <div class="flex items-center gap-2"><input id="luxSyncSecondary" type="checkbox" ${enabledSecondary.length ? '' : 'disabled'} class="accent-emerald-500"><strong class="text-sm text-white">Fontes secundárias</strong></div>
            <p class="mt-1 text-[10px] text-emerald-300">${enabledSecondary.length} ativa(s) · ${secondary.length - enabledSecondary.length} desativada(s).</p>
          </label>
        </div>
        <div class="mt-3 grid gap-3 md:grid-cols-2">
          <div class="rounded-xl border border-sky-900/40 bg-[#0d111a] p-3"><p class="mb-2 text-[10px] font-bold uppercase text-sky-300">Providers</p>${providers.map(provider => `<label class="flex items-center gap-2 py-1 text-xs text-sky-100"><input data-provider-sync type="checkbox" value="${escapeHtml(provider.id)}" checked class="accent-sky-500">${escapeHtml(provider.name)}</label>`).join('') || '<span class="text-xs text-slate-500">Nenhum.</span>'}</div>
          <div class="rounded-xl border border-emerald-900/40 bg-[#0d1514] p-3"><p class="mb-2 text-[10px] font-bold uppercase text-emerald-300">M3U secundárias</p>${secondary.map(source => `<label class="flex items-center gap-2 py-1 text-xs ${source.enabled ? 'text-emerald-100' : 'text-slate-500'}"><input data-secondary-sync type="checkbox" value="${escapeHtml(source.id)}" ${source.enabled ? 'checked' : 'disabled'} class="accent-emerald-500">${escapeHtml(source.name)} ${source.enabled ? '' : '<span class="text-[9px]">(desativada)</span>'}</label>`).join('') || '<span class="text-xs text-slate-500">Nenhuma fonte cadastrada.</span>'}</div>
        </div>
        <p class="mt-3 text-[10px] text-purple-400">Catálogo canônico atual: ${Number(options?.catalog?.titles || 0)} obras · ${Number(options?.catalog?.active_sources || 0)} fontes ativas.</p>`;
      overlay.querySelector('#luxCanonicalStart')?.addEventListener('click', () => runSync(overlay, options));
    } catch (error) {
      overlay.querySelector('#luxCanonicalOptions').innerHTML = `<p class="rounded-xl border border-rose-900/40 bg-rose-950/10 p-3 text-xs text-rose-300">${escapeHtml(error?.message || 'Falha ao carregar opções.')}</p>`;
      overlay.querySelector('#luxCanonicalStart').disabled = true;
    }
  }

  function installAdminCard() {
    const panel = document.getElementById('adminTabSources');
    if (!panel || document.getElementById('luxCanonicalSyncCard')) return Boolean(document.getElementById('luxCanonicalSyncCard'));
    const card = document.createElement('section');
    card.id = 'luxCanonicalSyncCard';
    card.className = 'rounded-2xl border border-fuchsia-800/50 bg-[#160d20] p-4';
    card.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div><h4 class="text-sm font-bold text-white">Catálogo canônico do Lux</h4><p class="mt-1 max-w-3xl text-xs text-fuchsia-200/75">Normaliza obras e episódios no Supabase, guarda múltiplas fontes e evita comparar milhares de itens no navegador.</p></div>
        <button id="luxCanonicalSyncButton" type="button" class="rounded-xl bg-fuchsia-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-fuchsia-500">Sincronizar conteúdos</button>
      </div>`;
    panel.insertBefore(card, panel.firstChild);
    card.querySelector('#luxCanonicalSyncButton')?.addEventListener('click', openSyncModal);

    const apply = document.getElementById('secondaryApplyNow');
    if (apply && !apply.dataset.canonicalIntercept) {
      apply.dataset.canonicalIntercept = '1';
      apply.textContent = 'Sincronizar conteúdos';
      apply.addEventListener('click', event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        openSyncModal();
      }, true);
    }
    return true;
  }

  window.LuxCanonicalCatalog = {
    version: VERSION,
    reload,
    openSync: openSyncModal,
    normalizeTitle
  };

  let attempts = 0;
  const installTimer = setInterval(() => {
    attempts += 1;
    installAdminCard();
    const user = safeCurrentUser();
    const username = String(user?.user || '');
    if (username && username !== autoReloadedForUser && typeof allMediaItems !== 'undefined' && Array.isArray(allMediaItems) && allMediaItems.length) {
      autoReloadedForUser = username;
      reload({ refreshUi: true }).catch(error => console.warn('[LUX-CATALOG] Catálogo canônico indisponível:', error));
    }
    if (attempts >= 300) clearInterval(installTimer);
  }, 100);
})();