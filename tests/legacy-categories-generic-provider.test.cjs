const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','js','script.js'),'utf8');
const begin=script.indexOf('    function normalizeSharedCategoryTitle(value) {');
const end=script.indexOf('    async function adminSendCategoriesToUsers() {',begin);
assert.ok(begin>=0&&end>begin);
function setup(map={}){
 const ctx={currentUser:{categoryMap:map},isAdultContent:(g,n)=>/adult|xxx|18\+|\+18|erot/i.test(g+' '+n)};
 return vm.runInNewContext(script.slice(begin,end)+'\napplySharedCategoryToItem',ctx);
}
test('old PLUS/PLL map stays reference only; provider categories remain authoritative',()=>{
 const app=setup({'movies|barbie 2023':'Filmes | Comédia ⚡ PLUS'});
 const film=app({type:'movies',name:'Barbie (2023)',group:'FILMES',url:'https://provider/movie/x/y/123.mp4',stream_id:123});
 assert.equal(film.group,'FILMES');
 assert.equal(film.sharedGroup,'Filmes | Comédia ⚡ PLUS');
 assert.equal(film.url,'https://provider/movie/x/y/123.mp4');
 assert.equal(film.stream_id,123);
});
test('source groups for live, movie and series always outrank the historical map',()=>{
 const app=setup({'movies|test':'Drama','series|test':'Novelas','live|test':'TV antiga'});
 for(const type of ['movies','series','live']){
   const original=type==='movies'?'Filmes | Ação':type==='series'?'Séries | AppleTV':'Canais Abertos';
   assert.equal(app({type,name:'Test',group:original}).group,original);
 }
});
test('adult content flag from legacy history continues protecting generic source entries',()=>{
 const app=setup({'movies|restrito':'Filmes | Adultos +18'});
 const film=app({type:'movies',name:'Restrito',group:'FILMES',isAdult:false});
 assert.equal(film.group,'FILMES');
 assert.equal(film.isAdult,true);
});
test('31,306 latest movies remain even when old map includes only 31,076',()=>{
 const map={};for(let i=0;i<31076;i++)map['movies|filme '+i]='Filmes | '+(i%2?'Drama':'Ação');
 const app=setup(map);
 const items=Array.from({length:31306},(_,i)=>app({id:i,stream_id:i,name:'Filme '+i,group:'FILMES',type:'movies'}));
 assert.equal(items.length,31306);
 assert.equal(items.filter(x=>x.group==='FILMES').length,31306);
 assert.equal(items.filter(x=>x.sharedGroup).length,31076);
});
test('6,049 series remain with generic source until official API category overlay arrives',()=>{
 const map={};for(let i=0;i<6049;i++)map['series|serie '+i]='Séries | '+(i%2?'Netflix':'Dorama');
 const app=setup(map);
 const items=Array.from({length:6049},(_,i)=>app({id:i,series_id:i,name:'Serie '+i,group:'Séries',type:'series'}));
 assert.equal(items.length,6049);
 assert.equal(items.filter(x=>x.group==='Séries').length,6049);
});
