// Cache de l'application pour l'ouvrir sans réseau (la reconnaissance, elle, a besoin d'internet).
const V='mymuseum-v15';
const SHELL=['./','index.html','style.css','app.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  // Réponse immédiate depuis le cache (démarrage rapide même avec un réseau faible au musée),
  // mise à jour en arrière-plan : la nouvelle version sert à l'ouverture suivante.
  e.respondWith(caches.open(V).then(async c=>{
    const hit=await c.match(e.request,{ignoreSearch:true});
    const net=fetch(e.request).then(r=>{if(r&&r.ok)c.put(e.request,r.clone());return r});
    if(hit){e.waitUntil(net.catch(()=>{}));return hit}
    return net.catch(()=>c.match('index.html'));
  }));
});
