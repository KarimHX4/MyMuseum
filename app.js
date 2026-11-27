/* MyMuseum — carnet de visite de musée, 100 % gratuit.
   Photo → identification (Gemini gratuit, ou recherche Wikidata / lecture du cartel)
   → fiche (Wikidata + Wikipédia, analyse Gemini en option) → rangement par musée / exposition.
   Données stockées sur l'appareil (IndexedDB). */
'use strict';
{
/* ---------- utilitaires ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/^(le|la|les|l) /,'').trim();
const paras=t=>String(t||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).map(p=>p.startsWith('§ ')?'<h4>'+esc(p.slice(2))+'</h4>':'<p>'+esc(p)+'</p>').join('');
const list=a=>Array.isArray(a)&&a.length?'<ul>'+a.map(x=>'<li>'+esc(typeof x==='string'?x:Object.values(x||{}).join(' — '))+'</li>').join('')+'</ul>':'';
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const fdate=d=>{try{return new Date(d+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}catch(e){return d||''}};
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const LS={get(k,d){try{const v=JSON.parse(localStorage.getItem(k));return v??d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const isNative=()=>!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());
const plural=(n,w)=>n+' '+w+(n>1?'s':'');
const safeUrl=u=>/^https:\/\//.test(String(u||''))?u:'';
let tt;function toast(m,ms=4200){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,ms)}
async function getJSON(url,opt){let r;try{r=await fetch(url,opt)}catch(e){throw new Error('Pas de connexion internet (ou service injoignable).')}if(!r.ok)throw new Error('Erreur '+r.status+' de '+new URL(url).hostname);return r.json()}

/* ---------- réglages ---------- */
const cfg=Object.assign({gemKey:'',model:'',models:[],autoLoc:true,frame:'auto',rangement:'origine',preferRef:false},LS.get('mm.cfg2',null)||{autoLoc:LS.get('mm.cfg',{}).autoLoc!==false});
const saveCfg=()=>LS.set('mm.cfg2',cfg);
const hasAI=()=>!!cfg.gemKey;

/* ---------- stockage IndexedDB ---------- */
const DB={
  h:null,
  open(){return this.h||(this.h=new Promise((res,rej)=>{const r=indexedDB.open('mymuseum',1);r.onupgradeneeded=()=>r.result.createObjectStore('oeuvres',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}))},
  async tx(mode,fn){const db=await this.open();return new Promise((res,rej)=>{const t=db.transaction('oeuvres',mode);const out=fn(t.objectStore('oeuvres'));t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})},
  all(){return this.tx('readonly',s=>s.getAll())},
  put(r){return this.tx('readwrite',s=>s.put(r))},
  del(id){return this.tx('readwrite',s=>s.delete(id))},
  clear(){return this.tx('readwrite',s=>s.clear())}
};
const urls=new Map();
const useRefFor=it=>!!((it.useRef===undefined||it.useRef===null?cfg.preferRef:it.useRef)&&it.refPhoto);
const dispDims=it=>useRefFor(it)?{pw:it.refpw,ph:it.refph}:{pw:it.pw,ph:it.ph};
function photoURL(it,which){
  const b=which==='cartel'?it.cartel:which==='own'?it.photo:which==='ref'?it.refPhoto:(useRefFor(it)?it.refPhoto:it.photo);
  if(!b)return '';const key=it.id+(which==='cartel'?'|c':b===it.refPhoto?'|r':'|o');
  const c=urls.get(key);if(c&&c.b===b)return c.u;
  if(c)URL.revokeObjectURL(c.u);
  const u=URL.createObjectURL(b);urls.set(key,{b,u});return u;
}
function dropURLs(id){for(const k of [id+'|o',id+'|r',id+'|c']){const c=urls.get(k);if(c){URL.revokeObjectURL(c.u);urls.delete(k)}}}
async function fetchRef(it){
  const file=it.wd&&it.wd.image;if(!file)throw new Error('Pas d’image de référence pour cette œuvre.');
  const j=await getJSON('https://commons.wikimedia.org/w/api.php?'+new URLSearchParams({action:'query',titles:'File:'+file,prop:'imageinfo',iiprop:'url',iiurlwidth:1600,format:'json',origin:'*'}));
  const pg=Object.values((j.query&&j.query.pages)||{})[0],ii=pg&&pg.imageinfo&&pg.imageinfo[0],url=ii&&(ii.thumburl||ii.url);
  if(!url)throw new Error('Image de référence introuvable.');
  let r;try{r=await fetch(url)}catch(e){throw new Error('Image de référence indisponible (connexion ?).')}
  if(!r.ok)throw new Error('Image de référence indisponible.');
  const blob=await r.blob();const m=await measure(blob);return {refPhoto:blob,refpw:m.pw||0,refph:m.ph||0};
}

/* ---------- état ---------- */
const S={items:[],view:'capturer',museum:null,ficheId:null,photo:null,cartel:null,ident:null,match:null,results:[],query:'',cap:'idle',err:'',replace:null,q:'',fav:false,busy:''};
async function save(it){const i=S.items.findIndex(x=>x.id===it.id);if(i<0)S.items.unshift(it);else S.items[i]=it;try{await DB.put(it)}catch(e){toast('Enregistrement impossible : '+(e&&e.message||e))}}
function upd(id,patch){const it=S.items.find(x=>x.id===id);if(!it)return;return save({...it,...patch})}

/* ---------- visite en cours ---------- */
const vis=Object.assign({musee:'',ville:'',expo:'',qid:'',ts:0,source:'',lat:null,lon:null},LS.get('mm.visite',{}));
const saveVis=()=>LS.set('mm.visite',vis);
function setVisit(m,v,x,source,qid,loc){
  const changed=norm(m)!==norm(vis.musee);
  if(loc){vis.lat=loc.lat;vis.lon=loc.lon}else if(changed){vis.lat=null;vis.lon=null}
  vis.musee=m||'';vis.ville=v||'';if(x!==undefined)vis.expo=x;else if(changed)vis.expo='';
  if(qid!==undefined)vis.qid=qid||'';else if(changed)vis.qid='';
  vis.ts=Date.now();vis.source=source;saveVis();
  $('#vMusee').value=vis.musee;$('#vVille').value=vis.ville;$('#vExpo').value=vis.expo;
}
for(const k of ['musee','ville','expo']){
  const el=$('#v'+k[0].toUpperCase()+k.slice(1));el.value=vis[k]||'';
  el.addEventListener('change',()=>{const v=el.value.trim();if(k==='musee'&&norm(v)!==norm(vis.musee)){vis.qid='';vis.lat=null;vis.lon=null}vis[k]=v;vis.ts=Date.now();vis.source='manuel';saveVis();
    if(k==='musee')$('#locChips').querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed',norm(c.dataset.name)===norm(vis.musee)));});
}

/* ---------- localisation → musée (OpenStreetMap / Overpass) ---------- */
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let lastDetect=0,detecting=false,nearby=[];
function locate(){
  return new Promise((res,rej)=>{
    if(!navigator.geolocation)return rej(new Error('La localisation n’est pas disponible sur cet appareil.'));
    navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy||50}),e=>{
      rej(new Error(e.code===1?'Localisation refusée : autorisez-la dans les réglages du téléphone pour MyMuseum.':e.code===3?'La position met trop de temps à arriver (à l’intérieur, le GPS est parfois lent).':'Position introuvable pour le moment.'))
    },{enableHighAccuracy:true,timeout:20000,maximumAge:60000});
  });
}
function dist(a,b,c,d){const R=6371e3,r=Math.PI/180,x=(c-a)*r,y=(d-b)*r;const h=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
async function overpass(q){
  let last;
  for(const u of OVERPASS){
    try{const ctl=new AbortController();const t=setTimeout(()=>ctl.abort(),25000);
      const r=await fetch(u,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(q),signal:ctl.signal});
      clearTimeout(t);if(r.ok)return await r.json();last=new Error('Overpass '+r.status);
    }catch(e){last=e}
  }
  throw last||new Error('Service de carte injoignable');
}
async function nearbyMuseums(p){
  const R=Math.round(Math.min(1000,Math.max(250,p.acc*1.5)));const L=p.lat.toFixed(6)+','+p.lon.toFixed(6);
  const sel='["tourism"~"^(museum|gallery)$"]',sel2='["amenity"~"^(arts_centre|exhibition_centre)$"]';
  const q=`[out:json][timeout:20];
is_in(${L})->.a;
(way(pivot.a)${sel};rel(pivot.a)${sel};way(pivot.a)${sel2};rel(pivot.a)${sel2};);
out center tags;
make sep;out;
(nwr(around:${R},${L})${sel}["name"];nwr(around:${R},${L})${sel2}["name"];);
out center tags;
make sep;out;
area.a["boundary"="administrative"]["admin_level"="8"];
out tags;`;
  const j=await overpass(q);
  let part=0;const inside=new Set(),found=new Map();let city='';
  for(const e of j.elements||[]){
    if(e.type==='sep'){part++;continue}
    const t=e.tags||{};
    if(part===2){city=city||t['name:fr']||t.name||'';continue}
    const name=t['name:fr']||t.name;if(!name)continue;
    const key=e.type+e.id;
    const la=e.lat??(e.center&&e.center.lat),lo=e.lon??(e.center&&e.center.lon);
    if(part===0)inside.add(key);
    if(!found.has(key))found.set(key,{key,name,city:t['addr:city']||'',qid:/^Q\d+$/.test(t.wikidata||'')?t.wikidata:'',kind:t.tourism||t.amenity,lat:la,lon:lo,d:la!=null?dist(p.lat,p.lon,la,lo):9999});
  }
  const out=[...found.values()].map(x=>({...x,inside:inside.has(x.key),city:x.city||city}));
  out.sort((a,b)=>(b.inside-a.inside)||((a.kind==='gallery')-(b.kind==='gallery'))||(a.d-b.d));
  return {list:out.slice(0,8),city,R};
}
let DET=0;
async function detect(auto){
  if(detecting)return;detecting=true;const run=++DET;
  const st=$('#locStatus'),b=$('#locBtn');b.disabled=true;
  st.innerHTML='<span class="spin"></span>Recherche des musées autour de vous… <button class="linkbtn" id="locx">Annuler</button>';
  $('#locx').onclick=()=>{DET++;detecting=false;b.disabled=false;st.textContent='Recherche annulée. Saisissez le lieu à la main ou touchez « Me localiser ».'};
  try{
    const p=await locate();if(run!==DET)return;
    const {list:ls,city,R}=await nearbyMuseums(p);if(run!==DET)return;
    lastDetect=Date.now();nearby=ls;
    const best=ls[0];
    const sure=best&&(best.inside||best.d<120);
    const manualRecent=vis.source==='manuel'&&Date.now()-vis.ts<4*36e5;
    if(sure&&!(auto&&manualRecent)){
      setVisit(best.name,best.city||city,undefined,'gps',best.qid,best.lat!=null?{lat:best.lat,lon:best.lon}:null);
      st.innerHTML=`<span class="locok">Détecté : <b>${esc(best.name)}</b></span> ${best.inside?'(vous êtes à l’intérieur)':'(à '+Math.round(best.d)+' m)'}`;
    }else if(ls.length){
      st.textContent=auto&&manualRecent&&sure?`Vous semblez être à ${best.name}. Touchez-le pour changer de lieu.`:'Plusieurs lieux à proximité : touchez le vôtre, ou saisissez-le à la main.';
    }else st.textContent='Aucun musée trouvé à moins de '+R+' m. Saisissez le lieu à la main.';
    renderChips();
  }catch(e){if(run!==DET)return;st.textContent=e.message||'Localisation impossible.';nearby=[];renderChips()}
  finally{if(run===DET){detecting=false;b.disabled=false}}
}
function renderChips(){
  fillLists();const c=$('#locChips');
  c.innerHTML=nearby.map((x,i)=>`<button class="chip" data-i="${i}" data-name="${esc(x.name)}" aria-pressed="${norm(x.name)===norm(vis.musee)}">${esc(x.name)}<small>${x.inside?'ici':Math.round(x.d)+' m'}</small></button>`).join('');
  c.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{const x=nearby[+b.dataset.i];setVisit(x.name,x.city,undefined,'manuel',x.qid,x.lat!=null?{lat:x.lat,lon:x.lon}:null);renderChips();$('#locStatus').innerHTML=`<span class="locok">Lieu choisi : <b>${esc(x.name)}</b></span>`});
}
$('#locBtn').onclick=()=>detect(false);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cfg.autoLoc&&Date.now()-lastDetect>20*6e4&&S.view==='capturer')detect(true)});

