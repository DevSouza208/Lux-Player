let accountProfiles = [];
let profilePickerBusy = false;
let profileEntryPending = false;
let profilePickerRequest = 0;
let profilePhotoData = '';
let profilePhotoBusy = false;
let profilePhotoRequest = 0;

function profileSlot(user = currentUser) { return Number(user?.profile?.slot || 1); }
function profileLocalSuffix(user = currentUser) { return user?.profile?.data_key ? ':profile:' + user.profile.data_key : profileSlot(user) === 1 ? '' : ':profile:' + profileSlot(user); }
function profileSaveOwner(user) { return user?.profile?.data_key ? [user.user,user.profile.data_key] : profileSlot(user) === 1 ? user.user : [user.user, profileSlot(user)]; }
function isChildProfile() { return !!currentUser?.profile?.is_child; }
function profileAllowsMedia(item) {
  return !isChildProfile() || !(item?.isAdult || item?.adult || Number(item?.age_rating) >= 18 ||
    isAdultContent([item?.group,item?.category,item?.age_rating,...(Array.isArray(item?.genres)?item.genres:[])].filter(Boolean).join(' '), item?.name || item?.title || ''));
}

async function requestProfiles(action, values = {}, password = currentUser?.pass) {
  const user = currentUser;
  if (!user) throw new Error('Entre na sua conta.');
  const {data,error} = await supabaseClient.functions.invoke('profiles', {body:{...values,action,username:user.user,password}});
  if(currentUser !== user) throw new Error('A sessão mudou.');
  if(error || data?.error) {
    let message = data?.error || 'Não foi possível carregar os perfis.';
    try { message = (await error.context.json()).error || message; } catch(_) {}
    throw new Error(message);
  }
  return data.profiles;
}

async function openProfilePicker(initial = false) {
  if (!currentUser || profilePickerBusy) return;
  profilePickerBusy = true;
  const user = currentUser;
  const request = ++profilePickerRequest;
  try {
  profileEntryPending = initial || !currentUser.profile;
  const modal=document.getElementById('profilePicker');
  modal.tabIndex=-1;
  modal.onkeydown=event=>{
    if(event.key==='Escape'){event.preventDefault();closeProfilePicker();}
    if(event.key==='Tab'){const controls=[...modal.querySelectorAll('button,input')].filter(el=>!el.disabled && el.type!=='hidden' && el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===modal)){event.preventDefault();first?.focus();}}
  };
  document.getElementById('profileEditorDialog').close();
  document.getElementById('profileAdultGate').classList.add('hidden');
  document.getElementById('profilePickerClose').classList.toggle('hidden',profileEntryPending);
  document.getElementById('profilePickerStatus').textContent='Carregando perfis...';
  if (profileEntryPending) document.getElementById('authStatusText').textContent='Carregando seus perfis...';
    const profiles=await requestProfiles('list');
    if(currentUser!==user || request!==profilePickerRequest)return;
    if(!Array.isArray(profiles) || !profiles.length)throw new Error('Não foi possível carregar os perfis. Tente novamente.');
    accountProfiles=profiles;
    renderProfileChoices();
    document.getElementById('authStatusText').textContent='';
    transitionScreen(modal,true);
    modal.focus();
  } catch(error) {
    if(currentUser!==user || request!==profilePickerRequest)return;
    if(!document.getElementById('profilePicker').classList.contains('hidden'))document.getElementById('profilePickerStatus').textContent=error.message;
    else if(profileEntryPending)document.getElementById('authStatusText').textContent=error.message;
    else alert(error.message);
  } finally {profilePickerBusy=false;}
}

function renderProfileChoices() {
  const container=document.getElementById('profileChoices');container.replaceChildren();
  const colors=['#9333ea','#0284c7','#059669','#db2777'];
  for(const profile of accountProfiles) {
    const box=document.createElement('div');box.className='flex flex-col items-center gap-2';
    const button=document.createElement('button');button.className='flex flex-col items-center gap-3 p-2 rounded-2xl hover:bg-white/5 focus-visible:outline-purple-400';
    const avatar=document.createElement('span');avatar.className='w-20 h-20 md:w-24 md:h-24 rounded-full flex items-center justify-center text-3xl font-bold text-white shadow-lg';
    avatar.style.background=colors[profile.slot-1];avatar.style.overflow='hidden';
    setProfileAvatar(avatar,profile);
    const name=document.createElement('span');name.className='text-sm font-bold text-white max-w-[130px] truncate';name.textContent=profile.name;
    const type=document.createElement('span');type.className='text-xs text-purple-300';type.textContent=(profile.is_child?'Infantil':'Adulto') + (profile.password_protected?' · Protegido':'');
    button.append(avatar,name,type);button.onclick=()=>selectAccountProfile(profile.slot);box.append(button);
    const edit=document.createElement('button');edit.type='button';edit.className='profile-edit-button';edit.textContent='Editar';edit.onclick=()=>editAccountProfile(profile);box.append(edit);container.append(box);
  }
  document.getElementById('profileAdd').classList.toggle('hidden',accountProfiles.length>=4);
  document.getElementById('profilePickerStatus').textContent='Cada perfil tem seus favoritos, histórico e saves.';
}

