(() => {
  'use strict';
  if (window.__luxSportsGlobalMappingInstalled === '20260913-map2') return;
  window.__luxSportsGlobalMappingInstalled = '20260913-map2';

  const GROUP_RE = /(guia\s+de\s+jogos|jogos\s+do\s+dia)/i;
  const QUALITY_RE = /\b(?:fhd|full\s*hd|hd|sd|uhd|4k|8k|hevc|h265|h264|60fps|50fps)\b/gi;
  const state = { mappings: [], busy: false, loaded: false, last: 0, observer: null };
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' e ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  const logoKey = v => String(v || '').trim().replace(/[?#].*$/, '').toLowerCase();

  const FOOTY = new Map(Object.entries({
    'santos':'santos-fc','santos fc':'santos-fc','sao paulo':'sao-paulo','sao paulo fc':'sao-paulo','spfc':'sao-paulo',
    'bragantino':'rb-bragantino','rb bragantino':'rb-bragantino','red bull bragantino':'rb-bragantino',
    'atletico mg':'atletico-mineiro','atletico mineiro':'atletico-mineiro','athletico pr':'athletico-paranaense',
    'athletico paranaense':'athletico-paranaense','internacional':'sc-internacional','vasco':'vasco-da-gama',
    'vasco da gama':'vasco-da-gama','flamengo':'flamengo-crf','mirassol':'mirassol-fc','remo':'clube-de-remo',
    'ceara':'ceara-sc','sport':'sport-recife','celta':'celta-vigo','coventry':'coventry-city',
    'brighton':'brighton-hove-albion','psg':'paris-saint-germain-psg','paris saint germain':'paris-saint-germain-psg',
    'liverpool':'liverpool-fc','bayern de munique':'bayern-munich',
    'fc dallas':'fc-dallas','portland timbers':'portland-timbers','st louis city sc':'st-louis-city-sc',
    'minnesota united fc':'minnesota-united','minnesota united':'minnesota-united','monterrey':'monterrey',
    'tigres uanl':'tigres-uanl','colorado rapids':'colorado-rapids','cf montreal':'cf-montreal'
  }));

  function allLive() {
    try { return (Array.isArray(allMediaItems) ? allMediaItems : []).filter(x => x?.type === 'live' && x?.url && x?.name); }
    catch (_) { return []; }
  }
  function normalChannels() { return allLive().filter(x => !GROUP_RE.test(String(x?.group || ''))); }

  function familyName(name) {
    return String(name || '')
      .replace(/^\s*(?:BR|BRA|BRASIL)\s*(?:[|:>-]\s*)?/i,'')
      .replace(/\[[^\]]*(?:h265|hevc|fhd|hd|sd|4k|uhd)[^\]]*\]/gi,'')
      .replace(QUALITY_RE,'')
      .replace(/\s+(?:0?\d{1,2}|[IVX]{1,4})$/i,'')
      .replace(/\s+/g,' ').trim();
  }
  function mapByKey() { return new Map(state.mappings.map(m => [norm(m.broadcaster_key || m.broadcaster_name), m])); }

  function identity(channel) {
    if (!channel) return { key:'', name:'Transmissão', candidates:[], mapping:null };
    const lk = logoKey(channel.logo || channel.item?.logo);
    const candidates = lk ? normalChannels().filter(c => logoKey(c.logo) === lk) : [];
    const mappings = mapByKey();

    for (const c of candidates) {
      const m = state.mappings.find(x => norm(x.channel_hint) === norm(c.name));
      if (m) return { key:norm(m.broadcaster_key || m.broadcaster_name), name:m.broadcaster_name, candidates, mapping:m };
    }

    if (candidates.length) {
      const counts = new Map();
      for (const c of candidates) {
        const name = familyName(c.name), key = norm(name);
        if (!key) continue;
        const row = counts.get(key) || { key, name, count:0 };
        row.count++;
        counts.set(key,row);
      }
      const best=[...counts.values()].sort((a,b)=>b.count-a.count || a.name.length-b.name.length)[0];
      if (best) return { ...best, candidates, mapping:mappings.get(best.key) || null };
    }

    const raw = String(channel.label || '').trim();
    if (raw && !/^(assistir|transmiss[aã]o\s*\d*|sinal\s*\d*)$/i.test(raw)) {
      const key=norm(raw);
      return { key, name:raw, candidates, mapping:mappings.get(key) || null };
    }
    return { key:'', name:raw || 'Transmissão', candidates, mapping:null };
  }

  function mappedTarget(channel) {
    const id = identity(channel);
    if (!id.mapping?.channel_hint) return { target:null, identity:id };
    const wanted=norm(id.mapping.channel_hint);
    const channels=normalChannels();
    const exact=channels.find(c=>norm(c.name)===wanted);
    if (exact) return { target:exact, identity:id };
    const fuzzy=channels.find(c=>norm(c.name).includes(wanted) || wanted.includes(norm(c.name)));
    return { target:fuzzy || null, identity:id };
  }

  function families() {
    const games=window.LuxSports?.state?.games || [];
    const rows=new Map();
    for (const game of games) {
      const seen=new Set();
      for (const channel of game.channels || []) {
        const id=identity(channel);
        if(!id.key || seen.has(id.key)) continue;
        seen.add(id.key);
        if(!rows.has(id.key)) rows.set(id.key,{key:id.key,name:id.name,count:0,candidates:[],mapping:id.mapping||null});
        const row=rows.get(id.key); row.count++;
        for(const c of id.candidates||[]) if(!row.candidates.some(x=>x.url===c.url)) row.candidates.push(c);
        row.mapping=id.mapping||row.mapping;
      }
    }
    return [...rows.values()].sort((a,b)=>b.count-a.count || a.name.localeCompare(b.name,'pt-BR'));
  }

  function teamSlug(name) {
    const full=norm(name).replace(/\b(?:da|de|do|das|dos)\b/g,' ').replace(/\s+/g,' ').trim();
    const simplified=full.replace(/\b(?:clube|club|futebol|football|fc|sc|ec|ac|cf|saf)\b/g,' ').replace(/\s+/g,' ').trim();
    return FOOTY.get(full) || FOOTY.get(simplified) || full.replace(/\s+/g,'-');
  }
  function footyUrl(name) {
    const slug=teamSlug(name);
    return slug ? `https://assets.footylogos.com/logos/${slug}/${slug}-logo-footylogos.svg` : '';
  }

  function gameForCard(card) {
    const id=card.querySelector('[data-game]')?.dataset.game;
    if(id) return (window.LuxSports?.state?.games || []).find(g=>g.id===id) || null;
    const text=norm(card.textContent);
    return (window.LuxSports?.state?.games || []).find(g=>text.includes(norm(g.home)) && text.includes(norm(g.away))) || null;
  }

  function decorateCard(card) {
    const game=gameForCard(card);
    if(!game) return;

    const grid=card.children?.[1];
    if(grid?.children?.length>=3) {
      [[grid.children[0],game.home,game.home_logo],[grid.children[2],game.away,game.away_logo]].forEach(([teamBox,name,existing])=>{
        if(existing || teamBox.querySelector('[data-team-logo],[data-footy-logo]')) return;
        const holder=teamBox.querySelector('div');
        if(!holder) return;
        const url=footyUrl(name);
        if(!url) return;
        const img=document.createElement('img');
        img.dataset.footyLogo='1';
        img.src=url; img.alt=name; img.loading='lazy'; img.referrerPolicy='no-referrer';
        img.className='h-9 w-9 object-contain';
        img.onload=()=>holder.querySelector('[data-shield-fallback]')?.classList.add('hidden');
        img.onerror=()=>img.remove();
        holder.prepend(img);
      });
      const footer=card.lastElementChild;
      if(footer && !/footylogos/i.test(footer.textContent||'')) footer.textContent=(footer.textContent||'')+' · escudos: FootyLogos';
    }

    card.querySelectorAll('[data-channel]').forEach(btn=>{
      const index=Number(btn.dataset.channel);
      const channel=game.channels?.[index];
      if(!channel) return;
      const {target,identity:id}=mappedTarget(channel);
      if(!id.key) return;
      btn.dataset.sportsBroadcaster=id.name;
      if(target) {
        btn.dataset.sportsMapped='1';
        const span=btn.querySelector('span:last-child');
        if(span) span.textContent=id.mapping?.broadcaster_name || id.name;
        if(!btn.querySelector('[data-global-map-badge]')) {
          const badge=document.createElement('span');
          badge.dataset.globalMapBadge='1';
          badge.className='rounded bg-emerald-500/20 px-1 py-0.5 text-[8px] text-emerald-300';
          badge.textContent='✓';
          btn.appendChild(badge);
        }
      }
    });
  }

  function decorate() {
    document.querySelectorAll('#homeJogosContainer [data-sports-guide-card]').forEach(decorateCard);
  }

  async function load(force=false) {
    if(state.busy || (!force && Date.now()-state.last<45000)) return state.mappings;
    let client; try { client=supabaseClient; } catch (_) { return state.mappings; }
    if(!client?.functions?.invoke) return state.mappings;
    state.busy=true;
    try {
      const {data,error}=await client.functions.invoke('sports-mappings',{body:{action:'list'}});
      if(error) throw error;
      if(Array.isArray(data?.mappings)) {
        state.mappings=data.mappings; state.loaded=true; state.last=Date.now();
        decorate();
        window.dispatchEvent(new CustomEvent('lux:sports-mappings',{detail:{mappings:state.mappings}}));
      }
    } catch(e) { console.warn('[Lux Sports] Falha ao carregar mapeamentos globais.',e); }
    finally { state.busy=false; }
    return state.mappings;
  }

  document.addEventListener('click',event=>{
    const btn=event.target.closest?.('#homeJogosContainer [data-sports-guide-card] [data-channel]:not([disabled])');
    if(!btn) return;
    const game=(window.LuxSports?.state?.games || []).find(g=>g.id===btn.dataset.game);
    const channel=game?.channels?.[Number(btn.dataset.channel)];
    const {target}=mappedTarget(channel);
    if(!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      if(typeof setSection==='function') setSection('live');
      setTimeout(()=>{ if(typeof playLiveChannel==='function') playLiveChannel(target); },40);
    } catch(e) { console.warn('[Lux Sports Mapping]',e); }
  },true);

  function boot() {
    load(true);
    decorate();
    const home=document.getElementById('homeJogosContainer');
    if(home) {
      state.observer=new MutationObserver(()=>queueMicrotask(decorate));
      state.observer.observe(home,{childList:true,subtree:true});
    }
    setInterval(()=>load(false),60000);
    window.LuxSportsMapping={state,refresh:()=>load(true),getFamilies:families,getChannels:normalChannels,identity,mappedTarget,decorate};
    window.dispatchEvent(new CustomEvent('lux:sports-mapping-ready'));
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true}); else boot();
})();