const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const script=fs.readFileSync(path.join(__dirname,'../js/lux-provider-category-overlay.js'),'utf8');
const backend=fs.readFileSync(path.join(__dirname,'../supabase/functions/lux-provider-categories/index.ts'),'utf8');
function overlay(){const window={};vm.runInNewContext(script,{window,URL,AbortSignal,console});return window.LuxProviderCategoryOverlay;}
function indexer(){const src=backend.slice(backend.indexOf('function norm('),backend.indexOf('async function upstream('));return vm.runInNewContext(src+'\nbuildIndex',{Date});}

test('get_live_categories/get_live_streams produce real category names by ID and unique channel title',()=>{
 const build=indexer();
 const result=build([],[],[],[],
  [{category_id:'10',category_name:'TV | Notícias'},{category_id:'20',category_name:'TV | Esportes'}],
  [{stream_id:110,category_id:'10',name:'Canal Notícias HD'},
   {stream_id:120,category_id:'20',name:'Canal Futebol HD'}]
 );
 assert.equal(result.version,2);
 assert.equal(result.liveIds['110'],'TV | Notícias');
 assert.equal(result.liveIds['120'],'TV | Esportes');
 assert.equal(result.liveTitles['canal noticias hd'],'TV | Notícias');
 assert.equal(result.counts.liveCategories,2);
 assert.equal(result.counts.liveMapped,2);
 assert.equal(JSON.stringify(result).includes('http://'),false);
});

test('duplicate names across distinct official categories are not used to guess',()=>{
 const build=indexer();
 const res=build([],[],[],[],[{category_id:'1',category_name:'TV | Geral'},
   {category_id:'2',category_name:'TV | Internacional'}],
 [{stream_id:1,name:'Canal Igual',category_id:'1'}, {stream_id:2,name:'Canal Igual',category_id:'2'}]);
 assert.equal(res.liveTitles['canal igual'],undefined);
 assert.equal(res.liveIds['1'],'TV | Geral');
 assert.equal(res.liveIds['2'],'TV | Internacional');
});

test('2244 original channels keep URLs while official categories replace broad M3U groups',()=>{
 const api=overlay();const count=2244;
 const channels=Array.from({length:count},(_,i)=>({
  name:'Canal '+i+' HD',group:i%2?'CANAIS INTERNACIONAIS':'CANAIS COMPLETO(SD,HD,FHD,4K)',
  providerGroup:i%2?'CANAIS INTERNACIONAIS':'CANAIS COMPLETO(SD,HD,FHD,4K)',
  source:'m3u',type:'live',isAdult:false,url:'https://iptv.example/live/u/p/'+(i+10)+'.ts'
 }));
 const originalUrls=channels.map(item=>item.url);
 const liveIds={};for(let i=0;i<2150;i++)liveIds[String(i+10)]=i%3===0?'TV | Esportes':i%3===1?'TV | Notícias':'TV | Infantil';
 const summary=api.apply(channels,{version:2,liveIds},()=>false,()=>true);
 assert.equal(channels.length,2244);
 assert.equal(summary.assignedLive,2150);
 assert.equal(channels.filter(x=>x.group==='TV | Esportes').length,717);
 assert.equal(channels.filter(x=>x.group.startsWith('CANAIS ')).length,94);
 assert.deepEqual(channels.map(item=>item.url),originalUrls);
 assert.equal(channels[0].providerGroup,'CANAIS COMPLETO(SD,HD,FHD,4K)');
});

test('TV name fallback works when M3U uses non-Xtream URL and match is exact',()=>{
 const api=overlay();
 const channel={type:'live',name:'TV Brasil HD',group:'CANAIS COMPLETO',
  providerGroup:'CANAIS COMPLETO',source:'m3u',url:'https://iptv.example/playlist?id=abc',isAdult:false};
 const summary=api.apply([channel],{liveTitles:{'tv brasil hd':'Canais | Abertos'}},()=>false,()=>true);
 assert.equal(summary.assignedLive,1);
 assert.equal(channel.group,'Canais | Abertos');
 assert.equal(channel.url,'https://iptv.example/playlist?id=abc');
});

test('adult restrictions cannot be removed by official category',()=>{
 const api=overlay();
 const channel={type:'live',name:'Restrito',group:'CANAIS COMPLETO',providerGroup:'CANAIS COMPLETO',source:'m3u',
  url:'https://iptv.example/live/u/p/100.ts',isAdult:true};
 const summary=api.apply([channel],{liveIds:{100:'TV | Filmes'}},()=>false,()=>true);
 assert.equal(summary.assignedLive,1);
 assert.equal(channel.isAdult,true);
});

test('newly restricted channels are reported for profile filtering',()=>{
 const api=overlay();
 const channel={type:'live',name:'Canal Teste',group:'CANAIS COMPLETO',providerGroup:'CANAIS COMPLETO',source:'m3u',
  url:'https://iptv.example/live/u/p/100.ts',isAdult:false};
 const summary=api.apply([channel],{liveIds:{100:'TV Adultos +18'}},group=>group.includes('+18'),item=>!item.isAdult);
 assert.equal(channel.isAdult,true);
 assert.equal(summary.adultRestricted,1);
});

test('direct Xtream channels keep their original categories instead of a second classification',()=>{
 const api=overlay();
 const channel={type:'live',name:'Canal A',group:'Canais | Esportes',providerGroup:'Canais | Esportes',source:'xtream',
  url:'https://iptv.example/live/u/p/100.ts',isAdult:false};
 const summary=api.apply([channel],{liveIds:{100:'Canais | Infantil'}},()=>false,()=>true);
 assert.equal(summary.changed,0);
 assert.equal(channel.group,'Canais | Esportes');
});
