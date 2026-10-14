'use strict';
const VERSION='1.0.0',KEY='autoconso.v1',$=i=>document.getElementById(i);
const DEF={v:{model:'',odo:180000,tank:50,avg:6.5,price:1.85},fuel:null,trip:{km:0,l:0,eur:0},lim:{n:50,auto:true},log:[]};
let S=load();
function load(){try{const s=JSON.parse(localStorage.getItem(KEY))||{};return{...structuredClone(DEF),...s,v:{...DEF.v,...s.v},trip:{...DEF.trip,...s.trip},lim:{...DEF.lim,...s.lim}}}catch{return structuredClone(DEF)}}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch{}};
const fmt=(x,d=0)=>Number(x).toLocaleString('fr-FR',{minimumFractionDigits:d,maximumFractionDigits:d});
const num=s=>parseFloat(String(s).replace(/\s/g,'').replace(',','.'));
const fuel=()=>S.fuel==null?S.v.tank:Math.min(S.fuel,S.v.tank);
function toast(t){const e=$('toast');e.textContent=t;e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),3200)}

/* ---- Modèle de consommation : multiplicateur de la conso moyenne selon la vitesse ---- */
const CURVE=[[0,1.3],[10,1.5],[30,1.25],[50,1.05],[70,.88],[90,.9],[110,1.1],[130,1.4],[150,1.8],[190,2.6]];
function mult(v){for(let i=1;i<CURVE.length;i++){const a=CURVE[i-1],b=CURVE[i];if(v<=b[0])return a[1]+(b[1]-a[1])*(Math.max(v,a[0])-a[0])/(b[0]-a[0])}return CURVE[CURVE.length-1][1]}
const conso=v=>S.v.avg*mult(v);          // L/100 km
const idleLh=()=>S.v.avg*.12;            // L/h au ralenti
const modeOf=v=>v<3?'À l\'arrêt':v<60?'Ville':v<100?'Route':'Autoroute';
function burn(dl){dl=Math.min(dl,fuel());S.fuel=fuel()-dl;S.trip.l+=dl;S.trip.eur+=dl*S.v.price}

