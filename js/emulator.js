let currentGameDetails = null;
let pendingEmulatorGame = null;
let activeEmulatorGame = null;
let requestedSaveSlot = null;
let gameSaveBusy = false;
let resolveGameSaveChoice = null;
let emulatorFastForward = false;
let gamePlayTimer = null;

function getGameSaveKey(game, user = currentUser) { return `lux-play:user-save:${encodeURIComponent(user?.user || '')}${typeof profileLocalSuffix === 'function' ? profileLocalSuffix(user) : ''}:${getCloudGameSaveKey(game)}`; }
function getGameSaveSlots(game) { try { return JSON.parse(localStorage.getItem(getGameSaveKey(game)) || '{}'); } catch (_) { return {}; } }
function hasGameSave(game) { const slots = getGameSaveSlots(game); return [1, 2, 3].some(slot => slots[slot]?.savedAt || slots[slot]?.cloudUpdatedAt); }
function gameSlotDate(info) { return Math.max(Date.parse(info?.savedAt || '') || 0, Number(info?.cloudUpdatedAt) || 0); }
function getGamePlayTimeKey(game,user=currentUser){return `lux-play:time:${encodeURIComponent(user?.user||'')}${typeof profileLocalSuffix==='function'?profileLocalSuffix(user):''}:${getCloudGameSaveKey(game)}`;}
function getGamePlayTime(game,user=currentUser){try{return Number(localStorage.getItem(getGamePlayTimeKey(game,user)))||0;}catch{return 0;}}
function formatGamePlayTime(milliseconds){const minutes=Math.floor(milliseconds/60000),hours=Math.floor(minutes/60);return hours?`${hours}h ${minutes%60}min`:`${minutes}min`;}
function flushGamePlayTime(){if(!gamePlayTimer)return;const now=Date.now();if(gamePlayTimer.startedAt){gamePlayTimer.elapsed+=now-gamePlayTimer.startedAt;gamePlayTimer.startedAt=now;}try{localStorage.setItem(getGamePlayTimeKey(gamePlayTimer.game,gamePlayTimer.user),String(gamePlayTimer.elapsed));}catch{}updateGameDetailsPlayTime(gamePlayTimer.game);}
function startGamePlayTimer(game){flushGamePlayTime();gamePlayTimer={game,user:currentUser,elapsed:getGamePlayTime(game),startedAt:Date.now()};gamePlayTimer.interval=setInterval(flushGamePlayTime,30000);updateGameDetailsPlayTime(game);}
function pauseGamePlayTimer(){if(!gamePlayTimer)return;flushGamePlayTime();gamePlayTimer.startedAt=0;}
function resumeGamePlayTimer(){if(gamePlayTimer&&!gamePlayTimer.startedAt)gamePlayTimer.startedAt=Date.now();}
function updateGameDetailsPlayTime(game){const target=document.getElementById('gameDetailsPlayTime');if(target)target.textContent=`Tempo jogado: ${formatGamePlayTime(getGamePlayTime(game))}`;}

function openGameEmulator(gameItem) {
  if (!profileAllowsMedia(gameItem)) return;
  const loadSlot = gameItem.loadSlot || null;
  closeGameEmulator();
  createEmulatorModalDOM();
  const modal = document.getElementById('emulatorModal');
  const titleEl = document.getElementById('emulatorGameTitle');
  if (!modal || !titleEl) return;
  pendingEmulatorGame = gameItem;
  activeEmulatorGame = gameItem;
  requestedSaveSlot = loadSlot;
  titleEl.innerText = gameItem.name;
  modal.classList.remove('hidden');
  document.getElementById('emulatorIntroName').textContent = gameItem.name || 'Jogo';
  document.getElementById('emulatorIntroConsole').textContent = gameItem.consoleLabel || String(gameItem.console || 'Console').toUpperCase();
  const header=document.querySelector('#emulatorModal .border-b');
  if(header&&!document.getElementById('emulatorFastForward')){
    const button=document.createElement('button');button.id='emulatorFastForward';button.type='button';button.className='text-[10px] text-purple-300 bg-purple-950/70 border border-purple-800/60 rounded-lg px-2 py-1';button.textContent='Fast-forward';button.onclick=toggleEmulatorFastForward;header.querySelector('.flex.items-center.gap-2:last-child')?.prepend(button);
  }
  lucide.createIcons();
}

