// Categorias Xtream sobrepostas à lista M3U original, sem alterar URLs de reprodução.
// Uma categoria só é aplicada se tiver correspondência segura por ID ou título.
(function(root){
  'use strict';
  const endpoint='https://cavgobgykpbiehqvqkws.supabase.co/functions/v1/lux-provider-categories';
  const active=new Map();

  function norm(raw){
    return String(raw||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
      .replace(/\.(mkv|mp4|avi|mov)$/i,'')
      .replace(/\((?:19|20)\d{2}\)/g,' ').replace(/\[(?:19|20)\d{2}\]/g,' ')
      .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
  }
  function streamId(url,kind){
    try {
      const route=kind==='live'?'live':kind==='movies'?'movie':'series';
      const path=new URL(String(url||'')).pathname;
      const match=path.match(new RegExp('/'+route+'/[^/]+/[^/]+/(\\d+)(?:\\.[^/]+)?$','i'));
      return match?match[1]:'';
    }catch{return ''}
  }
  function generic(group,kind){
    const name=norm(group);
    const names=kind==='movies'
      ? ['filmes','filme','movies','movie','vod','geral','catalogo geral']
      : ['series','serie','seriados','tv series','tv shows','geral'];
    return !name||names.includes(name);
  }
  function apply(items,data,isAdultContent,profileAllowsMedia){
    if(!Array.isArray(items)||!data||typeof data!=='object')return {changed:0,assignedMovies:0,assignedSeries:0,adultRestricted:0};
    let changed=0,assignedMovies=0,assignedSeries=0,adultRestricted=0;
    const moviesById=data.movieIds||{}, moviesByTitle=data.movieTitles||{};
    const seriesById=data.seriesIds||{},seriesByTitle=data.seriesTitles||{};
    for(const item of items){
      if(!item||(item.type!=='movies'&&item.type!=='series')||item.source==='xtream')continue;
      if(!generic(item.providerGroup||item.group,item.type))continue; // group-title real prevalece
      let found='';
      if(item.type==='movies'){
        const id=streamId(item.url,'movies');
        found=String((id&&moviesById[id])||moviesByTitle[norm(item.name)]||'');
      }else{
        const id=String(item.series_id||'');
        found=String(seriesById[id]||seriesByTitle[norm(item.name)]||'');
      }
      if(!found||found.length>150||generic(found,item.type))continue;
      const wasAdult=Boolean(item.isAdult);
      if(item.group!==found){item.group=found;changed++}
      item.providerCategoryFromXtream=true;
      item.isAdult=wasAdult||Boolean(isAdultContent(found,item.name));
      if(!wasAdult&&item.isAdult&&!profileAllowsMedia(item))adultRestricted++;
      if(item.type==='movies')assignedMovies++;else assignedSeries++;
    }
    return {changed,assignedMovies,assignedSeries,adultRestricted};
  }
  async function get(user){
    if(!user?.user||!user?.pass)throw Error('not_authenticated');
    const k=user.user+'|'+String(user.pass).slice(0,8);
    if(active.has(k))return active.get(k);
    const task=(async()=>{
      const timeout=AbortSignal.timeout(75000);
      const r=await root.fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        credentials:'omit',
        signal:timeout,
        body:JSON.stringify({username:user.user,credential:user.pass})
      });
      if(!r.ok)throw Error('category_http_'+r.status);
      const body=await r.json();
      if(!body?.ok||body?.data?.version!==1)throw Error('category_data_unavailable');
      return body.data;
    })().catch(err=>{active.delete(k);throw err});
    active.set(k,task);
    return task;
  }
  root.LuxProviderCategoryOverlay={get,apply,generic,norm,streamId};
})(typeof window!=='undefined'?window:globalThis);
