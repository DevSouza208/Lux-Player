const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'release/game-admin-validation');fs.mkdirSync(out,{recursive:true});
app.setPath('userData',path.join(out,'profile'));app.disableHardwareAcceleration();
const log=message=>fs.appendFileSync(path.join(out,'result.txt'),message+'\n');fs.writeFileSync(path.join(out,'result.txt'),'');
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1200,height:900,webPreferences:{nodeIntegration:false,contextIsolation:true,offscreen:true}});
 const timer=setTimeout(()=>{log('FAIL: timeout');app.exit(1);},30000);
 try{
  const source=fs.readFileSync(path.join(root,'js/script.js'),'utf8');
  const functions=source.slice(source.indexOf('    let gamesCatalog ='),source.indexOf('    function openGameEmulatorById'));
  let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  html=html.replace('</head>','<style>.hidden{display:none!important}#gameUploadModal{position:fixed;inset:0;background:#160d24;color:white;padding:30px;overflow:auto}#gameUploadModal input,#gameUploadModal textarea{display:block}#adminModal{position:fixed;inset:0;z-index:50;background:#222}</style></head>');
  const file=path.join(out,'harness.html');fs.writeFileSync(file,html);await win.loadFile(file);
  await win.webContents.executeJavaScript(`
   var currentUser={user:'test-admin',role:'admin'},lucide={createIcons(){}},updates=[],alerts=[];
   window.alert=message=>alerts.push(message);
   var supabaseClient={from:()=>({select:()=>({neq:async(_key,id)=>({data:gamesCatalog.filter(game=>game.id!==id),error:null})}),update:patch=>({eq:async(_key,id)=>{updates.push({id,patch});Object.assign(gamesCatalog.find(game=>game.id===id),patch);return {error:null};}})})};
   ${functions}
   loadGamesCatalog=async()=>gamesCatalog;var renderGamesCatalog=()=>{};
   gamesCatalog=[{id:'game-1',title:'Altered Beast',console:'gba',status:'pending',source_file_name:'Altered Beast.gba'},{id:'game-2',title:'Second game',console:'snes',status:'pending',source_file_name:'Second.sfc'}];
  `);
  const template=source.match(/<button onclick="adminEditGame\('[\s\S]*?<\/button>/)[0].replace('${escapeGameHtml(game.id)}','game-1');
  await win.webContents.executeJavaScript(`(async()=>{
   const check=(ok,message)=>{if(!ok)throw Error(message)},modal=document.getElementById('gameUploadModal');
   const wait=async predicate=>{for(let n=0;n<100;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10))}throw Error('Operation did not finish')};
   const card=document.createElement('div');card.innerHTML=${JSON.stringify(template)};let openedGame=false;card.onclick=()=>openedGame=true;document.body.append(card);
   card.querySelector('button').click();
   check(!openedGame,'Edit click propagated to game playback');
   check(modal.getClientRects().length>0&&!modal.closest('#adminModal'),'Editor is hidden under admin panel');
   check(document.getElementById('gameAdminTitle').value==='Altered Beast','Editor did not receive selected game');
   document.getElementById('gameAdminPlayers').value='1';document.getElementById('gameAdminCoop').value='yes';
   await adminImportGame('pending');check(updates.length===0,'Co-op accepted for one player');
   document.getElementById('gameAdminPlayers').value='4';
   document.getElementById('gameAdminTitle').value='Altered Beast revisado';
   document.getElementById('gameAdminDraft').click();await wait(()=>updates.length===1&&!document.getElementById('gameAdminDraft').disabled);
   check(updates[0].id==='game-1'&&updates[0].patch.title==='Altered Beast revisado'&&updates[0].patch.status==='pending','Edit did not save to correct game');
   check(updates[0].patch.players===4&&updates[0].patch.coop===true,'Player count/co-op not persisted');
   check(!modal.classList.contains('hidden'),'Saving draft unexpectedly closed editor');
   cancelGameAdminForm();
   document.getElementById('adminModal').classList.remove('hidden');
   document.querySelector('#adminTabGames [onclick="reviewUnapprovedGames()"]').click();await wait(()=>!modal.classList.contains('hidden'));
   check(Number(getComputedStyle(modal).zIndex)>Number(getComputedStyle(document.getElementById('adminModal')).zIndex),'Editor is behind admin modal');
   check(document.getElementById('gameAdminSourceFile').textContent.includes('Altered Beast.gba'),'Review source ROM missing');
   check(document.getElementById('gameAdminPlayers').value==='4'&&document.getElementById('gameAdminCoop').value==='yes','Editing lost multiplayer metadata');
   document.getElementById('gameAdminSubmit').click();await wait(()=>updates.length===2&&!document.getElementById('gameAdminSubmit').disabled);
   check(document.getElementById('gameAdminTitle').value==='Second game','Review did not advance');
   check(document.getElementById('gameAdminPlayers').value==='1'&&document.getElementById('gameAdminCoop').value==='','New selection inherited co-op');
   document.getElementById('gameAdminSubmit').click();await wait(()=>updates.length===3&&!document.getElementById('gameAdminSubmit').disabled);
   check(modal.classList.contains('hidden')&&alerts.includes('Revisão concluída.'),'Finished review leaves stale editor');
   card.querySelector('button').click();
   document.getElementById('gameAdminSubmit').click();await wait(()=>updates.length===4&&!document.getElementById('gameAdminSubmit').disabled);
   check(modal.classList.contains('hidden'),'Publishing outside review did not close editor');
   document.querySelector('#adminTabGames [onclick="toggleGameUploadModal()"]').click();
   check(!modal.classList.contains('hidden')&&!document.getElementById('gameAdminTitle').value,'New import retained old edit');
   cancelGameAdminForm();currentUser={role:'user'};card.querySelector('button').click();check(modal.classList.contains('hidden'),'Non-admin opened editor');
  })()`);
  log('PASS: actual HTML edit click, save correct game, admin overlay, review/approval queue, new upload reset and admin guard. No remote writes.');
  clearTimeout(timer);app.exit(0);
 }catch(error){log('FAIL: '+error.stack);clearTimeout(timer);app.exit(1);}
});