/* ---------- Wikidata & Wikipédia (gratuits, sans clé) ---------- */
const WD='https://www.wikidata.org/w/api.php';
const wdApi=p=>getJSON(WD+'?'+new URLSearchParams({...p,format:'json',origin:'*'}));
const cl=(e,p)=>(((e&&e.claims)||{})[p]||[]).filter(s=>s.rank!=='deprecated').map(s=>s.mainsnak&&s.mainsnak.datavalue&&s.mainsnak.datavalue.value).filter(v=>v!=null);
const lbl=e=>e?((e.labels&&(e.labels.fr||e.labels.en)||{}).value||e.id):'';
const dsc=e=>e&&e.descriptions?((e.descriptions.fr||e.descriptions.en)||{}).value||'':'';
const roman=n=>{const m=[[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];let s='';for(const[v,r]of m)while(n>=v){s+=r;n-=v}return s};
function wdTime(v){
  if(!v||!v.time)return '';
  const neg=v.time[0]==='-';const y=parseInt(v.time.slice(1,v.time.indexOf('-',1)),10);if(!y)return '';
  const bc=neg?' av. J.-C.':'';
  if(v.precision<=7){const c=Math.ceil(y/100);return roman(c)+(c===1?'er':'e')+' siècle'+bc}
  if(v.precision===8)return 'années '+Math.floor(y/10)*10+bc;
  return y+bc;
}
async function wdEntities(ids,props='labels|descriptions|claims|sitelinks'){
  const out={};ids=[...new Set(ids.filter(Boolean))];
  for(let i=0;i<ids.length;i+=50){const j=await wdApi({action:'wbgetentities',ids:ids.slice(i,i+50).join('|'),props,languages:'fr|en',sitefilter:'frwiki|enwiki'});Object.assign(out,j.entities||{})}
  return out;
}
const commonsThumb=(file,w=240)=>file?'https://commons.wikimedia.org/wiki/Special:FilePath/'+encodeURIComponent(file)+'?width='+w:'';
async function wdBrief(ids,inMus){
  if(!ids.length)return [];
  const ents=await wdEntities(ids,'labels|descriptions|claims');
  const cq=[];for(const id of ids){const e=ents[id];if(e)cq.push(...['P170','P195','P276'].flatMap(p=>cl(e,p).slice(0,3).map(v=>v.id)))}
  const cre=cq.length?await wdEntities(cq.slice(0,100),'labels'):{};
  return ids.map(id=>ents[id]).filter(e=>e&&!e.missing).map(e=>({qid:e.id,label:lbl(e),desc:dsc(e),creator:cl(e,'P170').map(v=>lbl(cre[v.id])).filter(Boolean).join(', '),year:wdTime(cl(e,'P571')[0]),home:homeFromWD({collection:cl(e,'P195').map(v=>lbl(cre[v.id])).filter(Boolean).join(', '),lieu:cl(e,'P276').map(v=>lbl(cre[v.id])).filter(Boolean).join(', ')}),image:(cl(e,'P18')[0])||'',inMus:inMus.has(e.id)}));
}
async function wdFind(text,mq){
  const t=String(text||'').replace(/["~*]/g,' ').trim();if(!t)return [];
  const ids=[],inMus=new Set();
  const run=async(q,mark)=>{const j=await wdApi({action:'query',list:'search',srsearch:q,srlimit:12,srnamespace:0});for(const s of (j.query&&j.query.search)||[]){if(!ids.includes(s.title))ids.push(s.title);if(mark)inMus.add(s.title)}};
  if(mq)await run(`${t} haswbstatement:P195=${mq}|P276=${mq}`,true);
  if(ids.length<8)await run(`${t} haswbstatement:P170`,false);
  return wdBrief(ids.slice(0,15),inMus);
}
const MUS_TYPES='P31=Q33506|P31=Q207694|P31=Q1007870|P31=Q2668072|P31=Q16735822|P31=Q3329412|P31=Q17431399|P31=Q588140|P31=Q10624527|P31=Q1497375';
async function museumQid(name){
  if(!name)return '';
  if(norm(name)===norm(vis.musee)&&vis.qid)return vis.qid;
  const cache=LS.get('mm.qids',{});const k=norm(name);if(cache[k]!==undefined)return cache[k];
  let q='';
  try{
    const j=await wdApi({action:'query',list:'search',srsearch:`${name.replace(/["~*]/g,' ')} haswbstatement:${MUS_TYPES}`,srlimit:1,srnamespace:0});
    q=((j.query&&j.query.search)||[])[0]?.title||'';
    if(!q){const k2=await wdApi({action:'wbsearchentities',search:name,language:'fr',limit:5,type:'item'});const hit=(k2.search||[]).find(s=>/mus[ée]e|museum|galerie|gallery|fondation|palais|château|collection/i.test(s.description||''));q=hit?hit.id:''}
  }catch(e){return ''}
  cache[k]=q;LS.set('mm.qids',cache);
  if(norm(name)===norm(vis.musee)&&q){vis.qid=q;saveVis()}
  return q;
}
const SKIP=/^(notes?|références?|notes et références|liens externes|bibliographie|voir aussi|articles connexes|annexes|sources|filmographie|galerie|see also|references|external links|further reading|notes and references|bibliography)$/i;
async function wikiArticle(lang,title){
  const j=await getJSON(`https://${lang}.wikipedia.org/w/api.php?`+new URLSearchParams({action:'query',prop:'extracts',explaintext:1,exsectionformat:'wiki',titles:title,redirects:1,format:'json',origin:'*'}));
  const pg=Object.values((j.query&&j.query.pages)||{})[0];if(!pg||pg.missing!==undefined||!pg.extract)return null;
  const secs=[{h:'',t:''}];let skip=false;
  for(const line of pg.extract.split('\n')){
    const m=line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if(m){if(m[1].length===2){skip=SKIP.test(m[2]);if(!skip)secs.push({h:m[2],t:''})}else if(!skip)secs[secs.length-1].t+='\n§ '+m[2]+'\n';continue}
    if(!skip)secs[secs.length-1].t+=line+'\n';
  }
  let total=0;const out=[];
  for(const s of secs){const t=s.t.replace(/\n{2,}/g,'\n').replace(/(^|\n)§ [^\n]*\n(?=§ |$)/g,'$1').trim();if(!t||total>40000)continue;total+=t.length;out.push({h:s.h,t})}
  return {lang,title:pg.title,url:`https://${lang}.wikipedia.org/wiki/`+encodeURIComponent(pg.title.replace(/ /g,'_')),sections:out};
}
async function wikiIntro(lang,title){
  const j=await getJSON(`https://${lang}.wikipedia.org/w/api.php?`+new URLSearchParams({action:'query',prop:'extracts',exintro:1,explaintext:1,titles:title,redirects:1,format:'json',origin:'*'}));
  const pg=Object.values((j.query&&j.query.pages)||{})[0];if(!pg||!pg.extract)return null;
  let t=pg.extract.trim();if(t.length>1600){const c=t.lastIndexOf('. ',1600);t=t.slice(0,c>400?c+1:1600)+'…'}
  return {lang,title:pg.title,url:`https://${lang}.wikipedia.org/wiki/`+encodeURIComponent(pg.title.replace(/ /g,'_')),intro:t};
}
function pickWiki(sl){if(!sl)return null;if(sl.frwiki)return ['fr',sl.frwiki.title];if(sl.enwiki)return ['en',sl.enwiki.title];return null}
async function wdFull(qid){
  const e=(await wdEntities([qid]))[qid];if(!e)return null;
  const refs=['P170','P186','P135','P136','P195','P276','P31','P180'].flatMap(p=>cl(e,p).slice(0,p==='P180'?8:5).map(v=>v.id));
  const R=refs.length?await wdEntities(refs,'labels|sitelinks'):{};
  const L=p=>cl(e,p).map(v=>lbl(R[v.id])).filter(Boolean);
  const unit={Q174728:'cm',Q11573:'m',Q174789:'mm'};
  const dim=p=>{const v=cl(e,p)[0];if(!v)return null;const u=String(v.unit||'').split('/').pop();return {n:Math.round(parseFloat(v.amount)*10)/10,u:unit[u]||''}};
  const h=dim('P2048'),w=dim('P2049');const cm=d=>d?(d.u==='m'?d.n*100:d.u==='mm'?d.n/10:d.n):null;
  const creator=cl(e,'P170')[0];
  return {qid,label:lbl(e),desc:dsc(e),creators:L('P170'),date:wdTime(cl(e,'P571')[0]),materiaux:L('P186').join(', '),
    dimensions:h&&w?`${h.n} × ${w.n} ${h.u||w.u}`.trim():h?`hauteur ${h.n} ${h.u}`.trim():'',
    mouvement:L('P135').join(', '),genre:L('P136').join(', '),collection:L('P195').join(', '),lieu:L('P276').join(', '),
    hcm:cm(h),wcm:cm(w),represente:L('P180'),inventaire:(cl(e,'P217')[0])||'',image:(cl(e,'P18')[0])||'',
    wiki:pickWiki(e.sitelinks),creatorWiki:creator?pickWiki(R[creator.id]&&R[creator.id].sitelinks):null};
}

/* ---------- Gemini (offre gratuite, facultatif) ---------- */
const GEM='https://generativelanguage.googleapis.com/v1beta';
const PREF=['gemini-3.5-flash','gemini-2.5-flash','gemini-3-flash-preview','gemini-3.1-flash-lite','gemini-2.5-flash-lite'];
const b64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(r.error);r.readAsDataURL(blob)});
function gemError(status,body){
  let m='';try{m=JSON.parse(body).error.message||''}catch(x){m=String(body||'').slice(0,200)}
  const e=new Error();e.status=status;
  if(status===401||/API key not valid|API_KEY_INVALID|API key expired|invalid authentication/i.test(m))e.message='Clé Gemini refusée : vérifiez-la dans les réglages.';
  else if(status===403)e.message=/location|region|country/i.test(m)?'L’API Gemini n’est pas disponible depuis ce pays.':'Accès refusé par Gemini ('+m.slice(0,120)+').';
  else if(status===429){e.quota=true;e.zero=/limit:\s*0\b/.test(m);e.message='Quota gratuit de Gemini atteint pour le moment (par minute ou par jour). Réessayez plus tard, ou cherchez l’œuvre sans IA.'}
  else if(status===404){e.skip=true;e.message='Modèle Gemini introuvable.'}
  else if(status>=500)e.message='Gemini est momentanément indisponible : réessayez.';
  else e.message='Erreur Gemini ('+status+') : '+m.slice(0,160);
  return e;
}
async function gemListModels(key){
  let r;try{r=await fetch(GEM+'/models?pageSize=1000',{headers:{'x-goog-api-key':key}})}catch(e){throw new Error('Pas de connexion internet.')}
  if(!r.ok)throw gemError(r.status,await r.text());
  const j=await r.json();
  const ids=(j.models||[]).filter(m=>(m.supportedGenerationMethods||[]).includes('generateContent')).map(m=>m.name.replace(/^models\//,''))
    .filter(id=>/^gemini-[\d.]+-flash(-lite)?(-preview)?(-\d\d-\d{4})?$/.test(id));
  const ver=id=>parseFloat((id.match(/gemini-([\d.]+)/)||[])[1])||0;
  ids.sort((a,b)=>{const pa=PREF.indexOf(a),pb=PREF.indexOf(b);if(pa>=0||pb>=0)return (pa<0?99:pa)-(pb<0?99:pb);return (/lite/.test(a)-/lite/.test(b))||(/preview|-\d\d-\d{4}/.test(a)-/preview|-\d\d-\d{4}/.test(b))||ver(b)-ver(a)});
  return ids;
}
function gemText(j){
  const c=(j.candidates||[])[0];
  if(!c){if(j.promptFeedback&&j.promptFeedback.blockReason)throw new Error('Gemini a refusé de répondre ('+j.promptFeedback.blockReason+').');return ''}
  return ((c.content&&c.content.parts)||[]).filter(p=>!p.thought).map(p=>p.text||'').join('');
}
async function gemini({prompt,images=[],json=false,maxTokens=8192,onText,signal}){
  if(!cfg.gemKey){const e=new Error('Pas de clé Gemini.');e.noKey=true;throw e}
  if(!navigator.onLine)throw new Error('Pas de connexion internet.');
  const parts=[];for(const b of images)parts.push({inline_data:{mime_type:'image/jpeg',data:await b64(b)}});parts.push({text:prompt});
  const body=JSON.stringify({contents:[{role:'user',parts}],generationConfig:Object.assign({maxOutputTokens:maxTokens,temperature:.4},json?{responseMimeType:'application/json'}:{})});
  const models=[...new Set([cfg.model,...(cfg.models||[]),...PREF].filter(Boolean))].slice(0,6);
  let last,unusable=true;
  for(const m of models){
    let r;try{r=await fetch(`${GEM}/models/${m}:${onText?'streamGenerateContent?alt=sse':'generateContent'}`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':cfg.gemKey},body,signal})}
    catch(e){if(isAbort(e))throw e;throw new Error('Impossible de joindre Gemini : vérifiez la connexion.')}
    if(!r.ok){const e=gemError(r.status,await r.text());if(e.skip||e.quota){last=e;if(!(e.skip||e.zero))unusable=false;continue}throw e}
    if(m!==cfg.model&&unusable){cfg.model=m;saveCfg()}
    if(onText){
      const rd=r.body.getReader(),dec=new TextDecoder();let buf='',text='';
      for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
        while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line.startsWith('data:'))continue;
          try{const t=gemText(JSON.parse(line.slice(5)));if(t){text+=t;onText(text)}}catch(e){if(!(e instanceof SyntaxError))throw e}}}
      return text;
    }
    const t=gemText(await r.json());if(!t)throw new Error('Réponse vide de Gemini : réessayez.');return t;
  }
  throw last||new Error('Aucun modèle Gemini gratuit disponible avec cette clé.');
}
function parseJ(t){
  const s=String(t||'');try{return JSON.parse(s)}catch(e){}
  const f=s.match(/```(?:json)?\s*([\s\S]*?)```/);if(f){try{return JSON.parse(f[1])}catch(e){}}
  const b=s.lastIndexOf('}');let a=s.indexOf('{');
  while(a>=0&&a<b){try{return JSON.parse(s.slice(a,b+1))}catch(e){a=s.indexOf('{',a+1)}}
  throw new Error('Réponse de Gemini illisible : réessayez.');
}
const geminiJSON=async o=>parseJ(await gemini({...o,json:true}));

/* ---------- lecture du cartel (OCR sur l'appareil, Tesseract) ---------- */
let tessP=null;
function loadTess(){
  if(window.Tesseract)return Promise.resolve(window.Tesseract);
  return tessP||(tessP=new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';s.onload=()=>res(window.Tesseract);s.onerror=()=>{tessP=null;s.remove();rej(new Error('Lecture du cartel indisponible (connexion nécessaire la première fois).'))};document.head.appendChild(s)}));
}
async function ocr(blob){const T=await loadTess();const w=await T.createWorker('fra');try{const {data}=await w.recognize(blob);return data&&data.text||''}finally{try{await w.terminate()}catch(e){}}}
function cartelLines(text){
  return String(text||'').split('\n').map(l=>l.replace(/[^\p{L}\p{N}'’ ,.()-]/gu,' ').replace(/\s+/g,' ').trim()).filter(l=>l.length>=3&&/\p{L}{3}/u.test(l)).slice(0,6);
}

/* ---------- prompts Gemini ---------- */
function ctxText(){
  const b=S.replace&&S.items.find(x=>x.id===S.replace);
  const v=b?[b.vuA||b.musee,b.vuVille||b.ville].filter(Boolean).join(', '):[$('#vMusee').value.trim(),$('#vVille').value.trim()].filter(Boolean).join(', ');
  const x=b?b.expo||'':$('#vExpo').value.trim();
  return `Lieu de visite indiqué par le visiteur : ${v||'non précisé'}${vis.source==='gps'&&v?' (détecté par géolocalisation)':''}. Exposition temporaire : ${x||'aucune indiquée'}. Date de la visite : ${today()}.`;
}
function identPrompt(hint,withCartel,cartelOnly,name){
  return `Tu es conservateur de musée et historien de l'art. ${name?'Le visiteur indique le nom de l’œuvre : « '+name+' ». Retrouve cette œuvre et donne ses informations'+(withCartel||!cartelOnly?' ; la photo jointe (l’œuvre ou son cartel) sert seulement à vérifier qu’il s’agit bien d’elle':'')+'. Si plusieurs œuvres portent ce nom, choisis la plus probable vu le lieu de visite et propose les autres en candidats.':cartelOnly?'La photo jointe montre le cartel (l’étiquette) d’une œuvre, prise par un visiteur : l’œuvre elle-même n’est pas photographiée. Identifie l’œuvre d’après le texte du cartel.':'Identifie l’œuvre d’art sur la première photo, prise par un visiteur (prise de biais possible, reflets, cadre).'}${cartelOnly?'':withCartel?' La seconde photo montre le cartel de l’œuvre : sers-t’en en priorité.':' Si un cartel est lisible sur la photo, sers-t’en.'}
${ctxText()}${hint?'\nIndice donné par le visiteur : '+hint:''}
Réponds par un objet JSON :
{"reconnu":true,"confiance":"haute|moyenne|faible","titre":"titre usuel en français","titre_original":"","artiste":"nom complet ou 'Anonyme' + atelier/culture","date":"date ou période","technique":"technique et support","dimensions":"si connues, sinon ''","mouvement":"","conservation":{"institution":"musée ou institution qui possède l'œuvre (son nom, pas le département)","ville":""},"lieu_visite":{"musee":"nom officiel complet du lieu où le visiteur la voit","ville":""},"exposition":"nom de l'exposition temporaire si elle y est présentée, sinon ''","en_pret":false,"candidats":[{"titre":"","artiste":"","institution":""}],"remarque":"une phrase sur ce qui fonde ou limite l'identification"}
Règles : n'invente jamais. Si tu hésites, confiance "faible" ou "moyenne" et jusqu'à 3 candidats crédibles. Pour une œuvre anonyme ou peu connue, donne un titre descriptif et la culture, l'époque et la fonction probables. Si le visiteur a indiqué un lieu, reprends-le sous son nom officiel. Si l'œuvre appartient à une autre institution que le lieu de visite, en_pret = true.`;
}
function wikiDigest(w,max=7000){if(!w)return '';let s='';for(const x of w.sections){s+=(x.h?'\n## '+x.h+'\n':'')+x.t.replace(/^§ /gm,'### ')+'\n';if(s.length>max)break}return s.slice(0,max)}
function fichePrompt(f,wd,wiki){
  return `Tu es historien de l'art et médiateur de musée. Rédige en français la fiche d'une œuvre qu'un visiteur a aimée, pour qu'il en apprenne plus après sa visite. Ton : expert mais vivant, précis, sans remplissage.
Œuvre : « ${f.titre} »${f.artiste?', '+f.artiste:''}${f.date?', '+f.date:''}${f.technique?', '+f.technique:''}. Conservée par : ${f.conservation||'non précisé'}. Vue à : ${f.vuA||f.musee||'?'}${(f.vuVille||f.ville)?' ('+(f.vuVille||f.ville)+')':''}${f.expo?', exposition temporaire « '+f.expo+' »':''}.
${wd?`Données Wikidata : ${JSON.stringify({createur:wd.creators,date:wd.date,materiaux:wd.materiaux,dimensions:wd.dimensions,mouvement:wd.mouvement,genre:wd.genre,represente:wd.represente,collection:wd.collection})}\n`:''}${wiki?`Article Wikipédia (${wiki.lang}) « ${wiki.title} », à utiliser comme source principale ; ne contredis pas ses faits :\n"""${wikiDigest(wiki)}"""\n`:''}${f.photo?'La photo jointe est celle du visiteur : appuie la description sur ce qu’on y voit.\n':''}Réponds par un objet JSON :
{"accroche":"2 ou 3 phrases qui disent pourquoi cette œuvre compte","technique":"","dimensions":"ou ''","mouvement":"","contexte":"contexte historique, commande et création (2 paragraphes séparés par \\n)","description":"ce qu'on voit, du général au détail (1 à 2 paragraphes)","analyse":{"composition":"","couleur_lumiere_matiere":"","symbolique_interpretations":""},"artiste":"portrait de l'artiste centré sur ce qui éclaire l'œuvre (1 paragraphe)","histoire_oeuvre":"provenance, réception, restaurations, déplacements notables","anecdotes":["2 à 4 faits surprenants mais vérifiés"],"a_regarder":["4 à 6 détails précis à observer en la revoyant"],"oeuvres_liees":[{"titre":"","artiste":"","lieu":"où la voir","lien":"pourquoi la rapprocher"}],"aller_plus_loin":["3 à 5 livres, documentaires ou visites réels"],"debats":"ce qui est incertain ou discuté ; '' si rien","mots_cles":["5 à 8 mots-clés"]}
Règles : uniquement des faits sûrs ; signale l'incertitude plutôt que d'inventer ; pas de références imaginaires.`;
}

/* ---------- photo ---------- */
async function shrink(file,max=1600){
  const url=URL.createObjectURL(file);
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('Image illisible (format non pris en charge ?)'));i.src=url});
    const k=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
    const c=document.createElement('canvas');c.width=Math.round(img.naturalWidth*k);c.height=Math.round(img.naturalHeight*k);
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return await new Promise(r=>c.toBlob(r,'image/jpeg',.86));
  }finally{URL.revokeObjectURL(url)}
}
const busy=()=>['ident','fiche','ocr'].includes(S.cap);
let RUN=0,CTL=null;
function newRun(){if(CTL)CTL.abort();CTL=new AbortController();return ++RUN}
function cancelRun(){RUN++;if(CTL){CTL.abort();CTL=null}}
const isAbort=e=>!!e&&(e.name==='AbortError'||e.aborted===true);
function setCartel(b){if(S.cartelUrl)URL.revokeObjectURL(S.cartelUrl);S.cartel=b;S.cartelUrl=b?URL.createObjectURL(b):''}
function resetCap(){if(S.photo)URL.revokeObjectURL(S.photo.url);S.photo=null;setCartel(null);S.ident=null;S.match=null;S.results=[];S.query='';S.replace=null;S.cap='idle'}
async function takeFile(file){
  if(!file||busy())return;
  try{
    const blob=await shrink(file);
    const keepReplace=S.replace,keepCartel=S.cartel;resetCap();S.replace=keepReplace;if(keepCartel)setCartel(keepCartel);
    S.photo={blob,url:URL.createObjectURL(blob)};
    startIdentify();
  }catch(e){S.err=e.message;S.cap='error';renderCap()}
}
function startIdentify(){if(hasAI())identify();else{S.cap='find';renderCap();setTimeout(()=>{const q=$('#fq');if(q)q.focus()},50)}}
$('#inCam').addEventListener('change',e=>{takeFile(e.target.files[0]);e.target.value=''});
$('#inImp').addEventListener('change',e=>{takeFile(e.target.files[0]);e.target.value=''});
$('#inCartel0').addEventListener('change',async e=>{const file=e.target.files[0];e.target.value='';if(!file||busy())return;
  try{const b=await shrink(file,2000);const keep=S.replace;resetCap();S.replace=keep;setCartel(b);if(hasAI())identify();else ocrCartel()}catch(er){S.err=er.message;S.cap='error';renderCap()}});
const cv=$('#canvas');
cv.addEventListener('dragover',e=>{e.preventDefault();cv.classList.add('drag')});
cv.addEventListener('dragleave',()=>cv.classList.remove('drag'));
cv.addEventListener('drop',e=>{e.preventDefault();cv.classList.remove('drag');takeFile(e.dataTransfer.files[0])});

/* ---------- identification ---------- */
const replBase=()=>S.replace&&S.items.find(x=>x.id===S.replace);
const curMuseum=()=>{const m=$('#cVu');const b=replBase();const bv=b&&(b.vuA||b.musee);return (m&&m.value.trim())||(bv&&bv!=='Lieu non précisé'&&bv)||$('#vMusee').value.trim()};
async function identify(name){
  name=typeof name==='string'?name.trim():'';
  const run=newRun();S.identName=name;S.cap='ident';renderCap();
  try{
    const imgs=S.photo?[S.photo.blob,...(S.cartel?[S.cartel]:[])]:S.cartel?[S.cartel]:[];
    const d=await geminiJSON({prompt:identPrompt(name?'':LS.get('mm.hint',''),!!S.cartel,!S.photo,name),images:imgs,maxTokens:4096,signal:CTL.signal});
    if(run!==RUN)return;
    S.ident=d;S.match=null;S.results=[];S.cap='confirm';renderCap();linkWikidata();
  }catch(e){if(run!==RUN||isAbort(e))return;S.err=e.message;S.cap='error';renderCap()}
}
function searchByName(q){q=String(q||'').trim();if(!q)return;cancelRun();S.query=q;S.results=[];S.cap='find';renderCap()}
const nameBox=(title,btn)=>`<form class="namebox" id="nf"><label class="f">${title}<input id="nq" placeholder="La Joconde, Léonard de Vinci" autocomplete="off"></label><button class="btn main">${btn}</button></form>`;
let LINK=0;
async function linkWikidata(){
  const d=S.ident||{};if(!d.titre)return;
  const run=++LINK;S.linking=true;renderLink();
  try{
    const mq=await museumQid(curMuseum());
    const sur=String(d.artiste||'').split(/\s+/).filter(w=>w.length>2).pop()||'';
    let r=await wdFind(`${d.titre} ${sur}`.trim(),mq);
    if(!r.length)r=await wdFind(d.titre,mq);
    if(!r.length&&d.titre_original)r=await wdFind(d.titre_original,mq);
    const na=norm(d.artiste);
    const best=r.find(x=>x.creator&&norm(x.creator).split(' ').some(w=>w.length>3&&na.includes(w)))||r[0]||null;
    if(run!==LINK)return;
    if(S.cap==='confirm'&&!S.match){S.match=best;S.results=r}
  }catch(e){if(run!==LINK)return}
  S.linking=false;renderLink();
}
let findT;
let FIND=0;
async function runFind(q){
  S.query=q;const box=$('#fres');if(!box)return;const run=++FIND;
  if(!q.trim()){S.results=[];box.innerHTML='';renderMk();return}
  box.innerHTML='<p class="note"><span class="spin"></span>Recherche dans Wikidata… <button class="linkbtn" id="fx">Annuler</button></p>';
  $('#fx').onclick=()=>{FIND++;box.innerHTML='<p class="note">Recherche annulée.</p>';renderMk()};
  try{const mq=await museumQid(curMuseum());const r=await wdFind(q,mq);if(run!==FIND||S.query!==q)return;S.results=r;renderResults()}
  catch(e){if(run!==FIND)return;box.innerHTML=`<p class="err">${esc(e.message)}</p>`;renderMk()}
}
function renderMk(){
  const el=$('#mk');if(!el)return;const q=(S.query||'').trim();
  el.innerHTML=q?`<p class="note" style="margin:14px 0 8px">${S.results.length?'Aucune ne correspond ?':'Rien trouvé dans Wikidata.'}</p><button class="btn ${S.results.length?'':'main'}" id="mkb">${hasAI()?'Identifier « '+esc(q)+' » avec Gemini':'Créer la fiche « '+esc(q)+' »'}</button>`:'';
  const b=$('#mkb');if(b)b.onclick=()=>{if(hasAI())identify(q);else{S.match=null;S.ident=Object.assign({},S.ident||{},{titre:q,fromWD:true});S.cap='confirm';renderCap()}};
}
function renderResults(){
  const box=$('#fres');if(!box)return;
  renderMk();
  if(!S.results.length){box.innerHTML=S.query?'<p class="note">Aucune œuvre trouvée. Essayez le nom de l’artiste ou un autre mot du titre.</p>':'';return}
  box.innerHTML=S.results.map((r,i)=>`<button class="res" data-r="${i}">${r.image?`<img src="${esc(commonsThumb(r.image,160))}" alt="" loading="lazy" onerror="this.remove()">`:'<span class="noimg"></span>'}<span><b>${esc(r.label)}</b><small>${esc([r.creator,r.year].filter(Boolean).join(', ')||r.desc)}</small>${r.inMus?'<em>dans ce musée</em>':''}</span></button>`).join('');
  box.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>{const r=S.results[+b.dataset.r];S.match=r;
    const had=S.ident&&S.ident.confiance&&!S.ident.fromWD;S.ident=Object.assign({},S.ident||{},{titre:r.label,artiste:r.creator||(S.ident&&S.ident.artiste)||'',date:r.year||(S.ident&&S.ident.date)||'',fromWD:!had,conservation:had&&S.ident.conservation&&S.ident.conservation.institution?S.ident.conservation:{institution:r.home||'',ville:''}});
    S.cap='confirm';renderCap()});
}
async function readCartel(file){
  if(!file)return;
  try{setCartel(await shrink(file,2000))}catch(e){toast(e.message);return}
  if(hasAI()){identify();return}
  ocrCartel();
}
async function ocrCartel(){
  const run=newRun();S.cap='ocr';renderCap();
  try{
    const lines=cartelLines(await ocr(S.cartel));if(run!==RUN)return;
    if(!lines.length)throw new Error('Texte du cartel illisible : rapprochez-vous ou évitez les reflets.');
    const mq=await museumQid(curMuseum());
    let r=[],q='';
    for(const cand of [lines.slice(0,2).join(' '),lines[1],lines[0],lines.slice(0,3).join(' ')].filter(Boolean)){r=await wdFind(cand,mq);q=cand;if(run!==RUN)return;if(r.length)break}
    S.query=q;S.results=r;S.cap='find';renderCap();
    toast('Cartel lu : « '+lines.slice(0,2).join(' / ')+' »',6000);
  }catch(e){if(run!==RUN)return;S.cap='find';renderCap();toast(e.message,6000)}
}
async function savePending(){
  const it={id:S.replace||newId(),createdAt:Date.now(),visite:today(),titre:'Œuvre à identifier',artiste:'',date:'',musee:$('#vMusee').value.trim()||'Lieu non précisé',ville:$('#vVille').value.trim(),vuA:$('#vMusee').value.trim()||'Lieu non précisé',vuVille:$('#vVille').value.trim(),expo:$('#vExpo').value.trim(),conservation:'',photo:S.photo?S.photo.blob:S.cartel,cartel:S.cartel||null,pending:true,notes:'',favori:false,qa:[]};
  if(S.replace){const old=S.items.find(x=>x.id===S.replace);if(old)Object.assign(it,{createdAt:old.createdAt,visite:old.visite,musee:old.musee,ville:old.ville,vuA:old.vuA||old.musee,vuVille:old.vuVille||old.ville,expo:old.expo,notes:old.notes,favori:old.favori})}
  Object.assign(it,await measure(it.photo),{loc:it.loc||locFor(it.musee)});
  await save(it);resetCap();renderCap();fillLists();toast('Photo gardée : vous la retrouverez dans « Œuvres », à identifier.');openFiche(it.id);
}

/* ---------- capture : panneau latéral ---------- */
function renderLink(){
  const el=$('#link');if(!el)return;
  const m=S.match;
  if(S.linking){el.innerHTML='<div><span class="spin"></span>Recherche de la fiche Wikipédia…</div><button class="btn small" id="lkx">Annuler</button>';$('#lkx').onclick=()=>{LINK++;S.linking=false;renderLink()};return}
  const cc=$('#cCons');if(cc&&!cc.value.trim()&&m&&m.home){cc.value=m.home;syncVu()}
  el.innerHTML=m?`${m.image?`<img src="${esc(commonsThumb(m.image,120))}" alt="" onerror="this.remove()">`:''}<div><small>Fiche Wikidata / Wikipédia</small><b>${esc(m.label)}</b><small>${esc([m.creator,m.year].filter(Boolean).join(', '))}</small></div><button class="btn small" id="chg">Changer</button>`
    :`<div><small>Aucune fiche Wikidata liée</small>${hasAI()?'La fiche sera rédigée par Gemini seul.':'La fiche ne contiendra que vos informations.'}</div><button class="btn small" id="chg">Chercher</button>`;
  $('#chg').onclick=()=>{S.cap='find';S.query=(S.ident&&S.ident.titre)||S.query;renderCap()};
}
function renderCap(){
  const has=!!(S.photo||S.cartel);
  $('#empty').hidden=has;
  setFrameClass($('#capFrame'),cfg.frame==='auto'?'dore':cfg.frame);
  cv.querySelectorAll(':scope>img,.scan').forEach(n=>n.remove());
  if(has){const i=new Image();i.src=S.photo?S.photo.url:S.cartelUrl;i.alt=S.photo?'Votre photo':'Le cartel';cv.appendChild(i)}
  if(busy()){const sc=document.createElement('div');sc.className='scan';cv.appendChild(sc)}
  const side=$('#side');
  const cartelBtn=`<label class="btn small"><input type="file" accept="image/*" capture="environment" class="cartelIn" hidden>${S.cartel?'Reprendre le cartel':'Photographier le cartel'}</label>`;
  const again=`<div class="row" style="margin-top:14px">${has&&!busy()?'<button class="btn small" id="crop">Recadrer</button>':''}<label class="btn small"><input type="file" accept="image/*" capture="environment" class="re" hidden>${S.photo?'Reprendre la photo':'Photographier aussi l’œuvre'}</label>${has?'<button class="btn small" id="later">Identifier plus tard</button><button class="btn small" id="cancel">Annuler</button>':''}</div>`;
  if(S.cap==='idle'){
    side.innerHTML=`<h2>Photographiez, on s’occupe du reste</h2><p class="lead">${hasAI()?'Gemini reconnaît l’œuvre, la fiche est complétée avec Wikipédia et Wikidata,':'Retrouvez l’œuvre dans les collections du musée (Wikidata) ou lisez son cartel : la fiche est faite avec Wikipédia,'} puis rangée dans le dossier du musée, et de l’exposition si elle est temporaire.</p>
    ${hasAI()?'<label class="f">Un indice pour aider (facultatif)<input id="hint" placeholder="Texte du cartel, salle, nom de l’artiste…"></label>':'<p class="note">Astuce : ajoutez une clé Gemini gratuite dans les Réglages pour que l’app reconnaisse l’œuvre sur la photo.</p>'}`;
    const h=$('#hint');if(h){h.value=LS.get('mm.hint','');h.addEventListener('input',e=>LS.set('mm.hint',e.target.value))}
  }else if(S.cap==='ident'){
    side.innerHTML=`<h2>${S.identName?'Recherche de « '+esc(S.identName)+' »…':'Je regarde l’œuvre…'}</h2><p class="lead">Gemini identifie l’œuvre, l’artiste et son lieu de conservation${S.cartel&&!S.identName?' à l’aide du cartel':''}.</p><button class="btn" id="stop">Annuler la recherche</button>`;
    $('#stop').onclick=()=>{cancelRun();S.cap=S.photo||S.cartel?'find':'idle';renderCap()};
  }else if(S.cap==='ocr'){
    side.innerHTML=`<h2>Lecture du cartel…</h2><p class="lead">Le texte est lu sur le téléphone, puis recherché dans Wikidata. La première fois, le module de lecture se télécharge (quelques secondes).</p><button class="btn" id="stop">Annuler la recherche</button>`;
    $('#stop').onclick=()=>{cancelRun();S.cap='find';renderCap()};
  }else if(S.cap==='fiche'){
    side.innerHTML=`<h2>Préparation de la fiche…</h2><p class="lead" id="fstep">${esc(S.busy||'Données Wikidata et article Wikipédia.')}</p><button class="btn" id="stop">Annuler</button>`;
    $('#stop').onclick=()=>{cancelRun();backToForm(S.lastForm)};
  }else if(S.cap==='error'){
    side.innerHTML=`<h2>Identification impossible</h2><p class="err">${esc(S.err)}</p>
    ${nameBox('Vous connaissez son nom ? Tapez-le (et l’artiste si possible)','Chercher cette œuvre')}
    <div class="row" style="margin-top:10px">${(S.photo||S.cartel)&&hasAI()?'<button class="btn small" id="retry">Réessayer avec Gemini</button>':''}<button class="btn small" id="manual2">Saisir la fiche à la main</button></div>${again}`;
    const r=$('#retry');if(r)r.onclick=()=>identify(S.identName);
    $('#manual2').onclick=()=>{S.match=null;S.ident=Object.assign({},S.ident||{},{fromWD:true});S.cap='confirm';renderCap()};
  }else if(S.cap==='find'){
    const mus=curMuseum();
    side.innerHTML=`<h2>Quelle est cette œuvre ?</h2><p class="lead">Cherchez-la par son titre ou son artiste${mus?` : les œuvres de <b>${esc(mus)}</b> apparaissent en premier`:''}. Ou photographiez son cartel pour le lire automatiquement.</p>
    <form class="row" id="ff"><input class="inp" id="fq" placeholder="Titre ou artiste…" autocomplete="off" style="flex:1 1 200px;margin:0"><button class="btn main">Chercher</button></form>
    <div class="row" style="margin:12px 0">${cartelBtn}<button class="btn small" id="manual">Saisir à la main</button>${hasAI()?'<button class="btn small" id="reai">Demander à Gemini</button>':''}</div>
    <div id="fres" class="results"></div><div id="mk"></div>${again}`;
    const q=$('#fq');q.value=S.query||'';
    q.addEventListener('input',()=>{clearTimeout(findT);const v=q.value;findT=setTimeout(()=>runFind(v),550)});
    $('#ff').addEventListener('submit',e=>{e.preventDefault();clearTimeout(findT);runFind(q.value)});
    $('#manual').onclick=()=>{S.match=null;S.ident=Object.assign({},S.ident||{},{titre:q.value.trim(),fromWD:true});S.cap='confirm';renderCap()};
    const ra=$('#reai');if(ra)ra.onclick=()=>identify(q.value.trim());
    if(S.results.length)renderResults();else if(S.query)runFind(S.query);
  }else if(S.cap==='confirm'){
    const d=S.ident||{};const ai=hasAI()&&!d.fromWD&&d.confiance;const c=['haute','moyenne','faible'].includes(d.confiance)?d.confiance:'moyenne';
    const lv=d.lieu_visite||{},co=d.conservation||{};
    const rb=replBase();const vm=rb?rb.vuA||rb.musee:$('#vMusee').value.trim(),vx=rb?rb.expo||'':$('#vExpo').value.trim();
    const cand=ai?(Array.isArray(d.candidats)?d.candidats:[]).filter(x=>x&&x.titre).slice(0,3):[];
    const unsure=ai&&(d.reconnu===false||c==='faible');
    side.innerHTML=`${unsure?`<div class="unsure"><b>Gemini n’est pas sûr de l’œuvre.</b>${nameBox('Vous connaissez son nom ? Tapez-le pour la retrouver','Chercher')}</div>`:''}<div class="cartel">${ai?`<span class="conf ${c}">${d.reconnu===false?'Œuvre non identifiée avec certitude':'Gemini · confiance '+c}</span>`:''}
    ${cand.length?`<div class="meta">Autres pistes :</div><div class="chips">${cand.map((x,i)=>`<button class="chip" data-c="${i}">${esc(x.titre)}${x.artiste?' · '+esc(x.artiste):''}</button>`).join('')}</div>`:''}
    <div class="link" id="link"></div>
    <label class="f">Titre<input id="cTitre"></label>
    <div class="g2"><label class="f">Artiste<input id="cArt"></label><label class="f">Date<input id="cDate"></label></div>
    <label class="f">Musée de l’œuvre (où elle est conservée)<input id="cCons" data-sugg="musees" autocomplete="off" placeholder="Complété par Wikidata si vide"></label>
    <div class="g2"><label class="f">Vue à<input id="cVu" data-sugg="musees" autocomplete="off"></label><label class="f">Ville<input id="cVille"></label></div>
    <label class="f">Exposition temporaire<input id="cExpo" data-sugg="expos" autocomplete="off" placeholder="Vide = collections permanentes"></label>
    <p class="note" id="cDest" style="margin:-2px 0 14px"></p>
    ${ai&&d.remarque?`<p class="note" style="margin:-4px 0 12px">${esc(d.remarque)}</p>`:''}
    <div class="row"><button class="btn main" id="go">Créer la fiche</button>${cartelBtn}</div></div>${again}`;
    const set=(id,v)=>{$(id).value=v||''};
    set('#cTitre',d.titre);set('#cArt',d.artiste);set('#cDate',d.date);
    set('#cCons',homeName(co.institution)||(S.match&&S.match.home)||'');
    const keepVu=rb&&!rb.pending;
    S.cf={visitM:(rb?rb.vuA||rb.musee:vm)||lv.musee||'',visitV:(rb?rb.vuVille||rb.ville:$('#vVille').value.trim())||lv.ville||'',homeM:homeName(co.institution),homeV:co.ville||'',vuDirty:keepVu,villeDirty:keepVu};
    if(keepVu){set('#cVu',rb.vuA||rb.musee);set('#cVille',rb.vuVille||rb.ville)}else syncVu();
    $('#cVu').addEventListener('input',()=>{S.cf.vuDirty=true});$('#cVille').addEventListener('input',()=>{S.cf.villeDirty=true});
    $('#cCons').addEventListener('input',syncVu);
    set('#cExpo',vx||d.exposition);
    ['#cCons','#cVu'].forEach(id=>$(id).addEventListener('input',updDest));updDest();
    side.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{const x=cand[+b.dataset.c];set('#cTitre',x.titre);set('#cArt',x.artiste);set('#cCons',homeName(x.institution));S.cf.homeM=homeName(x.institution);S.cf.homeV='';syncVu();side.querySelectorAll('[data-c]').forEach(z=>z.setAttribute('aria-pressed',z===b));S.ident=Object.assign({},S.ident,{titre:x.titre,artiste:x.artiste});S.match=null;linkWikidata()});
    $('#go').onclick=create;renderLink();
  }
  side.querySelectorAll('input.re').forEach(n=>n.addEventListener('change',e=>takeFile(e.target.files[0])));
  side.querySelectorAll('input.cartelIn').forEach(n=>n.addEventListener('change',e=>{readCartel(e.target.files[0]);e.target.value=''}));
  const cn=$('#cancel');if(cn)cn.onclick=()=>{cancelRun();resetCap();renderCap()};
  const nf=$('#nf');if(nf)nf.addEventListener('submit',e=>{e.preventDefault();const v=$('#nq').value.trim();if(!v){$('#nq').focus();return}searchByName(v)});
  const lt=$('#later');if(lt)lt.onclick=savePending;
  const cr=$('#crop');if(cr)cr.onclick=async()=>{const b=await openCropper(S.photo?S.photo.blob:S.cartel);if(!b)return;if(S.photo){URL.revokeObjectURL(S.photo.url);S.photo={blob:b,url:URL.createObjectURL(b)}}else setCartel(b);renderCap()};
}
const MUS_RE=/mus[ée]e|museum|museo|galerie|gallery|galleria|fondation|foundation|pinacot|kunsthalle|palais|ch[âa]teau|collection|biblioth[èe]que|abbaye|hermitage|ermitage|rijks|prado|uffizi|offices|tate|moma/i;
const DEPT_RE=/^(d[ée]partement|department|cabinet|section|salle|r[ée]serve|d[ée]p[ôo]t)\b/i;
const cap1=s=>s?s[0].toUpperCase()+s.slice(1):'';
function homeName(s){const parts=String(s||'').split(/\s*[,;]\s*/).map(x=>x.trim()).filter(Boolean);if(!parts.length)return '';return cap1(parts.find(x=>MUS_RE.test(x)&&!DEPT_RE.test(x))||parts.find(x=>!DEPT_RE.test(x))||parts[0])}
function homeCityOf(s){return String(s||'').split(/\s*,\s*/).slice(1).find(x=>x&&!MUS_RE.test(x))||''}
function homeFromWD(wd){if(!wd)return '';const c=[...String(wd.collection||'').split(', '),...String(wd.lieu||'').split(', ')].filter(Boolean);return cap1(c.find(x=>MUS_RE.test(x)&&!DEPT_RE.test(x))||String(wd.lieu||'').split(', ')[0]||c[0]||'')}
function folderFor(it){const h=homeName(it.conservation),v=it.vuA||'';return cfg.rangement==='visite'?(v||h||'Lieu non précisé'):(h||v||'Lieu non précisé')}
function folderCity(it,folder){return norm(folder)===norm(it.vuA)?it.vuVille||'':it.homeVille||homeCityOf(it.conservation)||''}
function syncVu(){
  const cf=S.cf,cons=$('#cCons'),vu=$('#cVu'),vi=$('#cVille');if(!cf||!cons||!vu)return;
  const h=cons.value.trim();
  if(!cf.vuDirty)vu.value=h||cf.visitM;
  if(!cf.villeDirty)vi.value=!h||norm(h)===norm(cf.visitM)?cf.visitV:norm(h)===norm(cf.homeM)?cf.homeV:'';
  updDest();
}
function updDest(){const e=$('#cDest');if(!e)return;const f={conservation:$('#cCons').value.trim(),vuA:$('#cVu').value.trim()};const d=folderFor(f);
  e.innerHTML=`Rangée dans le dossier <b>${esc(d)}</b>${!f.conservation&&cfg.rangement!=='visite'?' (ou dans le musée de l’œuvre, s’il est trouvé dans Wikidata)':''}.`}
