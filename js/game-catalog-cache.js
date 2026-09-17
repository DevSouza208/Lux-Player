(() => {
  'use strict';

  const VERSION = '20260917-game-catalog-cache4';
  const DB_NAME = 'lux-game-catalog-cache';
  const STORE = 'catalogs';
  const DB_VERSION = 1;
  const FIRST_BOOT_KEY = 'lux-play:catalog-first-bootstrap:v2';
  const CACHE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

  if (window.__luxGameCatalogCacheVersion === VERSION) return;
  window.__luxGameCatalogCacheVersion = VERSION;
  let dbPromise = null, refreshPromise = null, firstBootRunning = false;
  const readUser = () => { try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; } };
  const profileKey = () => { const u=readUser(); if(!u)return 'guest'; return `${String(u.user||u.id||'account').toLowerCase()}|${String(u.profile?.data_key||u.profile?.slot||'1')}|${String(u.role||'user').toLowerCase()}`; };
  const firstBootKey = () => `${FIRST_BOOT_KEY}:${profileKey()}`;

  function openDb(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>{dbPromise=null;reject(r.error);};});return dbPromise;}
  async function tx(mode,operation){const db=await openDb();return new Promise((resolve,reject)=>{const t=db.transaction(STORE,mode),r=operation(t.objectStore(STORE));t.oncomplete=()=>resolve(r?.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('Cache interrompido.'));});}
  async function readCache(){try{const r=await tx('readonly',s=>s.get(profileKey()));if(!r||!Array.isArray(r.rows)||!r.rows.length)return null;if(Date.now()-Number(r.updatedAt||0)>CACHE_MAX_AGE)return null;return r;}catch(_){return null;}}
  async function writeCache(rows){if(!Array.isArray(rows)||!rows.length)return;await tx('readwrite',s=>s.put({key:profileKey(),rows,updatedAt:Date.now()}));console.info('[Lux Games] Catálogo salvo em cache local.',{games:rows.length});}
  const applyRows=rows=>{const filtered=(Array.isArray(rows)?rows:[]).filter(game=>{try{return typeof profileAllowsMedia==='function'?profileAllowsMedia(game):true;}catch(_){return true;}});try{gamesCatalog=filtered;}catch(_){}return filtered;};

  async function refreshFromServer(original,thisArg,args){if(refreshPromise)return refreshPromise;refreshPromise=Promise.resolve().then(()=>original.apply(thisArg,args)).then(async rows=>{const source=Array.isArray(rows)?rows:(typeof gamesCatalog!=='undefined'&&Array.isArray(gamesCatalog)?gamesCatalog:[]);if(source.length)await writeCache(source);return source;}).finally(()=>{refreshPromise=null;});return refreshPromise;}
  function installCatalogCache(){const original=window.loadGamesCatalog;if(typeof original!=='function')return false;if(original.__luxGameCatalogCache)return true;const wrapped=async function(...args){const force=args[0]?.force===true||window.__luxForceGameCatalogRefresh===true;if(!force){const cached=await readCache();if(cached?.rows?.length){const rows=applyRows(cached.rows);console.info('[Lux Games] Catálogo carregado do cache local.',{games:rows.length});return rows;}}try{return await refreshFromServer(original,this,args);}catch(error){const cached=await readCache();if(cached?.rows?.length)return applyRows(cached.rows);throw error;}};wrapped.__luxGameCatalogCache=VERSION;wrapped.__luxGameCatalogCacheOriginal=original;try{window.loadGamesCatalog=wrapped;loadGamesCatalog=wrapped;}catch(_){}return true;}

  async function refreshAllCatalogs(options={}){
    window.__luxForceGameCatalogRefresh=true;
    try{
      const jobs=[];
      if(typeof window.loadMediaSourcesInPriority==='function')jobs.push(['media',Promise.resolve().then(()=>window.loadMediaSourcesInPriority())]);
      if(typeof window.loadGamesCatalog==='function')jobs.push(['games',Promise.resolve().then(()=>window.loadGamesCatalog({force:true}))]);
      if(typeof window.loadReadingCatalog==='function')jobs.push(['reading',Promise.resolve().then(()=>window.loadReadingCatalog())]);
      if(typeof window.loadSharedVodCatalog==='function')jobs.push(['vod',Promise.resolve().then(()=>window.loadSharedVodCatalog())]);
      if(!jobs.length) throw new Error('Nenhum carregador de catálogo está disponível.');
      const settled=await Promise.allSettled(jobs.map(([,job])=>job));
      const failures=settled.map((result,i)=>({result,name:jobs[i][0]})).filter(x=>x.result.status==='rejected');
      if(failures.length){
        const error=new Error(`Falha ao baixar ${failures.map(x=>x.name).join(', ')}.`);
        error.catalogFailures=failures;
        throw error;
      }
      try{const section=typeof currentSection!=='undefined'?(currentSection||'home'):'home';if(typeof window.setSection==='function')window.setSection(section);}catch(_){}
      if(!options.silent)console.info('[Lux Play] Catálogos atualizados pelo usuário.');
      return true;
    }finally{window.__luxForceGameCatalogRefresh=false;}
  }

  function findHeaderRefreshButton(){return document.getElementById('headerCatalogRefreshBtn')||document.querySelector('#appHeader button[onclick="reloadUserData()"]');}
  function installHeaderRefresh(){const button=findHeaderRefreshButton();if(!button||button.__luxCatalogRefreshInstalled)return Boolean(button);button.__luxCatalogRefreshInstalled=true;button.title='Recarregar dados e catálogos';button.setAttribute('aria-label','Recarregar dados e catálogos');button.addEventListener('click',async event=>{event.preventDefault();event.stopImmediatePropagation();button.disabled=true;const icon=button.querySelector('svg,i');icon?.classList.add('animate-spin');try{if(typeof window.reloadUserData==='function')await window.reloadUserData();await refreshAllCatalogs();}catch(error){console.warn('[Lux Play] Falha ao atualizar catálogos.',error);}finally{button.disabled=false;icon?.classList.remove('animate-spin');}},true);return true;}

  function createFirstAccessGate(){
    document.getElementById('luxFirstCatalogNotice')?.remove();
    const overlay=document.createElement('div');
    overlay.id='luxFirstCatalogNotice';
    overlay.className='fixed inset-0 z-[99999] flex items-center justify-center bg-black/90 p-4';
    overlay.innerHTML=`<div class="w-full max-w-sm rounded-3xl border border-purple-800/60 bg-[#120c1f] p-6 text-center shadow-2xl"><div class="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-600/20 text-2xl">↻</div><h3 class="mt-4 text-lg font-black text-white">Preparando seu primeiro acesso</h3><p id="luxFirstCatalogMessage" class="mt-2 text-sm leading-relaxed text-purple-200">Os catálogos precisam ser baixados antes de abrir o Lux Play. No primeiro acesso isso pode demorar até 1 min.</p><div id="luxFirstCatalogProgress" class="mt-5 flex items-center justify-center gap-2 text-xs font-bold text-purple-300"><span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-purple-400 border-t-transparent"></span> Baixando catálogos...</div><div id="luxFirstCatalogErrorActions" class="mt-5 hidden gap-2"><button id="luxRetryCatalogs" class="flex-1 rounded-xl bg-purple-600 px-4 py-3 text-sm font-black text-white hover:bg-purple-500">Tentar novamente</button><button id="luxOpenWithoutCatalogs" class="flex-1 rounded-xl border border-purple-700 bg-purple-950/60 px-4 py-3 text-sm font-bold text-purple-100 hover:bg-purple-900">Abrir sem catálogo</button></div></div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function setGateLoading(overlay){
    overlay.querySelector('#luxFirstCatalogMessage').textContent='Os catálogos precisam ser baixados antes de abrir o Lux Play. No primeiro acesso isso pode demorar até 1 min.';
    overlay.querySelector('#luxFirstCatalogProgress').innerHTML='<span class="inline-block h-3 w-3 animate-spin rounded-full border-2 border-purple-400 border-t-transparent"></span> Baixando catálogos...';
    overlay.querySelector('#luxFirstCatalogProgress').classList.remove('text-red-300');
    overlay.querySelector('#luxFirstCatalogErrorActions').classList.add('hidden');
    overlay.querySelector('#luxFirstCatalogErrorActions').classList.remove('flex');
  }

  function setGateError(overlay){
    overlay.querySelector('#luxFirstCatalogMessage').textContent='Não foi possível baixar todos os catálogos. Você pode tentar novamente ou, somente por causa deste erro, abrir o app sem o catálogo completo.';
    overlay.querySelector('#luxFirstCatalogProgress').textContent='Falha ao baixar os catálogos.';
    overlay.querySelector('#luxFirstCatalogProgress').classList.add('text-red-300');
    const actions=overlay.querySelector('#luxFirstCatalogErrorActions');actions.classList.remove('hidden');actions.classList.add('flex');
  }

  async function bootstrapFirstLogin(){
    if(firstBootRunning||localStorage.getItem(firstBootKey())==='done')return;
    firstBootRunning=true;
    const overlay=createFirstAccessGate();
    const attempt=async()=>{
      setGateLoading(overlay);
      try{
        await refreshAllCatalogs({silent:true});
        const cache=await readCache();
        if(!cache?.rows?.length)throw new Error('Catálogo de jogos não foi salvo no cache local.');
        localStorage.setItem(firstBootKey(),'done');
        overlay.remove();
        return true;
      }catch(error){
        console.warn('[Lux Play] Primeiro download obrigatório dos catálogos falhou.',error);
        setGateError(overlay);
        return false;
      }
    };
    overlay.querySelector('#luxRetryCatalogs').addEventListener('click',attempt);
    overlay.querySelector('#luxOpenWithoutCatalogs').addEventListener('click',()=>{overlay.remove();});
    await attempt();
    firstBootRunning=false;
  }

  function scheduleFirstLoginBootstrap(){const wait=()=>{const user=readUser();const dashboard=document.getElementById('dashboardScreen');const visible=dashboard&&!dashboard.classList.contains('hidden')&&!dashboard.classList.contains('screen-hidden-down');if(user?.profile&&visible)return setTimeout(bootstrapFirstLogin,100);setTimeout(wait,300);};wait();}

  let attempts=0;const timer=setInterval(()=>{attempts+=1;const a=installCatalogCache(),b=installHeaderRefresh();if((a&&b)||attempts>=240)clearInterval(timer);},50);installCatalogCache();installHeaderRefresh();scheduleFirstLoginBootstrap();
  window.LuxCatalogCache={version:VERSION,refresh:refreshAllCatalogs,read:readCache};
  console.info('[Lux Games] Cache de catálogo v4 ativo; download obrigatório no primeiro login.');
})();
