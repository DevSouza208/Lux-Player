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
