import { createClient } from 'npm:@supabase/supabase-js@2';
import { S3Client, PutObjectCommand } from 'npm:@aws-sdk/client-s3@3.922.0';
import { getSignedUrl } from 'npm:@aws-sdk/s3-request-presigner@3.922.0';
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Cache-Control':'no-store'};
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:corsHeaders});
Deno.serve(async(request:Request)=>{
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:corsHeaders});if(request.method!=='POST')return json({error:'Método não permitido.'},405);
 try{
  let body;try{body=await request.json()}catch{return json({error:'JSON inválido.'},400)}if(!body||typeof body!=='object'||Array.isArray(body))return json({error:'Dados inválidos.'},400);
  const{username,password,fileName,contentType,bucket,prefix='vods/'}=body;if(typeof username!=='string'||!username||username.length>256||typeof password!=='string'||!password||password.length>1024)return json({error:'Login de administrador necessário.'},401);
  const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  // [LUX-AUTH-007] A credencial pode ser senha legada ou token revogável.
  const{data:account,error}=await admin.rpc('lux_auth_resolve',{p_username:username,p_credential:password});if(error)throw new Error('Falha ao validar administrador.');if(!account)return json({error:'Credencial inválida ou sessão expirada.'},401);if(String(account.cargo).trim().toLowerCase()!=='admin')return json({error:'Acesso exclusivo de administrador.'},403);
  if(bucket!=='luxvod')return json({error:'O bucket permitido é luxvod.'},400);if(typeof fileName!=='string'||!fileName.trim()||fileName.length>255||typeof contentType!=='string'||!/^video\/[a-z0-9.+-]+$/i.test(contentType)||typeof prefix!=='string'||prefix.length>200)return json({error:'Nome, tipo de vídeo ou prefixo inválido.'},400);
  const folder=prefix.replace(/^\/+|\/+$/g,'');if(folder&&folder.split('/').some((part:string)=>!/^[a-zA-Z0-9_-]+$/.test(part)))return json({error:'Use letras, números, hífen, sublinhado e barras no prefixo.'},400);
  const accountId=Deno.env.get('R2_ACCOUNT_ID'),accessKeyId=Deno.env.get('R2_ACCESS_KEY_ID'),secretAccessKey=Deno.env.get('R2_SECRET_ACCESS_KEY'),publicDomain=Deno.env.get('R2_PUBLIC_DOMAIN');if(!accountId||!accessKeyId||!secretAccessKey||!publicDomain)return json({error:'Configure os secrets R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e R2_PUBLIC_DOMAIN no Supabase.'},503);if(!/^[a-f0-9]{32}$/i.test(accountId)||(Deno.env.get('R2_BUCKET')||'luxvod')!=='luxvod')return json({error:'Configuração da conta ou bucket R2 inválida.'},503);
  const domain=new URL(publicDomain);if(domain.protocol!=='https:'||domain.username||domain.password||domain.search||domain.hash||domain.hostname.endsWith('.r2.cloudflarestorage.com'))return json({error:'R2_PUBLIC_DOMAIN deve ser o domínio HTTPS público do bucket, próprio ou r2.dev.'},503);
  const safeName=fileName.trim().replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g,'_'),objectKey=`${folder?folder+'/':''}${crypto.randomUUID()}-${safeName}`;const client=new S3Client({endpoint:`https://${accountId}.r2.cloudflarestorage.com`,credentials:{accessKeyId,secretAccessKey},region:'auto',forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED'});const uploadUrl=await getSignedUrl(client,new PutObjectCommand({Bucket:'luxvod',Key:objectKey,ContentType:contentType}),{expiresIn:900,signableHeaders:new Set(['content-type'])});return json({uploadUrl,publicUrl:`${domain.href.replace(/\/+$/,'')}/${objectKey.split('/').map(encodeURIComponent).join('/')}`,objectKey});
 }catch{return json({error:'Não foi possível preparar o upload. Verifique a configuração da função.'},500)}
});
