// Change CACHE on every release so old copies are removed.
const CACHE="odds-matrix-v2.0.1";
const FILES=["./","./index.html","./styles.css","./app.js","./ocr.js","./model.json","./manifest.webmanifest","./icon.svg"];

self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(f=>new Request(f,{cache:"reload"})))));
});

self.addEventListener("activate",event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
    .then(()=>self.clients.claim())
));

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const sameOrigin=new URL(event.request.url).origin===self.location.origin;
  if(sameOrigin){
    // App files: network first, so updates on GitHub reach the phone;
    // the cached copy is used when offline.
    event.respondWith(
      fetch(event.request).then(resp=>{
        if(resp.ok){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));}
        return resp;
      }).catch(()=>caches.match(event.request).then(r=>r||caches.match("./index.html")))
    );
  }else{
    // OCR engine from the CDN: cache first (versioned files).
    event.respondWith(
      caches.match(event.request).then(r=>r||fetch(event.request).then(resp=>{
        const copy=resp.clone();caches.open(CACHE).then(c=>c.put(event.request,copy));return resp;
      }))
    );
  }
});
