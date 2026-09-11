(() => {
  'use strict';

  if (window.__luxControllerHubInstalled) return;
  window.__luxControllerHubInstalled = true;

  const SUPABASE_URL='https://fvcvshppvxihhttwyyvr.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY='sb_publishable_G22WZFcnYGNNkbUbygE5jA_FBBSXNrm';
  const RTC_CONFIG={iceServers:[{urls:'stun:stun.l.google.com:19302'}]};
  const REMOTE_DEVICE_KEY='lux-remote-device-id';
  const REMOTE_PENDING_KEY='lux-remote-pending-room';
  const GAME_PENDING_KEY='lux-controller-pending-room';

  const gamepadJoin=document.getElementById('joinScreen');
  const gamepadScreen=document.getElementById('controllerScreen');
  const legacyInstallGuide=document.getElementById('installGuide');
  let remoteClient=null;
  let deferredInstallPrompt=null;

  window.addEventListener('beforeinstallprompt',event=>{
    event.preventDefault();
    deferredInstallPrompt=event;
    const button=document.getElementById('luxInstallNow');
    if(button){button.hidden=false;button.disabled=false;}
  });

  function loadStyles(){
    if(document.querySelector('link[data-lux-hub],link[href*="hub.css"]'))return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='./hub.css?v=20260910-3';
    link.dataset.luxHub='1';
    document.head.appendChild(link);
  }

  function isStandalone(){return window.matchMedia?.('(display-mode: standalone)').matches||window.navigator.standalone===true}
  function isIos(){return /iphone|ipad|ipod/i.test(navigator.userAgent)||(/macintosh/i.test(navigator.userAgent)&&navigator.maxTouchPoints>1)}
  function sanitizeCode(value){return String(value||'').replace(/\D/g,'').slice(0,6)}
  function haptic(ms=9){if(navigator.vibrate)navigator.vibrate(ms)}
  function deviceId(){let id=localStorage.getItem(REMOTE_DEVICE_KEY);if(!id){id=crypto.randomUUID?.()||`lux-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;localStorage.setItem(REMOTE_DEVICE_KEY,id)}return id}
  function deviceName(){if(/iphone/i.test(navigator.userAgent))return'iPhone';if(/ipad/i.test(navigator.userAgent))return'iPad';if(/android/i.test(navigator.userAgent))return'Android';return navigator.userAgentData?.platform||navigator.platform||'Celular'}
  function setMode(mode){document.body.dataset.luxMode=mode;window.dispatchEvent(new CustomEvent('luxmodechange',{detail:{mode}}))}
  function cleanUrl(){try{history.replaceState({},'',location.pathname)}catch(_){}}

  function rememberIncomingCode(){
    const params=new URL(location.href).searchParams;
    const gameCode=sanitizeCode(params.get('code'));
    const remoteCode=sanitizeCode(params.get('remote'));
    if(gameCode)localStorage.setItem(GAME_PENDING_KEY,gameCode);
    if(remoteCode)localStorage.setItem(REMOTE_PENDING_KEY,remoteCode);
    return{gameCode,remoteCode};
  }

  function ensureUi(){
    if(document.getElementById('luxHubScreen'))return;
    document.body.insertAdjacentHTML('beforeend',`
      <section id="luxInstallLock" hidden>
        <div class="lux-install-wrap">
          <div class="lux-install-card">
            <div class="lux-install-mark">LUX</div>
            <div class="lux-hub-brand">LUX CONTROLLER</div>
            <h1>Instale para usar</h1>
            <p>Por segurança e para ocupar a tela inteira, o Lux Controller funciona somente como aplicativo instalado. O controle fica bloqueado dentro do navegador.</p>
            <div class="lux-install-os">
              <button type="button" data-install-os="android">Android</button>
              <button type="button" data-install-os="ios">iPhone / iPad</button>
            </div>
            <div id="luxInstallAndroid" class="lux-install-steps">
              <strong>Android · Chrome</strong>
              <ol><li>Abra o menu <b>⋮</b>.</li><li>Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.</li><li>Feche esta aba e abra <b>Lux Controller</b> pelo ícone instalado.</li></ol>
            </div>
            <div id="luxInstallIos" class="lux-install-steps" hidden>
              <strong>iPhone / iPad · Safari</strong>
              <ol><li>Abra este endereço no <b>Safari</b>.</li><li>Toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>.</li><li>Abra <b>Lux Controller</b> pelo novo ícone.</li></ol>
            </div>
            <button id="luxInstallNow" class="lux-install-primary" type="button" hidden>Instalar Lux Controller</button>
            <div class="lux-install-note">O código do QR já fica salvo. Ao abrir o PWA instalado, você continua exatamente do pareamento.</div>
          </div>
        </div>
      </section>

      <section id="luxHubScreen" hidden>
        <div class="lux-hub-wrap">
          <div class="lux-hub-brand">LUX CONTROLLER</div>
          <h1 class="lux-hub-title">Escolha o controle</h1>
          <p class="lux-hub-sub">Um aplicativo, dois jeitos de controlar o Lux Play.</p>
          <div class="lux-mode-grid">
            <button id="luxOpenPad" class="lux-mode-card" type="button"><span class="lux-mode-icon">🎮</span><span><strong>Lux Pad</strong><span>Gamepad para jogos retrô. O celular muda para horizontal ao jogar.</span></span></button>
            <button id="luxOpenRemote" class="lux-mode-card" type="button"><span class="lux-mode-icon">⌁</span><span><strong>Lux Control</strong><span>Controle remoto para navegar, assistir e usar o Lux Play à distância.</span></span></button>
          </div>
          <div class="lux-hub-foot">Lux Play Companion · v1.5</div>
        </div>
      </section>

      <section id="luxRemoteJoinScreen" hidden>
        <div class="lux-remote-join-wrap"><div class="lux-remote-join-card">
          <button id="luxRemoteJoinBack" class="lux-remote-back" type="button">← Voltar</button>
          <div class="lux-hub-brand">LUX CONTROL</div><h2>Conectar ao Lux Play</h2><p class="lux-hub-sub">Digite o código mostrado no botão Lux Control da tela inicial.</p>
          <label class="lux-remote-label" for="luxRemoteCode">Código da sessão</label><input id="luxRemoteCode" class="lux-remote-code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="000000">
          <button id="luxRemoteConnect" class="lux-remote-primary" type="button">Conectar</button><div id="luxRemoteStatus" class="lux-remote-status offline">● Desconectado</div>
        </div></div>
      </section>

      <section id="luxRemoteScreen" hidden>
        <div class="lux-remote-shell">
          <header class="lux-remote-head">
            <div><span class="lux-remote-kicker">LUX CONTROL</span><strong>Controle remoto</strong><span id="luxRemoteSessionLabel">Sem sessão</span></div>
            <button id="luxRemoteExit" class="lux-icon-btn" type="button" aria-label="Fechar controle remoto">✕</button>
          </header>

          <div class="lux-quick-row">
            <button class="lux-quick-btn" data-remote="BACK"><b>↩</b><span>Voltar</span></button>
            <button class="lux-quick-btn" data-remote="OPEN_HOME"><b>⌂</b><span>Início</span></button>
            <button class="lux-quick-btn lux-favorite-btn" data-remote="FAVORITE_TOGGLE"><b>♡</b><span>Favoritar</span></button>
            <button id="luxRemoteToPad" class="lux-quick-btn"><b>🎮</b><span>Lux Pad</span></button>
          </div>

          <div class="lux-control-stage">
            <div class="lux-rocker">
              <button data-remote="VOLUME_UP">＋</button><span>VOL</span><button data-remote="VOLUME_DOWN">−</button><button class="lux-rocker-mini" data-remote="MUTE">⌁</button>
            </div>

            <div class="lux-control-center">
              <div class="lux-dpad">
                <button class="up" data-remote="NAV_UP">▲</button>
                <button class="left" data-remote="NAV_LEFT">◀</button>
                <button class="ok" data-remote="SELECT">OK</button>
                <button class="right" data-remote="NAV_RIGHT">▶</button>
                <button class="down" data-remote="NAV_DOWN">▼</button>
              </div>
              <div class="lux-media-grid">
                <button data-remote="PREV"><b>⏮</b><span>Anterior</span></button>
                <button data-remote="SEEK_BACK_10"><b>↶10</b><span>10s</span></button>
                <button class="lux-play-main" data-remote="PLAY_PAUSE"><b>⏯</b><span>Play</span></button>
                <button data-remote="SEEK_FORWARD_10"><b>10↷</b><span>10s</span></button>
                <button data-remote="NEXT"><b>⏭</b><span>Próximo</span></button>
              </div>
            </div>

            <div class="lux-rocker">
              <button data-remote="CHANNEL_NEXT">＋</button><span>CH</span><button data-remote="CHANNEL_PREV">−</button><button class="lux-rocker-mini" data-remote="OPEN_LIVE">TV</button>
            </div>
          </div>

          <nav class="lux-remote-nav" aria-label="Atalhos do Lux Play">
            <button data-remote="OPEN_HOME"><b>⌂</b><span>Início</span></button>
            <button data-remote="OPEN_LIVE"><b>▣</b><span>Ao vivo</span></button>
            <button data-remote="OPEN_MOVIES"><b>▶</b><span>Filmes</span></button>
            <button data-remote="OPEN_SERIES"><b>▤</b><span>Séries</span></button>
            <button data-remote="OPEN_GAMES"><b>🎮</b><span>Jogos</span></button>
            <button data-remote="OPEN_READING"><b>▥</b><span>Livros</span></button>
          </nav>
          <div id="luxRemoteFeedback" class="lux-remote-feedback" aria-live="polite"></div>
        </div>
      </section>`);
  }

  function showOnly(which){
    const ids={install:'luxInstallLock',hub:'luxHubScreen',remoteJoin:'luxRemoteJoinScreen',remote:'luxRemoteScreen'};
    Object.entries(ids).forEach(([name,id])=>{const el=document.getElementById(id);if(el)el.hidden=name!==which});
    if(gamepadJoin)gamepadJoin.classList.toggle('active',which==='gamepadJoin');
    if(gamepadScreen&&which!=='gamepad')gamepadScreen.classList.remove('active');
  }

  function setInstallTab(tab){
    document.querySelectorAll('[data-install-os]').forEach(btn=>btn.classList.toggle('active',btn.dataset.installOs===tab));
    const android=document.getElementById('luxInstallAndroid'),ios=document.getElementById('luxInstallIos');
    if(android)android.hidden=tab!=='android';if(ios)ios.hidden=tab!=='ios';
  }

  function showInstallLock(){
    showOnly('install');setMode('install');setInstallTab(isIos()?'ios':'android');
    const button=document.getElementById('luxInstallNow');if(button&&deferredInstallPrompt)button.hidden=false;
  }

  async function installPwa(){
    if(!deferredInstallPrompt)return;
    const prompt=deferredInstallPrompt;deferredInstallPrompt=null;
    try{await prompt.prompt();await prompt.userChoice}catch(_){ }
    const button=document.getElementById('luxInstallNow');if(button){button.disabled=true;button.textContent='Abra pelo ícone instalado';}
  }

  async function showHub(){await disconnectRemote(false);showOnly('hub');setMode('hub');cleanUrl()}
  async function showGamepadJoin(){await disconnectRemote(false);showOnly('gamepadJoin');setMode('gamepad');document.getElementById('roomCode')?.focus()}
  function showRemoteJoin(code=''){showOnly('remoteJoin');setMode('remote');const input=document.getElementById('luxRemoteCode');if(input&&code)input.value=sanitizeCode(code);input?.focus()}
  function showRemote(){showOnly('remote');setMode('remote');const label=document.getElementById('luxRemoteSessionLabel');if(label&&remoteClient)label.textContent=`Sala ${remoteClient.room.slice(0,3)} ${remoteClient.room.slice(3)} · conectado`}
  function feedback(text){const el=document.getElementById('luxRemoteFeedback');if(!el)return;el.textContent=text;el.classList.add('show');clearTimeout(feedback.timer);feedback.timer=setTimeout(()=>el.classList.remove('show'),1500)}
  function setRemoteStatus(text,online=false){const el=document.getElementById('luxRemoteStatus');if(!el)return;el.textContent=text;el.className=`lux-remote-status ${online?'online':'offline'}`}
  function getSignalClient(){if(remoteClient?.signalClient)return remoteClient.signalClient;if(!window.supabase?.createClient)throw new Error('Conexão indisponível.');const client=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});if(remoteClient)remoteClient.signalClient=client;return client}
  function payloadOf(message){return message?.payload||message||{}}
  async function sendSignal(payload){if(!remoteClient?.signalChannel)return;await remoteClient.signalChannel.send({type:'broadcast',event:'signal',payload:{...payload,session:remoteClient.room,controllerId:remoteClient.controllerId}})}
  async function closeSignal(){if(remoteClient?.signalChannel&&remoteClient.signalClient){try{await remoteClient.signalClient.removeChannel(remoteClient.signalChannel)}catch(_){}}if(remoteClient)remoteClient.signalChannel=null}
  function closePeer(){try{remoteClient?.dataChannel?.close()}catch(_){}try{remoteClient?.pc?.close()}catch(_){}if(remoteClient){remoteClient.dataChannel=null;remoteClient.pc=null;remoteClient.pendingIce=[]}}
  async function disconnectRemote(sendLeave=true){if(!remoteClient)return;clearTimeout(remoteClient.timer);if(sendLeave&&remoteClient.signalChannel){try{await sendSignal({type:'leave'})}catch(_){}}closePeer();await closeSignal();remoteClient=null}
  async function addIce(candidate){if(!candidate||!remoteClient?.pc)return;if(!remoteClient.pc.remoteDescription){remoteClient.pendingIce.push(candidate);return}try{await remoteClient.pc.addIceCandidate(candidate)}catch(_){}}
  async function flushIce(){const list=remoteClient?.pendingIce.splice(0)||[];for(const candidate of list)await addIce(candidate)}
  function bindDataChannel(channel){
    remoteClient.dataChannel=channel;
    channel.onopen=()=>{clearTimeout(remoteClient.timer);localStorage.removeItem(REMOTE_PENDING_KEY);setRemoteStatus('● Conectado ao Lux Play',true);setTimeout(showRemote,120)};
    channel.onmessage=event=>{try{const msg=JSON.parse(event.data);if(msg?.type==='remote-feedback')feedback(msg.message||'Comando executado')}catch(_){}};
    channel.onclose=()=>{if(remoteClient){const room=remoteClient.room;setRemoteStatus('● Conexão encerrada');disconnectRemote(false).then(()=>showRemoteJoin(room))}};
  }
  async function ensurePeer(){if(remoteClient.pc)return remoteClient.pc;const pc=new RTCPeerConnection(RTC_CONFIG);remoteClient.pc=pc;pc.onicecandidate=e=>{if(e.candidate)sendSignal({type:'ice',candidate:e.candidate.toJSON?.()||e.candidate})};pc.ondatachannel=e=>bindDataChannel(e.channel);return pc}
  async function handleSignal(raw){const msg=payloadOf(raw);if(!remoteClient||msg.session!==remoteClient.room||(msg.target&&msg.target!==remoteClient.controllerId))return;try{if(msg.type==='offer'){const pc=await ensurePeer();await pc.setRemoteDescription(msg.description);await flushIce();const answer=await pc.createAnswer();await pc.setLocalDescription(answer);await sendSignal({type:'answer',description:pc.localDescription});return}if(msg.type==='ice'){await addIce(msg.candidate);return}if(msg.type==='reject'){setRemoteStatus(`● ${msg.reason||'Controle remoto já conectado.'}`);await disconnectRemote(false);return}if(msg.type==='host-disconnect'){const room=remoteClient.room;setRemoteStatus('● Sessão encerrada pelo Lux Play');await disconnectRemote(false);showRemoteJoin(room)}}catch(error){console.warn('Lux Control pareamento:',error);setRemoteStatus('● Não foi possível concluir a conexão.')}}
  function openSignal(code){return new Promise((resolve,reject)=>{const client=getSignalClient();const channel=client.channel(`lux-remote:${code}`,{config:{broadcast:{self:false}}});remoteClient.signalChannel=channel;channel.on('broadcast',{event:'signal'},handleSignal);const timer=setTimeout(()=>reject(new Error('Sessão não encontrada.')),7000);channel.subscribe(status=>{if(status==='SUBSCRIBED'){clearTimeout(timer);resolve()}else if(status==='CHANNEL_ERROR'||status==='TIMED_OUT'){clearTimeout(timer);reject(new Error('Não foi possível entrar na sala.'))}})})}
  async function connectRemote(){
    const input=document.getElementById('luxRemoteCode'),button=document.getElementById('luxRemoteConnect');const code=sanitizeCode(input?.value);if(code.length!==6){input?.focus();return}
    await disconnectRemote(false);remoteClient={room:code,controllerId:deviceId(),signalClient:null,signalChannel:null,pc:null,dataChannel:null,pendingIce:[],timer:null};localStorage.setItem(REMOTE_PENDING_KEY,code);button.disabled=true;button.textContent='Conectando...';setRemoteStatus('● Procurando o Lux Play...');
    try{await openSignal(code);setRemoteStatus('● Pareando controle remoto...');await sendSignal({type:'join',deviceName:deviceName()});remoteClient.timer=setTimeout(async()=>{button.disabled=false;button.textContent='Conectar';setRemoteStatus('● Sessão não encontrada ou conexão bloqueada.');await disconnectRemote(false)},12000)}catch(error){button.disabled=false;button.textContent='Conectar';setRemoteStatus(`● ${error.message||'Falha ao conectar.'}`);await disconnectRemote(false)}
  }
  function sendRemote(action,value=null){if(remoteClient?.dataChannel?.readyState!=='open')return;haptic();try{remoteClient.dataChannel.send(JSON.stringify({type:'remote',action,value,timestamp:performance.now()}))}catch(_){}}

  function injectPadExit(){
    const toolbar=gamepadScreen?.querySelector('.toolbar');if(!toolbar||document.getElementById('luxPadExitBtn'))return;
    const button=document.createElement('button');button.id='luxPadExitBtn';button.type='button';button.textContent='✕ Fechar';button.addEventListener('click',async()=>{try{await window.LuxController?.disconnect?.()}catch(_){}showHub()});toolbar.appendChild(button);
  }

  function bindUi(){
    document.querySelectorAll('[data-install-os]').forEach(button=>button.addEventListener('click',()=>setInstallTab(button.dataset.installOs)));
    document.getElementById('luxInstallNow')?.addEventListener('click',installPwa);
    document.getElementById('luxOpenPad')?.addEventListener('click',showGamepadJoin);
    document.getElementById('luxOpenRemote')?.addEventListener('click',()=>showRemoteJoin());
    document.getElementById('luxRemoteJoinBack')?.addEventListener('click',showHub);
    document.getElementById('luxRemoteConnect')?.addEventListener('click',connectRemote);
    document.getElementById('luxRemoteExit')?.addEventListener('click',showHub);
    document.getElementById('luxRemoteToPad')?.addEventListener('click',showGamepadJoin);
    document.getElementById('luxRemoteCode')?.addEventListener('input',e=>e.target.value=sanitizeCode(e.target.value));
    document.getElementById('luxRemoteCode')?.addEventListener('keydown',e=>{if(e.key==='Enter')connectRemote()});
    document.querySelectorAll('[data-remote]').forEach(button=>{button.addEventListener('pointerdown',e=>{e.preventDefault();sendRemote(button.dataset.remote)});button.addEventListener('contextmenu',e=>e.preventDefault())});
    injectPadExit();
  }

  function initialRoute(incoming){
    const gameCode=incoming?.gameCode||sanitizeCode(localStorage.getItem(GAME_PENDING_KEY));
    const remoteCode=incoming?.remoteCode||sanitizeCode(localStorage.getItem(REMOTE_PENDING_KEY));
    if(incoming?.remoteCode||(!incoming?.gameCode&&remoteCode)){showRemoteJoin(remoteCode);return}
    if(gameCode){const input=document.getElementById('roomCode');if(input)input.value=gameCode;showGamepadJoin();return}
    showHub();
  }

  function init(){
    loadStyles();
    legacyInstallGuide?.remove();
    ensureUi();
    bindUi();
    const incoming=rememberIncomingCode();
    if(!isStandalone()){showInstallLock();return}
    initialRoute(incoming);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
  window.LuxControllerHub={showHub,showGamepad:showGamepadJoin,showRemote:showRemoteJoin,disconnectRemote};
})();