function toggleEmulatorFastForward(){
  emulatorFastForward=!emulatorFastForward;
  const emulator=window.EJS_emulator;
  try{
    const manager=emulator?.gameManager;
    if(manager&&typeof manager.setFastForwardRatio==='function'&&typeof manager.toggleFastForward==='function'){
      manager.setFastForwardRatio(3);manager.toggleFastForward(emulatorFastForward?1:0);
    }else console.warn('API de fast-forward do EmulatorJS ainda não está pronta.');
  }catch(error){console.warn('Velocidade do emulador indisponível:',error);}
  const button=document.getElementById('emulatorFastForward');if(button){button.classList.toggle('bg-purple-600',emulatorFastForward);button.textContent=emulatorFastForward?'Fast-forward ligado':'Fast-forward';}
}

function startEmulatorSession() {
  if (!pendingEmulatorGame) return;
  const gameItem = pendingEmulatorGame;
  document.getElementById('emulatorIntro')?.classList.add('hidden');
  window.EJS_player = '#emulatorContainer';
  window.EJS_gameUrl = gameItem.url;
  window.EJS_core = getEmulatorCore(gameItem.console);
  window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
  window.EJS_color = '#7c3aed';
  window.EJS_gameName = getGameSaveKey(gameItem);
  window.EJS_defaultOptions = { 'save-state-location': 'browser' };
  window.EJS_startOnLoaded = true;
  window.EJS_onGameStart = () => { document.getElementById('emulatorControlsBtn')?.classList.remove('hidden'); startGamePlayTimer(gameItem); loadRequestedGameSlot(); };
  const script = document.createElement('script');
  script.id = 'ejs-script';
  script.src = 'https://cdn.emulatorjs.org/stable/data/loader.js';
  document.body.appendChild(script);
}

function getEmulatorCore(consoleType) {
  switch (consoleType) {
    case 'gba': return 'gba'; case 'gb': case 'gbc': return 'gb'; case 'snes': return 'snes';
    case 'megadrive': case 'genesis': return 'segaMD'; case 'nes': return 'nes'; case 'n64': return 'n64';
    default: return 'snes';
  }
}

function closeGameEmulator() {
  pauseGamePlayTimer();if(gamePlayTimer?.interval)clearInterval(gamePlayTimer.interval);gamePlayTimer=null;
  finishGameSaveChoice(null);
  try { window.EJS_emulator?.pause?.(); window.EJS_emulator?.callEvent?.('exit'); if (window.EJS_emulator && typeof window.EJS_emulator.destroy === 'function') window.EJS_emulator.destroy(); } catch (error) { console.warn('Não foi possível encerrar o emulador:', error); }
  document.getElementById('ejs-script')?.remove();
  document.getElementById('emulatorModal')?.remove();
  document.getElementById('saveExitModal')?.remove();
  document.getElementById('controlsHelpModal')?.remove();
  pendingEmulatorGame = null;
  activeEmulatorGame = null;
  requestedSaveSlot = null;
  emulatorFastForward = false;
  ['EJS_player', 'EJS_gameUrl', 'EJS_core', 'EJS_pathtodata', 'EJS_color', 'EJS_gameName', 'EJS_defaultOptions', 'EJS_startOnLoaded', 'EJS_onGameStart', 'EJS_load', 'EJS_emulator'].forEach(key => { try { delete window[key]; } catch (_) { window[key] = undefined; } });
}

