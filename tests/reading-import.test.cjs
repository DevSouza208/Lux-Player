const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const JSZip=require('jszip'),{createExtractorFromData}=require('node-unrar-js');
const source=fs.readFileSync('js/reading-import-core.js','utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'');
const api=vm.runInNewContext(source+'\n;({groupFiles,cleanPath,archiveEntries,imagesToBook,unpackPublications});',{JSZip,createExtractorFromData,Uint8Array,ArrayBuffer,Date});
const bytes=s=>new TextEncoder().encode(s),buffer=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
test('folder import preserves nested collections and groups each direct image folder separately',()=>{
 const plan=api.groupFiles([{name:'02.cbr',path:'Deadpool/2013/02.cbr',index:0},{name:'10.png',path:'Revistas/A/10.png',index:1},{name:'2.jpg',path:'Revistas/A/2.jpg',index:2},{name:'1.png',path:'Revistas/B/1.png',index:3},{name:'ignored.png',path:'__MACOSX/ignored.png',index:4}]);
 assert.equal(plan.publications[0].path,'Deadpool/2013');assert.equal(plan.images.length,2);assert.deepEqual(Array.from(plan.images[0].files,f=>f.name),['2.jpg','10.png']);assert.equal(plan.images[1].title,'B');
});
test('ZIP containing books and multiple image folders produces independent ordered publications without recompressing images',async()=>{
 const zip=new JSZip();zip.file('Deadpool/2013/02.cbr',bytes('cbr'));zip.file('Revistas/A/10.png',bytes('page10'));zip.file('Revistas/A/2.png',bytes('page2'));zip.file('Revistas/B/1.jpg',bytes('page1'));
 const result=await api.unpackPublications(await zip.generateAsync({type:'arraybuffer'}),'Colecao.zip','Marvel');
 assert.equal(result.length,3);assert.equal(result[0].collection_path,'Marvel/Colecao/Deadpool/2013');
 const magazine=result.find(p=>p.title==='A');assert.equal(magazine.collection_path,'Marvel/Colecao/Revistas');assert.equal(magazine.format,'cbz');
 const cbz=await JSZip.loadAsync(magazine.bytes);assert.equal(await cbz.file('00001.png').async('string'),'page2');assert.equal(await cbz.file('00002.png').async('string'),'page10');
});
test('generated CBZ identity is stable on retry and nested archives retain their hierarchy',async()=>{
 const images=[{name:'2.png',bytes:bytes('second')},{name:'1.png',bytes:bytes('first')}];
 const a=await api.imagesToBook(images,'Revista','Colecao'),b=await api.imagesToBook(images,'Revista','Colecao');assert.deepEqual(a.bytes,b.bytes);
 const inner=new JSZip();inner.file('Livro.pdf',bytes('%PDF'));const outer=new JSZip();outer.file('Sagas/Interno.zip',await inner.generateAsync({type:'uint8array'}));
 const items=await api.unpackPublications(await outer.generateAsync({type:'arraybuffer'}),'Externo.zip');assert.equal(items[0].collection_path,'Externo/Sagas/Interno');
});
test('archives reject traversal, oversized declarations, empty contents and excessive nesting',async()=>{
 assert.throws(()=>api.cleanPath('../outside.png'),/inválido/);
 const evil=new JSZip();evil.file('../outside.png',bytes('x'));await assert.rejects(api.archiveEntries(await evil.generateAsync({type:'arraybuffer'}),'zip'),/inválido/);
 const zip=new JSZip();zip.file('file.png',bytes('x'));const oversized=await zip.generateAsync({type:'nodebuffer',compression:'STORE'});const central=oversized.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));oversized.writeUInt32LE(600*1024*1024,central+24);await assert.rejects(api.archiveEntries(buffer(oversized),'zip'),/limites/);
 const empty=new JSZip();empty.file('readme.txt','nothing');await assert.rejects(api.unpackPublications(await empty.generateAsync({type:'arraybuffer'}),'empty.zip'),/Nenhuma/);
 await assert.rejects(api.unpackPublications(new ArrayBuffer(0),'nested.zip','',null,3),/três níveis/);
});
