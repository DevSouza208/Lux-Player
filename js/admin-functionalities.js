(() => {
  'use strict';

  // ============================================================
  // [LUX-ADMIN-013] DASHBOARD DE FUNCIONALIDADES
  // [LUX-ARCH-023] MAPA FUNCIONAL MAIN / DEVELOP
  // ============================================================
  // Objetivo:
  // - colocar o mapa funcional dentro do próprio Painel Admin;
  // - permitir alternar entre o que está em produção (MAIN) e o que está em
  //   homologação (DEVELOP);
  // - usar o CSV guardado no Supabase como fonte diária da documentação;
  // - manter Excel/XLSM apenas como export/backup, evitando regravar uma planilha
  //   inteira quando precisamos alterar uma única funcionalidade.
  //
  // SEGURANÇA:
  // - o navegador NÃO acessa a tabela functional_map_csv diretamente;
  // - a Edge Function functional-map exige uma conta Lux com cargo admin;
  // - dados vindos do CSV são inseridos com textContent/DOM APIs. Nunca usamos
  //   conteúdo do CSV como HTML, para não transformar documentação em vetor XSS.
  // ============================================================

  if (window.__luxAdminFunctionalitiesInstalled) return;
  window.__luxAdminFunctionalitiesInstalled = '20260914-functionalities1';

  const state = {
    branch: 'develop',
    rowsByBranch: new Map(),
    updatedAtByBranch: new Map(),
    search: '',
    area: '',
    tag: '',
    selectedId: '',
    loading: false,
  };

  const getClient = () => {
    try { return typeof supabaseClient !== 'undefined' ? supabaseClient : null; }
    catch (_) { return null; }
  };

  const getUser = () => {
    try { return typeof currentUser !== 'undefined' ? currentUser : null; }
    catch (_) { return null; }
  };

  const create = (tag, className = '', text = '') => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== '') el.textContent = text;
    return el;
  };

  // Parser CSV completo o suficiente para o nosso mapa: respeita aspas, vírgulas,
  // quebras de linha dentro de campos e aspas escapadas como "".
  function parseCsv(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const matrix = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (quoted) {
        if (char === '"' && source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n') { row.push(field); matrix.push(row); row = []; field = ''; }
      else if (char !== '\r') field += char;
    }
    if (field || row.length) { row.push(field); matrix.push(row); }
    if (matrix.length < 2) return [];

    const headers = matrix[0].map(value => String(value || '').trim());
    return matrix.slice(1)
      .filter(cells => cells.some(value => String(value || '').trim()))
      .map(cells => {
        const item = {};
        headers.forEach((header, index) => { item[header] = String(cells[index] ?? '').trim(); });
        return item;
      });
  }

  function normalize(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function ensureAdminUi() {
    const clientTab = document.querySelector('[data-admin-tab="clientes"]');
    const tabBar = clientTab?.parentElement;
    const firstPanel = document.querySelector('.admin-tab-panel');
    const panelHost = firstPanel?.parentElement;
    if (!tabBar || !panelHost) return false;

    if (!document.querySelector('[data-admin-tab="functionalities"]')) {
      const button = create('button', 'admin-tab-btn bg-[#180f29] text-purple-200 hover:bg-[#23153b] px-3 py-2 rounded-xl text-[11px] font-bold');
      button.dataset.adminTab = 'functionalities';
      button.type = 'button';
      button.textContent = 'Funcionalidades';
      button.addEventListener('click', () => {
        if (typeof window.switchAdminTab === 'function') window.switchAdminTab('functionalities');
        open();
      });
      tabBar.appendChild(button);
    }

    if (!document.getElementById('adminTabFunctionalities')) {
      const panel = create('div', 'admin-tab-panel hidden flex-1 min-h-0 overflow-hidden');
      panel.id = 'adminTabFunctionalities';
      panel.appendChild(buildDashboard());
      panelHost.appendChild(panel);
    }
    return true;
  }

  function buildDashboard() {
    const root = create('div', 'h-full min-h-0 flex flex-col gap-3');

    const top = create('div', 'flex flex-col xl:flex-row xl:items-center justify-between gap-3');
    const titleWrap = create('div');
    titleWrap.appendChild(create('h4', 'text-sm font-black text-white', 'Mapa Funcional do Lux'));
    titleWrap.appendChild(create('p', 'text-[11px] text-purple-300/70', 'Produção e homologação no mesmo painel, sem misturar as duas branches.'));
    top.appendChild(titleWrap);

    const branchWrap = create('div', 'flex items-center gap-1 rounded-xl border border-purple-900/50 bg-[#0d0817] p-1');
    ['main', 'develop'].forEach(branch => {
      const button = create('button', '', branch.toUpperCase());
      button.type = 'button';
      button.dataset.functionalBranch = branch;
      button.addEventListener('click', () => loadBranch(branch));
      branchWrap.appendChild(button);
    });
    top.appendChild(branchWrap);
    root.appendChild(top);

    const stats = create('div', 'grid grid-cols-2 md:grid-cols-5 gap-2');
    stats.id = 'functionalStats';
    root.appendChild(stats);

    const filters = create('div', 'grid grid-cols-1 md:grid-cols-[1fr_180px_150px_auto] gap-2');
    const search = create('input', 'rounded-xl border border-purple-900/60 bg-[#180f29] px-3 py-2 text-xs text-white outline-none focus:border-purple-500');
    search.id = 'functionalSearch';
    search.type = 'search';
    search.placeholder = 'Buscar ID, funcionalidade, arquivo ou função...';
    search.addEventListener('input', () => { state.search = search.value; render(); });
    filters.appendChild(search);

    const area = create('select', 'rounded-xl border border-purple-900/60 bg-[#180f29] px-3 py-2 text-xs text-purple-100 outline-none');
    area.id = 'functionalAreaFilter';
    area.addEventListener('change', () => { state.area = area.value; render(); });
    filters.appendChild(area);

    const tag = create('select', 'rounded-xl border border-purple-900/60 bg-[#180f29] px-3 py-2 text-xs text-purple-100 outline-none');
    tag.id = 'functionalTagFilter';
    tag.addEventListener('change', () => { state.tag = tag.value; render(); });
    filters.appendChild(tag);

    const refresh = create('button', 'rounded-xl border border-purple-800/70 bg-purple-950/50 px-3 py-2 text-xs font-bold text-purple-100 hover:bg-purple-900/60', 'Atualizar');
    refresh.type = 'button';
    refresh.addEventListener('click', () => loadBranch(state.branch, true));
    filters.appendChild(refresh);
    root.appendChild(filters);

    const meta = create('div', 'flex items-center justify-between gap-2 text-[10px] text-purple-300/60');
    const status = create('span', '', 'Aguardando...');
    status.id = 'functionalStatus';
    meta.appendChild(status);
    const count = create('span');
    count.id = 'functionalVisibleCount';
    meta.appendChild(count);
    root.appendChild(meta);

    const body = create('div', 'grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3 flex-1 min-h-0');
    const list = create('div', 'overflow-auto rounded-2xl border border-purple-900/40 bg-[#0d0817]');
    list.id = 'functionalRows';
    body.appendChild(list);

    const detail = create('aside', 'overflow-auto rounded-2xl border border-purple-900/40 bg-[#120c1f] p-4');
    detail.id = 'functionalDetail';
    detail.appendChild(create('p', 'text-xs text-purple-300/60', 'Selecione uma funcionalidade para ver arquivos, funções e dependências.'));
    body.appendChild(detail);
    root.appendChild(body);

    return root;
  }

  function setBranchButtons() {
    document.querySelectorAll('[data-functional-branch]').forEach(button => {
      const active = button.dataset.functionalBranch === state.branch;
      button.className = active
        ? 'rounded-lg bg-purple-600 px-4 py-2 text-[11px] font-black text-white shadow-lg shadow-purple-950/30'
        : 'rounded-lg px-4 py-2 text-[11px] font-bold text-purple-300 hover:text-white';
    });
  }

  function populateFilters(rows) {
    const area = document.getElementById('functionalAreaFilter');
    const tag = document.getElementById('functionalTagFilter');
    if (!area || !tag) return;

    const fill = (select, values, label, current) => {
      select.replaceChildren();
      const all = create('option', '', label);
      all.value = '';
      select.appendChild(all);
      [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR')).forEach(value => {
        const option = create('option', '', value);
        option.value = value;
        select.appendChild(option);
      });
      select.value = current;
    };

    fill(area, rows.map(row => row['Área']), 'Todas as áreas', state.area);
    fill(tag, rows.map(row => row['Tag']), 'Todas as tags', state.tag);
  }

  function filteredRows(rows) {
    const query = normalize(state.search);
    return rows.filter(row => {
      if (state.area && row['Área'] !== state.area) return false;
      if (state.tag && row['Tag'] !== state.tag) return false;
      if (!query) return true;
      return normalize([
        row['ID'], row['Área'], row['Funcionalidade'], row['Status'], row['Tag'],
        row['O que faz'], row['Arquivos / módulos'], row['Funções / símbolos'], row['Dependências / fluxo']
      ].join(' ')).includes(query);
    });
  }

  function tagClasses(tag) {
    const key = String(tag || '').toUpperCase();
    if (key === 'PROTEGIDO') return 'border-emerald-800/60 bg-emerald-950/40 text-emerald-200';
    if (key === 'PRIORIDADE') return 'border-rose-800/60 bg-rose-950/40 text-rose-200';
    if (key === 'VALIDAR') return 'border-amber-800/60 bg-amber-950/40 text-amber-200';
    if (key === 'LEGADO') return 'border-slate-700/60 bg-slate-900/60 text-slate-300';
    if (key === 'REFAZER') return 'border-orange-800/60 bg-orange-950/40 text-orange-200';
    return 'border-blue-800/60 bg-blue-950/40 text-blue-200';
  }

  function renderStats(rows) {
    const stats = document.getElementById('functionalStats');
    if (!stats) return;
    stats.replaceChildren();
    const cards = [
      ['Total', rows.length],
      ['Protegido', rows.filter(r => r['Tag'] === 'PROTEGIDO').length],
      ['Prioridade', rows.filter(r => r['Tag'] === 'PRIORIDADE').length],
      ['Validar', rows.filter(r => r['Tag'] === 'VALIDAR').length],
      ['Melhorar', rows.filter(r => r['Tag'] === 'MELHORAR').length],
    ];
    cards.forEach(([label, value]) => {
      const card = create('div', 'rounded-xl border border-purple-900/40 bg-[#180f29] px-3 py-2');
      card.appendChild(create('div', 'text-[10px] uppercase tracking-wider text-purple-400/70', label));
      card.appendChild(create('div', 'text-lg font-black text-white', String(value)));
      stats.appendChild(card);
    });
  }

  function renderRows(rows) {
    const container = document.getElementById('functionalRows');
    if (!container) return;
    container.replaceChildren();

    if (!rows.length) {
      container.appendChild(create('p', 'p-6 text-center text-xs text-purple-300/60', 'Nenhuma funcionalidade encontrada.'));
      return;
    }

    rows.forEach(row => {
      const button = create('button', 'w-full border-b border-purple-950/70 px-3 py-3 text-left hover:bg-purple-950/30 transition-colors');
      button.type = 'button';
      if (row['ID'] === state.selectedId) button.classList.add('bg-purple-950/40');
      button.addEventListener('click', () => {
        state.selectedId = row['ID'];
        renderRows(rows);
        renderDetail(row);
      });

      const line = create('div', 'flex items-start justify-between gap-3');
      const left = create('div', 'min-w-0');
      left.appendChild(create('div', 'text-[10px] font-mono font-bold text-purple-400', row['ID'] || 'SEM-ID'));
      left.appendChild(create('div', 'mt-0.5 text-xs font-bold text-white', row['Funcionalidade'] || 'Sem nome'));
      left.appendChild(create('div', 'mt-1 text-[10px] text-slate-400', `${row['Área'] || 'Sem área'} · ${row['Status'] || 'Sem status'}`));
      line.appendChild(left);
      const badge = create('span', `shrink-0 rounded-full border px-2 py-1 text-[9px] font-black ${tagClasses(row['Tag'])}`, row['Tag'] || '—');
      line.appendChild(badge);
      button.appendChild(line);
      container.appendChild(button);
    });
  }

  function detailBlock(parent, title, value, mono = false) {
    const raw = String(value || '').trim();
    if (!raw) return;
    const block = create('section', 'mt-4');
    block.appendChild(create('h6', 'mb-1 text-[10px] font-black uppercase tracking-wider text-purple-400', title));
    block.appendChild(create('p', mono ? 'whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-slate-300' : 'whitespace-pre-wrap text-xs leading-relaxed text-slate-300', raw));
    parent.appendChild(block);
  }

  function renderDetail(row) {
    const detail = document.getElementById('functionalDetail');
    if (!detail) return;
    detail.replaceChildren();
    if (!row) {
      detail.appendChild(create('p', 'text-xs text-purple-300/60', 'Selecione uma funcionalidade para ver os detalhes.'));
      return;
    }

    detail.appendChild(create('div', 'text-[10px] font-mono font-black text-purple-400', row['ID'] || 'SEM-ID'));
    detail.appendChild(create('h5', 'mt-1 text-base font-black text-white', row['Funcionalidade'] || 'Sem nome'));
    const status = create('div', 'mt-2 flex flex-wrap gap-2');
    status.appendChild(create('span', `rounded-full border px-2 py-1 text-[9px] font-black ${tagClasses(row['Tag'])}`, row['Tag'] || '—'));
    status.appendChild(create('span', 'rounded-full border border-purple-800/60 bg-purple-950/40 px-2 py-1 text-[9px] font-bold text-purple-200', row['Status'] || '—'));
    detail.appendChild(status);

    detailBlock(detail, 'O que faz', row['O que faz']);
    detailBlock(detail, 'Opinião', row['Minha opinião']);
    detailBlock(detail, 'Sugestões', row['Sugestões de melhoria']);
    detailBlock(detail, 'Arquivos / módulos', row['Arquivos / módulos'], true);
    detailBlock(detail, 'Funções / símbolos', row['Funções / símbolos'], true);
    detailBlock(detail, 'Dependências / fluxo', row['Dependências / fluxo'], true);
  }

  function render() {
    setBranchButtons();
    const rows = state.rowsByBranch.get(state.branch) || [];
    populateFilters(rows);
    renderStats(rows);
    const visible = filteredRows(rows);
    renderRows(visible);

    const visibleCount = document.getElementById('functionalVisibleCount');
    if (visibleCount) visibleCount.textContent = `${visible.length} de ${rows.length}`;

    let selected = visible.find(row => row['ID'] === state.selectedId);
    if (!selected && visible.length) {
      selected = visible[0];
      state.selectedId = selected['ID'];
    }
    renderDetail(selected || null);
  }

  function setStatus(message, danger = false) {
    const el = document.getElementById('functionalStatus');
    if (!el) return;
    el.textContent = message;
    el.className = danger ? 'text-[10px] text-rose-300' : 'text-[10px] text-purple-300/60';
  }

  async function loadBranch(branch, force = false) {
    branch = branch === 'main' ? 'main' : 'develop';
    state.branch = branch;
    state.selectedId = '';
    setBranchButtons();

    if (!force && state.rowsByBranch.has(branch)) {
      render();
      return;
    }
    if (state.loading) return;

    const user = getUser();
    const client = getClient();
    if (!client || user?.role !== 'admin' || !user?.user || !user?.pass) {
      setStatus('Somente administradores podem consultar o mapa funcional.', true);
      return;
    }

    state.loading = true;
    setStatus(`Carregando ${branch.toUpperCase()}...`);
    try {
      const { data, error } = await client.functions.invoke('functional-map', {
        body: { action: 'get', branch, username: user.user, password: user.pass }
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const rows = parseCsv(data?.csv || '');
      if (!rows.length) throw new Error('O CSV retornado está vazio ou inválido.');
      state.rowsByBranch.set(branch, rows);
      state.updatedAtByBranch.set(branch, data?.updatedAt || '');
      state.area = '';
      state.tag = '';
      const search = document.getElementById('functionalSearch');
      if (search) search.value = state.search;
      const when = data?.updatedAt ? new Date(data.updatedAt).toLocaleString('pt-BR') : 'agora';
      setStatus(`${branch.toUpperCase()} · ${rows.length} itens · atualizado ${when}`);
      render();
    } catch (error) {
      console.warn('[Lux Play] Falha ao carregar mapa funcional.', error);
      setStatus(error?.message || 'Não foi possível carregar o mapa funcional.', true);
    } finally {
      state.loading = false;
    }
  }

  function open() {
    if (!ensureAdminUi()) return;
    loadBranch(state.branch);
  }

  function install() {
    if (!ensureAdminUi()) return false;
    return true;
  }

  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (install() || attempts >= 120) clearInterval(timer);
  }, 100);
  install();

  window.LuxFunctionalities = {
    version: '20260914-functionalities1',
    open,
    loadBranch,
    refresh: () => loadBranch(state.branch, true),
  };
})();