function editAccountProfile(profile = null) {
  if(profilePickerBusy)return;
  profilePhotoRequest++;profilePhotoBusy=false;
  profilePhotoData=profile?.avatar_data || '';
  document.getElementById('profileEditPhoto').value='';
  document.getElementById('profileEditProtected').checked=!!profile?.password_protected;
  document.getElementById('profileDelete').classList.toggle('hidden',!profile);
  document.getElementById('profileDangerZone').classList.toggle('hidden',!profile);
  document.getElementById('profileEditorTitle').textContent=profile?'Editar perfil':'Criar perfil';
  document.getElementById('profileEditorStatus').textContent='';
  renderEmojiChoices();
  document.getElementById('profileSaveButton').disabled=false;
  document.getElementById('profileSaveButton').textContent=profile?'Salvar alterações':'Criar perfil';
  document.getElementById('profileAdultGate').classList.add('hidden');
  document.getElementById('profileEditor').classList.remove('hidden');
  document.getElementById('profileEditSlot').value=profile?.slot || '';
  document.getElementById('profileEditName').value=profile?.name || '';
  document.getElementById('profileEditChild').checked=!!profile?.is_child;
  document.getElementById('profileEditPassword').value='';
  updateProfilePhotoPreview();
  const dialog=document.getElementById('profileEditorDialog');
  if(!dialog.open)dialog.showModal();
  dialog.oncancel=event=>{event.preventDefault();closeProfileEditor();};
  document.getElementById('profileEditName').focus({preventScroll:true});
}

function closeProfileEditor() {
  if(profilePickerBusy)return;
  profilePhotoRequest++;profilePhotoBusy=false;
  document.getElementById('profileEditPassword').value='';
  document.getElementById('profileEditorDialog').close();
}

async function saveAccountProfile(event) {
  event.preventDefault();if(profilePickerBusy || profilePhotoBusy)return;profilePickerBusy=true;
  const status=document.getElementById('profileEditorStatus');
  try {
    const slot=Number(document.getElementById('profileEditSlot').value)||null;
    accountProfiles=await requestProfiles('save',{slot,name:document.getElementById('profileEditName').value.trim(),is_child:document.getElementById('profileEditChild').checked,avatar_data:profilePhotoData,password_protected:document.getElementById('profileEditProtected').checked},document.getElementById('profileEditPassword').value);
    document.getElementById('profileEditorDialog').close();renderProfileChoices();
    document.getElementById('profilePickerStatus').textContent=slot?'Perfil atualizado.':'Perfil criado! Escolha quem vai assistir.';
    if(currentUser.profile?.slot===slot) {
      const changed=accountProfiles.find(p=>p.slot===slot);
      if(changed.is_child!==currentUser.profile.is_child){profilePickerBusy=false;await activateAccountProfile(changed);}
      else { currentUser={...currentUser,profile:changed};document.getElementById('userNameBadge').textContent=changed.name;renderProfileHeader(); }
    }
  } catch(error){status.textContent=error.message;}
  finally {document.getElementById('profileEditPassword').value='';profilePickerBusy=false;}
}

async function selectAccountProfile(slot) {
  if(profilePickerBusy)return;
  const profile=accountProfiles.find(p=>p.slot===slot);if(!profile)return;
  document.getElementById('profileAdultGate').classList.add('hidden');
  if(profile.password_protected) {
    document.getElementById('profileAdultGate').classList.remove('hidden');
    document.getElementById('profileAdultSlot').value=slot;
    document.getElementById('profileAdultPassword').value='';document.getElementById('profileAdultPassword').focus();return;
  }
  await activateAccountProfile(profile);
}