const enPret=f=>{const h=homeName(f.conservation);return !!(f.expo&&h&&norm(h)!==norm(f.vuA||f.musee))};
function backToForm(f){
  S.cap='confirm';renderCap();if(!f)return;
  const set=(id,v)=>{const e=$(id);if(e)e.value=v||''};
  set('#cTitre',f.titre);set('#cArt',f.artiste);set('#cDate',f.date);set('#cCons',f.conservation);set('#cVu',f.vuA);set('#cVille',f.vuVille);set('#cExpo',f.expo);
  if(S.cf){S.cf.vuDirty=true;S.cf.villeDirty=true}updDest();
}
function step(t){S.busy=t;const e=$('#fstep');if(e)e.textContent=t}
async function buildSources(qid,f,signal){
  let wd=null,wiki=null,aw=null;
  if(qid){
    step('Données Wikidata…');try{wd=await wdFull(qid)}catch(e){}
    if(wd&&wd.wiki){step('Article Wikipédia…');try{wiki=await wikiArticle(wd.wiki[0],wd.wiki[1])}catch(e){}}
    if(wd&&wd.creatorWiki){try{aw=await wikiIntro(wd.creatorWiki[0],wd.creatorWiki[1])}catch(e){}}
  }
  let fiche=null,aiErr='';
  if(hasAI()){
    step('Analyse par Gemini…');
    try{fiche=await geminiJSON({prompt:fichePrompt(f,wd,wiki),images:f.photo?[f.photo]:[],maxTokens:8192,signal})}catch(e){if(isAbort(e))throw e;aiErr=e.message}
  }
  return {wd,wiki,aw,fiche,aiErr};
}
function applySources(it,src){
  const {wd,wiki,aw,fiche}=src;
  Object.assign(it,{wd,wiki,artistWiki:aw,fiche});
  if(wd){if(!it.conservation)it.conservation=homeFromWD(wd);if(!it.artiste)it.artiste=wd.creators.join(', ');if(!it.date)it.date=wd.date;it.technique=wd.materiaux||it.technique||'';it.dimensions=wd.dimensions||it.dimensions||'';it.mouvement=wd.mouvement||it.mouvement||''}
  if(fiche){if(!it.technique&&fiche.technique)it.technique=fiche.technique;if(!it.dimensions&&fiche.dimensions)it.dimensions=fiche.dimensions;if(!it.mouvement&&fiche.mouvement)it.mouvement=fiche.mouvement}
  it.enPret=enPret(it);
}
async function create(){
  const v=id=>$(id).value.trim();
  const id0=S.ident||{};
  const co0=id0.conservation||{};const f={titre:v('#cTitre')||'Œuvre sans titre',artiste:v('#cArt'),date:v('#cDate'),conservation:v('#cCons'),vuA:v('#cVu')||'Lieu non précisé',vuVille:v('#cVille'),homeVille:co0.ville&&norm(homeName(co0.institution))===norm(v('#cCons'))?co0.ville:'',expo:v('#cExpo'),technique:id0.technique||'',dimensions:id0.dimensions||'',mouvement:id0.mouvement||'',photo:S.photo?S.photo.blob:null,cartel:S.cartel||null};
  if(!S.replace&&S.cf&&!S.cf.vuDirty&&f.expo!==vis.expo){vis.expo=f.expo;saveVis();$('#vExpo').value=f.expo}
  if(!S.replace&&S.cf&&S.cf.vuDirty)setVisit(f.vuA,f.vuVille,f.expo,vis.source==='gps'&&norm(f.vuA)===norm(vis.musee)?'gps':'manuel',norm(f.vuA)===norm(vis.musee)?vis.qid:undefined,norm(f.vuA)===norm(vis.musee)&&vis.lat!=null?{lat:vis.lat,lon:vis.lon}:null);
  const qid=S.match&&S.match.qid||'';
  S.lastForm=f;const run=newRun();S.cap='fiche';S.busy='';renderCap();
  let src;try{src=await buildSources(qid,f,CTL.signal)}catch(e){if(run===RUN)backToForm(f);return}
  if(run!==RUN)return;
  if(!src.wd&&!src.fiche&&qid){backToForm(f);toast('Impossible de récupérer la fiche (connexion ?). Réessayez, ou « Identifier plus tard ».',6000);return}
  const base=S.replace&&S.items.find(x=>x.id===S.replace);
  const it={id:base?base.id:newId(),createdAt:base?base.createdAt:Date.now(),visite:base?base.visite:today(),notes:base?base.notes:'',favori:base?base.favori:false,frame:base?base.frame||'':'',qa:[],...f,qid,pending:false,...(await measure(f.photo))};
  applySources(it,src);
  if(!it.photo){step('Image de référence…');try{Object.assign(it,await fetchRef(it),{useRef:true})}catch(e){if(S.cartel){it.photo=S.cartel;Object.assign(it,await measure(S.cartel))}}if(run!==RUN)return}
  it.musee=folderFor(it);it.ville=folderCity(it,it.musee);it.loc=base&&base.loc&&norm(base.musee)===norm(it.musee)?base.loc:locFor(it.musee);it.enPret=enPret(it);
  await save(it);
  if(src.aiErr)toast('Analyse Gemini indisponible ('+src.aiErr+') : fiche créée avec Wikipédia. « Mettre à jour » la complétera plus tard.',7000);
  resetCap();LS.set('mm.hint','');renderCap();fillLists();openFiche(it.id);
}

