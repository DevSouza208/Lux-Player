const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const overlaySrc=fs.readFileSync(path.join(__dirname,'../js/lux-provider-category-overlay.js'),'utf8');
const workerSrc=fs.readFileSync(path.join(__dirname,'../supabase/functions/lux-provider-categories/index.ts'),'utf8');
const scriptSrc=fs.readFileSync(path.join(__dirname,'../js/script.js'),'utf8');
function overlay(){
  const win={};
  const ctx={window:win, URL, console, AbortSignal};
  vm.runInNewContext(overlaySrc,ctx);
  return win.LuxProviderCategoryOverlay;
}
function backendIndex(){
  const code=workerSrc.slice(workerSrc.indexOf('function norm('),workerSrc.indexOf('async function upstream('));
  return vm.runInNewContext(code+'\n({buildIndex,validPublicHost})',{URL,console,Date});
}
test('valid category IDs map to official category names, never playlist URLs',()=>{
  const ix=backendIndex().buildIndex(
    [{category_id:'1',category_name:'Filmes | Ação'}],
    [{category_id:'9',category_name:'Séries | Drama'}],
    [{stream_id:10,category_id:1,name:'Filme Teste'}],
    [{series_id:8,category_id:9,name:'Série Teste'}]
  );
  assert.equal(ix.movieIds['10'],'Filmes | Ação');
  assert.equal(ix.seriesTitles['serie teste'],'Séries | Drama');
  assert.equal(JSON.stringify(ix).includes('/movie/'),false);
  assert.equal(JSON.stringify(ix).includes('password'),false);
});
test('private IP and localhost origins are not eligible for provider requests',()=>{
  const allow=backendIndex().validPublicHost;
  for(const origin of ['http://127.0.0.1','http://10.0.0.5','http://192.168.1.1','http://172.16.0.1','http://localhost'])assert.equal(allow(new URL(origin)),false);
  assert.equal(allow(new URL('http://provider.example.com')),true);
});
test('complete 31,306 films and 6,049 series remain accessible after grouping',()=>{
  const index=overlay();
  const movies=Array.from({length:31306},(_,i)=>({
    id:i,name:'Filme '+i,url:'https://iptv/movie/user/pass/'+(i+1)+'.mp4',
    group:'FILMES',providerGroup:'FILMES',type:'movies',source:'m3u',isAdult:false
  }));
  const series=Array.from({length:6049},(_,i)=>({
    id:'s'+i,name:'Série '+i,group:'Séries',providerGroup:'Séries',
    type:'series',source:'m3u-series',isAdult:false
  }));
  const movieIds={},seriesTitles={};
  for(let i=0;i<30200;i++)movieIds[i+1]='Filmes | '+(i%2?'Ação':'Drama');
  for(let i=0;i<5900;i++)seriesTitles[index.norm('Série '+i)]='Séries | '+(i%2?'AppleTV':'Animes');
  const items=movies.concat(series);
  const urls=movies.map(m=>m.url);
  const result=index.apply(items,{movieIds,seriesTitles},()=>false,()=>true);
  assert.equal(items.length,37355);
  assert.equal(result.assignedMovies,30200);
  assert.equal(result.assignedSeries,5900);
  assert.equal(items.filter(m=>m.type==='movies'&&m.group==='FILMES').length,1106);
  assert.equal(items.filter(s=>s.type==='series'&&s.group==='Séries').length,149);
  assert.deepEqual(movies.map(m=>m.url),urls);
});
test('specific provider groups override matched metadata',()=>{
  const ix=overlay();
  const film={name:'Exemplo',group:'Filmes | Original',providerGroup:'Filmes | Original',
    type:'movies',source:'m3u',url:'https://iptv/movie/u/p/19.mp4'};
  assert.equal(ix.apply([film],{movieIds:{19:'Filmes | Ação'}},()=>false,()=>true).changed,0);
  assert.equal(film.group,'Filmes | Original');
});
test('adult restrictions never downgraded after changing provider categories',()=>{
  const ix=overlay();
  const film={name:'Adulto',group:'FILMES',providerGroup:'FILMES',
    type:'movies',source:'m3u',url:'https://iptv/movie/u/p/19.mp4',isAdult:true};
  ix.apply([film],{movieIds:{19:'Filmes | Família'}},()=>false,()=>true);
  assert.equal(film.isAdult,true);
});
test('only grouping changes in script, preserving player and M3U URL assignment',()=>{
  assert.match(scriptSrc,/async function loadPlaylist\(url\)/);
  assert.match(scriptSrc,/async function loadFromXtreamApi\(server, user, pass\)/);
  assert.match(scriptSrc,/temp\.source = 'm3u';/);
  assert.match(scriptSrc,/item\.group = item\.providerGroup;/);
  assert.doesNotMatch(overlaySrc,/item\.url\s*=/);
  assert.match(scriptSrc,/LuxProviderCategoryOverlay\.get\(owner\)/);
});
