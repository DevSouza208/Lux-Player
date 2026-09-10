const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/script.js','utf8');
function setup() {
  const storage = new Map();
  const c = { currentUser: { user:'alice',pass:'test' }, cloudSyncInFlight:false, applyingCloudSync:false, cloudSyncTimer:null,
    localStorage: { getItem:k=>storage.get(k)??null, setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),get length(){return storage.size;},key:i=>[...storage.keys()][i]??null },
    setTimeout:()=>1,clearTimeout(){},window:{addEventListener(){}},console,refreshResumeUI(){},getItemKey:item=>item.url,
    allMediaItems:[],renderCategories(){},filterMedia(){},supabaseClient:{functions:{invoke:async()=>({data:{records:[]}})}} };
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('    function userProgressPrefix'), source.indexOf('    function getCloudGameSaveKey')),c);
  vm.runInContext(source.slice(source.indexOf('    function getGameFavorites'),source.indexOf('    async function resumeSeriesFromState')),c);
  return {c,storage};
}
test('favorites, movies and series remain isolated when switching accounts',()=>{
  const {c,storage}=setup();
  c.toggleFavorite({url:'movie-a'});
  c.applyCloudRecord('resume:lux_progress_a',{progress:75,meta:{name:'A'}});
  c.applyCloudRecord('series:1',{state:{seriesId:1,progress:30}});
  c.currentUser={user:'bob',pass:'test'};
  assert.equal(c.getFavorites().length,0);assert.equal(c.hasResumeEntry({id:'a'}),false);assert.equal(c.getSeriesResumeState(1),null);
  storage.set('lux_favorites',JSON.stringify(['legacy-unknown-owner']));
  c.restoreAccountProgress();assert.equal(c.getFavorites().length,0);
  c.currentUser={user:'alice',pass:'test'};
  assert.equal(c.getFavorites()[0],'movie-a');assert.equal(c.hasResumeEntry({id:'a'}),true);assert.equal(c.getSeriesResumeState(1).progress,30);
});
test('owned sync records restore offline without importing unowned legacy data',()=>{
  const {c,storage}=setup();
  storage.set('lux_cloud_sync_records_alice',JSON.stringify({'favorite:media:old':{payload:{favorite:true},updatedAt:1}}));
  c.restoreAccountProgress();assert.equal(c.getFavorites()[0],'old');
  c.currentUser={user:'bob'};c.restoreAccountProgress();assert.equal(c.getFavorites().length,0);
});
test('late pull from previous account is ignored',async()=>{
  const {c}=setup();let finish;
  c.supabaseClient.functions.invoke=()=>new Promise(resolve=>finish=resolve);
  const sync=c.syncCloudProgress();
  c.currentUser={user:'bob',pass:'test'};
  finish({data:{records:[{key:'favorite:media:private',payload:{favorite:true},updatedAt:Date.now()}]}});
  await sync;assert.equal(c.getFavorites().length,0);
  assert.equal(Object.keys(c.getCloudSyncRecords()).length,0);
});
test('movie time updates mark progress for cloud even when metadata exists',()=>{
  const {c}=setup();
  c.item={id:'film',type:'movies',name:'Film'};c.resumeKey='lux_progress_film';c.video={currentTime:20};c.lastSavedTime=10;
  c.applyCloudRecord('resume:lux_progress_film',{progress:10,meta:{name:'Film'}});
  const start=source.indexOf('      video.ontimeupdate = () =>');
  vm.runInContext(source.slice(start,source.indexOf('      video.onended',start)),c);
  c.video.ontimeupdate();
  assert.equal(c.getCloudSyncRecords()['resume:lux_progress_film'].payload.progress,20);
});
test('edits made during pull survive and large queues are pushed in batches',async()=>{
  const {c}=setup();let release;const batches=[];
  c.supabaseClient.functions.invoke=async(_name,{body})=>{
    if(body.action==='pull')return new Promise(resolve=>release=resolve);
    batches.push(body.records);return {data:{saved:body.records.length}};
  };
  const work=c.syncCloudProgress();
  for(let i=0;i<405;i++)c.markCloudRecord('favorite:media:'+i,{favorite:true});
  release({data:{records:[]}});await work;
  assert.deepEqual(batches.map(b=>b.length),[400,5]);
  assert.equal(Object.keys(c.getCloudSyncRecords()).length,405);
});
