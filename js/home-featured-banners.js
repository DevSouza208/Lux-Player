(() => {
  'use strict';

  const VERSION = '20260914-home-featured-1';
  if (window.__luxHomeFeaturedVersion === VERSION) return;
  window.__luxHomeFeaturedVersion = VERSION;

  const CACHE_MS = 60_000;
  let publicCache = { at: 0, banners: [] };
  let heroTimer = null;
  let heroGeneration = 0;
  let adminBanners = [];
  let sourceOptions = new Map();

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const currentAccount = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; }
  };

  async function invoke(action, payload = {}, admin = false) {
    if (typeof supabaseClient === 'undefined') throw new Error('Supabase indisponível.');
    const account = currentAccount();
    const body = { action, ...payload };
    if (admin) {
      if (!account || account.role !== 'admin') throw new Error('Apenas administradores podem alterar os destaques.');
      body.username = account.user;
      body.credential = account.pass;
    }
    const { data, error } = await supabaseClient.functions.invoke('home-banners', { body });
    if (error || data?.error) {
      let message = data?.error || 'Não foi possível acessar os destaques.';
      try { message = (await error.context.json()).error || message; } catch (_) {}
      throw new Error(message);
    }
    return data || {};
  }

  async function listPublic(force = false) {
    const now = Date.now();
    if (!force && now - publicCache.at < CACHE_MS) return publicCache.banners;
    try {
      const data = await invoke('list_public');
      publicCache = { at: now, banners: Array.isArray(data.banners) ? data.banners : [] };
    } catch (error) {
      console.warn('[Lux Home] Destaques personalizados indisponíveis:', error);
      if (!publicCache.at) publicCache = { at: now, banners: [] };
    }
    return publicCache.banners;
  }

  function normalizeTitle(value = '') {
    return String(value).toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\(.*?\)/g, '').replace(/\[.*?\]/g, '')
      .replace(/\b(dublado|legendado|dual|4k|fhd|uhd|hd|sd|h265|hevc|pt-br)\b/g, '')
      .replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function localMedia() {
    try { return Array.isArray(allMediaItems) ? allMediaItems : []; } catch (_) { return []; }
  }

  async function tmdbCards() {
    try {
      const response = await fetch('https://api.themoviedb.org/3/trending/all/week?api_key=' + encodeURIComponent(TMDB_API_KEY) + '&language=pt-BR');
      if (!response.ok) return [];
      const data = await response.json();
      const trends = (data.results || []).filter(item => {
        try { return typeof profileAllowsMedia !== 'function' || profileAllowsMedia(item); } catch (_) { return true; }
      });
      const media = localMedia();
      const matched = [];
      for (const tmdb of trends) {
        const target = normalizeTitle(tmdb.title || tmdb.name);
        if (!target) continue;
        let best = null;
        let score = 0;
        for (const item of media) {
          if (item?.type === 'live') continue;
          const local = normalizeTitle(item?.name);
          const candidateScore = local === target ? 100 : local.startsWith(target + ' ') ? 80 : 0;
          if (candidateScore > score) { score = candidateScore; best = item; }
        }
        if (best && !matched.some(entry => String(entry.item.id) === String(best.id))) {
          matched.push({ source: 'tmdb', item: best, tmdb });
        }
        if (matched.length >= 5) break;
      }
      return matched;
    } catch (error) {
      console.warn('[Lux Home] TMDB indisponível:', error);
      return [];
    }
  }

  function interleave(tmdb, custom) {
    const customCards = custom.map(banner => ({ source: 'custom', banner }));
    if (!tmdb.length) return customCards;
    if (!customCards.length) return tmdb;
    const result = [];
    let a = 0, b = 0;
    while (a < tmdb.length || b < customCards.length) {
      for (let i = 0; i < 2 && a < tmdb.length; i++) result.push(tmdb[a++]);
      if (b < customCards.length) result.push(customCards[b++]);
    }
    return result;
  }

  function heroElements() {
    const wrap = $('heroContentWrap');
    return {
      title: $('heroTitle'), overview: $('heroOverview'), bg: $('heroBgImage'), play: $('heroPlayBtn'),
      wrap, poster: $('heroPosterImage'), badge: wrap?.querySelector('.max-w-xl > span') || wrap?.querySelector('span')
    };
  }

  function ensureCustomVisual(poster) {
    const holder = poster?.parentElement;
    if (!holder) return null;
    let visual = holder.querySelector('#heroCustomVisual');
    if (!visual) {
      visual = document.createElement('div');
      visual.id = 'heroCustomVisual';
      visual.className = 'hidden w-40 md:w-52 min-h-[210px] rounded-2xl border border-purple-800/50 bg-[#100a1c]/90 shadow-2xl overflow-hidden';
      holder.appendChild(visual);
    }
    return visual;
  }

  function ensureCompetitionLogo(title) {
    if (!title?.parentElement) return null;
    let logo = title.parentElement.querySelector('#heroCompetitionLogo');
    if (!logo) {
      logo = document.createElement('img');
      logo.id = 'heroCompetitionLogo';
      logo.alt = '';
      logo.className = 'hidden max-h-10 max-w-[180px] object-contain object-left';
      title.parentElement.insertBefore(logo, title);
    }
    return logo;
  }

  function formatKickoff(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  }

  function sportIsLive(banner) {
    const kickoff = Date.parse(banner.event_at || '');
    if (!Number.isFinite(kickoff)) return false;
    const delta = Date.now() - kickoff;
    return delta >= -3 * 60_000 && delta <= 180 * 60_000;
  }

  function sportDescription(banner) {
    const pieces = [];
    if (banner.description) pieces.push(banner.description);
    if (banner.phase) pieces.push(banner.phase);
    const kickoff = formatKickoff(banner.event_at);
    if (kickoff) pieces.push(kickoff);
    const channels = Array.isArray(banner.channels) ? banner.channels.map(channel => channel?.label || channel).filter(Boolean) : [];
    if (channels.length) pieces.push('Transmissão: ' + channels.join(' · '));
    return pieces.join('  •  ') || 'Jogo em destaque no Lux Play.';
  }

  function setBadge(el, text, live = false) {
    if (!el) return;
    el.textContent = text || 'Em alta 🔥';
    el.className = live
      ? 'text-[10px] bg-emerald-500 text-white px-2.5 py-1 rounded-md font-black uppercase tracking-wider animate-pulse'
      : 'text-[10px] bg-purple-600 text-white px-2.5 py-1 rounded-md font-bold uppercase tracking-wider';
  }

  function showPoster(el, url) {
    const visual = ensureCustomVisual(el);
    if (visual) visual.classList.add('hidden');
    if (!url) return el?.classList.add('hidden');
    el.src = url;
    el.classList.remove('hidden');
  }

  function showSportVisual(el, banner) {
    const visual = ensureCustomVisual(el);
    if (!visual) return;
    el.classList.add('hidden');
    const team = (url, name) => url
      ? `<img src="${esc(url)}" alt="" class="h-20 w-20 object-contain" referrerpolicy="no-referrer">`
      : `<div class="h-20 w-20 rounded-2xl border border-purple-800/60 bg-purple-950/50 flex items-center justify-center text-xl font-black text-purple-200">${esc(String(name || '?').slice(0, 2).toUpperCase())}</div>`;
    const home = banner.source_payload?.home || String(banner.title || '').split(/\s+[x×]\s+/i)[0] || 'Casa';
    const away = banner.source_payload?.away || String(banner.title || '').split(/\s+[x×]\s+/i)[1] || 'Visitante';
    visual.innerHTML = `<div class="min-h-[210px] p-4 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-purple-950/70 via-[#100a1c] to-black/80"><div class="flex items-center justify-center gap-3">${team(banner.left_image_url, home)}<span class="text-xl font-black text-emerald-300">×</span>${team(banner.right_image_url, away)}</div><div class="text-center"><strong class="block text-xs text-white">${esc(home)} × ${esc(away)}</strong>${banner.event_at ? `<span class="mt-1 block text-[10px] text-purple-300">${esc(formatKickoff(banner.event_at))}</span>` : ''}</div></div>`;
    visual.classList.remove('hidden');
  }

  function resetHeroExtras(elements) {
    const logo = ensureCompetitionLogo(elements.title);
    if (logo) { logo.classList.add('hidden'); logo.removeAttribute('src'); }
    const custom = ensureCustomVisual(elements.poster);
    if (custom) custom.classList.add('hidden');
  }

  function mediaAction(item) {
    if (!item) return;
    if (item.type === 'series') {
      if (typeof openSeriesModal === 'function') openSeriesModal(item);
      else if (typeof openVodPlayer === 'function') openVodPlayer(item);
    } else if (typeof openMovieModal === 'function' && item.type === 'movies') openMovieModal(item);
    else if (typeof openVodPlayer === 'function') openVodPlayer(item);
  }

  function runBannerAction(banner) {
    const type = String(banner.cta_type || 'none');
    const value = String(banner.cta_value || '');
    if (type === 'url' && /^https?:\/\//i.test(value)) return window.open(value, '_blank', 'noopener');
    if (type === 'media') {
      const item = localMedia().find(entry => String(entry.id) === value || String(entry.url) === value || String(entry.name) === value);
      if (item) return mediaAction(item);
    }
    if (type === 'live') {
      const urls = [value, ...(banner.source_payload?.channelUrls || [])].filter(Boolean);
      const item = localMedia().find(entry => entry.type === 'live' && urls.includes(String(entry.url)));
      if (item) {
        try { if (typeof setSection === 'function') setSection('live'); } catch (_) {}
        return setTimeout(() => { try { playLiveChannel(item); } catch (_) {} }, 30);
      }
    }
    if (type === 'game') {
      try {
        if (typeof openGameEmulatorById === 'function') return openGameEmulatorById(value);
        if (typeof setSection === 'function') return setSection('games');
      } catch (_) {}
    }
    if (type === 'book') {
      try { if (typeof setSection === 'function') setSection('reading'); } catch (_) {}
      setTimeout(() => {
        const search = $('readingSearch');
        if (search && (banner.title || banner.subtitle)) {
          search.value = banner.title || banner.subtitle;
          search.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, 80);
    }
  }

  function renderTmdbCard(card, elements) {
    resetHeroExtras(elements);
    const { item, tmdb } = card;
    setBadge(elements.badge, 'Em alta 🔥');
    elements.title.textContent = tmdb.title || tmdb.name || item.name;
    elements.overview.textContent = tmdb.overview || 'Aproveite este destaque no seu catálogo.';
    const backdrop = tmdb.backdrop_path ? `https://image.tmdb.org/t/p/original${tmdb.backdrop_path}` : item.logo || '';
    elements.bg.style.backgroundImage = backdrop ? `url('${backdrop.replace(/'/g, "%27")}')` : '';
    showPoster(elements.poster, tmdb.poster_path ? `https://image.tmdb.org/t/p/w500${tmdb.poster_path}` : item.logo || '');
    elements.play.classList.remove('hidden');
    elements.play.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-white"></i> Assistir Agora';
    elements.play.onclick = () => mediaAction(item);
  }

  function renderCustomCard(card, elements) {
    const banner = card.banner;
    resetHeroExtras(elements);
    const isSport = banner.kind === 'sport';
    const live = isSport && sportIsLive(banner);
    setBadge(elements.badge, live ? 'AO VIVO' : (banner.badge || (isSport ? 'JOGO EM DESTAQUE' : 'DESTAQUE LUX')), live);

    const competitionLogo = ensureCompetitionLogo(elements.title);
    if (competitionLogo && banner.competition_logo_url) {
      competitionLogo.src = banner.competition_logo_url;
      competitionLogo.classList.remove('hidden');
    }

    const defaultTitle = isSport && banner.source_payload?.home && banner.source_payload?.away
      ? `${banner.source_payload.home} × ${banner.source_payload.away}`
      : banner.title;
    elements.title.textContent = banner.classic_name || defaultTitle || banner.subtitle || 'Destaque Lux';
    elements.overview.textContent = isSport ? sportDescription(banner) : (banner.description || banner.subtitle || 'Destaque selecionado pelo Lux Play.');

    const bg = banner.backdrop_url || banner.poster_url || banner.logo_url || banner.competition_logo_url || banner.left_image_url || banner.right_image_url || '';
    elements.bg.style.backgroundImage = bg ? `url('${String(bg).replace(/'/g, "%27")}')` : '';

    if (isSport) showSportVisual(elements.poster, banner);
    else showPoster(elements.poster, banner.poster_url || banner.logo_url || banner.competition_logo_url || '');

    if (banner.cta_type && banner.cta_type !== 'none') {
      elements.play.classList.remove('hidden');
      const label = banner.cta_label || (live && banner.cta_type === 'live' ? 'Assistir ao vivo' : banner.kind === 'book' ? 'Abrir leitura' : banner.kind === 'game' ? 'Ver jogo' : 'Abrir destaque');
      elements.play.innerHTML = `<i data-lucide="${live ? 'radio' : banner.kind === 'book' ? 'book-open' : banner.kind === 'game' ? 'gamepad-2' : 'play'}" class="w-4 h-4"></i> ${esc(label)}`;
      elements.play.onclick = () => runBannerAction(banner);
    } else {
      elements.play.classList.add('hidden');
      elements.play.onclick = null;
    }
  }

  function fallbackCard(elements) {
    const movie = localMedia().find(item => item.type === 'movies');
    if (!movie) return;
    resetHeroExtras(elements);
    setBadge(elements.badge, 'Destaque Lux');
    elements.title.textContent = movie.name || 'Lux Play';
    elements.overview.textContent = 'Destaque disponível em sua lista.';
    elements.bg.style.backgroundImage = movie.logo ? `url('${String(movie.logo).replace(/'/g, "%27")}')` : '';
    showPoster(elements.poster, movie.logo || '');
    elements.play.classList.remove('hidden');
    elements.play.innerHTML = '<i data-lucide="play" class="w-4 h-4 fill-white"></i> Assistir Agora';
    elements.play.onclick = () => mediaAction(movie);
  }

  async function renderHeroCarousel() {
    const generation = ++heroGeneration;
    const account = currentAccount();
    const elements = heroElements();
    if (!elements.title || !elements.overview || !elements.bg || !elements.wrap || !elements.poster || !elements.play) return;
    if (heroTimer) clearInterval(heroTimer);

    elements.title.textContent = 'Buscando tendências...';
    elements.overview.textContent = 'Misturando os destaques do Lux com o seu catálogo.';
    elements.wrap.style.opacity = '1';

    const [automatic, custom] = await Promise.all([tmdbCards(), listPublic()]);
    if (generation !== heroGeneration || currentAccount() !== account) return;
    const cards = interleave(automatic, custom).slice(0, 18);
    if (!cards.length) return fallbackCard(elements);

    let index = 0;
    const paint = () => {
      if (generation !== heroGeneration || currentAccount() !== account) return;
      const card = cards[index];
      elements.bg.style.opacity = '0';
      elements.wrap.style.opacity = '0';
      setTimeout(() => {
        if (generation !== heroGeneration || currentAccount() !== account) return;
        if (card.source === 'custom') renderCustomCard(card, elements);
        else renderTmdbCard(card, elements);
        elements.bg.style.opacity = '0.25';
        elements.wrap.style.opacity = '1';
        try { lucide.createIcons(); } catch (_) {}
        index = (index + 1) % cards.length;
      }, 260);
    };
    paint();
    heroTimer = setInterval(paint, 7000);
  }

  function inputClass() {
    return 'w-full mt-1 bg-[#180f29] border border-purple-900/50 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500';
  }

  function installAdminTab() {
    const modal = $('adminModal');
    if (!modal || $('adminTabHighlights')) return;
    const tabRow = modal.querySelector('.admin-tab-btn')?.parentElement;
    const firstPanel = modal.querySelector('.admin-tab-panel');
    if (!tabRow || !firstPanel?.parentElement) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.adminTab = 'highlights';
    button.className = 'admin-tab-btn bg-[#180f29] text-purple-200 hover:bg-[#23153b] px-3 py-2 rounded-xl text-[11px] font-bold';
    button.textContent = 'Destaques';
    button.onclick = () => {
      try { switchAdminTab('highlights'); } catch (_) {}
      setTimeout(() => refreshAdmin(true), 0);
    };
    tabRow.insertBefore(button, tabRow.querySelector('[data-admin-tab="avatars"]'));

    const panel = document.createElement('div');
    panel.id = 'adminTabHighlights';
    panel.className = 'admin-tab-panel hidden overflow-y-auto pr-1 space-y-4';
    panel.innerHTML = adminHtml();
    firstPanel.parentElement.appendChild(panel);
    wireAdmin();
    try { lucide.createIcons(); } catch (_) {}
  }

  function adminHtml() {
    const c = inputClass();
    return `<div class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5 md:p-6 space-y-5">
      <div class="flex flex-wrap items-start justify-between gap-3"><div><h3 class="text-base font-bold text-white">Destaques da Home</h3><p class="mt-1 text-xs text-purple-300">Crie banners de jogos, games, livros e conteúdos especiais. Eles entram no carrossel junto com os destaques automáticos do TMDB e somem sozinhos na data final.</p></div><button id="homeBannerNew" type="button" class="rounded-xl bg-purple-950 px-4 py-2 text-xs font-bold text-purple-200 hover:bg-purple-900">Novo destaque</button></div>
      <form id="homeBannerForm" class="space-y-4">
        <input id="homeBannerId" type="hidden">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label class="text-[11px] text-purple-300">Tipo<select id="homeBannerKind" class="${c}"><option value="sport">Jogo / esporte</option><option value="game">Game em destaque</option><option value="book">Livro em destaque</option><option value="movie">Filme</option><option value="series">Série</option><option value="custom">Personalizado</option></select></label>
          <label class="md:col-span-2 text-[11px] text-purple-300">Puxar dados de um item já existente<div class="mt-1 flex gap-2"><select id="homeBannerSource" class="${c.replace('mt-1 ', '')}"><option value="">Carregar opções...</option></select><button id="homeBannerSourceRefresh" type="button" class="shrink-0 rounded-xl border border-purple-800/60 bg-purple-950/60 px-3 text-purple-200" title="Atualizar opções"><i data-lucide="refresh-cw" class="h-4 w-4"></i></button></div></label>
        </div>
        <div id="homeBannerSportFields" class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label class="text-[11px] text-purple-300">Competição<input id="homeBannerCompetition" class="${c}" placeholder="Brasileirão, Champions League..."></label>
          <label class="text-[11px] text-purple-300">Nome do clássico / chamada<input id="homeBannerClassic" class="${c}" placeholder="Derby, Majestoso, Choque-Rei..."></label>
          <label class="text-[11px] text-purple-300">Fase<input id="homeBannerPhase" class="${c}" placeholder="Semifinal · Jogo de ida"></label>
          <label class="text-[11px] text-purple-300">Horário do jogo<input id="homeBannerEventAt" type="datetime-local" class="${c}"></label>
          <label class="md:col-span-2 text-[11px] text-purple-300">Canais de transmissão<textarea id="homeBannerChannels" rows="2" class="${c}" placeholder="Premiere\nSporTV\nGlobo"></textarea></label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label class="md:col-span-2 text-[11px] text-purple-300">Título<input id="homeBannerTitle" maxlength="160" class="${c}" placeholder="Título do destaque"></label>
          <label class="text-[11px] text-purple-300">Subtítulo / autor / detalhe<input id="homeBannerSubtitle" maxlength="180" class="${c}" placeholder="Autor, console, chamada..."></label>
          <label class="text-[11px] text-purple-300">Selo<input id="homeBannerBadge" maxlength="80" class="${c}" placeholder="EM ALTA, JOGO EM DESTAQUE..."></label>
          <label class="md:col-span-2 text-[11px] text-purple-300">Descrição<textarea id="homeBannerDescription" rows="3" maxlength="1200" class="${c}" placeholder="Texto que aparece abaixo do título"></textarea></label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          ${imageField('Poster / capa', 'Poster')}${imageField('Imagem de fundo', 'Backdrop')}${imageField('Logo da competição / marca', 'CompetitionLogo')}${imageField('Escudo / imagem esquerda', 'Left')}${imageField('Escudo / imagem direita', 'Right')}
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label class="text-[11px] text-purple-300">Ação do botão<select id="homeBannerCtaType" class="${c}"><option value="none">Sem botão</option><option value="media">Abrir filme/série</option><option value="live">Abrir transmissão</option><option value="game">Abrir game</option><option value="book">Abrir leitura</option><option value="url">Abrir link</option></select></label>
          <label class="text-[11px] text-purple-300">Texto do botão<input id="homeBannerCtaLabel" class="${c}" placeholder="Assistir ao vivo"></label>
          <label class="text-[11px] text-purple-300">Destino / ID / URL<input id="homeBannerCtaValue" class="${c}" placeholder="Preenchido ao escolher uma origem"></label>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <label class="text-[11px] text-purple-300">Começa a aparecer<input id="homeBannerStartsAt" type="datetime-local" class="${c}"></label>
          <label class="text-[11px] text-purple-300">Para de aparecer<input id="homeBannerEndsAt" type="datetime-local" class="${c}"></label>
          <label class="text-[11px] text-purple-300">Prioridade<input id="homeBannerPriority" type="number" min="-1000" max="1000" value="0" class="${c}"></label>
          <label class="mt-5 flex items-center gap-2 rounded-xl border border-purple-900/50 bg-[#180f29] px-3 py-2 text-xs text-purple-200"><input id="homeBannerEnabled" type="checkbox" checked>Publicado</label>
        </div>
        <div id="homeBannerPreview" class="rounded-2xl border border-purple-900/50 bg-[#09060e] p-4"></div>
        <div class="flex flex-wrap gap-2"><button id="homeBannerSave" class="rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-emerald-500">Salvar destaque</button><button id="homeBannerCancel" type="button" class="rounded-xl border border-purple-800/60 px-4 py-2.5 text-xs font-bold text-purple-200">Limpar</button><span id="homeBannerStatus" class="self-center text-xs text-purple-300"></span></div>
      </form>
    </div>
    <div class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5 md:p-6"><div class="flex items-center justify-between gap-3"><div><h3 class="text-sm font-bold text-white">Destaques cadastrados</h3><p class="mt-1 text-xs text-purple-400">Ativos, agendados e expirados continuam editáveis aqui.</p></div><button id="homeBannerReload" class="rounded-xl bg-purple-950 px-3 py-2 text-xs font-bold text-purple-200">Atualizar</button></div><div id="homeBannerList" class="mt-4 space-y-2"></div></div>`;
  }

  function imageField(label, suffix) {
    const c = inputClass();
    return `<label class="text-[11px] text-purple-300">${label}<div class="mt-1 flex gap-2"><input id="homeBanner${suffix}Url" class="${c.replace('mt-1 ', '')}" placeholder="https://..."><label class="shrink-0 cursor-pointer rounded-xl border border-purple-800/60 bg-purple-950/60 px-3 py-2 text-purple-200" title="Enviar imagem"><i data-lucide="upload" class="h-4 w-4"></i><input data-banner-upload="${suffix}" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="hidden"></label></div></label>`;
  }

  function wireAdmin() {
    $('homeBannerKind')?.addEventListener('change', async () => { updateKindUi(); await refreshSourceOptions(); previewForm(); });
    $('homeBannerSource')?.addEventListener('change', applySelectedSource);
    $('homeBannerSourceRefresh')?.addEventListener('click', refreshSourceOptions);
    $('homeBannerNew')?.addEventListener('click', clearForm);
    $('homeBannerCancel')?.addEventListener('click', clearForm);
    $('homeBannerReload')?.addEventListener('click', () => refreshAdmin(true));
    $('homeBannerForm')?.addEventListener('submit', saveForm);
    $('homeBannerForm')?.addEventListener('input', previewForm);
    document.querySelectorAll('[data-banner-upload]').forEach(input => input.addEventListener('change', uploadFromInput));
    updateKindUi();
    clearForm();
  }

  function updateKindUi() {
    const sport = $('homeBannerKind')?.value === 'sport';
    $('homeBannerSportFields')?.classList.toggle('hidden', !sport);
  }

  async function sourceRecords(kind) {
    if (kind === 'sport') {
      const games = window.LuxSports?.state?.games || [];
      return games.map(game => ({
        key: game.id,
        label: `${game.home} × ${game.away}${game.time ? ' · ' + game.time : ''}`,
        raw: game
      }));
    }
    if (kind === 'game') {
      try { if (typeof loadGamesCatalog === 'function') await loadGamesCatalog(); } catch (_) {}
      let list = [];
      try { list = Array.isArray(gamesCatalog) ? gamesCatalog : []; } catch (_) {}
      return list.filter(game => game.status === 'approved').map(game => ({ key: String(game.id), label: `${game.title || 'Jogo'} · ${game.console || ''}`, raw: game }));
    }
    if (kind === 'book') {
      let list = [];
      try { list = await window.LuxReaderCloud?.catalog?.(true) || []; } catch (_) {}
      return list.filter(book => book.status === 'approved' || !book.status).map(book => ({ key: String(book.content_hash || book.id || book.title), label: `${book.title || 'Livro'}${book.authors ? ' · ' + book.authors : ''}`, raw: book }));
    }
    if (kind === 'movie' || kind === 'series') {
      const target = kind === 'movie' ? 'movies' : 'series';
      return localMedia().filter(item => item.type === target).slice(0, 2500).map(item => ({ key: String(item.id || item.url || item.name), label: item.name, raw: item }));
    }
    return [];
  }

  async function refreshSourceOptions() {
    const select = $('homeBannerSource');
    if (!select) return;
    const kind = $('homeBannerKind')?.value || 'custom';
    select.innerHTML = '<option value="">Carregando...</option>';
    sourceOptions = new Map();
    const records = await sourceRecords(kind);
    select.innerHTML = '<option value="">Preencher manualmente</option>';
    for (const record of records) {
      sourceOptions.set(record.key, record.raw);
      const option = new Option(record.label, record.key);
      select.add(option);
    }
    if (!records.length) select.options[0].textContent = kind === 'sport' ? 'Nenhum jogo carregado no Guia de Jogos' : 'Nenhum item disponível — preencher manualmente';
  }

  function toLocalInput(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function guideKickoff(game) {
    if (game.kickoff) return game.kickoff;
    if (game.date && game.time) return `${game.date}T${game.time}:00-03:00`;
    return '';
  }

  function applySelectedSource() {
    const key = $('homeBannerSource')?.value;
    const raw = sourceOptions.get(key);
    if (!raw) return;
    const kind = $('homeBannerKind').value;
    const set = (id, value) => { if ($(id)) $(id).value = value ?? ''; };

    if (kind === 'sport') {
      const title = `${raw.home || 'Time A'} × ${raw.away || 'Time B'}`;
      set('homeBannerTitle', title);
      set('homeBannerCompetition', raw.competition || 'Futebol');
      set('homeBannerLeftUrl', raw.home_logo || '');
      set('homeBannerRightUrl', raw.away_logo || '');
      set('homeBannerEventAt', toLocalInput(guideKickoff(raw)));
      set('homeBannerChannels', (raw.channels || []).map(channel => channel.label || 'Assistir').join('\n'));
      set('homeBannerCtaType', 'live');
      set('homeBannerCtaLabel', 'Assistir ao vivo');
      set('homeBannerCtaValue', raw.channels?.[0]?.item?.url || '');
      set('homeBannerBadge', 'JOGO EM DESTAQUE');
      $('homeBannerForm').dataset.sourcePayload = JSON.stringify({ home: raw.home || '', away: raw.away || '', channelUrls: (raw.channels || []).map(channel => channel.item?.url).filter(Boolean) });
      $('homeBannerForm').dataset.sourceKey = raw.id || key;
    } else if (kind === 'game') {
      set('homeBannerTitle', raw.title || '');
      set('homeBannerSubtitle', [raw.console, raw.release_year].filter(Boolean).join(' · '));
      set('homeBannerDescription', raw.synopsis || raw.sinopse || '');
      set('homeBannerPosterUrl', raw.cover_url || '');
      set('homeBannerBadge', 'GAME EM DESTAQUE');
      set('homeBannerCtaType', 'game'); set('homeBannerCtaLabel', 'Ver jogo'); set('homeBannerCtaValue', raw.id || '');
      $('homeBannerForm').dataset.sourcePayload = JSON.stringify({ gameId: raw.id }); $('homeBannerForm').dataset.sourceKey = String(raw.id || key);
    } else if (kind === 'book') {
      set('homeBannerTitle', raw.title || ''); set('homeBannerSubtitle', raw.authors || ''); set('homeBannerDescription', raw.description || '');
      set('homeBannerPosterUrl', raw.cover_url || ''); set('homeBannerBadge', 'LEITURA EM DESTAQUE'); set('homeBannerCtaType', 'book'); set('homeBannerCtaLabel', 'Abrir leitura'); set('homeBannerCtaValue', raw.content_hash || raw.id || '');
      $('homeBannerForm').dataset.sourcePayload = JSON.stringify({ bookId: raw.content_hash || raw.id || '' }); $('homeBannerForm').dataset.sourceKey = String(raw.content_hash || raw.id || key);
    } else if (kind === 'movie' || kind === 'series') {
      set('homeBannerTitle', raw.name || ''); set('homeBannerPosterUrl', raw.logo || ''); set('homeBannerBadge', 'DESTAQUE LUX'); set('homeBannerCtaType', 'media'); set('homeBannerCtaLabel', kind === 'series' ? 'Ver série' : 'Assistir agora'); set('homeBannerCtaValue', raw.id || raw.url || raw.name || '');
      $('homeBannerForm').dataset.sourcePayload = JSON.stringify({ mediaType: raw.type || '', mediaUrl: raw.url || '' }); $('homeBannerForm').dataset.sourceKey = String(raw.id || raw.url || key);
    }
    previewForm();
  }

  function field(id) { return $(id)?.value?.trim?.() || ''; }
  function formBanner() {
    const channels = field('homeBannerChannels').split(/\n+/).map(value => value.trim()).filter(Boolean).map(label => ({ label, value: '' }));
    let sourcePayload = {};
    try { sourcePayload = JSON.parse($('homeBannerForm').dataset.sourcePayload || '{}'); } catch (_) {}
    return {
      id: field('homeBannerId') || undefined,
      kind: field('homeBannerKind') || 'custom', title: field('homeBannerTitle'), subtitle: field('homeBannerSubtitle'), description: field('homeBannerDescription'), badge: field('homeBannerBadge'),
      poster_url: field('homeBannerPosterUrl'), backdrop_url: field('homeBannerBackdropUrl'), competition_logo_url: field('homeBannerCompetitionLogoUrl'), left_image_url: field('homeBannerLeftUrl'), right_image_url: field('homeBannerRightUrl'),
      competition_name: field('homeBannerCompetition'), classic_name: field('homeBannerClassic'), phase: field('homeBannerPhase'), channels,
      event_at: field('homeBannerEventAt') ? new Date(field('homeBannerEventAt')).toISOString() : null,
      cta_type: field('homeBannerCtaType') || 'none', cta_label: field('homeBannerCtaLabel'), cta_value: field('homeBannerCtaValue'),
      source_key: $('homeBannerForm').dataset.sourceKey || '', source_payload: sourcePayload,
      starts_at: field('homeBannerStartsAt') ? new Date(field('homeBannerStartsAt')).toISOString() : null,
      ends_at: field('homeBannerEndsAt') ? new Date(field('homeBannerEndsAt')).toISOString() : null,
      priority: Number(field('homeBannerPriority')) || 0, enabled: Boolean($('homeBannerEnabled')?.checked)
    };
  }

  function previewForm() {
    const box = $('homeBannerPreview'); if (!box) return;
    const banner = formBanner(); const sport = banner.kind === 'sport';
    const visual = sport
      ? `<div class="flex items-center justify-center gap-3">${banner.left_image_url ? `<img src="${esc(banner.left_image_url)}" class="h-14 w-14 object-contain">` : '<div class="h-14 w-14 rounded-xl bg-purple-950"></div>'}<strong class="text-emerald-300">×</strong>${banner.right_image_url ? `<img src="${esc(banner.right_image_url)}" class="h-14 w-14 object-contain">` : '<div class="h-14 w-14 rounded-xl bg-purple-950"></div>'}</div>`
      : banner.poster_url ? `<img src="${esc(banner.poster_url)}" class="h-24 w-16 rounded-lg object-cover">` : '<div class="h-24 w-16 rounded-lg bg-purple-950"></div>';
    box.innerHTML = `<div class="flex items-center gap-4"><div class="shrink-0">${visual}</div><div class="min-w-0"><span class="text-[9px] rounded bg-purple-600 px-2 py-1 font-bold text-white">${esc(banner.badge || (sport ? 'JOGO EM DESTAQUE' : 'DESTAQUE LUX'))}</span><h4 class="mt-2 text-base font-black text-white">${esc(banner.classic_name || banner.title || 'Prévia do destaque')}</h4><p class="mt-1 text-xs text-purple-300 line-clamp-2">${esc(sport ? sportDescription(banner) : (banner.description || banner.subtitle || 'Sua descrição aparece aqui.'))}</p></div></div>`;
  }

  async function saveForm(event) {
    event.preventDefault();
    const button = $('homeBannerSave'), status = $('homeBannerStatus');
    const banner = formBanner();
    if (!banner.title && banner.kind !== 'sport') return status.textContent = 'Informe um título.';
    button.disabled = true; status.textContent = 'Salvando...';
    try {
      await invoke('save', { banner }, true);
      publicCache.at = 0;
      status.textContent = 'Destaque salvo.';
      clearForm();
      await refreshAdmin(true);
      if (typeof currentSection !== 'undefined' && currentSection === 'home') renderHeroCarousel();
    } catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  }

  async function uploadFromInput(event) {
    const input = event.currentTarget, file = input.files?.[0]; input.value = '';
    if (!file) return;
    const suffix = input.dataset.bannerUpload, target = $(`homeBanner${suffix}Url`), status = $('homeBannerStatus');
    if (!target) return;
    status.textContent = 'Enviando imagem...';
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
        reader.readAsDataURL(file);
      });
      const data = await invoke('upload_image', { base64, content_type: file.type }, true);
      target.value = data.url || '';
      status.textContent = 'Imagem enviada.';
      previewForm();
    } catch (error) { status.textContent = error.message; }
  }

  function clearForm() {
    const form = $('homeBannerForm'); if (!form) return;
    form.reset();
    $('homeBannerId').value = '';
    $('homeBannerKind').value = 'sport';
    $('homeBannerPriority').value = '0';
    $('homeBannerEnabled').checked = true;
    form.dataset.sourcePayload = '{}'; form.dataset.sourceKey = '';
    updateKindUi(); refreshSourceOptions(); previewForm();
    const status = $('homeBannerStatus'); if (status) status.textContent = '';
  }

  function fillForm(banner) {
    const set = (id, value) => { if ($(id)) $(id).value = value ?? ''; };
    set('homeBannerId', banner.id); set('homeBannerKind', banner.kind); set('homeBannerTitle', banner.title); set('homeBannerSubtitle', banner.subtitle); set('homeBannerDescription', banner.description); set('homeBannerBadge', banner.badge);
    set('homeBannerPosterUrl', banner.poster_url); set('homeBannerBackdropUrl', banner.backdrop_url); set('homeBannerCompetitionLogoUrl', banner.competition_logo_url); set('homeBannerLeftUrl', banner.left_image_url); set('homeBannerRightUrl', banner.right_image_url);
    set('homeBannerCompetition', banner.competition_name); set('homeBannerClassic', banner.classic_name); set('homeBannerPhase', banner.phase); set('homeBannerEventAt', toLocalInput(banner.event_at));
    set('homeBannerChannels', (banner.channels || []).map(channel => channel?.label || channel).filter(Boolean).join('\n'));
    set('homeBannerCtaType', banner.cta_type); set('homeBannerCtaLabel', banner.cta_label); set('homeBannerCtaValue', banner.cta_value); set('homeBannerStartsAt', toLocalInput(banner.starts_at)); set('homeBannerEndsAt', toLocalInput(banner.ends_at)); set('homeBannerPriority', banner.priority || 0);
    $('homeBannerEnabled').checked = banner.enabled !== false;
    $('homeBannerForm').dataset.sourcePayload = JSON.stringify(banner.source_payload || {}); $('homeBannerForm').dataset.sourceKey = banner.source_key || '';
    updateKindUi(); refreshSourceOptions(); previewForm(); $('homeBannerForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function deleteBanner(id) {
    if (!confirm('Remover este destaque da Home?')) return;
    try { await invoke('delete', { id }, true); publicCache.at = 0; await refreshAdmin(true); if (typeof currentSection !== 'undefined' && currentSection === 'home') renderHeroCarousel(); }
    catch (error) { alert(error.message); }
  }

  function renderAdminList() {
    const box = $('homeBannerList'); if (!box) return;
    if (!adminBanners.length) { box.innerHTML = '<p class="text-xs text-purple-400">Nenhum destaque manual cadastrado.</p>'; return; }
    const now = Date.now();
    box.innerHTML = adminBanners.map(banner => {
      const end = banner.ends_at ? Date.parse(banner.ends_at) : NaN;
      const start = banner.starts_at ? Date.parse(banner.starts_at) : NaN;
      const state = !banner.enabled ? 'Desativado' : Number.isFinite(end) && end <= now ? 'Expirado' : Number.isFinite(start) && start > now ? 'Agendado' : 'Ativo';
      const image = banner.kind === 'sport' ? (banner.competition_logo_url || banner.left_image_url || banner.right_image_url) : (banner.poster_url || banner.logo_url || banner.backdrop_url);
      return `<article class="flex items-center gap-3 rounded-2xl border border-purple-900/50 bg-[#180f29] p-3"><div class="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-purple-950">${image ? `<img src="${esc(image)}" class="h-full w-full object-contain" referrerpolicy="no-referrer">` : ''}</div><div class="min-w-0 flex-1"><div class="flex flex-wrap items-center gap-2"><strong class="truncate text-xs text-white">${esc(banner.classic_name || banner.title || 'Sem título')}</strong><span class="rounded-md bg-purple-950 px-2 py-0.5 text-[9px] font-bold text-purple-300">${esc(state)}</span><span class="text-[9px] uppercase text-purple-500">${esc(banner.kind)}</span></div><p class="mt-1 truncate text-[10px] text-purple-400">${banner.ends_at ? 'até ' + esc(new Date(banner.ends_at).toLocaleString('pt-BR')) : 'sem data final'} · prioridade ${Number(banner.priority) || 0}</p></div><button data-banner-edit="${esc(banner.id)}" class="rounded-lg border border-purple-800/60 p-2 text-purple-200" title="Editar"><i data-lucide="pencil" class="h-4 w-4"></i></button><button data-banner-delete="${esc(banner.id)}" class="rounded-lg border border-rose-900/60 p-2 text-rose-300" title="Remover"><i data-lucide="trash-2" class="h-4 w-4"></i></button></article>`;
    }).join('');
    box.querySelectorAll('[data-banner-edit]').forEach(button => button.onclick = () => { const banner = adminBanners.find(item => item.id === button.dataset.bannerEdit); if (banner) fillForm(banner); });
    box.querySelectorAll('[data-banner-delete]').forEach(button => button.onclick = () => deleteBanner(button.dataset.bannerDelete));
    try { lucide.createIcons(); } catch (_) {}
  }

  async function refreshAdmin(force = false) {
    if (!$('adminTabHighlights')) return;
    const account = currentAccount();
    if (!account || account.role !== 'admin') return;
    try {
      const data = await invoke('list_admin', {}, true);
      adminBanners = Array.isArray(data.banners) ? data.banners : [];
      renderAdminList();
      if (force) await refreshSourceOptions();
    } catch (error) {
      const box = $('homeBannerList'); if (box) box.innerHTML = `<p class="text-xs text-rose-300">${esc(error.message)}</p>`;
    }
  }

  function installHeroOverride() {
    try {
      if (typeof loadTmdbHeroBanner !== 'function' || loadTmdbHeroBanner.__luxFeaturedWrapped) return false;
      const wrapped = function () { return renderHeroCarousel(); };
      wrapped.__luxFeaturedWrapped = true;
      loadTmdbHeroBanner = wrapped;
      window.LuxHomeBanners = { reload: () => { publicCache.at = 0; return renderHeroCarousel(); }, listPublic, refreshAdmin };
      return true;
    } catch (_) { return false; }
  }

  function install() {
    installAdminTab();
    if (!installHeroOverride()) {
      let attempts = 0;
      const timer = setInterval(() => { attempts += 1; if (installHeroOverride() || attempts > 100) clearInterval(timer); }, 50);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