function openGameDetails(gameItem) {
  if (!profileAllowsMedia(gameItem)) return;
  currentGameDetails = gameItem;
  createGameDetailsModalDOM();
  const modal = document.getElementById('gameDetailsModal');
  document.getElementById('gameDetailsTitle').textContent = gameItem.name || 'Sem título';
  document.getElementById('gameDetailsSynopsis').textContent = gameItem.synopsis || 'Sinopse não disponível para este jogo.';
  document.getElementById('gameDetailsTranslate').classList.toggle('hidden', !gameItem.synopsis);
  document.getElementById('gameDetailsConsole').textContent = gameItem.consoleLabel || String(gameItem.console || 'Console').toUpperCase();
  document.getElementById('gameDetailsYear').textContent = gameItem.releaseYear || 'Data não informada';
  document.getElementById('gameDetailsGenres').textContent = gameItem.genres || 'Gênero não informado';
  let features = document.getElementById('gameDetailsFeatures');
  if (!features) { features = document.createElement('div'); features.id = 'gameDetailsFeatures'; document.getElementById('gameDetailsTitle').after(features); }
  features.innerHTML = gameFeatureBadges(gameItem);
  const cover = document.getElementById('gameDetailsCover');
  cover.innerHTML = '';
  if (gameItem.logo) {
    const image = document.createElement('img'); image.src = gameItem.logo; image.alt = `Capa de ${gameItem.name || 'jogo'}`; image.className = 'w-full h-full object-cover';
    image.onerror = () => { cover.innerHTML = '<i data-lucide="gamepad-2" class="w-12 h-12 text-purple-500"></i>'; lucide.createIcons(); };
    cover.appendChild(image);
  } else cover.innerHTML = '<i data-lucide="gamepad-2" class="w-12 h-12 text-purple-500"></i>';
  modal.classList.remove('hidden');
  updateGameDetailsActions(gameItem);
  updateGameDetailsPlayTime(gameItem);
  retryPendingGameSaves();
  refreshCloudGameSaveSlots(gameItem);
  lucide.createIcons();
}

async function translateGameSynopsis() {
  if (!currentGameDetails?.synopsis) return;
  const button = document.getElementById('gameDetailsTranslate');
  const synopsis = document.getElementById('gameDetailsSynopsis');
  button.disabled = true; button.textContent = 'Traduzindo...';
  try {
    const { data, error } = await supabaseClient.functions.invoke('game-metadata', { body: { action: 'translate', text: currentGameDetails.synopsis } });
    if (error) throw error;
    synopsis.textContent = data.text || currentGameDetails.synopsis;
    button.textContent = 'Ver original';
    button.onclick = () => { synopsis.textContent = currentGameDetails.synopsis; button.textContent = 'Traduzir para português'; button.onclick = translateGameSynopsis; };
  } catch (error) { button.textContent = 'Tradução indisponível'; console.warn(error); }
  finally { button.disabled = false; }
}

function closeGameDetails() { document.getElementById('gameDetailsModal')?.classList.add('hidden'); }
function updateGameDetailsActions(game) {
  const actions = document.getElementById('gameDetailsActions');
  if (!actions) return;
  const favorite = typeof isGameFavorite === 'function' && isGameFavorite(game);
  const favoriteButton = `<button onclick="toggleCurrentGameFavorite(event)" class="w-full mb-2 border ${favorite ? 'border-rose-500/60 bg-rose-500/15 text-rose-200' : 'border-purple-800/60 bg-purple-950/60 text-purple-200'} hover:bg-rose-500/20 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2"><i data-lucide="heart" class="w-4 h-4 ${favorite ? 'fill-current' : ''}"></i> ${favorite ? 'Nos favoritos' : 'Adicionar aos favoritos'}</button>`;
  actions.innerHTML = favoriteButton + (hasGameSave(game)
    ? '<button onclick="chooseGameSaveSlot()" class="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl text-sm transition-all shadow-lg shadow-purple-900/40 flex justify-center items-center gap-2"><i data-lucide="play" class="w-4 h-4 fill-white"></i> Continuar</button><button onclick="startGameFromDetails()" class="w-full mt-2 bg-purple-950/60 hover:bg-purple-900 text-purple-100 font-bold py-3 rounded-xl text-sm border border-purple-800/60 transition-all">Novo jogo</button>'
    : '<button onclick="startGameFromDetails()" class="w-full bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 rounded-xl text-sm transition-all shadow-lg shadow-purple-900/40 flex justify-center items-center gap-2"><i data-lucide="play" class="w-4 h-4 fill-white"></i> Novo jogo</button>');
  const playTime=document.createElement('p');playTime.id='gameDetailsPlayTime';playTime.className='mt-3 text-xs text-purple-300';playTime.textContent=`Tempo jogado: ${formatGamePlayTime(getGamePlayTime(game))}`;actions.appendChild(playTime);
  const hltb=document.createElement('a');hltb.href='https://howlongtobeat.com/?q='+encodeURIComponent(game.name||'');hltb.target='_blank';hltb.rel='noopener noreferrer';hltb.className='block mt-2 text-xs text-indigo-300 hover:text-white';hltb.textContent='Ver duração no HowLongToBeat ↗';actions.appendChild(hltb);
  lucide.createIcons();
}
function startGameFromDetails(loadSlot = null) { if (!currentGameDetails) return; const game = { ...currentGameDetails, loadSlot }; closeGameDetails(); openGameEmulator(game); }

