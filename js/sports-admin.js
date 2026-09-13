(() => {
  'use strict';
  if (window.__luxSportsAdminInstalled === '20260912-sportsadmin1') return;
  window.__luxSportsAdminInstalled = '20260912-sportsadmin1';

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

  function bridge() { return window.LuxSportsMapping || null; }
  function channels() { return bridge()?.getChannels?.() || []; }
  function mappings() { return Array.isArray(bridge()?.state?.mappings) ? bridge().state.mappings : []; }
  function families() { return bridge()?.getFamilies?.() || []; }
  function mapByKey() { return new Map(mappings().map(m => [norm(m.broadcaster_key || m.broadcaster_name), m])); }

  function currentCredentials() {
    try { return { username: currentUser?.user || '', password: currentUser?.pass || '' }; }
    catch (_) { return { username:'', password:'' }; }
  }

  async function invoke(body) {
    let client;
    try { client = supabaseClient; } catch (_) { throw new Error('Conexão indisponível.'); }
    const { data, error } = await client.functions.invoke('sports-mappings',{body});
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function exactChannelExists(name) {
    const key = norm(name);
    return channels().some(c => norm(c.name) === key);
  }

  function ensureUi() {
    const modal = document.getElementById('adminModal');
    if (!modal) return false;
    const tabs = modal.querySelector('.admin-tab-btn')?.parentElement;
    if (!tabs) return false;

    let button = tabs.querySelector('[data-admin-tab="sports"]');
    if (button && button.dataset.luxSportsAdminOwned !== '1') {
      const clean = button.cloneNode(true);
      button.replaceWith(clean);
      button = clean;
    }
    if (!button) {
      button = document.createElement('button');
      button.type='button';
      button.dataset.adminTab='sports';
      button.className='admin-tab-btn bg-[#180f29] text-purple-200 hover:bg-[#23153b] px-3 py-2 rounded-xl text-[11px] font-bold';
      button.textContent='Esportes';
      tabs.appendChild(button);
    }
    button.dataset.luxSportsAdminOwned='1';
    button.onclick=()=>{
      try { if (typeof switchAdminTab === 'function') switchAdminTab('sports'); } catch (_) {}
      render();
    };

    let panel = document.getElementById('adminTabSports');
    if (!panel) {
      panel=document.createElement('div');
      panel.id='adminTabSports';
      panel.className='admin-tab-panel hidden overflow-y-auto space-y-4';
      const anyPanel=modal.querySelector('.admin-tab-panel');
      (anyPanel?.parentElement || modal).appendChild(panel);
    }
    panel.dataset.luxSportsAdminOwned='1';
    return true;
  }

  function optionsHtml(selected='', suggestions=[]) {
    const list=channels().slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR'));
    const suggestSet=new Set(suggestions.map(x=>x?.url).filter(Boolean));
    const rows=[];
    if (suggestSet.size) {
      rows.push('<optgroup label="Sugestões pela miniatura">');
      for (const c of list.filter(x=>suggestSet.has(x.url))) rows.push(`<option value="${esc(c.name)}" ${norm(c.name)===norm(selected)?'selected':''}>${esc(c.name)}</option>`);
      rows.push('</optgroup>');
    }
    rows.push('<optgroup label="Todos os canais">');
    for (const c of list) rows.push(`<option value="${esc(c.name)}" ${norm(c.name)===norm(selected)?'selected':''}>${esc(c.name)}</option>`);
    rows.push('</optgroup>');
    return rows.join('');
  }

  function render() {
    if (!ensureUi()) return;
    const panel=document.getElementById('adminTabSports');
    if (!panel) return;

    const byKey=mapByKey();
    const fs=families();
    const pending=fs.filter(f=>{
      const m=byKey.get(norm(f.key || f.name));
      return !m || !exactChannelExists(m.channel_hint);
    });
    const saved=mappings();

    panel.innerHTML=`
      <section class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 class="text-base font-bold text-white">Canais dos esportes</h3>
            <p class="mt-1 text-xs text-purple-300">A validação é global: quando você liga uma emissora a um canal, todos os usuários passam a usar essa escolha.</p>
          </div>
          <button id="sportsMappingsRefresh" type="button" class="rounded-xl bg-purple-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-purple-500">Atualizar</button>
        </div>
        <p id="sportsMappingStatus" class="mt-3 text-xs text-purple-400">${bridge()?.state?.loaded?'Mapeamentos globais sincronizados.':'Carregando mapeamentos...'}</p>
      </section>

      <section class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
        <div class="flex items-center justify-between gap-3">
          <div><h3 class="text-sm font-bold text-white">Pendentes de validação</h3><p class="mt-1 text-xs text-purple-400">Escolha o canal exato que deve abrir para cada emissora detectada no Guia de Jogos.</p></div>
          <span class="rounded-full bg-purple-950 px-2.5 py-1 text-[10px] font-bold text-purple-300">${pending.length}</span>
        </div>
        <div class="mt-4 space-y-3">
          ${pending.length ? pending.map(f=>{
            const old=byKey.get(norm(f.key||f.name));
            const selected=old?.channel_hint || f.candidates?.[0]?.name || '';
            return `<div class="rounded-2xl border border-purple-900/50 bg-[#180f29] p-4">
              <div class="flex flex-wrap items-center justify-between gap-2"><strong class="text-sm text-white">${esc(f.name)}</strong><span class="text-[10px] text-purple-400">${f.count} jogo(s)</span></div>
              <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                <select data-sports-map-select="${esc(f.name)}" class="min-w-0 flex-1 rounded-xl border border-purple-800/60 bg-[#120c1f] px-3 py-2 text-xs text-white focus:border-purple-500 focus:outline-none">
                  <option value="">Selecione o canal correto...</option>
                  ${optionsHtml(selected,f.candidates||[])}
                </select>
                <button type="button" data-sports-map-save="${esc(f.name)}" class="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-500">Validar</button>
              </div>
            </div>`;
          }).join('') : '<p class="rounded-2xl border border-emerald-800/40 bg-emerald-950/20 p-4 text-xs text-emerald-300">Tudo resolvido por enquanto. ✨</p>'}
        </div>
      </section>

      <section class="rounded-3xl border border-purple-900/60 bg-[#120c1f] p-5">
        <h3 class="text-sm font-bold text-white">Mapeamentos globais</h3>
        <p class="mt-1 text-xs text-purple-400">Essas escolhas ficam no Supabase e valem para todos os clientes/dispositivos.</p>
        <div class="mt-4 space-y-2">
          ${saved.length ? saved.map(m=>`<div class="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-purple-900/50 bg-[#180f29] px-4 py-3">
            <div class="min-w-0"><strong class="block text-xs text-white">${esc(m.broadcaster_name)}</strong><span class="block truncate text-[11px] ${exactChannelExists(m.channel_hint)?'text-emerald-300':'text-amber-300'}">→ ${esc(m.channel_hint)}${exactChannelExists(m.channel_hint)?'':' · canal não encontrado nesta lista'}</span></div>
            <button type="button" data-sports-map-delete="${esc(m.broadcaster_key || m.broadcaster_name)}" class="rounded-lg border border-rose-800/60 px-3 py-1.5 text-[10px] font-bold text-rose-300 hover:bg-rose-950/40">Remover</button>
          </div>`).join('') : '<p class="text-xs text-purple-500">Nenhum mapeamento salvo.</p>'}
        </div>
      </section>`;

    panel.querySelector('#sportsMappingsRefresh')?.addEventListener('click',async()=>{
      const status=panel.querySelector('#sportsMappingStatus');
      if(status) status.textContent='Atualizando...';
      await bridge()?.refresh?.();
      render();
    });

    panel.querySelectorAll('[data-sports-map-save]').forEach(button=>button.addEventListener('click',async()=>{
      const source=button.dataset.sportsMapSave;
      const select=panel.querySelector(`[data-sports-map-select="${CSS.escape(source)}"]`);
      const hint=select?.value || '';
      if(!source||!hint) return;
      const status=panel.querySelector('#sportsMappingStatus');
      button.disabled=true;
      if(status) status.textContent=`Salvando ${source} → ${hint}...`;
      try {
        const creds=currentCredentials();
        const data=await invoke({action:'save',...creds,broadcaster_name:source,channel_hint:hint});
        if(Array.isArray(data.mappings)) bridge().state.mappings=data.mappings;
        await bridge()?.refresh?.();
        render();
      } catch(error) {
        button.disabled=false;
        if(status) status.textContent=error?.message || 'Não foi possível salvar.';
      }
    }));

    panel.querySelectorAll('[data-sports-map-delete]').forEach(button=>button.addEventListener('click',async()=>{
      const key=button.dataset.sportsMapDelete;
      const status=panel.querySelector('#sportsMappingStatus');
      try {
        const creds=currentCredentials();
        const data=await invoke({action:'delete',...creds,broadcaster_key:key});
        if(Array.isArray(data.mappings)) bridge().state.mappings=data.mappings;
        await bridge()?.refresh?.();
        render();
      } catch(error) {
        if(status) status.textContent=error?.message || 'Não foi possível remover.';
      }
    }));
  }

  function boot() {
    ensureUi();
    render();
    let tries=0;
    const timer=setInterval(()=>{
      tries++;
      ensureUi();
      if(window.LuxSports?.state?.loaded) render();
      if(tries>240) clearInterval(timer);
    },250);
    window.addEventListener('lux:sports-mapping-ready',render);
    window.addEventListener('lux:sports-mappings',render);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();