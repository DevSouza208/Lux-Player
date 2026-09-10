(function(root){
 'use strict';
 const store=root.LuxReaderStore,timers=new Map(),inFlight=new Map(),statuses=new Map();
 const user=()=>typeof currentUser==='undefined'?null:currentUser;
 const currentOwner=()=>{try{return store.owner(user());}catch{return '';}};
 function notify(owner,id,state,message){
  statuses.set(store.key(owner,id),{state,message});
  if(typeof root.dispatchEvent==='function')root.dispatchEvent(new CustomEvent('lux-reading-sync',{detail:{owner,id,state,message}}));
 }
 async function request(name,payload,account=user()){
  if(!account)throw new Error('Entre em um perfil.');
  const owner=store.owner(account);
  if(typeof supabaseClient==='undefined')throw new Error('Sincronização indisponível.');
  let timer,response;
  try{response=await Promise.race([
   supabaseClient.functions.invoke(name,{body:{...payload,username:account.user,password:account.pass,profileSlot:account.profile?.slot||1,profileKey:account.profile?.data_key||''}}),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('A nuvem demorou para responder. Alterações guardadas neste dispositivo.')),10000);})
  ]);}finally{clearTimeout(timer);}
  if(owner!==currentOwner())throw new Error('O perfil mudou.');
  if(response.error||response.data?.error){
   let message=response.data?.error||'Sem conexão com a nuvem. Alterações guardadas neste dispositivo.';
   try{message=(await response.error.context.json()).error||message;}catch{}
   throw new Error(message);
  }
  return response.data;
 }
 function applyPayload(state,key,payload){
  if(key==='notebook')state.notes=payload.text||'';
  else if(key==='progress'||key==='preferences')Object.assign(state,payload);
  else if(key.startsWith('mark:'))(state.annotations||={})[key.slice(5)]=payload;
  else if(key.startsWith('recovery:'))(state.recoveries||={})[key.slice(9)]=payload;
 }
 function merge(owner,id,remote,sent=null){
  const state=store.readState(owner,id),records=state._records||={};
  const local=records[remote.key];
  if(sent&&local&&JSON.stringify(local.payload)!==JSON.stringify(sent.payload)){
   // An edit made during the request is still pending, based on the acknowledged revision.
   local.revision=Number(remote.revision);store.replaceState(owner,id,state);return;
  }
  if(local?.dirty&&JSON.stringify(local.payload)!==JSON.stringify(remote.payload)){
   if(remote.key==='notebook'||remote.key.startsWith('mark:')){
    const recoveryKey=crypto.randomUUID();
    const payload={text:local.payload.text||'(Comentário removido neste dispositivo)',label:'Edição recuperada · '+new Date().toLocaleString('pt-BR')};
    records['recovery:'+recoveryKey]={payload,revision:0,dirty:true};applyPayload(state,'recovery:'+recoveryKey,payload);
    state.syncNotice='Uma edição simultânea foi preservada em Versões recuperadas.';
   }else{
    // Preferences and position represent the most recent local intent; retry against the latest revision.
    local.revision=Number(remote.revision);store.replaceState(owner,id,state);return;
   }
  }
  records[remote.key]={payload:remote.payload,revision:Number(remote.revision),dirty:false};
  applyPayload(state,remote.key,remote.payload);store.replaceState(owner,id,state);
 }
 function seed(owner,id){
  const state=store.readState(owner,id);
  if(state._records)return;
  const patch={};for(const key of ['notes','page','total','progress','cfi','theme','zoom','fontSize','effect','annotations'])if(state[key]!==undefined)patch[key]=state[key];
  store.writeState(owner,id,patch);
 }
 async function sync(owner,id){
  if(owner!==currentOwner()||!/^[a-f0-9]{64}$/.test(id))return false;
  const mapKey=store.key(owner,id);if(inFlight.has(mapKey))return inFlight.get(mapKey);
  const task=(async()=>{
   try{
    seed(owner,id);notify(owner,id,'syncing','Sincronizando…');
    // Submit changes before pulling. The database compares revisions atomically.
    for(let round=0;round<4;round++){
     const records=store.readState(owner,id)._records||{};
     const pending=Object.entries(records).filter(([,r])=>r.dirty).map(([key,r])=>({key,payload:r.payload,revision:r.revision||0}));
     if(!pending.length)break;
     let batch=[],bytes=0;
     for(const record of pending){const size=JSON.stringify(record).length;if(batch.length>=20||bytes+size>800000)break;batch.push(record);bytes+=size;}
     const response=await request('reading-sync',{action:'push',bookId:id,records:batch});
     if(owner!==currentOwner())return false;
     for(const result of response.results||[]){
      if(!result.record?.key)throw new Error('A nuvem não confirmou uma alteração.');
      merge(owner,id,result.record,result.saved?batch.find(r=>r.key===result.record.key):null);
     }
    }
    let offset=0;
    while(true){
     const response=await request('reading-sync',{action:'pull',bookId:id,offset});
     if(owner!==currentOwner())return false;
     for(const record of response.records||[]){
      const local=store.readState(owner,id)._records?.[record.key];
      if(!local||record.revision>local.revision)merge(owner,id,record);
     }
     if((response.records||[]).length<100)break;offset+=100;
    }
    const pending=Object.values(store.readState(owner,id)._records||{}).some(r=>r.dirty);
    notify(owner,id,pending?'pending':'synced',pending?'Alterações na fila de sincronização':'Salvo na nuvem');
    if(pending)schedule(owner,id);
    return true;
   }catch(error){if(owner===currentOwner())notify(owner,id,'offline',error.message);return false;}
  })().finally(()=>inFlight.delete(mapKey));
  inFlight.set(mapKey,task);return task;
 }
 function schedule(owner,id){
  if(!/^[a-f0-9]{64}$/.test(id))return;
  const key=store.key(owner,id);clearTimeout(timers.get(key));
  statuses.set(key,{state:'pending',message:'Salvo no dispositivo · sincronização pendente'});
  timers.set(key,setTimeout(()=>{timers.delete(key);sync(owner,id);},1500));
 }
 async function flush(){const owner=currentOwner();if(!owner)return;for(const id of store.stateBooks(owner)){if(owner!==currentOwner())return;await sync(owner,id);}}
 async function catalog(admin=false){
  const result=[];let offset=0;
  while(true){const data=await request('reading-catalog',{action:'list',offset});result.push(...(data.books||[]));if((data.books||[]).length<100)break;offset+=100;}
  return admin?result:result.filter(book=>book.status==='approved'&&book.upload_complete);
 }
 root.addEventListener?.('online',flush);
 root.addEventListener?.('focus',()=>{if(!root.document?.getElementById('readerDialog')?.open)flush();});
 root.LuxReaderCloud={request,sync,schedule,flush,catalog,merge,status:(owner,id)=>statuses.get(store.key(owner,id))};
})(typeof window==='undefined'?globalThis:window);
