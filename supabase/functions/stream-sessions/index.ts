import { createClient } from 'npm:@supabase/supabase-js@2';

// ============================================================
// [LUX-IPTV-STREAM-001] CONTROLE DE STREAMS SIMULTÂNEOS
// [LUX-AUTH-007] CREDENCIAL REVOGÁVEL
// ============================================================
const corsHeaders = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'};
const STALE_SECONDS=90;
function json(data:unknown,status=200){return Response.json(data,{status,headers:{...corsHeaders,'Content-Type':'application/json'}})}
function clean(value:unknown){return String(value??'').trim()}
function safeLimit(value:unknown){const n=Number(value);return Number.isInteger(n)?Math.max(1,Math.min(20,n)):3}
function validSessionId(value:unknown){const text=clean(value);return text.length>=8&&text.length<=128&&/^[a-zA-Z0-9._:-]+$/.test(text)}
async function sha256(value:string){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));return Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('')}
function sourceIdentity(account:any){const xcUrl=clean(account?.urlxc).replace(/\/+$/,''),xcUser=clean(account?.userxc),xcPass=clean(account?.senhaxc);if(xcUrl&&xcUser&&xcPass)return `xc|${xcUrl.toLowerCase()}|${xcUser}|${xcPass}`;const m3u=clean(account?.lista_m3u);if(!m3u)return'';try{const parsed=new URL(m3u),username=clean(parsed.searchParams.get('username')||parsed.searchParams.get('user')),password=clean(parsed.searchParams.get('password')||parsed.searchParams.get('pass'));if(username&&password)return `xc|${parsed.origin.toLowerCase()}|${username}|${password}`;parsed.hash='';return `m3u|${parsed.toString()}`}catch{return `m3u|${m3u}`}}
async function sourceKeyFor(account:any){const identity=sourceIdentity(account);return identity?await sha256(identity):''}
Deno.serve(async request=>{
 if(request.method==='OPTIONS')return new Response('ok',{headers:corsHeaders});if(request.method!=='POST')return json({error:'Método não permitido.'},405);
 try{
  const body=await request.json(),action=clean(body?.action),username=clean(body?.username),password=clean(body?.password);if(!username||!password)return json({error:'Credenciais inválidas.'},401);
  const url=Deno.env.get('SUPABASE_URL'),serviceRoleKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');if(!url||!serviceRoleKey)throw new Error('Configuração do Supabase indisponível.');const admin=createClient(url,serviceRoleKey,{auth:{persistSession:false}});
  const{data:account,error:accountError}=await admin.rpc('lux_auth_resolve',{p_username:username,p_credential:password});if(accountError)throw accountError;if(!account)return json({error:'Credencial inválida ou sessão expirada.'},401);
  const userName=clean(account.usuario),sourceKey=await sourceKeyFor(account),limit=safeLimit(account.stream_limit),cutoffIso=new Date(Date.now()-STALE_SECONDS*1000).toISOString();if(!sourceKey&&action!=='statusAll')return json({managed:false,allowed:true,active:0,limit});
  if(action==='acquire'){const sessionId=clean(body?.sessionId);if(!validSessionId(sessionId))return json({error:'Sessão inválida.'},400);const{data,error}=await admin.rpc('acquire_stream_session',{p_session_id:sessionId,p_user_name:userName,p_source_key:sourceKey,p_limit:limit,p_device_id:clean(body?.deviceId).slice(0,200),p_profile_key:clean(body?.profileKey).slice(0,200),p_media_key:clean(body?.mediaKey).slice(0,500)});if(error)throw error;return json({managed:true,...(data||{allowed:false,active:0,limit})})}
  if(action==='heartbeat'){const sessionId=clean(body?.sessionId);if(!validSessionId(sessionId))return json({error:'Sessão inválida.'},400);const{data,error}=await admin.from('stream_sessions').update({last_heartbeat:new Date().toISOString(),media_key:clean(body?.mediaKey).slice(0,500)}).eq('session_id',sessionId).eq('user_name',userName).eq('source_key',sourceKey).gte('last_heartbeat',cutoffIso).select('session_id').maybeSingle();if(error)throw error;return json({managed:true,ok:Boolean(data),expired:!data,limit})}
  if(action==='release'){const sessionId=clean(body?.sessionId);if(!validSessionId(sessionId))return json({error:'Sessão inválida.'},400);const{error}=await admin.from('stream_sessions').delete().eq('session_id',sessionId).eq('user_name',userName);if(error)throw error;return json({managed:true,released:true})}
  if(action==='status'){await admin.from('stream_sessions').delete().lt('last_heartbeat',cutoffIso);const{count,error}=await admin.from('stream_sessions').select('session_id',{count:'exact',head:true}).eq('source_key',sourceKey).gte('last_heartbeat',cutoffIso);if(error)throw error;return json({managed:true,active:Number(count)||0,limit})}
  if(action==='statusAll'){if(clean(account.cargo).toLowerCase()!=='admin')return json({error:'Acesso negado.'},403);await admin.from('stream_sessions').delete().lt('last_heartbeat',cutoffIso);const[{data:users,error:usersError},{data:sessions,error:sessionsError}]=await Promise.all([admin.from('usuarios').select('usuario,lista_m3u,userxc,senhaxc,urlxc,stream_limit').order('usuario'),admin.from('stream_sessions').select('user_name,source_key,last_heartbeat').gte('last_heartbeat',cutoffIso)]);if(usersError)throw usersError;if(sessionsError)throw sessionsError;const counts=new Map<string,number>();for(const session of sessions||[]){const key=clean(session.source_key);counts.set(key,(counts.get(key)||0)+1)}const statuses:Record<string,unknown>={};for(const user of users||[]){const key=await sourceKeyFor(user);statuses[clean(user.usuario)]={managed:Boolean(key),active:key?(counts.get(key)||0):0,limit:safeLimit(user.stream_limit)}}return json({users:statuses,staleAfterSeconds:STALE_SECONDS})}
  return json({error:'Ação inválida.'},400);
 }catch(error){console.error('stream-sessions:',error);return json({error:error?.message||'Não foi possível controlar as sessões de reprodução.'},500)}
});
