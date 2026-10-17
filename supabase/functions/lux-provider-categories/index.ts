// Categorias oficiais Xtream para Lux Original.
// Somente metadados (IDs de stream -> categoria e titulo da série -> categoria).
// Nunca publica credenciais do provedor, URL da lista ou URL de reprodução.
import { createClient } from 'npm:@supabase/supabase-js@2';

const supaUrl=Deno.env.get('SUPABASE_URL')||'';
const serviceRole=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const db=createClient(supaUrl,serviceRole,{auth:{autoRefreshToken:false,persistSession:false}});
const allow=new Set(['https://lux-player.vercel.app','https://lux-player-devsouzas-projects-93fbb326.vercel.app']);
const ttlMs=24*3600*1000;
const headersFor=(origin)=>({
  'Content-Type':'application/json; charset=utf-8',
  'Cache-Control':'no-store',
  'Access-Control-Allow-Origin':allow.has(origin)?origin:'https://lux-player.vercel.app',
  'Vary':'Origin','Access-Control-Allow-Headers':'content-type,authorization,apikey,x-client-info',
  'Access-Control-Allow-Methods':'POST,OPTIONS'
});
function reply(data,status,origin){return new Response(JSON.stringify(data),{status,headers:headersFor(origin)})}
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\.(mkv|mp4|avi|mov)$/i,'').replace(/\((?:19|20)\d{2}\)/g,' ').replace(/\[(?:19|20)\d{2}\]/g,' ').replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function validPublicHost(u){
  const host=u.hostname.toLowerCase().replace(/^\[|\]$/g,'');
  if (!['http:','https:'].includes(u.protocol)||u.username||u.password||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal'))return false;
  if(host.includes(':'))return false; // no IPv6 literal / loopback
  if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){
    const x=host.split('.').map(Number);
    if(x.some(a=>a<0||a>255)||x[0]===0||x[0]===10||x[0]===127||x[0]>=224||x[0]===169&&x[1]===254||x[0]===192&&x[1]===168||x[0]===172&&x[1]>=16&&x[1]<=31||x[0]===100&&x[1]>=64&&x[1]<=127||x[0]===192&&x[1]===0||x[0]===198&&[18,19].includes(x[1]))return false;
  }
  if(u.port&&!['80','443'].includes(u.port))return false;
  return true;
}
function sourceFromUser(account){
  const xcUrl=String(account.urlxc||'').trim(),xcUser=String(account.userxc||''),xcPass=String(account.senhaxc||'');
  if(xcUrl&&xcUser&&xcPass){
    const url=new URL(xcUrl);
    if(!validPublicHost(url))throw Error('invalid_source');
    return {url:url.origin,user:xcUser,pass:xcPass};
  }
  const raw=String(account.lista_m3u||'').trim();
  if(!/^https?:\/\//i.test(raw))throw Error('no_xtream_list');
  const url=new URL(raw);
  if(!validPublicHost(url)||!/\/(?:get|player_api)\.php$/i.test(url.pathname))throw Error('invalid_source');
  const user=url.searchParams.get('username')||url.searchParams.get('user');
  const pass=url.searchParams.get('password')||url.searchParams.get('pass');
  if(!user||!pass)throw Error('missing_xtream_credentials');
  return {url:url.origin,user,pass};
}
function categoryMap(raw){
  const result={};
  if(!Array.isArray(raw))return result;
  for(const cat of raw){
    const id=String(cat.category_id??cat.id??'').trim();
    const name=String(cat.category_name??cat.name??'').trim().slice(0,140);
    if(id&&name&&id!=='undefined'&&!['filmes','series','séries','movies','geral','all'].includes(norm(name)))result[id]=name;
  }
  return result;
}
function groupOf(item,map){
  const ids=[item.category_id,...(Array.isArray(item.category_ids)?item.category_ids:[])].filter(x=>x!=null);
  for(const id of ids){if(map[String(id)])return map[String(id)]}
  return '';
}
function buildIndex(catsMovies,catsSeries,movies,series){
  const movieGroups=categoryMap(catsMovies),seriesGroups=categoryMap(catsSeries);
  const movieIds={},movieTitles={},seriesIds={},seriesTitles={};
  const AMBIGUOUS='__ambiguous__';
  const insertTitle=(map,key,val)=>{if(!key)return;if(map[key]&&map[key]!==val)map[key]=AMBIGUOUS;else if(!map[key])map[key]=val};
  let movieMapped=0,seriesMapped=0;
  for(const item of movies){
    const group=groupOf(item,movieGroups);
    if(!group)continue;
    const id=item.stream_id??item.id;
    if(id!=null&&/^\d+$/.test(String(id))){movieIds[String(id)]=group;movieMapped++}
    insertTitle(movieTitles,norm(item.name),group);
  }
  for(const item of series){
    const group=groupOf(item,seriesGroups);
    if(!group)continue;
    const id=item.series_id??item.id;
    if(id!=null&&/^\d+$/.test(String(id))){seriesIds[String(id)]=group;seriesMapped++}
    insertTitle(seriesTitles,norm(item.name||item.title),group);
  }
  for(const map of [movieTitles,seriesTitles])for(const [key,val] of Object.entries(map))if(val===AMBIGUOUS)delete map[key];
  return {version:1,movieIds,movieTitles,seriesIds,seriesTitles,counts:{movieCategories:Object.keys(movieGroups).length,seriesCategories:Object.keys(seriesGroups).length,movieStreams:movies.length,seriesStreams:series.length,movieMapped,seriesMapped}};
}
async function upstream(src,action){
  const url=new URL(src.url+'/player_api.php');
  url.searchParams.set('username',src.user);url.searchParams.set('password',src.pass);url.searchParams.set('action',action);
  const response=await fetch(url.toString(),{redirect:'error',signal:AbortSignal.timeout(55000),headers:{Accept:'application/json'}});
  if(!response.ok)throw Error('provider_unavailable');
  const len=Number(response.headers.get('content-length')||0);
  if(len>35_000_000)throw Error('provider_response_too_large');
  const data=await response.json();
  if(!Array.isArray(data))throw Error('invalid_provider_response');
  return data;
}
async function cacheKey(src){
  const raw=new TextEncoder().encode(src.url+'|'+src.user);
  const buf=await crypto.subtle.digest('SHA-256',raw);
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
Deno.serve(async request=>{
  const origin=request.headers.get('Origin')||'';
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headersFor(origin)});
  if(request.method!=='POST')return reply({error:'method_not_allowed'},405,origin);
  if(origin&&!allow.has(origin))return reply({error:'origin_not_allowed'},403,origin);
  try{
    const body=await request.json().catch(()=>null);
    const username=String(body?.username||'').trim();
    const credential=String(body?.credential||'');
    if(!username||username.length>100||!credential||credential.length>250)return reply({error:'invalid_auth'},401,origin);
    const {data:account,error:authError}=await db.rpc('lux_auth_resolve',{p_username:username,p_credential:credential});
    if(authError||!account?.usuario)return reply({error:'not_authenticated'},401,origin);
    const src=sourceFromUser(account),key=await cacheKey(src);
    const {data:cached}=await db.from('lux_provider_category_cache').select('data,refreshed_at').eq('source_key',key).maybeSingle();
    if(cached?.data && Date.now()-Date.parse(cached.refreshed_at)<ttlMs&&!body?.refresh)return reply({ok:true,source:'shared_cache',data:cached.data},200,origin);
    try {
      const [catsMovies,catsSeries,movies,series]=await Promise.all([
        upstream(src,'get_vod_categories'),upstream(src,'get_series_categories'),
        upstream(src,'get_vod_streams'),upstream(src,'get_series')
      ]);
      const data=buildIndex(catsMovies,catsSeries,movies,series);
      // Never overwrite good stored categories with generic-only or failed replies.
      if(!data.counts.movieMapped&&!data.counts.seriesMapped)throw Error('no_detailed_categories');
      await db.from('lux_provider_category_cache').upsert({source_key:key,data,refreshed_at:new Date().toISOString()},{onConflict:'source_key'});
      return reply({ok:true,source:'provider',data},200,origin);
    } catch(err){
      if(cached?.data)return reply({ok:true,source:'stale_cache',data:cached.data},200,origin);
      return reply({ok:false,error:String(err?.message||'provider_unavailable').replace(/https?:\/\/\S+/g,'[redacted]')},503,origin);
    }
  } catch(err){
    return reply({error:'category_service_unavailable'},503,origin);
  }
});
