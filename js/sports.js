(() => {
  'use strict';
  if (window.__luxSportsInstalled === '20260913-guide-clean1') return;
  window.__luxSportsInstalled = '20260913-guide-clean1';

  const LEAD = 20 * 60 * 1000;
  const GROUP_RE = /(guia\s+de\s+jogos|jogos\s+do\s+dia)/i;
  const state = { games: [], tab: 'live', loaded: false, signature: '', observer: null };
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/&/g,' e ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();

  function items() {
    try { return (Array.isArray(allMediaItems) ? allMediaItems : []).filter(x => x?.type === 'live' && x?.url && GROUP_RE.test(String(x?.group || ''))); }
    catch (_) { return []; }
  }

  function parse(name) {
    const raw = String(name || '').replace(/\s+/g,' ').trim();
    const m = raw.match(/^(.+?)\s+(?:x|×|vs\.?|v\.)\s+(.+)$/i);
    if (!m) return null;
    let away = m[2].trim(), time = '', label = '';
    const tm = away.match(/^(.*?)(?:\s*[-–—|]\s*|\s+)(\d{1,2}:\d{2})(?:\s+(.*))?$/i);
    if (tm) { away = tm[1].trim(); time = tm[2].padStart(5,'0'); label = String(tm[3] || '').trim(); }
    else {
      const sm = away.match(/^(.*?)(?:\s*[-–—|]\s*|\s+)((?:sinal|op[cç][aã]o|canal|feed)\s*\d*)$/i);
      if (sm) { away = sm[1].trim(); label = sm[2].trim(); }
    }
    const home = m[1].replace(/^[\s|•·⚽🏆📺▶►]+/u,'').trim();
    away = away.replace(/[\s|•·]+$/u,'').trim();
    if (!home || !away) return null;
    label = label.replace(/^sinal\s*(\d+)$/i,(_,n)=>`Sinal ${n}`).replace(/^sinal$/i,'Sinal');
    return { home, away, time, label };
  }

  function group() {
    const map = new Map();
    for (const item of items()) {
      const p = parse(item.name);
      if (!p) continue;
      const key = `${norm(p.home)}|${norm(p.away)}|${p.time || 'sem-hora'}`;
      if (!map.has(key)) map.set(key, {
        id:key, key, home:p.home, away:p.away, time:p.time, date:'', kickoff:'',
        competition:'Futebol', status:'scheduled', score_home:null, score_away:null,
        home_logo:'', away_logo:'', channels:[]
      });
      const g = map.get(key);
      if (!g.channels.some(c => c.item.url === item.url)) {
        g.channels.push({ item, label:p.label, logo:String(item.logo || '').trim() });
      }
    }
    for (const g of map.values()) {
      g.channels.forEach((c,i) => {
        if (!c.label) c.label = g.channels.length > 1 ? `Transmissão ${i+1}` : 'Assistir';
        else if (/^sinal$/i.test(c.label)) c.label = `Sinal ${i+1}`;
      });
    }
    return [...map.values()];
  }

  function dateKey(offset=0) {
    const d = new Date(Date.now()+offset*86400000);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d).map(x=>[x.type,x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }

  function startMs(g) {
    const direct = Date.parse(g.kickoff || '');
    if (Number.isFinite(direct)) return direct;
    if (!g.time) return NaN;
    return Date.parse(`${g.date || dateKey()}T${g.time}:00-03:00`);
  }

  function infer(g) {
    const s = startMs(g);
    if (!Number.isFinite(s)) return 'scheduled';
    const d = Date.now() - s;
    return d < 0 ? 'scheduled' : d <= 155 * 60000 ? 'live' : 'finished';
  }

  function list(tab=state.tab) {
    state.games.forEach(g => { g.status = infer(g); });
    const wanted = tab === 'results' ? 'finished' : tab === 'live' ? 'live' : 'scheduled';
    return state.games
      .filter(g => g.status === wanted)
      .sort((a,b) => {
        const x = startMs(a), y = startMs(b);
        if (!Number.isFinite(x) && !Number.isFinite(y)) return a.home.localeCompare(b.home,'pt-BR');
        if (!Number.isFinite(x)) return 1;
        if (!Number.isFinite(y)) return -1;
        return tab === 'results' ? y - x : x - y;
      });
  }

  function canWatch(g) {
    if (g.status === 'live') return true;
    const s = startMs(g);
    return g.status === 'scheduled' && Number.isFinite(s) && s - Date.now() <= LEAD && s - Date.now() >= -300000;
  }

  function tomorrow(g) { return g.date && g.date === dateKey(1); }
  function badge(g) {
    if (g.status === 'live') return 'AO VIVO';
    if (g.status === 'finished') return 'FIM';
    if (tomorrow(g)) return `AMANHÃ · ${g.time || ''}`;
    return g.time || 'HORÁRIO A CONFIRMAR';
  }
  function unlock(g) {
    const s = startMs(g);
    if (!Number.isFinite(s)) return 'Disponível 20 min antes';
    const t = new Date(s - LEAD).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
    return tomorrow(g) ? `Disponível amanhã às ${t}` : `Disponível às ${t}`;
  }

  const shield = hidden => `<span data-shield-fallback class="${hidden?'hidden ':''}inline-flex h-9 w-9 items-center justify-center rounded-xl border border-purple-800/60 bg-purple-950/60 text-purple-300"><svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3 19 6v5c0 4.8-2.9 8.1-7 10-4.1-1.9-7-5.2-7-10V6l7-3Z"/></svg></span>`;
  function team(name,logo) {
    const img = logo ? `<img data-team-logo src="${esc(logo)}" alt="" class="hidden h-9 w-9 object-contain" loading="lazy" referrerpolicy="no-referrer">` : '';
    return `<div class="min-w-0 flex flex-col items-center gap-2"><div class="flex h-10 items-center">${img}${shield(false)}</div><strong class="max-w-[105px] text-center text-xs text-white">${esc(name)}</strong></div>`;
  }

  const tv = hidden => `<span data-tv-fallback class="${hidden?'hidden ':''}inline-flex h-7 w-7 items-center justify-center rounded-lg border border-purple-800/60 bg-[#120c1f] text-purple-300"><svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="m8 3 4 3 4-3"/></svg></span>`;
  function chip(g,c,i,enabled) {
    const img = c.logo ? `<img data-channel-logo src="${esc(c.logo)}" alt="" class="h-7 w-7 rounded-lg object-contain" loading="lazy" referrerpolicy="no-referrer">` : '';
    return `<button type="button" data-game="${esc(g.id)}" data-channel="${i}" ${enabled?'':'disabled'} class="inline-flex items-center gap-2 rounded-xl border px-2.5 py-1.5 text-[10px] font-bold transition ${enabled?'border-emerald-700/50 bg-emerald-950/30 text-emerald-200 hover:border-emerald-400':'border-purple-900/50 bg-purple-950/30 text-purple-400 opacity-60'}">${img}${tv(Boolean(img))}<span>${esc(c.label)}</span></button>`;
  }

  function tabs() {
    const box = document.getElementById('homeJogosContainer'), section = box?.parentElement;
    if (!box || !section) return;
    let bar = section.querySelector('[data-lux-sports-tabs]');
    if (!bar) {
      bar = document.createElement('div');
      bar.dataset.luxSportsTabs = 'guide-clean1';
      bar.className = 'flex flex-wrap gap-2';
      const h = section.querySelector('h3');
      section.insertBefore(bar, h?.nextSibling || box);
    }
    bar.innerHTML = [['results','Resultados'],['live','Ao vivo'],['upcoming','Próximas partidas']].map(([k,l]) => {
      const a = state.tab === k;
      return `<button data-tab="${k}" class="rounded-xl border px-3 py-2 text-[11px] font-bold ${a&&k==='live'?'border-emerald-400 bg-emerald-500 text-white':a?'border-purple-500 bg-purple-600 text-white':'border-purple-900/60 bg-[#120c1f] text-purple-300'}">${l}<span class="ml-1.5 opacity-70">${list(k).length}</span></button>`;
    }).join('');
    bar.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; render(); });
  }

  function open(item) {
    if (!item) return;
    try {
      if (typeof setSection === 'function') setSection('live');
      setTimeout(() => { if (typeof playLiveChannel === 'function') playLiveChannel(item); }, 40);
    } catch (e) { console.warn('[Lux Sports]',e); }
  }

  function render() {
    const box = document.getElementById('homeJogosContainer');
    if (!box || !state.loaded) return;
    tabs();
    const games = list();
    if (!games.length) {
      box.innerHTML = `<p data-lux-sports-empty class="text-xs text-purple-400/70">${state.tab==='results'?'Nenhum resultado do Guia de Jogos por enquanto.':state.tab==='live'?'Nenhuma partida do Guia de Jogos está ao vivo agora.':'Nenhuma próxima partida encontrada no Guia de Jogos.'}</p>`;
      return;
    }

    box.innerHTML = games.slice(0,state.tab==='upcoming'?24:18).map(g => {
      const live = g.status === 'live', fin = g.status === 'finished', ok = canWatch(g);
      const hasScore = g.score_home !== null && g.score_home !== '' && g.score_away !== null && g.score_away !== '' && Number.isFinite(Number(g.score_home)) && Number.isFinite(Number(g.score_away));
      const score = (live || fin) && hasScore ? `${Number(g.score_home)} × ${Number(g.score_away)}` : '×';
      const border = live ? 'border-emerald-500/60' : fin ? 'border-slate-700/60' : 'border-purple-900/60';
      const tag = live ? 'bg-emerald-500/20 text-emerald-300' : fin ? 'bg-slate-800 text-slate-300' : 'bg-purple-950 text-purple-300';
      const streams = fin ? '' : `<div class="mt-3 flex flex-wrap gap-2 rounded-xl border border-purple-900/50 bg-[#100a1c] px-3 py-2">${g.channels.map((c,i)=>chip(g,c,i,ok)).join('')}</div>${!ok&&g.status==='scheduled'?`<div class="mt-2 text-center text-[10px] text-purple-400">${esc(unlock(g))}</div>`:''}`;
      return `<article data-sports-guide-card class="w-[290px] shrink-0 rounded-2xl border ${border} bg-[#120c1f] p-4"><div class="flex items-center justify-between gap-2"><span class="truncate text-[10px] font-bold uppercase text-purple-300">${esc(g.competition||'Futebol')}</span><span class="rounded-full px-2 py-1 text-[9px] font-black ${tag}">${esc(badge(g))}</span></div><div class="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">${team(g.home,g.home_logo)}<strong class="text-sm ${fin?'text-slate-200':'text-emerald-300'}">${esc(score)}</strong>${team(g.away,g.away_logo)}</div>${streams}<div class="mt-2 text-right text-[9px] text-purple-500">Canais: Guia de Jogos</div></article>`;
    }).join('');

    box.querySelectorAll('[data-team-logo]').forEach(img => {
      img.onload = () => {
        img.classList.remove('hidden');
        img.parentElement?.querySelector('[data-shield-fallback]')?.classList.add('hidden');
      };
      img.onerror = () => img.remove();
    });
    box.querySelectorAll('[data-channel-logo]').forEach(img => img.onerror = () => {
      img.classList.add('hidden');
      img.parentElement?.querySelector('[data-tv-fallback]')?.classList.remove('hidden');
    });
    box.querySelectorAll('[data-channel]:not([disabled])').forEach(b => b.onclick = () => {
      const g = state.games.find(x => x.id === b.dataset.game), i = Number(b.dataset.channel);
      if (g && canWatch(g)) open(g.channels[i]?.item);
    });
  }

  function scan(force=false) {
    const src = items();
    const sig = src.map(x => `${x.name}|${x.url}|${x.logo||''}`).join('\n');
    if (!force && sig === state.signature) return;
    state.signature = sig;
    state.games = group();
    state.loaded = true;
    render();
  }

  function guard() {
    const box = document.getElementById('homeJogosContainer');
    if (!box || state.observer) return;
    state.observer = new MutationObserver(() => {
      if (state.loaded && !box.querySelector('[data-sports-guide-card],[data-lux-sports-empty]')) queueMicrotask(render);
    });
    state.observer.observe(box,{childList:true});
  }

  function start() {
    guard();
    scan(true);
    setInterval(() => scan(false), 2500);
    setInterval(render, 45000);
    window.LuxSports = { state, render, refresh:() => scan(true), guideItems:items, parseGuideTitle:parse };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