async function unlockAdultProfile(event) {
  event.preventDefault();if(profilePickerBusy)return;profilePickerBusy=true;
  try {
    accountProfiles=await requestProfiles('list',{},document.getElementById('profileAdultPassword').value);
    await activateAccountProfile(accountProfiles.find(p=>p.slot===Number(document.getElementById('profileAdultSlot').value)));
  } catch(error){document.getElementById('profilePickerStatus').textContent=error.message;}
  finally {document.getElementById('profileAdultPassword').value='';profilePickerBusy=false;}
}

async function activateAccountProfile(profile) {
  if(!profile)return;
  profilePickerBusy=true;
  const switchingUser=currentUser;
  try {
    window.luxBootTraceStart?.(`perfil:${profile.name}`, true);
    window.luxBootTraceStep?.('perfil-selecionado', 'Perfil selecionado. Preparando troca...');
    showSplashScreen();
    document.getElementById('splashUserName').textContent=profile.name;
    document.getElementById('splashStatusMessage').textContent='[1.3] Abrindo seu perfil...';
    window.luxBootTraceStep?.('perfil-fechar-picker:start', 'Fechando seleção de perfil...');
    await transitionScreen(document.getElementById('profilePicker'),false);
    window.luxBootTraceStep?.('perfil-fechar-picker:done');
    if(currentPlayingVodItem)closeVodPlayer();
    closeGameEmulator();closeGameDetails();closeAdultPinModal();closeMovieModal();closeSeriesModal();closeSearchModal();
    const live=document.getElementById('videoPlayerLive');if(live){live.pause();live.removeAttribute('src');live.load();}
    if(hlsLiveInstance){hlsLiveInstance.destroy();hlsLiveInstance=null;}activeLiveChannel=null;
    if(heroCarouselInterval)clearInterval(heroCarouselInterval);
    document.getElementById('heroBgImage').style.backgroundImage='none';
    document.getElementById('heroTitle').textContent='Lux Play';
    document.getElementById('heroOverview').textContent='';
    document.getElementById('heroPosterImage').classList.add('hidden');
    document.getElementById('heroPosterImage').removeAttribute('src');
    document.getElementById('heroPlayBtn').classList.add('hidden');
    document.getElementById('noStreamAlertLive').classList.remove('hidden');
    document.getElementById('liveCurrentName').textContent='Selecione um canal';
    document.getElementById('liveCurrentGroup').textContent='';
    document.getElementById('liveCurrentLogo').replaceChildren();
    window.luxBootTraceStep?.('perfil-sync-pre:start', 'Sincronizando progresso antes de ativar o perfil...');
    const preSyncStarted=performance.now();
    await syncCloudProgress();
    console.info(`[Lux Boot 1.3] perfil-sync-pre concluiu em ${Math.round(performance.now()-preSyncStarted)}ms`);
    window.luxBootTraceStep?.('perfil-sync-pre:done');
    if(currentUser!==switchingUser)return;
    window.LuxReadingAdmin?.stop();
    window.LuxReader?.close();
    const role=currentUser.accountRole || currentUser.role;
    currentUser={...currentUser,accountRole:role,role:profile.is_child?'user':role,profile};
    isAdultUnlocked=false;pendingUnlockAction=null;activeCategory='Todos';activeSearchQuery='';isSortModeActive=false;
    gamesFavoritesOnly=false;gamesConsoleFilter='all';gamesStatusFilter='all';
    document.getElementById('adminModal').classList.add('hidden');
    document.getElementById('profileEditorDialog').close();
    window.luxBootTraceStep?.('perfil-startApp', 'Perfil ativo. Iniciando catálogo...');
    await startApp();
  } catch(error) {
    if(currentUser===switchingUser || currentUser?.profile===profile) {
      hideSplashScreen();
      transitionScreen(document.getElementById('profilePicker'),true);
      document.getElementById('profilePickerStatus').textContent=error.message || 'Não foi possível abrir o perfil. Tente novamente.';
    }
  } finally {profilePickerBusy=false;}
}
function closeProfilePicker() { if(!profileEntryPending){profilePickerRequest++;transitionScreen(document.getElementById('profilePicker'),false);} }

