// Cloudflare Worker: shared TMDB genre classification; never receives IPTV secrets.
const MAX_UPLOAD=200, MAX_JOB=48, CONCURRENCY=4;
const KNOWN=new Set([28,12,16,35,80,99,18,10751,14,36,27,10402,9648,10749,878,10770,53,10752,37,10759,10765,10768,10762,10766,10764,10767]);
function norm(v){return String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()}
function titleOf(v){return norm(String(v||'').replace(/\((?:19|20)\d{2}\)|\[(?:19|20)\d{2}\]/g,' ').replace(/\b(2160p|1080p|720p|4k|uhd|fhd|dublado|legendado|dual audio|hevc|h265|bluray|web dl|brrip)\b/gi,' '))}
function makeRow(item){
 if(!item||typeof item!=='object'||item.adult===true)return null;
 const title=String(item.title||'').trim().slice(0,180);
 if(!title||/https?:\/\/|\/movie\/|\/series\/|[<>]/i.test(title))return null;
 let year=Number(item.year||0);
 if(!Number.isInteger(year)||year<1880||year>new Date().getUTCFullYear()+3)year=0;
 const name=titleOf(title);
 return name.length>=2?{title,year,key:name+'|'+(year||'')}:null;
}
function validKind(k){return k==='movies'||k==='series'?k:null}
function headers(req,env){
 const o=req.headers.get('Origin');
 const list=String(env.ALLOWED_ORIGINS||'https://lux-player.vercel.app').split(',').map(x=>x.trim());
 return o&&list.includes(o)?{'Access-Control-Allow-Origin':o,'Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}:{};
}
function json(data,status=200,more={}){
 return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...more}});
}
async function validateAdmin(body,env){
 const name=String(body?.username||'').trim().slice(0,120),token=String(body?.credential||'');
 if(!name||!/^luxsess_[A-Za-z0-9_-]{40,200}$/.test(token)||!env.SUPABASE_SERVICE_ROLE_KEY||!env.SUPABASE_URL)return false;
 const r=await fetch(env.SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/rpc/lux_auth_resolve',{
   method:'POST',headers:{'Content-Type':'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY},
   body:JSON.stringify({p_username:name,p_credential:token}),signal:AbortSignal.timeout(8000)
 });
 if(!r.ok)return false;
 const account=await r.json();return String(account?.cargo||'').toLowerCase()==='admin';
}
async function ingest(db,kind,items){
 const statements=[],seen=new Set();
 for(const item of items){
   const row=makeRow(item);
   if(!row||seen.has(row.key))continue;seen.add(row.key);
   statements.push(db.prepare("INSERT INTO genre_index(kind,key,title,year,status,attempts,updated_at) VALUES(?,?,?,?,'pending',0,CURRENT_TIMESTAMP) ON CONFLICT(kind,key) DO NOTHING").bind(kind,row.key,row.title,row.year));
 }
 if(statements.length)await db.batch(statements);
 return statements.length;
}
async function catalogPage(db,kind,after,take){
 const q=await db.prepare("SELECT key,genre_ids,tmdb_id FROM genre_index WHERE kind=? AND status='matched' AND key>? ORDER BY key LIMIT ?").bind(kind,after,take).all();
 const rows=(q.results||[]).map(row=>{let ids=[];try{ids=JSON.parse(row.genre_ids)}catch{}return{key:row.key,genre_ids:ids,tmdb_id:row.tmdb_id}});
 return{kind,rows,next:rows.length?rows[rows.length-1].key:null,more:rows.length===take};
}
function sameTitle(row,candidate){
 const expected=titleOf(row.title),names=[candidate.title,candidate.original_title,candidate.name,candidate.original_name].filter(Boolean).map(titleOf);
 if(!names.includes(expected))return false;
 const year=Number(String(candidate.release_date||candidate.first_air_date||'').slice(0,4));
 return !row.year||!year||Math.abs(row.year-year)<=1;
}
async function lookup(env,row){
 const p=new URLSearchParams({api_key:env.TMDB_API_KEY,language:'pt-BR',query:row.title,include_adult:'false',page:'1'});
 if(row.year)p.set(row.kind==='movies'?'year':'first_air_date_year',String(row.year));
 const type=row.kind==='movies'?'movie':'tv';
 const response=await fetch('https://api.themoviedb.org/3/search/'+type+'?'+p,{signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw new Error('tmdb_'+response.status);
 const body=await response.json();
 const hits=(Array.isArray(body.results)?body.results:[]).filter(x=>x&&!x.adult&&sameTitle(row,x));
 if(!row.year&&new Set(hits.map(x=>String(x.release_date||x.first_air_date||'').slice(0,4))).size>1)return null;
 hits.sort((a,b)=>{
   const ay=Number(String(a.release_date||a.first_air_date||'').slice(0,4));
   const by=Number(String(b.release_date||b.first_air_date||'').slice(0,4));
   const ea=row.year&&ay===row.year?1:0,eb=row.year&&by===row.year?1:0;
   return eb-ea+((Number(b.popularity||0)-Number(a.popularity||0))/100000);
 });
 const best=hits[0];
 if(!best||!Number.isInteger(Number(best.id)))return null;
 const ids=[...new Set((Array.isArray(best.genre_ids)?best.genre_ids:[]).map(Number).filter(x=>KNOWN.has(x)))];
 return ids.length?{tmdb:Number(best.id),ids}:null;
}
async function reserve(db,take){
 const now=new Date().toISOString(),stale=new Date(Date.now()-12*60*1000).toISOString();
 const q=await db.prepare("UPDATE genre_index SET status='processing',updated_at=? WHERE (kind,key) IN (SELECT kind,key FROM genre_index WHERE status='pending' OR (status='retry' AND next_retry_at<=?) OR (status='processing' AND updated_at<=?) ORDER BY attempts,updated_at LIMIT ?) RETURNING kind,key,title,year,attempts").bind(now,now,stale,take).all();
 return q.results||[];
}
async function processPending(env){
 if(!env.DB||!env.TMDB_API_KEY)return{error:'not_configured'};
 const jobs=await reserve(env.DB,MAX_JOB);
 let i=0,matched=0,unmatched=0,errors=0;
 await Promise.all(Array.from({length:Math.min(CONCURRENCY,jobs.length)},async()=>{
   while(i<jobs.length){
     const item=jobs[i++];
     try{
       const found=await lookup(env,item);
       if(found){
         await env.DB.prepare("UPDATE genre_index SET status='matched',tmdb_id=?,genre_ids=?,attempts=attempts+1,updated_at=CURRENT_TIMESTAMP,next_retry_at=NULL WHERE kind=? AND key=?").bind(found.tmdb,JSON.stringify(found.ids),item.kind,item.key).run();
         matched++;
       }else{
         await env.DB.prepare("UPDATE genre_index SET status='unmatched',attempts=attempts+1,updated_at=CURRENT_TIMESTAMP,next_retry_at=NULL WHERE kind=? AND key=?").bind(item.kind,item.key).run();unmatched++;
       }
     }catch(_){
       const delay=Math.min(86400,300*2**Math.min(item.attempts,8));
       await env.DB.prepare("UPDATE genre_index SET status='retry',attempts=attempts+1,next_retry_at=?,updated_at=CURRENT_TIMESTAMP WHERE kind=? AND key=?").bind(new Date(Date.now()+delay*1000).toISOString(),item.kind,item.key).run();errors++;
     }
   }
 }));
 return{inspected:jobs.length,matched,unmatched,errors};
}
export default{
 async fetch(req,env,ctx){
   const u=new URL(req.url),h=headers(req,env),origin=req.headers.get('Origin');
   if(req.method==='OPTIONS')return new Response(null,{status:204,headers:h});
   if(origin&&!h['Access-Control-Allow-Origin'])return json({error:'origin_forbidden'},403);
   if(!env.DB)return json({error:'database_unavailable'},503,h);
   if(req.method==='GET'&&u.pathname==='/v1/status'){
     const r=await env.DB.prepare("SELECT kind,status,COUNT(*) AS total FROM genre_index GROUP BY kind,status").all();
     return json({rows:r.results||[]},200,{...h,'Cache-Control':'public, max-age=60, s-maxage=300'});
   }
   if(req.method==='GET'&&u.pathname==='/v1/index'){
     const kind=validKind(u.searchParams.get('kind')),after=String(u.searchParams.get('after')||'').slice(0,230),limit=Number(u.searchParams.get('limit')||1500);
     if(!kind)return json({error:'invalid_kind'},400,h);
     return json(await catalogPage(env.DB,kind,after,Math.min(1500,Math.max(1,Number.isFinite(limit)?limit:1500))),200,{...h,'Cache-Control':'public, max-age=120, s-maxage=600'});
   }
   if(req.method==='POST'&&['/v1/admin/snapshot','/v1/admin/run'].includes(u.pathname)){
     if(!origin||!h['Access-Control-Allow-Origin'])return json({error:'origin_required'},403,h);
     let body;try{body=await req.json()}catch{return json({error:'invalid_json'},400,h)}
     if(!await validateAdmin(body,env))return json({error:'admin_auth_failed'},403,h);
     if(u.pathname==='/v1/admin/run'){
       ctx.waitUntil(processPending(env));return json({ok:true,queued:true},202,h);
     }
     const kind=validKind(body?.kind);
     if(!kind||!Array.isArray(body?.items)||body.items.length>MAX_UPLOAD)return json({error:'invalid_batch',max:MAX_UPLOAD},400,h);
     return json({ok:true,accepted:await ingest(env.DB,kind,body.items)},200,h);
   }
   return json({error:'not_found'},404,h);
 },
 async scheduled(ctrl,env,ctx){ctx.waitUntil(processPending(env))}
};
