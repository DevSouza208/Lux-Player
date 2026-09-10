import JSZip from 'jszip';
import { createExtractorFromData } from 'node-unrar-js/esm/index.esm.js';
export const MAX_FILE=256*1024*1024,MAX_EXPANDED=512*1024*1024;
export const natural=(a,b)=>a.localeCompare(b,'pt-BR',{numeric:true,sensitivity:'base'})||a.localeCompare(b);
const image=name=>/\.(jpe?g|png)$/i.test(name),book=name=>/\.(pdf|epub|cbr|cbz)$/i.test(name);
export function cleanPath(name){
 name=String(name).replace(/\\/g,'/').normalize('NFC');
 if(name.startsWith('/')||/^[A-Za-z]:/.test(name)||name.split('/').some(p=>p==='..')||/[\x00-\x1f]/.test(name))throw Error('O pacote contém um caminho inválido.');
 return name.split('/').filter(p=>p&&p!=='.').join('/');
}
const visible=name=>!name.split('/').some(p=>p.startsWith('.')||p==='__MACOSX');
export function groupFiles(files){
 const publications=[],images=new Map();
 for(const file of files){
  const name=cleanPath(file.path||file.name);if(!visible(name))continue;
  const parts=name.split('/'),leaf=parts.pop(),path=parts.join('/');
  if(image(leaf)){const group=images.get(path)||[];group.push({...file,name:leaf});images.set(path,group);}
  else if(book(leaf)||/\.(zip|rar)$/i.test(leaf))publications.push({...file,name:leaf,path});
 }
 publications.sort((a,b)=>natural(a.path+'/'+a.name,b.path+'/'+b.name));
 return {publications,images:[...images].map(([path,files])=>{const parts=path.split('/'),title=parts.pop()||'Revista de imagens';return {path:parts.join('/'),title,files:files.sort((a,b)=>natural(a.name,b.name))};})};
}
export async function archiveEntries(buffer,format,wasmBinary){
 const entries=[];let total=0;
 const add=(name,bytes)=>{name=cleanPath(name);if(!visible(name))return;total+=bytes.byteLength;if(total>MAX_EXPANDED||bytes.byteLength>MAX_FILE||entries.length>=10000)throw Error('Limite de 512 MB descompactados, 256 MB por arquivo e 10.000 entradas.');entries.push({name,bytes});};
 if(format==='rar'||format==='cbr'){
  const extractor=await createExtractorFromData({data:buffer,wasmBinary});
  const headers=[...extractor.getFileList().fileHeaders];
  if(headers.some(h=>h.flags.encrypted))throw Error('RAR com senha não é suportado.');
  if(headers.length>10000||headers.reduce((n,h)=>n+h.unpSize,0)>MAX_EXPANDED||headers.some(h=>h.unpSize>MAX_FILE))throw Error('RAR excede os limites de extração.');
  for(const h of headers)cleanPath(h.name);
  for(const item of extractor.extract({files:h=>!h.flags.directory}).files)if(item.extraction)add(item.fileHeader.name,item.extraction);
 }else{
  const zip=await JSZip.loadAsync(buffer),files=Object.values(zip.files).filter(e=>!e.dir);
  if(files.length>10000||files.reduce((n,f)=>n+(f._data?.uncompressedSize||0),0)>MAX_EXPANDED||files.some(f=>(f._data?.uncompressedSize||0)>MAX_FILE))throw Error('ZIP excede os limites de extração.');
  for(const file of files){cleanPath(file.unsafeOriginalName||file.name);add(file.name,await file.async('uint8array'));}
 }
 entries.sort((a,b)=>natural(a.name,b.name));return entries;
}
export async function imagesToBook(entries,title,path){
 if(!entries.length||entries.length>2000||entries.some(f=>f.bytes.byteLength>40*1024*1024)||entries.reduce((n,f)=>n+f.bytes.byteLength,0)>MAX_FILE)throw Error('Revista excede 2.000 páginas, 40 MB por imagem ou 256 MB por obra.');
 entries.sort((a,b)=>natural(a.name,b.name));const zip=new JSZip();
 entries.forEach((entry,index)=>zip.file(String(index+1).padStart(5,'0')+'.'+entry.name.split('.').pop().toLowerCase(),entry.bytes,{date:new Date('2000-01-01T00:00:00Z'),compression:'STORE'}));
 const bytes=await zip.generateAsync({type:'uint8array',compression:'STORE'});
 if(bytes.byteLength>MAX_FILE)throw Error('A revista CBZ gerada excede 256 MB.');
 return {title,collection_path:path,format:'cbz',bytes,category:'Revistas',firstImage:entries[0]};
}
export async function unpackPublications(buffer,name,path='',wasmBinary,depth=0,budget={bytes:0,count:0}){
 const format=name.split('.').pop().toLowerCase(),title=name.replace(/\.[^.]+$/,'');
 if(book(name)){
  if(++budget.count>2000)throw Error('Pacote contém mais de 2.000 obras.');
  return [{title,collection_path:path,format,bytes:new Uint8Array(buffer),category:['cbr','cbz'].includes(format)?'HQs':'Livros'}];
 }
 if(!['zip','rar'].includes(format))return [];
 if(depth>=3)throw Error('Pacote contém mais de três níveis de arquivos compactados.');
 const entries=await archiveEntries(buffer,format,wasmBinary),out=[],groups=new Map();
 budget.bytes+=entries.reduce((n,f)=>n+f.bytes.byteLength,0);if(budget.bytes>MAX_EXPANDED)throw Error('Pacotes aninhados excedem 512 MB descompactados.');
 for(const entry of entries){
  const parts=entry.name.split('/'),leaf=parts.pop(),folder=[path,title,...parts].filter(Boolean).join('/');
  if(image(leaf)){const group=groups.get(folder)||[];group.push(entry);groups.set(folder,group);}
  else if(book(leaf)||/\.(zip|rar)$/i.test(leaf)){const data=entry.bytes.buffer.slice(entry.bytes.byteOffset,entry.bytes.byteOffset+entry.bytes.byteLength);out.push(...await unpackPublications(data,leaf,folder,wasmBinary,depth+1,budget));}
 }
 for(const[folder,pages]of groups){const parts=folder.split('/'),label=parts.pop();out.push(await imagesToBook(pages,label,parts.join('/')));if(++budget.count>2000)throw Error('Pacote contém mais de 2.000 obras.');}
 if(!out.length)throw Error('Nenhuma publicação ou página JPG/PNG encontrada no pacote.');
 return out;
}
