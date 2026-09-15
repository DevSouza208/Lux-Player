(() => {
  'use strict';

  const VERSION = '20260914-secondary-grouping-1';
  if (window.__luxSecondaryGroupingInstalled === VERSION) return;
  window.__luxSecondaryGroupingInstalled = VERSION;

  const FUNCTION_NAME = 'content-catalog-grouping';
  let running = false;

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
    if (error) throw new Error(data?.error || error.message || 'Não foi possível atualizar o agrupamento.');
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function getSeriesCategories() {
    let items = [];
    try { if (typeof allMediaItems !== 'undefined' && Array.isArray(allMediaItems)) items = allMediaItems; } catch (_) {}
    const seen = new Set();
    const result = [];
    for (const item of items) {
      if (String(item?.type || '').toLowerCase() !== 'series') continue;
      const group = String(item?.group || '').trim();
      if (!/^Séries\s*\|/i.test(group)) continue;
      const key = group.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        result.push(group);
      }
    }
    if (!result.some(group => /variad|outros/i.test(group))) result.push('Séries | Variadas ⚡ PLUS');
    return result.slice(0, 120);
  }

  function statusNode() {
    return document.getElementById('secondarySourceStatus');
  }

  async function updateGrouping(button) {
    if (running) return;
    running = true;
    if (button) button.disabled = true;
    const status = statusNode();
    const categories = getSeriesCategories();
    let processed = 0;
    let matched = 0;
    let fallback = 0;

    try {
      const initial = await invoke('status', { categories });
      let remaining = Number(initial?.remaining || 0);
      if (!remaining) {
        if (status) {
          status.textContent = 'Agrupamento já está atualizado para as obras secundárias atuais.';
          status.className = 'md:col-span-2 min-h-[18px] text-xs text-emerald-300';
        }
        return;
      }

      if (status) {
        status.textContent = `Atualizando agrupamento com TMDB/IMDb: ${remaining} obra(s) pendente(s)...`;
        status.className = 'md:col-span-2 min-h-[18px] text-xs text-cyan-300';
      }

      for (let round = 0; round < 100 && remaining > 0; round++) {
        const batch = await invoke('batch', { categories, limit: 8 });
        const count = Number(batch?.processed || 0);
        if (!count) break;
        processed += count;
        matched += Number(batch?.matched || 0);
        fallback += Number(batch?.fallback || 0);
        remaining = Number(batch?.remaining || 0);
        if (status) status.textContent = `Agrupando catálogo... ${processed} processadas · ${matched} identificadas · ${remaining} restantes.`;
        await new Promise(resolve => setTimeout(resolve, 180));
      }

      if (window.LuxCanonicalCatalog?.reload) {
        await window.LuxCanonicalCatalog.reload({ refreshUi: true });
      }

      if (status) {
        status.textContent = `Agrupamento atualizado: ${processed} obra(s) · ${matched} identificadas no TMDB · ${fallback} em categoria de fallback.`;
        status.className = 'md:col-span-2 min-h-[18px] text-xs text-emerald-300';
      }
    } catch (error) {
      console.warn('[LUX-GROUPING] Falha ao atualizar agrupamento:', error);
      if (status) {
        status.textContent = error?.message || 'Não foi possível atualizar o agrupamento.';
        status.className = 'md:col-span-2 min-h-[18px] text-xs text-rose-300';
      }
    } finally {
      running = false;
      if (button) button.disabled = false;
    }
  }

  function installButton() {
    const apply = document.getElementById('secondaryApplyNow');
    if (!apply) return false;
    if (document.getElementById('secondaryUpdateGrouping')) return true;

    const button = document.createElement('button');
    button.id = 'secondaryUpdateGrouping';
    button.type = 'button';
    button.className = 'rounded-xl border border-cyan-700/60 bg-cyan-950/40 px-3 py-2 text-xs font-bold text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-50';
    button.textContent = 'Atualizar agrupamento';
    button.title = 'Usa TMDB e IMDb para encaixar as obras secundárias nas categorias já existentes do Lux.';
    button.addEventListener('click', () => updateGrouping(button));
    apply.insertAdjacentElement('afterend', button);
    return true;
  }

  const observer = new MutationObserver(() => installButton());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  installButton();

  window.LuxSecondaryGrouping = {
    version: VERSION,
    update: () => updateGrouping(document.getElementById('secondaryUpdateGrouping')),
    categories: getSeriesCategories
  };
})();
