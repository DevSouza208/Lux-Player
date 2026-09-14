(() => {
  'use strict';

  // ============================================================
  // [LUX-ADMIN-013] IMPORTAÇÃO / EXPORTAÇÃO DO MAPA FUNCIONAL
  // [LUX-ADMIN-014] ROLAGEM DO MAPA FUNCIONAL
  // ============================================================
  // Complemento do dashboard de Funcionalidades.
  //
  // Objetivo:
  // - permitir a migração inicial dos CSVs MAIN/DEVELOP para o Supabase;
  // - permitir baixar um snapshot CSV da branch exibida;
  // - manter a gravação atrás da Edge Function functional-map, que revalida
  //   usuário/senha e exige cargo=admin;
  // - garantir que a lista e o painel de detalhes possam rolar dentro do modal
  //   sem fazer o Painel Admin inteiro crescer além do limite da tela.
  //
  // Este arquivo NÃO acessa functional_map_csv diretamente e não usa service role.
  // ============================================================

  if (window.__luxAdminFunctionalitiesImportInstalled) return;
  window.__luxAdminFunctionalitiesImportInstalled = '20260914-functional-import2';

  const getClient = () => {
    try { return typeof supabaseClient !== 'undefined' ? supabaseClient : null; }
    catch (_) { return null; }
  };

  const getUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; }
    catch (_) { return null; }
  };

  function activeBranch() {
    const active = [...document.querySelectorAll('[data-functional-branch]')]
      .find(button => button.className.includes('bg-purple-600'));
    return active?.dataset?.functionalBranch === 'main' ? 'main' : 'develop';
  }

  function setStatus(message, danger = false) {
    const el = document.getElementById('functionalStatus');
    if (!el) return;
    el.textContent = message;
    el.className = danger ? 'text-[10px] text-rose-300' : 'text-[10px] text-purple-300/60';
  }

  async function invoke(action, branch, extra = {}) {
    const user = getUser();
    const client = getClient();
    if (!client || user?.role !== 'admin' || !user?.user || !user?.pass) {
      throw new Error('Ação restrita ao administrador.');
    }

    const { data, error } = await client.functions.invoke('functional-map', {
      body: {
        action,
        branch,
        username: user.user,
        password: user.pass,
        ...extra,
      },
    });

    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data?.ok) throw new Error('A operação não foi concluída.');
    return data;
  }

  function looksLikeFunctionalCsv(text) {
    const header = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] || '';
    return header.includes('Área') && header.includes('Funcionalidade') && header.includes('ID');
  }

  async function importCsv(file) {
    if (!file) return;
    const branch = activeBranch();
    const csv = await file.text();
    if (!looksLikeFunctionalCsv(csv)) {
      setStatus('Esse arquivo não parece ser um CSV do mapa funcional.', true);
      return;
    }

    setStatus(`Importando ${branch.toUpperCase()}...`);
    try {
      await invoke('put', branch, { csv });
      setStatus(`${branch.toUpperCase()} importado com sucesso.`);
      await window.LuxFunctionalities?.loadBranch?.(branch, true);
    } catch (error) {
      console.warn('[Lux Play] Falha ao importar mapa funcional.', error);
      setStatus(error?.message || 'Não foi possível importar o CSV.', true);
    }
  }

  async function downloadCsv() {
    const branch = activeBranch();
    setStatus(`Preparando ${branch.toUpperCase()}...`);
    try {
      const data = await invoke('get', branch);
      const csv = String(data.csv || '');
      if (!looksLikeFunctionalCsv(csv)) throw new Error('O mapa retornado está vazio ou inválido.');

      const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `lux-functional-map-${branch}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(`${branch.toUpperCase()} exportado.`);
    } catch (error) {
      console.warn('[Lux Play] Falha ao exportar mapa funcional.', error);
      setStatus(error?.message || 'Não foi possível exportar o CSV.', true);
    }
  }

  // [LUX-ADMIN-014]
  // O modal Admin usa flex + max-height + overflow-hidden. Dentro dele, o dashboard
  // usa outro flex e um grid. Em CSS Grid/Flex, filhos têm min-height:auto por padrão;
  // isso pode impedir o item de encolher e, consequentemente, o overflow-y:auto nunca
  // recebe uma área menor para rolar. Forçamos min-height:0 em toda a cadeia até os
  // dois painéis roláveis. Assim somente a lista/detalhes rolam, sem mover cabeçalho,
  // filtros ou botões de importação.
  function ensureFunctionalScroll() {
    const panel = document.getElementById('adminTabFunctionalities');
    const rows = document.getElementById('functionalRows');
    const detail = document.getElementById('functionalDetail');
    const body = rows?.parentElement || null;
    const root = body?.parentElement || panel?.firstElementChild || null;
    if (!panel || !root || !body || !rows || !detail) return false;

    panel.classList.add('min-h-0', 'overflow-hidden');
    root.classList.add('min-h-0', 'overflow-hidden');
    body.classList.add('min-h-0', 'overflow-hidden');

    [rows, detail].forEach(element => {
      element.classList.add('min-h-0', 'overflow-y-auto', 'overscroll-contain');
      element.style.minHeight = '0';
      element.style.overflowY = 'auto';
      element.style.overscrollBehavior = 'contain';
      element.style.touchAction = 'pan-y';
      element.style.webkitOverflowScrolling = 'touch';
    });

    return true;
  }

  function installButtons() {
    const panel = document.getElementById('adminTabFunctionalities');
    const filters = document.getElementById('functionalSearch')?.parentElement;
    if (!panel || !filters || filters.dataset.luxFunctionalImport === '1') return false;
    filters.dataset.luxFunctionalImport = '1';

    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = '.csv,text/csv';
    picker.hidden = true;
    picker.addEventListener('change', async () => {
      const [file] = picker.files || [];
      await importCsv(file);
      picker.value = '';
    });
    panel.appendChild(picker);

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'rounded-xl border border-emerald-800/70 bg-emerald-950/40 px-3 py-2 text-xs font-bold text-emerald-200 hover:bg-emerald-900/50';
    importButton.textContent = 'Importar CSV';
    importButton.title = 'Substitui o mapa da branch selecionada após validação no backend.';
    importButton.addEventListener('click', () => picker.click());
    filters.appendChild(importButton);

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'rounded-xl border border-purple-800/70 bg-purple-950/40 px-3 py-2 text-xs font-bold text-purple-100 hover:bg-purple-900/60';
    exportButton.textContent = 'Baixar CSV';
    exportButton.addEventListener('click', downloadCsv);
    filters.appendChild(exportButton);

    return true;
  }

  function install() {
    const scrollReady = ensureFunctionalScroll();
    const buttonsReady = installButtons();
    return scrollReady && (buttonsReady || document.getElementById('functionalSearch')?.parentElement?.dataset?.luxFunctionalImport === '1');
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 120) clearInterval(timer);
  }, 100);
  install();
})();
