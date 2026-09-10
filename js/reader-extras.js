(function(root){
 'use strict';
 root.createReaderExtras=function(api){
  const $=id=>document.getElementById(id);let editing=null,draftAnchor=null,draftLabel='',markdownRequest=0;
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const btn=(text,fn)=>{const node=el('button',text);node.type='button';node.onclick=fn;return node;};
  const header=$('readerNotesButton').parentElement;
  const marksButton=btn('◇ Comentários',()=>api.openPanel('marks'));marksButton.id='readerMarksButton';header.insertBefore(marksButton,$('readerNotesButton'));
  const effect=el('label');effect.innerHTML='Virada <select id="readerEffect"><option value="page">Livro</option><option value="slide">Deslizar</option><option value="none">Sem efeito</option></select>';
  $('readerSaveStatus').before(effect);
  $('readerEffect').onchange=()=>{const session=api.getSession();if(session)api.save(session,{effect:$('readerEffect').value});};
  const syncButton=btn('↻ Sincronizar',()=>{const s=api.getSession();if(s)root.LuxReaderCloud?.sync(s.owner,s.book.id);});syncButton.className='reader-sync-button';$('readerSaveStatus').after(syncButton);
  const badge=btn('',()=>api.openPanel('marks'));badge.id='readerPageMarksBadge';badge.hidden=true;$('readerStage').after(badge);
  const markPanel=el('div');markPanel.id='readerMarksPanel';markPanel.hidden=true;
  markPanel.innerHTML=`<p id="readerMarkContext"></p><div class="reader-note-actions"><button type="button" id="readerNewMark">＋ Novo comentário</button><select id="readerMarkFilter" aria-label="Comentários exibidos"><option value="page">Nesta página</option><option value="all">Toda a obra</option></select></div><form id="readerMarkForm"><textarea id="readerMarkText" maxlength="10000" aria-label="Comentário desta página" placeholder="O que você quer lembrar desta página? Markdown e emojis são bem-vindos."></textarea><div class="reader-note-actions"><select id="readerMarkColor" aria-label="Cor do marcador"><option value="#fbbf24">Dourado</option><option value="#c084fc">Lilás</option><option value="#60a5fa">Azul</option><option value="#4ade80">Verde</option><option value="#fb7185">Rosa</option></select><button type="submit" class="reading-primary">Salvar comentário</button></div></form><div id="readerMarksList"></div>`;
  $('readerPanel').append(markPanel);
  const toolbar=el('div',undefined,'reader-markdown-toolbar');
  const insert=(before,after='')=>{const input=$('readerNotes'),start=input.selectionStart,end=input.selectionEnd;input.setRangeText(before+(input.value.slice(start,end)||'texto')+after,start,end,'select');input.dispatchEvent(new Event('input'));input.focus();};
  toolbar.append(btn('B',()=>insert('**','**')),btn('I',()=>insert('*','*')),btn('Título',()=>insert('## ')),btn('Lista',()=>insert('- ')),btn('❝',()=>insert('> ')));
  const color=el('input');color.type='color';color.value='#c084fc';color.setAttribute('aria-label','Cor do texto');color.onchange=()=>insert('[cor='+color.value+']','[/cor]');toolbar.append(color);
  const emoji=el('select');emoji.setAttribute('aria-label','Inserir emoji');emoji.append(new Option('😊 Emoji',''),...['😊','💡','❤️','⭐','📖','🔖','🤔','✅','🔥','✨'].map(v=>new Option(v,v)));
  emoji.onchange=()=>{if(emoji.value){const input=$('readerNotes');input.setRangeText(emoji.value,input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new Event('input'));input.focus();emoji.value='';}};toolbar.append(emoji);
  const previewButton=btn('Prévia',()=>{const preview=$('readerNotesPreview');preview.hidden=!preview.hidden;$('readerNotes').hidden=!preview.hidden;previewButton.textContent=preview.hidden?'Prévia':'Editar';renderNotes();});previewButton.id='readerPreviewNotes';toolbar.append(previewButton);
  $('readerNotes').before(toolbar);
  const preview=el('div',undefined,'reader-markdown');preview.id='readerNotesPreview';preview.hidden=true;$('readerNotes').after(preview);
  const recoveries=el('details');recoveries.id='readerRecoveries';recoveries.hidden=true;recoveries.append(el('summary','Versões recuperadas'));const recoveryList=el('div');recoveryList.id='readerRecoveryList';recoveries.append(recoveryList);$('readerNotesPanel').append(recoveries);
  $('readerNotes').addEventListener('input',renderNotes);
  $('readerNewMark').onclick=()=>{resetDraft();$('readerMarkText').focus();};
  $('readerMarkText').onfocus=()=>{if(!draftAnchor){draftAnchor=anchor();draftLabel=$('readerPosition').textContent;renderContext();}};
  $('readerMarkFilter').onchange=renderMarks;
  $('readerMarkForm').onsubmit=event=>{
   event.preventDefault();const s=api.getSession(),text=$('readerMarkText').value.trim();if(!s||!text)return;
   const a=draftAnchor||anchor();if(!a.page&&!a.cfi)return;
   const id=editing||crypto.randomUUID();
   api.save(s,{annotations:{...s.state.annotations,[id]:{text,anchor:a,label:draftLabel||$('readerPosition').textContent,color:$('readerMarkColor').value}}});
   resetDraft();renderMarks();
  };
  const dicio=btn('Consultar também no Dicio ↗',()=>{
   const word=$('readerWord').value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
   if(!/^[a-z-]{1,80}$/.test(word))return;
   const url='https://www.dicio.com.br/'+word+'/';
   if(root.luxElectron?.openReaderSource)root.luxElectron.openReaderSource(url);else root.open(url,'_blank','noopener,noreferrer');
  });dicio.className='reader-dicio-link';$('readerDictionaryPanel').append(dicio);
  function anchor(){const s=api.getSession();return s?.rendition?{cfi:s.location?.start?.cfi||s.state.cfi||''}:{page:s?.state.page||s?.page||1};}
  function here(mark){
   const s=api.getSession();if(!s||mark.deleted)return false;
   if(!s.rendition)return mark.anchor?.page===s.page;
   try{return s.epub.epubcfi.compare(mark.anchor.cfi,s.location.start.cfi)>=0&&s.epub.epubcfi.compare(mark.anchor.cfi,s.location.end.cfi)<=0;}catch{return mark.anchor?.cfi===s.state.cfi;}
  }
  function resetDraft(){editing=null;draftAnchor=null;draftLabel='';$('readerMarkText').value='';$('readerMarkColor').value='#fbbf24';renderContext();}
  function renderContext(){$('readerMarkContext').textContent=editing?'Editando · '+draftLabel:draftAnchor?'Comentário para '+draftLabel:'Comentários de '+$('readerPosition').textContent;}
  async function markdown(node,text){const html=(await api.engine()).renderMarkdown(text);if(node.isConnected)node.innerHTML=html;}
  async function renderNotes(){
   const s=api.getSession();if(!s||$('readerNotesPreview').hidden)return;const token=++markdownRequest;
   const html=(await api.engine()).renderMarkdown($('readerNotes').value);
   if(api.getSession()===s&&token===markdownRequest)$('readerNotesPreview').innerHTML=html;
  }
  function renderMarks(){
   const s=api.getSession();if(!s)return;
   const marks=Object.entries(s.state.annotations||{}).filter(([,m])=>!m.deleted);
   const onPage=marks.filter(([,m])=>here(m));badge.hidden=!onPage.length;
   badge.textContent=`◇ ${onPage.length} ${onPage.length===1?'comentário nesta página':'comentários nesta página'}`;
   badge.style.setProperty('--mark-color',onPage[0]?.[1].color||'#fbbf24');
   marksButton.textContent=onPage.length?`◇ Comentários (${onPage.length})`:'◇ Comentários';
   marksButton.classList.toggle('has-page-marks',!!onPage.length);
   renderContext();const list=$('readerMarksList');list.replaceChildren();
   const shown=$('readerMarkFilter').value==='all'?marks:onPage;
   if(!shown.length)list.append(el('p','Nenhum comentário aqui. Marque uma ideia sem interromper sua leitura.'));
   for(const [id,mark]of shown){
    const card=el('article',undefined,'reader-mark-card');card.style.setProperty('--mark-color',mark.color);
    card.append(btn(mark.label,()=>api.jump(mark.anchor)));
    const text=el('div',undefined,'reader-markdown');card.append(text);markdown(text,mark.text).catch(()=>{text.textContent=mark.text;});
    const actions=el('div',undefined,'reader-note-actions');
    actions.append(btn('Editar',()=>{editing=id;draftAnchor=mark.anchor;draftLabel=mark.label;$('readerMarkText').value=mark.text;$('readerMarkColor').value=mark.color;renderContext();$('readerMarkText').focus();}),btn('Excluir',()=>{api.save(s,{annotations:{...s.state.annotations,[id]:{deleted:true}}});renderMarks();}));card.append(actions);list.append(card);
   }
  }
  function load(){
   const s=api.getSession();if(!s)return;
   $('readerEffect').value=s.state.effect||'page';$('readerNotes').hidden=false;$('readerNotesPreview').hidden=true;previewButton.textContent='Prévia';resetDraft();renderMarks();renderRecoveries();
  }
  function renderRecoveries(){const s=api.getSession();if(!s)return;const items=Object.values(s.state.recoveries||{}).filter(r=>!r.deleted);$('readerRecoveries').hidden=!items.length;const list=$('readerRecoveryList');list.replaceChildren();for(const item of items){const card=el('article',undefined,'reader-mark-card');card.append(el('strong',item.label));const text=el('pre',item.text);card.append(text);card.append(btn('Copiar para as notas',()=>{$('readerNotes').value+='\n\n'+item.text;$('readerNotes').dispatchEvent(new Event('input'));}));list.append(card);}}
  return {load,renderMarks,renderRecoveries,renderNotes,resetDraft,here};
 };
})(window);
