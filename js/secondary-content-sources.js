(() => {
  'use strict';

  const VERSION = '20260914-secondary-sources-2';
  if (window.__luxSecondaryContentSourcesInstalled === VERSION) return;
  window.__luxSecondaryContentSourcesInstalled = VERSION;
  window.__luxCanonicalCatalogBackendEnabled = true;

  const FUNCTION_NAME = 'content-sources';
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
    const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, { body: authBody({ action, ...extra }) });
    if (error) throw new Error(data?.error || error.message || 'Não foi possível acessar as fontes.');
    if (data?.error) throw new Error(data.error);
    return data || {};
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
      .replace(/^[+\-–—\s]+/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function contentTitle(item) {
    return String(item?.seriesName || item?.name || item?.title || '').trim();
  }

  function contentType(item) {
    const type = String(item?.type || '').toLowerCase();
    if (type === 'movie') return 'movies';
    if (type === 'tv') return 'live';
    return ['movies', 'series', 'live'].includes(type) ? type : type;
  }

  function tokenSimilarity(a, b) {
    const left = new Set(normalizeText(a).split(' ').filter(Boolean));
    const right = new Set(normalizeText(b).split(' ').filter(Boolean));
    if (!left.size || !right.size) return 0;
    let common = 0;
    left.forEach(token => { if (right.has(token)) common += 1; });
    return common / new Set([...left, ...right]).size;
  }

  function scoreCandidate(incoming, candidate) {
    if (contentType(incoming) !== contentType(candidate)) return 0;
    const a = normalizeText(contentTitle(incoming));
    const b = normalizeText(contentTitle(candidate));
    if (!a || !b) return 0;
    if (a === b) return 100;
    const similarity = tokenSimilarity(a, b);
    if (similarity >= 0.92) return 92;
    if (similarity >= 0.82) return 86;
    if (similarity >= 0.70) return 78;
    if (similarity >= 0.62) return 72;
    return 0;
  }

  async function mergeIntoCurrentCatalog(options = {}) {
    if (window.LuxCanonicalCatalog?.reload) {
      return window.LuxCanonicalCatalog.reload({ refreshUi: options.refreshUi !== false });
    }
    return { added: 0, merged: 0, pending: 0, sources: 0, skipped: true, canonical: true };
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
            <p class="mt-1 max-w-3xl text-xs text-purple-300">As M3Us ficam cadastradas aqui, mas o processamento pesado agora acontece no catálogo canônico do Supabase. Isso evita travar o navegador com listas grandes.</p>
          </div>
          <button id="secondaryApplyNow" type="button" class="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white hover:bg-emerald-500">Sincronizar conteúdos</button>
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
            <span class="mt-1 block text-[10px] text-purple-400/80">A URL é buscada pelo backend e transformada em registros normalizados no Supabase.</span>
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
        <div class="flex items-center justify-between gap-3"><div><h4 class="text-xs font-bold uppercase text-amber-300">Possíveis duplicados</h4><p class="mt-1 text-[11px] text-purple-300">Decisões antigas continuam disponíveis; novas normalizações passam pelo catálogo canônico.</p></div><button id="secondaryReviewRefresh" type="button" class="text-xs text-amber-300 hover:text-white">Atualizar</button></div>
        <div id="secondaryReviewsList" class="mt-3 space-y-2"><p class="py-4 text-center text-xs text-purple-400/60">Nenhuma revisão carregada.</p></div>
      </section>`;
    firstPanel.parentElement.appendChild(panel);

    panel.querySelector('#secondarySourceForm')?.addEventListener('submit', saveAdminSource);
    panel.querySelector('#secondarySourceCancel')?.addEventListener('click', resetSourceForm);
    panel.querySelector('#secondarySourceRefresh')?.addEventListener('click', refreshAdminSources);
    panel.querySelector('#secondaryReviewRefresh')?.addEventListener('click', refreshAdminReviews);
    panel.querySelector('#secondaryApplyNow')?.addEventListener('click', () => {
      if (window.LuxCanonicalCatalog?.openSync) window.LuxCanonicalCatalog.openSync();
      else document.getElementById('secondarySourceStatus').textContent = 'Carregando o sincronizador do catálogo canônico...';
    });
    panel.querySelector('#secondarySourcesList')?.addEventListener('click', handleSourceListClick);
    panel.querySelector('#secondaryReviewsList')?.addEventListener('click', handleReviewListClick);
    try { window.lucide?.createIcons?.(); } catch (_) {}
    return true;
  }

  function resetSourceForm() {
    const form = document.getElementById('secondarySourceForm');
    form?.reset();
    const id = document.getElementById('secondarySourceId');
    if (id) id.value = '';
    const priority = document.getElementById('secondarySourcePriority');
    if (priority) priority.value = '10';
    const enabled = document.getElementById('secondarySourceEnabled');
    if (enabled) enabled.checked = true;
    const fill = document.getElementById('secondarySourceFillOnly');
    if (fill) fill.checked = true;
    const review = document.getElementById('secondarySourceReview');
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
      if (status) status.textContent = 'Fonte salva. Use “Sincronizar conteúdos” para atualizar o catálogo canônico.';
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
      } catch (error) {
        alert(error?.message || 'A fonte não passou na validação.');
      } finally {
        button.textContent = old;
        button.disabled = false;
        await refreshAdminSources();
      }
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
  const timer = setInterval(() => {
    attempts += 1;
    if (installAdminBridge() || attempts >= 200) clearInterval(timer);
  }, 50);
})();
