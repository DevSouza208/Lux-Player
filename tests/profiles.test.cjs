const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const script=fs.readFileSync('js/script.js','utf8');
function client(){
 const storage=new Map();const c={currentUser:{user:'alice',profile:{slot:1,is_child:false}},window:{addEventListener(){}},
 localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v)),removeItem:k=>storage.delete(k),get length(){return storage.size;},key:i=>[...storage.keys()][i]},
 applyingCloudSync:false,cloudSyncTimer:null,setTimeout:()=>1,clearTimeout(){},currentSection:'movies'};
 vm.createContext(c);vm.runInContext(fs.readFileSync('js/profiles.js','utf8'),c);
 vm.runInContext(script.slice(script.indexOf('    function userProgressPrefix'),script.indexOf('    function getCloudGameSaveKey')),c);
 vm.runInContext(script.slice(script.indexOf('    function isAdultContent'),script.indexOf('    function resolveUserCredentials')),c);
 vm.runInContext(fs.readFileSync('js/game-save-store.js','utf8'),c);
 c.getCloudGameSaveKey=g=>'game-'+g.id;
 return {c,storage};
}
test('profile storage separates favorites, history, category order and game saves',()=>{
 const {c}=client();
 const alice=c.currentUser;
 c.applyCloudRecord('preference:category-order:movies',{order:['Drama','Comedia']});
 vm.runInContext("userProgressStorage.setItem('lux_favorites','[1]');userProgressStorage.setItem('lux_progress_movie','35')",c);
 const first=c.localGameSaveRecordKey({id:1},1,alice);
 c.currentUser={...alice,profile:{slot:2,is_child:true}};
 assert.equal(vm.runInContext("userProgressStorage.getItem('lux_favorites')",c),null);
 assert.equal(vm.runInContext("userProgressStorage.getItem('lux_cat_order_v3_movies')",c),null);
 assert.notEqual(c.localGameSaveRecordKey({id:1},1,c.currentUser),first);
 c.currentUser=alice;
 assert.equal(vm.runInContext("userProgressStorage.getItem('lux_progress_movie')",c),'35');
 assert.deepEqual(JSON.parse(vm.runInContext("userProgressStorage.getItem('lux_cat_order_v3_movies')",c)),['Drama','Comedia']);
});
test('Ana under Reginaldo and Ana under another account have distinct media progress and game saves',()=>{
 const {c}=client();
 c.currentUser={user:'reginaldo',profile:{slot:1,name:'Ana',data_key:'same-display-profile'}};
 vm.runInContext("userProgressStorage.setItem('lux_progress_film','125')",c);
 const gameKey=c.localGameSaveRecordKey({id:3},1,c.currentUser);
 c.currentUser={user:'ana',profile:{slot:1,name:'Ana',data_key:'same-display-profile'}};
 assert.equal(vm.runInContext("userProgressStorage.getItem('lux_progress_film')",c),null);
 assert.notEqual(c.localGameSaveRecordKey({id:3},1,c.currentUser),gameKey);
});
test('child profile rejects adult flags, categories and playback targets',()=>{
 const {c}=client();c.currentUser.profile.is_child=true;
 for(const item of [{isAdult:true},{adult:true},{category:'+18'},{name:'XXX'},{age_rating:18}])assert.equal(c.profileAllowsMedia(item),false);
 assert.equal(c.profileAllowsMedia({name:'Desenho',group:'Infantil'}),true);
 vm.runInContext(script.slice(script.indexOf('    function requireAdultPin'),script.indexOf('    function verifyAdultPin')),c);
 let unlocked=false;c.requireAdultPin(()=>unlocked=true);assert.equal(unlocked,false);
 c.currentUser.profile.is_child=false;assert.equal(c.profileAllowsMedia({isAdult:true}),true);
});
function progressServer(){
 let handler;const rows=[];
 const db={async rpc(_name,{p_user,p_records}){let saved=0;for(const r of p_records){const i=rows.findIndex(v=>v.user_name===p_user&&v.sync_key===r.key);if(i>=0&&rows[i].client_updated_at>=r.updatedAt)continue;const v={user_name:p_user,sync_key:r.key,payload:r.payload,client_updated_at:r.updatedAt};if(i<0)rows.push(v);else rows[i]=v;saved++;}return {data:saved};},from(table){const f={};let mode='';let keys;return {
  select(){return this;},eq(k,v){f[k]=v;return this;},like(k,v){f.like=v;return this;},not(k,op,v){f.not=v;return this;},order(){return this;},
  in(k,v){keys=v;return this;},
  async maybeSingle(){return {data:table==='usuarios' ? (f.senha==='p'?{usuario:f.usuario}:null) : (f.user_name==='alice'&&[1,2].includes(f.slot)?{slot:f.slot,data_key:''}:null)};},
  async range(){return {data:rows.filter(r=>r.user_name===f.user_name&&(!f.like||r.sync_key.startsWith(f.like.slice(0,-1)))&&(!f.not||!r.sync_key.startsWith('profile:')))};},
  async upsert(values){for(const v of values){const i=rows.findIndex(r=>r.user_name===v.user_name&&r.sync_key===v.sync_key);if(i<0)rows.push(v);else rows[i]=v;}return {};},
  then(resolve){resolve({data:rows.filter(r=>r.user_name===f.user_name&&(!keys||keys.includes(r.sync_key)))});}
 };}};
 const source=fs.readFileSync('supabase/functions/progress-sync/index.ts','utf8').replace(/^import .*;\r?$/gm,'');
 vm.runInNewContext(stripTypeScriptTypes(source),{Request,Response,Deno:{env:{get:()=>'test'},serve:fn=>handler=fn},createClient:()=>db,console});
 // Environment values must be present.
 return {call:body=>handler(new Request('https://test',{method:'POST',body:JSON.stringify({username:'alice',password:'p',...body})}))};
}
test('header uses profile menu and logout is inside the picker',()=>{
 const h=fs.readFileSync('index.html','utf8');
 assert.ok(!h.slice(0,h.indexOf('</header>')).includes('onclick="logout()"'));
 assert.ok(h.includes('onclick="openProfilePicker()"'));
 assert.ok(h.slice(h.indexOf('id="profilePicker"')).includes('onclick="logout()"'));
});

