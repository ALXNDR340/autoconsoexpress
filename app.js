'use strict';
const VERSION='1.5.1',KEY='autoconso.v1',$=i=>document.getElementById(i)||document.createElement('div');
const DEF={v:{model:'',odo:180000,tank:50,avg:6.5,price:1.85,type:'SP95-E10',year:'',hp:'',gear:'Manuelle'},fuel:null,trip:{km:0,l:0,eur:0},lim:{n:50,auto:true},log:[],plan:{prof:'150',km:'',rsv:'50'},cons:{km:0,l:0,base:false,list:[],min:'30'}};
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
let zeros=0,tracking=false,watchId=null,last=null,speed=0,inst=null,lastFixAt=0,lastTick=0,stopSince=null,wake=null,lastSave=0,pendingReload=false;
const rad=x=>x*Math.PI/180;
function hav(a,b){const R=6371000,la=a.lat??a.latitude,lo=a.lon??a.longitude,lb=b.lat??b.latitude,lc=b.lon??b.longitude;
 const h=Math.sin(rad(lb-la)/2)**2+Math.cos(rad(la))*Math.cos(rad(lb))*Math.sin(rad(lc-lo)/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function setGps(s,t){$('gps').className='gps '+s;$('gpsTxt').textContent=t}
function onFix(p){
 const c=p.coords,t=p.timestamp;
 if(c.accuracy>120){setGps('weak','Signal GPS faible');return}
 lastFixAt=Date.now();setGps(c.accuracy>50?'weak':'ok',c.accuracy>50?'GPS approximatif':'GPS actif');
 let v=c.speed!=null&&!isNaN(c.speed)?c.speed*3.6:null,d=0,segV=null;
 if(last){const dt=(t-last.t)/1000;d=hav(last,c);
  if(dt>0){const dv=d/dt*3.6;if(v==null)v=dv;segV=dv;if(dt>300||dv>250){d=0;segV=null}}}
 if(v!=null&&v<2&&speed>8&&zeros<3){zeros++;v=segV!=null&&segV>6?segV:speed*.7}else if(v==null||v>=2)zeros=0; // ignore les « 0 » isolés du GPS
 v=v==null||v<2?0:v;speed=v;
 if(v>0){const ci=conso(v);inst=inst==null?ci:inst*.7+ci*.3}
 if(v>0&&d>1&&segV!=null&&c.accuracy<=100){const km=d/1000;S.v.odo+=km;S.trip.km+=km;S.cons.km+=km;burn(km*conso(segV)/100)}
 last={lat:c.latitude,lon:c.longitude,t};
 lookup(c);render();
}
function onErr(e){if(e.code===1){setGps('err','Autorisation GPS refusée');stop()}else setGps('weak','Signal GPS perdu')}
function showIntro(){return new Promise(r=>{$('intro').hidden=false;$('introOk').onclick=()=>{try{localStorage.setItem('ac.geo','1')}catch{}$('intro').hidden=true;r()}})}
async function start(){
 if(!navigator.geolocation){toast('GPS indisponible sur cet appareil');return}
 if(!localStorage.getItem('ac.geo'))await showIntro();
 roadType=null;tracking=true;$('go').textContent='Arrêter le GPS';last=null;inst=null;lastTick=Date.now();setGps('weak','Recherche du signal…');
 watchId=navigator.geolocation.watchPosition(onFix,onErr,{enableHighAccuracy:true,maximumAge:1000,timeout:30000});
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
 if(lastFixAt&&now-lastFixAt>15000){speed=0;setGps('weak','Signal GPS perdu')}
 if(speed>0)stopSince=null;else{
  stopSince=stopSince||now; // ralenti pris en compte 2 min max (ensuite : moteur supposé coupé)
  if(now-stopSince<120000)burn(idleLh()*dt/3600)}
 if(now-lastSave>5000){save();lastSave=now}
 if(!document.hidden)render();
},1000);

/* ---- Limitation de vitesse (OpenStreetMap, ou réglage manuel) ---- */
const LIMS=[20,30,50,70,80,90,110,130];
let lastQ={t:0};
function parseMax(s){s=String(s).trim();const m={'FR:urban':50,'FR:rural':80,'FR:motorway':130,urban:50,rural:80,motorway:130}[s];if(m)return m;
 const r=s.match(/^(\d+)(\s*mph)?$/);return r?(r[2]?Math.round(r[1]*1.609/5)*5:+r[1]):null}
const CLASS={motorway:['Autoroute',130],motorway_link:['Autoroute',90],trunk:['Route',110],trunk_link:['Route',70],primary:['Route',80],secondary:['Route',80],tertiary:['Route',80],unclassified:['Route',80],residential:['Ville',50],living_street:['Ville',20],service:['Ville',30]};
let roadType=null;
async function lookup(c){
 if(!navigator.onLine)return;const now=Date.now();
 if(now-lastQ.t<8000||(lastQ.lat!=null&&now-lastQ.t<60000&&hav(lastQ,c)<100))return;
 lastQ={t:now,lat:c.latitude,lon:c.longitude};
 try{const ac=new AbortController();setTimeout(()=>ac.abort(),8000);
  const q=`[out:json][timeout:7];way(around:15,${c.latitude},${c.longitude})[highway];out tags;`;
  const j=await(await fetch('https://overpass-api.de/api/interpreter?data='+encodeURIComponent(q),{signal:ac.signal})).json();
  const w=j.elements.map(e=>e.tags).filter(t=>CLASS[t.highway]).sort((x,y)=>(!!y.maxspeed-!!x.maxspeed)||(CLASS[y.highway][1]-CLASS[x.highway][1]))[0];
  if(!w)return;
  roadType=CLASS[w.highway][0];
  if(S.lim.auto)S.lim.n=parseMax(w.maxspeed)||CLASS[w.highway][1];
  render();
 }catch{}
}
function stepLim(dir){
 let i=LIMS.findIndex(x=>x>=S.lim.n);if(i<0)i=LIMS.length-1;
 if(LIMS[i]!==S.lim.n&&dir<0)i++; // plus proche valeur inférieure
 S.lim.n=LIMS[Math.max(0,Math.min(LIMS.length-1,i+dir))];S.lim.auto=false;save();render();
}

/* ---- Affichage ---- */
let odoStr='';
function setOdo(){const s=Math.floor(S.v.odo).toString().padStart(6,'0')+Math.floor(S.v.odo*10)%10;if(s===odoStr)return;odoStr=s;$('odo').innerHTML=[...s].map((d,i)=>`<i${i===s.length-1?' class="t"':''}>${d}</i>`).join('')}
const dv=(x,d)=>String(+x.toFixed(d)).replace('.',',');
const sync=(id,v)=>{if(document.activeElement!==$(id))$(id).value=v};
const getRsv=()=>{const v=num(S.plan.rsv);return v>=0?v:50}; // km gardés en réserve (réglable)
const getMin=()=>{const v=num(S.cons.min);return v>=0?v:30}; // km minimum entre deux pleins pour mesurer
function renderExtra(f,rng){
 const RESERVE=getRsv();
 // calculateur de plein
 const need=Math.max(0,S.v.tank-f);
 $('cfL').textContent=fmt(need,1);$('cfE').textContent=fmt(need*S.v.price,2);
 const b=num($('cfB').value);
 if(b>0&&S.v.price>0){
  const lb=b/S.v.price,nl=Math.min(S.v.tank,f+lb);
  $('cfR').textContent=`${fmt(b,2)} € = ${fmt(lb,1)} L. Niveau après : ${fmt(nl/S.v.tank*100,0)} % (${fmt(nl/S.v.avg*100,0)} km d'autonomie).`+(lb>need?` Attention : cela dépasse le plein, maximum ${fmt(need*S.v.price,2)} €.`:'');
 }else $('cfR').textContent='';
 // quand refaire le plein
 const pr=S.plan.prof,kmw=pr==='0'?num(S.plan.km):+pr;
 $('plCustom').hidden=pr!=='0';
 if(!(kmw>0))$('plRes').textContent='Indiquez vos kilomètres par semaine.';
 else if(rng<=RESERVE)$('plRes').textContent=`Il reste environ ${fmt(rng,0)} km : faites le plein dès que possible.`;
 else{
  const days=Math.floor((rng-RESERVE)/(kmw/7)),d=new Date(Date.now()+days*864e5);
  $('plRes').textContent=`Avec ${fmt(rng,0)} km d'autonomie et environ ${fmt(kmw,0)} km par semaine, prévoyez le plein dans ${days} jour${days>1?'s':''}, vers le ${d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})} (en gardant ${RESERVE} km de réserve).`;
 }
 // consommation réelle
 const c=S.cons;
 $('realC').textContent=c.list.length?`Dernière mesure : ${fmt(c.list[0],1)} L/100 km (sur ${c.list.length} plein${c.list.length>1?'s':''}). Depuis le dernier plein : ${fmt(c.km,0)} km.`
  :c.base?`Depuis le dernier plein complet : ${fmt(c.km,0)} km. Indiquez les litres mis à la pompe au prochain plein complet pour mesurer votre vraie consommation.`
  :`Au prochain plein complet, indiquez les litres mis à la pompe : l'app mesurera votre vraie consommation.`;
}
function render(){
 const v=Math.round(speed),T=S.v.tank,f=fuel(),pct=T>0?f/T*100:0,rng=S.v.avg>0?f/S.v.avg*100:0;
 $('speed').textContent=v;$('hud').classList.toggle('over',tracking&&v>S.lim.n);
 $('limit').textContent=S.lim.n;$('limAuto').setAttribute('aria-pressed',S.lim.auto);
 if(tracking&&speed===0){$('inst').textContent=fmt(idleLh(),1);$('instU').textContent='L/h'}
 else{$('inst').textContent=tracking&&inst!=null?fmt(inst,1):'—';$('instU').textContent='L/100 km'}
 $('mode').textContent=tracking?(speed>0&&roadType?roadType:modeOf(speed)):'À l\'arrêt';
 $('cost').textContent=fmt(S.trip.eur,2);$('dist').textContent=fmt(S.trip.km,1);
 $('rangeHud').textContent=fmt(rng,0);setOdo();
 $('barHud').style.width=pct+'%';$('fuelHud').textContent=`${fmt(pct,0)} % · ${fmt(f,1)} L`;
 $('bar').style.width=pct+'%';$('pct').textContent=fmt(pct,0);$('lit').textContent=fmt(f,1);$('rng').textContent=fmt(rng,0);setRule(rng);sync('lvL',dv(f,1));sync('lvK',dv(rng,0));sync('lvP',dv(pct,1));
 for(const e of[$('barHud'),$('bar')])e.parentElement.classList.toggle('low',pct<15);
 renderExtra(f,rng);
}
function renderLog(){
 $('log').innerHTML=S.log.length?S.log.slice(0,6).map(l=>`<li><span>${new Date(l.t).toLocaleDateString('fr-FR',{day:'numeric',month:'short'})}</span><div>${l.full?'Plein complet':''}${l.l?' '+fmt(l.l,1)+' L':''}${l.est!=null&&Math.abs(l.est-l.l)>0.05?' (estimé '+fmt(l.est,1)+' L)':''}${l.eur?' · '+fmt(l.eur,2)+' €':''}</div></li>`).join(''):'<li><span>Aucun plein enregistré</span></li>';
}
function fillCar(){const v=S.v;$('fModel').value=v.model;$('fType').value=v.type;$('fYear').value=v.year;$('fHp').value=v.hp;$('fGear').value=v.gear;$('fOdo').value=String(+v.odo.toFixed(1)).replace('.',',');$('fTank').value=String(v.tank).replace('.',',');$('fAvg').value=String(v.avg).replace('.',',');$('fPrice').value=String(v.price).replace('.',',')}

/* ---- Actions ---- */
function setLevel(p){S.fuel=S.v.tank*Math.max(0,Math.min(100,p))/100;save();render()}
/* ---- Règle de réglage : 1 petit trait = 1 km d'autonomie ---- */
const PX=4; // pixels de glissement du doigt pour 1 km
let ruleDrag=false,ruleRaf=0,ruleKm=0;
const maxKm=()=>S.v.avg>0?S.v.tank/S.v.avg*100:0;
function drawRule(k){$('ruleV').textContent=k;$('rule').style.setProperty('--x',(-k*PX)+'px');$('rule').setAttribute('aria-valuenow',k);$('rule').setAttribute('aria-valuemax',Math.floor(maxKm()))}
function setRule(km){if(ruleDrag||ruleRaf)return;ruleKm=km;$('ruleT').style.width=((Math.floor(maxKm())+1)*PX+4)+'px';drawRule(Math.round(km))}
function applyKm(k){const m=Math.floor(maxKm());ruleKm=Math.max(0,Math.min(m,k));const r=Math.round(ruleKm);drawRule(r);S.fuel=Math.min(S.v.tank,r*S.v.avg/100);render()}
(function(){
 const R=$('rule');let sx=0,sk=0,lx=0,lt=0,vel=0;
 function inertia(){
  let v=vel*16;
  (function step(){
   v*=0.94;
   if(Math.abs(v)<0.04){ruleRaf=0;save();render();return}
   applyKm(ruleKm+v);
   if(ruleKm<=0||ruleKm>=Math.floor(maxKm()))v=0;
   ruleRaf=requestAnimationFrame(step);
  })();
 }
 R.addEventListener('pointerdown',e=>{ruleDrag=true;if(ruleRaf){cancelAnimationFrame(ruleRaf);ruleRaf=0}sx=lx=e.clientX;sk=Math.round(fuel()/S.v.avg*100);lt=e.timeStamp;vel=0;try{R.setPointerCapture(e.pointerId)}catch{}});
 R.addEventListener('pointermove',e=>{
  if(!ruleDrag)return;
  const dt=e.timeStamp-lt;if(dt>0)vel=.8*vel+.2*((e.clientX-lx)/PX/dt);
  lx=e.clientX;lt=e.timeStamp;applyKm(sk+(e.clientX-sx)/PX);
 });
 const end=()=>{if(!ruleDrag)return;ruleDrag=false;save();inertia()};
 R.addEventListener('pointerup',end);R.addEventListener('pointercancel',end);
 R.addEventListener('keydown',e=>{const d=(e.key==='ArrowRight'||e.key==='ArrowUp')?1:(e.key==='ArrowLeft'||e.key==='ArrowDown')?-1:0;if(!d)return;e.preventDefault();applyKm(Math.round(ruleKm)+d*(e.shiftKey?10:1));save()});
})();
document.querySelectorAll('[data-p]').forEach(b=>b.onclick=()=>setLevel(+b.dataset.p));
function setFuelL(l){S.fuel=Math.max(0,Math.min(S.v.tank,l));save();render()}
function fld(id,fn){$(id).onchange=()=>{const v=num($(id).value);if(isNaN(v)||v<0){toast('Valeur invalide');render();return}fn(v)}}
fld('lvL',l=>{if(l>S.v.tank)toast('Limité à la capacité du réservoir ('+fmt(S.v.tank,0)+' L)');setFuelL(l)});
fld('lvK',k=>{const l=k*S.v.avg/100;if(l>S.v.tank)toast('Autonomie maximale : '+fmt(S.v.tank/S.v.avg*100,0)+' km');setFuelL(l)});
fld('lvP',p=>{if(p>100)toast('Maximum 100 %');setLevel(p)});
$('plProf').onchange=()=>{S.plan.prof=$('plProf').value;save();render()};
$('plKm').onchange=()=>{S.plan.km=$('plKm').value;save();render()};
$('plRsv').onchange=()=>{S.plan.rsv=$('plRsv').value;save();render()};
$('fullMin').onchange=()=>{S.cons.min=$('fullMin').value;save();render()};
$('go').onclick=()=>tracking?stop():start();
$('resetTrip').onclick=()=>{S.trip={km:0,l:0,eur:0};inst=null;last=null;save();render();toast('Nouveau trajet démarré')};
$('limMinus').onclick=()=>stepLim(-1);$('limPlus').onclick=()=>stepLim(1);
$('limAuto').onclick=()=>{S.lim.auto=!S.lim.auto;lastQ={t:0};save();render()};
$('full').onclick=()=>{
 const L=num($('fullL').value),c=S.cons;
 const added=S.v.tank-fuel();S.fuel=S.v.tank;
 S.log.unshift({t:Date.now(),full:true,l:+(L>0?L:added).toFixed(1),est:L>0?+added.toFixed(1):undefined});S.log=S.log.slice(0,30);
 let msg='Réservoir plein';
 if(L>0&&c.base){
  if(c.km>=Math.max(getMin(),1)){
   const real=(c.l+L)/c.km*100;
   c.list.unshift(+real.toFixed(2));c.list=c.list.slice(0,5);
   const mean=c.list.reduce((x,y)=>x+y,0)/c.list.length;
   msg='Consommation réelle : '+fmt(real,1)+' L/100 km';
   if(confirm(`Consommation réelle mesurée : ${fmt(real,1)} L/100 km sur ${fmt(c.km,0)} km.\nMettre votre consommation moyenne à ${fmt(mean,1)} L/100 km (moyenne des ${c.list.length} dernier${c.list.length>1?'s':''} plein${c.list.length>1?'s':''}) ?`)){S.v.avg=+mean.toFixed(2);fillCar()}
   c.km=0;c.l=0;
  }else{c.l+=L;msg='Trop peu de kilomètres depuis le dernier plein pour mesurer la consommation'}
 }else{c.base=true;c.km=0;c.l=0;if(L>0)msg='Plein de référence enregistré : la consommation réelle sera mesurée au prochain plein complet'}
 $('fullL').value='';save();render();renderLog();toast(msg);
};
$('partial').onsubmit=e=>{
 e.preventDefault();const l=num($('pL').value),eur=num($('pE').value);
 if(!(l>0)||!(eur>=0)||isNaN(eur)){toast('Indiquez les litres et le prix payé');return}
 const room=S.v.tank-fuel(),add=Math.min(l,room);
 S.fuel=fuel()+add;
 S.log.unshift({t:Date.now(),l,eur});S.cons.l+=l;S.log=S.log.slice(0,30);
 $('pL').value=$('pE').value='';save();render();renderLog();fillCar();
 toast(l>room?`Capacité dépassée : réservoir limité à ${fmt(S.v.tank,0)} L`:'Carburant ajouté');
};
$('carForm').onsubmit=e=>{
 e.preventDefault();const o=num($('fOdo').value),t=num($('fTank').value),a=num($('fAvg').value),p=num($('fPrice').value);
 if(!(o>=0)||!(t>0)||!(a>0)||!(p>=0)){toast('Vérifiez les valeurs saisies');return}
 const f=fuel();S.v={model:$('fModel').value.trim(),odo:o,tank:t,avg:a,price:p,type:$('fType').value,year:$('fYear').value.trim(),hp:$('fHp').value.trim(),gear:$('fGear').value};S.fuel=Math.min(f,t);
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

/* ---- Mini-HUD (à côté de Waze en écran partagé) ---- */
$('mini').onclick=()=>{const on=document.body.classList.toggle('compact');$('mini').textContent=on?'Quitter':'Mini-HUD'};

/* ---- Suggestions de villes (données ouvertes de l'État) ---- */
const CITY=new Map();let cityT;
function suggest(inp){
 clearTimeout(cityT);const q=inp.value.trim();if(!q||CITY.has(q))return;
 cityT=setTimeout(async()=>{
  try{
   const short=q.length<3;
   const u=short?`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&boost=population&fields=nom,centre,departement&limit=8`
    :`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&type=municipality&autocomplete=1&limit=8`+(last?`&lat=${last.lat}&lon=${last.lon}`:'');
   const j=await(await fetch(u)).json();
   const items=short?j.map(x=>({name:x.nom,label:`${x.nom} (${x.departement?x.departement.code:''})`,lon:x.centre.coordinates[0],lat:x.centre.coordinates[1]}))
    :j.features.map(f=>({name:f.properties.city||f.properties.name,label:`${f.properties.city||f.properties.name} (${(f.properties.context||'').split(',')[0]})`,lon:f.geometry.coordinates[0],lat:f.geometry.coordinates[1]}));
   $('cities').innerHTML='';
   for(const i of items){CITY.set(i.label,i);const o=document.createElement('option');o.value=i.label;$('cities').appendChild(o)}
  }catch{}
 },250);
}
$('rFrom').oninput=()=>suggest($('rFrom'));$('rTo').oninput=()=>suggest($('rTo'));

/* ---- Calculateur de trajet (OpenStreetMap : adresses + itinéraire) ---- */
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function geo(q){
 const j=await(await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q='+encodeURIComponent(q))).json();
 if(!j.length)throw new Error('Lieu introuvable : '+q);
 return{lon:j[0].lon,lat:j[0].lat,name:j[0].display_name.split(',')[0]};
}
$('routeForm').onsubmit=async e=>{
 e.preventDefault();const f=$('rFrom').value.trim(),t=$('rTo').value.trim(),box=$('routeRes');
 if(!f||!t){toast('Indiquez un départ et une arrivée');return}
 box.hidden=false;box.textContent='Calcul en cours…';
 try{
  const A=CITY.get(f)||await geo(f);if(!CITY.get(f)&&!CITY.get(t))await new Promise(r=>setTimeout(r,1100)); // Nominatim : 1 requête par seconde
  const B=CITY.get(t)||await geo(t);
  const j=await(await fetch(`https://router.project-osrm.org/route/v1/driving/${A.lon},${A.lat};${B.lon},${B.lat}?overview=false`)).json();
  const rt=j.routes&&j.routes[0];if(!rt)throw new Error('Aucun itinéraire trouvé');
  const km=rt.distance/1000,h=rt.duration/3600,l=km*conso(km/h)/100,eur=l*S.v.price,m=Math.round(h*60);
  const need=l>fuel()?`<em>Réservoir insuffisant : il manquera ${fmt(l-fuel(),1)} L, prévoyez un plein.</em>`:'<em>Le carburant restant suffit pour ce trajet.</em>';
  box.innerHTML=`<span>${esc(A.name)} → ${esc(B.name)}</span><b>${fmt(eur,2)}</b><small>€ estimés</small><div class="two"><div><b>${fmt(km,0)}</b><small>km</small></div><div><b>${fmt(l,1)}</b><small>L (${esc(S.v.type)})</small></div><div><b>${Math.floor(m/60)} h ${String(m%60).padStart(2,'0')}</b><small>durée</small></div></div>${need}`;
 }catch(err){box.textContent=err.message&&err.message.length<80?err.message:'Calcul impossible : vérifiez votre connexion'}
};

/* ---- Écran de démarrage : « Mise à jour » seulement à la première ouverture d'une nouvelle version ---- */
const FILES=['index.html','style.css','app.js','manifest.json','icon-180.png','icon-192.png','icon-512.png'];
function setProg(p,t){const s=$('splash');if(!s)return;s.style.setProperty('--p',p/100);$('spPct').textContent=Math.round(p)+' %';if(t)$('spTxt').textContent=t}
function hideSplash(){const s=$('splash');if(!s)return;s.classList.add('out');setTimeout(()=>s.classList.add('gone'),450)}
async function runUpdate(){
 $('splash').classList.add('upd');setProg(5,'Mise à jour vers '+VERSION);
 try{
  const c=await caches.open('autoconso-'+VERSION);
  for(let i=0;i<FILES.length;i++){const r=await fetch(FILES[i],{cache:'no-store'});if(r.ok)await c.put(FILES[i],r);setProg(10+(i+1)/FILES.length*85)}
 }catch{}
 setProg(100,'Terminé');await new Promise(r=>setTimeout(r,500));
}
(async()=>{
 const t0=Date.now();let prev=null,hadData=false;
 try{prev=localStorage.getItem('ac.ver');hadData=!!localStorage.getItem(KEY)}catch{}
 if((prev&&prev!==VERSION)||(!prev&&hadData))await runUpdate();
 try{localStorage.setItem('ac.ver',VERSION)}catch{}
 setTimeout(hideSplash,Math.max(0,1100-(Date.now()-t0)));
})();
setTimeout(hideSplash,6000); // sécurité : l'app ne reste jamais bloquée sur l'écran de démarrage

/* ---- Démarrage & mise à jour automatique ---- */
$('plProf').value=S.plan.prof;$('plKm').value=S.plan.km;$('plRsv').value=S.plan.rsv??'50';$('fullMin').value=S.cons.min??'30';$('ver').textContent=VERSION;fillCar();renderLog();render();
const NATIVE=!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());
if(!NATIVE&&'serviceWorker'in navigator){
 const had=!!navigator.serviceWorker.controller;
 navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(r=>r.update()).catch(()=>{});
}
