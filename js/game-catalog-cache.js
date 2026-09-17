(() => {
  'use strict';

  const VERSION = '20260917-game-catalog-split2';
  const DB_NAME = 'lux-game-catalog-cache';
  const STORE = 'catalogs';
  const DB_VERSION = 1;
  const FIRST_BOOT_KEY = 'lux-play:catalog-first-bootstrap:v3';
  const CATALOG_ROOT = 'https://lux-r2-gateway.professorsouza-tech.workers.dev/r2/catalog';
  const SPLIT_ROOT = CATALOG_ROOT + '/games';
  const MANIFEST_URL = SPLIT_ROOT + '/manifest.json';
  const LEGACY_URL = CATALOG_ROOT + '/games-catalog.json';
  const MANIFEST_KEY = 'split:v2:manifest';
  const CONSOLE_KEY_PREFIX = 'split:v2:console:';
  const FETCH_TIMEOUT_MS = 25000;

  if (window.__luxGameCatalogCacheVersion === VERSION) return;
  window.__luxGameCatalogCacheVersion = VERSION;
  let dbPromise = null, refreshPromise = null, firstBootRunning = false;
  const readUser = () => { try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (_) { return null; } };
  const isAdmin = () => String(readUser()?.role || '').trim().toLowerCase() === 'admin';
  const profileKey = () => { const u=readUser(); if(!u)return 'guest'; return [String(u.user||u.id||'account').toLowerCase(),String(u.profile?.data_key||u.profile?.slot||'1'),String(u.role||'user').toLowerCase()].join('|'); };
  const firstBootKey = () => FIRST_BOOT_KEY + ':' + profileKey();

  function normalizeConsole(value){
    const key=String(value||'').trim().toLowerCase().replace(/\s+/g,'').replace(/[^a-z0-9_-]/g,'');
    if(key==='md')return 'megadrive';
    if(key==='ms')return 'mastersystem';
    return key;
  }
  function openDb(){if(!dbPromise)dbPromise=new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,DB_VERSION);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE,{keyPath:'key'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>{dbPromise=null;reject(r.error);};});return dbPromise;}
  async function tx(mode,operation){const db=await openDb();return new Promise((resolve,reject)=>{const t=db.transaction(STORE,mode),r=operation(t.objectStore(STORE));t.oncomplete=()=>resolve(r?.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||new Error('Cache interrompido.'));});}
  async function readRecord(key){try{return await tx('readonly',s=>s.get(key));}catch(_){return null;}}
  async function writeRecord(key,value){await tx('readwrite',s=>s.put({key,...value,updatedAt:Date.now()}));}
  function manifestEntries(manifest){return Array.isArray(manifest?.consoles)?manifest.consoles.map(item=>({id:normalizeConsole(item?.id||item?.console),count:Number(item?.count)||0,file:String(item?.file||'').trim()})).filter(item=>item.id&&item.file):[];}

  async function readCache(){
    const manifest=(await readRecord(MANIFEST_KEY))?.manifest;
    const entries=manifestEntries(manifest);
    if(!entries.length)return null;
    const records=await Promise.all(entries.map(entry=>readRecord(CONSOLE_KEY_PREFIX+entry.id)));
    if(records.some(record=>!record||!Array.isArray(record.rows)))return null;
    return {key:'split',manifest,rows:records.flatMap(record=>record.rows),updatedAt:Math.max(...records.map(record=>Number(record.updatedAt)||0),0)};
  }

  function profileFilter(rows){return (Array.isArray(rows)?rows:[]).filter(game=>{try{return typeof profileAllowsMedia==='function'?profileAllowsMedia(game):true;}catch(_){return true;}});}
  async function applyRows(rows,forceVisibility=false){
    let filtered=profileFilter(rows);
    if(!isAdmin()){
      filtered=filtered.filter(game=>String(game?.status||'approved').toLowerCase()==='approved');
      const visibility=window.LuxGameConsoleVisibility;
      try{if(visibility?.refresh)await visibility.refresh(Boolean(forceVisibility));}catch(_){}
      if(visibility?.isEnabled)filtered=filtered.filter(game=>visibility.isEnabled(normalizeConsole(game?.console)));
    }
    try{gamesCatalog=filtered;}catch(_){}
    return filtered;
  }

  async function fetchJson(url,force=false){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),FETCH_TIMEOUT_MS);
    try{
      const finalUrl=force?url+(url.includes('?')?'&':'?')+'v='+Date.now():url;
      const response=await fetch(finalUrl,{method:'GET',credentials:'omit',cache:force?'no-store':'default',signal:controller.signal});
      if(!response.ok)throw new Error('Catálogo HTTP '+response.status);
      return await response.json();
    }finally{clearTimeout(timer);}
  }

  async function storeSplit(manifest,payloads){
    const entries=manifestEntries(manifest);
    for(let i=0;i<entries.length;i+=1){
      const payload=payloads[i],rows=Array.isArray(payload?.games)?payload.games:[];
      await writeRecord(CONSOLE_KEY_PREFIX+entries[i].id,{console:entries[i].id,generatedAt:payload?.generatedAt||manifest.generatedAt||'',rows});
    }
    await writeRecord(MANIFEST_KEY,{manifest});
  }

  async function downloadSplitCatalog(force=false){
    const manifest=await fetchJson(MANIFEST_URL,force),entries=manifestEntries(manifest);
    if(!entries.length)throw new Error('Manifesto de jogos vazio ou inválido.');
    const payloads=await Promise.all(entries.map(async entry=>{
      const url=entry.file.startsWith('http')?entry.file:SPLIT_ROOT+'/'+entry.file.replace(/^\/+/, '');
      const payload=await fetchJson(url,force);
      if(!Array.isArray(payload?.games))throw new Error('Catálogo de '+entry.id+' inválido.');
      return payload;
    }));
    await storeSplit(manifest,payloads);
    const rows=payloads.flatMap(payload=>payload.games||[]);
    console.info('[Lux Games] Catálogos por console baixados.',{consoles:entries.length,games:rows.length});
    return {manifest,rows};
  }

  async function downloadLegacyCatalog(force=false){
    const payload=await fetchJson(LEGACY_URL,force),rows=Array.isArray(payload?.games)?payload.games:[];
    if(!rows.length)throw new Error('Catálogo legado de jogos vazio.');
    const groups=new Map();
    for(const game of rows){const id=normalizeConsole(game?.console)||'outros';if(!groups.has(id))groups.set(id,[]);groups.get(id).push(game);}
    const generatedAt=payload.generatedAt||new Date().toISOString();
    const entries=[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([id,games])=>({id,count:games.length,file:id+'.json'}));
    const manifest={schemaVersion:2,generatedAt,totalCount:rows.length,consoles:entries,legacyFallback:true};
    const payloads=entries.map(entry=>({schemaVersion:2,generatedAt,console:entry.id,count:groups.get(entry.id).length,games:groups.get(entry.id)}));
    await storeSplit(manifest,payloads);
    console.warn('[Lux Games] Catálogo dividido indisponível; arquivo legado dividido localmente.');
    return {manifest,rows};
  }

  async function downloadPublicCatalog(force=false){
    try{return await downloadSplitCatalog(force);}
    catch(error){console.warn('[Lux Games] Falha no catálogo por console; tentando arquivo legado.',error);return downloadLegacyCatalog(force);}
  }

  async function loadPublicCatalog(force=false){
    if(!force){
      const cached=await readCache();
      if(cached?.rows?.length){console.info('[Lux Games] Catálogo por console carregado do cache local.',{games:cached.rows.length});return applyRows(cached.rows,false);}
    }
    if(refreshPromise)return refreshPromise;
    refreshPromise=downloadPublicCatalog(force).then(result=>applyRows(result.rows,force)).finally(()=>{refreshPromise=null;});
    return refreshPromise;
  }

  function installCatalogCache(){
    const original=window.loadGamesCatalog;
    if(typeof original!=='function')return false;
    if(original.__luxGameCatalogSplit)return true;
    const wrapped=async function(...args){
      const force=args[0]?.force===true||window.__luxForceGameCatalogRefresh===true;
      if(isAdmin()){
        if(force){try{await downloadPublicCatalog(true);}catch(error){console.warn('[Lux Games] Pré-cache público indisponível no Admin.',error);}}
        try{return await original.apply(this,args);}
        catch(error){console.warn('[Lux Games] Fonte administrativa falhou; usando catálogo público.',error);return loadPublicCatalog(force);}
      }
      try{return await loadPublicCatalog(force);}
      catch(error){
        const cached=await readCache();
        if(cached?.rows?.length)return applyRows(cached.rows,false);
        console.warn('[Lux Games] Cloudflare indisponível; tentando fonte original.',error);
        return original.apply(this,args);
      }
    };
    wrapped.__luxGameCatalogSplit=VERSION;
    wrapped.__luxGameCatalogCache=VERSION;
    wrapped.__luxGameCatalogCacheOriginal=original;
    try{window.loadGamesCatalog=wrapped;loadGamesCatalog=wrapped;}catch(_){}
    return true;
  }

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
        if(!cache?.rows?.length)throw new Error('Catálogos de jogos não foram salvos no cache local.');
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
  window.LuxCatalogCache={version:VERSION,refresh:refreshAllCatalogs,refreshGames:()=>loadPublicCatalog(true),prefetchGames:()=>downloadPublicCatalog(true),read:readCache};
  console.info('[Lux Games] Catálogo dividido por console ativo; visibilidade não apaga o cache local.');
})();
