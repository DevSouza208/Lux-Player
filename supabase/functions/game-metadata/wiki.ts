async function api(host:string,params:Record<string,string>){
 const response=await fetch(`https://${host}/w/api.php?`+new URLSearchParams({format:'json',...params}),{headers:{'User-Agent':'LuxPlay/1.4 (game metadata lookup)'},signal:AbortSignal.timeout(6000)});
 if(!response.ok)throw Error('Fonte wiki indisponível');const data=await response.json();if(data.error)throw Error('Consulta wiki indisponível');return data;
}
export async function wikiGames(query:string,language:string){
 const queries=[query];
 if(/^pok[eé]mon\s+(?:leaf\s*green|firered|fire\s*red)/i.test(query))queries.push('Pokémon FireRed and LeafGreen');
 const responses=await Promise.allSettled(queries.map(search=>api(`${language}.wikipedia.org`,{action:'query',generator:'search',gsrsearch:search,gsrnamespace:'0',gsrlimit:'4',prop:'extracts|pageprops',exintro:'1',explaintext:'1',exsentences:'3',exlimit:'4',ppprop:'wikibase_item|disambiguation'})));
 if(responses.every(result=>result.status==='rejected'))throw Error('Fonte wiki indisponível');
 const pages=[...new Map(responses.flatMap(result=>result.status==='fulfilled'?Object.values(result.value.query?.pages||{}):[]).map((page:any)=>[page.pageid,page])).values()].filter((p:any)=>p.pageprops?.disambiguation===undefined&&(/video.?game|videogame|jogo eletr[oô]nico|jogo de a[cç][aã]o|jogo de plataforma|pok[eé]mon|leaf\s*green|firered/i.test(`${p.title} ${p.extract||''}`))) as any[];
 const ids=[...new Set(pages.map(p=>p.pageprops?.wikibase_item).filter(id=>/^Q\d+$/.test(id)))];let entities:any={};
 if(ids.length){try{entities=(await api('www.wikidata.org',{action:'wbgetentities',ids:ids.join('|'),props:'claims'})).entities||{};}catch{}}
 return pages.map(page=>{
  const entity=entities[page.pageprops?.wikibase_item],dates=(entity?.claims?.P577||[]).filter(c=>c.rank!=='deprecated').map(c=>c.mainsnak?.datavalue?.value?.time?.match(/^\+(\d{4})-/)?.[1]).filter(Boolean);
  return {external_id:`${language}:${page.pageid}`,title:page.title,synopsis:page.extract||'',release_year:dates.length?Math.min(...dates.map(Number)):null,genres:[],console:'',cover_url:'',metadata_source:`wikipedia-${language}`,source_url:`https://${language}.wikipedia.org/?curid=${page.pageid}`,attribution:`Wikipédia (${language}) · CC BY-SA${dates.length?' · ano: Wikidata (primeiro lançamento; confira a plataforma)':''}`};
 });
}