/* ---- GPS ---- */
let tracking=false,watchId=null,last=null,speed=0,inst=null,lastFixAt=0,lastTick=0,stopSince=null,wake=null,lastSave=0,pendingReload=false;
const rad=x=>x*Math.PI/180;
function hav(a,b){const R=6371000,la=a.lat??a.latitude,lo=a.lon??a.longitude,lb=b.lat??b.latitude,lc=b.lon??b.longitude;
 const h=Math.sin(rad(lb-la)/2)**2+Math.cos(rad(la))*Math.cos(rad(lb))*Math.sin(rad(lc-lo)/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function setGps(s,t){$('gps').className='gps '+s;$('gpsTxt').textContent=t}
function onFix(p){
 const c=p.coords,t=p.timestamp;
 if(c.accuracy>50){setGps('weak','Signal GPS faible');return}
 setGps('ok','GPS actif');lastFixAt=Date.now();
 let v=c.speed!=null&&!isNaN(c.speed)?c.speed*3.6:null,d=0,segV=null;
 if(last){const dt=(t-last.t)/1000;d=hav(last,c);
  if(dt>0){const dv=d/dt*3.6;if(v==null)v=dv;segV=dv;if(dt>300||dv>250){d=0;segV=null}}}
 v=v==null||v<2?0:v;speed=v;
 if(v>0){const ci=conso(v);inst=inst==null?ci:inst*.7+ci*.3}
 if(v>0&&d>1&&segV!=null){const km=d/1000;S.v.odo+=km;S.trip.km+=km;burn(km*conso(segV)/100)}
 last={lat:c.latitude,lon:c.longitude,t};
 lookup(c);render();
}
function onErr(e){if(e.code===1){setGps('err','Autorisation GPS refusée');stop()}else setGps('weak','Signal GPS perdu')}
async function start(){
 if(!navigator.geolocation){toast('GPS indisponible sur cet appareil');return}
 tracking=true;last=null;inst=null;lastTick=Date.now();setGps('weak','Recherche du signal…');
 watchId=navigator.geolocation.watchPosition(onFix,onErr,{enableHighAccuracy:true,maximumAge:0,timeout:20000});
 try{wake=await navigator.wakeLock?.request('screen')}catch{}
 $('go').textContent='Arrêter le GPS';render();
}
function stop(){
 tracking=false;if(watchId!=null)navigator.geolocation.clearWatch(watchId);watchId=null;
 try{wake?.release()}catch{}wake=null;speed=0;inst=null;stopSince=null;
 $('go').textContent='Démarrer le GPS';if(!$('gps').classList.contains('err'))setGps('','GPS à l\'arrêt');
 save();render();if(pendingReload)location.reload();
}
setInterval(()=>{
 if(!tracking)return;const now=Date.now(),dt=(now-lastTick)/1000;lastTick=now;
 if(lastFixAt&&now-lastFixAt>10000){speed=0;setGps('weak','Signal GPS perdu')}
 if(speed>0)stopSince=null;else{
  stopSince=stopSince||now; // ralenti pris en compte 2 min max (ensuite : moteur supposé coupé)
  if(now-stopSince<120000)burn(idleLh()*dt/3600)}
 if(now-lastSave>5000){save();lastSave=now}
 render();
},1000);

/* ---- Limitation de vitesse (OpenStreetMap, ou réglage manuel) ---- */
const LIMS=[20,30,50,70,80,90,110,130];
let lastQ={t:0};
function parseMax(s){s=String(s).trim();const m={'FR:urban':50,'FR:rural':80,'FR:motorway':130,urban:50,rural:80,motorway:130}[s];if(m)return m;
 const r=s.match(/^(\d+)(\s*mph)?$/);return r?(r[2]?Math.round(r[1]*1.609/5)*5:+r[1]):null}
async function lookup(c){
 if(!S.lim.auto||!navigator.onLine)return;const now=Date.now();
 if(now-lastQ.t<20000||(lastQ.lat!=null&&now-lastQ.t<120000&&hav(lastQ,c)<80))return;
 lastQ={t:now,lat:c.latitude,lon:c.longitude};
 try{const ac=new AbortController();setTimeout(()=>ac.abort(),9000);
  const q=`[out:json][timeout:8];way(around:12,${c.latitude},${c.longitude})[highway][maxspeed];out tags;`;
  const j=await(await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{signal:ac.signal})).json();
  const ms=j.elements.map(e=>parseMax(e.tags.maxspeed)).filter(Boolean);
  if(ms.length&&S.lim.auto){S.lim.n=Math.max(...ms);render()}
 }catch{}
}
function stepLim(dir){
 let i=LIMS.findIndex(x=>x>=S.lim.n);if(i<0)i=LIMS.length-1;
 if(LIMS[i]!==S.lim.n&&dir<0)i++; // plus proche valeur inférieure
 S.lim.n=LIMS[Math.max(0,Math.min(LIMS.length-1,i+dir))];S.lim.auto=false;save();render();
}

/* ---- Affichage ---- */
function render(){
 const v=Math.round(speed),T=S.v.tank,f=fuel(),pct=T>0?f/T*100:0,rng=S.v.avg>0?f/S.v.avg*100:0;
 $('speed').textContent=v;$('hud').classList.toggle('over',tracking&&v>S.lim.n);
 $('limit').textContent=S.lim.n;$('limAuto').setAttribute('aria-pressed',S.lim.auto);
 if(tracking&&speed===0){$('inst').textContent=fmt(idleLh(),1);$('instU').textContent='L/h'}
 else{$('inst').textContent=tracking&&inst!=null?fmt(inst,1):'—';$('instU').textContent='L/100 km'}
 $('mode').textContent=tracking?modeOf(speed):'À l\'arrêt';
 $('cost').textContent=fmt(S.trip.eur,2);$('dist').textContent=fmt(S.trip.km,1);
 $('rangeHud').textContent=fmt(rng,0);$('odo').textContent=fmt(S.v.odo,1);
 $('barHud').style.width=pct+'%';$('fuelHud').textContent=`${fmt(pct,0)} % · ${fmt(f,1)} L`;
 $('bar').style.width=pct+'%';$('pct').textContent=fmt(pct,0);$('lit').textContent=fmt(f,1);$('rng').textContent=fmt(rng,0);
 for(const e of[$('barHud'),$('bar')])e.parentElement.classList.toggle('low',pct<15);
}
function renderLog(){
 $('log').innerHTML=S.log.length?S.log.slice(0,6).map(l=>`<li><span>${new Date(l.t).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</span><div>${l.full?'Plein complet':''}${l.l?' '+fmt(l.l,1)+' L':''}${l.eur?' · '+fmt(l.eur,2)+' €':''}</div></li>`).join(''):'<li><span>Aucun plein enregistré</span></li>';
}
function fillCar(){const v=S.v;$('fModel').value=v.model;$('fOdo').value=String(+v.odo.toFixed(1)).replace('.',',');$('fTank').value=String(v.tank).replace('.',',');$('fAvg').value=String(v.avg).replace('.',',');$('fPrice').value=String(v.price).replace('.',',')}

/* ---- Actions ---- */
$('go').onclick=()=>tracking?stop():start();
$('resetTrip').onclick=()=>{S.trip={km:0,l:0,eur:0};inst=null;save();render();toast('Nouveau trajet démarré')};
$('limMinus').onclick=()=>stepLim(-1);$('limPlus').onclick=()=>stepLim(1);
$('limAuto').onclick=()=>{S.lim.auto=!S.lim.auto;lastQ={t:0};save();render()};
$('full').onclick=()=>{
 const added=S.v.tank-fuel();S.fuel=S.v.tank;S.log.unshift({t:Date.now(),full:true,l:+added.toFixed(1)});S.log=S.log.slice(0,30);
 save();render();renderLog();toast('Réservoir plein');
};
$('partial').onsubmit=e=>{
 e.preventDefault();const l=num($('pL').value),eur=num($('pE').value);
 if(!(l>0)||!(eur>=0)||isNaN(eur)){toast('Indiquez les litres et le prix payé');return}
 const room=S.v.tank-fuel(),add=Math.min(l,room);
 S.fuel=fuel()+add;
 S.log.unshift({t:Date.now(),l,eur});S.log=S.log.slice(0,30);
 $('pL').value=$('pE').value='';save();render();renderLog();fillCar();
 toast(l>room?`Capacité dépassée : réservoir limité à ${fmt(S.v.tank,0)} L`:'Carburant ajouté');
};
$('carForm').onsubmit=e=>{
 e.preventDefault();const o=num($('fOdo').value),t=num($('fTank').value),a=num($('fAvg').value),p=num($('fPrice').value);
 if(!(o>=0)||!(t>0)||!(a>0)||!(p>=0)){toast('Vérifiez les valeurs saisies');return}
 const f=fuel();S.v={model:$('fModel').value.trim(),odo:o,tank:t,avg:a,price:p};S.fuel=Math.min(f,t);
 save();render();toast('Fiche véhicule enregistrée');
};
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
 document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));
 document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.id==='tab-'+b.dataset.tab));
});
document.addEventListener('visibilitychange',async()=>{
 if(document.hidden){save();return}
 if(tracking&&!wake){try{wake=await navigator.wakeLock?.request('screen')}catch{}}
 navigator.serviceWorker?.getRegistration().then(r=>r?.update());
});
addEventListener('pagehide',save);

/* ---- Démarrage & mise à jour automatique ---- */
$('ver').textContent=VERSION;fillCar();renderLog();render();
if('serviceWorker'in navigator){
 const had=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
 navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if(!had)return;               // première installation : rien à recharger
  if(tracking){pendingReload=true;toast('Mise à jour prête : appliquée à l\'arrêt du GPS')}else location.reload();
 });
}
/* ---- Calculateur de trajet rapide ---- */
$('simBtn').onclick = () => {
 const km = num($('simDist').value);
 if (!(km > 0)) {
  $('simResult').textContent = 'Veuillez entrer une distance valide.';
  return;
 };
 // Calcul : (Distance / 100) * Consommation moyenne * Prix du carburant
 const liters = (km / 100) * S.v.avg;
 const cost = liters * S.v.price;
 $('simResult').textContent = `Coût estimé : ${fmt(cost, 2)} € (${fmt(liters, 1)} L)`;
};
