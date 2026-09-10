// Real Electron smoke test. Uses an isolated profile and synthetic, redistributable fixtures.
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const JSZip = require('jszip');
const crc32 = require('jszip/lib/crc32');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'release/reader-validation');
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'electron-profile'));
app.disableHardwareAcceleration();
const log = message => fs.appendFileSync(path.join(output, 'result.txt'), message + '\n');
fs.writeFileSync(path.join(output, 'result.txt'), '');
function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 680] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>', '',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 480 680] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>', '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ];
  for (const [index, text] of [[3, 'Lux Leitura - Primeira pagina'], [5, 'Lux Leitura - Segunda pagina']]) {
    const content = `BT /F1 22 Tf 40 590 Td (${text}) Tj ET`;
    objects[index] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  }
  let result = '%PDF-1.4\n', offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(result)); result += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(result);
  result += `xref\n0 8\n0000000000 65535 f \n${offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(result);
}
function rarFixture(png) {
  const header = (type, flags, rest) => {
    const data = Buffer.alloc(7 + rest.length); data[2] = type; data.writeUInt16LE(flags, 3); data.writeUInt16LE(data.length, 5); rest.copy(data, 7);
    data.writeUInt16LE(crc32(data.subarray(2)) & 0xffff, 0); return data;
  };
  const chunks = [Buffer.from([0x52,0x61,0x72,0x21,0x1a,0x07,0x00]), header(0x73, 0, Buffer.alloc(6))];
  for (const name of ['10.png', '2.png', '1.png']) {
    const rest = Buffer.alloc(25 + name.length);
    rest.writeUInt32LE(png.length, 0); rest.writeUInt32LE(png.length, 4); rest[8] = 2;
    rest.writeUInt32LE(crc32(png) >>> 0, 9); rest[17] = 20; rest[18] = 0x30;
    rest.writeUInt16LE(name.length, 19); rest.writeUInt32LE(0x20, 21); rest.write(name, 25);
    chunks.push(header(0x74, 0x8000, rest), png);
  }
  chunks.push(header(0x7b, 0, Buffer.alloc(0))); return Buffer.concat(chunks);
}
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, offscreen: true } });
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 2 || message.startsWith('CHECK:')) log('CONSOLE: ' + message); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace('<head>', `<head><base href="${pathToFileURL(root + path.sep).href}">`);
  html = html.replace('</body>', `<style>*{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#09060e;color:#fff}body>*:not(#mainDashboard):not(dialog){display:none!important}#mainDashboard{height:100vh}#mainDashboard>*:not(#readingSection){display:none!important}#readingSection{height:100vh}.hidden{display:none}</style><script>let currentUser={user:'reader-test',profile:{data_key:'adult',slot:1}};function getAdminBooksCatalog(){return []}</script><script src="js/reader-store.js"></script><script src="js/reading-language.js"></script><script src="js/reader-extras.js"></script><script src="js/reader.js"></script><script src="js/reading-metadata.js"></script><script src="js/reading-admin.js"></script><script src="js/reading-import.js"></script></body>`);
  const harness = path.join(output, 'harness.html'); fs.writeFileSync(harness, html);
  const timeout = setTimeout(() => { log('FAIL: smoke timeout'); app.exit(1); }, 90000);
  try {
    await window.loadFile(harness);
    const image = nativeImage.createFromBitmap(Buffer.alloc(160 * 240 * 4, 180), { width: 160, height: 240 });
    const png = image.toPNG();
    const zip = new JSZip(); zip.file('10.png', png); zip.file('2.png', png); zip.file('1.png', png);
    const epub = new JSZip(); epub.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
    epub.file('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>');
    epub.file('book.opf', '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">lux-test</dc:identifier><dc:title>Uma biblioteca de ideias</dc:title><dc:language>pt-BR</dc:language></metadata><manifest><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>');
    epub.file('nav.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sumário</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">Ideias</a></li><li><a href="two.xhtml">Descobertas</a></li></ol></nav></body></html>');
    for (const [file, title] of [['one.xhtml','Ideias que ficam'],['two.xhtml','Novas descobertas']]) epub.file(file, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${'<p>Ler é descobrir novos caminhos. Entre páginas e ideias, cada palavra abre uma janela para o mundo.</p>'.repeat(35)}<script>parent.__epubScriptRan=true;</script><img src="x" onerror="parent.__epubScriptRan=true"/></body></html>`);
    const fixtures = { pdf: pdfFixture().toString('base64'), epub: (await epub.generateAsync({ type: 'nodebuffer' })).toString('base64'), cbz: (await zip.generateAsync({ type: 'nodebuffer' })).toString('base64'), cbr: rarFixture(png).toString('base64'), png: png.toString('base64') };
    const collectionZip=new JSZip();collectionZip.file('Deadpool/2013/Edicao 02.cbr',rarFixture(png));collectionZip.file('Revistas/Numero 01/10.png',png);collectionZip.file('Revistas/Numero 01/2.png',png);
    fixtures.collection=(await collectionZip.generateAsync({type:'nodebuffer'})).toString('base64');
    const result = await window.webContents.executeJavaScript(`(async () => {
      const fixtures=${JSON.stringify(fixtures)};
      const check=(condition,message)=>{if(!condition)throw new Error(message)};
      const wait=async predicate=>{for(let i=0;i<150;i++){if(predicate())return;await new Promise(r=>setTimeout(r,40))}throw new Error('Timed out: '+predicate.toString())};
      const blob=key=>new Blob([Uint8Array.from(atob(fixtures[key]),c=>c.charCodeAt(0))]);
      const store=LuxReaderStore, owner=store.owner(currentUser), results=[];
      window.readerErrors=[];window.addEventListener('error',event=>readerErrors.push(event.message));
      for(const old of await store.list(owner))await store.remove(owner,old.id);
      document.getElementById('readingSection').classList.remove('hidden');
      for(const format of ['pdf','epub','cbz','cbr'])await store.put(owner,{id:format,format,title:format==='epub'?'Uma biblioteca de ideias':'Lux · '+format.toUpperCase(),category:format==='pdf'?'Artigos científicos':format==='epub'?'Livros':'HQs'},[{name:'source',blob:blob(format)}]);
      await store.put(owner,{id:'images',format:'images',title:'Páginas de uma descoberta',category:'HQs',total:3,pages:[{name:'1'},{name:'2'},{name:'3'}]},[1,2,3].map(i=>({name:String(i),blob:blob('png')})));
      await LuxReader.refresh();check(document.querySelectorAll('.reading-card').length===5,'five library cards');
      const transfer=new DataTransfer();transfer.items.add(new File([blob('pdf')],'Artigo importado.pdf'));
      document.getElementById('readingFiles').files=transfer.files;document.getElementById('readingFiles').dispatchEvent(new Event('change'));
      await wait(()=>!document.getElementById('readingImportFile').disabled);
      check((await store.list(owner)).some(book=>book.title==='Artigo importado'),'file import through UI');
      const epubTransfer=new DataTransfer();epubTransfer.items.add(new File([blob('epub')],'Idioma antes de abrir.epub'));
      document.getElementById('readingFiles').files=epubTransfer.files;document.getElementById('readingFiles').dispatchEvent(new Event('change'));
      await wait(()=>!document.getElementById('readingImportFile').disabled);
      const importedEpub=(await store.list(owner)).find(book=>book.title==='Idioma antes de abrir');
      check(importedEpub?.language_code==='pt-BR','EPUB language not extracted on import');
      const languageCard=[...document.querySelectorAll('.reading-card')].find(card=>card.textContent.includes('Idioma antes de abrir'));
      const flag=languageCard?.querySelector('.reading-language-badge img');
      check(flag?.getAttribute('src')==='js/flags/br.svg','Missing local flag before first reading');
      await wait(()=>flag.complete&&flag.naturalWidth>0);
      check(!document.querySelector('.reading-translation-badge'),'Removed translation badge still visible');
      const folder=new DataTransfer();
      for(const name of ['10.png','2.png','1.png']){const file=new File([blob('png')],name,{type:'image/png'});Object.defineProperty(file,'webkitRelativePath',{value:'Pasta de teste/'+name});folder.items.add(file)}
      document.getElementById('readingFolder').files=folder.files;document.getElementById('readingFolder').dispatchEvent(new Event('change'));
      await wait(()=>!document.getElementById('readingImportFolder').disabled);
      const importedFolder=(await store.list(owner)).find(book=>book.title==='Pasta de teste');
      check(importedFolder?.pages.map(page=>page.label).join(',')==='1.png,2.png,10.png','folder import preserves numeric order');
      results.push('file and folder import through UI OK');
      for(const id of ['pdf','cbz','cbr','images']){
        console.log('CHECK: opening '+id);
        const book=(await store.list(owner)).find(book=>book.id===id);
        await LuxReader.open(book);
        await wait(()=>document.querySelector('#readerStage canvas, #readerStage img') || document.getElementById('readerMessage').textContent);
        check(!document.getElementById('readerMessage').textContent,id+': '+document.getElementById('readerMessage').textContent);
        check(document.querySelector('#readerStage canvas, #readerStage img'),id+' rendered');
        document.getElementById('readerNext').click();await wait(()=>store.readState(owner,id).page===2);
        document.getElementById('readerNotesButton').click();
        document.getElementById('readerNotes').value='Nota em '+id;document.getElementById('readerNotes').dispatchEvent(new Event('input'));
        LuxReader.close();await LuxReader.open(book);
        check(store.readState(owner,id).page===2,id+' resumes page');
        check(document.getElementById('readerNotes').value==='Nota em '+id,id+' restores note');
        document.getElementById('readerMarksButton').click();
        document.getElementById('readerMarkText').value='Comentário **especial** na página 2';document.getElementById('readerMarkForm').dispatchEvent(new Event('submit',{cancelable:true}));
        check(!document.getElementById('readerPageMarksBadge').hidden,id+' marker visible on annotated page');
        document.getElementById('readerPrev').click();await wait(()=>store.readState(owner,id).page===1);
        check(document.getElementById('readerPageMarksBadge').hidden,id+' marker hidden on another page');
        document.getElementById('readerNext').click();await wait(()=>store.readState(owner,id).page===2);
        check(!document.getElementById('readerPageMarksBadge').hidden,id+' marker returns with its page');
        LuxReader.close();results.push(id+' render + resume + notes OK');
      }
      const book=(await store.list(owner)).find(book=>book.id==='epub');
      console.log('CHECK: opening epub');
      await LuxReader.open(book);
      check(!document.getElementById('readerMessage').textContent,'epub: '+document.getElementById('readerMessage').textContent);
      await wait(()=>store.readState(owner,'epub').cfi);
      const before=store.readState(owner,'epub').cfi;
      document.getElementById('readerNext').click();await wait(()=>store.readState(owner,'epub').cfi!==before);
      const cfi=store.readState(owner,'epub').cfi;
      check(!window.__epubScriptRan,'EPUB scripts blocked');
      check(!document.querySelector('#readerStage iframe').sandbox.contains('allow-scripts'),'EPUB iframe sandboxed');
      LuxReader.close();await LuxReader.open(book);await wait(()=>store.readState(owner,'epub').cfi===cfi);
      await wait(()=>document.querySelector('#readerStage iframe')?.contentDocument?.body?.textContent.includes('Ler é descobrir'));
      results.push('epub rendering + CFI resume + script isolation OK');
      document.getElementById('readerMarksButton').click();
      document.getElementById('readerMarkText').value='Uma ideia neste trecho do EPUB';document.getElementById('readerMarkForm').dispatchEvent(new Event('submit',{cancelable:true}));
      check(!document.getElementById('readerPageMarksBadge').hidden,'EPUB bookmark visible');
      const markedCfi=store.readState(owner,'epub').cfi;document.getElementById('readerNext').click();await wait(()=>store.readState(owner,'epub').cfi!==markedCfi);
      check(document.getElementById('readerPageMarksBadge').hidden,'EPUB bookmark scoped to visible passage');
      document.getElementById('readerMarkFilter').value='all';document.getElementById('readerMarkFilter').dispatchEvent(new Event('change'));
      await document.querySelector('#readerMarksList article>button').onclick();await wait(()=>!document.getElementById('readerPageMarksBadge').hidden);
      results.push('EPUB passage marker + return to annotation OK');
      document.getElementById('readerNotesButton').click();
      document.getElementById('readerNotes').value='## Ideias que ficam\\n\\n**Ler é descobrir novos caminhos.**\\n\\n[cor=#c084fc]Uma palavra abre uma janela.[/cor] ✨\\n\\n- Uma descoberta\\n- Um novo olhar\\n\\n<img src=x onerror="window.__markdownAttack=true">';document.getElementById('readerNotes').dispatchEvent(new Event('input'));
      document.getElementById('readerPreviewNotes').click();await wait(()=>document.querySelector('#readerNotesPreview strong'));
      check(!window.__markdownAttack&&!document.querySelector('#readerNotesPreview img'),'Markdown sanitized');
      check(document.querySelector('#readerNotesPreview span[style]'),'Markdown color rendered');
      await new Promise(resolve=>setTimeout(resolve,500));
      check(readerErrors.length===0,'no uncaught reader errors: '+readerErrors.join('; '));
      return results;
    })()`);
    result.forEach(log);
    window.webContents.invalidate();
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(output, 'reader.png'), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript('LuxReader.close(); LuxReader.refresh().then(()=>new Promise(resolve=>setTimeout(resolve,500)))');
    fs.writeFileSync(path.join(output, 'library.png'), (await window.webContents.capturePage()).toPNG());
    await window.loadFile(harness);
    await window.webContents.executeJavaScript(`(async()=>{
      const owner=LuxReaderStore.owner(currentUser);
      const book=(await LuxReaderStore.list(owner)).find(book=>book.id==='pdf');
      if(!book || LuxReaderStore.readState(owner,'pdf').page!==2)throw new Error('Progress did not survive reload');
      await LuxReader.open(book);
      if(document.getElementById('readerNotes').value!=='Nota em pdf')throw new Error('Notes did not survive reload');
      const originalFetch=window.fetch;
      window.fetch=async url=>{if(!String(url).startsWith('https://pt.wiktionary.org/w/api.php?'))throw new Error('Unexpected dictionary endpoint');return {ok:true,json:async()=>({query:{pages:{1:{extract:'Uma palavra de teste.'}}}})}};
      document.getElementById('readerDictionaryButton').click();
      document.getElementById('readerWord').value='livro';
      await document.getElementById('readerDictionaryForm').onsubmit({preventDefault(){}});
      if(!document.getElementById('readerDictionaryResult').textContent.includes('Uma palavra de teste.'))throw new Error('Dictionary UI failed');
      window.fetch=originalFetch;LuxReader.close();
      currentUser={user:'other-test',profile:{data_key:'adult'}};await LuxReader.refresh();
      if(document.querySelectorAll('.reading-card').length)throw new Error('Library leaked to another account');
    })()`);
    log('reload persistence + dictionary UI + profile switch OK');
    await window.webContents.executeJavaScript(`(async()=>{
      LuxReader.close();currentUser={user:'admin-test',role:'admin',profile:{data_key:'admin',slot:1}};
      const fixtures=${JSON.stringify(fixtures)},blob=key=>new Blob([Uint8Array.from(atob(fixtures[key]),c=>c.charCodeAt(0))]);
      const rows=new Map();let sent=0,coverSent=0;
      window.LuxReaderCloud={schedule(){},flush(){},sync:async()=>true,status:()=>null,catalog:async()=>[...rows.values()],request:async(_name,body)=>{
        if(body.action==='prepare'){const old=[...rows.values()].find(b=>b.content_hash===body.hash);if(old?.upload_complete)return {book:old,alreadyUploaded:true};const book=old||{id:crypto.randomUUID(),...body.metadata,content_hash:body.hash,format:body.format,file_name:body.fileName,status:'pending',upload_complete:false,url:'https://media.test/book'};rows.set(book.id,book);return {book,uploadUrl:'https://upload.test/file',contentType:'application/pdf'}}
        const book=rows.get(body.id);
        if(body.action==='prepare-cover')return {uploadUrl:'https://upload.test/cover',contentType:'image/jpeg'};
        if(body.action==='confirm-cover'){book.cover_url='https://media.test/'+book.id+'.jpg';return {cover_url:book.cover_url}}
        if(body.action==='confirm'){book.upload_complete=true;return {book}}
        if(body.action==='status'){book.status=body.status;return {book}}
        if(body.action==='edit'){Object.assign(book,body.metadata);return {book}}
      }};
      const originalXHR=window.XMLHttpRequest;window.XMLHttpRequest=class{constructor(){this.upload={}}open(_method,url){this.url=url}setRequestHeader(){}send(body){if(this.url.endsWith('/cover')){coverSent++;if(!body.size||body.type!=='image/jpeg')throw Error('Invalid generated cover')}else sent++;this.status=200;this.upload.onprogress?.({lengthComputable:true,loaded:1,total:1});this.onload()}abort(){this.onabort?.()}};
      await LuxReadingAdmin.refresh();
      for(const format of ['pdf','cbr','cbz']){try{const generated=await LuxReadingImport.cover(new File([blob(format)],'cover.'+format),format);if(!generated?.size)throw Error('empty');console.log('CHECK: automatic cover '+format+' OK');}catch(error){throw Error('Automatic cover '+format+': '+error.message);}}
      const files=new DataTransfer();files.items.add(new File([blob('pdf')],'Livro A.pdf'));files.items.add(new File([blob('epub')],'Livro B.epub'));
      document.getElementById('readingAdminFiles').files=files.files;await document.getElementById('readingAdminFiles').onchange({target:document.getElementById('readingAdminFiles')});
      document.getElementById('readingMeta_title').value='Uma biblioteca de descobertas';document.getElementById('readingMeta_authors').value='Autor de exemplo';
      await document.getElementById('readingAdminForm').onsubmit({preventDefault(){}});
      const oldMetadata=LuxReadingMetadata.search;LuxReadingMetadata.search=async()=>[{title:'Uma biblioteca de descobertas',authors:'Autor de exemplo',description:'Uma obra para explorar novas ideias, guardar pensamentos e descobrir outros caminhos.',metadata_source:'Google Books',category:'Livros'}];
      await document.getElementById('readingAdminSearch').onclick();await document.getElementById('readingMetadataResults').firstElementChild.onclick();
      const archive=new DataTransfer();archive.items.add(new File([blob('collection')],'Marvel.zip'));archive.items.add(new File([blob('cbr')],'Revista RAR.rar'));
      document.getElementById('readingAdminFiles').files=archive.files;await document.getElementById('readingAdminFiles').onchange({target:document.getElementById('readingAdminFiles')});
      const folder=new DataTransfer();for(const name of ['10.png','2.png','1.png']){const file=new File([blob('png')],name);Object.defineProperty(file,'webkitRelativePath',{value:'Revistas/Pasta local/'+name});folder.items.add(file)}
      document.getElementById('readingAdminFolder').files=folder.files;await document.getElementById('readingAdminFolder').onchange({target:document.getElementById('readingAdminFolder')});
      if(document.querySelectorAll('.reading-admin-row').length!==6)throw Error('Expected six prepared works from files, ZIP, RAR and folder');
      if(!document.getElementById('readingAdminList').textContent.includes('Marvel/Deadpool/2013'))throw Error('Nested archive hierarchy lost');
      await document.getElementById('readingAdminUpload').onclick();
      if(sent<5||coverSent<4||[...rows.values()].some(row=>row.status!=='pending'||!row.upload_complete))throw Error('Batch must finish pending approval with generated covers: '+sent+'/'+coverSent);
      for(const checkbox of document.querySelectorAll('[data-reading-approve]'))checkbox.checked=true;
      await document.getElementById('readingAdminApprove').onclick();
      if([...rows.values()].some(row=>row.status!=='approved'))throw Error('Batch approval failed');
      if(![...rows.values()].some(row=>row.title==='Uma biblioteca de descobertas'))throw Error('Manual metadata lost');
      await LuxReader.refresh();const collection=[...document.querySelectorAll('.reading-collection-card')].find(card=>card.textContent.includes('Marvel'));if(!collection)throw Error('Library collection missing');collection.querySelector('button').click();
      if(!document.getElementById('readingCollectionNav').textContent.includes('Marvel')||!document.getElementById('readingGrid').textContent.includes('Deadpool'))throw Error('Collection navigation failed');
      document.getElementById('readingCollectionNav').querySelector('button').click();
      window.XMLHttpRequest=originalXHR;LuxReadingMetadata.search=oldMetadata;
      const preview=document.createElement('dialog');preview.style.cssText='width:1050px;max-width:95vw;height:85vh;overflow:auto;border:1px solid #785296;border-radius:20px;padding:25px;background:#110b1b;color:white';preview.append(document.getElementById('readingAdminRoot'));document.body.append(preview);preview.showModal();
      await new Promise(resolve=>setTimeout(resolve,300));
    })()`);
    window.webContents.invalidate();await new Promise(resolve=>setTimeout(resolve,200));
    fs.writeFileSync(path.join(output,'admin.png'),(await window.webContents.capturePage()).toPNG());
    log('admin ZIP/RAR/folders + first-page covers + collection navigation + metadata + batch approval UI OK');
    log('PASS'); clearTimeout(timeout); app.exit(0);
  } catch (error) { log('FAIL: ' + error.stack); fs.writeFileSync(path.join(output, 'failure.png'), (await window.webContents.capturePage()).toPNG()); log(await window.webContents.executeJavaScript('JSON.stringify({stage:document.getElementById("readerStage").getBoundingClientRect().toJSON(),content:document.getElementById("readerStage").innerHTML.slice(0,1000),position:document.getElementById("readerPosition").textContent})')); clearTimeout(timeout); app.exit(1); }
});
