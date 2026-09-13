(() => {
  'use strict';
  if (window.__luxSportsAdminInstalled === '20260913-shields-admin1') return;
  window.__luxSportsAdminInstalled = '20260913-shields-admin1';

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state = { rows: [], control: null, query: '', loading: false, editing: null };
  let searchTimer = null;

  function credentials() {
    try {
      if (!currentUser || currentUser.role !== 'admin') return { username:'', password:'' };
      return { username: currentUser.user || '', password: currentUser.pass || '' };
    } catch (_) {
      return { username:'', password:'' };
    }
  }

  async function invoke(body) {
    let client;
    try { client = supabaseClient; } catch (_) { throw new Error('Conexão indisponível.'); }
    if (!client?.functions?.invoke) throw new Error('Conexão indisponível.');
    const { data, error } = await client.functions.invoke('team-logo-cache', { body });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function sourceLabel(source) {
    const value = String(source || '').toLowerCase();
    if (value === 'admin') return 'Manual · Admin';
    if (value === 'footylogos') return 'FootyLogos';
    if (value === 'logodetimes') return 'LogoDeTimes';
    if (value === 'escudosfc') return 'EscudosFC';
    return source || 'Automático';
  }

  function ensureUi() {
    const modal = document.getElementById('adminModal');
    if (!modal) return false;
    const firstTab = modal.querySelector('.admin-tab-btn');
    const tabs = firstTab?.parentElement;
    if (!tabs) return false;

    let button = tabs.querySelector('[data-admin-tab="sports"]');
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.dataset.adminTab = 'sports';
      button.className = 'admin-tab-btn bg-[#180f29] text-purple-200 hover:bg-[#23153b] px-3 py-2 rounded-xl text-[11px] font-bold';
      button.textContent = 'Esportes';
      tabs.appendChild(button);
    }
    button.dataset.luxSportsAdminOwned = '1';
    button.onclick = () => {
      try { if (typeof switchAdminTab === 'function') switchAdminTab('sports'); } catch (_) {}
      render();
      search(state.query, true);
    };

    let panel = document.getElementById('adminTabSports');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'adminTabSports';
      panel.className = 'admin-tab-panel hidden overflow-y-auto pr-1';
      const anyPanel = modal.querySelector('.admin-tab-panel');
      (anyPanel?.parentElement || modal).appendChild(panel);
    }
    panel.dataset.luxSportsAdminOwned = '1';
    return true;
  }

  function formatDate(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return '—';
    return d.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
  }

  function renderRows() {
    const panel = document.getElementById('adminTabSports');
    const root = panel?.querySelector('#sportsShieldResults');
    if (!root) return;

    if (state.loading) {
      root.innerHTML = '<div class="rounded-2xl border border-purple-900/50 bg-[#180f29] p-5 text-xs text-purple-300">Buscando escudos...</div>';
      return;
    }

    if (!state.rows.length) {
      root.innerHTML = '<div class="rounded-2xl border border-purple-900/50 bg-[#180f29] p-5 text-xs text-purple-400">Nenhum escudo global encontrado. Você pode cadastrar manualmente acima.</div>';
      return;
    }

    root.innerHTML = state.rows.map(row => {
      const ready = row.status === 'ready' && row.logo_url;
      const preview = ready
        ? `<img src="${esc(row.logo_url)}" alt="" class="h-12 w-12 object-contain" referrerpolicy="no-referrer" onerror="this.classList.add('hidden');this.nextElementSibling.classList.remove('hidden')"><span class="hidden h-12 w-12 items-center justify-center rounded-xl border border-purple-800/60 bg-purple-950/50 text-purple-300">🛡️</span>`
        : '<span class="flex h-12 w-12 items-center justify-center rounded-xl border border-purple-800/60 bg-purple-950/50 text-purple-300">🛡️</span>';
      return `<article class="rounded-2xl border border-purple-900/50 bg-[#180f29] p-4">
        <div class="flex flex-col gap-3 md:flex-row md:items-center">
          <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-purple-900/50 bg-[#100a1c]">${preview}</div>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <strong class="text-sm text-white">${esc(row.display_name || row.team_key)}</strong>
              <span class="rounded-full px-2 py-1 text-[9px] font-bold ${row.source === 'admin' ? 'bg-emerald-950/70 text-emerald-300' : 'bg-purple-950 text-purple-300'}">${esc(sourceLabel(row.source))}</span>
              ${row.status === 'missing' ? '<span class="rounded-full bg-amber-950/70 px-2 py-1 text-[9px] font-bold text-amber-300">Não encontrado</span>' : ''}
            </div>
            <p class="mt-1 truncate text-[10px] text-purple-400">${ready ? esc(row.logo_url) : 'Sem URL válida no momento'}</p>
            <p class="mt-1 text-[9px] text-purple-500">Atualizado: ${esc(formatDate(row.updated_at))}</p>
          </div>
          <div class="flex shrink-0 gap-2">
            <button type="button" data-shield-edit="${esc(row.team_key)}" class="rounded-xl border border-purple-700/60 px-3 py-2 text-[10px] font-bold text-purple-200 hover:bg-purple-950/60">Editar</button>
            <button type="button" data-shield-rediscover="${esc(row.team_key)}" class="rounded-xl border border-amber-800/60 px-3 py-2 text-[10px] font-bold text-amber-300 hover:bg-amber-950/30">Redescobrir</button>
          </div>
        </div>
      </article>`;
    }).join('');

    root.querySelectorAll('[data-shield-edit]').forEach(button => button.addEventListener('click', () => {
      const row = state.rows.find(item => item.team_key === button.dataset.shieldEdit);
      if (!row) return;
      state.editing = row.team_key;
      const team = panel.querySelector('#sportsShieldTeam');
      const url = panel.querySelector('#sportsShieldUrl');
      if (team) team.value = row.display_name || row.team_key;
      if (url) url.value = row.logo_url || '';
      panel.querySelector('#sportsShieldEditor')?.scrollIntoView({ behavior:'smooth', block:'nearest' });
      setStatus(`Editando ${row.display_name || row.team_key}.`);
    }));

    root.querySelectorAll('[data-shield-rediscover]').forEach(button => button.addEventListener('click', async () => {
      const row = state.rows.find(item => item.team_key === button.dataset.shieldRediscover);
      if (!row) return;
      if (!confirm(`Remover o escudo global de “${row.display_name || row.team_key}” e deixar o Lux pesquisar novamente?`)) return;
      button.disabled = true;
      try {
        const creds = credentials();
        const data = await invoke({ action:'admin_delete', ...creds, team_key:row.team_key });
        state.control = data.control || state.control;
        await window.LuxSportsLogos?.syncControl?.();
        await search(state.query, true);
        setStatus('Entrada removida. O próximo uso desse time fará uma nova descoberta.');
      } catch (error) {
        button.disabled = false;
        setStatus(error?.message || 'Não foi possível remover o escudo.', true);
      }
    }));
  }

  function setStatus(message, error = false) {
    const el = document.getElementById('sportsShieldStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = `min-h-[18px] text-xs ${error ? 'text-rose-300' : 'text-purple-300'}`;
  }

  function renderControl() {
    const el = document.getElementById('sportsShieldVersion');
    if (!el) return;
    const version = Number(state.control?.version || 0);
    el.textContent = version ? `Versão global ${version} · ${formatDate(state.control?.updated_at)}` : 'Versão global carregando...';
  }

  function render() {
    if (!ensureUi()) return;
    const panel = document.getElementById('adminTabSports');
    if (!panel) return;

    const oldSearch = panel.querySelector('#sportsShieldSearch')?.value ?? state.query;
    const oldTeam = panel.querySelector('#sportsShieldTeam')?.value ?? '';
    const oldUrl = panel.querySelector('#sportsShieldUrl')?.value ?? '';

    panel.innerHTML = `
      <div class="space-y-4">
        <section class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-base font-bold text-white">Esportes</h3>
              <div class="mt-2 inline-flex rounded-xl border border-purple-900/60 bg-[#180f29] p-1">
                <span class="rounded-lg bg-purple-600 px-3 py-1.5 text-[11px] font-bold text-white">Escudos</span>
              </div>
              <p class="mt-3 text-xs text-purple-300">Gerencie o cache global de escudos. Correções manuais têm prioridade sobre a descoberta automática.</p>
              <p id="sportsShieldVersion" class="mt-1 text-[10px] text-purple-500">Versão global carregando...</p>
            </div>
            <button id="sportsShieldBump" type="button" class="rounded-xl border border-amber-700/60 bg-amber-950/30 px-4 py-2.5 text-xs font-bold text-amber-200 hover:bg-amber-900/30">Atualizar caches dos usuários</button>
          </div>
          <p id="sportsShieldStatus" class="mt-3 min-h-[18px] text-xs text-purple-300"></p>
        </section>

        <section id="sportsShieldEditor" class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
          <h4 class="text-sm font-bold text-white">Adicionar ou corrigir escudo</h4>
          <p class="mt-1 text-xs text-purple-400">Cole uma URL HTTPS de imagem. O servidor valida a imagem antes de publicar para todos.</p>
          <div class="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[0.8fr_1.8fr_auto_auto]">
            <input id="sportsShieldTeam" value="${esc(oldTeam)}" placeholder="Nome do time · ex.: Elche" class="rounded-xl border border-purple-800/60 bg-[#180f29] px-3 py-2.5 text-xs text-white outline-none focus:border-purple-500">
            <input id="sportsShieldUrl" value="${esc(oldUrl)}" placeholder="https://.../escudo.svg" class="rounded-xl border border-purple-800/60 bg-[#180f29] px-3 py-2.5 text-xs text-white outline-none focus:border-purple-500">
            <button id="sportsShieldPreview" type="button" class="rounded-xl border border-purple-700/60 px-4 py-2.5 text-xs font-bold text-purple-200 hover:bg-purple-950/50">Prévia</button>
            <button id="sportsShieldSave" type="button" class="rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-emerald-500">Salvar global</button>
          </div>
          <div id="sportsShieldPreviewBox" class="mt-3 hidden items-center gap-3 rounded-2xl border border-purple-900/50 bg-[#180f29] p-3">
            <div class="flex h-16 w-16 items-center justify-center rounded-xl bg-[#100a1c]"><img id="sportsShieldPreviewImg" alt="" class="max-h-14 max-w-14 object-contain" referrerpolicy="no-referrer"></div>
            <span class="text-xs text-purple-300">Prévia local da URL informada.</span>
          </div>
        </section>

        <section class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
          <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div><h4 class="text-sm font-bold text-white">Biblioteca global</h4><p class="mt-1 text-xs text-purple-400">Pesquise pelo nome do time para revisar ou trocar o escudo salvo.</p></div>
            <div class="flex w-full gap-2 md:w-[420px]">
              <input id="sportsShieldSearch" value="${esc(oldSearch)}" placeholder="Buscar time..." class="min-w-0 flex-1 rounded-xl border border-purple-800/60 bg-[#180f29] px-3 py-2.5 text-xs text-white outline-none focus:border-purple-500">
              <button id="sportsShieldSearchBtn" type="button" class="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-500">Buscar</button>
            </div>
          </div>
          <div id="sportsShieldResults" class="mt-4 space-y-2"></div>
        </section>
      </div>`;

    renderControl();
    renderRows();

    panel.querySelector('#sportsShieldSearchBtn')?.addEventListener('click', () => search(panel.querySelector('#sportsShieldSearch')?.value || '', true));
    panel.querySelector('#sportsShieldSearch')?.addEventListener('input', event => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => search(event.target.value || '', false), 350);
    });
    panel.querySelector('#sportsShieldSearch')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') search(event.currentTarget.value || '', true);
    });

    panel.querySelector('#sportsShieldPreview')?.addEventListener('click', () => {
      const url = panel.querySelector('#sportsShieldUrl')?.value.trim() || '';
      const box = panel.querySelector('#sportsShieldPreviewBox');
      const img = panel.querySelector('#sportsShieldPreviewImg');
      if (!url || !box || !img) return;
      img.src = url;
      box.classList.remove('hidden');
      box.classList.add('flex');
      img.onerror = () => setStatus('Essa URL não carregou como imagem no navegador.', true);
      img.onload = () => setStatus('Prévia carregada. Salve para publicar globalmente.');
    });

    panel.querySelector('#sportsShieldSave')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      const team = panel.querySelector('#sportsShieldTeam')?.value.trim() || '';
      const url = panel.querySelector('#sportsShieldUrl')?.value.trim() || '';
      if (!team || !url) return setStatus('Informe o nome do time e a URL do escudo.', true);
      button.disabled = true;
      setStatus(`Validando e salvando ${team}...`);
      try {
        const creds = credentials();
        const data = await invoke({ action:'admin_set', ...creds, team, url });
        state.control = data.control || state.control;
        state.editing = null;
        await window.LuxSportsLogos?.syncControl?.();
        await search(team, true);
        setStatus(`${team} atualizado globalmente. Os dispositivos vão renovar o cache de escudos na próxima abertura.`);
      } catch (error) {
        setStatus(error?.message || 'Não foi possível salvar o escudo.', true);
      } finally {
        button.disabled = false;
      }
    });

    panel.querySelector('#sportsShieldBump')?.addEventListener('click', async event => {
      if (!confirm('Forçar todos os dispositivos a renovar somente o cache de escudos na próxima abertura do Lux?')) return;
      const button = event.currentTarget;
      button.disabled = true;
      setStatus('Publicando nova versão do cache de escudos...');
      try {
        const creds = credentials();
        const data = await invoke({ action:'admin_bump', ...creds });
        state.control = data.control || state.control;
        renderControl();
        await window.LuxSportsLogos?.syncControl?.();
        setStatus('Atualização publicada. Na próxima abertura, os usuários vão limpar somente o cache de escudos e carregar os dados novos.');
      } catch (error) {
        setStatus(error?.message || 'Não foi possível publicar a atualização.', true);
      } finally {
        button.disabled = false;
      }
    });

    try { window.lucide?.createIcons?.(); } catch (_) {}
  }

  async function search(query = '', force = false) {
    state.query = String(query || '').trim();
    if (state.loading && !force) return;
    state.loading = true;
    renderRows();
    try {
      const creds = credentials();
      const data = await invoke({ action:'admin_search', ...creds, query:state.query });
      state.rows = Array.isArray(data.rows) ? data.rows : [];
      state.control = data.control || state.control;
      renderControl();
    } catch (error) {
      state.rows = [];
      setStatus(error?.message || 'Não foi possível carregar a biblioteca de escudos.', true);
    } finally {
      state.loading = false;
      renderRows();
    }
  }

  function boot() {
    if (!ensureUi()) {
      let tries = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (ensureUi() || tries > 120) clearInterval(timer);
      }, 250);
    }
    render();
  }

  window.LuxSportsAdmin = { render, search: query => search(query, true) };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once:true });
  else boot();
})();