function chooseGameSaveSlot() {
  if (!currentGameDetails) return;
  createContinueSlotModalDOM();
  const slots = getGameSaveSlots(currentGameDetails);
  document.getElementById('continueSlotButtons').innerHTML = [1, 2, 3].map(slot => gameSlotDate(slots[slot]) ? `<button onclick="continueFromSlot(${slot})" class="rounded-xl border border-purple-700/70 bg-purple-950/50 p-4 text-left hover:bg-purple-800/60 transition-all"><span class="block text-sm font-bold text-white">Slot ${slot}</span><span class="mt-1 block text-[10px] text-purple-300">${new Date(gameSlotDate(slots[slot])).toLocaleString('pt-BR')}</span></button>` : '').join('');
  document.getElementById('continueSlotModal').classList.remove('hidden');
}

async function refreshCloudGameSaveSlots(game) {
  const user = currentUser;
  if (!user || !game) return;
  let message = 'Saves sincronizados com sua conta.';
  try {
    const slots = getGameSaveSlots(game);
    for (const slot of [1, 2, 3]) {
      const local = await readLocalGameSave(game, slot, user);
      if (local) slots[slot] = { ...slots[slot], savedAt: new Date(local.updatedAt).toISOString() };
    }
    try {
      const cloudSlots = await fetchCloudGameSaveSlots(game, user);
      for (const slot of [1, 2, 3]) {
        const remote = cloudSlots.find(item => Number(item.slot) === slot);
        slots[slot] = { ...slots[slot], cloudUpdatedAt: Number(remote?.updatedAt) || 0 };
      }
    } catch (_) { message = 'Nuvem indisponível. Os saves deste dispositivo continuam disponíveis.'; }
    if (currentUser !== user) return;
    localStorage.setItem(getGameSaveKey(game, user), JSON.stringify(slots));
    if (currentGameDetails !== game) return;
    updateGameDetailsActions(game);
    const status = document.createElement('p');
    status.className = 'mt-2 text-xs text-purple-300';
    status.textContent = message;
    document.getElementById('gameDetailsActions')?.appendChild(status);
  } catch (_) { /* Local storage unavailable; do not interrupt the game catalog. */ }
}

function continueFromSlot(slot) { document.getElementById('continueSlotModal')?.classList.add('hidden'); startGameFromDetails(slot); }

