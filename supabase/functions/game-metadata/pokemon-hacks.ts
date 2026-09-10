const POKE_AGGREGATOR_DATA='https://raw.githubusercontent.com/xodo2fast4u/poke-aggregator/master/src/data.json';

function year(value:string){
 const match=String(value||'').match(/(?:^|[-/ ])((?:19|20)\d{2})(?:$|[-/ ])/);
 return match?Number(match[1]):null;
}

export async function pokemonHacks(query:string){
 const response=await fetch(POKE_AGGREGATOR_DATA,{signal:AbortSignal.timeout(6000),headers:{'User-Agent':'LuxPlay/1.4 (metadata lookup)'}});
 if(!response.ok)throw Error('Catálogo de hacks indisponível');
 const entries=await response.json();
 if(!Array.isArray(entries))throw Error('Catálogo de hacks inválido');
 const needle=query.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
 return entries.filter((entry:any)=>String(entry.title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(needle)).slice(0,8).map((entry:any)=>({
  external_id:`poke-aggregator:${entry.id}`,
  title:entry.title||'',
  synopsis:[entry.version&&entry.version!=='N/A'?`Versão ${entry.version}`:'',entry.status&&entry.status!=='Unknown'?entry.status:'',entry.platform&&entry.platform!=='N/A'?entry.platform:''].filter(Boolean).join(' · '),
  release_year:year(entry.initial_release),
  genres:[],
  console:String(entry.platform||'').toLowerCase()==='gba'?'gba':'',
  cover_url:entry.image&&entry.image!=='N/A'?entry.image:'',
  metadata_source:'poke-aggregator',
  source_url:entry.game_url||'https://github.com/xodo2fast4u/poke-aggregator',
  attribution:`PokéAggregator · ${entry.source||'comunidade'}`
 }));
}