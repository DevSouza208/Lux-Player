const CACHE='lux-controller-v0.1.9';
const ASSETS=['./','./index.html','./gamepad-layout.css','./manifest.json','./touchpad.js','./orientation.js','../icon.png'];
const RUNTIME_SCRIPTS=['./touchpad.js','./orientation.js'];

function injectRuntime(html){
  let output=html;
  for(const src of RUNTIME_SCRIPTS){
    if(output.includes(`src="${src}"`)||output.includes(`src='${src}'`)) continue;
    output=output.replace('</body>',`<script src="${src}"></script></body>`);
  }
  return output;
}

async function buildNavigationResponse(request){
  try{
    const response=await fetch(request);
    const html=injectRuntime(await response.text());
    const headers=new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    const modified=new Response(html,{status:response.status,statusText:response.statusText,headers});
    const cache=await caches.open(CACHE);
    await cache.put('./index.html',modified.clone());
    return modified;
  }catch(_){
    const cached=await caches.match('./index.html');
    if(!cached) throw _;
    const html=injectRuntime(await cached.text());
    const headers=new Headers(cached.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    return new Response(html,{status:cached.status,statusText:cached.statusText,headers});
  }
}

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))),
  self.clients.claim()
])));

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  if(event.request.mode==='navigate'){
    event.respondWith(buildNavigationResponse(event.request));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    return response;
  }).catch(()=>cached)));
});
