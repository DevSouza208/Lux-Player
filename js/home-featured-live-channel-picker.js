(() => {
  'use strict';

  const VERSION = '20260915-featured-live-picker1';
  if (window.__luxFeaturedLivePickerVersion === VERSION) return;
  window.__luxFeaturedLivePickerVersion = VERSION;

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function mediaItems() {
    try { return Array.isArray(allMediaItems) ? allMediaItems : []; } catch (_) { return []; }
  }

  function liveChannels() {
    return mediaItems().filter(item => item?.type === 'live' && item?.url);
  }

  function normalize(value = '') {
    return String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function guideUrls() {
    const form = $('homeBannerForm');
    if (!form) return [];
    try {
      const payload = JSON.parse(form.dataset.sourcePayload || '{}');
      return Array.isArray(payload.channelUrls) ? payload.channelUrls.filter(Boolean).map(String) : [];
    } catch (_) { return []; }
  }

  function channelKey(item) {
    return String(item?.url || item?.id || item?.name || '');
  }

  function ensureUi() {
    const form = $('homeBannerForm');
    const ctaValue = $('homeBannerCtaValue');
    if (!form || !ctaValue || $('homeBannerLivePicker')) return false;

    const host = ctaValue.closest('.grid') || ctaValue.parentElement?.parentElement;
    if (!host) return false;

    const wrap = document.createElement('div');
    wrap.id = 'homeBannerLivePicker';
    wrap.className = 'hidden md:col-span-3 rounded-2xl border border-purple-900/50 bg-[#100a1c] p-4 space-y-3';
    wrap.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div><strong class="block text-xs text-white">Canal do botão Assistir</strong><span id="homeBannerLivePickerHint" class="text-[10px] text-purple-400">Escolha uma transmissão do Guia de Jogos ou pesquise em todos os canais.</span></div>
        <span id="homeBannerLivePickerBadge" class="rounded-lg bg-purple-950 px-2 py-1 text-[9px] font-bold text-purple-300">TV AO VIVO</span>
      </div>
      <div id="homeBannerGuideChannels" class="space-y-2"></div>
      <div class="relative">
        <input id="homeBannerLiveSearch" type="search" autocomplete="off" class="w-full bg-[#180f29] border border-purple-900/50 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500" placeholder="Pesquisar todos os canais: Globo, SporTV, ESPN...">
        <div id="homeBannerLiveResults" class="hidden absolute z-30 left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto rounded-xl border border-purple-900/70 bg-[#120c1f] p-1 shadow-2xl"></div>
      </div>
      <div id="homeBannerSelectedChannel" class="text-[10px] text-purple-400">Nenhum canal selecionado.</div>`;
    host.insertAdjacentElement('afterend', wrap);

    $('homeBannerLiveSearch')?.addEventListener('input', renderSearch);
    $('homeBannerLiveSearch')?.addEventListener('focus', renderSearch);
    document.addEventListener('click', event => {
      if (!wrap.contains(event.target)) $('homeBannerLiveResults')?.classList.add('hidden');
    });
    return true;
  }

  function setChannel(item, origin = 'manual') {
    if (!item?.url) return;
    const value = $('homeBannerCtaValue');
    const type = $('homeBannerCtaType');
    const label = $('homeBannerCtaLabel');
    const form = $('homeBannerForm');
    if (value) value.value = item.url;
    if (type) type.value = 'live';
    if (label && !label.value.trim()) label.value = 'Assistir ao vivo';

    if (form) {
      let payload = {};
      try { payload = JSON.parse(form.dataset.sourcePayload || '{}'); } catch (_) {}
      payload.selectedChannelUrl = item.url;
      payload.selectedChannelName = item.name || '';
      payload.selectedChannelOrigin = origin;
      form.dataset.sourcePayload = JSON.stringify(payload);
    }

    const selected = $('homeBannerSelectedChannel');
    if (selected) selected.innerHTML = `<span class="text-emerald-300 font-bold">Selecionado:</span> ${esc(item.name || 'Canal')} <span class="text-purple-500">· ${origin === 'guide' ? 'Guia de Jogos' : 'catálogo de TV'}</span>`;
    $('homeBannerLiveResults')?.classList.add('hidden');
    if ($('homeBannerLiveSearch')) $('homeBannerLiveSearch').value = '';
    $('homeBannerForm')?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function matchByUrl(url) {
    return liveChannels().find(item => String(item.url) === String(url));
  }

  function renderGuide() {
    if (!ensureUi()) return;
    const wrap = $('homeBannerLivePicker');
    const sport = $('homeBannerKind')?.value === 'sport';
    wrap?.classList.toggle('hidden', !sport);
    if (!sport) return;

    const urls = guideUrls();
    const box = $('homeBannerGuideChannels');
    if (!box) return;
    if (!urls.length) {
      box.innerHTML = '<div class="rounded-xl border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[10px] text-amber-300">O Guia de Jogos não informou um canal para esta partida. Use a busca abaixo para escolher qualquer canal da TV.</div>';
      return;
    }

    box.innerHTML = '<div class="text-[10px] font-bold uppercase tracking-wider text-purple-400">Encontrados no Guia de Jogos</div>';
    const row = document.createElement('div');
    row.className = 'flex flex-wrap gap-2';
    urls.forEach((url, index) => {
      const item = matchByUrl(url);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rounded-xl border border-emerald-900/50 bg-emerald-950/20 px-3 py-2 text-[10px] font-bold text-emerald-300 hover:bg-emerald-950/50';
      button.textContent = item?.name || `Transmissão ${index + 1}`;
      button.onclick = () => setChannel(item || { url, name: `Transmissão ${index + 1}` }, 'guide');
      row.appendChild(button);
    });
    box.appendChild(row);
  }

  function renderSearch() {
    const input = $('homeBannerLiveSearch');
    const results = $('homeBannerLiveResults');
    if (!input || !results) return;
    const query = normalize(input.value);
    let channels = liveChannels();
    if (query) channels = channels.filter(item => normalize(item.name).includes(query));
    channels = channels.slice(0, 80);

    if (!channels.length) {
      results.innerHTML = '<div class="px-3 py-2 text-[10px] text-purple-400">Nenhum canal encontrado.</div>';
      results.classList.remove('hidden');
      return;
    }

    results.innerHTML = '';
    channels.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'block w-full rounded-lg px-3 py-2 text-left text-xs text-purple-100 hover:bg-purple-950';
      button.innerHTML = `<strong>${esc(item.name || 'Canal')}</strong>${item.group ? `<span class="ml-2 text-[9px] text-purple-500">${esc(item.group)}</span>` : ''}`;
      button.onclick = () => setChannel(item, 'manual');
      results.appendChild(button);
    });
    results.classList.remove('hidden');
  }

  function syncSelected() {
    const url = $('homeBannerCtaValue')?.value || '';
    if (!url) return;
    const item = matchByUrl(url);
    if (!item) return;
    const selected = $('homeBannerSelectedChannel');
    if (selected) selected.innerHTML = `<span class="text-emerald-300 font-bold">Selecionado:</span> ${esc(item.name || 'Canal')}`;
  }

  function wireExisting() {
    if (!ensureUi()) return;
    const kind = $('homeBannerKind');
    const source = $('homeBannerSource');
    if (kind && !kind.dataset.livePickerWired) {
      kind.dataset.livePickerWired = '1';
      kind.addEventListener('change', () => setTimeout(() => { renderGuide(); syncSelected(); }, 0));
    }
    if (source && !source.dataset.livePickerWired) {
      source.dataset.livePickerWired = '1';
      source.addEventListener('change', () => setTimeout(() => { renderGuide(); syncSelected(); }, 0));
    }
    renderGuide();
    syncSelected();
  }

  const observer = new MutationObserver(() => wireExisting());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  wireExisting();

  window.LuxFeaturedLivePicker = { version: VERSION, refresh: wireExisting, channels: liveChannels, select: setChannel };
})();