test('cloud progress is scoped to profile and validates profile ownership',async()=>{
 const app=progressServer();const record={key:'favorite:media:test',payload:{favorite:true},updatedAt:100};
 assert.equal((await app.call({action:'push',records:[record],profileSlot:2})).status,200);
 assert.equal((await (await app.call({action:'pull',profileSlot:1})).json()).records.length,0);
 assert.equal((await (await app.call({action:'pull',profileSlot:2})).json()).records[0].key,record.key);
 assert.equal((await app.call({action:'pull',profileSlot:3})).status,403);
 assert.equal((await app.call({action:'pull',profileSlot:5})).status,400);
 assert.equal((await app.call({action:'push',records:[{...record,key:'profile:2:favorite:media:test'}]})).status,400);
});

test('profile picker opens only after profiles render and keeps existing avatars on refresh',async()=>{
 const {c}=client();let finish;let renders=0,opens=0;
 const fields={};
 c.document={getElementById:id=>fields[id]??={textContent:'',classList:{add(){},toggle(){},contains:()=>true},focus(){},close(){},replaceChildren(){throw Error('Must not clear profiles before fetching');}}};
 c.transitionScreen=()=>{assert.ok(renders>0);opens++;};
 c.renderProfileChoices=()=>renders++;
 c.requestProfiles=()=>new Promise(resolve=>finish=resolve);
 const pending=c.openProfilePicker(true);
 assert.equal(opens,0);assert.equal(renders,0);
 finish([{slot:1,name:'Principal',is_child:false}]);await pending;
 assert.equal(opens,1);assert.equal(renders,1);
 const refresh=c.openProfilePicker(false);
 assert.equal(renders,1);finish([{slot:1,name:'Principal',is_child:false}]);await refresh;
 assert.equal(renders,2);
});

test('failed profile loading stays on login instead of opening an empty picker',async()=>{
 const {c}=client();const fields={};
 c.document={getElementById:id=>fields[id]??={textContent:'',classList:{add(){},toggle(){},contains:()=>true},close(){}}};
 c.transitionScreen=()=>assert.fail('Must not reveal empty picker');
 c.requestProfiles=async()=>{throw Error('Falha de conexão');};
 await c.openProfilePicker(true);
 assert.equal(fields.authStatusText.textContent,'Falha de conexão');
});

test('password protection is opt-in for profile entry',async()=>{
 const {c}=client();const fields={};c.document={getElementById:id=>fields[id]??={classList:{add(){},remove(){}},focus(){},value:''}};
 vm.runInContext("accountProfiles=[{slot:1,name:'Livre',is_child:false,password_protected:false},{slot:2,name:'Protegido',is_child:false,password_protected:true}];profileEntryPending=true",c);
 let selected;c.activateAccountProfile=async p=>selected=p.slot;
 await c.selectAccountProfile(1);assert.equal(selected,1);
 selected=null;await c.selectAccountProfile(2);assert.equal(selected,null);assert.equal(fields.profileAdultSlot.value,2);
});

test('recreated profile in the same slot has separate local keys',()=>{
 const {c}=client();c.currentUser.profile={slot:2,data_key:'new-generation'};
 const fresh=c.localGameSaveRecordKey({id:1},1,c.currentUser);
 const freshSync=c.getCloudSyncStorageKey();
 c.currentUser.profile={slot:2,data_key:'old-generation'};
 assert.notEqual(c.localGameSaveRecordKey({id:1},1,c.currentUser),fresh);
 assert.notEqual(c.getCloudSyncStorageKey(),freshSync);
});

test('editing a profile opens a dialog with its populated form',()=>{
 const {c}=client();const fields={};let scrolled=false;
 c.document={getElementById:id=>fields[id]??={value:'',classList:{add(){},remove(){},toggle(){}},focus(){},showModal(){scrolled=true;}}};
 c.renderEmojiChoices=()=>{};
 c.updateProfilePhotoPreview=()=>assert.equal(fields.profileEditName.value,'Reginaldo');
 c.editAccountProfile({slot:2,name:'Reginaldo',password_protected:true,avatar_data:'photo'});
 assert.equal(scrolled,true);
 assert.equal(fields.profileEditSlot.value,2);
 assert.equal(fields.profileEditProtected.checked,true);
 assert.equal(fields.profileSaveButton.disabled,false);
});
