const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const HASH='a'.repeat(64),MARK='12345678-1234-1234-1234-123456789abc';
function server(file='reading-sync',expiry=''){
 let handler;const rows=new Map(),catalog=new Map(),signed=[],deleted=[];
 const db={from(table){const filters=[];let mode='select',patch,range=[0,99];const matches=row=>filters.every(([key,v,op])=>op==='lt'?row[key]<v:op==='neq'?row[key]!==v:row[key]===v);const q={
    select(){return q;},eq(k,v){filters.push([k,v]);return q;},neq(k,v){filters.push([k,v,'neq']);return q;},lt(k,v){filters.push([k,v,'lt']);return q;},order(){return q;},update(p){mode='update';patch=p;return q;},delete(){mode='delete';return q;},then(resolve){const r=[...catalog.values()].find(matches);if(mode==='update'&&r)Object.assign(r,patch);if(mode==='delete'&&r)catalog.delete(r.id);return Promise.resolve({data:r}).then(resolve);},
  async maybeSingle(){if(table==='usuarios'){const f=Object.fromEntries(filters.map(([k,v])=>[k,v]));return {data:f.senha==='p'?{usuario:f.usuario,cargo:f.usuario==='admin'?'admin':'user',vencimento:expiry}:null};}if(table==='account_profiles'){const f=Object.fromEntries(filters.map(([k,v])=>[k,v]));return {data:[1,2].includes(f.slot)?{slot:f.slot,data_key:'profile-'+f.slot,is_child:f.slot===2}:null};}return {data:[...catalog.values()].find(matches)||null};},
  async single(){const r=[...catalog.values()].find(matches);if(mode==='update')Object.assign(r,patch);return {data:r};},
  async range(a,b){range=[a,b];const data=table==='reading_records'?[...rows.values()]:[...catalog.values()];return {data:data.filter(matches).slice(a,b+1)};}
 };return q;},async rpc(name,p){
  if(name==='prepare_reading_book'){let row=[...catalog.values()].find(r=>r.content_hash===p.p_record.content_hash);if(!row){row={...p.p_record};catalog.set(row.id,row);}return {data:row};}
  const key=JSON.stringify([p.p_user,p.p_profile,p.p_book,p.p_key]),old=rows.get(key);
  if((old?.revision||0)!==p.p_expected)return {data:{saved:false,record:{key:old.record_key,payload:old.payload,revision:old.revision}}};
  const row={user_name:p.p_user,profile_key:p.p_profile,book_id:p.p_book,record_key:p.p_key,payload:p.p_payload,revision:p.p_expected+1};rows.set(key,row);return {data:{saved:true,record:{key:p.p_key,payload:p.p_payload,revision:row.revision}}};
 }};
 const source=['supabase/functions/_shared/reading-auth.ts',`supabase/functions/${file}/index.ts`].map(name=>fs.readFileSync(name,'utf8').replace(/^import .*;\r?$/gm,'').replace(/^export /gm,'')).join('\n');
 const env={SUPABASE_URL:'https://test',SUPABASE_SERVICE_ROLE_KEY:'test',R2_ACCOUNT_ID:'0'.repeat(32),R2_ACCESS_KEY_ID:'test',R2_SECRET_ACCESS_KEY:'test',R2_PUBLIC_DOMAIN:'https://media.example'};
 const context={Response,Request,URL,TextEncoder,crypto,console,createClient:()=>db,Deno:{env:{get:key=>env[key]},serve:fn=>handler=fn},S3Client:class{async send(command){if(command.remove){deleted.push(command.Key);return {};}const signedFile=signed.find(s=>s.Key===command.Key);return {ContentLength:signedFile.ContentLength,ContentType:signedFile.ContentType};}},PutObjectCommand:class{constructor(args){Object.assign(this,args);}},HeadObjectCommand:class{constructor(args){Object.assign(this,args);}},DeleteObjectCommand:class{constructor(args){Object.assign(this,args);this.remove=true;}},getSignedUrl:async(_c,command)=>{signed.push(command);return 'https://signed.example/put';}};
 vm.runInNewContext(stripTypeScriptTypes(source),context);
 return {rows,catalog,signed,deleted,call:async body=>handler(new Request('https://test',{method:'POST',body:JSON.stringify({username:'reginaldo',password:'p',profileSlot:1,profileKey:'profile-1',...body})}))};
}
test('reading server isolates equal display names across accounts and profiles and rejects forged identities',async()=>{
 const s=server();const record={key:'notebook',payload:{text:'Nota da Ana da conta Reginaldo'},revision:0};
 assert.equal((await s.call({action:'push',bookId:HASH,records:[record],user_name:'ana'})).status,200);
 assert.equal((await (await s.call({action:'pull',bookId:HASH,username:'ana'})).json()).records.length,0);
 assert.equal((await (await s.call({action:'pull',bookId:HASH,profileSlot:2,profileKey:'profile-2'})).json()).records.length,0);
 assert.equal((await s.call({action:'pull',bookId:HASH,profileKey:'profile-other'})).status,403);
 assert.equal((await s.call({action:'pull',bookId:HASH,password:'wrong'})).status,401);
 assert.equal((await (await s.call({action:'pull',bookId:HASH})).json()).records[0].payload.text,record.payload.text);
});
test('reader accepts only small text/state records, never PDF blobs or arbitrary preferences',async()=>{
 const s=server();for(const record of [
  {key:'file',payload:{data:'PDF'},revision:0},{key:'notebook',payload:{text:'note',dataBase64:'PDF'},revision:0},
  {key:'preferences',payload:{theme:'javascript:bad'},revision:0},{key:'notebook',payload:{text:'x'.repeat(200001)},revision:0},
  {key:'progress',payload:{progress:NaN},revision:0}
 ])assert.equal((await s.call({action:'push',bookId:HASH,records:[record]})).status,400);
 assert.equal(s.rows.size,0);
 const record={key:'mark:'+MARK,payload:{text:'Comentário',anchor:{page:3},label:'Página 3',color:'#fbbf24'},revision:0};
 assert.equal((await s.call({action:'push',bookId:HASH,records:[record]})).status,200);
});
test('optimistic revisions reject stale notebook writes and retain the current version',async()=>{
 const s=server();const push=(text,revision)=>s.call({action:'push',bookId:HASH,records:[{key:'notebook',payload:{text},revision}]});
 await push('Primeira versão',0);await push('Edição nova',1);
 const response=await (await push('Edição atrasada',1)).json();
 assert.equal(response.results[0].saved,false);assert.equal(response.results[0].record.payload.text,'Edição nova');
});
test('catalog uploads and approval require real admin, validate files, and restrict draft visibility',async()=>{
 const s=server('reading-catalog');const draft={action:'prepare',hash:HASH,format:'pdf',fileName:'livro.pdf',size:100,metadata:{title:'Livro'}};
 assert.equal((await s.call(draft)).status,403);
 assert.equal((await s.call({...draft,username:'admin',profileSlot:2,profileKey:'profile-2'})).status,403);
 assert.equal((await s.call({...draft,username:'admin',format:'exe'})).status,400);
 const first=await (await s.call({...draft,username:'admin'})).json();const id=first.book.id;
 assert.ok(s.signed[0].Key.startsWith('reading/'));assert.equal(s.signed[0].ContentLength,100);
 assert.equal((await s.call({action:'status',id,status:'approved',username:'admin'})).status,409);
 assert.equal((await (await s.call({action:'list'})).json()).books.length,0);
 assert.equal((await s.call({action:'confirm',id,username:'admin'})).status,200);
 assert.equal((await s.call({action:'status',id,status:'approved',username:'admin'})).status,200);
 assert.equal((await (await s.call({action:'list'})).json()).books.length,1);
 const again=await (await s.call({...draft,username:'admin'})).json();assert.equal(again.alreadyUploaded,true);assert.equal(s.catalog.size,1);
});
test('reading catalog rejects a different upload with a repeated title',async()=>{
 const s=server('reading-catalog'),draft={username:'admin',action:'prepare',hash:HASH,format:'pdf',fileName:'livro.pdf',size:100,metadata:{title:'Livro Repetido'}};
 assert.equal((await s.call(draft)).status,200);
 const duplicate=await (await s.call({...draft,hash:'b'.repeat(64),fileName:'outro.pdf'})).json();
 assert.equal(duplicate.error,'Já existe uma obra com este título no catálogo.');assert.equal(s.catalog.size,1);
});
test('collection uploads preserve folder paths and generated covers require admin and confirmed bytes',async()=>{
 const s=server('reading-catalog'),draft={username:'admin',action:'prepare',hash:HASH,format:'cbz',fileName:'Revista.cbz',size:100,metadata:{title:'Revista',collection_path:'Marvel/Deadpool/2013'}};
 const result=await(await s.call(draft)).json(),id=result.book.id;
 assert.match(s.signed[0].Key,/^reading\/collections\/Marvel\/Deadpool\/2013\//);assert.equal(result.book.collection_path,'Marvel/Deadpool/2013');
 assert.equal((await s.call({...draft,hash:'b'.repeat(64),metadata:{title:'Bad',collection_path:'../escape'}})).status,400);
 assert.equal((await s.call({...draft,hash:'b'.repeat(64),metadata:{title:'Long',collection_path:'界'.repeat(400)}})).status,400);
 assert.equal((await s.call({action:'prepare-cover',id,size:50})).status,403);
 assert.equal((await s.call({username:'admin',action:'prepare-cover',id,size:1048577})).status,400);
 assert.equal((await s.call({username:'admin',action:'prepare-cover',id,size:50})).status,200);
 assert.equal((await s.call({username:'admin',action:'confirm-cover',id,size:51})).status,409);
 const cover=await(await s.call({username:'admin',action:'confirm-cover',id,size:50})).json();assert.match(cover.cover_url,/\.cover\.jpg$/);
 assert.equal((await s.call({username:'admin',action:'remove',id,confirm:true})).status,200);assert.equal(s.deleted.length,2);assert.equal(s.catalog.size,0);
});
function client(remote){
 const values=new Map();const c={console,crypto,Date,setTimeout:()=>1,clearTimeout(){},currentUser:{user:'reginaldo',pass:'p',profile:{slot:1,data_key:'profile-1'}},
 localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),get length(){return values.size;},key:i=>[...values.keys()][i]},
 supabaseClient:{functions:{invoke:async(_name,{body})=>{const response=await remote.call(body);return {data:await response.json()};}}}};
 c.window=c;c.addEventListener=()=>{};vm.createContext(c);
 vm.runInContext(fs.readFileSync('js/reader-store.js','utf8'),c);vm.runInContext(fs.readFileSync('js/reader-cloud.js','utf8'),c);return c;
}
test('two devices preserve conflicting text in recoveries, merge distinct page comments, and retry offline',async()=>{
 const remote=server(),a=client(remote),b=client(remote);const owner=a.LuxReaderStore.owner(a.currentUser);
 a.LuxReaderStore.writeState(owner,HASH,{notes:'original'});await a.LuxReaderCloud.sync(owner,HASH);await b.LuxReaderCloud.sync(owner,HASH);
 a.LuxReaderStore.writeState(owner,HASH,{notes:'edição A'});b.LuxReaderStore.writeState(owner,HASH,{notes:'edição B'});
 await a.LuxReaderCloud.sync(owner,HASH);await b.LuxReaderCloud.sync(owner,HASH);
 const state=b.LuxReaderStore.readState(owner,HASH);assert.equal(state.notes,'edição A');assert.ok(Object.values(state.recoveries).some(r=>r.text==='edição B'));
 const invoke=b.supabaseClient.functions.invoke;b.supabaseClient.functions.invoke=async()=>{throw Error('offline')};
 b.LuxReaderStore.writeState(owner,HASH,{annotations:{[MARK]:{text:'página',anchor:{page:5},label:'Página 5',color:'#60a5fa'}}});
 assert.equal(await b.LuxReaderCloud.sync(owner,HASH),false);assert.equal(b.LuxReaderStore.readState(owner,HASH)._records['mark:'+MARK].dirty,true);
 b.supabaseClient.functions.invoke=invoke;await b.LuxReaderCloud.sync(owner,HASH);await a.LuxReaderCloud.sync(owner,HASH);
 assert.equal(a.LuxReaderStore.readState(owner,HASH).annotations[MARK].anchor.page,5);
 assert.deepEqual(Array.from(b.LuxReaderStore.stateBooks(owner)),[HASH]);
});
test('late responses do not restore data into a newly selected account',async()=>{
 const s=server(),c=client(s),owner=c.LuxReaderStore.owner(c.currentUser);let finish;
 c.supabaseClient.functions.invoke=()=>new Promise(resolve=>finish=resolve);
 const work=c.LuxReaderCloud.sync(owner,HASH);c.currentUser={user:'ana',pass:'p',profile:{slot:1,data_key:'profile-1'}};
 finish({data:{records:[{key:'notebook',payload:{text:'private'},revision:1}]}});await work;
 assert.equal(c.LuxReaderStore.readState(c.LuxReaderStore.owner(c.currentUser),HASH).notes,undefined);
});
test('expired ISO dates from Postgres and legacy Brazilian dates both reject access',async()=>{
 for(const expiry of ['2000-01-01','01/01/2000'])assert.equal((await server('reading-sync',expiry).call({action:'pull',bookId:HASH})).status,403);
});
test('notebook edits made during an upload remain pending and are saved in the next revision',async()=>{
 const remote=server(),c=client(remote),owner=c.LuxReaderStore.owner(c.currentUser);const original=c.supabaseClient.functions.invoke;let release,held=false;
 c.supabaseClient.functions.invoke=async(...args)=>{const response=await original(...args);if(!held&&args[1].body.action==='push'){held=true;return new Promise(resolve=>release=()=>resolve(response));}return response;};
 c.LuxReaderStore.writeState(owner,HASH,{notes:'before'});const work=c.LuxReaderCloud.sync(owner,HASH);
 while(!release)await new Promise(resolve=>setImmediate(resolve));
 c.LuxReaderStore.writeState(owner,HASH,{notes:'typed while syncing'});release();await work;
 assert.equal(c.LuxReaderStore.readState(owner,HASH).notes,'typed while syncing');
 assert.equal((await (await remote.call({action:'pull',bookId:HASH})).json()).records[0].payload.text,'typed while syncing');
});
