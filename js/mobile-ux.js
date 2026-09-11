(() => {
  'use strict';

  const mobileQuery = window.matchMedia('(max-width: 767px)');
  if (!mobileQuery.matches || window.__luxMobileUxInstalled) return;
  window.__luxMobileUxInstalled = true;
  document.body.classList.add('lux-mobile-ux');

  const $ = (id) => document.getElementById(id);
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  let gameMenu = null;
  let touchStart = null;

  function refreshIcons() { try { window.lucide?.createIcons?.(); } catch (_) {} }
  function overlay(open) { document.body.classList.toggle('lux-mobile-overlay-open', !!open); }

  function closeSheet(sheet) {
    if (!sheet) return;
    sheet.hidden = true;
    overlay(false);
  }

  function createSheet(id, title) {
    let sheet = $(id);
    if (sheet) return sheet;
    sheet = document.createElement('div');
    sheet.id = id;
    sheet.className = 'lux-mobile-sheet';
    sheet.hidden = true;
    sheet.innerHTML = `<div class="lux-mobile-sheet-card" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="lux-mobile-sheet-head"><h2>${title}</h2><button type="button" class="lux-mobile-sheet-close" aria-label="Fechar">✕</button></div>
      <div class="lux-mobile-sheet-body"></div>
    </div>`;
    document.body.appendChild(sheet);
    sheet.querySelector('.lux-mobile-sheet-close').onclick = () => closeSheet(sheet);
    sheet.addEventListener('click', event => { if (event.target === sheet) closeSheet(sheet); });
    return sheet;
  }

  function openGamesFilters() {
    const sheet = createSheet('luxMobileGamesFilters', 'Filtros de jogos');
    const body = sheet.querySelector('.lux-mobile-sheet-body');
    const consoleValue = typeof gamesConsoleFilter !== 'undefined' ? gamesConsoleFilter : 'all';
    const statusValue = typeof gamesStatusFilter !== 'undefined' ? gamesStatusFilter : 'all';
    const favoriteValue = typeof gamesFavoritesOnly !== 'undefined' && gamesFavoritesOnly;
    const isAdmin = currentUser?.role === 'admin';
    body.innerHTML = `<label class="lux-mobile-filter-field">Console<select id="luxMobileGameConsole"><option value="all">Todos os consoles</option><option value="gba">Game Boy Advance</option><option value="gb">Game Boy</option><option value="gbc">Game Boy Color</option><option value="snes">SNES</option><option value="megadrive">Mega Drive</option><option value="nes">NES</option><option value="n64">Nintendo 64</option></select></label>${isAdmin ? `<label class="lux-mobile-filter-field">Status<select id="luxMobileGameStatus"><option value="all">Todos</option><option value="approved">Aprovados</option><option value="pending">Pendentes</option></select></label>` : ''}<button id="luxMobileGameFavorites" type="button" class="lux-mobile-filter-toggle ${favoriteValue ? 'active' : ''}">${icon('heart')} ${favoriteValue ? 'Somente favoritos' : 'Mostrar somente favoritos'}</button><button id="luxMobileGameApply" type="button" class="lux-mobile-sheet-primary">Aplicar filtros</button>`;
    const consoleSelect = $('luxMobileGameConsole'); consoleSelect.value = consoleValue;
    const statusSelect = $('luxMobileGameStatus'); if (statusSelect) statusSelect.value = statusValue;
    let favorite = favoriteValue;
    $('luxMobileGameFavorites').onclick = event => { favorite = !favorite; event.currentTarget.classList.toggle('active', favorite); event.currentTarget.innerHTML = `${icon('heart')} ${favorite ? 'Somente favoritos' : 'Mostrar somente favoritos'}`; refreshIcons(); };
    $('luxMobileGameApply').onclick = () => { if (typeof setGamesFilter === 'function') { setGamesFilter('console', consoleSelect.value); if (statusSelect) setGamesFilter('status', statusSelect.value); if ((typeof gamesFavoritesOnly !== 'undefined' && gamesFavoritesOnly) !== favorite) setGamesFilter('favorites'); } closeSheet(sheet); };
    sheet.hidden = false; overlay(true); refreshIcons();
  }

  function enhanceGamesSection() {
    const section = $('gamesSection'); if (!section || section.classList.contains('hidden')) return;
    const root = section.firstElementChild; if (!root) return;
    const head = root.querySelector(':scope > div.flex.items-center.justify-between'); if (!head) return;
    head.classList.add('lux-mobile-games-head');
    const filters = head.children[1]; if (filters && !filters.classList.contains('lux-mobile-original-filters')) filters.classList.add('lux-mobile-original-filters');
    if (!head.querySelector('.lux-mobile-filter-button')) { const button = document.createElement('button'); button.type='button'; button.className='lux-mobile-filter-button'; button.innerHTML=`${icon('sliders-horizontal')} Filtros`; button.onclick=openGamesFilters; head.appendChild(button); refreshIcons(); }
  }

  function openReadingFilters() {
    const sheet = createSheet('luxMobileReadingFilters', 'Filtros da biblioteca');
    const body = sheet.querySelector('.lux-mobile-sheet-body');
    const category=$('readingCategory'), author=$('readingAuthor'), sort=$('readingSort'), importCategory=$('readingImportCategory');
    const options = select => select ? [...select.options].map(option => `<option value="${String(option.value).replaceAll('"','&quot;')}">${option.textContent}</option>`).join('') : '';
    body.innerHTML=`<label class="lux-mobile-filter-field">Gênero<select id="luxReadingCategoryMirror">${options(category)}</select></label><label class="lux-mobile-filter-field">Autor<select id="luxReadingAuthorMirror">${options(author)}</select></label><label class="lux-mobile-filter-field">Ordenação<select id="luxReadingSortMirror">${options(sort)}</select></label><label class="lux-mobile-filter-field">Importar como<select id="luxReadingImportMirror">${options(importCategory)}</select></label><button id="luxReadingApply" type="button" class="lux-mobile-sheet-primary">Aplicar filtros</button><button id="luxReadingImportFileMobile" type="button" class="lux-mobile-sheet-secondary">＋ Importar arquivos</button><button id="luxReadingImportFolderMobile" type="button" class="lux-mobile-sheet-secondary">Importar pasta de imagens</button>`;
    const mirrors=[[ $('luxReadingCategoryMirror'), category ],[ $('luxReadingAuthorMirror'), author ],[ $('luxReadingSortMirror'), sort ],[ $('luxReadingImportMirror'), importCategory ]];
    mirrors.forEach(([mirror,original])=>{ if(mirror&&original) mirror.value=original.value; });
    $('luxReadingApply').onclick=()=>{ mirrors.forEach(([mirror,original])=>{ if(!mirror||!original||mirror.value===original.value)return; original.value=mirror.value; original.dispatchEvent(new Event('change',{bubbles:true})); }); closeSheet(sheet); };
    $('luxReadingImportFileMobile').onclick=()=>{closeSheet(sheet);$('readingImportFile')?.click();};
    $('luxReadingImportFolderMobile').onclick=()=>{closeSheet(sheet);$('readingImportFolder')?.click();};
    sheet.hidden=false; overlay(true);
  }

  function enhanceReadingSection() { const tools=$('readingSection')?.querySelector('.reading-tools'); if(!tools||tools.querySelector('.lux-mobile-reading-filter-button'))return; const button=document.createElement('button'); button.type='button'; button.className='lux-mobile-reading-filter-button'; button.innerHTML=`${icon('sliders-horizontal')} Filtros`; button.onclick=openReadingFilters; tools.appendChild(button); refreshIcons(); }

  function enhanceGameDetails() { const modal=$('gameDetailsModal'); if(!modal||modal.dataset.luxMobileEnhanced)return; modal.dataset.luxMobileEnhanced='1'; const synopsis=$('gameDetailsSynopsis'); if(synopsis){ const toggle=document.createElement('button'); toggle.type='button'; toggle.className='lux-mobile-synopsis-toggle'; toggle.textContent='Ler mais'; toggle.onclick=()=>{const open=modal.classList.toggle('lux-synopsis-open');toggle.textContent=open?'Mostrar menos':'Ler mais';}; synopsis.after(toggle);} }

  function setGameMenuOpen(open,resume=true){ if(!gameMenu)return; gameMenu.hidden=!open; overlay(open); if(open){try{window.EJS_emulator?.pause?.();}catch(_){} try{pauseGamePlayTimer?.();}catch(_){}} else if(resume){try{window.EJS_emulator?.resume?.();}catch(_){} try{resumeGamePlayTimer?.();}catch(_){}} }

  function openNativeSettingsFromMobile(){ setGameMenuOpen(false,false); const buttons=[...document.querySelectorAll('#emulatorContainer .ejs_menu_button, #emulatorContainer button')]; const settingsButton=buttons.find(button=>/settings|config|controle|control/i.test(`${button.title||''} ${button.ariaLabel||''} ${button.innerText||''}`)); if(settingsButton) settingsButton.click(); else alert('Use o menu do emulador para abrir as configurações.'); }

  function installGameMenu(){
    const modal=$('emulatorModal'); if(!modal||modal.dataset.luxMobileEnhanced)return;
    modal.dataset.luxMobileEnhanced='1'; modal.classList.add('lux-mobile-emulator'); document.body.classList.add('lux-mobile-immersive');
    const menuButton=document.createElement('button'); menuButton.type='button'; menuButton.className='lux-mobile-game-menu-button'; menuButton.setAttribute('aria-label','Menu do jogo'); menuButton.textContent='☰'; modal.appendChild(menuButton);
    gameMenu=document.createElement('div'); gameMenu.className='lux-mobile-game-menu'; gameMenu.hidden=true;
    gameMenu.innerHTML=`<div class="lux-mobile-game-menu-card" role="dialog" aria-modal="true" aria-label="Menu do jogo"><div class="lux-mobile-game-menu-title"><strong id="luxMobileGameMenuTitle">Jogo</strong><button type="button" class="lux-mobile-sheet-close" data-game-action="resume">✕</button></div><div class="lux-mobile-game-actions"><button type="button" class="primary" data-game-action="resume">${icon('play')} Continuar</button><button type="button" data-game-action="fast">${icon('fast-forward')} <span>Fast-forward</span></button><button type="button" data-game-action="controls">${icon('gamepad-2')} Controles</button><button type="button" data-game-action="settings">${icon('settings')} Configurações</button><button type="button" data-game-action="save-exit">${icon('save')} Salvar / Sair</button><button type="button" class="danger" data-game-action="exit">${icon('log-out')} Sair do jogo</button></div></div>`;
    modal.appendChild(gameMenu); $('luxMobileGameMenuTitle').textContent=activeEmulatorGame?.name||pendingEmulatorGame?.name||'Jogo';
    menuButton.onclick=()=>setGameMenuOpen(true);
    gameMenu.addEventListener('click',event=>{ if(event.target===gameMenu)return setGameMenuOpen(false); const action=event.target.closest('[data-game-action]')?.dataset.gameAction; if(!action)return; if(action==='resume')return setGameMenuOpen(false); if(action==='fast'){try{toggleEmulatorFastForward();}catch(_){} const label=gameMenu.querySelector('[data-game-action="fast"] span'); if(label)label.textContent=(typeof emulatorFastForward!=='undefined'&&emulatorFastForward)?'Fast-forward ligado':'Fast-forward'; return;} if(action==='controls'){setGameMenuOpen(false,false);return openEmulatorControls?.();} if(action==='settings')return openNativeSettingsFromMobile(); if(action==='save-exit'){setGameMenuOpen(false,false);return requestCloseGameEmulator?.();} if(action==='exit'){setGameMenuOpen(false,false);return requestCloseGameEmulator?.();} });
    modal.addEventListener('touchstart',event=>{const touch=event.touches?.[0];if(!touch||touch.clientX<window.innerWidth*.7)return;touchStart={x:touch.clientX,y:touch.clientY,t:Date.now()};},{passive:true});
    modal.addEventListener('touchend',event=>{if(!touchStart||!gameMenu?.hidden){touchStart=null;return;}const touch=event.changedTouches?.[0];if(!touch){touchStart=null;return;}const dx=touch.clientX-touchStart.x,dy=Math.abs(touch.clientY-touchStart.y),elapsed=Date.now()-touchStart.t;if(dx<-65&&dy<70&&elapsed<800)setGameMenuOpen(true);touchStart=null;},{passive:true});
    refreshIcons();
  }

  function enterMobileFullscreen(){const modal=$('emulatorModal');if(!modal)return;modal.classList.add('lux-mobile-playing');try{const promise=modal.requestFullscreen?.({navigationUI:'hide'});promise?.catch?.(()=>{});}catch(_){} }

  if(typeof openGameEmulator==='function'){const original=openGameEmulator;openGameEmulator=function(...args){const result=original.apply(this,args);installGameMenu();return result;};}
  if(typeof startEmulatorSession==='function'){const original=startEmulatorSession;startEmulatorSession=function(...args){enterMobileFullscreen();return original.apply(this,args);};}
  if(typeof closeGameEmulator==='function'){const original=closeGameEmulator;closeGameEmulator=function(...args){document.body.classList.remove('lux-mobile-immersive','lux-mobile-overlay-open');gameMenu=null;try{if(document.fullscreenElement)document.exitFullscreen?.();}catch(_){}return original.apply(this,args);};}
  if(typeof openGameDetails==='function'){const original=openGameDetails;openGameDetails=function(...args){const result=original.apply(this,args);enhanceGameDetails();return result;};}

  const games=$('gamesSection'); if(games)new MutationObserver(()=>queueMicrotask(enhanceGamesSection)).observe(games,{childList:true,subtree:true});
  const reading=$('readingSection'); if(reading)new MutationObserver(()=>queueMicrotask(enhanceReadingSection)).observe(reading,{childList:true,subtree:true});
  const splash=$('loadingSplash'); if(splash)new MutationObserver(()=>{document.body.classList.toggle('lux-mobile-overlay-open',!splash.classList.contains('hidden'));}).observe(splash,{attributes:true,attributeFilter:['class']});
  enhanceGamesSection(); enhanceReadingSection();
})();