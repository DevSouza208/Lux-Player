const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','js','script.js'),'utf8');
const begin=script.indexOf('    function normalizeSharedCategoryTitle(value) {');
const end=script.indexOf('    async function adminSendCategoriesToUsers() {',begin);
assert.ok(begin>=0&&end>begin);
const block=script.slice(begin,end);
function setup(map={}){
  const context={currentUser:{categoryMap:map},isAdultContent:(group,name)=>/adult|xxx|18\+|\+18|erot/i.test(group+' '+name)};
  return vm.runInNewContext(block+'\n({applySharedCategoryToItem,isGenericProviderCategory,sharedCategoryKey})',context);
}
test('generic FILMES restores precise provider-era category when title matches',()=>{
  const app=setup({'movies|barbie 2023':'Filmes | Comédia ⚡ PLUS'});
  const movie={type:'movies',name:'Barbie (2023)',group:'FILMES',url:'http://local/film.mkv',stream_id:17,isAdult:false};
  const matched=app.applySharedCategoryToItem(movie);
  assert.equal(matched.group,'Filmes | Comédia ⚡ PLUS');
  assert.equal(matched.providerGroup,'FILMES');
  assert.equal(matched.url,'http://local/film.mkv');
  assert.equal(matched.stream_id,17);
});
test('specific current provider category overrides an obsolete category',()=>{
  const app=setup({'movies|barbie 2023':'Filmes | Comédia ⚡ PLUS'});
  const movie=app.applySharedCategoryToItem({type:'movies',name:'Barbie (2023)',group:'Filmes | Lançamentos 2026'});
  assert.equal(movie.group,'Filmes | Lançamentos 2026');
  assert.equal(movie.sharedGroup,'Filmes | Comédia ⚡ PLUS');
});
test('new films and series with no historical match stay in Todos and provider group',()=>{
  const app=setup({'movies|barbie 2023':'Filmes | Comédia ⚡ PLUS'});
  for(const [type,name,group] of [['movies','Filme de ontem','FILMES'],['series','Série Novinha','SÉRIES'],['live','Canal Novo','CANAIS']]){
    const item=app.applySharedCategoryToItem({type,name,group});
    assert.equal(item.group,group);
    assert.equal(item.sharedGroup,'');
  }
});
test('series and live categories can be restored independently of movies',()=>{
  const app=setup({'series|o seriado':'Séries | Netflix⚡PLUS','live|globo sp':'TV | Abertos'});
  assert.equal(app.applySharedCategoryToItem({type:'series',name:'O Seriado',group:'SÉRIES'}).group,'Séries | Netflix⚡PLUS');
  assert.equal(app.applySharedCategoryToItem({type:'live',name:'Globo SP',group:'Canais'}).group,'TV | Abertos');
});
test('group maps never remove adult classification',()=>{
  const app=setup({'movies|restrito':'Filmes | Família','movies|outro':'Filmes | Adultos +18'});
  assert.equal(app.applySharedCategoryToItem({type:'movies',name:'Restrito',group:'FILMES',isAdult:true}).isAdult,true);
  assert.equal(app.applySharedCategoryToItem({type:'movies',name:'Outro',group:'FILMES',isAdult:false}).isAdult,true);
});
test('31,306 films survive an older 31,076 title classification map',()=>{
  const saved={};for(let i=0;i<31076;i++) saved['movies|filme '+i]='Filmes | '+(i%2?'Drama':'Ação');
  const app=setup(saved);
  const items=Array.from({length:31306},(_,i)=>app.applySharedCategoryToItem({id:i,name:'Filme '+i,group:'FILMES',type:'movies',stream_id:i,isAdult:false}));
  assert.equal(items.length,31306);
  assert.equal(items.filter(x=>x.group==='FILMES').length,230);
  assert.equal(items.filter(x=>x.group==='Filmes | Ação').length,15538);
  assert.equal(items.filter(x=>x.group==='Filmes | Drama').length,15538);
  assert.equal(new Set(items.map(x=>x.stream_id)).size,31306);
});
test('6,049 series retain total while old series categories restore',()=>{
  const saved={};for(let i=0;i<6049;i++) saved['series|serie '+i]='Séries | '+(i%2?'Netflix':'Dorama');
  const app=setup(saved);
  const items=Array.from({length:6049},(_,i)=>app.applySharedCategoryToItem({id:i,name:'Serie '+i,group:'Séries',type:'series',series_id:i}));
  assert.equal(items.length,6049);
  assert.equal(items.filter(x=>x.group.includes('Netflix')).length,3024);
  assert.equal(items.filter(x=>x.group.includes('Dorama')).length,3025);
});
