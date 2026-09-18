(() => {
  'use strict';

  const VERSION = '20260918-home-rail-clear2';
  if (window.__luxHomeRailClearVersion === VERSION) return;
  window.__luxHomeRailClearVersion = VERSION;

  const $ = id => document.getElementById(id);
  let activeRail = 'movies';
  let clearing = false;
  let installTimer = null;
  let countObserver = null;

  function account() {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; }
    catch (_) { return null; }
  }

  function selectedCount() {
    const match = String($('homeRailCount')?.textContent || '0').match(/\d+/);
    return match ? Number(match[0]) : 0;
  }

  function setStatus(message, error = false) {
    const node = $('homeRailStatus');
    if (!node) return;
    node.textContent = message || '';
    node.className = `min-h-[18px] text-xs ${error ? 'text-rose-300' : 'text-purple-300'}`;
  }

  function updateButton() {
    const button = $('homeRailClear');
    if (!button) return;
    const disabled = clearing || selectedCount() === 0;
    button.disabled = disabled;
    button.classList.toggle('opacity-50', disabled);
    button.classList.toggle('cursor-not-allowed', disabled);
    button.title = activeRail === 'movies' || activeRail === 'series'
      ? 'Limpa os itens manuais e deixa o Lux preencher automaticamente.'
      : 'Remove todos os itens escolhidos desta faixa da Home.';
  }

  async function clearSelection() {
    if (clearing || selectedCount() === 0) return;

    const user = account();
    if (!user || user.role !== 'admin') {
      setStatus('Apenas administradores podem limpar as faixas da Home.', true);
      return;
    }
    if (typeof supabaseClient === 'undefined') {
      setStatus('Serviço de dados indisponível.', true);
      return;
    }

    clearing = true;
    updateButton();
    setStatus('Limpando seleção...');

    try {
      const { data, error } = await supabaseClient.functions.invoke('home-rails', {
        body: {
          action: 'replace',
          rail: activeRail,
          items: [],
          username: user.user,
          credential: user.pass,
        }
      });

      if (error || data?.error) {
        let message = data?.error || 'Não foi possível limpar a seleção.';
        try { message = (await error.context.json()).error || message; } catch (_) {}
        throw new Error(message);
      }

      if (window.LuxHomeRails?.refreshAdmin) await window.LuxHomeRails.refreshAdmin();
      if (window.LuxHomeRails?.render) await window.LuxHomeRails.render(true);

      setStatus(activeRail === 'movies' || activeRail === 'series'
        ? 'Seleção limpa. O preenchimento automático voltou a assumir esta faixa.'
        : 'Seleção limpa. A faixa ficará oculta até você escolher novos itens.');
    } catch (error) {
      console.warn('[Lux Home] Falha ao limpar seleção:', error);
      setStatus(error?.message || 'Não foi possível limpar a seleção.', true);
    } finally {
      clearing = false;
      setTimeout(updateButton, 0);
    }
  }

  function install() {
    const root = $('homeRailAdminRoot');
    const save = $('homeRailSave');
    if (!root || !save?.parentElement) return false;

    root.querySelectorAll('[data-home-rail-tab]').forEach(tab => {
      if (tab.dataset.luxClearWired === '1') return;
      tab.dataset.luxClearWired = '1';
      tab.addEventListener('click', () => {
        activeRail = tab.dataset.homeRailTab || 'movies';
        setTimeout(updateButton, 0);
      });
    });

    const active = [...root.querySelectorAll('[data-home-rail-tab]')]
      .find(tab => tab.classList.contains('bg-purple-600'));
    if (active?.dataset.homeRailTab) activeRail = active.dataset.homeRailTab;

    if (!$('homeRailClear')) {
      const button = document.createElement('button');
      button.id = 'homeRailClear';
      button.type = 'button';
      button.textContent = 'Limpar seleção';
      button.className = 'rounded-xl border border-rose-800/60 bg-rose-950/30 px-4 py-2 text-xs font-bold text-rose-200 hover:bg-rose-900/40 transition disabled:hover:bg-rose-950/30';
      button.addEventListener('click', clearSelection);
      save.insertAdjacentElement('beforebegin', button);
    }

    const count = $('homeRailCount');
    if (count && !countObserver) {
      countObserver = new MutationObserver(updateButton);
      countObserver.observe(count, { childList: true, subtree: true, characterData: true });
    }

    updateButton();
    return true;
  }

  function boot() {
    if (install()) return;
    let attempts = 0;
    installTimer = setInterval(() => {
      attempts += 1;
      if (install() || attempts >= 160) {
        clearInterval(installTimer);
        installTimer = null;
      }
    }, 50);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();

(() => {
  'use strict';

  const VERSION = '20260918-games-actions-layout1';
  if (window.__luxGamesActionsLayoutVersion === VERSION) return;
  window.__luxGamesActionsLayoutVersion = VERSION;

  const MOBILE_QUERY = '(max-width: 767px), (orientation: landscape) and (max-width: 1280px) and (max-height: 600px) and (pointer: coarse)';
  const mobileMedia = window.matchMedia(MOBILE_QUERY);
  let observer = null;
  let scheduled = false;

  const onclickText = element => String(element?.getAttribute?.('onclick') || '');

  function findButton(root, matcher) {
    return [...(root?.querySelectorAll?.('button') || [])].find(button => matcher(onclickText(button), button)) || null;
  }

  function decorateFavorite(button) {
    if (!button) return;
    button.dataset.luxGamesFavoriteAction = '1';
    button.classList.add('w-full', 'sm:w-auto', 'justify-center', 'min-h-[42px]', 'rounded-xl', 'px-3', 'py-2');
  }

  function applyLayout() {
    const games = document.getElementById('gamesSection');
    const actions = games?.querySelector('.games-catalog-actions');
    const menu = actions?.querySelector('.games-filter-menu');
    if (!games || !actions || !menu) return false;

    const panel = menu.querySelector('.games-filter-panel');
    const openRom = findButton(actions, onclick => onclick.includes("externalRomInput"));
    const favorite = findButton(games, onclick => onclick.includes("setGamesFilter('favorites')"));
    const review = findButton(games, onclick => onclick.includes('reviewUnapprovedGames'));
    const gamepad = document.getElementById('luxGamepadSetupBtn');
    const mobile = mobileMedia.matches;

    if (favorite) {
      decorateFavorite(favorite);
      if (openRom && favorite.nextElementSibling !== openRom) actions.insertBefore(favorite, openRom);
      else if (!openRom && favorite.parentElement !== actions) actions.insertBefore(favorite, menu);
      favorite.hidden = false;
    }

    if (review) {
      review.dataset.luxGamesDesktopAction = '1';
      review.classList.add('rounded-xl', 'px-3', 'py-2', 'min-h-[42px]');
      review.hidden = mobile;
      if (!mobile && review.parentElement !== actions) actions.insertBefore(review, menu);
    }

    if (gamepad) {
      gamepad.dataset.luxGamesDesktopAction = '1';
      gamepad.classList.add('rounded-xl', 'px-3', 'py-2', 'min-h-[42px]');
      gamepad.hidden = mobile;
      if (!mobile && gamepad.parentElement !== actions) actions.insertBefore(gamepad, menu);
    }

    // Filtros ficam apenas com os filtros reais. Caso algum render antigo reinsira
    // as ações administrativas no painel, elas são retiradas novamente no desktop
    // e simplesmente ocultadas no celular.
    if (panel) {
      if (review && !mobile && review.parentElement === panel) actions.insertBefore(review, menu);
      if (gamepad && !mobile && gamepad.parentElement === panel) actions.insertBefore(gamepad, menu);
    }

    return true;
  }

  function scheduleLayout() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      applyLayout();
    });
  }

  function start() {
    applyLayout();

    const games = document.getElementById('gamesSection');
    if (games && !observer) {
      observer = new MutationObserver(scheduleLayout);
      observer.observe(games, { childList: true, subtree: true });
    }

    mobileMedia.addEventListener?.('change', scheduleLayout);
    window.addEventListener('resize', scheduleLayout, { passive: true });

    // O Lux Gamepad é carregado logo depois deste módulo. Essas tentativas cobrem
    // a primeira injeção sem depender do tempo exato da rede/cache.
    [100, 300, 700, 1400, 2500].forEach(delay => setTimeout(scheduleLayout, delay));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
