(function(root){
 'use strict';
 const $=id=>document.getElementById(id),fields=['title','authors','category','description','cover_url','publisher','published_year','isbn','age_rating','collection_path','language_code'];
 let queue=[],catalog=[],selected=null,busy=false,owner='',upload=null,searchToken=0,preparing=false,previewUrl='',hideApproved=true;
 const account=()=>typeof currentUser==='undefined'?null:currentUser;
 const ownerNow=()=>{try{return LuxReaderStore.owner(account());}catch{return '';}};
 const isAdmin=()=>account()?.role==='admin'&&!account()?.profile?.is_child;
 const node=(tag,text)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;return el;};
 const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
 const message=text=>{$('readingAdminStatus').textContent=text;};
 const call=(action,payload={})=>LuxReaderCloud.request('reading-catalog',{action,...payload});
 function init(){
  const root=$('readingAdminRoot');if(!root||root.childElementCount)return;
  root.innerHTML=`<header class="reading-admin-heading"><div><span class="reading-eyebrow">CATÁLOGO LUX</span><h3>Uma biblioteca para todos.</h3><p>Envie em lote, revise os detalhes e aprove quando estiver pronto.</p></div><button type="button" id="readingAdminRefresh">↻ Atualizar</button></header><div class="reading-admin-actions"><label class="reading-admin-picker">＋ Selecionar obras<input id="readingAdminFiles" type="file" accept=".pdf,.epub,.cbr,.cbz" multiple hidden></label><button type="button" id="readingAdminUpload">Enviar lote para revisão</button><button type="button" id="readingAdminCancel" hidden>Parar após este arquivo</button><select id="readingAdminFilter" aria-label="Filtrar catálogo"><option value="">Todos</option><option value="pending">Em revisão</option><option value="approved">Aprovados</option><option value="rejected">Rejeitados</option></select><button type="button" id="readingAdminApprove">Aprovar selecionados</button></div><p id="readingAdminStatus" role="status"></p><progress id="readingAdminProgress" max="100" value="0" aria-label="Progresso do upload"></progress><div class="reading-admin-layout"><div id="readingAdminList"></div><section id="readingAdminEditor"><h4>Detalhes da obra</h4><p id="readingAdminSelection">Selecione uma obra para revisar.</p><form id="readingAdminForm"><label>Título<input id="readingMeta_title" maxlength="300" required></label><div class="reading-admin-search"><button type="button" id="readingAdminSearch">⌕ Buscar dados na internet</button><span>Livros e HQs · artigos podem ser preenchidos manualmente</span></div><div id="readingMetadataResults"></div><label>Autores<input id="readingMeta_authors" maxlength="500"></label><div class="reading-admin-columns"><label>Categoria<input id="readingMeta_category" list="readingCategoryOptions" maxlength="100"><datalist id="readingCategoryOptions"><option>Livros</option><option>HQs</option><option>Artigos científicos</option><option>Revistas</option><option>Outros</option></datalist></label><label>Classificação<select id="readingMeta_age_rating"><option value="0">Livre</option><option value="12">12 anos</option><option value="16">16 anos</option><option value="18">18 anos</option></select></label><label>Editora / revista<input id="readingMeta_publisher" maxlength="300"></label><label>Ano / data<input id="readingMeta_published_year" maxlength="30"></label></div><label>ISBN / identificador<input id="readingMeta_isbn" maxlength="100"></label><label>Capa (URL HTTPS)<input id="readingMeta_cover_url" type="url" maxlength="2048" placeholder="https://..."></label><img id="readingAdminCoverPreview" alt="Prévia da capa" hidden><label>Sinopse / resumo<textarea id="readingMeta_description" maxlength="12000" rows="6"></textarea></label><button type="submit" class="reading-primary">Salvar detalhes</button><p id="readingMetadataCredit"></p></form></section></div>`;
  $('readingAdminFiles').onchange=stageFiles;$('readingAdminRefresh').onclick=refresh;$('readingAdminFilter').onchange=draw;
  $('readingAdminUpload').onclick=uploadBatch;$('readingAdminCancel').onclick=()=>{cancelRequested=true;message(preparing?'A preparação será interrompida após o arquivo atual.':'O envio será pausado após o arquivo atual.');};
  $('readingAdminApprove').onclick=approveSelected;$('readingAdminForm').onsubmit=saveDetails;$('readingAdminSearch').onclick=search;
  $('readingMeta_cover_url').oninput=coverPreview;
  $('readingAdminFiles').accept='.pdf,.epub,.cbr,.cbz,.zip,.rar';
  const actions=$('readingAdminFiles').closest('.reading-admin-actions');
  const hideButton=button('Mostrar aprovados',()=>{hideApproved=!hideApproved;draw();});hideButton.id='readingAdminHideApproved';actions.insertBefore(hideButton,$('readingAdminApprove'));
  const selectAllButton=button('Selecionar todos',()=>document.querySelectorAll('#readingAdminList [data-reading-approve]').forEach(input=>{input.checked=true;}));selectAllButton.id='readingAdminSelectAll';actions.insertBefore(selectAllButton,$('readingAdminApprove'));
  const unpublishButton=button('Despublicar selecionados',()=>bulkStatus('pending'));unpublishButton.id='readingAdminUnpublish';actions.insertBefore(unpublishButton,$('readingAdminApprove'));
  const deleteButton=button('Excluir selecionados',deleteSelected);deleteButton.id='readingAdminDelete';actions.insertBefore(deleteButton,$('readingAdminApprove'));
  const folder=node('label','＋ Importar pasta completa');folder.className='reading-admin-picker';
  const input=node('input');input.id='readingAdminFolder';input.type='file';input.multiple=true;input.hidden=true;input.setAttribute('webkitdirectory','');input.onchange=stageFiles;folder.append(input);actions.insertBefore(folder,$('readingAdminUpload'));
  const hint=node('p','Baixe a pasta do Drive e selecione aqui a pasta, ZIP ou RAR. Subpastas viram coleções; pastas JPG/PNG viram revistas CBZ. Confira a organização antes de enviar.');hint.className='reading-import-hint';actions.after(hint);
  hint.append(node('br'),document.createTextNode('ZIP/RAR de até 256 MB. Para pacotes maiores, extraia no computador e use Importar pasta completa. Mantenha o app aberto durante a preparação e o envio.'));
  hint.append(node('br'),document.createTextNode('PDFs: título, autor, editora, ano e ISBN são procurados automaticamente no arquivo. Revise as sugestões; PDFs digitalizados sem texto podem exigir preenchimento manual.'));
  const auto=node('label');auto.className='reading-import-hint';const check=node('input');check.type='checkbox';check.id='readingAdminAutoMetadata';auto.append(check,document.createTextNode(' Sugerir metadados da internet ao preparar (mais lento; revisar resultados)'));hint.after(auto);
  const language=node('label','Idioma da obra');const languageInput=node('input');languageInput.id='readingMeta_language_code';languageInput.maxLength=10;languageInput.placeholder='pt-BR, pt-PT, en, es, fr, de…';language.append(languageInput);$('readingMeta_title').parentElement.after(language);
  const collection=node('label','Coleção / série (separe níveis com /)');const path=node('input');path.id='readingMeta_collection_path';path.maxLength=600;path.placeholder='Deadpool / [2013] Deadpool Mata Deadpool';collection.append(path);$('readingMeta_title').parentElement.after(collection);
 }
 function resetIfChanged(){if(owner!==ownerNow()){owner=ownerNow();queue=[];catalog=[];selected=null;searchToken++;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';}}
 async function refresh(){
  init();if(!isAdmin()){message('Entre em um perfil de administrador.');return;}
  resetIfChanged();const started=owner;
  try{catalog=await LuxReaderCloud.catalog(true);if(ownerNow()!==started)return;for(const entry of queue){const remote=catalog.find(book=>book.id===entry.remoteId);if(remote&&!entry.file)Object.assign(entry,remote);}draw();}catch(error){message(error.message);}
 }
 function draw(){
  const list=$('readingAdminList');list.replaceChildren();
  for(const item of [...queue,...catalog.filter(book=>!queue.some(item=>item.remoteId===book.id))]){
    if(hideApproved&&item.status==='approved'&&!$('readingAdminFilter').value)continue;
   if($('readingAdminFilter').value&&item.status!==$('readingAdminFilter').value)continue;
   const row=node('article');row.className='reading-admin-row'+(item===selected?' selected':'');
   if(item.id&&item.upload_complete){const checkbox=node('input');checkbox.type='checkbox';checkbox.dataset.readingApprove=item.id;checkbox.setAttribute('aria-label','Selecionar '+item.title);row.append(checkbox);}
   const main=button('',()=>select(item));main.className='reading-admin-row-main';main.append(node('strong',item.title),node('span',item.file?item.file.name:item.file_name),node('small',item.stage||({pending:'Em revisão',approved:'Publicado',rejected:'Rejeitado'}[item.status]||'Pronto para enviar')));row.append(main);
   if(item.collection_path)main.append(node('small',item.collection_path));
   if(item.coverBlob)main.append(node('small','Capa da primeira página pronta'));
   else if(item.coverWarning&&item.file)main.append(node('small',item.coverWarning));
   if(item.id){
    const actions=node('div');actions.className='reading-admin-row-actions';
    if(item.upload_complete&&item.url)actions.append(button('Ler para revisar',()=>root.LuxReader.open({id:item.content_hash||item.hash,title:item.title,format:item.format,category:item.category,authors:item.authors,description:item.description,cover_url:item.cover_url,sourceUrl:item.url,remote:true,origin:'catalog'})));
    if(item.upload_complete&&item.status!=='approved')actions.append(button('Aprovar',()=>changeStatus(item,'approved')));
    if(item.status==='approved')actions.append(button('Retirar de publicação',()=>changeStatus(item,'pending')));
    if(item.status==='pending'&&item.upload_complete)actions.append(button('Rejeitar',()=>changeStatus(item,'rejected')));
    if(!item.upload_complete)actions.append(button('Verificar envio',async()=>{try{await call('confirm',{id:item.id});await refresh();message('Arquivo confirmado. Já pode ser aprovado.');}catch(error){message(error.message);}}));
    if(item.status!=='approved')actions.append(button('Excluir',async()=>{if(busy||!confirm('Excluir esta obra do catálogo e seu arquivo do R2?'))return;try{await call('remove',{id:item.id,confirm:true});queue=queue.filter(q=>q.remoteId!==item.id);await refresh();}catch(error){message(error.message);}}));
    row.append(actions);
   }else if(!busy)row.append(button('×',()=>{queue=queue.filter(entry=>entry!==item);if(selected===item)selected=null;draw();}));
   list.append(row);
  }
  if(!list.childElementCount)list.append(node('p','Nenhuma obra nesta lista. Selecione arquivos para começar.'));
  $('readingAdminUpload').disabled=busy||preparing||!queue.some(item=>item.file&&item.stage!=='Enviado · em revisão');
  $('readingAdminHideApproved').textContent=hideApproved?'Mostrar aprovados':'Ocultar aprovados';
 }
 function readForm(){return Object.fromEntries(fields.map(field=>{const input=$('readingMeta_'+field);if(!input)return [field,selected?.[field]??''];return [field,field==='age_rating'?Number(input.value):input.value.trim()];}));}
 function select(item){
  if(busy)return;
  if(selected?.file)Object.assign(selected,readForm());
  selected=item;searchToken++;$('readingMetadataResults').replaceChildren();
  for(const field of fields){const input=$('readingMeta_'+field);if(input)input.value=item[field]??(field==='age_rating'?0:'');}
  $('readingAdminSelection').textContent=item.file?.name||item.file_name;
  $('readingMetadataCredit').textContent=item.metadata_source?'Metadados: '+item.metadata_source:'Preenchimento manual';coverPreview();draw();
 }
 function coverPreview(){const img=$('readingAdminCoverPreview');let url=$('readingMeta_cover_url').value;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl='';if(!url&&selected?.coverBlob)url=previewUrl=URL.createObjectURL(selected.coverBlob);img.hidden=!/^https:\/\//.test(url)&&!previewUrl;if(!img.hidden){img.src=url;img.referrerPolicy='no-referrer';img.onerror=()=>{img.hidden=true;};}}
 async function stageFiles(event){
  if(!isAdmin()||busy||preparing)return;resetIfChanged();const files=Array.from(event.target.files||[]);event.target.value='';if(!files.length)return;
  const started=ownerNow();let stopped=false;preparing=true;cancelRequested=false;
  $('readingAdminFiles').disabled=$('readingAdminFolder').disabled=true;$('readingAdminCancel').hidden=false;$('readingAdminCancel').textContent='Parar preparação';draw();
  const valid=()=>!cancelRequested&&started===ownerNow();
  try{
   const result=await root.LuxReadingImport.prepare(files,async publication=>{
    if(!valid())return;
    const item={authors:'',description:'',cover_url:'',publisher:'',published_year:'',isbn:'',age_rating:0,metadata_source:'',language_code:'',status:'pending',stage:'Pronto para enviar',...publication};
    if($('readingAdminAutoMetadata').checked){try{const candidates=await LuxReadingMetadata.search(item.isbn || item.title);if(candidates[0]){const suggestion=await LuxReadingMetadata.details(candidates[0]);for(const field of ['authors','description','publisher','published_year','isbn','metadata_source'])if(suggestion[field]&&!item[field])item[field]=String(suggestion[field]).slice(0,field==='description'?12000:field==='authors'?500:field==='publisher'?300:field==='published_year'?30:100);if(!item.coverBlob)item.cover_url=suggestion.cover_url||'';item.metadata_source=(item.metadata_source+' · sugestão; revisar').slice(0,100);}}catch{item.stage='Pronto · metadados manuais';}}
    if(!valid())return;queue.push(item);if(!selected)select(item);draw();
   },text=>{if(valid())message(text);},valid);
   stopped=!valid();if(started===ownerNow())message(`${result.done} obra(s) preparada(s)${stopped?' · preparação interrompida':''}. Revise coleções e capas antes de enviar. ${result.errors.join(' ')}`);
  }catch(error){if(started===ownerNow())message(error.message);}
  finally{preparing=false;$('readingAdminFiles').disabled=$('readingAdminFolder').disabled=false;$('readingAdminCancel').hidden=true;$('readingAdminCancel').textContent='Parar após este arquivo';if(started===ownerNow())draw();}
 }
 async function saveDetails(event){
  event.preventDefault();if(!selected||busy)return;const data=readForm();if(!data.title)return;
  Object.assign(selected,data);
  if(selected.file){message('Detalhes guardados na fila.');draw();return;}
  try{await call('edit',{id:selected.id,metadata:selected});message('Detalhes atualizados.');await refresh();root.LuxReader?.refresh();}catch(error){message(error.message);}
 }
 async function search(){
  if(!selected||busy)return;const entry=selected,token=++searchToken,started=ownerNow();
  $('readingMetadataResults').textContent='Buscando título, autores e capa…';
  try{
   const results=await LuxReadingMetadata.search($('readingMeta_title').value);
   if(token!==searchToken||entry!==selected||started!==ownerNow())return;
   const list=$('readingMetadataResults');list.replaceChildren();
   if(!results.length)list.textContent='Sem resultados. Todos os campos podem ser preenchidos manualmente.';
   for(const candidate of results){const choose=button('',async()=>{
    const details=await LuxReadingMetadata.details(candidate);if(token!==searchToken||entry!==selected||started!==ownerNow())return;
    for(const field of fields)if(details[field])$('readingMeta_'+field).value=String(details[field]).slice(0,$('readingMeta_'+field).maxLength>0?$('readingMeta_'+field).maxLength:12000);
    selected.metadata_source=details.metadata_source;coverPreview();$('readingMetadataCredit').textContent='Fonte: '+details.metadata_source+' · confira e salve os detalhes.';list.replaceChildren();
   });choose.append(node('strong',candidate.title),node('small',candidate.authors+' · '+candidate.published_year+' · '+candidate.metadata_source));list.append(choose);}
  }catch{if(token===searchToken)$('readingMetadataResults').textContent='Busca indisponível. Você pode preencher todos os dados manualmente.';}
 }
 let cancelRequested=false;
 function putFile(url,file,contentType,onProgress){return new Promise((resolve,reject)=>{
  const xhr=new XMLHttpRequest();upload=xhr;xhr.open('PUT',url);xhr.setRequestHeader('Content-Type',contentType);xhr.timeout=15*60*1000;
  xhr.upload.onprogress=event=>{if(event.lengthComputable)onProgress(Math.round(event.loaded/event.total*100));};
  xhr.onload=()=>xhr.status>=200&&xhr.status<300?resolve():reject(new Error('Falha no envio. Verifique conexão e CORS do R2.'));
  xhr.onerror=xhr.ontimeout=xhr.onabort=()=>reject(new Error('Envio interrompido. Tente novamente.'));xhr.send(file);
 });}
 async function uploadBatch(){
  if(busy||preparing||!isAdmin())return;if(selected?.file)Object.assign(selected,readForm());
  const started=ownerNow();busy=true;cancelRequested=false;$('readingAdminCancel').hidden=false;$('readingAdminFiles').disabled=true;
    $('readingAdminForm').inert=true;let completed=0,failed=0;const concurrency=3;
    try{for(let offset=0;offset<queue.length;offset+=concurrency){
     if(cancelRequested||started!==ownerNow())break;
     const batch=queue.slice(offset,offset+concurrency).filter(item=>item.file&&item.stage!=='Enviado · em revisão');
     await Promise.all(batch.map(async item=>{try{
    item.stage='Preparando…';draw();item.hash||=await LuxReaderStore.digest(item.file);
        if(started!==ownerNow())return;
    const previousRemote=item.remoteId;
    const meta=Object.fromEntries([...fields,'metadata_source'].map(field=>[field,item[field]??(field==='age_rating'?0:'')]));
    const prepared=await call('prepare',{hash:item.hash,format:item.format,size:item.file.size,fileName:item.file.name,metadata:meta});
    if(!prepared.alreadyUploaded||previousRemote===prepared.book.id)await call('edit',{id:prepared.book.id,metadata:meta});
    item.remoteId=prepared.book.id;
    if(!prepared.alreadyUploaded){item.stage='Enviando…';draw();await putFile(prepared.uploadUrl,item.file,prepared.contentType,percent=>{if(started===ownerNow()){$('readingAdminProgress').value=percent;message(`Enviando ${item.title} · ${percent}%`);}});await call('confirm',{id:item.remoteId});}
    if(item.coverBlob&&!item.cover_url&&(!prepared.alreadyUploaded||previousRemote===prepared.book.id)){
     item.stage='Enviando capa…';draw();const cover=await call('prepare-cover',{id:item.remoteId,size:item.coverBlob.size});await putFile(cover.uploadUrl,item.coverBlob,cover.contentType,()=>{});const confirmed=await call('confirm-cover',{id:item.remoteId,size:item.coverBlob.size});item.cover_url=confirmed.cover_url;item.coverBlob=null;
    }
    item.stage=prepared.alreadyUploaded?'Já estava no catálogo':'Enviado · em revisão';item.id=item.remoteId;item.upload_complete=true;item.status=prepared.book.status;item.file_name=item.file.name;item.file=null;completed++;
    if(selected===item){$('readingMeta_cover_url').value=item.cover_url||'';coverPreview();}
    }catch(error){item.stage='Falha · '+error.message;failed++;}
    draw();}));
  }}finally{
   busy=false;upload=null;$('readingAdminCancel').hidden=true;$('readingAdminFiles').disabled=false;$('readingAdminForm').inert=false;
   if(started===ownerNow()){message(`${completed} envio(s) concluído(s), ${failed} falha(s). Obras novas aguardam sua aprovação.`);await refresh();}
  }
 }
 async function changeStatus(item,status){if(busy)return;try{await call('status',{id:item.id,status});queue=queue.filter(q=>q.remoteId!==item.id);await refresh();root.LuxReader?.refresh();message(status==='approved'?'Obra publicada na biblioteca.':'Status atualizado.');}catch(error){message(error.message);}}
 const selectedIds=()=>[...document.querySelectorAll('[data-reading-approve]:checked')].map(input=>input.dataset.readingApprove);
 async function bulkStatus(status){
  if(busy)return;const ids=selectedIds();if(!ids.length)return message('Selecione as obras desejadas primeiro.');
  let done=0;for(const id of ids){try{await call('status',{id,status});done++;queue=queue.filter(q=>q.remoteId!==id);}catch(error){message(error.message);break;}}
  await refresh();root.LuxReader?.refresh();message(`${done} obra(s) ${status==='approved'?'aprovada(s)':'despublicada(s)'}.`);
 }
 async function approveSelected(){await bulkStatus('approved');}
 async function deleteSelected(){
  if(busy)return;const ids=selectedIds();if(!ids.length)return message('Selecione as obras desejadas primeiro.');
  if(!confirm(`Excluir ${ids.length} obra(s) e seus arquivos do R2? Esta ação não pode ser desfeita.`))return;
  let done=0;for(const id of ids){try{await call('remove',{id,confirm:true});done++;queue=queue.filter(q=>q.remoteId!==id);}catch(error){message(error.message);break;}}
  await refresh();root.LuxReader?.refresh();message(`${done} obra(s) excluída(s).`);
 }
 root.LuxReadingAdmin={refresh,stop(){cancelRequested=true;searchToken++;upload?.abort();}};
})(window);

