(() => {
  'use strict';

  const VERSION = '20260914-secondary-locale-approval1';
  if (window.__luxSecondaryLocaleApprovalInstalled === VERSION) return;
  window.__luxSecondaryLocaleApprovalInstalled = VERSION;

  const FUNCTION_NAME = 'content-locale-reviews';
  const INTERNATIONAL_GROUP = '🌍 Internacional';
  const queuedThisSession = new Set();
  let processing = false;

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
    if (typeof supabaseClient === 'undefined' || !supabaseClient?.functions?.invoke) {
      throw new Error('Serviço de nuvem indisponível.');
    }
    const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
      body: authBody({ action, ...extra })
    });
    if (error) throw new Error(data?.error || error.message || 'Não foi possível acessar a revisão de idioma.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function normalize(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titleOf(item) {
    return String(item?.seriesName || item?.name || item?.title || '').trim();
  }

  function typeOf(item) {
    return String(item?.type || '').trim().toLowerCase();
  }

  function groupOf(item) {
    return String(item?.luxOriginalGroup || item?.group || item?.category || item?.category_name || '').trim();
  }

  function sourceIdOf(item) {
    return String(item?.luxSourceId || item?.luxSources?.find?.(entry => entry?.role === 'secondary')?.id || '').trim();
  }

  function sourceNameOf(item) {
    return String(item?.luxSourceName || item?.luxSources?.find?.(entry => entry?.role === 'secondary')?.name || '').trim();
  }

  function isSecondary(item) {
    return item?.luxSourceRole === 'secondary' || Boolean(sourceIdOf(item));
  }

  function classify(item) {
    try {
      const result = window.LuxSecondaryLocale?.classify?.(item);
      if (result) return result;
    } catch (_) {}
    return String(item?.luxLocaleBucket || 'unknown');
  }

  function fingerprint(item) {
    const sourceId = sourceIdOf(item);
    const title = normalize(titleOf(item));
    const type = typeOf(item);
    const group = normalize(groupOf(item));
    let episodeShape = '';
    if (item?.m3uEpisodes && typeof item.m3uEpisodes === 'object') {
      episodeShape = Object.entries(item.m3uEpisodes)
        .map(([season, list]) => `${season}:${Array.isArray(list) ? list.length : 0}`)
        .join(',');
    }
    return `${sourceId}|locale|${type}|${title}|${group}|${episodeShape}`.slice(0, 300);
  }

  function decisionMap(rows) {
    const map = new Map();
    (rows || []).forEach(row => map.set(`${row.source_id}|${row.fingerprint}`, row.status));
    return map;
  }

  function approvePt(item) {
    item.luxLocaleBucket = 'pt';
    item.luxLocaleApproved = true;
    item.luxInternational = false;
    if (item.luxOriginalGroup && item.group === INTERNATIONAL_GROUP) item.group = item.luxOriginalGroup;
  }

  function approveInternational(item) {
    if (!item.luxOriginalGroup) item.luxOriginalGroup = groupOf(item);
    item.luxLocaleBucket = 'international';
    item.luxLocaleApproved = true;
    item.luxInternational = true;
    item.group = INTERNATIONAL_GROUP;
  }

  async function queueUnknown(rows) {
    const fresh = rows.filter(row => {
      const key = `${row.source_id}|${row.fingerprint}`;
      if (queuedThisSession.has(key)) return false;
      queuedThisSession.add(key);
      return true;
    });
    for (let index = 0; index < fresh.length; index += 100) {
      await invoke('queue', { items: fresh.slice(index, index + 100) });
    }
  }

  async function processCatalog(options = {}) {
    if (processing) return { held: 0, approvedPt: 0, international: 0, ignored: 0 };
    const user = safeCurrentUser();
    if (!user?.user || !user?.pass) return { held: 0, skipped: true };

    let catalog;
    try { catalog = typeof allMediaItems !== 'undefined' ? allMediaItems : null; } catch (_) { catalog = null; }
    if (!Array.isArray(catalog) || !catalog.length) return { held: 0, skipped: true };

    processing = true;
    try {
      const response = await invoke('decisions');
      const decisions = decisionMap(response.decisions);
      const queue = [];
      const totals = { held: 0, approvedPt: 0, international: 0, ignored: 0 };

      for (let index = catalog.length - 1; index >= 0; index -= 1) {
        const item = catalog[index];
        if (!isSecondary(item)) continue;
        if (classify(item) !== 'unknown') continue;

        const sourceId = sourceIdOf(item);
        if (!sourceId) continue;
        const fp = fingerprint(item);
        const decision = decisions.get(`${sourceId}|${fp}`);

        if (decision === 'pt') {
          approvePt(item);
          totals.approvedPt += 1;
          continue;
        }
        if (decision === 'international') {
          approveInternational(item);
          totals.international += 1;
          continue;
        }
        if (decision === 'ignored') {
          catalog.splice(index, 1);
          totals.ignored += 1;
          continue;
        }

        queue.push({
          source_id: sourceId,
          fingerprint: fp,
          incoming_title: titleOf(item),
          incoming_type: typeOf(item),
          incoming_group: groupOf(item),
          source_name: sourceNameOf(item),
          metadata: {
            url_host: (() => { try { return new URL(String(item?.url || '')).host; } catch (_) { return ''; } })(),
            original_group: groupOf(item)
          }
        });
        catalog.splice(index, 1);
        totals.held += 1;
      }

      if (queue.length) await queueUnknown(queue);

      if (options.refreshUi && (totals.held || totals.ignored || totals.international || totals.approvedPt)) {
        try {
          if (typeof window.setSection === 'function' && typeof currentSection !== 'undefined') window.setSection(currentSection);
        } catch (_) {}
      }

      if (queue.length && safeCurrentUser()?.role === 'admin') refreshAdminReviews().catch(() => {});
      console.info('[LUX-IPTV-037] Conteúdo sem idioma definido enviado para aprovação:', totals);
      return totals;
    } finally {
      processing = false;
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function ensureAdminSection() {
    if (safeCurrentUser()?.role !== 'admin') return false;
    if (document.getElementById('secondaryLocaleReviewsSection')) return true;
    const panel = document.getElementById('adminTabSources');
    if (!panel) return false;

    const section = document.createElement('section');
    section.id = 'secondaryLocaleReviewsSection';
    section.className = 'rounded-2xl border border-sky-900/50 bg-[#120c1f] p-4';
    section.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div>
          <h4 class="text-xs font-bold uppercase text-sky-300">Idioma não identificado</h4>
          <p class="mt-1 text-[11px] text-purple-300">O Lux segura estes itens fora do catálogo até você decidir onde entram.</p>
        </div>
        <button id="secondaryLocaleRefresh" type="button" class="text-xs text-sky-300 hover:text-white">Atualizar</button>
      </div>
      <div id="secondaryLocaleReviewsList" class="mt-3 space-y-2">
        <p class="py-4 text-center text-xs text-purple-400/60">Carregando...</p>
      </div>`;
    panel.appendChild(section);
    section.querySelector('#secondaryLocaleRefresh')?.addEventListener('click', () => refreshAdminReviews());
    section.querySelector('#secondaryLocaleReviewsList')?.addEventListener('click', handleReviewClick);
    return true;
  }

  async function refreshAdminReviews() {
    if (safeCurrentUser()?.role !== 'admin') return;
    if (!ensureAdminSection()) return;
    const root = document.getElementById('secondaryLocaleReviewsList');
    if (!root) return;
    root.innerHTML = '<p class="py-4 text-center text-xs text-purple-400/60">Carregando aprovações...</p>';

    try {
      const data = await invoke('pending');
      const reviews = Array.isArray(data.reviews) ? data.reviews : [];
      if (!reviews.length) {
        root.innerHTML = '<p class="py-4 text-center text-xs text-emerald-300/80">Nenhum idioma pendente de aprovação.</p>';
        return;
      }

      root.innerHTML = reviews.map(review => `
        <article class="rounded-xl border border-sky-900/50 bg-sky-950/10 p-3">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-xs font-bold text-white">${escapeHtml(review.incoming_title || 'Sem título')}</p>
              <p class="mt-1 text-[11px] text-purple-300">Fonte: <strong class="text-sky-200">${escapeHtml(review.source_name || 'Secundária')}</strong>${review.incoming_group ? ` · Grupo: ${escapeHtml(review.incoming_group)}` : ''}</p>
              <p class="mt-1 text-[10px] text-sky-300">O Lux não encontrou indicação confiável de português nem de outro idioma.</p>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button data-locale-review-id="${review.id}" data-locale-review-status="pt" class="rounded-lg bg-emerald-700 px-2.5 py-2 text-[10px] font-bold text-white">PT / BR</button>
              <button data-locale-review-id="${review.id}" data-locale-review-status="international" class="rounded-lg bg-sky-700 px-2.5 py-2 text-[10px] font-bold text-white">Internacional</button>
              <button data-locale-review-id="${review.id}" data-locale-review-status="ignored" class="rounded-lg border border-slate-700 px-2.5 py-2 text-[10px] font-bold text-slate-300">Ignorar</button>
            </div>
          </div>
        </article>`).join('');
    } catch (error) {
      root.innerHTML = `<p class="py-4 text-center text-xs text-rose-300">${escapeHtml(error?.message || 'Falha ao carregar aprovações.')}</p>`;
    }
  }

  async function handleReviewClick(event) {
    const button = event.target.closest('[data-locale-review-id]');
    if (!button) return;
    button.disabled = true;
    try {
      await invoke('resolve', {
        id: Number(button.dataset.localeReviewId),
        status: button.dataset.localeReviewStatus
      });
      await refreshAdminReviews();
      const status = button.dataset.localeReviewStatus;
      const label = status === 'pt' ? 'PT / BR' : status === 'international' ? 'Internacional' : 'Ignorado';
      console.info(`[LUX-IPTV-037] Revisão de idioma salva como ${label}.`);
    } catch (error) {
      alert(error?.message || 'Não foi possível salvar a aprovação.');
      button.disabled = false;
    }
  }

  function installAdminHook() {
    ensureAdminSection();
    document.addEventListener('click', event => {
      const tab = event.target.closest?.('[data-admin-tab="sources"]');
      if (tab) setTimeout(() => refreshAdminReviews(), 80);
    }, { capture: true });
  }

  window.LuxSecondaryLocaleApproval = {
    version: VERSION,
    processCatalog,
    refreshAdminReviews
  };

  installAdminHook();

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    ensureAdminSection();
    const localeReady = Boolean(window.LuxSecondaryLocale?.classify);
    if (localeReady) processCatalog({ refreshUi: true }).catch(error => console.warn('[LUX-IPTV-037] Falha na aprovação de idioma:', error));
    if (attempts >= 24) clearInterval(timer);
  }, 1500);

  setTimeout(() => processCatalog({ refreshUi: true }).catch(error => console.warn('[LUX-IPTV-037] Validação inicial de idioma falhou:', error)), 2600);
})();
