(() => {
  'use strict';

  if (window.__luxVodUrlCatalogInstalled) return;
  window.__luxVodUrlCatalogInstalled = '20260927-1';

  const SOURCE = 'manual-url';
  let catalog = [];
  let refreshPromise = null;
  let saving = false;

  const getUser = () => {
    try { return currentUser || null; } catch (_) { return null; }
  };

  const getClient = () => {
    try { return supabaseClient || null; } catch (_) { return null; }
  };

  const isAdmin = () => String(getUser()?.role || '').trim().toLowerCase() === 'admin';

  function setStatus(message, tone = 'normal') {
    const node = document.getElementById('luxVodUrlStatus');
    if (!node) return;
    node.textContent = message || '';
    node.className = 'min-h-[18px] text-[11px] ' + (
      tone === 'success' ? 'text-emerald-300' :
      tone === 'error' ? 'text-rose-300' :
      'text-purple-300'
    );
  }

  function validHttpUrl(value, optional = false) {
    const text = String(value || '').trim();
    if (!text) return optional;
    try {
      const parsed = new URL(text);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  async function request(action, payload = {}) {
    const user = getUser();
    const client = getClient();
    if (!user || !client) throw new Error('Entre na sua conta para acessar o catálogo.');

    const { data, error } = await client.functions.invoke('vod-catalog', {
      body: {
        ...payload,
        action,
        username: user.user,
        password: user.pass
      }
    });

    if (error) throw new Error(error.message || 'Falha ao acessar o catálogo.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function toMediaItem(vod) {
    const title = String(vod?.title || '').trim();
    const category = String(vod?.category || '').trim() || 'Filmes adicionados';
    let adult = false;
    try { adult = typeof isAdultContent === 'function' && isAdultContent(category, title); } catch (_) {}

    return {
      id: 'manual_url_' + (vod?.id || vod?.url || title),
      name: title,
      group: category,
      logo: String(vod?.poster || '').trim(),
      url: String(vod?.url || '').trim(),
      type: 'movies',
      source: SOURCE,
      isAdult: adult
    };
  }

  function applyCatalogToPlayer() {
    try {
      const manualItems = catalog
        .filter(vod => vod?.url && vod?.title)
        .map(toMediaItem);

      const base = Array.isArray(allMediaItems)
        ? allMediaItems.filter(item => item?.source !== SOURCE)
        : [];

      let merged = [...base, ...manualItems];
      try {
        if (typeof profileAllowsMedia === 'function') merged = merged.filter(profileAllowsMedia);
      } catch (_) {}
      allMediaItems = merged;

      if (typeof filterMedia === 'function' && currentSection === 'movies') filterMedia();
    } catch (error) {
      console.warn('[Lux VOD URL] Não foi possível aplicar o catálogo ao player:', error);
    }
  }

  function renderList() {
    const root = document.getElementById('luxVodUrlList');
    if (!root) return;

    if (!catalog.length) {
      root.innerHTML = '<p class="rounded-xl border border-purple-900/40 bg-[#120c1f] px-3 py-3 text-[11px] text-purple-400">Nenhum filme por URL publicado ainda.</p>';
      return;
    }

    root.replaceChildren(...catalog.map(vod => {
      const row = document.createElement('div');
      row.className = 'flex items-start gap-3 rounded-xl border border-purple-900/40 bg-[#120c1f] p-3';

      const poster = document.createElement('div');
      poster.className = 'h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-purple-950/70 flex items-center justify-center text-purple-400';
      if (vod.poster) {
        const image = document.createElement('img');
        image.src = vod.poster;
        image.alt = '';
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.className = 'h-full w-full object-cover';
        poster.appendChild(image);
      } else {
        poster.textContent = '🎬';
      }

      const info = document.createElement('div');
      info.className = 'min-w-0 flex-1';
      const title = document.createElement('p');
      title.className = 'truncate text-xs font-bold text-white';
      title.textContent = vod.title || 'Sem título';
      const category = document.createElement('p');
      category.className = 'mt-1 text-[10px] text-purple-300';
      category.textContent = vod.category || 'Filmes adicionados';
      const url = document.createElement('p');
      url.className = 'mt-1 truncate font-mono text-[9px] text-purple-500';
      url.textContent = vod.url || '';
      info.append(title, category, url);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'shrink-0 rounded-lg bg-rose-900/30 px-2 py-1.5 text-[10px] font-bold text-rose-300 hover:text-white disabled:opacity-50';
      remove.textContent = 'Remover';
      remove.addEventListener('click', () => removeMovie(vod, remove));

      row.append(poster, info, remove);
      return row;
    }));
  }

  async function fetchCatalog() {
    if (!getUser()) return [];
    const vods = [];
    let offset = 0;
    let page = [];

    do {
      const data = await request('list', { offset });
      page = Array.isArray(data?.vods) ? data.vods : [];
      vods.push(...page);
      offset += page.length;
    } while (page.length === 500);

    catalog = [...new Map(vods.map(vod => [vod.url, vod])).values()];
    applyCatalogToPlayer();
    renderList();
    return catalog;
  }

  async function refreshCatalog(showFeedback = false) {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      try {
        if (showFeedback) setStatus('Atualizando catálogo...');
        const result = await fetchCatalog();
        if (showFeedback) setStatus(`${result.length} filme(s) por URL carregado(s).`, 'success');
        return result;
      } catch (error) {
        console.warn('[Lux VOD URL] Falha ao carregar catálogo:', error);
        if (showFeedback) setStatus(error.message || 'Não foi possível atualizar o catálogo.', 'error');
        return catalog;
      } finally {
        refreshPromise = null;
      }
    })();
    return refreshPromise;
  }

  async function addMovie(event) {
    event?.preventDefault?.();
    if (saving) return;
    if (!isAdmin()) {
      setStatus('Apenas administradores podem publicar filmes.', 'error');
      return;
    }

    const title = document.getElementById('luxVodUrlTitle')?.value.trim() || '';
    const category = document.getElementById('luxVodUrlCategory')?.value.trim() || 'Filmes adicionados';
    const url = document.getElementById('luxVodUrlStream')?.value.trim() || '';
    const poster = document.getElementById('luxVodUrlPoster')?.value.trim() || '';

    if (!title) {
      setStatus('Preencha o título do filme.', 'error');
      return;
    }
    if (!validHttpUrl(url)) {
      setStatus('Informe uma URL HTTP ou HTTPS válida para o vídeo.', 'error');
      return;
    }
    if (poster && !validHttpUrl(poster, true)) {
      setStatus('A URL da capa não é válida.', 'error');
      return;
    }

    saving = true;
    const submit = document.getElementById('luxVodUrlSubmit');
    if (submit) submit.disabled = true;
    setStatus('Publicando filme...');

    try {
      await request('publish', { vods: [{ title, category, url, poster }] });
      ['luxVodUrlTitle', 'luxVodUrlStream', 'luxVodUrlPoster'].forEach(id => {
        const input = document.getElementById(id);
        if (input) input.value = '';
      });
      await fetchCatalog();
      setStatus(`“${title}” foi publicado para todos os usuários.`, 'success');
    } catch (error) {
      setStatus(error.message || 'Não foi possível publicar o filme.', 'error');
    } finally {
      saving = false;
      if (submit) submit.disabled = false;
    }
  }

  async function removeMovie(vod, button) {
    if (!isAdmin() || !vod?.id) return;
    if (!confirm(`Remover “${vod.title || 'este filme'}” do catálogo compartilhado?`)) return;

    if (button) button.disabled = true;
    setStatus('Removendo filme...');
    try {
      await request('remove', { id: vod.id });
      await fetchCatalog();
      setStatus('Filme removido do catálogo compartilhado.', 'success');
    } catch (error) {
      setStatus(error.message || 'Não foi possível remover o filme.', 'error');
      if (button) button.disabled = false;
    }
  }

  function installAdminUi() {
    const panel = document.getElementById('adminTabVods');
    if (!panel || document.getElementById('luxVodUrlCard')) return;

    const tab = document.querySelector('[data-admin-tab="vods"]');
    if (tab) tab.textContent = 'Filmes / IPTV';

    const card = document.createElement('div');
    card.id = 'luxVodUrlCard';
    card.className = 'mb-4 rounded-2xl border border-purple-900/40 bg-[#180f29] p-4';
    card.innerHTML = `
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 class="text-xs font-bold uppercase text-purple-300">Adicionar filme por URL</h4>
          <p class="mt-1 max-w-2xl text-[11px] leading-relaxed text-purple-400">Cole o link direto do vídeo. HTTPS é o ideal no navegador/PWA; HTTP pode ser bloqueado fora do Electron. Links de páginas comuns não funcionam como stream — use o arquivo/stream direto, como MP4 ou HLS (.m3u8).</p>
        </div>
        <button id="luxVodUrlRefresh" type="button" class="rounded-xl border border-purple-800/60 bg-purple-950/60 px-3 py-2 text-[10px] font-bold text-purple-200 hover:bg-purple-900/70">Atualizar catálogo</button>
      </div>
      <form id="luxVodUrlForm" class="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label class="text-[11px] font-medium text-purple-300" for="luxVodUrlTitle">Título</label>
          <input id="luxVodUrlTitle" type="text" maxlength="300" required placeholder="Nome do filme" class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none">
        </div>
        <div>
          <label class="text-[11px] font-medium text-purple-300" for="luxVodUrlCategory">Categoria</label>
          <input id="luxVodUrlCategory" type="text" maxlength="200" value="Filmes adicionados" placeholder="Ação, Comédia..." class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none">
        </div>
        <div class="md:col-span-2">
          <label class="text-[11px] font-medium text-purple-300" for="luxVodUrlStream">URL direta do vídeo</label>
          <input id="luxVodUrlStream" type="url" required placeholder="https://.../filme.mp4 ou https://.../playlist.m3u8" class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none">
        </div>
        <div class="md:col-span-2">
          <label class="text-[11px] font-medium text-purple-300" for="luxVodUrlPoster">URL da capa <span class="text-purple-500">(opcional)</span></label>
          <input id="luxVodUrlPoster" type="url" placeholder="https://.../capa.jpg" class="mt-1 w-full rounded-xl border border-purple-900/50 bg-[#120c1f] px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none">
          <p class="mt-1 text-[10px] text-purple-500">Sem capa, o Lux ainda pode tentar completar os metadados via TMDB durante a exibição.</p>
        </div>
        <div class="md:col-span-2">
          <button id="luxVodUrlSubmit" type="submit" class="w-full rounded-xl bg-purple-600 py-2.5 text-xs font-bold text-white shadow-lg shadow-purple-900/30 transition-all hover:bg-purple-500 disabled:cursor-wait disabled:opacity-50">Publicar filme para todos</button>
        </div>
      </form>
      <p id="luxVodUrlStatus" role="status" class="mt-3 min-h-[18px] text-[11px] text-purple-300"></p>
      <div class="mt-4 border-t border-purple-900/40 pt-4">
        <div class="mb-2 flex items-center justify-between gap-2">
          <h5 class="text-[11px] font-bold uppercase tracking-wide text-purple-300">Filmes publicados por URL</h5>
          <span class="text-[9px] text-purple-500">catálogo compartilhado</span>
        </div>
        <div id="luxVodUrlList" class="space-y-2"></div>
      </div>
    `;

    panel.prepend(card);
    document.getElementById('luxVodUrlForm')?.addEventListener('submit', addMovie);
    document.getElementById('luxVodUrlRefresh')?.addEventListener('click', () => refreshCatalog(true));
    tab?.addEventListener('click', () => setTimeout(() => refreshCatalog(false), 0));
    renderList();
  }

  function wrapMediaLoader() {
    const original = window.loadMediaSourcesInPriority;
    if (typeof original !== 'function' || original.__luxVodUrlWrapped) return;

    const wrapped = async function(...args) {
      const result = await original.apply(this, args);
      try { await refreshCatalog(false); } catch (_) {}
      return result;
    };
    wrapped.__luxVodUrlWrapped = true;
    window.loadMediaSourcesInPriority = wrapped;
  }

  installAdminUi();
  wrapMediaLoader();

  if (getUser()) refreshCatalog(false);

  window.LuxVodUrlCatalog = {
    refresh: () => refreshCatalog(true),
    items: () => catalog.slice()
  };
})();
