// Opt-in integration check against the configured Lux project. All accounts and files are synthetic and removed.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process'),assert=require('node:assert/strict');
if(process.env.LUX_READING_LIVE!=='1')throw Error('Set LUX_READING_LIVE=1 to run the live integration check.');
const root=path.resolve(__dirname,'..'),out=path.join(root,'release/reader-validation');fs.mkdirSync(out,{recursive:true});
const sqlPath=path.join(out,'live-validation.tmp.sql');
function sql(text){
 fs.writeFileSync(sqlPath,text);
 const result=spawnSync('powershell.exe',['-NoProfile','-Command',`& supabase.cmd db query --linked --file '${sqlPath.replace(/'/g,"''")}' --output json`],{cwd:root,encoding:'utf8',windowsHide:true});
 if(result.status!==0)throw Error('Database helper failed: '+String(result.error?.message||result.stderr||'unknown').replaceAll(password,'[test-secret]').slice(0,500));
 return result.stdout;
}
const suffix=crypto.randomUUID().replaceAll('-','').slice(0,16),a='__lux_reading_test_a_'+suffix,b='__lux_reading_test_b_'+suffix,password=crypto.randomBytes(32).toString('hex'),profile=crypto.randomUUID(),otherProfile=crypto.randomUUID();
const source=fs.readFileSync(path.join(root,'js/script.js'),'utf8'),url=source.match(/const SUPABASE_URL = '([^']+)'/)[1],apikey=source.match(/const SUPABASE_PUBLISHABLE_KEY = '([^']+)'/)[1];
const defaults={username:a,password,profileSlot:1,profileKey:profile};
async function request(name,body){const response=await fetch(url+'/functions/v1/'+name,{method:'POST',headers:{apikey,'Content-Type':'application/json'},body:JSON.stringify({...defaults,...body}),signal:AbortSignal.timeout(25000)});const data=await response.json();return {status:response.status,data};}
let bookId,setup=false;
(async()=>{
 try{
  setup=true;sql(`begin;insert into public.usuarios(usuario,nome,senha,cargo,vencimento) values('${a}','Teste temporário de leitura','${password}','admin','2099-12-31'),('${b}','Teste temporário de leitura','${password}','user','2099-12-31');insert into public.account_profiles(user_name,slot,name,data_key,is_child) values('${a}',1,'Ana','${profile}',false),('${a}',2,'Ana','${otherProfile}',false),('${b}',1,'Ana','${profile}',false);commit;`);
  const file=Buffer.from('%PDF-1.4\n% Lux synthetic transport validation '+suffix+'\n%%EOF'),hash=crypto.createHash('sha256').update(file).digest('hex');
  const record={key:'notebook',payload:{text:'Synthetic reading note'},revision:0};
  let response=await request('reading-sync',{action:'push',bookId:hash,records:[record]});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.results[0].saved,true);
  response=await request('reading-sync',{action:'pull',bookId:hash,username:b});assert.equal(response.status,200);assert.equal(response.data.records.length,0);
  response=await request('reading-sync',{action:'pull',bookId:hash,profileSlot:2,profileKey:otherProfile});assert.equal(response.data.records.length,0);
  response=await request('reading-sync',{action:'pull',bookId:hash,profileKey:crypto.randomUUID()});assert.equal(response.status,403);
  response=await request('reading-sync',{action:'push',bookId:hash,records:[{...record,payload:{text:'stale'}}]});assert.equal(response.data.results[0].saved,false);
  response=await request('reading-sync',{action:'push',bookId:hash,records:[{key:'file',payload:{dataBase64:file.toString('base64')},revision:0}]});assert.equal(response.status,400);
  console.log('LIVE: account/profile isolation, version checks and file rejection OK');
  response=await request('reading-catalog',{action:'prepare',hash,format:'pdf',size:file.length,fileName:'lux-validation.pdf',metadata:{title:'Validação técnica temporária',category:'Outros'}});assert.equal(response.status,200,JSON.stringify(response.data));bookId=response.data.book.id;
  const upload=await fetch(response.data.uploadUrl,{method:'PUT',headers:{'Content-Type':response.data.contentType},body:file,signal:AbortSignal.timeout(25000)});assert.ok(upload.ok,'R2 PUT '+upload.status);
  response=await request('reading-catalog',{action:'status',id:bookId,status:'approved'});assert.equal(response.status,409);
  response=await request('reading-catalog',{action:'confirm',id:bookId});assert.equal(response.status,200,JSON.stringify(response.data));
  const downloaded=await fetch(response.data.book.url,{signal:AbortSignal.timeout(25000)});assert.ok(downloaded.ok);assert.equal(crypto.createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'),hash);
  response=await request('reading-catalog',{action:'list',username:b});assert.ok(!response.data.books.some(book=>book.id===bookId));
  response=await request('reading-catalog',{action:'status',id:bookId,status:'approved',username:b});assert.equal(response.status,403);
  response=await request('reading-catalog',{action:'status',id:bookId,status:'approved'});assert.equal(response.status,200);
  response=await request('reading-catalog',{action:'list',username:b});assert.ok(response.data.books.some(book=>book.id===bookId));
  console.log('LIVE: signed R2 upload, byte integrity, draft visibility and approval OK');
  response=await request('progress-sync',{action:'push',records:[{key:'favorite:media:synthetic',payload:{favorite:true},updatedAt:Date.now()}]});assert.equal(response.status,200,JSON.stringify(response.data));
  response=await request('progress-sync',{action:'pull',username:b});assert.equal(response.data.records.length,0);
  console.log('LIVE: existing movie/series/favorites service remains isolated');
 }finally{
  try{if(bookId){const removed=await request('reading-catalog',{action:'remove',id:bookId,confirm:true});if(removed.status!==200)throw Error('R2 cleanup failed for catalog ID '+bookId);}}
  finally{try{if(setup)sql(`begin;delete from public.user_progress where user_name in('${a}','${b}');delete from public.account_profiles where user_name in('${a}','${b}');delete from public.usuarios where usuario in('${a}','${b}');commit;`);}finally{if(fs.existsSync(sqlPath))fs.unlinkSync(sqlPath);}}
  console.log('LIVE: temporary test accounts/data cleanup completed');
 }
})().catch(error=>{console.error(error.message);process.exitCode=1;});