async function loadRequestedGameSlot() {
  const game = activeEmulatorGame;
  const slot = requestedSaveSlot;
  const user = currentUser;
  const emulator = window.EJS_emulator;
  if (!slot || !game || !user) return;
  try {
    let local = await readLocalGameSave(game, slot, user);
    let cloud;
    try { cloud = await loadCloudGameSave(game, slot, user); }
    catch (_) {
      if (!local) throw new Error('Não foi possível baixar o save. Confira a conexão e tente continuar novamente.');
    }
    if (currentUser !== user || activeEmulatorGame !== game) return;
    if (cloud && local && !(await gameSaveStatesEqual(local.state, cloud.state))) {
      emulator.pause?.();pauseGamePlayTimer();
      const choice = await chooseGameSaveSource(local.updatedAt, cloud.updatedAt);
      if (!choice || currentUser !== user || activeEmulatorGame !== game) return;
      if (choice === 'cloud') {
        local = cloud;
        await writeLocalGameSave(game, slot, cloud.state, cloud.updatedAt, false, user);
      } else {
        // The user explicitly chose this version; synchronize it as a new save.
        local = { ...local, updatedAt: Date.now() };
        await writeLocalGameSave(game, slot, local.state, local.updatedAt, true, user, cloud.updatedAt);
        const result = await uploadLocalGameSave(await readLocalGameSave(game, slot, user).catch(() => null), user).catch(() => null);
        if (!result?.saved) alert('Vamos usar o save deste dispositivo. A sincronização ficou pendente; nenhuma nova versão da nuvem foi substituída.');
      }
    } else if (cloud && local) {
      await writeLocalGameSave(game, slot, local.state, local.updatedAt, false, user, cloud.updatedAt);
    } else if (cloud && !local) {
      local = cloud;
      await writeLocalGameSave(game, slot, cloud.state, cloud.updatedAt, false, user);
    }
    if (currentUser !== user || activeEmulatorGame !== game) return;
    if (!local?.state) throw new Error('O save deste slot não está disponível.');
    const slots = getGameSaveSlots(game);
    slots[slot] = { savedAt: new Date(local.updatedAt).toISOString() };
    localStorage.setItem(getGameSaveKey(game, user), JSON.stringify(slots));
    await new Promise(resolve => setTimeout(resolve, 500));
    if (currentUser === user && activeEmulatorGame === game) { await emulator.gameManager.loadState(local.state); emulator.resume?.();resumeGamePlayTimer(); }
  } catch (error) {
    if (currentUser === user && activeEmulatorGame === game) {
      emulator?.pause?.();
      alert(error.message || 'Não foi possível carregar o save.');
    }
  }
}

function requestCloseGameEmulator() {
  if (!window.EJS_emulator || !activeEmulatorGame) return closeGameEmulator();
  createSaveExitModalDOM();
  const slots = getGameSaveSlots(activeEmulatorGame);
  document.getElementById('saveExitSlots').innerHTML = [1, 2, 3].map(slot => `<button onclick="saveGameAndClose(${slot})" class="rounded-xl border border-purple-800/70 bg-purple-950/50 hover:bg-purple-800/60 p-3 text-left transition-all"><span class="block text-xs font-bold text-purple-200">Slot ${slot}</span><span class="block mt-1 text-[10px] text-purple-400">${gameSlotDate(slots[slot]) ? `Salvo em ${new Date(gameSlotDate(slots[slot])).toLocaleString('pt-BR')}` : 'Vazio'}</span></button>`).join('');
  document.getElementById('saveExitModal').classList.remove('hidden');
}

async function saveGameAndClose(slot) {
  const emulator = window.EJS_emulator;
  const game = activeEmulatorGame;
  const user = currentUser;
  if (gameSaveBusy || !emulator?.gameManager || !game || !user) return;
  gameSaveBusy = true;
  const status = document.getElementById('saveExitStatus');
  const controls = [...document.querySelectorAll('#saveExitModal button')];
  controls.forEach(button => { button.disabled = true; });
  let savedLocally = false;
  try {
    status.textContent = `Salvando no slot ${slot}...`;
    emulator.pause?.();
    pauseGamePlayTimer();
    await new Promise(resolve => setTimeout(resolve, 80));
    if (currentUser !== user || activeEmulatorGame !== game) return;
    const state = await emulator.gameManager.getState();
    if (!state) throw new Error('O estado do jogo ainda não está pronto.');
    const updatedAt = Date.now();
    const previous = await readLocalGameSave(game, slot, user);
    await writeLocalGameSave(game, slot, state, updatedAt, true, user, previous?.cloudBaseAt ?? null);
    savedLocally = true;
    const record = await readLocalGameSave(game, slot, user);
    if (currentUser !== user || activeEmulatorGame !== game) return;
    const slots = getGameSaveSlots(game);
    slots[slot] = { savedAt: new Date(updatedAt).toISOString() }; slots.lastSlot = slot;
    localStorage.setItem(getGameSaveKey(game, user), JSON.stringify(slots));
    status.textContent = 'Salvo neste dispositivo. Enviando para sua conta...';
    const result = await uploadLocalGameSave(record, user);
    if (currentUser !== user || activeEmulatorGame !== game) return;
    if (result.newerCloud) {
      status.textContent = 'Salvo neste dispositivo. A nuvem tem outro progresso. Ao continuar neste slot, escolha qual save usar.';
      return;
    }
    status.textContent = 'Salvo na nuvem!';
    closeGameEmulator();
  } catch (error) {
    status.textContent = savedLocally
      ? 'Salvo neste dispositivo. Envio pendente: tentaremos novamente ao reconectar, entrar na conta ou abrir um jogo. Você pode fechar ou tentar salvar novamente.'
      : 'Não foi possível salvar neste dispositivo. Tente novamente antes de fechar.';
  } finally {
    gameSaveBusy = false;
    controls.forEach(button => { button.disabled = false; });
  }
}