const backBtn=(label)=>`<button class="back" id="bk"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>${label}</span></button>`;
/* ---------- regroupements ---------- */
const thumb=it=>{const u=photoURL(it);return u?`<img src="${esc(u)}" alt="" loading="lazy">`:''};
function museums(){
  const m=new Map();
  for(const it of S.items){const k=norm(it.musee)||'_';if(!m.has(k))m.set(k,{key:k,nom:cap1(it.musee)||'Lieu non précisé',ville:it.ville||'',items:[]});const g=m.get(k);g.items.push(it);if(!g.ville&&it.ville)g.ville=it.ville}
  for(const g of m.values())g.items.sort((a,b)=>b.createdAt-a.createdAt);
  return [...m.values()].sort((a,b)=>b.items[0].createdAt-a.items[0].createdAt);
}
function ocard(it){
  return `<button class="ocard" data-o="${esc(it.id)}">${frameWrap(it,`<div class="ci" style="${ciStyle(it)}">${thumb(it)}</div>`)}<h3>${esc(it.titre)}</h3><div class="meta">${esc([it.artiste,it.date].filter(Boolean).join(', '))}</div>${it.pending?'<span class="tag l">À identifier</span> ':''}${it.favori?'<span class="tag">Coup de cœur</span> ':''}${it.enPret?'<span class="tag l">Prêt</span>':''}</button>`;
}
function bindCards(root){root.querySelectorAll('[data-o]').forEach(b=>b.onclick=()=>openFiche(b.dataset.o))}

/* ---------- vue musées ---------- */
function renderMusees(){
  const root=$('#v-musees');
  if(S.museum){
    const g=museums().find(x=>x.key===S.museum);
    if(!g){S.museum=null;return renderMusees()}
    const wc=wallOf(g),tx=inkOn(wc),mode=LS.get('mm.mview','mur');
    const groups=new Map();
    for(const it of g.items){const vu=it.vuA||it.musee,here=norm(vu)===norm(it.musee);const k=(here?'':'@'+norm(vu)+'|')+(it.expo?norm(it.expo):'');if(!groups.has(k))groups.set(k,{nom:it.expo,vu:here?'':vu,items:[],dates:new Set()});const x=groups.get(k);x.items.push(it);x.dates.add(it.visite)}
    const order=[...groups.entries()].sort((a,b)=>(a[0]===''?-1:b[0]===''?1:b[1].items[0].createdAt-a[1].items[0].createdAt));
    const gTitle=x=>x.vu?(x.nom?'Vue lors de l’exposition « '+esc(x.nom)+' » · '+esc(cap1(x.vu)):'Vue à '+esc(cap1(x.vu))):(x.nom?'Exposition « '+esc(x.nom)+' »':'Collections permanentes');
    root.innerHTML=`${backBtn('Tous les musées')}
    <div class="mhead" style="background:${wc};--wtx:${tx}"><h2>${esc(g.nom)}</h2><div class="meta">${esc(g.ville?g.ville+' · ':'')}${plural(g.items.length,'œuvre')}</div></div>
    <div class="row" style="justify-content:space-between;margin-bottom:16px"><div class="segm" id="mv"><button data-m="mur" aria-pressed="${mode==='mur'}">Mur</button><button data-m="liste" aria-pressed="${mode!=='mur'}">Liste</button></div>
    <div class="swatches" id="wsw">${WALLS.map(([c,n])=>`<button data-c="${c}" title="Mur ${esc(n)}" aria-label="Mur ${esc(n)}" style="background:${c}" aria-pressed="${c===wc}"></button>`).join('')}</div></div>`+
    order.map(([k,x])=>`<div class="room"><h3>${gTitle(x)}</h3><div class="meta">${plural(x.items.length,'œuvre')} · ${x.items.length>1?'vues':'vue'} le ${[...x.dates].filter(Boolean).sort().map(fdate).map(esc).join(', ')}</div>${mode==='mur'?wallHTML(x.items,wc):`<div class="ogrid">${x.items.map(ocard).join('')}</div>`}</div>`).join('')+
    (mode==='mur'?'<p class="wallnote">Accroché à l’échelle : le chat mesure 32 cm et chaque œuvre est centrée à 1,50 m du sol. Faites glisser le mur pour parcourir la salle ; touchez une œuvre pour ouvrir sa fiche.</p>':'');
    $('#bk').onclick=()=>{S.museum=null;renderMusees();scrollTo(0,0)};bindCards(root);
    root.querySelectorAll('#mv button').forEach(b=>b.onclick=()=>{LS.set('mm.mview',b.dataset.m);renderMusees()});
    root.querySelectorAll('#wsw button').forEach(b=>b.onclick=()=>{const w=LS.get('mm.walls',{});w[g.key]=b.dataset.c;LS.set('mm.walls',w);renderMusees()});
    if(mode==='mur')g.items.forEach(it=>{if(!it.pw&&it.photo)measure(it.photo).then(m=>{if(m.pw){upd(it.id,m);}})});
    return;
  }
  const ms=museums();
  root.innerHTML=`<div class="head"><h2>Mes musées</h2>${S.items.length?'<button class="btn small" id="rnd">Revoir une œuvre au hasard</button>':''}</div>`+
  (ms.length?`<div class="mgrid">${ms.map(g=>{const here=i=>norm(i.vuA||i.musee)===norm(i.musee);const ex=new Set(g.items.filter(i=>i.expo&&here(i)).map(i=>norm(i.expo))).size;const away=g.items.filter(i=>!here(i)).length;const p=g.items.slice(0,3);
    return `<button class="mcard" data-m="${esc(g.key)}"><div class="ph" style="background:${wallOf(g)}">${p[0]?thumb(p[0]):''}<div class="stackp">${p[1]?thumb(p[1]):''}${p[2]?thumb(p[2]):''}</div></div><div class="tx"><h3>${esc(g.nom)}</h3><div class="meta">${esc(g.ville?g.ville+' · ':'')}${plural(g.items.length,'œuvre')}${ex?' · '+plural(ex,'expo')+' temporaire'+(ex>1?'s':''):''}${away?' · '+away+' vue'+(away>1?'s':'')+' ailleurs':''}</div></div></button>`}).join('')}</div>`
  :`<div class="emptyst"><h3>Aucun musée pour l’instant</h3>Photographiez votre première œuvre : son musée apparaîtra ici.</div>`);
  root.querySelectorAll('[data-m]').forEach(b=>b.onclick=()=>{S.museum=b.dataset.m;renderMusees();scrollTo(0,0)});
  const r=$('#rnd');if(r)r.onclick=()=>openFiche(S.items[Math.floor(Math.random()*S.items.length)].id);
}

