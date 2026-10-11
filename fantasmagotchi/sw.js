const C='fg-v8';
const CORE=['/','/index.html','/manifest.webmanifest','/icon-192.png','/apple-touch-icon.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(CORE)));self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/'))return;
  e.respondWith(fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(C).then(c=>c.put(e.request,cp))}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))));
});
self.addEventListener('push',e=>{
  let d={};try{d=e.data.json()}catch(_){d={title:'Fantasmagotchi',body:e.data&&e.data.text()}}
  e.waitUntil(self.registration.showNotification(d.title||'Fantasmagotchi',{body:d.body||'',icon:'/icon-192.png',badge:'/icon-192.png',tag:'fg-'+(d.tag||'x')+'-'+(d.at||''),renotify:false,data:{url:'/'}}));
});
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{for(const c of cs){if('focus' in c)return c.focus()}return self.clients.openWindow('/')}));
});