function setProfileAvatar(container, profile) {
  container.replaceChildren();
  const initial=(profile?.name || 'P').slice(0,1).toLocaleUpperCase('pt-BR');
  if(/^data:image\/(jpeg|png|webp);base64,/.test(profile?.avatar_data || '')) {
    const image=document.createElement('img');image.src=profile.avatar_data;image.alt='';image.className='w-full h-full object-cover rounded-full';
    image.onerror=()=>{container.textContent=initial;};container.append(image);
  } else container.textContent=initial;
}
function renderProfileHeader() {
  const button=document.getElementById('headerProfileButton');if(!button)return;
  button.className='w-9 h-9 rounded-full overflow-hidden bg-purple-700 flex items-center justify-center text-sm font-bold text-white';
  setProfileAvatar(button,currentUser?.profile || {name:currentUser?.name});
}
function updateProfilePhotoPreview() {
  setProfileAvatar(document.getElementById('profilePhotoPreview'),{name:document.getElementById('profileEditName').value || 'Perfil',avatar_data:profilePhotoData});
}
async function chooseProfilePhoto(event) {
  const file=event.target.files?.[0];if(!file)return;
  const token=++profilePhotoRequest;profilePhotoBusy=true;
  const button=document.getElementById('profileSaveButton');button.disabled=true;
  try {
    if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>8*1024*1024)throw new Error('Escolha uma foto JPG, PNG ou WebP de até 8 MB.');
    const bitmap=await createImageBitmap(file);
    try {
      const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
      const context=canvas.getContext('2d');context.fillStyle='#180f29';context.fillRect(0,0,256,256);
      const size=Math.min(bitmap.width,bitmap.height);
      context.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
      const data=canvas.toDataURL('image/jpeg',.85);
      if(data.length>180000)throw new Error('Esta foto é muito grande. Escolha outra imagem.');
      if(token!==profilePhotoRequest)return;
      profilePhotoData=data;updateProfilePhotoPreview();
      document.getElementById('profileEditorStatus').textContent='Foto pronta. Salve o perfil para aplicar.';
    }finally{bitmap.close();}
  }catch(error){if(token===profilePhotoRequest)document.getElementById('profileEditorStatus').textContent=error.message;}
  finally{if(token===profilePhotoRequest){profilePhotoBusy=false;button.disabled=false;}}
}
function removeProfilePhoto(){profilePhotoRequest++;profilePhotoBusy=false;profilePhotoData='';document.getElementById('profileEditPhoto').value='';document.getElementById('profileSaveButton').disabled=false;updateProfilePhotoPreview();}

async function deleteAccountProfile() {
  if(profilePickerBusy)return;
  const slot=Number(document.getElementById('profileEditSlot').value);
  const profile=accountProfiles.find(p=>p.slot===slot);if(!profile)return;
  const password=document.getElementById('profileEditPassword').value;
  if(!password){document.getElementById('profileEditorStatus').textContent='Digite a senha de login para excluir este perfil.';document.getElementById('profileEditPassword').focus();return;}
  if(accountProfiles.length<=1){document.getElementById('profileEditorStatus').textContent='Mantenha pelo menos um perfil na conta.';return;}
  if(!confirm('Excluir o perfil '+profile.name+' e seu histórico, favoritos e saves? Esta ação não pode ser desfeita.'))return;
  profilePickerBusy=true;
  const user=currentUser;
  try {
    if(user.profile?.slot===slot){if(currentPlayingVodItem)closeVodPlayer();closeGameEmulator();const live=document.getElementById('videoPlayerLive');if(live)live.pause();}
    const profiles=await requestProfiles('delete',{slot,data_key:profile.data_key || '',confirmPassword:password},password);
    const deletedUser={...user,profile};
    const prefixes=['lux_user_progress:'+encodeURIComponent(user.user)+profileLocalSuffix(deletedUser)+':','lux-play:user-save:'+encodeURIComponent(user.user)+profileLocalSuffix(deletedUser)+':'];
    const syncKey=profile.data_key || slot>1 ? 'lux_profile_sync_records_'+JSON.stringify([user.user,profile.data_key || slot]) : 'lux_cloud_sync_records_'+user.user;
    const keys=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key===syncKey || prefixes.some(prefix=>key?.startsWith(prefix)))keys.push(key);}
    for(const key of keys)localStorage.removeItem(key);
    await removeLocalProfileSaves(deletedUser).catch(()=>{});
    accountProfiles=profiles;
    if(user.profile?.slot===slot){
      currentUser={...user,profile:null,role:'user',accountRole:user.accountRole || user.role};
      allMediaItems=[];isAdultUnlocked=false;profileEntryPending=true;
      document.getElementById('profilePickerClose').classList.add('hidden');
    }
    document.getElementById('profileEditorDialog').close();
    document.getElementById('profileAdultGate').classList.add('hidden');
    renderProfileChoices();document.getElementById('profilePickerStatus').textContent='Perfil excluído.';
  }catch(error){document.getElementById('profileEditorStatus').textContent=error.message;}
  finally{document.getElementById('profileEditPassword').value='';profilePickerBusy=false;}
}