/* ---------- vue œuvres ---------- */
function renderOeuvres(){
  const root=$('#v-oeuvres');
  if(!$('#oq',root)){
    root.innerHTML=`<div class="head"><h2>Toutes mes œuvres</h2><div class="row"><input class="inp" id="oq" placeholder="Titre, artiste, musée, mot-clé…" style="width:min(340px,100%);margin:0"><button class="btn small fav" id="of" aria-pressed="false">Coups de cœur</button></div></div><div id="ol"></div>`;
    $('#oq').addEventListener('input',e=>{S.q=e.target.value;listOeuvres()});
    $('#of').onclick=()=>{S.fav=!S.fav;$('#of').setAttribute('aria-pressed',S.fav);listOeuvres()};
  }
  listOeuvres();
}
function listOeuvres(){
  const q=norm(S.q);
  const it=S.items.filter(x=>(!S.fav||x.favori)&&(!q||norm([x.titre,x.artiste,x.musee,x.ville,x.expo,x.mouvement,...((x.fiche&&x.fiche.mots_cles)||[]),...((x.wd&&x.wd.represente)||[])].join(' ')).includes(q))).sort((a,b)=>(b.pending-a.pending)||b.createdAt-a.createdAt);
  $('#ol').innerHTML=it.length?`<div class="ogrid">${it.map(ocard).join('')}</div>`:`<div class="emptyst"><h3>${S.items.length?'Rien ne correspond':'Votre carnet est vide'}</h3>${S.items.length?'Essayez un autre mot.':'Les œuvres que vous photographiez s’afficheront ici.'}</div>`;
  bindCards($('#ol'));
}

/* ---------- fiche ---------- */
function openFiche(id){S.ficheId=id;show('fiche');scrollTo(0,0)}
function ficheText(it){const f=it.fiche||{},a=f.analyse||{};const w=it.wiki;return [it.titre,[it.artiste,it.date].filter(Boolean).join(', '),it.technique,it.dimensions,'Vue à '+(it.vuA||it.musee)+(it.expo?' — exposition « '+it.expo+' »':'')+' le '+fdate(it.visite),'',f.accroche||'',f.contexte?'\nCONTEXTE\n'+f.contexte:'',f.description?'\nCE QUE L’ON VOIT\n'+f.description:'',a.composition?'\nANALYSE\n'+[a.composition,a.couleur_lumiere_matiere,a.symbolique_interpretations].filter(Boolean).join('\n'):'',f.a_regarder&&f.a_regarder.length?'\nÀ REGARDER DE PRÈS\n'+f.a_regarder.map(x=>'• '+x).join('\n'):'',!f.accroche&&w&&w.sections[0]?'\n'+w.sections[0].t:'',w?'\nSource : Wikipédia, '+w.url:'',it.notes?'\nMES NOTES\n'+it.notes:''].filter(Boolean).join('\n')}
async function copyText(t){
  try{await navigator.clipboard.writeText(t);toast('Fiche copiée')}
  catch(e){const a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();try{document.execCommand('copy');toast('Fiche copiée')}catch(x){toast('Copie impossible')}a.remove()}
}
function renderFiche(){
  const root=$('#v-fiche');const it=S.items.find(x=>x.id===S.ficheId);
  if(!it){root.innerHTML=`${backBtn('Retour')}<div class="emptyst"><h3>Fiche introuvable</h3></div>`;$('#bk').onclick=()=>show('musees');return}
  const f=it.fiche||{},a=f.analyse||{},wd=it.wd||null,w=it.wiki||null,aw=it.artistWiki||null;
  const spec=[['Technique',it.technique],['Dimensions',it.dimensions],['Mouvement',it.mouvement],['Genre',wd&&wd.genre],['Conservée à',it.conservation],['N° d’inventaire',wd&&wd.inventaire],['Représente',wd&&wd.represente&&wd.represente.join(', ')]].filter(x=>x[1]);
  const lies=(f.oeuvres_liees||[]).filter(x=>x&&x.titre).map(x=>`<li><i>${esc(x.titre)}</i>${x.artiste?', '+esc(x.artiste):''}${x.lieu?' ('+esc(x.lieu)+')':''}${x.lien?' : '+esc(x.lien):''}</li>`).join('');
  const wsecs=w?w.sections:[];const intro=wsecs[0]&&!wsecs[0].h?wsecs[0]:null;const rest=wsecs.filter(s=>s.h);
  const noAI=!f.accroche&&!f.contexte;
  root.innerHTML=`${backBtn(esc(cap1(it.musee)))}
  ${it.pending?`<div class="pend"><b>Œuvre à identifier.</b> La photo et le lieu sont gardés ; identifiez-la quand vous aurez du réseau.<button class="btn main small" id="idn">Identifier maintenant</button></div>`:''}
  <div class="fiche"><div class="left">${frameWrap(it,thumb(it)?(dimsOf(it)&&isFlat(it)?`<div class="ci bigci" style="${ciStyle(it)};--r:${ratioOf(it).toFixed(3)}">${thumb(it)}</div>`:thumb(it)):'<div class="nophoto">Pas de photo</div>','bigfr')}
    ${useRefFor(it)&&wd&&wd.image?`<p class="src" style="margin-top:8px">Image de référence · <a href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(wd.image)}" target="_blank" rel="noopener">Wikimedia Commons</a></p>`:''}
    <div class="frow"><button class="btn small" id="frBtn" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="1"/><rect x="7" y="7" width="10" height="10"/></svg>Cadre · ${esc(frameLabel(frameOf(it)))}</button>${wd&&wd.image&&it.photo?`<div class="segm sm" id="srcSeg"><button data-s="own" aria-pressed="${!useRefFor(it)}">Ma photo</button><button data-s="ref" aria-pressed="${useRefFor(it)}">Image de référence</button></div>`:''}</div>
    <div class="pick" id="fpick" hidden>${framePicker(it.frame||'',autoFrameFor(it))}</div>
    <div class="seen">Vue le <b>${esc(fdate(it.visite))}</b> à <b>${esc(cap1(it.vuA||it.musee))}</b>${(it.vuVille||it.ville)?', '+esc(it.vuVille||it.ville):''}${it.expo?`<br>Exposition temporaire « <b>${esc(it.expo)}</b> »${it.enPret&&it.conservation?' — prêt de '+esc(homeName(it.conservation)):''}`:norm(it.vuA||it.musee)===norm(it.musee)?'<br>Collections permanentes':''}${norm(it.vuA||it.musee)!==norm(it.musee)?`<br>Rangée dans <b>${esc(cap1(it.musee))}</b>`:''}</div>
    <div class="toolbar"><button class="btn small fav" id="fv" aria-pressed="${!!it.favori}">${it.favori?'Coup de cœur':'Ajouter aux coups de cœur'}</button><button class="btn small" id="cp">Copier la fiche</button>${it.photo?'<button class="btn small" id="crp">Recadrer</button>':''}${it.pending?'':'<button class="btn small" id="rg">Mettre à jour</button><button class="btn small" id="rid">Changer d’œuvre</button>'}<button class="btn small" id="dl">Supprimer</button></div>
    <details class="edit"><summary>Corriger l’œuvre ou le lieu</summary>
      <label class="f">Titre<input id="eT"></label><div class="g2"><label class="f">Artiste<input id="eA"></label><label class="f">Date<input id="eD"></label></div>
      <label class="f">Musée de l’œuvre (où elle est conservée)<input id="eC" data-sugg="musees" autocomplete="off"></label>
      <div class="g2"><label class="f">Vue à<input id="eU" data-sugg="musees" autocomplete="off"></label><label class="f">Ville<input id="eV"></label></div>
      <div class="g2"><label class="f">Exposition temporaire<input id="eX" data-sugg="expos" autocomplete="off"></label><label class="f">Date de visite<input id="eW" type="date"></label></div>
      <label class="f">Rangée dans le dossier<input id="eM" data-sugg="musees" autocomplete="off"></label>
      <button class="btn main small" id="es">Enregistrer</button></details>
  </div>
  <div><h2>${esc(it.titre)}</h2><div class="who">${esc([it.artiste,it.date].filter(Boolean).join(', '))}</div>
    ${spec.length?`<dl class="spec">${spec.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`:''}
    ${dimsOf(it)?`<div class="blk scale"><h3>À l’échelle</h3>${scaleSVG(dimsOf(it))}</div>`:''}
    ${f.accroche?`<p class="lead2">${esc(f.accroche)}</p>`:intro?`<div class="lead2 wikiintro">${paras(intro.t)}</div>`:''}
    ${f.contexte?`<div class="blk"><h3>Contexte</h3>${paras(f.contexte)}</div>`:''}
    ${f.description?`<div class="blk"><h3>Ce que l’on voit</h3>${paras(f.description)}</div>`:''}
    ${(a.composition||a.couleur_lumiere_matiere||a.symbolique_interpretations)?`<div class="blk"><h3>Analyse</h3>${a.composition?'<h4>Composition</h4>'+paras(a.composition):''}${a.couleur_lumiere_matiere?'<h4>Couleur, lumière, matière</h4>'+paras(a.couleur_lumiere_matiere):''}${a.symbolique_interpretations?'<h4>Symbolique et interprétations</h4>'+paras(a.symbolique_interpretations):''}</div>`:''}
    ${f.a_regarder&&f.a_regarder.length?`<div class="blk"><h3>À regarder de près</h3>${list(f.a_regarder)}</div>`:''}
    ${f.artiste?`<div class="blk"><h3>${esc(it.artiste||'L’artiste')}</h3>${paras(f.artiste)}</div>`:aw?`<div class="blk"><h3>${esc(it.artiste||aw.title)}</h3>${paras(aw.intro)}<p class="src">Wikipédia${aw.lang!=='fr'?' (en anglais)':''} · <a href="${esc(safeUrl(aw.url))}" target="_blank" rel="noopener">lire l’article</a></p></div>`:''}
    ${f.histoire_oeuvre?`<div class="blk"><h3>Histoire de l’œuvre</h3>${paras(f.histoire_oeuvre)}</div>`:''}
    ${f.anecdotes&&f.anecdotes.length?`<div class="blk"><h3>Anecdotes</h3>${list(f.anecdotes)}</div>`:''}
    ${f.debats?`<div class="blk"><h3>Débats et incertitudes</h3>${paras(f.debats)}</div>`:''}
    ${lies?`<div class="blk"><h3>Œuvres à rapprocher</h3><ul>${lies}</ul></div>`:''}
    ${f.aller_plus_loin&&f.aller_plus_loin.length?`<div class="blk"><h3>Pour aller plus loin</h3>${list(f.aller_plus_loin)}</div>`:''}
    ${w?`<div class="blk"><h3>${noAI?'L’œuvre en détail':'L’article Wikipédia'}</h3>${(noAI?[]:intro?[{h:'Introduction',t:intro.t}]:[]).concat(rest).map((s,i)=>`<details class="wsec"${noAI&&i<2?' open':''}><summary>${esc(s.h)}</summary>${paras(s.t)}</details>`).join('')}<p class="src">Texte : Wikipédia${w.lang!=='fr'?' (en anglais)':''}, licence CC BY-SA · <a href="${esc(safeUrl(w.url))}" target="_blank" rel="noopener">article complet</a>${it.qid?` · <a href="https://www.wikidata.org/wiki/${esc(it.qid)}" target="_blank" rel="noopener">Wikidata</a>`:''}</p></div>`:it.qid?`<p class="src">Données : <a href="https://www.wikidata.org/wiki/${esc(it.qid)}" target="_blank" rel="noopener">Wikidata</a> (pas d’article Wikipédia pour cette œuvre)</p>`:''}
    ${!w&&noAI&&!it.pending?`<div class="blk"><p class="note">Pas de texte pour cette œuvre. ${hasAI()?'« Mettre à jour » demandera une analyse à Gemini.':'Ajoutez une clé Gemini gratuite dans les Réglages pour obtenir une analyse, ou liez une fiche Wikidata avec « Changer d’œuvre ».'}</p></div>`:''}
    <div class="blk"><h3>Mes notes</h3><textarea class="inp" id="nt" placeholder="Ce qui m’a touché, avec qui j’étais, ce que je veux revoir…"></textarea></div>
    <div class="blk"><h3>Poser une question</h3>${hasAI()?`<div id="qal">${(it.qa||[]).map(x=>`<div class="qa"><div class="q">${esc(x.q)}</div><div class="a">${esc(x.a)}</div></div>`).join('')}</div>
      <form class="row" id="qf"><input class="inp" id="qi" placeholder="Pourquoi ce bleu ? Qui est le personnage à gauche ?" style="flex:1 1 240px;margin:0"><button class="btn main">Demander</button></form>`:`<div id="qal">${(it.qa||[]).map(x=>`<div class="qa"><div class="q">${esc(x.q)}</div><div class="a">${esc(x.a)}</div></div>`).join('')}</div><p class="note">Ajoutez une clé Gemini gratuite dans les Réglages pour poser des questions sur l’œuvre.</p>`}</div>
    ${f.mots_cles&&f.mots_cles.length?`<p class="note" style="margin-top:24px">${f.mots_cles.map(esc).join(' · ')}</p>`:''}
  </div></div>`;
  const cur=()=>S.items.find(x=>x.id===it.id)||it;
  $('#bk').onclick=()=>{S.museum=norm(it.musee)||'_';show('musees')};
  const big=root.querySelector('.bigfr');if(big&&(it.photo||it.refPhoto))big.onclick=()=>{const c=cur();const own={label:'Ma photo',src:photoURL(c,'own')},ref=c.wd&&c.wd.image?{label:'Image de référence',src:c.refPhoto?photoURL(c,'ref'):commonsThumb(c.wd.image,2400)}:null;const car=c.cartel&&c.cartel!==c.photo?{label:'Cartel',src:photoURL(c,'cartel')}:null;openViewer((useRefFor(c)?[ref,own]:[own,ref]).concat([car]))};
  const frB=$('#frBtn'),fp=$('#fpick');frB.onclick=()=>{fp.hidden=!fp.hidden;frB.setAttribute('aria-expanded',!fp.hidden)};
  root.querySelectorAll('#srcSeg [data-s]').forEach(b=>b.onclick=async()=>{const c=cur(),want=b.dataset.s==='ref';if(want===useRefFor(c))return;
    if(want&&!c.refPhoto){b.textContent='Téléchargement…';try{await upd(it.id,{...(await fetchRef(c)),useRef:true})}catch(e){toast(e.message,5000);renderFiche();return}}
    else await upd(it.id,{useRef:want});
    renderFiche()});
  root.querySelectorAll('#fpick [data-f]').forEach(b=>b.onclick=async()=>{await upd(it.id,{frame:b.dataset.f});renderFiche();toast('Cadre : '+frameLabel(frameOf(cur())))});
  const crp=$('#crp');if(crp)crp.onclick=async()=>{const b=await openCropper(cur().photo);if(b){await upd(it.id,{photo:b,...(await measure(b))});renderFiche();toast('Photo redressée')}};
  $('#nt').value=it.notes||'';$('#nt').addEventListener('change',e=>{upd(it.id,{notes:e.target.value});toast('Notes enregistrées')});
  $('#fv').onclick=async()=>{await upd(it.id,{favori:!cur().favori});renderFiche()};
  $('#cp').onclick=()=>copyText(ficheText(cur()));
  const reid=()=>{const c=cur();if(!c.photo){toast('Pas de photo à identifier');return}resetCap();S.replace=c.id;S.photo={blob:c.photo,url:URL.createObjectURL(c.photo)};show('capturer');scrollTo(0,0);startIdentify()};
  const idn=$('#idn');if(idn)idn.onclick=reid;const rid=$('#rid');if(rid)rid.onclick=reid;
  const E={eT:'titre',eA:'artiste',eD:'date',eC:'conservation',eU:'vuA',eV:'vuVille',eX:'expo',eW:'visite',eM:'musee'};
  const val0={...it,vuA:it.vuA||it.musee,vuVille:it.vuVille||it.ville};
  for(const k in E)$('#'+k).value=val0[E[k]]||'';
  $('#es').onclick=async()=>{const p={};for(const k in E)p[E[k]]=$('#'+k).value.trim();
    const n={...cur(),...p};if(norm(p.musee)===norm(it.musee))n.musee=folderFor(n);n.musee=n.musee||'Lieu non précisé';
    p.musee=n.musee;p.ville=folderCity(n,n.musee);p.enPret=enPret(n);if(norm(p.musee)!==norm(it.musee))p.loc=locFor(p.musee);
    await upd(it.id,p);fillLists();renderFiche();toast(norm(p.musee)!==norm(it.musee)?'Fiche rangée dans '+cap1(p.musee):'Fiche mise à jour')};
  const dl=$('#dl');let armed=false;dl.onclick=async()=>{
    if(!armed){armed=true;dl.textContent='Confirmer la suppression';dl.classList.add('danger');setTimeout(()=>{armed=false;if(dl.isConnected){dl.textContent='Supprimer';dl.classList.remove('danger')}},4000);return}
    S.items=S.items.filter(x=>x.id!==it.id);dropURLs(it.id);
    try{await DB.del(it.id)}catch(e){}
    toast('Œuvre supprimée');S.museum=norm(it.musee)||'_';show('musees');
  };
  const rg=$('#rg');if(rg)rg.onclick=async()=>{
    rg.disabled=true;const c=cur();
    S.busy='';const tick=setInterval(()=>{if(rg.isConnected)rg.textContent=S.busy||'Mise à jour…'},300);
    try{const src=await buildSources(c.qid,{...c});clearInterval(tick);
      if(!src.wd&&!src.fiche)throw new Error(src.aiErr||'Rien à mettre à jour (connexion ?).');
      const n={...c};applySources(n,src);await save(n);if(S.ficheId===c.id&&S.view==='fiche')renderFiche();toast(src.aiErr?'Wikipédia mis à jour ; Gemini : '+src.aiErr:'Fiche mise à jour',6000)}
    catch(e){clearInterval(tick);toast(e.message,6000);if(rg.isConnected){rg.disabled=false;rg.textContent='Mettre à jour'}}
  };
  const qf=$('#qf');if(qf)qf.addEventListener('submit',async e=>{
    e.preventDefault();const q=$('#qi').value.trim();if(!q)return;
    $('#qi').value='';const box=document.createElement('div');box.className='qa';box.innerHTML=`<div class="q"></div><div class="a">…</div>`;box.firstChild.textContent=q;$('#qal').appendChild(box);
    const c=cur();const prev=(c.qa||[]).slice(-3).map(x=>'Q : '+x.q+'\nR : '+x.a).join('\n');
    const prompt=`Tu es historien de l'art. Réponds en français, précisément, en 1 à 3 paragraphes sans titres ni listes, à la question d'un visiteur sur l'œuvre « ${c.titre} »${c.artiste?' de '+c.artiste:''}${c.date?' ('+c.date+')':''}, conservée par ${c.conservation||c.musee}.
