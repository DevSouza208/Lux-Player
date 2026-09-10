(function () {
  'use strict';
  const store = window.LuxReaderStore;
  const $ = id => document.getElementById(id);
  let books = [], libraryOwner = '', libraryRequest = 0, importing = false, collectionPath = '', readingSort = 'recent';
  let active = null, generation = 0, enginePromise;
  let extras;
  const MAX_FILE = 256 * 1024 * 1024;
  const engine = () => enginePromise ||= import('./vendor/reader-engine.mjs').catch(error => { enginePromise = null; throw error; });
  const currentOwner = () => { try { return store.owner(currentUser); } catch { return ''; } };
  const valid = session => active === session && session.owner === currentOwner();
  const status = message => { $('readingStatus').textContent = message; };
  function element(tag, className, text) {
    const node = document.createElement(tag); if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function button(text, action, className = '') {
    const node = element('button', className, text); node.type = 'button'; node.onclick = action; return node;
  }
  function stateLabel(state, book) {
    if (!state.page && !state.cfi) return 'Começar leitura';
    return book.format === 'epub' ? `${Math.round((state.progress || 0) * 100)}% lido` : `Página ${state.page} de ${state.total || book.total || '…'}`;
  }
  function languageOf(book){return LuxLanguage?.detect(book.language_sample||'',book.language_code||'');}
  function updateLanguageUI(session){
    const info=languageOf(session.book);
    $('readerLanguageLabel').hidden=session.book.format!=='epub';
    $('readerStartLabel').hidden=session.book.format!=='epub';
    $('readerStartChapter').value=String(session.state.startChapter||session.book.startChapter||1);
    $('readerLanguageBadge').replaceChildren(LuxLanguage.badge(info),document.createTextNode(info.name));
  }
  async function refresh() {
    const request = ++libraryRequest, owner = currentOwner();
    if (!owner) { books = []; drawLibrary(); return; }
    if (libraryOwner !== owner) { books = []; collectionPath = ''; $('readingSearch').value = ''; $('readingCategory').value = ''; $('readingAuthor').value = ''; readingSort = 'recent'; $('readingSort').value = readingSort; status(''); }
    libraryOwner = owner;
    try {
      const records = await store.list(owner);
      if (request !== libraryRequest || owner !== currentOwner()) return;
      const localIds = new Set(records.map(book => book.sourceUrl).filter(Boolean));
      const catalog = typeof getAdminBooksCatalog === 'function' ? getAdminBooksCatalog() : [];
      for (const book of catalog) {
        if (localIds.has(book.url) || (typeof profileAllowsMedia === 'function' && !profileAllowsMedia(book))) continue;
        try {
          const url = new URL(book.url);
          if (!['https:', 'http:'].includes(url.protocol)) continue;
          records.push({ id: 'url:' + book.url, title: book.title, category: book.category || 'Livros', format: url.pathname.split('.').pop().toLowerCase(), sourceUrl: book.url, remote: true });
        } catch { /* Ignore malformed legacy URLs. */ }
      }
      books = records; drawLibrary();
      if(window.LuxReaderCloud){
        try{
          const shared=await window.LuxReaderCloud.catalog();
          if(request!==libraryRequest||owner!==currentOwner())return;
          const approved=new Set(shared.map(book=>book.content_hash));
          books=records.filter(book=>book.origin!=='catalog'||approved.has(book.id));
          for(const book of shared){
            if(typeof profileAllowsMedia==='function'&&!profileAllowsMedia(book))continue;
            const index=books.findIndex(item=>item.id===book.content_hash);
            const meta={id:book.content_hash,title:book.title,authors:book.authors,description:book.description,cover_url:book.cover_url,category:book.category,format:book.format,sourceUrl:book.url,origin:'catalog',age_rating:book.age_rating,collection_path:book.collection_path||'',language_code:book.language_code||''};
            if(index>=0)books[index]={...books[index],...meta,language_code:meta.language_code||books[index].language_code||''};else books.push({...meta,remote:true});
          }
          drawLibrary();$('readingCloudStatus').textContent='Catálogo atualizado · seus arquivos pessoais continuam neste computador.';
        }catch(error){if(owner===currentOwner())$('readingCloudStatus').textContent='Catálogo indisponível agora. Sua biblioteca local continua acessível.';}
        window.LuxReaderCloud.flush();
      }
    } catch { status('Não foi possível abrir a biblioteca local. Tente novamente.'); }
  }
  function drawLibrary() {
    const grid = $('readingGrid'); grid.replaceChildren();
    const query = $('readingSearch').value.trim().toLocaleLowerCase('pt-BR');
    const category = $('readingCategory').value, author = $('readingAuthor').value;
    let visible = books.filter(book => (!query || `${book.title} ${book.category} ${book.authors||''} ${book.collection_path||''}`.toLocaleLowerCase('pt-BR').includes(query)) && (!category || book.category === category) && (!author || (book.authors || '') === author));
    let nav=$('readingCollectionNav');if(!nav){nav=element('nav','reading-collection-nav');nav.id='readingCollectionNav';nav.setAttribute('aria-label','Coleções da biblioteca');grid.before(nav);}
    nav.replaceChildren(button('Biblioteca',()=>{collectionPath='';drawLibrary();}));
    const segments=collectionPath.split('/').filter(Boolean);segments.forEach((part,index)=>{nav.append(element('span','','›'),button(part,()=>{collectionPath=segments.slice(0,index+1).join('/');drawLibrary();}));});
    if(collectionPath)visible=visible.filter(book=>{const path=String(book.collection_path||'').trim().replace(/\/+$/,'');return path===collectionPath||path.startsWith(collectionPath+'/');});
    const compareText=(a,b)=>String(a||'').localeCompare(String(b||''),'pt-BR',{numeric:true,sensitivity:'base'});
    if(readingSort==='title')visible.sort((a,b)=>compareText(a.title,b.title));
    else if(readingSort==='author')visible.sort((a,b)=>compareText(a.authors,b.authors)||compareText(a.title,b.title));
    else if(readingSort==='year')visible.sort((a,b)=>Number(b.published_year||0)-Number(a.published_year||0)||compareText(a.title,b.title));
    else visible.sort((a, b) => (store.readState(libraryOwner, b.id).updatedAt || b.addedAt || 0) - (store.readState(libraryOwner, a.id).updatedAt || a.addedAt || 0));
    if(collectionPath)visible.sort((a,b)=>compareText(a.title,b.title));
    $('readingCount').textContent = `${books.length} ${books.length === 1 ? 'obra na sua biblioteca' : 'obras na sua biblioteca'}`;
    $('readingEmpty').hidden = visible.length > 0;
    $('readingEmptyTitle').textContent = books.length ? 'Nenhuma obra encontrada' : 'Sua próxima leitura começa aqui';
    if(!query&&!collectionPath){
      const groups=new Map();
      for(const book of visible){const key=(book.collection_path||'').trim().replace(/\/+$/,'');if(!key)continue;const children=groups.get(key)||[];children.push(book);groups.set(key,children);}
      const sagaGroups=[...groups].filter(([name,items])=>items.length>1||/\b(?:19|20)\d{2}\b|saga|serie|series|cole[cç][aã]o|collection/i.test(name));
      for(const[name,children]of sagaGroups.sort(([a],[b])=>compareText(a,b))){
        const card=element('article','reading-card reading-collection-card'),open=button('',()=>{collectionPath=name;drawLibrary();},'reading-card-open'),cover=element('div','reading-cover');
        const source=children.find(b=>/^https:\/\//.test(b.cover_url||''));if(source){const img=element('img');img.src=source.cover_url;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';img.onerror=()=>img.remove();cover.append(img);}
        const parts=name.split('/').filter(Boolean),label=parts.length>1?parts[0]:(parts[0]||name);cover.append(element('span','reading-format','SAGA / COLEÇÃO'),element('span','reading-cover-glyph','▤'),element('strong','',label));
        const info=element('div','reading-card-info');info.append(element('h3','',label),element('p','',`${children.length} obras · abrir saga`));open.append(cover,info);card.append(open);grid.append(card);
      }
      const grouped=new Set(sagaGroups.map(([name])=>name));
      visible=visible.filter(book=>!grouped.has((book.collection_path||'').trim()));
    }
    for (const book of visible) {
      const saved = store.readState(libraryOwner, book.id);
      const card = element('article', 'reading-card');
      const open = button('', () => openBook(book), 'reading-card-open');
      const cover = element('div', 'reading-cover reading-cover-' + (['pdf','epub','cbr','cbz'].includes(book.format) ? book.format : 'images'));
      const language=languageOf(book);cover.append(element('span', 'reading-format', book.format === 'images' ? 'IMAGENS' : book.format.toUpperCase()), element('span', 'reading-cover-glyph', book.category === 'HQs' ? '✦' : '¶'), element('strong', '', book.title));
      if(language)cover.append(LuxLanguage.badge(language));
      if(/^https:\/\//.test(book.cover_url||'')){
        const image=element('img');image.src=book.cover_url;image.alt='Capa de '+book.title;image.loading='lazy';image.referrerPolicy='no-referrer';image.onerror=()=>image.remove();cover.prepend(image);
      }
      const info = element('div', 'reading-card-info');
      info.append(element('span', 'reading-eyebrow', book.category), element('h3', '', book.title), element('p', '', book.remote ? 'Catálogo · baixar e ler' : stateLabel(saved, book)));
      if(book.authors)info.append(element('p','reading-author',book.authors));
      if((query||collectionPath)&&book.collection_path)info.append(element('small','reading-origin',book.collection_path));
      info.append(element('small','reading-origin',book.origin==='catalog'?'Catálogo Lux':'Arquivo pessoal · só neste PC'));
      const progress = element('progress'); progress.max = 1; progress.value = saved.progress || 0; progress.setAttribute('aria-label', 'Progresso de leitura'); info.append(progress);
      open.append(cover, info); card.append(open);
      if(book.description){const details=element('details','reading-description');details.append(element('summary','','Sobre a obra'),element('p','',book.description));card.append(details);}
      if (!book.remote) card.append(button(book.origin === 'catalog' ? 'Remover cópia local' : 'Apagar arquivo deste PC', async () => {
        const owner = libraryOwner;
        const action = book.origin === 'catalog' ? 'Remover a cópia baixada de' : 'Apagar o arquivo de';
        if (!confirm(`${action} “${book.title}” deste computador? Suas notas e progresso serão preservados.`)) return;
        try { await store.remove(owner, book.id,{keepState:true}); await refresh(); } catch { status('Não foi possível remover esta obra.'); }
      }, 'reading-remove'));
      grid.append(card);
    }
    const options = [...new Set(books.map(book => book.category).filter(Boolean))].sort();
    $('readingCategory').replaceChildren(new Option('Todos os gêneros', ''), ...options.map(value => new Option(value, value)));
    $('readingCategory').value = options.includes(category) ? category : '';
    const authors=[...new Set(books.map(book=>book.authors).filter(Boolean))].sort(compareText);
    $('readingAuthor').replaceChildren(new Option('Todos os autores',''),...authors.map(value=>new Option(value,value)));
    $('readingAuthor').value=authors.includes(author)?author:'';
    $('readingSort').value=readingSort;
  }
  function extractArchive(buffer, format, session) {
    return new Promise((resolve, reject) => {
      const worker = new Worker('js/vendor/reader-archive-worker.js');
      const timer = setTimeout(() => finish(new Error('Esta HQ demorou demais para abrir. Tente um arquivo menor.')), 60000);
      function finish(error, pages) { clearTimeout(timer); worker.terminate(); if (session) session.archiveCancel = null; error ? reject(error) : resolve(pages); }
      if (session) session.archiveCancel = () => finish(new Error('Leitura encerrada.'));
      worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.pages);
      worker.onerror = () => finish(new Error('Não foi possível abrir a HQ. Verifique se o arquivo é válido.'));
      worker.postMessage({ buffer, format }, [buffer]);
    });
  }
  async function importFile(file, owner, metadata = {}) {
    const format = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'epub', 'cbr', 'cbz'].includes(format)) throw new Error('Escolha PDF, EPUB, CBR ou CBZ.');
    if (!file.size || file.size > MAX_FILE) throw new Error('Cada arquivo deve ter entre 1 byte e 256 MB.');
    const id = await store.digest(file);
    if(metadata.expectedHash&&metadata.expectedHash!==id)throw new Error('O arquivo baixado difere do catálogo. Tente novamente ou avise o administrador.');
    const existing = (await store.list(owner)).find(book => book.id === id);
    if (existing) return existing;
    const book = { id, title: metadata.title || file.name.replace(/\.[^.]+$/, ''), format,
      category: metadata.category || $('readingImportCategory').value || (['cbr','cbz'].includes(format) ? 'HQs' : 'Livros'),
      fileName: file.name, addedAt: Date.now(), size: file.size, ...metadata };
    if(format==='epub'&&!book.language_code){
      try{const lib=await engine();book.language_code=await lib.epubLanguage(await file.arrayBuffer());}catch{}
    }
    await store.put(owner, book, [{ name: 'source', blob: file }]); return book;
  }
  async function importFiles(event, folder = false) {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length || importing) return;
    const owner = currentOwner(); if (!owner) return status('Entre em um perfil antes de importar.');
    importing = true; $('readingImportFile').disabled = $('readingImportFolder').disabled = true;
    try {
      if (folder) {
        const images = store.sortImages(files);
        if (!images.length) throw new Error('A pasta não contém imagens JPG ou PNG.');
        if (images.length > 2000 || images.some(file => file.size > 40 * 1024 * 1024) || images.reduce((sum, file) => sum + file.size, 0) > 512 * 1024 * 1024) throw new Error('Use até 2.000 imagens, 40 MB por imagem e 512 MB por pasta.');
        const signatures = [];
        for (let i = 0; i < images.length; i++) {
          if (owner !== currentOwner()) return;
          status(`Preparando imagem ${i + 1} de ${images.length}…`);
          signatures.push([images[i].webkitRelativePath || images[i].name, await store.digest(images[i])]);
        }
        const id = await store.digest(JSON.stringify(signatures));
        const book = { id, title: images[0].webkitRelativePath?.split('/')[0] || 'Pasta de imagens', category: $('readingImportCategory').value || 'HQs', format: 'images', total: images.length, addedAt: Date.now(), pages: images.map((file, i) => ({ name: String(i), label: file.name })) };
        await store.put(owner, book, images.map((file, i) => ({ name: String(i), blob: file })));
        status('Pasta importada. As páginas estão em ordem numérica.');
      } else {
        let completed = 0; const errors = [];
        for (const file of files) {
          if (owner !== currentOwner()) return;
          status(`Importando ${file.name}…`);
          try { await importFile(file, owner); completed++; } catch (error) { errors.push(`${file.name}: ${error.message}`); }
        }
        status(`${completed} arquivo(s) importado(s). ${errors.join(' ')}`);
      }
      if (owner === currentOwner()) await refresh();
    } catch (error) { status(error.name === 'QuotaExceededError' ? 'Sem espaço para importar. Libere espaço e tente novamente.' : error.message); }
    finally { importing = false; $('readingImportFile').disabled = $('readingImportFolder').disabled = false; }
  }
  function save(session, patch) {
    if (!valid(session) || session.loading) return;
    try { session.state = store.writeState(session.owner, session.book.id, patch); $('readerSaveStatus').textContent = window.LuxReaderCloud?.status(session.owner,session.book.id)?.message||'Salvo neste dispositivo'; }
    catch { $('readerSaveStatus').textContent = 'Falha ao salvar. Mantenha o leitor aberto e exporte suas notas.'; }
  }
  function updatePosition(session) {
    if (!valid(session)) return;
    const epub = session.book.format === 'epub';
    $('readerPosition').textContent = epub ? (session.locationLabel || 'Preparando capítulos…') : `Página ${session.page} de ${session.total}`;
    $('readerProgress').value = session.state.progress || 0;
    $('readerPage').disabled = epub || !session.total;
    $('readerPage').max = session.total || 1; $('readerPage').value = session.page || 1;
    $('readerPrev').disabled = epub ? !!session.atStart : session.page <= 1;
    $('readerNext').disabled = epub ? !!session.atEnd : session.page >= session.total;
    extras?.renderMarks();
  }
  async function downloadBook(book, session) {
    if (!['pdf','epub','cbr','cbz'].includes(book.format)) throw new Error('O link do catálogo precisa terminar em .pdf, .epub, .cbr ou .cbz.');
    const response = await fetch(book.sourceUrl, { signal: session.controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error('Não foi possível baixar a obra. Verifique o link do catálogo.');
    if (Number(response.headers.get('content-length')) > MAX_FILE) throw new Error('O arquivo excede 256 MB.');
    const reader = response.body.getReader(), chunks = []; let size = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE) { await reader.cancel(); throw new Error('O arquivo excede 256 MB.'); }
      chunks.push(value);
    }
    if (!valid(session)) throw new Error('Leitura encerrada.');
    return importFile(new File(chunks, `obra.${book.format}`), session.owner, { title: book.title, category: book.category, sourceUrl: book.sourceUrl,origin:book.origin,authors:book.authors,description:book.description,cover_url:book.cover_url,language_code:book.language_code||'',...(book.origin==='catalog'?{expectedHash:book.id}:{}) });
  }
  async function openBook(book) {
    closeReader();
    const owner = currentOwner(); if (!owner) return;
    const session = { owner, book, loading: true, token: ++generation, state: {}, page: 1, total: 0, renderId: 0, controller: new AbortController() };
    active = session;
    $('readerDialog').showModal(); $('readerTitle').textContent = book.title;
    $('readerMessage').textContent = book.remote ? 'Baixando para sua biblioteca…' : 'Preparando sua leitura…';
    $('readerStage').replaceChildren(); $('readerPanel').hidden = true; $('readerShell').classList.remove('has-panel');
    $('readerNotes').value = ''; $('readerDictionaryResult').replaceChildren(); $('readerWord').value = '';
    $('readerSaveStatus').textContent = ''; $('readerProgress').value = 0;
    $('readerPrev').disabled = $('readerNext').disabled = $('readerPage').disabled = true;
    $('readerNotesButton').disabled = $('readerDictionaryButton').disabled = true;
    try {
      if (book.remote) { book = await downloadBook(book, session); if (!valid(session)) return; session.book = book; }
      if(window.LuxReaderCloud){$('readerMessage').textContent='Recuperando sua última leitura…';await window.LuxReaderCloud.sync(owner,book.id);if(!valid(session))return;}
      session.state = store.readState(owner, book.id);
      session.page = Math.max(1, Number(session.state.page) || 1);
      $('readerNotes').value = session.state.notes || '';
      extras?.load();
      session.loading = false;
      $('readerNotesButton').disabled = $('readerDictionaryButton').disabled = false;
      $('readerTheme').value = session.state.theme || 'dark';
      $('readerZoom').value = session.state.zoom || '1';
      $('readerFont').value = session.state.fontSize || '110';
      $('readerShell').dataset.theme = $('readerTheme').value;
      $('readerFontLabel').hidden = book.format !== 'epub'; $('readerZoomLabel').hidden = book.format === 'epub';
      if (book.format === 'images') {
        $('readerMessage').textContent = '';
        session.pages = book.pages; session.total = book.total;
        await renderPage(session);
      } else {
        const record = await store.getFile(owner, book.id, 'source');
        if (!record?.blob) throw new Error('Arquivo local não encontrado. Importe a obra novamente.');
        const buffer = await record.blob.arrayBuffer(); if (!valid(session)) return;
        if (['cbr','cbz'].includes(book.format)) {
          session.pages = await extractArchive(buffer, book.format, session); if (!valid(session)) return;
          $('readerMessage').textContent = '';
          session.total = session.pages.length; await renderPage(session);
        } else {
          const lib = await engine(); if (!valid(session)) return;
          if (book.format === 'pdf') {
            session.pdfTask = lib.pdfjs.getDocument({ data: buffer, ...lib.pdfAssets });
            session.pdfTask.onPassword = (_update, reason) => {
              if (valid(session)) $('readerMessage').textContent = 'PDF protegido por senha. Importe uma cópia desbloqueada.';
              session.pdfTask.destroy();
            };
            session.pdf = await session.pdfTask.promise; if (!valid(session)) return;
            $('readerMessage').textContent = '';
            session.total = session.pdf.numPages; await renderPage(session);
          } else if (book.format === 'epub') { await openEpub(session, buffer, lib); if (valid(session)) $('readerMessage').textContent = ''; }
          else throw new Error('Formato não suportado.');
        }
      }
      if (valid(session)) updatePosition(session);
    } catch (error) {
      if (valid(session)) $('readerMessage').textContent = error.name === 'AbortError' ? 'Download cancelado.' : `Não foi possível abrir: ${error.message || 'arquivo inválido ou danificado'}`;
    }
  }
  async function renderPage(session) {
    if (!valid(session) || !session.total) return;
    const renderId = ++session.renderId;
    session.page = Math.max(1, Math.min(session.total, Math.round(session.page)));
    const pageNumber = session.page;
    session.renderTask?.cancel(); session.textLayer?.cancel();
    const stage = $('readerStage');
    const zoom = Number($('readerZoom').value) || 1;
    try {
      if (session.pdf) {
        const page = await session.pdf.getPage(pageNumber);
        if (!valid(session) || renderId !== session.renderId) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.max(.25, Math.min((stage.clientWidth - 48) / base.width, (stage.clientHeight - 32) / base.height)) * zoom;
        const viewport = page.getViewport({ scale });
        const paper = element('div', 'reader-paper'); paper.style.width = `${viewport.width}px`; paper.style.height = `${viewport.height}px`;
        paper.style.setProperty('--scale-factor', scale);
        paper.style.setProperty('--total-scale-factor', scale);
        const canvas = document.createElement('canvas'), ratio = Math.min(devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio); canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`; canvas.style.height = `${viewport.height}px`;
        paper.append(canvas);
        session.renderTask = page.render({ canvasContext: canvas.getContext('2d'), viewport, transform: [ratio, 0, 0, ratio, 0, 0] });
        await session.renderTask.promise;
        if (!valid(session) || renderId !== session.renderId) return;
        const lib = await engine(), text = element('div', 'textLayer'); paper.append(text);
        session.textLayer = new lib.pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: text, viewport });
        await session.textLayer.render();
        if(!valid(session)||renderId!==session.renderId)return;
        swapPage(session,paper);
      } else {
        const entry = session.pages[pageNumber - 1];
        const blob = entry.blob || (await store.getFile(session.owner, session.book.id, entry.name))?.blob;
        if (!valid(session) || renderId !== session.renderId) return;
        if (!blob) throw new Error('Página não encontrada.');
        const url = URL.createObjectURL(blob), image = element('img', 'reader-image');
        image.alt = `${session.book.title} — página ${pageNumber}`; image.src = url;
        try { await image.decode(); } catch { URL.revokeObjectURL(url); throw new Error('Imagem inválida ou danificada.'); }
        if (!valid(session) || renderId !== session.renderId) { URL.revokeObjectURL(url); return; }
        if (session.imageUrl) URL.revokeObjectURL(session.imageUrl); session.imageUrl = url;
        const fit = Math.min((stage.clientWidth - 40) / image.naturalWidth, (stage.clientHeight - 32) / image.naturalHeight);
        image.style.width = `${Math.max(1, image.naturalWidth * fit * zoom)}px`;
        swapPage(session,image);
      }
      if (!valid(session) || renderId !== session.renderId) return;
      save(session, { page: pageNumber, total: session.total, progress: pageNumber / session.total });
      updatePosition(session); $('readerMessage').textContent = '';
    } catch (error) {
      if (valid(session) && renderId === session.renderId && error.name !== 'RenderingCancelledException' && error.name !== 'AbortException') $('readerMessage').textContent = `Erro nesta página: ${error.message}`;
    }
  }
  async function openEpub(session, buffer, lib) {
    session.epub = lib.ePub();
    await session.epub.open(buffer, 'binary'); if (!valid(session)) return;
    session.epub.spine.hooks.serialize.register((html, section) => { section.output = lib.sanitizeChapter(html); });
    const rendition = session.epub.renderTo($('readerStage'), { width: '100%', height: '100%', spread: 'none', flow: 'paginated', allowScriptedContent: false, allowPopups: false });
    session.rendition = rendition;
    rendition.hooks.content.register(contents => {
      contents.document.addEventListener('selectionchange', () => { session.selection = contents.window.getSelection()?.toString().trim().slice(0, 5000) || ''; });
      const text=contents.document.body?.innerText||'';
      if(!session.book.language_code||session.book.language_code==='unknown'){const info=LuxLanguage.detect(text,session.epub.packaging?.metadata?.language);session.book.language_code=info.code;session.book.language_sample=text.slice(0,4000);store.put(session.owner,session.book,[]).catch(()=>{});updateLanguageUI(session);}
      contents.document.addEventListener('keydown', onKey);
      contents.document.addEventListener('click', event => {
        const anchor = event.target.closest?.('a');
        if (anchor && /^(https?:|javascript:|file:|data:)/i.test(anchor.getAttribute('href') || '')) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
    });
    rendition.on('relocated', location => {
      if (!valid(session)) return;
      session.epubReady = true;
      session.location=location;
      const start = location.start;
      session.atStart = location.atStart; session.atEnd = location.atEnd;
      const chapters = Math.max(1, session.epub.spine.length);
      const chapter = Number(start.index) || 0;
      const fraction = Math.max(0, ((start.displayed?.page || 1) - 1) / (start.displayed?.total || 1));
      const progress = location.atEnd ? 1 : (chapter + fraction) / chapters;
      session.locationLabel = `Capítulo ${chapter + 1}/${chapters} · página ${start.displayed?.page || 1}/${start.displayed?.total || 1}`;
      save(session, { cfi: start.cfi, progress }); updatePosition(session);
    });
    applyEpubTheme(session);
    const startChapter=Math.max(1,Math.min(session.epub.spine.length,Number(session.state.startChapter||session.book.startChapter||1)));
    session.startChapter=startChapter;
    try { await rendition.display(session.state.cfi || session.epub.spine.get(startChapter-1)?.href || undefined); }
    catch { if (valid(session)) await rendition.display(); }
  }
  function applyEpubTheme(session) {
    if (!session.rendition) return;
    const palette = { dark: ['#191321', '#e9e0ef'], sepia: ['#f3e8d1', '#493a29'], light: ['#ffffff', '#23212a'] }[$('readerTheme').value];
    session.rendition.themes.default({ body: { background: `${palette[0]} !important`, color: `${palette[1]} !important`, 'line-height': '1.8 !important', 'font-family': 'Georgia, serif !important', padding: '0 20px !important' }, 'p, h1, h2, h3, span, li': { color: 'inherit !important' }, '::selection': { background: '#a78bfa66' } });
    session.rendition.themes.fontSize($('readerFont').value + '%');
  }
  async function navigate(direction) {
    const session = active; if (!session || !valid(session)) return;
    try {
      session.turnDirection=direction;
      if (session.rendition) { if (session.navigating) return; session.navigating = true; await (direction > 0 ? session.rendition.next() : session.rendition.prev());animatePage(session,$('readerStage').firstElementChild); }
      else { session.page += direction; await renderPage(session); }
    } catch { if (valid(session)) $('readerMessage').textContent = 'Não foi possível mudar de página.'; }
    finally { session.navigating = false; }
  }
  function closeReader() {
    clearTimeout(resizeTimer);
    const session = active;
    if (session) {
      if (!session.book.remote && !session.loading) save(session, { notes: $('readerNotes').value });
      window.LuxReaderCloud?.sync(session.owner,session.book.id);
      active = null; ++generation;
      session.controller.abort(); session.dictionaryController?.abort(); session.archiveCancel?.();
      session.renderTask?.cancel(); session.textLayer?.cancel();
      session.pdfTask?.destroy()?.catch(() => {});
      try { session.epub?.destroy(); } catch { /* Already destroyed after a load failure. */ }
      if (session.imageUrl) URL.revokeObjectURL(session.imageUrl);
    }
    $('readerStage').replaceChildren();
    $('readerPageMarksBadge')?.setAttribute('hidden','');
    if ($('readerDialog').open) $('readerDialog').close();
    if (libraryOwner === currentOwner()) drawLibrary();
  }
  function panel(type) {
    const session = active; if (!session) return;
    const selected = window.getSelection()?.toString().trim() || session.selection || '';
    const opening = $('readerPanel').hidden || $('readerPanel').dataset.type !== type;
    $('readerPanel').hidden = !opening; $('readerPanel').dataset.type = type;
    $('readerShell').classList.toggle('has-panel', opening);
    $('readerNotesPanel').hidden = type !== 'notes'; $('readerDictionaryPanel').hidden = type !== 'dictionary';
    if($('readerMarksPanel'))$('readerMarksPanel').hidden=type!=='marks';
    $('readerPanelTitle').textContent = type === 'notes' ? 'Bloco de notas' : type==='marks'?'Comentários da página':'Dicionário';
    if(opening&&type==='marks')extras?.renderMarks();
    if (opening && type === 'dictionary') { if (selected) $('readerWord').value = selected.slice(0, 80); $('readerWord').focus(); }
    if (opening && type === 'notes') $('readerNotes').focus();
  }
  async function dictionary(event) {
    event.preventDefault(); const session = active; if (!session) return;
    const word = $('readerWord').value.trim().toLocaleLowerCase('pt-BR');
    const result = $('readerDictionaryResult');
    if (!/^[\p{L}\p{M} -]{1,80}$/u.test(word)) { result.textContent = 'Digite uma palavra de até 80 caracteres.'; return; }
    session.dictionaryController?.abort();
    const controller = new AbortController(); session.dictionaryController = controller;
    result.textContent = 'Consultando o Wikcionário…';
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const params = new URLSearchParams({ action: 'query', format: 'json', origin: '*', prop: 'extracts', explaintext: '1', exchars: '6000', redirects: '1', titles: word });
      const response = await fetch('https://pt.wiktionary.org/w/api.php?' + params, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!valid(session) || session.dictionaryController !== controller) return;
      const page = Object.values(data.query?.pages || {})[0];
      result.replaceChildren(element('p', '', page?.extract || 'Nenhuma definição encontrada. Confira a grafia ou tente a palavra no singular.'));
      const source = element('a', '', 'Fonte: Wikcionário · CC BY-SA');
      source.href = 'https://pt.wiktionary.org/wiki/' + encodeURIComponent(word); source.target = '_blank'; source.rel = 'noopener noreferrer';
      source.onclick = event => { if (window.luxElectron?.openReaderSource) { event.preventDefault(); window.luxElectron.openReaderSource(source.href).catch(() => { result.append(element('p', '', 'Não foi possível abrir a fonte no navegador.')); }); } };
      result.append(source);
    } catch { if (valid(session) && session.dictionaryController === controller) result.textContent = 'Consulta indisponível. Verifique sua conexão e tente novamente.'; }
    finally { clearTimeout(timer); }
  }
  function onKey(event) {
    if (!active || event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName) || event.target.isContentEditable) return;
    if (event.key === 'ArrowRight' || event.key === 'PageDown') { event.preventDefault(); navigate(1); }
    if (event.key === 'ArrowLeft' || event.key === 'PageUp') { event.preventDefault(); navigate(-1); }
    if (event.key === 'Escape') { event.preventDefault(); closeReader(); }
  }
  $('readingSearch').oninput = drawLibrary; $('readingCategory').onchange = drawLibrary; $('readingAuthor').onchange = drawLibrary; $('readingSort').onchange = event=>{readingSort=event.target.value;drawLibrary();};
  $('readingFiles').onchange = event => importFiles(event);
  $('readingFolder').onchange = event => importFiles(event, true);
  $('readingImportFile').onclick = () => $('readingFiles').click();
  $('readingImportFolder').onclick = () => $('readingFolder').click();
  $('readerClose').onclick = closeReader;
  $('readerDialog').addEventListener('cancel', event => { event.preventDefault(); closeReader(); });
  $('readerPrev').onclick = () => navigate(-1); $('readerNext').onclick = () => navigate(1);
  $('readerPageForm').onsubmit = event => { event.preventDefault(); if (active && !active.rendition) { active.page = Number($('readerPage').value) || 1; renderPage(active); } };
  $('readerNotesButton').onclick = () => panel('notes'); $('readerDictionaryButton').onclick = () => panel('dictionary');
  $('readerPanelClose').onclick = () => { $('readerPanel').hidden = true; $('readerShell').classList.remove('has-panel'); };
  $('readerNotes').oninput = () => { if (active) save(active, { notes: $('readerNotes').value }); };
  $('readerNotePosition').onclick = () => {
    if (!active) return;
    $('readerNotes').value += `\n\n[${$('readerPosition').textContent}]\n`; save(active, { notes: $('readerNotes').value }); $('readerNotes').focus();
  };
  $('readerExportNotes').onclick = () => {
    if (!active) return;
    const url = URL.createObjectURL(new Blob([`${active.book.title}\n\n${$('readerNotes').value}`], { type: 'text/plain;charset=utf-8' }));
    const link = element('a'); link.href = url; link.download = active.book.title.replace(/[\\/:*?"<>|]/g, '_') + '-notas.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  };
  $('readerDictionaryForm').onsubmit = dictionary;
  $('readerStartChapter').onchange=()=>{if(!active?.rendition)return;const chapter=Math.max(1,Math.min(active.epub.spine.length,Number($('readerStartChapter').value)||1));active.startChapter=chapter;save(active,{startChapter:chapter,cfi:''});active.rendition.display(active.epub.spine.get(chapter-1)?.href||undefined);};
  for (const id of ['readerTheme', 'readerFont', 'readerZoom']) $(id).onchange = () => {
    if (!active) return;
    $('readerShell').dataset.theme = $('readerTheme').value;
    save(active, { theme: $('readerTheme').value, fontSize: $('readerFont').value, zoom: $('readerZoom').value });
    if (active.rendition) applyEpubTheme(active); else renderPage(active);
  };
  document.addEventListener('keydown', onKey);
  let resizeTimer, lastSize = '';
  new ResizeObserver(() => {
    const size = `${$('readerStage').clientWidth}:${$('readerStage').clientHeight}`;
    if (size === lastSize) return; lastSize = size;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (active?.epubReady && active.rendition?.manager) active.rendition.resize($('readerStage').clientWidth, $('readerStage').clientHeight);
      else if (active?.pdf || active?.pages) renderPage(active);
    }, 180);
  }).observe($('readerStage'));
  window.addEventListener('beforeunload', () => { if (active) save(active, { notes: $('readerNotes').value }); });
  function animatePage(session,node){
    const direction=session.turnDirection||0;session.turnDirection=0;
    if(!direction||!node||session.state.effect==='none'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    node.getAnimations().forEach(animation=>animation.cancel());
    const turn=session.state.effect!=='slide';
    node.animate([{opacity:.45,transform:turn?`perspective(1400px) translateX(${direction*35}px) rotateY(${direction*-8}deg)`:`translateX(${direction*45}px)`},{opacity:1,transform:'none'}],{duration:turn?310:220,easing:'cubic-bezier(.2,.75,.25,1)'});
  }
  function swapPage(session,node){const stage=$('readerStage');stage.replaceChildren(node);stage.scrollTop=0;animatePage(session,node);}
  async function jump(anchor){const s=active;if(!s)return;if(s.rendition&&anchor.cfi)await s.rendition.display(anchor.cfi);else if(anchor.page){s.turnDirection=anchor.page>s.page?1:-1;s.page=anchor.page;await renderPage(s);}}
  if(window.createReaderExtras)extras=window.createReaderExtras({getSession:()=>active,save,engine,openPanel:panel,jump});
  window.addEventListener('lux-reading-sync',event=>{
    const s=active,d=event.detail;if(!s||s.owner!==d.owner||s.book.id!==d.id||!valid(s))return;
    $('readerSaveStatus').textContent=d.message;
    if(d.state==='synced'||d.state==='pending'){
      s.state=store.readState(s.owner,s.book.id);
      if(!s.state._records?.notebook?.dirty&&$('readerNotes').value!==(s.state.notes||''))$('readerNotes').value=s.state.notes||'';
      extras?.renderMarks();extras?.renderRecoveries();
      if(s.state.syncNotice)$('readerSaveStatus').textContent=s.state.syncNotice;
    }
  });
  window.LuxReader = { refresh, close: closeReader, open: openBook };
})();
