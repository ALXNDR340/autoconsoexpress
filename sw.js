// Réseau d'abord : chaque lancement récupère la dernière version poussée sur GitHub.
// Le cache ne sert qu'hors connexion. Changer VERSION force aussi le rechargement de l'app.
const VERSION='1.3.0',CACHE='autoconso-'+VERSION;
const ASSETS=['./','index.html','style.css','app.js','manifest.json','icon-192.png','icon-512.png','icon-180.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(u=>new Request(u,{cache:'reload'})))).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==CACHE).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=='GET'||u.origin!==location.origin)return;
 e.respondWith((async()=>{
  const cache=await caches.open(CACHE);
  try{
   const res=await Promise.race([fetch(r,{cache:'no-store'}),new Promise((_,j)=>setTimeout(j,5000))]);
   if(res.ok)cache.put(r,res.clone());
   return res;
  }catch{
   return (await cache.match(r,{ignoreSearch:true}))||(r.mode==='navigate'?cache.match('index.html'):Response.error());
  }
 })());
});
