const CACHE="uno50-v20260818-3.11";
const CORE=["/","/index.html","/style.css","/app.js?v=20260818-3.11","/manifest.json"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE).catch(()=>{})).then(()=>self.skipWaiting()));});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener("fetch",e=>{
 if(e.request.method!=="GET"||new URL(e.request.url).origin!==self.location.origin)return;
 const url=new URL(e.request.url);
 if(url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;
 e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
  if(res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}
  return res;
 }).catch(()=>caches.match("/index.html"))));
});
