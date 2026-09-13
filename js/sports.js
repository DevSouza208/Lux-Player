(() => {
  'use strict';

  if (window.__luxSportsInstalled) return;
  window.__luxSportsInstalled = '20260912-sports2';

  const WATCH_LEAD_MS = 20 * 60 * 1000;
  const state = {
    games: [],
    mappings: [],
    loaded: false,
    loading: false,
    error: '',
    fetchedAt: '',
    observer: null,
    refreshTimer: null,
    activeTab: 'live'
  };

  const QUALITY_WORDS = new Set(['hd', 'fhd', 'uhd', 'sd', '4k', '8k', 'hevc', 'h265', 'h264', '60fps']);
  const AUTO_ALIASES = {
    'amazon': ['amazon', 'amazon prime', 'prime video'],
    'apple tv': ['apple tv', 'appletv'],
    'cazetv': ['cazetv', 'caze tv'],
    'disney': ['disney', 'disney plus'],
    'disney plus': ['disney', 'disney plus'],
    'espn brasil': ['espn brasil', 'espn'],
    'ge tv': ['ge tv', 'getv'],
    'globoplay': ['globoplay'],
    'onefootball': ['onefootball', 'one football'],
    'paramount': ['paramount', 'paramount plus'],
    'paramount plus': ['paramount', 'paramount plus'],
    'premiere': ['premiere'],
    'record': ['record', 'record tv'],
    'sportv': ['sportv', 'spor tv'],
    'sportynet': ['sportynet', 'sporty net'],
    'xsports': ['xsports', 'x sports']
  };

  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));

  const normalize = value => String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizeChannel = value => normalize(value)
    .split(' ')
    .filter(token => !QUALITY_WORDS.has(token))
    .join(' ')
    .replace(/^(br|bra|brasil)\s+/, '')
    .trim();

  const liveChannels = () => {
    try {
      return (Array.isArray(allMediaItems) ? allMediaItems : []).filter(item => item?.type === 'live' && item?.url && item?.name);
    } catch (_) {
      return [];
    }
  };

  const mappingMap = () => new Map((state.mappings || []).map(mapping => [normalize(mapping.broadcaster_key || mapping.broadcaster_name), mapping]));

  function scoreChannel(channelName, variants) {
    const candidate = normalizeChannel(channelName);
    if (!candidate) return 0;
    let best = 0;
    for (const rawVariant of variants) {
      const variant = normalizeChannel(rawVariant);
      if (!variant) continue;
      if (candidate === variant) best = Math.max(best, 120);
      else if (candidate.startsWith(variant + ' ') || candidate.endsWith(' ' + variant)) best = Math.max(best, 110);
      else if (candidate.includes(variant)) best = Math.max(best, 100);
      else {
        const tokens = variant.split(' ').filter(Boolean);
        if (tokens.length && tokens.every(token => candidate.split(' ').includes(token))) best = Math.max(best, 88);
      }
    }
    return best;
  }

  function aliasesFor(sourceName, mapping) {
    const key = normalize(sourceName);
    const aliases = [sourceName, ...(AUTO_ALIASES[key] || [])];
    if (mapping?.channel_hint) aliases.unshift(mapping.channel_hint);
    return [...new Set(aliases.filter(Boolean))];
  }

  function resolveBroadcaster(sourceName, allowWeakSuggestion = false) {
    const channels = liveChannels();
    if (!sourceName || !channels.length) return { channel: null, score: 0, ambiguous: false, suggestion: null };
    const mapping = mappingMap().get(normalize(sourceName));
    const ranked = channels
      .map(channel => ({ channel, score: scoreChannel(channel.name, aliasesFor(sourceName, mapping)) }))
      .filter(entry => entry.score > 0)
      .sort((a, b) => b.score - a.score || String(a.channel.name).localeCompare(String(b.channel.name)));

    if (!ranked.length) return { channel: null, score: 0, ambiguous: false, suggestion: null, mapping };
    const top = ranked[0];
    const sameTop = ranked.filter(entry => entry.score === top.score);
    const exactManual = Boolean(mapping?.channel_hint && normalizeChannel(top.channel.name) === normalizeChannel(mapping.channel_hint));
    const accepted = exactManual || (top.score >= 100 && sameTop.length === 1);
    if (accepted) return { channel: top.channel, score: top.score, ambiguous: false, suggestion: top.channel, mapping };
    return { channel: null, score: top.score, ambiguous: sameTop.length > 1, suggestion: allowWeakSuggestion ? top.channel : null, mapping };
  }

  function resolveGame(game) {
    const broadcasters = Array.isArray(game?.broadcasters) ? game.broadcasters : [];
    let best = null;
    for (const broadcaster of broadcasters) {
      const resolution = resolveBroadcaster(broadcaster, false);
      if (!resolution.channel) continue;
      if (!best || resolution.score > best.score) best = { ...resolution, broadcaster };
    }
    return best;
  }

  function localTodayKey() {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(new Date());
      const obj = Object.fromEntries(parts.map(part => [part.type, part.value]));
      return `${obj.year}-${obj.month}-${obj.day}`;
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function kickoffMs(game) {
    return new Date(game?.kickoff || `${game?.date}T${game?.time}:00-03:00`).getTime();
  }

  function gamesByTab(tab = state.activeTab) {
    const now = Date.now();
    const today = localTodayKey();
    const games = (state.games || []).filter(Boolean);

    if (tab === 'results') {
      return games
        .filter(game => game.status === 'finished' && game.date === today)
        .sort((a, b) => kickoffMs(b) - kickoffMs(a))
        .slice(0, 16);
    }

    if (tab === 'live') {
      return games
        .filter(game => game.status === 'live')
        .sort((a, b) => kickoffMs(a) - kickoffMs(b))
        .slice(0, 16);
    }

    return games
      .filter(game => game.status === 'scheduled' && Number.isFinite(kickoffMs(game)) && kickoffMs(game) >= now - (2 * 60 * 1000))
      .sort((a, b) => kickoffMs(a) - kickoffMs(b))
      .slice(0, 20);
  }

  function tabCount(tab) {
    return gamesByTab(tab).length;
  }

  function canWatchGame(game) {
    if (game?.status === 'live') return true;
    if (game?.status !== 'scheduled') return false;
    const start = kickoffMs(game);
    if (!Number.isFinite(start)) return false;
    const delta = start - Date.now();
    return delta <= WATCH_LEAD_MS && delta >= -2 * 60 * 1000;
  }

  function unlockLabel(game) {
    const start = kickoffMs(game);
    if (!Number.isFinite(start)) return 'Disponível 20 min antes';
    const unlock = new Date(start - WATCH_LEAD_MS);
    try {
      return `Disponível às ${unlock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    } catch (_) {
      return 'Disponível 20 min antes';
    }
  }

  function formatKickoff(game) {
    if (game?.status === 'live') return 'AO VIVO';
    if (game?.status === 'finished') return 'FIM';
    return game?.time || '';
  }

  function ensureHomeTabs() {
    const container = document.getElementById('homeJogosContainer');
    const section = container?.parentElement;
    if (!container || !section) return null;
    let tabs = section.querySelector('[data-lux-sports-tabs]');
    if (!tabs) {
      tabs = document.createElement('div');
      tabs.dataset.luxSportsTabs = '1';
      tabs.className = 'flex flex-wrap gap-2';
      const title = section.querySelector('h3');
      if (title?.nextSibling) section.insertBefore(tabs, title.nextSibling);
      else section.insertBefore(tabs, container);
    }

    const definitions = [
      ['results', 'Resultados'],
      ['live', 'Ao vivo'],
      ['upcoming', 'Próximas partidas']
    ];
    tabs.innerHTML = definitions.map(([key, label]) => {
      const active = state.activeTab === key;
      const count = tabCount(key);
      return `<button type="button" data-sports-tab="${key}" class="rounded-xl border px-3 py-2 text-[11px] font-bold transition ${active ? 'border-purple-500 bg-purple-600 text-white' : 'border-purple-900/60 bg-[#120c1f] text-purple-300 hover:bg-[#1a122c]'}">${label}<span class="ml-1.5 opacity-70">${count}</span></button>`;
    }).join('');

    tabs.querySelectorAll('[data-sports-tab]').forEach(button => {
      button.addEventListener('click', () => {
        state.activeTab = button.dataset.sportsTab || 'live';
        renderHome();
      });
    });
    return tabs;
  }

  function emptyMessage(tab) {
    if (tab === 'results') return 'Nenhum resultado de hoje por enquanto.';
    if (tab === 'live') return 'Nenhuma partida ao vivo agora.';
    return 'Nenhuma próxima partida encontrada.';
  }

  function renderHome() {
    const container = document.getElementById('homeJogosContainer');
    if (!container || !state.loaded) return;
    ensureHomeTabs();
    const games = gamesByTab();

    if (!games.length) {
      container.innerHTML = `<p data-lux-sports-empty="1" class="text-xs text-purple-400/70">${emptyMessage(state.activeTab)}</p>`;
      return;
    }

    container.innerHTML = games.map(game => {
      const resolved = resolveGame(game);
      const live = game.status === 'live';
      const finished = game.status === 'finished';
      const broadcasters = Array.isArray(game.broadcasters) ? game.broadcasters : [];
      const hasScore = (live || finished) && Number.isFinite(Number(game.score_home)) && Number.isFinite(Number(game.score_away));
      const score = hasScore ? `${Number(game.score_home)} × ${Number(game.score_away)}` : '×';
      const eligible = canWatchGame(game);

      let action = '';
      if (finished) {
        action = '';
      } else if (eligible && resolved?.channel) {
        action = `<button type="button" data-sports-watch="${esc(game.id)}" class="mt-3 w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-2 text-[11px] font-black text-white transition">Assistir na ${esc(resolved.broadcaster)}</button>`;
      } else if (!eligible && game.status === 'scheduled') {
        action = `<div class="mt-3 rounded-xl border border-purple-900/50 bg-[#100a1c] px-3 py-2 text-center text-[10px] text-purple-400">${esc(unlockLabel(game))}</div>`;
      } else {
        action = `<div class="mt-3 rounded-xl border border-purple-900/50 bg-[#100a1c] px-3 py-2 text-[10px] text-purple-300">${broadcasters.length ? `📺 ${esc(broadcasters.join(', '))}` : 'Transmissão não informada'}</div>`;
      }

      const border = live ? 'border-rose-500/45' : finished ? 'border-slate-700/60' : 'border-purple-900/60';
      const badge = live ? 'bg-rose-500/20 text-rose-300' : finished ? 'bg-slate-800 text-slate-300' : 'bg-purple-950 text-purple-300';
      const scoreClass = finished ? 'text-slate-200' : 'text-emerald-300';

      return `<article data-lux-sports-card="1" class="w-[260px] shrink-0 rounded-2xl border ${border} bg-[#120c1f] p-4 shadow-lg">
        <div class="flex items-center justify-between gap-2">
          <span class="truncate text-[10px] font-bold uppercase tracking-wide text-purple-300">${esc(game.competition || 'Futebol')}</span>
          <span class="shrink-0 rounded-full px-2 py-1 text-[9px] font-black ${badge}">${esc(formatKickoff(game))}</span>
        </div>
        <div class="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-center">
          <strong class="text-xs leading-tight text-white">${esc(game.home)}</strong>
          <strong class="text-sm ${scoreClass}">${esc(score)}</strong>
          <strong class="text-xs leading-tight text-white">${esc(game.away)}</strong>
        </div>
        ${action}
        <div class="mt-2 text-right text-[9px] text-purple-500">Dados: Super Placar</div>
      </article>`;
    }).join('');

    container.querySelectorAll('[data-sports-watch]').forEach(button => {
      button.addEventListener('click', () => {
        const game = state.games.find(item => String(item.id) === String(button.dataset.sportsWatch));
        if (!game || !canWatchGame(game)) return;
        const resolved = resolveGame(game);
        if (!resolved?.channel) return;
        try {
          if (typeof setSection === 'function') setSection('live');
          setTimeout(() => {
            if (typeof playLiveChannel === 'function') playLiveChannel(resolved.channel);
          }, 40);
        } catch (error) {
          console.warn('[Lux Sports] Não foi possível abrir o canal:', error);
        }
      });
    });
  }

  function unresolvedBroadcasters() {
    const counts = new Map();
    for (const game of state.games || []) {
      if (game?.status === 'finished') continue;
      for (const broadcaster of game?.broadcasters || []) {
        const key = normalize(broadcaster);
        if (!key) continue;
        counts.set(key, { name: broadcaster, count: (counts.get(key)?.count || 0) + 1 });
      }
    }
    return [...counts.values()]
      .map(entry => ({ ...entry, resolution: resolveBroadcaster(entry.name, true) }))
      .filter(entry => !entry.resolution.channel)
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }

  function channelDatalistHtml() {
    const names = [...new Set(liveChannels().map(channel => String(channel.name || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'pt-BR'));
    return names.map(name => `<option value="${esc(name)}"></option>`).join('');
  }

  function injectAdmin() {
    const modal = document.getElementById('adminModal');
    if (!modal || document.querySelector('[data-admin-tab="sports"]')) return;
    const tabs = modal.querySelector('.admin-tab-btn')?.parentElement;
    if (!tabs) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.adminTab = 'sports';
    button.className = 'admin-tab-btn bg-[#180f29] text-purple-200 hover:bg-[#23153b] px-3 py-2 rounded-xl text-[11px] font-bold';
    button.textContent = 'Esportes';
    button.addEventListener('click', () => {
      try { if (typeof switchAdminTab === 'function') switchAdminTab('sports'); } catch (_) {}
      renderAdmin();
    });
    tabs.appendChild(button);

    const panel = document.createElement('div');
    panel.id = 'adminTabSports';
    panel.className = 'admin-tab-panel hidden overflow-y-auto pr-1 space-y-4';
    panel.innerHTML = '<p class="text-xs text-purple-300">Preparando esportes...</p>';
    const firstPanel = modal.querySelector('.admin-tab-panel');
    firstPanel?.parentElement?.appendChild(panel);
  }

  function renderAdmin() {
    injectAdmin();
    const panel = document.getElementById('adminTabSports');
    if (!panel) return;

    let admin = false;
    try { admin = currentUser?.role === 'admin' || currentUser?.accountRole === 'admin'; } catch (_) {}
    if (!admin) {
      panel.innerHTML = '<p class="text-sm text-rose-300">Área exclusiva de administrador.</p>';
      return;
    }

    const unresolved = unresolvedBroadcasters();
    const mappings = state.mappings || [];
    const status = state.error
      ? `<span class="text-rose-300">${esc(state.error)}</span>`
      : state.loading
        ? '<span class="text-purple-300">Atualizando...</span>'
        : `<span class="text-emerald-300">${state.games.length} jogos carregados</span>`;

    panel.innerHTML = `
      <section class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-base font-bold text-white">Esportes ao vivo</h3>
            <p class="mt-1 text-xs text-purple-300">O Lux tenta casar as emissoras do Super Placar com os canais da lista. O que não for reconhecido aparece aqui para validação.</p>
          </div>
          <button id="sportsAdminRefresh" type="button" class="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-500">Atualizar agora</button>
        </div>
        <p id="sportsAdminStatus" class="mt-3 text-xs">${status}</p>
      </section>

      <section class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
        <div class="flex items-center justify-between gap-3">
          <div><h3 class="text-sm font-bold text-white">Pendentes de validação</h3><p class="mt-1 text-xs text-purple-400">Escolha como a emissora deve ser encontrada na sua lista.</p></div>
          <span class="rounded-full bg-purple-950 px-2.5 py-1 text-[10px] font-bold text-purple-300">${unresolved.length}</span>
        </div>
        <datalist id="sportsChannelOptions">${channelDatalistHtml()}</datalist>
        <div class="mt-4 space-y-3" id="sportsUnresolvedList">
          ${unresolved.length ? unresolved.map(entry => {
            const suggestion = entry.resolution?.suggestion?.name || entry.resolution?.mapping?.channel_hint || '';
            return `<div class="rounded-2xl border border-purple-900/50 bg-[#180f29] p-4">
              <div class="flex flex-wrap items-center justify-between gap-2"><strong class="text-sm text-white">${esc(entry.name)}</strong><span class="text-[10px] text-purple-400">${entry.count} jogo(s)</span></div>
              <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <input list="sportsChannelOptions" data-sports-map-input="${esc(entry.name)}" value="${esc(suggestion)}" placeholder="Ex.: BR | Premiere HD" class="min-w-0 flex-1 rounded-xl border border-purple-800/60 bg-[#120c1f] px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none">
                <button type="button" data-sports-map-save="${esc(entry.name)}" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">Validar</button>
              </div>
            </div>`;
          }).join('') : '<p class="rounded-2xl border border-emerald-800/40 bg-emerald-950/20 p-4 text-xs text-emerald-300">Tudo resolvido por enquanto. ✨</p>'}
        </div>
      </section>

      <section class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
        <h3 class="text-sm font-bold text-white">Mapeamentos manuais</h3>
        <p class="mt-1 text-xs text-purple-400">Essas escolhas ficam salvas na nuvem e são reutilizadas automaticamente.</p>
        <div class="mt-4 space-y-2">
          ${mappings.length ? mappings.map(mapping => `<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-purple-900/50 bg-[#180f29] px-4 py-3">
            <div class="min-w-0"><strong class="block text-xs text-white">${esc(mapping.broadcaster_name)}</strong><span class="block truncate text-[11px] text-purple-300">→ ${esc(mapping.channel_hint)}</span></div>
            <button type="button" data-sports-map-delete="${esc(mapping.broadcaster_key || mapping.broadcaster_name)}" class="rounded-lg border border-rose-800/60 px-3 py-1.5 text-[10px] font-bold text-rose-300 hover:bg-rose-950/40">Remover</button>
          </div>`).join('') : '<p class="text-xs text-purple-500">Nenhum mapeamento manual salvo.</p>'}
        </div>
      </section>`;

    panel.querySelector('#sportsAdminRefresh')?.addEventListener('click', () => loadFeed(true));
    panel.querySelectorAll('[data-sports-map-save]').forEach(button => button.addEventListener('click', () => {
      const source = button.dataset.sportsMapSave;
      const input = panel.querySelector(`[data-sports-map-input="${CSS.escape(source)}"]`);
      saveMapping(source, input?.value || '');
    }));
    panel.querySelectorAll('[data-sports-map-delete]').forEach(button => button.addEventListener('click', () => deleteMapping(button.dataset.sportsMapDelete)));
  }

  async function invoke(body) {
    let client;
    try { client = supabaseClient; } catch (_) { throw new Error('Conexão indisponível.'); }
    const { data, error } = await client.functions.invoke('sports-feed', { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  async function loadFeed(force = false) {
    if (state.loading) return;
    state.loading = true;
    state.error = '';
    renderAdmin();
    try {
      let body = { action: 'feed' };
      if (force) {
        let username = '', password = '';
        try { username = currentUser?.user || ''; password = currentUser?.pass || ''; } catch (_) {}
        body = { action: 'refresh', username, password };
      }
      const data = await invoke(body);
      state.games = Array.isArray(data.games) ? data.games : [];
      state.mappings = Array.isArray(data.mappings) ? data.mappings : [];
      state.fetchedAt = data.fetched_at || '';
      state.loaded = true;
      renderHome();
    } catch (error) {
      state.error = error?.message || 'Não foi possível atualizar os esportes.';
      console.warn('[Lux Sports]', error);
    } finally {
      state.loading = false;
      renderAdmin();
    }
  }

  async function saveMapping(sourceName, channelHint) {
    const source = String(sourceName || '').trim();
    const hint = String(channelHint || '').trim();
    if (!source || !hint) return;
    let username = '', password = '';
    try { username = currentUser?.user || ''; password = currentUser?.pass || ''; } catch (_) {}
    const status = document.getElementById('sportsAdminStatus');
    if (status) status.textContent = 'Salvando mapeamento...';
    try {
      const data = await invoke({ action: 'save_mapping', username, password, broadcaster_name: source, channel_hint: hint });
      state.mappings = Array.isArray(data.mappings) ? data.mappings : state.mappings;
      renderAdmin();
      renderHome();
    } catch (error) {
      if (status) status.textContent = error?.message || 'Não foi possível salvar.';
    }
  }

  async function deleteMapping(sourceKey) {
    let username = '', password = '';
    try { username = currentUser?.user || ''; password = currentUser?.pass || ''; } catch (_) {}
    try {
      const data = await invoke({ action: 'delete_mapping', username, password, broadcaster_key: sourceKey });
      state.mappings = Array.isArray(data.mappings) ? data.mappings : state.mappings;
      renderAdmin();
      renderHome();
    } catch (error) {
      const status = document.getElementById('sportsAdminStatus');
      if (status) status.textContent = error?.message || 'Não foi possível remover.';
    }
  }

  function watchHomeFallback() {
    const container = document.getElementById('homeJogosContainer');
    if (!container || state.observer) return;
    state.observer = new MutationObserver(() => {
      if (!state.loaded || !state.games.length) return;
      const section = container.parentElement;
      if (!section?.querySelector('[data-lux-sports-tabs]')) queueMicrotask(renderHome);
    });
    state.observer.observe(container, { childList: true });
  }

  function start() {
    injectAdmin();
    watchHomeFallback();
    loadFeed(false);
    state.refreshTimer = setInterval(() => {
      loadFeed(false);
      renderHome();
    }, 60_000);
    window.LuxSports = {
      refresh: () => loadFeed(false),
      refreshAdmin: () => loadFeed(true),
      render: renderHome,
      resolveBroadcaster,
      state
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();