// Lux shared genre index: only titles + years are uploaded by a verified administrator.
// IPTV URLs, device identities and passwords are never included in the snapshot.
(function(root){
  'use strict';
  const PERIOD=24*60*60*1000,BATCH=200, MAX_PAGES=40;
  const loading=new Set(),synching=new Set(),queued=new Map();
  function base(){
    const url=String(root.LUX_GENRE_WORKER_URL||'').trim().replace(/\/+$/,'');
    return /^https:\/\//i.test(url)?url:'';
  }
  function configured(){return !!base()}
  async function request(path,body){
    if(!base())throw new Error('Worker não configurado');
    const response=await root.fetch(base()+path,{
      method:body?'POST':'GET',
      headers:body?{'Content-Type':'application/json'}:undefined,
      credentials:'omit',
      body:body?JSON.stringify(body):undefined,
      signal:AbortSignal.timeout(22000)
    });
    if(!response.ok)throw new Error('Worker HTTP '+response.status);
    return response.json();
  }
  function yearOf(item){
    const title=String(item?.name||'');
    const match=title.match(/[\[(]((?:19|20)\d{2})[\])]/)||
      title.match(/[\s|_-]((?:19|20)\d{2})\s*$/);
    const yr=Number(item.year||match?.[1]||0);
    return yr>=1880&&yr<=new Date().getFullYear()+3?yr:0;
  }
  function inventory(items,kind){
    const seen=new Set(),out=[];
    for(const item of items){
      if(item?.type!==kind||item.isAdult)continue;
      const title=String(item.name||'').trim().slice(0,180);
      if(!title||/https?:\/\/|\/movie\/|\/series\/|[<>]/i.test(title))continue;
      const year=yearOf(item);
      const id=(title+'|'+year).toLowerCase();
      if(seen.has(id))continue;seen.add(id);
      out.push({title,year});
    }
    return out;
  }
  function signature(items){
    let a=2166136261;
    for(const item of items){
      const part=item.title+'|'+item.year;
      for(let j=0;j<part.length;j++){a^=part.charCodeAt(j);a=Math.imul(a,16777619)}
    }
    return items.length+'-'+(a>>>0).toString(16);
  }
  async function upload(kind,items,account,onProgress,force=false){
    if(!configured())throw new Error('Configure LUX_GENRE_WORKER_URL primeiro.');
    if(!account||account.role!=='admin'||!/^luxsess_/.test(String(account.pass||'')))throw new Error('Acesso permitido somente ao administrador.');
    if(synching.has(kind))return{running:true};
    const rows=inventory(items,kind);
    if(!rows.length)return{skipped:true,reason:'Nenhum título carregado'};
    const key='lux_shared_genre_snapshot_v1:'+kind;
    const sig=signature(rows);
    let prior={};
    try{prior=JSON.parse(root.localStorage.getItem(key)||'{}')}catch{}
    if(!force&&prior.signature===sig&&Date.now()-Number(prior.at)<PERIOD)return{skipped:true,reason:'Catálogo já enviado nas últimas 24 horas'};
    synching.add(kind);
    let sent=0;
    try{
      for(let i=0;i<rows.length;i+=BATCH){
        const result=await request('/v1/admin/snapshot',{
          username:account.user,credential:account.pass,kind,items:rows.slice(i,i+BATCH)
        });
        if(!result?.ok)throw new Error('Resposta inválida do Worker');
        sent+=Math.min(BATCH,rows.length-i);
        onProgress?.({kind,sent,total:rows.length});
        // Between HTTP batches, yield for the UI and playback.
        await new Promise(resolve=>root.setTimeout(resolve,0));
      }
      root.localStorage.setItem(key,JSON.stringify({signature:sig,at:Date.now()}));
      await request('/v1/admin/run',{username:account.user,credential:account.pass}).catch(()=>{});
      return{ok:true,kind,sent,total:rows.length};
    }finally{synching.delete(kind)}
  }
  function schedule(kind,items,account){
    if(!configured()||account?.role!=='admin'||queued.has(kind))return;
    const timeout=root.setTimeout(async()=>{
      queued.delete(kind);
      try{await upload(kind,items,account)}catch(error){console.warn('[Lux Genre Worker] Snapshot automático não concluído:',error.message)}
    },12000);
    queued.set(kind,timeout);
  }
  async function load(kind,onUpdate){
    if(!configured()||loading.has(kind)||!root.LuxSmartGenres?.mergeSharedIndex)return false;
    loading.add(kind);
    try{
      let after='',found=0;
      for(let page=0;page<MAX_PAGES;page++){
        const result=await request('/v1/index?kind='+kind+'&limit=1500'+(after?'&after='+encodeURIComponent(after):''));
        if(result?.kind!==kind||!Array.isArray(result.rows))break;
        found+=root.LuxSmartGenres.mergeSharedIndex(kind,result.rows);
        onUpdate?.({kind,found});
        if(!result.more||!result.next||result.next===after)break;
        after=result.next;
      }
      return found>0;
    }finally{loading.delete(kind)}
  }
  async function status(){return request('/v1/status')}
  async function run(account){
    if(account?.role!=='admin')throw new Error('Acesso não autorizado');
    return request('/v1/admin/run',{username:account.user,credential:account.pass});
  }
  root.LuxGenreWorker={configured,load,upload,schedule,status,run,inventory};
})(typeof window!=='undefined'?window:globalThis);
