(() => {
  'use strict';

  const VERSION = '20260917-game-console-visibility2';
  const CACHE_KEY = 'lux-play:game-console-visibility:v1';
  const FUNCTION_NAME = 'game-console-visibility';

  if (window.__luxGameConsoleVisibilityVersion === VERSION) return;
  window.__luxGameConsoleVisibilityVersion = VERSION;

  const state = {
    consoles: [],
    enabled: new Map(),
    loaded: false,
    loading: null,
    saving: new Set(),
  };

  const LABELS = {
    arcade: 'Arcade',
    gb: 'Game Boy',
    gbc: 'Game Boy Color',
    gba: 'Game Boy Advance',
    nes: 'Nintendo NES',
    snes: 'Super Nintendo',
    megadrive: 'Mega Drive',
    mastersystem: 'Master System',
    n64: 'Nintendo 64',
    nds: 'Nintendo DS',
    psp: 'PSP',
  };

  function normalizeConsole(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^a-z0-9_-]/g, '');
  }

  function consoleLabel(id) {
    const key = normalizeConsole(id);
    return LABELS[key] || key.toUpperCase() || 'Console';
  }

  function readCurrentUser() {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; }
    catch (_) { return null; }
  }

  function isAdmin() {
    return String(readCurrentUser()?.role || '').trim().toLowerCase() === 'admin';
  }

  function cacheState() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(state.consoles.map(item => ({
        id: item.id,
        enabled: item.enabled !== false,
        total: Number(item.total) || 0,
        approved: Number(item.approved) || 0,
      }))));
    } catch (_) {}
  }

  function applyConsoles(rows, markLoaded = true) {
    const normalized = (Array.isArray(rows) ? rows : [])
      .map(item => ({
        id: normalizeConsole(item?.id || item?.console),
        enabled: item?.enabled !== false,
        total: Number(item?.total) || 0,
        approved: Number(item?.approved) || 0,
      }))
      .filter(item => item.id);

    state.consoles = normalized.sort((a, b) => consoleLabel(a.id).localeCompare(consoleLabel(b.id), 'pt-BR'));
    state.enabled = new Map(state.consoles.map(item => [item.id, item.enabled !== false]));
    if (markLoaded) state.loaded = true;
    cacheState();
    renderAdminPanel();
    return state.consoles;
  }

  function restoreCache() {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
      if (Array.isArray(cached) && cached.length) applyConsoles(cached, false);
    } catch (_) {}
  }

  function isConsoleEnabled(value) {
    const id = normalizeConsole(value);
    if (!id || !state.enabled.has(id)) return true;
    return state.enabled.get(id) !== false;
  }

  async function refreshVisibility(force = false) {
    if (state.loaded && !force) return state.consoles;
    if (state.loading) return state.loading;

    state.loading = (async () => {
      try {
        const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
          body: { action: 'get' },
        });
        if (error || data?.error || !Array.isArray(data?.consoles)) {
          throw new Error(data?.error || error?.message || 'Resposta inválida.');
        }
        return applyConsoles(data.consoles, true);
      } catch (error) {
        console.warn('[Lux Games] Não foi possível atualizar a visibilidade dos consoles:', error);
        renderAdminMessage('Não foi possível consultar os consoles agora. Usando o último estado salvo neste dispositivo.', true);
        return state.consoles;
      } finally {
        state.loading = null;
      }
    })();

    return state.loading;
  }

  function filterPublicCatalog(rows) {
    if (isAdmin()) return rows;
    return (Array.isArray(rows) ? rows : []).filter(game => isConsoleEnabled(game?.console));
  }

  function patchCatalogLoader() {
    if (typeof loadGamesCatalog !== 'function' || loadGamesCatalog.__luxConsoleVisibilityPatched) return false;
    const originalLoadGamesCatalog = loadGamesCatalog;

    const patchedLoadGamesCatalog = async function (...args) {
      const rows = await originalLoadGamesCatalog.apply(this, args);
      const source = Array.isArray(rows) ? rows : (Array.isArray(gamesCatalog) ? gamesCatalog : []);
      if (isAdmin()) return source;

      await refreshVisibility(false);
      const visible = filterPublicCatalog(source);
      try { gamesCatalog = visible; } catch (_) {}
      return visible;
    };

    patchedLoadGamesCatalog.__luxConsoleVisibilityPatched = VERSION;
    patchedLoadGamesCatalog.__luxConsoleVisibilityOriginal = originalLoadGamesCatalog;
    loadGamesCatalog = patchedLoadGamesCatalog;
    try { window.loadGamesCatalog = patchedLoadGamesCatalog; } catch (_) {}
    return true;
  }

  function createElement(tag, className = '', text = '') {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  }

  function renderAdminMessage(text = '', isError = false) {
    const message = document.getElementById('adminGameConsoleVisibilityMessage');
    if (!message) return;
    message.className = `mt-3 min-h-[18px] text-xs ${isError ? 'text-amber-300' : 'text-purple-300'}`;
    message.textContent = text;
  }

  function renderAdminPanel() {
    const list = document.getElementById('adminGameConsoleVisibilityList');
    if (!list) return;
    list.replaceChildren();

    if (!state.consoles.length) {
      list.appendChild(createElement('p', 'text-xs text-purple-300/70', state.loading ? 'Carregando consoles...' : 'Nenhum console encontrado no catálogo.'));
      return;
    }

    state.consoles.forEach(item => {
      const row = createElement('div', 'flex items-center justify-between gap-3 rounded-2xl border border-purple-900/50 bg-[#180f29] px-4 py-3');
      const info = createElement('div', 'min-w-0');
      info.appendChild(createElement('div', 'text-sm font-bold text-white', consoleLabel(item.id)));
      info.appendChild(createElement('div', 'mt-0.5 text-[10px] text-purple-300/70', `${item.approved} aprovado(s) · ${item.total} cadastrado(s)`));
      row.appendChild(info);

      const enabled = item.enabled !== false;
      const button = createElement('button');
      button.type = 'button';
      button.setAttribute('role', 'switch');
      button.setAttribute('aria-checked', enabled ? 'true' : 'false');
      button.dataset.consoleVisibility = item.id;
      button.disabled = state.saving.has(item.id);
      button.className = enabled
        ? 'shrink-0 inline-flex items-center gap-2 rounded-xl border border-emerald-700/60 bg-emerald-950/40 px-3 py-2 text-[11px] font-bold text-emerald-200 disabled:opacity-50'
        : 'shrink-0 inline-flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2 text-[11px] font-bold text-slate-300 disabled:opacity-50';

      const dot = createElement('span', enabled ? 'h-2.5 w-2.5 rounded-full bg-emerald-400' : 'h-2.5 w-2.5 rounded-full bg-slate-500');
      const label = createElement('span', '', state.saving.has(item.id) ? 'Salvando...' : (enabled ? 'Visível' : 'Oculto'));
      button.append(dot, label);
      button.addEventListener('click', () => setConsoleEnabled(item.id, !enabled));
      row.appendChild(button);
      list.appendChild(row);
    });
  }

  function ensureAdminPanel() {
    const panel = document.getElementById('adminTabGames');
    if (!panel || document.getElementById('adminGameConsoleVisibility')) return Boolean(panel);

    const section = createElement('div', 'mt-4 bg-[#120c1f] border border-purple-900/60 rounded-3xl p-5 md:p-6');
    section.id = 'adminGameConsoleVisibility';

    const header = createElement('div', 'flex flex-wrap items-center justify-between gap-3');
    const heading = createElement('div');
    heading.appendChild(createElement('h3', 'text-base font-bold text-white', 'Consoles visíveis para usuários'));
    heading.appendChild(createElement('p', 'mt-1 text-xs text-purple-300', 'Desative um console inteiro sem alterar a aprovação dos jogos. Jogos aprovados desse console ficam ocultos até você ativá-lo novamente.'));
    header.appendChild(heading);

    const refresh = createElement('button', 'rounded-xl border border-purple-800/60 bg-purple-950/70 px-3 py-2.5 text-xs font-bold text-purple-200 hover:bg-purple-900/80', 'Atualizar');
    refresh.type = 'button';
    refresh.addEventListener('click', async () => {
      refresh.disabled = true;
      renderAdminMessage('Atualizando consoles...');
      await refreshVisibility(true);
      refresh.disabled = false;
      renderAdminMessage('Consoles atualizados.');
    });
    header.appendChild(refresh);
    section.appendChild(header);

    const list = createElement('div', 'mt-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2');
    list.id = 'adminGameConsoleVisibilityList';
    section.appendChild(list);

    const message = createElement('p', 'mt-3 min-h-[18px] text-xs text-purple-300');
    message.id = 'adminGameConsoleVisibilityMessage';
    section.appendChild(message);

    const firstCard = panel.firstElementChild;
    if (firstCard) firstCard.insertAdjacentElement('afterend', section);
    else panel.prepend(section);

    renderAdminPanel();
    refreshVisibility(false);
    return true;
  }

  async function setConsoleEnabled(consoleId, enabled) {
    const user = readCurrentUser();
    if (!user || String(user.role || '').trim().toLowerCase() !== 'admin') {
      renderAdminMessage('Somente administradores podem alterar a visibilidade dos consoles.', true);
      return;
    }

    const id = normalizeConsole(consoleId);
    if (!id || state.saving.has(id)) return;
    state.saving.add(id);
    renderAdminPanel();
    renderAdminMessage(`${enabled ? 'Ativando' : 'Ocultando'} ${consoleLabel(id)}...`);

    try {
      const { data, error } = await supabaseClient.functions.invoke(FUNCTION_NAME, {
        body: {
          action: 'save',
          username: user.user,
          password: user.pass,
          console: id,
          enabled: Boolean(enabled),
        },
      });
      if (error || data?.error || !Array.isArray(data?.consoles)) {
        throw new Error(data?.error || error?.message || 'O servidor não confirmou a alteração.');
      }

      applyConsoles(data.consoles, true);
      renderAdminMessage(`${consoleLabel(id)} agora está ${enabled ? 'visível' : 'oculto'} para usuários. A aprovação individual dos jogos foi preservada.`);
      console.info(`[Lux Games] ${consoleLabel(id)} ${enabled ? 'ativado' : 'desativado'} no catálogo público.`);
    } catch (error) {
      console.error('[Lux Games] Falha ao salvar visibilidade do console:', error);
      renderAdminMessage(`Não foi possível salvar ${consoleLabel(id)}: ${error?.message || 'erro desconhecido'}`, true);
      await refreshVisibility(true);
    } finally {
      state.saving.delete(id);
      renderAdminPanel();
    }
  }

  function chooseReviewConsole(groups) {
    return new Promise(resolve => {
      document.getElementById('gameReviewConsoleDialog')?.remove();

      const overlay = createElement('div', 'fixed inset-0 z-[1200] flex items-center justify-center bg-black/75 p-4');
      overlay.id = 'gameReviewConsoleDialog';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'gameReviewConsoleTitle');

      const card = createElement('div', 'w-full max-w-lg rounded-3xl border border-purple-800/60 bg-[#120c1f] p-5 shadow-2xl');
      const title = createElement('h3', 'text-lg font-black text-white', 'Qual console você quer revisar?');
      title.id = 'gameReviewConsoleTitle';
      card.appendChild(title);
      card.appendChild(createElement('p', 'mt-1 text-xs text-purple-300', 'A fila mostrará somente os jogos ainda não aprovados do console escolhido.'));

      const list = createElement('div', 'mt-5 grid grid-cols-1 sm:grid-cols-2 gap-2');
      let firstButton = null;

      const close = value => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        resolve(value);
      };

      const onKeyDown = event => {
        if (event.key === 'Escape') close(null);
      };

      for (const group of groups) {
        const button = createElement('button', 'flex min-h-[64px] items-center justify-between gap-3 rounded-2xl border border-purple-800/50 bg-[#180f29] px-4 py-3 text-left hover:border-purple-500 hover:bg-[#211437] focus:outline-none focus:ring-2 focus:ring-purple-500');
        button.type = 'button';
        button.dataset.reviewConsole = group.id;

        const info = createElement('span', 'min-w-0');
        info.appendChild(createElement('span', 'block text-sm font-bold text-white', consoleLabel(group.id)));
        info.appendChild(createElement('span', 'mt-0.5 block text-[10px] text-purple-300/70', `${group.count} jogo(s) aguardando revisão`));
        button.appendChild(info);
        button.appendChild(createElement('span', 'shrink-0 rounded-full bg-purple-600/20 px-2.5 py-1 text-xs font-black text-purple-200', String(group.count)));
        button.addEventListener('click', () => close(group.id));
        list.appendChild(button);
        if (!firstButton) firstButton = button;
      }

      card.appendChild(list);

      const actions = createElement('div', 'mt-5 flex justify-end');
      const cancel = createElement('button', 'rounded-xl border border-purple-900/60 bg-[#180f29] px-4 py-2.5 text-xs font-bold text-purple-200 hover:bg-[#23153b]', 'Cancelar');
      cancel.type = 'button';
      cancel.addEventListener('click', () => close(null));
      actions.appendChild(cancel);
      card.appendChild(actions);
      overlay.appendChild(card);

      overlay.addEventListener('click', event => {
        if (event.target === overlay) close(null);
      });
      document.addEventListener('keydown', onKeyDown);
      document.body.appendChild(overlay);
      requestAnimationFrame(() => firstButton?.focus());
    });
  }

  async function reviewUnapprovedGamesByConsole() {
    if (!isAdmin()) return;

    try {
      await loadGamesCatalog();
      const pending = (Array.isArray(gamesCatalog) ? gamesCatalog : []).filter(game => game.status !== 'approved');
      if (!pending.length) {
        window.alert?.('Não há jogos não aprovados para revisar.');
        return;
      }

      const grouped = new Map();
      for (const game of pending) {
        const id = normalizeConsole(game?.console) || 'desconhecido';
        grouped.set(id, (grouped.get(id) || 0) + 1);
      }

      const groups = [...grouped.entries()]
        .map(([id, count]) => ({ id, count }))
        .sort((a, b) => consoleLabel(a.id).localeCompare(consoleLabel(b.id), 'pt-BR'));

      const selectedConsole = await chooseReviewConsole(groups);
      if (!selectedConsole) return;

      pendingReviewQueue = pending
        .filter(game => (normalizeConsole(game?.console) || 'desconhecido') === selectedConsole)
        .map(game => game.id);

      if (!pendingReviewQueue.length) {
        window.alert?.(`Não há jogos de ${consoleLabel(selectedConsole)} aguardando revisão.`);
        return;
      }

      openNextPendingReview();
      try {
        setGameAdminStatus(`Revisando ${pendingReviewQueue.length} jogo(s) de ${consoleLabel(selectedConsole)}.`);
      } catch (_) {}
    } catch (error) {
      console.error('[Lux Games] Falha ao iniciar revisão por console:', error);
      window.alert?.(`Não foi possível carregar os jogos para revisão: ${error?.message || 'erro desconhecido'}`);
    }
  }

  function patchReviewFlow() {
    if (typeof reviewUnapprovedGames !== 'function') return false;
    if (reviewUnapprovedGames.__luxReviewByConsolePatched) return true;

    const patchedReview = reviewUnapprovedGamesByConsole;
    patchedReview.__luxReviewByConsolePatched = VERSION;
    reviewUnapprovedGames = patchedReview;
    try { window.reviewUnapprovedGames = patchedReview; } catch (_) {}
    return true;
  }

  restoreCache();
  patchCatalogLoader();
  patchReviewFlow();
  ensureAdminPanel();

  const installer = setInterval(() => {
    patchCatalogLoader();
    patchReviewFlow();
    ensureAdminPanel();
  }, 250);
  setTimeout(() => clearInterval(installer), 15000);
  document.addEventListener('DOMContentLoaded', () => {
    patchCatalogLoader();
    patchReviewFlow();
    ensureAdminPanel();
  }, { once: true });

  window.LuxGameConsoleVisibility = {
    version: VERSION,
    refresh: refreshVisibility,
    isEnabled: isConsoleEnabled,
    setEnabled: setConsoleEnabled,
    list: () => state.consoles.map(item => ({ ...item })),
    reviewPendingByConsole: reviewUnapprovedGamesByConsole,
  };

  console.info('[Lux Games] Controle global de visibilidade e revisão por console ativos.');
})();
