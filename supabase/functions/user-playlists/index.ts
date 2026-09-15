import { createClient } from 'npm:@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Cache-Control':'no-store'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers});
const CHUNK=8*1024*1024,MAX=200*1024*1024;
const validSize=(size:unknown):size is number=>Number.isInteger(size)&&Number(size)>0&&Number(size)<=MAX;
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});if(request.method!=='POST')return json({error:'Método não permitido.'},405);
 try{
  let body;try{body=await request.json()}catch{return json({error:'JSON inválido.'},400)}
  if(!body||!['prepare','verify','read'].includes(body.action))return json({error:'Ação inválida.'},400);
  if(typeof body.username!=='string'||!body.username||typeof body.password!=='string'||!body.password)return json({error:'Login necessário.'},401);
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  // [LUX-AUTH-007] password pode ser senha legada ou token revogável luxsess_.
  const{data:account,error}=await db.rpc('lux_auth_resolve',{p_username:body.username,p_credential:body.password});if(error)throw error;if(!account)return json({error:'Credencial inválida ou sessão expirada.'},401);
  if(body.action!=='read'&&String(account.cargo).trim().toLowerCase()!=='admin')return json({error:'Acesso exclusivo de administrador.'},403);
  const bucket=db.storage.from('user-playlists');
  if(body.action==='prepare'){
   if(!validSize(body.size))return json({error:'O limite é de 200 MB; o arquivo não pode estar vazio.'},400);
   const folder=crypto.randomUUID(),parts=[];for(let i=0;i<Math.ceil(body.size/CHUNK);i++){const path=`${folder}/${String(i).padStart(3,'0')}.part`;const{data,error}=await bucket.createSignedUploadUrl(path);if(error)throw error;parts.push({path,token:data.token})}return json({reference:`m3u-storage:${folder}`,chunkSize:CHUNK,parts});
  }
  const reference=body.action==='read'?account.lista_m3u:body.reference;if(typeof reference!=='string'||!/^m3u-storage:[a-f0-9-]{36}$/.test(reference))return json({error:'Lista de arquivo não encontrada.'},404);
  const folder=reference.slice('m3u-storage:'.length);const{data:files,error:listError}=await bucket.list(folder,{limit:26,sortBy:{column:'name',order:'asc'}});if(listError)throw listError;
  if(!files?.length||files.length>25||files.some((file,i)=>file.name!==`${String(i).padStart(3,'0')}.part`||!file.metadata?.size||Number(file.metadata.size)>CHUNK))return json({error:'Envio incompleto. Envie o arquivo novamente.'},400);
  const total=files.reduce((sum,file)=>sum+Number(file.metadata.size),0);if(!validSize(total)||files.slice(0,-1).some(file=>Number(file.metadata.size)!==CHUNK))return json({error:'Arquivo incompleto ou acima de 200 MB.'},400);
  if(body.action==='verify'){if(!validSize(body.size)||total!==body.size)return json({error:'Tamanho recebido não corresponde ao arquivo.'},400);return json({reference})}
  const{data:signed,error:signError}=await bucket.createSignedUrls(files.map(file=>`${folder}/${file.name}`),3600);if(signError||signed?.some(item=>item.error||!item.signedUrl))throw signError||new Error('Signing failed');return json({urls:signed!.map(item=>item.signedUrl)});
 }catch{return json({error:'Não foi possível acessar a lista na nuvem. Tente novamente.'},500)}
});
