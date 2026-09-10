import { readingAuth, readingHeaders, readingJson } from '../_shared/reading-auth.ts';
function validRecord(record:any) {
 if(!record || typeof record.key!=='string' || !/^(progress|preferences|notebook|(?:mark|recovery):[a-f0-9-]{36})$/.test(record.key) || !Number.isSafeInteger(record.revision) || record.revision<0)return false;
 const p=record.payload;
 if(!p || typeof p!=='object' || Array.isArray(p) || JSON.stringify(p).length>210000)return false;
 if(p.deleted===true)return Object.keys(p).length===1;
 const exact=(keys:string[])=>Object.keys(p).every(key=>keys.includes(key));
 if(record.key==='notebook')return exact(['text'])&&typeof p.text==='string'&&p.text.length<=200000;
 if(record.key==='progress')return exact(['page','total','progress','cfi'])&&['page','total'].every(k=>p[k]===undefined||(Number.isSafeInteger(p[k])&&p[k]>=0&&p[k]<=1000000))&&(p.progress===undefined||(Number.isFinite(p.progress)&&p.progress>=0&&p.progress<=1))&&(p.cfi===undefined||(typeof p.cfi==='string'&&p.cfi.length<=4096));
 if(record.key==='preferences')return exact(['theme','zoom','fontSize','effect'])&&(!p.theme||['dark','light','sepia'].includes(p.theme))&&(!p.effect||['page','slide','none'].includes(p.effect))&&(!p.zoom||['1','1.25','1.5','2','3'].includes(String(p.zoom)))&&(!p.fontSize||['90','110','130','160','200'].includes(String(p.fontSize)));
 if(record.key.startsWith('recovery:'))return exact(['text','label'])&&typeof p.text==='string'&&p.text.length<=200000&&typeof p.label==='string'&&p.label.length<=200;
 return exact(['text','anchor','color','label'])&&typeof p.text==='string'&&p.text.length<=10000&&['#fbbf24','#c084fc','#60a5fa','#4ade80','#fb7185'].includes(p.color)&&typeof p.label==='string'&&p.label.length<=200&&p.anchor&&Object.keys(p.anchor).every(key=>['page','cfi'].includes(key))&&((Number.isSafeInteger(p.anchor.page)&&p.anchor.page>0&&p.anchor.page<=1000000)||(typeof p.anchor.cfi==='string'&&/^epubcfi\(/.test(p.anchor.cfi)&&p.anchor.cfi.length<=4096));
}
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:readingHeaders});
 if(request.method!=='POST')return readingJson({error:'Método não permitido.'},405);
 try{
  let body;try{body=await request.json();}catch{return readingJson({error:'JSON inválido.'},400);}
  const auth=await readingAuth(body);
  if(typeof body.bookId!=='string'||!/^[a-f0-9]{64}$/.test(body.bookId))return readingJson({error:'Obra inválida.'},400);
  if(body.action==='pull'){
   const offset=body.offset??0;if(!Number.isSafeInteger(offset)||offset<0)return readingJson({error:'Página inválida.'},400);
   const {data,error}=await auth.db.from('reading_records').select('record_key,payload,revision').eq('user_name',auth.account.usuario).eq('profile_key',auth.profileKey).eq('book_id',body.bookId).order('record_key').range(offset,offset+99);
   if(error)throw error;return readingJson({records:(data||[]).map(r=>({key:r.record_key,payload:r.payload,revision:Number(r.revision)}))});
  }
  if(body.action!=='push'||!Array.isArray(body.records)||body.records.length>40||body.records.some((r:any)=>!validRecord(r))||JSON.stringify(body.records).length>1000000)return readingJson({error:'Dados de leitura inválidos. Arquivos não são aceitos nesta sincronização.'},400);
  const results=[];
  for(const record of body.records){
   const {data,error}=await auth.db.rpc('commit_reading_record',{p_user:auth.account.usuario,p_slot:auth.slot,p_profile:auth.profileKey,p_book:body.bookId,p_key:record.key,p_payload:record.payload,p_expected:record.revision});
   if(error)throw error;results.push(data);
  }
  return readingJson({results});
 }catch(error){return readingJson({error:error.status?error.message:'Não foi possível sincronizar. Suas alterações continuam neste dispositivo.'},error.status||500);}
});