${c.wiki?'Extrait de Wikipédia sur l’œuvre :\n"""'+wikiDigest(c.wiki,5000)+'"""\n':''}${f.accroche?'Résumé de sa fiche : '+f.accroche+'\n':''}${prev?'Questions déjà posées :\n'+prev+'\n':''}Si tu n'es pas sûr, dis-le. Réponds directement, sans préambule.
Question : ${q}`;
    try{const t=await gemini({prompt,images:c.photo?[c.photo]:[],maxTokens:4096,onText:txt=>{box.lastChild.textContent=txt}});box.lastChild.textContent=t;await upd(it.id,{qa:[...(cur().qa||[]),{q,a:t,t:Date.now()}]})}
    catch(er){box.lastChild.textContent=er.message}
  });
}

/* ---------- réglages & sauvegarde ---------- */
async function renderReglages(){
  const root=$('#v-reglages');
  let used='';try{const e=await navigator.storage.estimate();used=(e.usage/1048576).toFixed(1)+' Mo utilisés'}catch(e){}
  root.innerHTML=`<div class="set"><div class="head"><h2>Réglages</h2></div>
  <div class="card"><h3>Reconnaissance par Gemini (gratuit, facultatif)</h3>
    <p>Sans clé, l’app fonctionne avec Wikidata, Wikipédia et la lecture du cartel. Avec une clé Gemini <b>gratuite</b>, elle reconnaît l’œuvre sur la photo et rédige une analyse. La clé se crée en deux minutes sur <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com</a>, sans carte bancaire. Ne cliquez pas sur « Set up billing » : tant qu’aucun moyen de paiement n’est lié, rien ne peut être facturé.</p>
    <details class="howto"${cfg.gemKey?'':' open'}><summary>Comment obtenir une clé gratuite</summary>
      <ol>
        <li>Ouvrez <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">aistudio.google.com/app/apikey</a> dans le navigateur du téléphone et connectez-vous avec votre compte Google.</li>
        <li>Acceptez les conditions d’utilisation si on vous les présente.</li>
        <li>Touchez <b>Create API key</b> (Créer une clé API). Si on vous demande un projet, choisissez celui proposé par défaut.</li>
        <li>Touchez l’icône <b>Copier</b> à côté de la clé. Elle commence par <code>AQ.</code> (ou <code>AIza</code> pour les anciennes clés).</li>
        <li>Revenez ici, collez-la dans le champ ci-dessous (appui long → Coller), puis touchez <b>Vérifier la clé</b>.</li>
      </ol>
      <p><b>Pour rester à 0 €</b> : ne cliquez jamais sur « Set up billing » ou « Upgrade » et n’ajoutez aucun moyen de paiement. Quand le quota gratuit du jour est atteint, l’app vous le dit et continue sans IA ; rien n’est facturé.</p>
      <p>Ne publiez pas votre clé (dans GitHub par exemple) : elle reste sur ce téléphone. Si elle a fuité, supprimez-la dans AI Studio et créez-en une autre.</p>
    </details>
    <label class="f">Clé API Gemini<input id="sKey" type="password" autocomplete="off" placeholder="AQ.… (ou AIza…)"></label>
    <div class="row" style="margin:-4px 0 12px"><button class="btn small" id="sShow">Afficher</button><button class="btn small" id="sTest">Vérifier la clé</button>${cfg.gemKey?'<button class="btn small" id="sDel">Retirer la clé</button>':''}</div>
    <p class="note" id="sTestR"></p>
    <label class="f">Modèle<select id="sModel">${[...new Set([cfg.model,...(cfg.models||[]),...PREF].filter(Boolean))].map(v=>`<option value="${esc(v)}">${esc(v)}${PREF[0]===v?' (recommandé)':''}</option>`).join('')}</select></label>
    <p class="note">Si un modèle n’est pas gratuit ou que son quota du jour est épuisé, l’app passe automatiquement au suivant.</p>
  </div>
  <div class="card"><h3>Rangement des œuvres</h3>
    <p>Dans quel dossier de l’onglet Musées ranger chaque œuvre ? Le lieu et l’exposition où vous l’avez vue restent toujours indiqués dans sa fiche.</p>
    <div class="pick" id="rpick"><button data-r="origine" aria-pressed="${cfg.rangement!=='visite'}">Dans le musée qui conserve l’œuvre</button><button data-r="visite" aria-pressed="${cfg.rangement==='visite'}">Dans le lieu où je l’ai vue</button></div>
  </div>
  <div class="card"><h3>Cadre par défaut</h3>
    <p>« Selon l’époque » choisit le cadre d’après la date et la technique de l’œuvre. Vous pouvez aussi changer le cadre œuvre par œuvre, dans sa fiche.</p>
    <div class="pick" id="spick">${framePicker(cfg.frame==='auto'?'':cfg.frame,null,true)}</div>
  </div>
  <div class="card"><h3>Image dans le cadre</h3>
    <label class="sw"><input type="checkbox" id="sRef"><div><b>Afficher l’image de référence quand elle existe</b><span>Pour les œuvres reliées à Wikidata, l’image de Wikimedia Commons remplace votre photo dans les cadres, le mur et les listes (elle est téléchargée une fois puis gardée sur l’appareil). Votre photo reste disponible, et chaque fiche a son propre choix.</span></div></label>
  </div>
  <div class="card"><h3>Localisation</h3>
    <label class="sw"><input type="checkbox" id="sLoc"><div><b>Détecter automatiquement le musée</b><span>À l’ouverture de l’app (et au retour après 20 min), votre position est comparée aux musées d’OpenStreetMap. Vous pouvez toujours saisir ou corriger le lieu à la main.</span></div></label>
  </div>
  <div class="card"><h3>Mes données</h3>
    <p>${plural(S.items.length,'œuvre')} enregistrée${S.items.length>1?'s':''} sur cet appareil${used?' · '+used:''}. Elles ne sont pas synchronisées : faites une sauvegarde de temps en temps (par exemple vers Google Drive).</p>
    <div class="row"><button class="btn" id="sExp">Exporter une sauvegarde</button><button class="btn" id="sImp">Importer une sauvegarde</button><button class="btn danger" id="sClr">Tout effacer</button></div>
  </div>
  <p class="note">MyMuseum · lieux © contributeurs OpenStreetMap · données Wikidata (CC0) · textes Wikipédia (CC BY-SA) · lecture du cartel : Tesseract</p></div>`;
  const k=$('#sKey');k.value=cfg.gemKey;
  const test=async()=>{const r=$('#sTestR');const key=k.value.trim();if(!key){r.textContent='';return}r.innerHTML='<span class="spin"></span>Vérification…';
    try{const ids=await gemListModels(key);cfg.gemKey=key;cfg.models=ids;if(!cfg.model||!ids.includes(cfg.model))cfg.model=ids[0]||PREF[0];saveCfg();
      r.innerHTML=`<span class="locok">Clé valide.</span> ${ids.length} modèle${ids.length>1?'s':''} Flash disponible${ids.length>1?'s':''}.`;
      const m=$('#sModel');m.innerHTML=[...new Set([...ids,...PREF])].map(v=>`<option value="${esc(v)}">${esc(v)}${PREF[0]===v?' (recommandé)':''}</option>`).join('');m.value=cfg.model;renderCap()}
    catch(e){r.textContent=e.message}};
  k.addEventListener('change',()=>{cfg.gemKey=k.value.trim();saveCfg();renderCap();test()});
  $('#sTest').onclick=test;
  $('#sShow').onclick=()=>{k.type=k.type==='password'?'text':'password';$('#sShow').textContent=k.type==='password'?'Afficher':'Masquer'};
  const sd=$('#sDel');if(sd)sd.onclick=()=>{cfg.gemKey='';saveCfg();renderReglages();renderCap();toast('Clé retirée : l’app fonctionne sans IA.')};
  const m=$('#sModel');m.value=cfg.model||PREF[0];m.onchange=()=>{cfg.model=m.value;saveCfg()};
  const l=$('#sLoc');l.checked=cfg.autoLoc;l.onchange=()=>{cfg.autoLoc=l.checked;saveCfg();if(l.checked)toast('La détection se fera à la prochaine ouverture, ou avec « Me localiser ».')};
  root.querySelectorAll('#rpick [data-r]').forEach(b=>b.onclick=async()=>{if(cfg.rangement===b.dataset.r)return;cfg.rangement=b.dataset.r;saveCfg();const n=await refileAll();renderReglages();toast(n?plural(n,'œuvre')+' reclassée'+(n>1?'s':''):'Rangement modifié')});
  const sr=$('#sRef');sr.checked=!!cfg.preferRef;sr.onchange=async()=>{cfg.preferRef=sr.checked;saveCfg();if(sr.checked){const todo=S.items.filter(i=>i.wd&&i.wd.image&&!i.refPhoto&&i.useRef!==false);if(todo.length){toast('Téléchargement de '+plural(todo.length,'image')+' de référence…');let ok=0;for(const i of todo){try{await upd(i.id,await fetchRef(i));ok++}catch(e){}}toast(ok+' / '+todo.length+' image'+(todo.length>1?'s':'')+' de référence téléchargée'+(ok>1?'s':''))}}};
  root.querySelectorAll('#spick [data-f]').forEach(b=>b.onclick=()=>{cfg.frame=b.dataset.f||'auto';saveCfg();renderReglages()});
  $('#sExp').onclick=exportBackup;
  $('#sImp').onclick=()=>$('#inBackup').click();
  const c=$('#sClr');let armed=false;c.onclick=async()=>{
    if(!armed){armed=true;c.textContent='Confirmer : tout effacer';setTimeout(()=>{armed=false;if(c.isConnected)c.textContent='Tout effacer'},4000);return}
    await DB.clear();S.items=[];urls.forEach(x=>URL.revokeObjectURL(x.u));urls.clear();toast('Carnet effacé');renderReglages();
  };
}
const blobToDataURL=b=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(b)});
async function exportBackup(){
  if(!S.items.length){toast('Rien à exporter pour le moment');return}
  toast('Préparation de la sauvegarde…');
  const items=[];for(const it of S.items){const o={...it};if(it.photo)o.photo=await blobToDataURL(it.photo);if(it.refPhoto)o.refPhoto=await blobToDataURL(it.refPhoto);if(it.cartel)o.cartel=await blobToDataURL(it.cartel);items.push(o)}
  const json=JSON.stringify({app:'MyMuseum',version:2,exported:new Date().toISOString(),items});
  const name='MyMuseum-sauvegarde-'+today()+'.json';
  try{
    if(isNative()&&window.Capacitor.Plugins&&window.Capacitor.Plugins.Filesystem){
      const {Filesystem,Share}=window.Capacitor.Plugins;
      const r=await Filesystem.writeFile({path:name,data:json,directory:'CACHE',encoding:'utf8'});
      await Share.share({title:'Sauvegarde MyMuseum',url:r.uri,dialogTitle:'Enregistrer la sauvegarde'});
    }else{
      const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([json],{type:'application/json'}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},2000);
      toast('Sauvegarde téléchargée');
    }
  }catch(e){if(!/cancel/i.test(e&&e.message||''))toast('Export impossible : '+(e&&e.message||e))}
}
$('#inBackup').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    if(!data||data.app!=='MyMuseum'||!Array.isArray(data.items))throw new Error('ce fichier n’est pas une sauvegarde MyMuseum');
    let n=0;
    for(const o of data.items){if(!o||!o.id)continue;const it={...o};if(typeof o.photo==='string'&&o.photo.startsWith('data:image/'))it.photo=await (await fetch(o.photo)).blob();else delete it.photo;if(typeof o.refPhoto==='string'&&o.refPhoto.startsWith('data:image/'))it.refPhoto=await (await fetch(o.refPhoto)).blob();else delete it.refPhoto;if(typeof o.cartel==='string'&&o.cartel.startsWith('data:image/'))it.cartel=await (await fetch(o.cartel)).blob();else delete it.cartel;await DB.put(it);n++}
    S.items=(await DB.all()).sort((a,b)=>b.createdAt-a.createdAt);fillLists();
    toast(plural(n,'œuvre')+' importée'+(n>1?'s':''));if(S.view==='reglages')renderReglages();
  }catch(er){toast('Import impossible : '+er.message,6000)}
});

/* ---------- cadres ---------- */
const FRAMES=[['dore','Doré'],['baroque','Baroque'],['noir','Baguette noire'],['bois','Bois clair'],['fin','Cadre fin'],['nu','Sans cadre']];
const FR_KEYS=FRAMES.map(f=>f[0]);
const frameLabel=k=>(FRAMES.find(f=>f[0]===k)||['',''])[1];
function romanInt(r){const v={I:1,V:5,X:10,L:50,C:100,D:500,M:1000};let n=0;for(let i=0;i<r.length;i++){const a=v[r[i]],b=v[r[i+1]]||0;n+=a<b?-a:a}return n}
function yearOf(it){
  const s=String((it.wd&&it.wd.date)||it.date||'');if(!s)return null;
  const bc=/av\.?\s*J\.?\s*-?\s*C|\bBC\b|avant notre [èe]re|av\. n\. [èe]/i.test(s);
  let m=s.match(/(?:^|[^\d])(\d{3,4})(?!\d)/);if(m)return bc?-+m[1]:+m[1];
  m=s.match(/\b([IVXLC]+)(?:e|er|ème)\s+si[eè]cle/);if(m){const c=romanInt(m[1]);if(c)return bc?-(c*100-50):(c-1)*100+50}
  m=s.match(/\b(\d{1,2})(?:e|er|ème)\s*si[eè]cle/i);if(m){const c=+m[1];return bc?-(c*100-50):(c-1)*100+50}
  m=s.match(/\b(\d{1,3})\b/);if(m&&bc)return -+m[1];
  return null;
}
function autoFrameFor(it){
  const t=norm([it.technique,it.mouvement,it.wd&&it.wd.genre,it.wd&&it.wd.desc,it.wd&&it.wd.materiaux].join(' '));
  if(/sculpt|statue|buste|marbre|bronze|ceramique|terre cuite|porcelaine|vase|bijou|mobilier|objet|relief|installation|video|tapisserie|armure/.test(t))return 'nu';
  if(/photograph|dessin|estampe|gravure|aquarelle|pastel|fusain|lithograph|sanguine|papier|affiche|enluminure/.test(t))return 'fin';
  const y=yearOf(it);if(y==null)return 'dore';
  if(y<1250)return 'nu';if(y<1600)return 'dore';if(y<1790)return 'baroque';if(y<1860)return 'dore';if(y<1920)return 'bois';if(y<1960)return 'fin';return 'noir';
}
const defaultFrameFor=it=>FR_KEYS.includes(cfg.frame)?cfg.frame:autoFrameFor(it);
const frameOf=it=>FR_KEYS.includes(it.frame)?it.frame:defaultFrameFor(it);
function setFrameClass(el,f){if(el)el.className=el.className.replace(/\bf-\w+/g,'').replace(/\s+/g,' ').trim()+' f-'+f}
function frameWrap(it,inner,cls='',style=''){return `<div class="fr f-${frameOf(it)} ${cls}"${style?` style="${style}"`:''}><div class="fi">${inner}</div></div>`}
function framePicker(cur,defF,isSettings){
  const def=isSettings?'dore':FR_KEYS.includes(cfg.frame)?cfg.frame:defF;
  const first=isSettings?'Selon l’époque':(cfg.frame==='auto'?'Selon l’époque':'Par défaut')+' · '+frameLabel(def);
  return [['',first],...FRAMES].map(([k,l])=>`<button data-f="${k}" aria-pressed="${cur===k}"><span class="fr mini f-${k||def}"><span class="fi"><i></i></span></span>${esc(l)}</button>`).join('');
}

/* ---------- murs, dimensions, échelle ---------- */
const WALLS=[['#5c1825','Bordeaux'],['#8e2f24','Rouge pompéien'],['#56634f','Vert-de-gris'],['#1f2c45','Bleu nuit'],['#4b4f55','Ardoise'],['#b48448','Ocre'],['#ecebe6','Blanc galerie']];
function wallOf(g){
  const w=LS.get('mm.walls',{})[g.key];if(w&&/^#[0-9a-f]{6}$/i.test(w))return w;
  const n=norm(g.nom);
  if(/orangerie|pompidou|moderne|contemporain|tate|moma|fondation|palais de tokyo|guggenheim|beaubourg|mac /.test(n))return '#ecebe6';
  if(/orsay|rodin|marmottan|jacquemart/.test(n))return '#56634f';
  return '#5c1825';
}
function inkOn(hex){const n=parseInt(hex.slice(1),16);return (0.299*(n>>16&255)+0.587*(n>>8&255)+0.114*(n&255))>160?'#1b1719':'#f7ede7'}
function dimsOf(it){
  const w=it.wd;if(w&&w.hcm>0&&w.wcm>0)return {h:w.hcm,w:w.wcm};
  const m=String(it.dimensions||'').replace(/(\d),(\d)/g,'$1.$2').match(/(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)\s*(cm|mm|m)\b/i);
  if(!m)return null;const u=m[3].toLowerCase(),k=u==='m'?100:u==='mm'?.1:1;const h=+m[1]*k,ww=+m[2]*k;
  return h>0&&ww>0&&h<5000&&ww<5000?{h,w:ww}:null;
}
async function measure(b){if(!b)return {};try{const bm=await createImageBitmap(b);const r={pw:bm.width,ph:bm.height};if(bm.close)bm.close();return r}catch(e){return {}}}
function locFor(name){
  if(norm(name)===norm(vis.musee)&&vis.lat!=null)return {lat:vis.lat,lon:vis.lon};
  const c=LS.get('mm.coords',{})[norm(name)||'_'];return c||null;
}
const CAT='<path d="M52 4 59 17Q66 15 73 17L80 6C84 14 85 24 83 32 81 40 77 45 72 48 77 52 80 58 80 66 80 80 78 96 79 108 80 113 84 116 85 119 85 121 83 122 80 122H70C69 119 68 116 66 116 65 118 64 121 62 122H34C24 122 17 116 16 104 15 88 22 72 34 62 40 57 46 52 50 47 47 43 46 37 47 31 48 22 50 12 52 4Z"/><path d="M30 121C18 122 8 117 6 107 5 99 8 92 13 91 16 91 17 95 13 97 10 100 11 107 16 111 21 114 27 115 33 115Z"/>';
const isFlat=it=>autoFrameFor(it)!=='nu';
function ratioOf(it){const d=dimsOf(it);if(d&&isFlat(it))return d.w/d.h;const m=dispDims(it);return m.pw&&m.ph?m.pw/m.ph:.8}
const ciStyle=it=>`aspect-ratio:${Math.max(.45,Math.min(2.2,ratioOf(it))).toFixed(3)}`;
const fmtN=n=>(Math.round(n*10)/10).toLocaleString('fr-FR');
function scaleSVG(d){
  const c=Math.max(150,d.h/2+15),top=c+d.h/2;
  const W=20+26+40+d.w+20,fs=Math.max(top,W)/20,H=top+20+fs*2.2,floor=top+15;
  const x=20+26+40,y=floor-(c+d.h/2);
  return `<svg viewBox="0 0 ${W.toFixed(1)} ${H.toFixed(1)}" role="img" aria-label="Taille de l’œuvre à côté d’un chat de 32 cm">
  <line x1="0" y1="${floor}" x2="${W}" y2="${floor}" stroke="currentColor" stroke-opacity=".35" stroke-width="${(fs/7).toFixed(2)}"/>
  <g transform="translate(20 ${floor-32}) scale(.256)" fill="currentColor" fill-opacity=".45">${CAT}</g>
  <rect x="${x}" y="${y.toFixed(1)}" width="${d.w}" height="${d.h}" fill="var(--wall)" fill-opacity=".18" stroke="var(--brass)" stroke-width="${(fs/4).toFixed(2)}"/>
  <text x="33" y="${(floor+fs*1.6).toFixed(1)}" font-size="${fs.toFixed(1)}" text-anchor="middle" fill="currentColor" fill-opacity=".7">chat · 32 cm</text>
  <text x="${(x+d.w/2).toFixed(1)}" y="${(floor+fs*1.6).toFixed(1)}" font-size="${fs.toFixed(1)}" text-anchor="middle" fill="currentColor">${fmtN(d.h)} × ${fmtN(d.w)} cm</text></svg>`;
}
function wallHTML(items,wc){
  const ink=inkOn(wc);
  const d=items.map(it=>{const dd=dimsOf(it),dm=dispDims(it),r=dm.pw&&dm.ph?dm.pw/dm.ph:.8;let h,w;if(dd){h=dd.h;w=dd.w}else if(r>=1){w=70;h=70/r}else{h=70;w=70*r}return {it,h,w,est:!dd,c:Math.max(150,h/2+15)}});
  const top=Math.max(190,...d.map(x=>x.c+x.h/2));
  const avail=Math.max(230,Math.min(380,(innerHeight||800)*.36));
  const s=Math.min(2.6,avail/top);
  const person=`<svg class="person" viewBox="0 0 100 125" width="${(25.6*s).toFixed(1)}" height="${(32*s).toFixed(1)}" fill="${ink}" aria-hidden="true">${CAT}</svg>`;
  const works=d.map(x=>{const wp=x.w*s,hp=x.h*s,u=Math.max(.16,Math.min(.85,Math.min(wp,hp)/300)),bottom=(x.c-x.h/2)*s;
    const fw=wp+2*Math.round(30*u),below=bottom>=96,cw=below?Math.round(Math.max(130,Math.min(210,fw))):128,mr=below?Math.max(44,cw-fw+36):cw+30;
    const it=x.it,info=[it.technique,dimsOf(it)?fmtN(x.h)+' × '+fmtN(x.w)+' cm':''].filter(Boolean).join(' · ');
    const img=thumb(it).replace('<img ',`<img style="width:${wp.toFixed(1)}px;height:${hp.toFixed(1)}px" `)||`<div style="width:${wp.toFixed(1)}px;height:${hp.toFixed(1)}px;background:#2a2326"></div>`;
    return `<button class="hang" data-o="${esc(it.id)}" style="margin-bottom:${bottom.toFixed(1)}px;margin-right:${Math.round(mr)}px">${frameWrap(it,img,'',`--u:${u.toFixed(2)}`)}<span class="cartel2 ${below?'b':'r'}" style="width:${cw}px"><b>${esc(it.artiste||'Artiste inconnu')}</b><span class="t"><i>${esc(it.titre)}</i>${it.date?', '+esc(it.date):''}</span>${info?`<small>${esc(info)}</small>`:''}${x.est?'<em>taille estimée</em>':''}</span></button>`}).join('');
  return `<div class="wallsc" style="--wc:${wc}"><div class="wallin">${person}${works}</div></div>`;
}

/* ---------- surcouches : historique (bouton retour d'Android) ---------- */
function openOverlay(el){el.hidden=false;document.body.style.overflow='hidden';try{history.pushState({ov:el.id},'')}catch(e){}}
function closeOverlays(){
  const v=$('#viewer'),c=$('#cropper');let any=false;
  if(!v.hidden){v.hidden=true;$('#vImg').removeAttribute('src');any=true}
  if(!c.hidden){c.hidden=true;any=true;if(C.url)URL.revokeObjectURL(C.url);const r=C.res;const out=C.out;C.res=null;C.img=null;C.out=null;if(r)r(out)}
  if(any)document.body.style.overflow='';
}
const backOrClose=()=>{if(history.state&&history.state.ov)history.back();else closeOverlays()};
addEventListener('popstate',closeOverlays);
addEventListener('keydown',e=>{if(e.key==='Escape'&&(!$('#viewer').hidden||!$('#cropper').hidden))backOrClose()});

/* ---------- visionneuse plein écran (zoom) ---------- */
const VW={s:1,x:0,y:0,w:0,h:0,pts:new Map(),tap:0,moved:false,downT:0};
function openViewer(srcs){
  srcs=srcs.filter(x=>x&&x.src);if(!srcs.length)return;
  const seg=$('#vSeg');
  seg.innerHTML=srcs.length>1?srcs.map((x,i)=>`<button data-i="${i}" aria-pressed="${i===0}">${esc(x.label)}</button>`).join(''):'';
  seg.querySelectorAll('button').forEach(b=>b.onclick=()=>{seg.querySelectorAll('button').forEach(z=>z.setAttribute('aria-pressed',z===b));vLoad(srcs[+b.dataset.i].src)});
  openOverlay($('#viewer'));vLoad(srcs[0].src);
}
function vLoad(src){const img=$('#vImg');img.style.visibility='hidden';img.onload=vFit;img.onerror=()=>toast('Image indisponible (connexion ?)');img.src=src}
function vFit(){
  const img=$('#vImg'),st=$('#vStage').getBoundingClientRect();if(!img.naturalWidth)return;
  const k=Math.min(st.width/img.naturalWidth,st.height/img.naturalHeight);
  VW.w=img.naturalWidth*k;VW.h=img.naturalHeight*k;
  Object.assign(img.style,{width:VW.w+'px',height:VW.h+'px',position:'absolute',left:'0',top:'0',maxWidth:'none',maxHeight:'none'});
  VW.s=1;vApply();img.style.visibility='visible';
}
function vApply(){
  const st=$('#vStage').getBoundingClientRect(),W=VW.w*VW.s,H=VW.h*VW.s;
  VW.x=W<=st.width?(st.width-W)/2:Math.min(0,Math.max(st.width-W,VW.x));
  VW.y=H<=st.height?(st.height-H)/2:Math.min(0,Math.max(st.height-H,VW.y));
  $('#vImg').style.transform=`translate(${VW.x}px,${VW.y}px) scale(${VW.s})`;
}
function vZoom(px,py,k){const ns=Math.min(6,Math.max(1,VW.s*k));k=ns/VW.s;VW.x=px-(px-VW.x)*k;VW.y=py-(py-VW.y)*k;VW.s=ns;vApply()}
{
  const st=$('#vStage');
  st.addEventListener('pointerdown',e=>{try{st.setPointerCapture(e.pointerId)}catch(x){}VW.pts.set(e.pointerId,{x:e.clientX,y:e.clientY});VW.moved=false;VW.downT=Date.now()});
  st.addEventListener('pointermove',e=>{
    if(!VW.pts.has(e.pointerId))return;const r=st.getBoundingClientRect();
    const prev=[...VW.pts.values()];const before=prev.length===2?{d:Math.hypot(prev[0].x-prev[1].x,prev[0].y-prev[1].y),mx:(prev[0].x+prev[1].x)/2,my:(prev[0].y+prev[1].y)/2}:null;
    const p=VW.pts.get(e.pointerId),dx=e.clientX-p.x,dy=e.clientY-p.y;if(Math.abs(dx)+Math.abs(dy)>3)VW.moved=true;
    VW.pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(VW.pts.size===2&&before&&before.d>0){const n=[...VW.pts.values()],d=Math.hypot(n[0].x-n[1].x,n[0].y-n[1].y),mx=(n[0].x+n[1].x)/2,my=(n[0].y+n[1].y)/2;VW.x+=mx-before.mx;VW.y+=my-before.my;vZoom(mx-r.left,my-r.top,d/before.d)}
    else if(VW.pts.size===1&&VW.s>1){VW.x+=dx;VW.y+=dy;vApply()}
  });
  const up=e=>{
    if(!VW.pts.has(e.pointerId))return;VW.pts.delete(e.pointerId);
    if(!VW.moved&&VW.pts.size===0&&Date.now()-VW.downT<300){const now=Date.now();
      if(now-VW.tap<320){const r=st.getBoundingClientRect();if(VW.s>1.05){VW.s=1;vApply()}else vZoom(e.clientX-r.left,e.clientY-r.top,2.5);VW.tap=0}else VW.tap=now}
  };
  st.addEventListener('pointerup',up);st.addEventListener('pointercancel',up);
  st.addEventListener('wheel',e=>{e.preventDefault();const r=st.getBoundingClientRect();vZoom(e.clientX-r.left,e.clientY-r.top,Math.exp(-e.deltaY*.0015))},{passive:false});
  $('#vClose').onclick=backOrClose;
  addEventListener('resize',()=>{if(!$('#viewer').hidden)vFit();if(!$('#cropper').hidden)cLayout()});
}

/* ---------- recadrage en perspective ---------- */
const C={img:null,url:'',q:null,drag:-1,res:null,out:null,ds:1,k:1};
function openCropper(blob){
  return new Promise(async res=>{
    if(!blob)return res(null);
    const url=URL.createObjectURL(blob);
    const img=await new Promise(ok=>{const i=new Image();i.onload=()=>ok(i);i.onerror=()=>ok(null);i.src=url});
    if(!img){URL.revokeObjectURL(url);return res(null)}
    const W=img.naturalWidth,H=img.naturalHeight,m=.06;
    Object.assign(C,{img,url,res,out:null,drag:-1,q:[[W*m,H*m],[W*(1-m),H*m],[W*(1-m),H*(1-m)],[W*m,H*(1-m)]]});
    $('#cOk').disabled=false;$('#cOk').textContent='Redresser';
    openOverlay($('#cropper'));requestAnimationFrame(cLayout);
  });
}
function cLayout(){
  const img=C.img;if(!img)return;const r=$('#cStage').getBoundingClientRect(),can=$('#cCan'),dpr=devicePixelRatio||1;
  const ds=Math.max(.01,Math.min((r.width-28)/img.naturalWidth,(r.height-28)/img.naturalHeight));C.ds=ds;C.k=ds*dpr;
  can.style.width=img.naturalWidth*ds+'px';can.style.height=img.naturalHeight*ds+'px';
  can.width=Math.round(img.naturalWidth*ds*dpr);can.height=Math.round(img.naturalHeight*ds*dpr);cDraw();
}
function cDraw(){
  const can=$('#cCan'),x=can.getContext('2d'),k=C.k,q=C.q,dpr=devicePixelRatio||1;if(!C.img)return;
  x.clearRect(0,0,can.width,can.height);x.drawImage(C.img,0,0,can.width,can.height);
  x.beginPath();x.rect(0,0,can.width,can.height);x.moveTo(q[0][0]*k,q[0][1]*k);for(let i=1;i<4;i++)x.lineTo(q[i][0]*k,q[i][1]*k);x.closePath();x.fillStyle='rgba(0,0,0,.55)';x.fill('evenodd');
  x.lineWidth=2*dpr;x.strokeStyle='#e8c77e';x.beginPath();q.forEach((p,i)=>i?x.lineTo(p[0]*k,p[1]*k):x.moveTo(p[0]*k,p[1]*k));x.closePath();x.stroke();
  q.forEach((p,i)=>{x.beginPath();x.arc(p[0]*k,p[1]*k,13*dpr,0,7);x.fillStyle=i===C.drag?'#e8c77e':'rgba(232,199,126,.35)';x.fill();x.stroke()});
  if(C.drag>=0){
    const p=q[C.drag],L=58*dpr,Z=3,lx=p[0]*k<can.width/2?can.width-L-8*dpr:L+8*dpr,ly=p[1]*k<can.height/2?can.height-L-8*dpr:L+8*dpr,sz=2*L/(k*Z);
    x.save();x.beginPath();x.arc(lx,ly,L,0,7);x.clip();x.fillStyle='#000';x.fillRect(lx-L,ly-L,2*L,2*L);
    x.drawImage(C.img,p[0]-sz/2,p[1]-sz/2,sz,sz,lx-L,ly-L,2*L,2*L);
    x.strokeStyle='#e8c77e';x.lineWidth=1.5*dpr;x.beginPath();x.moveTo(lx-14*dpr,ly);x.lineTo(lx+14*dpr,ly);x.moveTo(lx,ly-14*dpr);x.lineTo(lx,ly+14*dpr);x.stroke();x.restore();
    x.beginPath();x.arc(lx,ly,L,0,7);x.lineWidth=3*dpr;x.strokeStyle='#e8c77e';x.stroke();
  }
}
{
  const can=$('#cCan');
  const pos=e=>{const r=can.getBoundingClientRect();return [(e.clientX-r.left)/C.ds,(e.clientY-r.top)/C.ds]};
  can.addEventListener('pointerdown',e=>{if(!C.img)return;const [px,py]=pos(e);let best=-1,bd=1e9;C.q.forEach((p,i)=>{const d=Math.hypot(p[0]-px,p[1]-py)*C.ds;if(d<bd){bd=d;best=i}});
    if(bd<56){C.drag=best;C.off=[C.q[best][0]-px,C.q[best][1]-py];try{can.setPointerCapture(e.pointerId)}catch(x){}cDraw()}});
  can.addEventListener('pointermove',e=>{if(C.drag<0)return;const [px,py]=pos(e);C.q[C.drag]=[Math.max(0,Math.min(C.img.naturalWidth,px+C.off[0])),Math.max(0,Math.min(C.img.naturalHeight,py+C.off[1]))];cDraw()});
  const up=()=>{if(C.drag>=0){C.drag=-1;cDraw()}};can.addEventListener('pointerup',up);can.addEventListener('pointercancel',up);
  $('#cCancel').onclick=()=>{C.out=null;backOrClose()};
  $('#cFull').onclick=()=>{const W=C.img.naturalWidth,H=C.img.naturalHeight;C.q=[[0,0],[W,0],[W,H],[0,H]];cDraw()};
  $('#cOk').onclick=async()=>{const b=$('#cOk');b.disabled=true;b.textContent='Redressement…';await new Promise(r=>setTimeout(r,30));try{C.out=await warp()}catch(e){C.out=null;toast('Recadrage impossible : '+e.message)}backOrClose()};
}
function solve8(A,b){
  const n=b.length;
  for(let i=0;i<n;i++){let p=i;for(let r=i+1;r<n;r++)if(Math.abs(A[r][i])>Math.abs(A[p][i]))p=r;[A[i],A[p]]=[A[p],A[i]];[b[i],b[p]]=[b[p],b[i]];
    if(Math.abs(A[i][i])<1e-12)throw new Error('coins alignés');
    for(let r=i+1;r<n;r++){const f=A[r][i]/A[i][i];for(let c=i;c<n;c++)A[r][c]-=f*A[i][c];b[r]-=f*b[i]}}
  const x=new Array(n);for(let i=n-1;i>=0;i--){let t=b[i];for(let c=i+1;c<n;c++)t-=A[i][c]*x[c];x[i]=t/A[i][i]}return x;
}
function homog(from,to){const A=[],b=[];for(let i=0;i<4;i++){const [x,y]=from[i],[X,Y]=to[i];A.push([x,y,1,0,0,0,-X*x,-X*y]);b.push(X);A.push([0,0,0,x,y,1,-Y*x,-Y*y]);b.push(Y)}return solve8(A,b)}
async function warp(){
  const img=C.img,q=C.q,d=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
  let W=(d(q[0],q[1])+d(q[3],q[2]))/2,H=(d(q[0],q[3])+d(q[1],q[2]))/2;const k=Math.min(1,1600/Math.max(W,H));
  W=Math.max(16,Math.round(W*k));H=Math.max(16,Math.round(H*k));
  const sc=document.createElement('canvas');sc.width=img.naturalWidth;sc.height=img.naturalHeight;const sx=sc.getContext('2d');sx.drawImage(img,0,0);
  const SW=sc.width,SH=sc.height,src=sx.getImageData(0,0,SW,SH).data;
  const h=homog([[0,0],[W,0],[W,H],[0,H]],q);
  const oc=document.createElement('canvas');oc.width=W;oc.height=H;const ox=oc.getContext('2d'),out=ox.createImageData(W,H),o=out.data;
  for(let v=0;v<H;v++)for(let u=0;u<W;u++){
    const den=h[6]*u+h[7]*v+1;let x=(h[0]*u+h[1]*v+h[2])/den,y=(h[3]*u+h[4]*v+h[5])/den;
    x=x<0?0:x>SW-1.001?SW-1.001:x;y=y<0?0:y>SH-1.001?SH-1.001:y;
    const x0=x|0,y0=y|0,fx=x-x0,fy=y-y0,i00=(y0*SW+x0)*4,i01=i00+SW*4,oi=(v*W+u)*4;
    for(let c=0;c<3;c++)o[oi+c]=(src[i00+c]*(1-fx)+src[i00+4+c]*fx)*(1-fy)+(src[i01+c]*(1-fx)+src[i01+4+c]*fx)*fy;
    o[oi+3]=255;
  }
  ox.putImageData(out,0,0);return await new Promise(r=>oc.toBlob(r,'image/jpeg',.88));
}

/* ---------- explorer : carte, frise, statistiques ---------- */
let leafP=null,mapObj=null;
function loadLeaflet(){
  if(window.L&&window.L.map)return Promise.resolve(window.L);
  return leafP||(leafP=new Promise((res,rej)=>{
    const l=document.createElement('link');l.rel='stylesheet';l.href='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';document.head.appendChild(l);
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';s.onload=()=>res(window.L);s.onerror=()=>{leafP=null;s.remove();rej(new Error('Carte indisponible : une connexion internet est nécessaire.'))};document.head.appendChild(s);
  }));
}
async function museumCoords(g){
  const it=g.items.find(i=>i.loc&&i.loc.lat!=null);if(it)return it.loc;
  const cache=LS.get('mm.coords',{});if(cache[g.key])return cache[g.key];
  try{const q=await museumQid(g.nom);if(!q)return null;const e=(await wdEntities([q],'claims'))[q];const c=cl(e,'P625')[0];
    if(c){const v={lat:c.latitude,lon:c.longitude};cache[g.key]=v;LS.set('mm.coords',cache);return v}}catch(e){}
  return null;
}
function centuryOf(y){return y<=0?-(Math.ceil(-y/100)||1):Math.ceil(y/100)||1}
function centuryLabel(c){const a=Math.abs(c);return roman(a)+(a===1?'er':'e')+' siècle'+(c<0?' av. J.-C.':'')}
function renderExplorer(){
  const root=$('#v-explorer');const tab=LS.get('mm.exp','carte');
  if(mapObj){try{mapObj.remove()}catch(e){}mapObj=null}
  root.innerHTML=`<div class="head"><h2>Explorer</h2><div class="segm" id="exs">${[['carte','Carte'],['frise','Frise'],['stats','Statistiques']].map(([k,l])=>`<button data-t="${k}" aria-pressed="${tab===k}">${l}</button>`).join('')}</div></div><div id="exb"></div>`;
  root.querySelectorAll('#exs button').forEach(b=>b.onclick=()=>{LS.set('mm.exp',b.dataset.t);renderExplorer()});
  if(!S.items.length){$('#exb').innerHTML='<div class="emptyst"><h3>Rien à explorer pour l’instant</h3>Vos musées, votre frise et vos statistiques apparaîtront ici dès la première œuvre.</div>';return}
  if(tab==='frise')renderFrise();else if(tab==='stats')renderStats();else renderMap();
}
async function renderMap(){
  const b=$('#exb');b.innerHTML='<div id="map"></div><p class="note" id="mapnote"><span class="spin"></span>Chargement de la carte…</p>';
  let L;try{L=await loadLeaflet()}catch(e){const n=$('#mapnote');if(n)n.textContent=e.message;return}
  const el=$('#map');if(!el||S.view!=='explorer')return;
  mapObj=L.map(el).setView([46.6,2.4],5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(mapObj);
  setTimeout(()=>mapObj&&mapObj.invalidateSize(),120);
  const map=mapObj,pts=[],miss=[];
  for(const g of museums()){
    const c=await museumCoords(g);if(mapObj!==map)return;
    if(!c){miss.push(g.nom);continue}
    const box=document.createElement('div'),t=document.createElement('b'),p=document.createElement('div'),bt=document.createElement('button');
    t.textContent=g.nom;p.textContent=plural(g.items.length,'œuvre')+(g.ville?' · '+g.ville:'');bt.textContent='Voir le musée';bt.onclick=()=>{S.museum=g.key;show('musees');scrollTo(0,0)};box.append(t,p,bt);
    L.circleMarker([c.lat,c.lon],{radius:Math.min(16,7+Math.sqrt(g.items.length)*2),color:'#fff',weight:2,fillColor:'#5c1825',fillOpacity:.92}).addTo(map).bindPopup(box);
    pts.push([c.lat,c.lon]);
  }
  if(pts.length===1)map.setView(pts[0],14);else if(pts.length)map.fitBounds(pts,{padding:[40,40],maxZoom:14});
  const n=$('#mapnote');if(n)n.textContent=(pts.length?plural(pts.length,'musée')+' sur la carte.':'Aucun musée localisé.')+(miss.length?' Position introuvable pour : '+miss.join(', ')+'.':'');
}
function tlRow(it){return `<button class="tlrow" data-o="${esc(it.id)}">${frameWrap(it,`<div class="ci" style="${ciStyle(it)}">${thumb(it)}</div>`)}<span><b>${esc(it.titre)}</b><small>${esc([it.artiste,it.musee].filter(Boolean).join(' · '))}</small>${it.date||(it.wd&&it.wd.date)?`<small class="yr">${esc(it.date||it.wd.date)}</small>`:''}</span></button>`}
function renderFrise(){
  const rows=S.items.map(it=>({it,y:yearOf(it)}));
  const dated=rows.filter(r=>r.y!=null).sort((a,b)=>a.y-b.y),und=rows.filter(r=>r.y==null);
  let html='<div class="tl">',cur=null;
  for(const r of dated){const c=centuryOf(r.y);if(c!==cur){html+=`<h3>${centuryLabel(c)}</h3>`;cur=c}html+=tlRow(r.it)}
  if(und.length)html+='<h3>Sans date</h3>'+und.map(r=>tlRow(r.it)).join('');
  $('#exb').innerHTML=html+'</div>';bindCards($('#exb'));
}
function tally(arr){const m=new Map();for(const k of arr){if(!k)continue;m.set(k,(m.get(k)||0)+1)}return [...m.entries()].sort((a,b)=>b[1]-a[1])}
function bars(list,max=8){const top=list.slice(0,max),mx=top[0]?top[0][1]:1;return `<div class="bars">${top.map(([k,n])=>`<div class="brow"><span class="bl" title="${esc(k)}">${esc(k)}</span><span class="bt"><i style="width:${Math.max(4,Math.round(n/mx*100))}%"></i></span><span class="bn">${n}</span></div>`).join('')}</div>`}
function renderStats(){
  const its=S.items.filter(i=>!i.pending);
  const artists=tally(its.map(i=>String(i.artiste||'').trim()).filter(a=>a&&!/^anonyme/i.test(a)));
  const movs=tally(its.flatMap(i=>String(i.mouvement||'').split(/,\s*/).map(x=>x.trim())));
  const cm=new Map();for(const i of its){const y=yearOf(i);if(y==null)continue;const c=centuryOf(y);cm.set(c,(cm.get(c)||0)+1)}
  const cents=[...cm.entries()].sort((a,b)=>a[0]-b[0]).map(([c,n])=>[centuryLabel(c),n]);
  const mus=tally(S.items.map(i=>i.musee));
  const days=new Set(S.items.map(i=>i.visite)).size,fav=S.items.filter(i=>i.favori).length;
  const card=(n,a,b)=>`<div class="stat"><b>${n}</b><span>${n>1?b:a}</span></div>`;
  $('#exb').innerHTML=`<div class="stats">${card(S.items.length,'œuvre','œuvres')}${card(mus.length,'musée','musées')}${card(artists.length,'artiste','artistes')}${card(fav,'coup de cœur','coups de cœur')}${card(days,'jour de visite','jours de visite')}</div>
  ${artists.length?`<div class="blk"><h3>Vos artistes</h3>${bars(artists)}</div>`:''}
  ${movs.length?`<div class="blk"><h3>Mouvements et écoles</h3>${bars(movs)}</div>`:''}
  ${cents.length?`<div class="blk"><h3>Par siècle</h3>${bars(cents,40)}</div>`:''}
  <div class="blk"><h3>Par musée</h3>${bars(mus)}</div>`;
}

async function refileAll(){
  let n=0;
  for(const it of [...S.items]){if(it.pending)continue;const m=folderFor(it);if(norm(m)!==norm(it.musee)){n++;await save({...it,musee:m,ville:folderCity(it,m),loc:locFor(m),enPret:enPret(it)})}}
  fillLists();return n;
}
async function migrate(){
  if(LS.get('mm.mig1',false))return;
  for(const it of [...S.items]){if(it.vuA)continue;const n={...it,vuA:it.musee,vuVille:it.ville};
    if(!it.pending){if(n.wd&&(!n.conservation||DEPT_RE.test(n.conservation)))n.conservation=homeFromWD(n.wd)||n.conservation;const m=folderFor(n);if(norm(m)!==norm(n.musee)){n.musee=m;n.ville=folderCity(n,m);n.loc=locFor(m)}n.enPret=enPret(n)}
    await save(n)}
  LS.set('mm.mig1',true);
}
/* ---------- navigation ---------- */
const SUGG={musees:[],expos:[]};
function uniq(a){const seen=new Set(),out=[];for(const x of a){const v=cap1(String(x||'').trim()),k=norm(v);if(!v||!k||k==='lieu non precise'||seen.has(k))continue;seen.add(k);out.push(v)}return out}
function fillLists(){
  const its=[...S.items].sort((a,b)=>b.createdAt-a.createdAt);
  SUGG.musees=uniq([...nearby.map(n=>n.name),vis.musee,...its.flatMap(i=>[i.musee,i.vuA,homeName(i.conservation)])]);
  SUGG.expos=uniq([vis.expo,...its.map(i=>i.expo)]);
}
/* menu de suggestions (remplace les listes natives, illisibles sur Android) */
const SG={el:null,inp:null,list:[],i:-1,busy:false};
function sgClose(){if(SG.el)SG.el.hidden=true;SG.inp=null;SG.i=-1}
function sgPlace(){if(!SG.inp||SG.el.hidden)return;const r=SG.inp.getBoundingClientRect();Object.assign(SG.el.style,{left:(r.left+scrollX)+'px',top:(r.bottom+scrollY+4)+'px',width:r.width+'px'})}
function sgOpen(inp){
  if(!SG.el){SG.el=document.createElement('div');SG.el.className='sugg';SG.el.setAttribute('role','listbox');SG.el.hidden=true;document.body.appendChild(SG.el)}
  SG.inp=inp;const q=norm(inp.value),src=SUGG[inp.dataset.sugg]||[];
  SG.list=src.filter(v=>!q||norm(v).includes(q)).filter(v=>norm(v)!==q).slice(0,8);SG.i=-1;
  if(!SG.list.length){SG.el.hidden=true;return}
  SG.el.innerHTML=SG.list.map((v,i)=>`<button type="button" role="option" data-i="${i}">${esc(v)}</button>`).join('');
  SG.el.querySelectorAll('button').forEach(b=>{b.addEventListener('mousedown',e=>e.preventDefault());b.addEventListener('pointerdown',e=>e.preventDefault());b.onclick=()=>sgPick(+b.dataset.i)});
  SG.el.hidden=false;sgPlace();
}
function sgPick(i){const inp=SG.inp,v=SG.list[i];if(!inp||v==null)return;inp.value=v;SG.busy=true;inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));SG.busy=false;sgClose()}
document.addEventListener('focusin',e=>{const t=e.target;if(t&&t.matches&&t.matches('input[data-sugg]'))sgOpen(t);else if(SG.inp&&t!==SG.inp)sgClose()});
document.addEventListener('input',e=>{if(!SG.busy&&e.target&&e.target.matches&&e.target.matches('input[data-sugg]'))sgOpen(e.target)});
document.addEventListener('focusout',e=>{if(e.target===SG.inp)setTimeout(()=>{if(document.activeElement!==SG.inp)sgClose()},180)});
document.addEventListener('keydown',e=>{
  if(!SG.inp||e.target!==SG.inp||!SG.el||SG.el.hidden)return;
  const n=SG.list.length;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();SG.i=(SG.i+(e.key==='ArrowDown'?1:-1)+n)%n;SG.el.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-selected',i===SG.i))}
  else if(e.key==='Enter'&&SG.i>=0){e.preventDefault();sgPick(SG.i)}
  else if(e.key==='Escape')sgClose();
});
addEventListener('resize',sgPlace);addEventListener('scroll',sgPlace,{passive:true});
const TABS=['capturer','musees','oeuvres','explorer','reglages'];
function show(v){
  S.view=v;
  document.querySelectorAll('.view').forEach(s=>s.hidden=s.id!=='v-'+v);
  document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-current',b.dataset.v===v||(v==='fiche'&&b.dataset.v==='musees')));
  if(TABS.includes(v)&&location.hash!=='#'+v)history.replaceState(null,'','#'+v);
  if(v==='musees')renderMusees();else if(v==='oeuvres')renderOeuvres();else if(v==='explorer')renderExplorer();else if(v==='fiche')renderFiche();else if(v==='reglages')renderReglages();else if(S.cap==='idle')renderCap();
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{if(b.dataset.v==='musees')S.museum=null;show(b.dataset.v);scrollTo(0,0)});
addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(TABS.includes(h)&&h!==S.view)show(h)});

/* ---------- démarrage ---------- */
(async()=>{
  renderCap();
  {const h=location.hash.slice(1);show(TABS.includes(h)?h:'capturer')}
  try{S.items=(await DB.all()).sort((a,b)=>b.createdAt-a.createdAt);await migrate();S.items.sort((a,b)=>b.createdAt-a.createdAt)}catch(e){toast('Stockage local indisponible : '+(e&&e.message||e),8000)}
  fillLists();show(S.view);
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  if(cfg.autoLoc){const manualRecent=vis.source==='manuel'&&Date.now()-vis.ts<4*36e5;if(!manualRecent||!vis.musee)detect(true);else $('#locStatus').textContent='Lieu saisi à la main. Touchez « Me localiser » pour le détecter.'}
  if('serviceWorker' in navigator&&!isNative()&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
}
