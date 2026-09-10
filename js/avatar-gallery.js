let gallerySaving = false;
let galleryPreviewRequest = 0;
async function previewGalleryAvatar(event) {
  const token=++galleryPreviewRequest;
  const preview=document.getElementById('galleryAvatarPreview');
  const label=document.getElementById('galleryAvatarFilename');
  preview.textContent='↑';
  const file=event.target.files?.[0];
  label.textContent=file?file.name:'Escolha uma imagem nos arquivos do seu dispositivo';
  if(!file)return;
  try {
    const data=await avatarFileData(file);
    if(token!==galleryPreviewRequest)return;
    setProfileAvatar(preview,{avatar_data:data});
    document.getElementById('adminGalleryStatus').textContent='Foto pronta. Dê um nome e adicione à galeria.';
  }catch(error){if(token===galleryPreviewRequest){event.target.value='';label.textContent='Escolha outra imagem';document.getElementById('adminGalleryStatus').textContent=error.message;}}
}
function openAvatarChooser(source) {
  const dialog=document.getElementById('avatarChooserDialog');
  for(const [key,id] of Object.entries({upload:'avatarUploadPanel',gallery:'avatarGalleryPanel',emoji:'avatarEmojiPanel'}))document.getElementById(id).hidden=key!==source;
  document.getElementById('avatarChooserTitle').textContent={upload:'Enviar sua foto',gallery:'Galeria do app',emoji:'Escolher emoji'}[source];
  document.getElementById('avatarUploadStatus').textContent='';
  if(!dialog.open)dialog.showModal();
  dialog.oncancel=event=>{event.preventDefault();closeAvatarChooser();};
  if(source==='gallery')loadAvatarGallery(false);
  if(source==='emoji')renderEmojiChoices();
}
function closeAvatarChooser() {
  profilePhotoRequest++;profilePhotoBusy=false;
  document.getElementById('profileSaveButton').disabled=false;
  document.getElementById('avatarChooserDialog').close();
}
async function uploadChosenAvatar(event) {
  if(!event.target.files?.[0])return;
  const token=++profilePhotoRequest;profilePhotoBusy=true;
  document.getElementById('profileSaveButton').disabled=true;
  const status=document.getElementById('avatarUploadStatus');status.textContent='Preparando sua foto...';
  try {const data=await avatarFileData(event.target.files[0]);if(token===profilePhotoRequest)pickGalleryAvatar(data);}
  catch(error){if(token===profilePhotoRequest)status.textContent=error.message;}
  finally{if(token===profilePhotoRequest){profilePhotoBusy=false;document.getElementById('profileSaveButton').disabled=false;}event.target.value='';}
}
async function avatarFileData(file) {
  if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>8*1024*1024)throw Error('Escolha JPG, PNG ou WebP de até 8 MB.');
  const bitmap=await createImageBitmap(file);
  try {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#180f29';ctx.fillRect(0,0,256,256);
    const size=Math.min(bitmap.width,bitmap.height);
    ctx.drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,256,256);
    const data=canvas.toDataURL('image/jpeg',.85);
    if(data.length>180000)throw Error('Escolha uma imagem menor.');return data;
  }finally{bitmap.close();}
}
function pickGalleryAvatar(data) {
  profilePhotoRequest++;profilePhotoBusy=false;profilePhotoData=data;
  document.getElementById('profileSaveButton').disabled=false;
  document.getElementById('profileEditPhoto').value='';updateProfilePhotoPreview();
  document.getElementById('profileEditorStatus').textContent='Avatar escolhido. Salve para aplicar.';
  document.getElementById('avatarChooserDialog').close();
}
function renderEmojiChoices() {
  const box=document.getElementById('profileEmojiChoices');box.replaceChildren();
  for(const emoji of ['🐶','🐱','🐼','🦊','🐸','🦁','🐵','🦄','🐯','🐨','🐰','🐻','🐮','🐷','🐧','🦉','🦖','🐢','🐬','🐳','🐙','🦋','🐝','🐲','😀','😎','🥳','🤩','🤖','👽','👻','🎃','🌻','⭐','🌈','🚀','🌙','☀️','⚡','🔥','💎','🎮','🎨','🎵','⚽','🏀','🍀','❤️']) {
    const button=document.createElement('button');button.type='button';button.textContent=emoji;
    button.className='rounded-xl bg-purple-950 p-2 text-2xl';button.setAttribute('aria-label','Usar '+emoji);
    button.onclick=()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=256;const ctx=canvas.getContext('2d');ctx.fillStyle='#281344';ctx.fillRect(0,0,256,256);ctx.font='160px "Segoe UI Emoji", sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(emoji,128,138);pickGalleryAvatar(canvas.toDataURL('image/png'));};
    box.append(button);
  }
}
async function loadAvatarGallery(admin=false) {
  const status=document.getElementById(admin?'adminGalleryStatus':'profileGalleryStatus');
  const container=document.getElementById(admin?'adminAvatarGallery':'profileAvatarGallery');
  status.textContent='Carregando galeria...';
  try {
    const rows=await requestProfiles('gallery-list');container.replaceChildren();
    for(const row of rows) {
      const box=document.createElement('div');
      const button=document.createElement('button');button.type='button';button.title=row.name;button.setAttribute('aria-label',row.name);
      button.className='w-16 h-16 rounded-full overflow-hidden bg-purple-900';setProfileAvatar(button,{name:row.name,avatar_data:row.avatar_data});
      if(admin)button.disabled=true;else button.onclick=()=>pickGalleryAvatar(row.avatar_data);
      box.append(button);
      if(admin){const label=document.createElement('p');label.textContent=row.name;label.className='text-xs text-purple-200';box.append(label);const remove=document.createElement('button');remove.type='button';remove.textContent='Remover';remove.className='text-xs text-rose-300';remove.onclick=async()=>{if(!confirm('Remover esta foto da galeria?'))return;remove.disabled=true;try{await requestProfiles('gallery-delete',{id:row.id});await loadAvatarGallery(true);}catch(e){status.textContent=e.message;remove.disabled=false;}};box.append(remove);}
      container.append(box);
    }
    status.textContent=rows.length?'':'Nenhuma foto cadastrada ainda. Você pode enviar sua foto ou escolher um emoji.';
  }catch(e){status.textContent=e.message;}
}
async function saveGalleryAvatar(event) {
  event.preventDefault();if(gallerySaving)return;gallerySaving=true;
  const button=document.getElementById('galleryAvatarSave');button.disabled=true;
  const status=document.getElementById('adminGalleryStatus');status.textContent='Enviando foto...';
  try {
    const avatar_data=await avatarFileData(document.getElementById('galleryAvatarFile').files[0]);
    await requestProfiles('gallery-save',{name:document.getElementById('galleryAvatarName').value.trim(),avatar_data});
    event.target.reset();galleryPreviewRequest++;
    document.getElementById('galleryAvatarPreview').textContent='↑';
    document.getElementById('galleryAvatarFilename').textContent='Escolha uma imagem nos arquivos do seu dispositivo';
    await loadAvatarGallery(true);status.textContent='Foto adicionada à galeria.';
  }catch(e){status.textContent=e.message;}
  finally{gallerySaving=false;button.disabled=false;}
}