function returnToGameFromSaveExit() { document.getElementById('saveExitModal')?.classList.add('hidden'); window.EJS_emulator?.resume?.(); resumeGamePlayTimer(); }

function openEmulatorControls() {
  createControlsHelpModalDOM();
  document.getElementById('controlsHelpModal').classList.remove('hidden');
}

function openNativeControlsPanel() {
  document.getElementById('controlsHelpModal')?.classList.add('hidden');
  const buttons = [...document.querySelectorAll('#emulatorContainer .ejs_menu_button, #emulatorContainer button')];
  const settingsButton = buttons.find(button => /settings|config|controle|control/i.test(`${button.title || ''} ${button.ariaLabel || ''} ${button.innerText || ''}`));
  if (settingsButton) settingsButton.click();
  else alert('Use o ícone de engrenagem na barra inferior do EmulatorJS para definir os controles de Player 1 e Player 2.');
}

function createEmulatorModalDOM() {
  if (document.getElementById('emulatorModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="emulatorModal" class="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-4"><div class="w-full max-w-4xl bg-[#120c1f] border border-purple-900/60 rounded-2xl overflow-hidden shadow-2xl flex flex-col h-[85vh]"><div class="px-4 py-3 bg-[#180f29] border-b border-purple-900/40 flex items-center justify-between"><div class="flex items-center gap-2"><div class="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center"><i data-lucide="gamepad-2" class="w-4 h-4"></i></div><h3 id="emulatorGameTitle" class="text-xs font-bold text-white">Carregando jogo...</h3></div><div class="flex items-center gap-2"><button id="emulatorControlsBtn" onclick="openEmulatorControls()" title="Configurar controles" class="hidden text-purple-300 hover:text-white px-2.5 py-1.5 rounded-lg bg-purple-950/60 hover:bg-purple-800 transition-all text-[11px] font-bold">Controles</button><button onclick="requestCloseGameEmulator()" title="Fechar jogo" class="text-purple-400 hover:text-white p-1.5 rounded-lg bg-purple-950/60 hover:bg-rose-600 transition-all"><i data-lucide="x" class="w-4 h-4"></i></button></div></div><div class="flex-1 relative bg-black flex items-center justify-center overflow-hidden"><div id="emulatorContainer" class="w-full h-full"></div><div id="emulatorIntro" class="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[#120c1f]"><div class="w-16 h-16 rounded-3xl bg-purple-600/20 text-purple-400 flex items-center justify-center"><i data-lucide="gamepad-2" class="w-8 h-8"></i></div><p id="emulatorIntroConsole" class="text-xs font-bold uppercase tracking-[0.18em] text-purple-400"></p><h2 id="emulatorIntroName" class="max-w-xl px-6 text-center text-xl md:text-2xl font-bold text-white"></h2><button onclick="startEmulatorSession()" class="mt-3 rounded-full bg-[#a855f7] hover:bg-purple-500 px-10 py-3 text-base font-extrabold text-white shadow-lg shadow-purple-900/50 transition-all hover:scale-105">JOGAR</button></div></div><div class="px-4 py-2.5 bg-[#180f29] border-t border-purple-900/40 flex items-center justify-between text-[11px] text-purple-400/70 font-mono"><span>💡 Dica: Use o teclado ou conecte um controle USB/Bluetooth.</span><span>LUX Play Retro Engine</span></div></div></div>`);
  lucide.createIcons();
}

function createGameDetailsModalDOM() {
  if (document.getElementById('gameDetailsModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="gameDetailsModal" class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md hidden flex items-center justify-center p-4"><div class="w-full max-w-3xl bg-[#120c1f] border border-purple-900/60 rounded-3xl overflow-hidden shadow-2xl"><div class="flex justify-end px-4 pt-4"><button onclick="closeGameDetails()" title="Fechar" class="text-purple-400 hover:text-white p-2 rounded-xl bg-purple-950/60 hover:bg-rose-600 transition-all"><i data-lucide="x" class="w-5 h-5"></i></button></div><div class="grid md:grid-cols-[220px_1fr] gap-6 px-6 pb-6 md:px-8 md:pb-8"><div id="gameDetailsCover" class="aspect-[2/3] max-h-[330px] mx-auto md:mx-0 rounded-2xl overflow-hidden bg-purple-950/50 border border-purple-900/50 flex items-center justify-center shadow-xl"></div><div class="min-w-0 flex flex-col"><p class="text-[11px] font-bold uppercase tracking-widest text-purple-400 mb-2">Detalhes do jogo</p><h2 id="gameDetailsTitle" class="text-xl md:text-2xl font-bold text-white leading-tight"></h2><div class="flex flex-wrap gap-2 mt-4 text-xs"><span id="gameDetailsConsole" class="bg-purple-600/20 text-purple-200 border border-purple-500/30 rounded-lg px-2.5 py-1"></span><span id="gameDetailsYear" class="bg-[#180f29] text-purple-300 border border-purple-900/50 rounded-lg px-2.5 py-1"></span><span id="gameDetailsGenres" class="bg-[#180f29] text-purple-300 border border-purple-900/50 rounded-lg px-2.5 py-1"></span></div><div class="mt-5"><div class="flex items-center justify-between gap-3"><h3 class="text-[11px] font-bold uppercase tracking-wide text-purple-400">Sinopse</h3><button id="gameDetailsTranslate" onclick="translateGameSynopsis()" class="text-[10px] font-bold text-indigo-300 hover:text-white">Traduzir para português</button></div><p id="gameDetailsSynopsis" class="mt-2 max-h-44 overflow-y-auto pr-2 text-sm leading-relaxed text-slate-300"></p></div><div id="gameDetailsActions" class="mt-6"></div></div></div></div></div>`);
}

function createSaveExitModalDOM() {
  if (document.getElementById('saveExitModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="saveExitModal" class="fixed inset-0 z-[60] hidden flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"><div class="w-full max-w-md rounded-3xl border border-purple-800/70 bg-[#120c1f] p-6 shadow-2xl"><h2 class="text-lg font-bold text-white">Salvar antes de sair?</h2><p class="mt-1 text-xs text-purple-300">Escolha um dos três slots. Seu progresso será salvo neste dispositivo e na nuvem da sua conta. Aguarde a confirmação do envio.</p><div id="saveExitSlots" class="mt-4 grid grid-cols-3 gap-3"></div><p id="saveExitStatus" class="mt-3 text-xs text-purple-300"></p><button onclick="closeGameEmulator()" class="mt-4 w-full rounded-xl border border-purple-800/70 bg-purple-950/50 py-2.5 text-xs font-bold text-purple-200 hover:bg-rose-950/70 hover:text-rose-200">Fechar sem salvar</button><button onclick="returnToGameFromSaveExit()" class="mt-2 w-full py-2 text-xs text-purple-400 hover:text-white">Voltar ao jogo</button></div></div>`);
}

function createContinueSlotModalDOM() {
  if (document.getElementById('continueSlotModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="continueSlotModal" class="fixed inset-0 z-[60] hidden flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"><div class="w-full max-w-md rounded-3xl border border-purple-800/70 bg-[#120c1f] p-6 shadow-2xl"><h2 class="text-lg font-bold text-white">Continuar de qual slot?</h2><p class="mt-1 text-xs text-purple-300">Selecione o progresso que deseja carregar.</p><div id="continueSlotButtons" class="mt-4 grid grid-cols-1 gap-3"></div><button onclick="document.getElementById('continueSlotModal').classList.add('hidden')" class="mt-4 w-full py-2 text-xs text-purple-400 hover:text-white">Cancelar</button></div></div>`);
}

function createControlsHelpModalDOM() {
  if (document.getElementById('controlsHelpModal')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="controlsHelpModal" class="fixed inset-0 z-[60] hidden flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"><div class="w-full max-w-md rounded-3xl border border-purple-800/70 bg-[#120c1f] p-6 shadow-2xl"><h2 class="text-lg font-bold text-white">Configurar controles</h2><p class="mt-2 text-sm leading-relaxed text-slate-300">O painel nativo do EmulatorJS permite configurar teclado, controle USB ou Bluetooth para <strong>Player 1</strong> e <strong>Player 2</strong>. As preferências ficam salvas neste navegador.</p><p class="mt-3 text-xs text-purple-300">No painel, abra Controls/Controles e escolha o jogador antes de atribuir cada tecla ou botão.</p><button onclick="openNativeControlsPanel()" class="mt-5 w-full rounded-xl bg-purple-600 py-3 text-sm font-bold text-white hover:bg-purple-500">Abrir configurações</button><button onclick="document.getElementById('controlsHelpModal').classList.add('hidden')" class="mt-2 w-full py-2 text-xs text-purple-400 hover:text-white">Cancelar</button></div></div>`);
}

function finishGameSaveChoice(choice) {
  document.getElementById('gameSaveChoiceModal')?.remove();
  const resolve = resolveGameSaveChoice;
  resolveGameSaveChoice = null;
  if (resolve) resolve(choice);
}

function chooseGameSaveSource(localTime, cloudTime) {
  finishGameSaveChoice(null);
  const modal = document.createElement('div');
  modal.id = 'gameSaveChoiceModal';
  modal.className = 'fixed inset-0 z-[70] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4';
  modal.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="gameSaveChoiceTitle" class="w-full max-w-md rounded-3xl border border-purple-700/60 bg-[#120c1f] p-6 shadow-2xl">
    <h2 id="gameSaveChoiceTitle" class="text-lg font-bold text-white">Qual progresso você quer continuar?</h2>
    <p class="mt-2 text-xs text-purple-300">Este dispositivo e a nuvem têm saves diferentes. Escolha qual usar neste slot. A versão escolhida será usada na sincronização.</p>
    <button data-choice="local" class="mt-5 w-full rounded-xl border border-purple-600 bg-purple-950/70 p-4 text-left text-white"><strong>Usar deste dispositivo</strong><span class="block mt-1 text-xs text-purple-300">${new Date(localTime).toLocaleString('pt-BR')}</span></button>
    <button data-choice="cloud" class="mt-3 w-full rounded-xl border border-indigo-500 bg-indigo-950/70 p-4 text-left text-white"><strong>Usar da nuvem</strong><span class="block mt-1 text-xs text-purple-300">${new Date(cloudTime).toLocaleString('pt-BR')}</span></button>
    <button data-choice="cancel" class="mt-4 w-full py-2 text-xs text-purple-300">Cancelar e fechar o jogo</button>
  </div>`;
  document.body.appendChild(modal);
  const promise = new Promise(resolve => { resolveGameSaveChoice = resolve; });
  modal.querySelectorAll('[data-choice]').forEach(button => button.onclick = () => {
    if (button.dataset.choice === 'cancel') closeGameEmulator();
    else finishGameSaveChoice(button.dataset.choice);
  });
  modal.onkeydown = event => {
    if (event.key === 'Escape') { event.preventDefault(); closeGameEmulator(); }
    if (event.key === 'Tab') {
      const buttons = [...modal.querySelectorAll('button')];
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
    }
  };
  modal.querySelector('button').focus();
  return promise;
}
