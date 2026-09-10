(function(root){
 'use strict';
 const MAX=256*1024*1024;
 let enginePromise;
 const engine=()=>enginePromise||=import('./vendor/reader-engine.mjs');
 function worker(data){return new Promise((resolve,reject)=>{
  const task=new Worker('js/vendor/reading-import-worker.js'),timer=setTimeout(()=>{task.terminate();reject(Error('Preparação excedeu dois minutos. Selecione um pacote menor.'));},120000);
  const finish=(error,value)=>{clearTimeout(timer);task.terminate();error?reject(error):resolve(value);};
  task.onmessage=({data})=>finish(data.error?Error(data.error):null,data);task.onerror=()=>finish(Error('Não foi possível abrir o pacote.'));task.postMessage(data);
 });}
 async function thumbnail(blob){
  const bitmap=await createImageBitmap(blob,{resizeWidth:600,resizeQuality:'high'});
  try{const scale=Math.min(1,900/bitmap.height),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));}finally{bitmap.close();}
 }
 async function cover(file,format,firstImage,onMetadata){
  if(firstImage)return thumbnail(firstImage);
  if(format==='pdf'){
   const {pdfjs,pdfAssets}=await engine(),task=pdfjs.getDocument({...pdfAssets,data:new Uint8Array(await file.arrayBuffer())});
   // Password-protected files must never leave an import waiting for user input.
   task.onPassword=()=>task.destroy();
   const pdf=await task.promise;
   if(onMetadata&&root.LuxDocumentMetadata){try{onMetadata(await root.LuxDocumentMetadata.read(pdf));}catch{}}
   try{const page=await pdf.getPage(1),size=page.getViewport({scale:1}),viewport=page.getViewport({scale:Math.min(600/size.width,900/size.height)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',0.85));}finally{await task.destroy();}
  }
  if(format==='epub'){
   const {ePub}=await engine(),publication=ePub(await file.arrayBuffer());
    const timeout=new Promise((_,reject)=>setTimeout(()=>reject(Error('Leitura da capa EPUB excedeu o tempo limite.')),30000));
    try{await Promise.race([publication.ready,timeout]);const language=publication.packaging?.metadata?.language||publication.metadata?.language;if(language&&onMetadata)onMetadata({language_code:String(language).trim().slice(0,10).toLowerCase(),language_sample:''});const url=await Promise.race([publication.coverUrl(),timeout]);if(url?.startsWith('blob:'))return await thumbnail(await(await fetch(url)).blob());}finally{publication.destroy();}
  }
  const result=await worker({action:'cover',format,buffer:await file.arrayBuffer()});return result.image?thumbnail(result.image):null;
 }
 async function prepare(files,onItem,onProgress,valid=()=>true){
  const refs=Array.from(files).map((file,index)=>({name:file.name,path:file.webkitRelativePath||file.name,index}));
  const plan=await worker({action:'plan',files:refs});const errors=[];let done=0;
  const add=async(publication)=>{
   if(!valid())return;
   const file=publication.file||new File([publication.blob],publication.title+'.'+publication.format);
   if(!file.size||file.size>MAX)throw Error('Limite de 256 MB por obra.');
   let coverBlob=null,coverWarning='',documentMetadata={};try{coverBlob=await cover(file,publication.format,publication.firstImage,metadata=>{documentMetadata=metadata;});if(!coverBlob)coverWarning='Capa não encontrada; você pode informar uma URL.';}catch{coverWarning='Capa automática indisponível; você pode informar uma URL.';}
   if(!valid())return;
   await onItem({...publication,...documentMetadata,file,coverBlob,coverWarning,blob:undefined,firstImage:undefined});done++;
  };
  for(const entry of plan.publications){
   if(!valid())break;const file=files[entry.index],format=file.name.split('.').pop().toLowerCase();onProgress('Preparando '+entry.name+'…');
   try{
    if(!file.size||file.size>MAX)throw Error('Limite de 256 MB por arquivo.');
    if(['zip','rar'].includes(format)){const result=await worker({name:entry.name,path:entry.path,buffer:await file.arrayBuffer()});for(const item of result.publications)await add(item);}
    else await add({file,title:entry.name.replace(/\.[^.]+$/,''),format,collection_path:entry.path,category:['cbr','cbz'].includes(format)?'HQs':'Livros'});
   }catch(error){errors.push(entry.name+': '+error.message);}
  }
  for(const group of plan.images){
   if(!valid())break;onProgress('Montando revista '+group.title+'…');
   try{
    const pages=group.files.map(ref=>files[ref.index]);
    if(pages.length>2000||pages.some(f=>!f.size||f.size>40*1024*1024)||pages.reduce((n,f)=>n+f.size,0)>MAX)throw Error('Limite de 2.000 páginas, 40 MB por imagem e 256 MB por revista.');
    const images=[];for(let i=0;i<pages.length;i++)images.push({name:group.files[i].name,bytes:new Uint8Array(await pages[i].arrayBuffer())});
    const result=await worker({images,title:group.title,path:group.path});for(const item of result.publications)await add(item);
   }catch(error){errors.push(group.title+': '+error.message);}
  }
  return {done,errors};
 }
 root.LuxReadingImport={prepare,cover};
})(window);
