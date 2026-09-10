import { archiveEntries,imagesToBook,unpackPublications,groupFiles } from './reading-import-core.js';
let wasm;
const getWasm=()=>wasm||=fetch(new URL('unrar.wasm',self.location.href)).then(r=>r.arrayBuffer());
self.onmessage=async({data})=>{
 try{
  if(data.action==='plan'){self.postMessage(groupFiles(data.files));return;}
  let publications;
  if(data.action==='cover'){
   const entries=await archiveEntries(data.buffer,data.format,['cbr','rar'].includes(data.format)?await getWasm():undefined);
   const images=entries.filter(e=>/\.(jpe?g|png)$/i.test(e.name));
   const first=data.format==='epub'?(images.find(e=>/(^|\/)(cover|capa)[^/]*\.(jpe?g|png)$/i.test(e.name))||images[0]):images[0];
   self.postMessage({image:first?new Blob([first.bytes],{type:/\.png$/i.test(first.name)?'image/png':'image/jpeg'}):null});return;
  }
  if(data.images)publications=[await imagesToBook(data.images,data.title,data.path)];
  else publications=await unpackPublications(data.buffer,data.name,data.path,await getWasm());
  self.postMessage({publications:publications.map(p=>({...p,bytes:undefined,blob:new Blob([p.bytes]),firstImage:p.firstImage?new Blob([p.firstImage.bytes],{type:/\.png$/i.test(p.firstImage.name)?'image/png':'image/jpeg'}):null}))});
 }catch(error){self.postMessage({error:error.message||'Não foi possível preparar o pacote.'});}
};
