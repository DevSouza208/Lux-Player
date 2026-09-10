import { readingAuth, readingHeaders, readingJson } from '../_shared/reading-auth.ts';
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand } from 'npm:@aws-sdk/client-s3@3.922.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.922.0';
const types={pdf:'application/pdf',epub:'application/epub+zip',cbr:'application/vnd.comicbook-rar',cbz:'application/vnd.comicbook+zip'};
function r2(){
 const account=Deno.env.get('R2_ACCOUNT_ID'),accessKeyId=Deno.env.get('R2_ACCESS_KEY_ID'),secretAccessKey=Deno.env.get('R2_SECRET_ACCESS_KEY');
 if(!account||!accessKeyId||!secretAccessKey)throw {status:503,message:'Configure as credenciais R2 existentes no Supabase.'};
 return new S3Client({endpoint:`https://${account}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey},region:'auto',forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED'});
}
const bucket=()=>Deno.env.get('R2_BUCKET')||'luxvod';
function publicUrl(key:string){
 const domain=new URL(Deno.env.get('R2_PUBLIC_DOMAIN')||'');if(domain.protocol!=='https:')throw Error('Domínio R2 inválido');
 return domain.href.replace(/\/+$/,'')+'/'+key.split('/').map(encodeURIComponent).join('/');
}
function validObjectKey(key:string){return typeof key==='string'&&/^reading\/(?:collections\/(?:[^/]+\/)*)?[a-f0-9-]{36}\.(pdf|epub|cbr|cbz)$/.test(key)&&!key.split('/').some(p=>p==='.'||p==='..')&&!/[\\\x00-\x1f]/.test(key);}
function metadata(value:any){
 const limits={title:300,authors:500,category:100,description:12000,cover_url:2048,publisher:300,published_year:30,isbn:100,metadata_source:100,collection_path:600,language_code:10};
 if(!value||typeof value!=='object')return null;
 const result:any={};for(const [field,max]of Object.entries(limits)){const v=value[field]??'';if(typeof v!=='string'||v.length>max)return null;result[field]=v.trim();}
 if(!result.title)return null;if(!result.category)result.category='Livros';
 if(result.collection_path.split('/').some(p=>p==='.'||p==='..')||/[\\\x00-\x1f]/.test(result.collection_path))return null;
 result.collection_path=result.collection_path.split('/').map(p=>p.trim()).filter(Boolean).join('/');
 result.translation_available=false; // Legacy column retained for compatibility.
 if(result.cover_url){try{const u=new URL(result.cover_url);if(u.protocol!=='https:'||u.username||u.password)return null;}catch{return null;}}
 result.age_rating=value.age_rating??0;if(!Number.isInteger(result.age_rating)||result.age_rating<0||result.age_rating>18)return null;
 return result;
}
function normalizeTitle(value:string){return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');}
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:readingHeaders});
 if(request.method!=='POST')return readingJson({error:'Método não permitido.'},405);
 try{
  let body;try{body=await request.json();}catch{return readingJson({error:'JSON inválido.'},400);}
  const auth=await readingAuth(body,body?.action!=='list');const {db}=auth;
  if(body.action==='list'){
   const offset=body.offset??0;if(!Number.isSafeInteger(offset)||offset<0)return readingJson({error:'Página inválida.'},400);
   let query=db.from('reading_catalog').select('*');
   if(!auth.isAdmin)query=query.eq('status','approved').eq('upload_complete',true);
   if(auth.profile.is_child)query=query.lt('age_rating',18);
   const {data,error}=await query.order('id').range(offset,offset+99);if(error)throw error;
   return readingJson({books:(data||[]).map(book=>({...book,url:publicUrl(book.object_key)}))});
  }
  if(body.action==='prepare'){
   const meta=metadata(body.metadata);
   if(!meta||typeof body.hash!=='string'||!/^[a-f0-9]{64}$/.test(body.hash)||!Object.hasOwn(types,body.format)||!Number.isSafeInteger(body.size)||body.size<1||body.size>268435456||typeof body.fileName!=='string'||body.fileName.length>255)return readingJson({error:'Arquivo ou metadados inválidos. Limite de 256 MB por obra.'},400);
    const normalizedTitle=normalizeTitle(meta.title);
    const {data:duplicate,error:de}=await db.from('reading_catalog').select('id').eq('normalized_title',normalizedTitle).neq('content_hash',body.hash).maybeSingle();if(de)throw de;
    if(duplicate)return readingJson({error:'Já existe uma obra com este título no catálogo.'},409);
   const {data:existing,error:ee}=await db.from('reading_catalog').select('*').eq('content_hash',body.hash).maybeSingle();if(ee)throw ee;
   if(existing?.upload_complete)return readingJson({book:existing,alreadyUploaded:true});
   const id=existing?.id||crypto.randomUUID(),objectKey=existing?.object_key||(meta.collection_path?`reading/collections/${meta.collection_path}/${id}.${body.format}`:`reading/${id}.${body.format}`);
   if(new TextEncoder().encode(objectKey).length>1000)return readingJson({error:'O caminho das coleções é muito longo. Abrevie os nomes antes de enviar.'},400);
    const record={...meta,id,normalized_title:normalizedTitle,content_hash:body.hash,format:body.format,file_name:body.fileName,size_bytes:body.size,object_key:objectKey,status:'pending',upload_complete:false,created_by:auth.account.usuario};
   const {data:book,error}=await db.rpc('prepare_reading_book',{p_record:record});if(error)throw error;
   if(book.upload_complete)return readingJson({book,alreadyUploaded:true});
   const contentType=types[body.format];
   const uploadUrl=await getSignedUrl(r2(),new PutObjectCommand({Bucket:bucket(),Key:book.object_key,ContentType:contentType,ContentLength:book.size_bytes}),{expiresIn:900,signableHeaders:new Set(['content-type','content-length'])});
   return readingJson({book,uploadUrl,contentType});
  }
  if(typeof body.id!=='string'||!/^[a-f0-9-]{36}$/.test(body.id))return readingJson({error:'Obra inválida.'},400);
  const {data:book,error:be}=await db.from('reading_catalog').select('*').eq('id',body.id).maybeSingle();if(be)throw be;if(!book)return readingJson({error:'Obra não encontrada.'},404);
  if(body.action==='prepare-cover'||body.action==='confirm-cover'){
   if(!validObjectKey(book.object_key)||!Number.isSafeInteger(body.size)||body.size<1||body.size>1048576)return readingJson({error:'Capa inválida. Use JPEG de até 1 MB.'},400);
   const key=book.object_key.replace(/\.[^.]+$/,'.cover.jpg');
   if(body.action==='prepare-cover'){
    const uploadUrl=await getSignedUrl(r2(),new PutObjectCommand({Bucket:bucket(),Key:key,ContentType:'image/jpeg',ContentLength:body.size}),{expiresIn:900,signableHeaders:new Set(['content-type','content-length'])});
    return readingJson({uploadUrl,contentType:'image/jpeg'});
   }
   const head=await r2().send(new HeadObjectCommand({Bucket:bucket(),Key:key}));
   if(Number(head.ContentLength)!==body.size||head.ContentType!=='image/jpeg')return readingJson({error:'A capa recebida não corresponde ao envio.'},409);
   const {error}=await db.from('reading_catalog').update({cover_url:publicUrl(key),updated_at:new Date().toISOString()}).eq('id',book.id);if(error)throw error;
   return readingJson({cover_url:publicUrl(key)});
  }
  if(body.action==='remove'){
   if(body.confirm!==true)return readingJson({error:'Confirme a exclusão da obra.'},400);
   if(!validObjectKey(book.object_key))return readingJson({error:'Caminho da obra inválido.'},400);
   await r2().send(new DeleteObjectCommand({Bucket:bucket(),Key:book.object_key}));
   await r2().send(new DeleteObjectCommand({Bucket:bucket(),Key:book.object_key.replace(/\.[^.]+$/,'.cover.jpg')}));
   const {error}=await db.from('reading_catalog').delete().eq('id',book.id);if(error)throw error;
   return readingJson({removed:true});
  }
  let patch:any={updated_at:new Date().toISOString()};
  if(body.action==='confirm'){
   const head=await r2().send(new HeadObjectCommand({Bucket:bucket(),Key:book.object_key}));
   if(Number(head.ContentLength)!==Number(book.size_bytes)||head.ContentType!==types[book.format])return readingJson({error:'O arquivo recebido não corresponde ao upload. Envie novamente.'},409);
   patch.upload_complete=true;
  }else if(body.action==='edit'){
   const meta=metadata(body.metadata);if(!meta)return readingJson({error:'Preencha metadados válidos.'},400);patch={...patch,...meta};
  }else if(body.action==='status'){
   if(!['pending','approved','rejected'].includes(body.status))return readingJson({error:'Status inválido.'},400);
   if(body.status==='approved'&&!book.upload_complete)return readingJson({error:'Conclua e confirme o upload antes de aprovar.'},409);
   patch.status=body.status;
  }else return readingJson({error:'Ação inválida.'},400);
  const {data,error}=await db.from('reading_catalog').update(patch).eq('id',body.id).select('*').single();if(error)throw error;
  return readingJson({book:{...data,url:publicUrl(data.object_key)}});
 }catch(error){return readingJson({error:error.status?error.message:'Não foi possível atualizar o catálogo de leitura. Tente novamente.'},error.status||500);}
});
