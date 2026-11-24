/* MyMuseum — carnet de visite de musée.
   Photo → reconnaissance par Claude → fiche → rangement par musée / exposition.
   Données stockées sur l'appareil (IndexedDB). */
'use strict';
{
/* ---------- utilitaires ---------- */
const $=(s,r=document)=>r.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/^(le|la|les|l) /,'').trim();
const paras=t=>String(t||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).map(p=>'<p>'+esc(p)+'</p>').join('');
const list=a=>Array.isArray(a)&&a.length?'<ul>'+a.map(x=>'<li>'+esc(typeof x==='string'?x:Object.values(x||{}).join(' — '))+'</li>').join('')+'</ul>':'';
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*6e4).toISOString().slice(0,10)};
const fdate=d=>{try{return new Date(d+'T12:00').toLocaleDateString('fr-FR',{day:'numeric',month:'long',year:'numeric'})}catch(e){return d||''}};
const newId=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const LS={get(k,d){try{const v=JSON.parse(localStorage.getItem(k));return v??d}catch(e){return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}};
const isNative=()=>!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());
const plural=(n,w)=>n+' '+w+(n>1?'s':'');
let tt;function toast(m,ms=4200){const t=$('#toast');t.textContent=m;t.hidden=false;clearTimeout(tt);tt=setTimeout(()=>t.hidden=true,ms)}

/* ---------- réglages ---------- */
const MODELS=[['claude-sonnet-5-5','Claude Sonnet 5.5 — recommandé'],['claude-opus-5-5','Claude Opus 5.5 — le plus précis'],['claude-haiku-5-5','Claude Haiku 5.5 — le plus rapide et économique']];
const cfg=Object.assign({apiKey:'',model:'claude-sonnet-5-5',web:true,autoLoc:true},LS.get('mm.cfg',{}));
const saveCfg=()=>LS.set('mm.cfg',cfg);

/* ---------- stockage IndexedDB ---------- */
const DB={
  h:null,
  open(){return this.h||(this.h=new Promise((res,rej)=>{const r=indexedDB.open('mymuseum',1);r.onupgradeneeded=()=>r.result.createObjectStore('oeuvres',{keyPath:'id'});r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}))},
  async tx(mode,fn){const db=await this.open();return new Promise((res,rej)=>{const t=db.transaction('oeuvres',mode);const st=t.objectStore('oeuvres');const out=fn(st);t.oncomplete=()=>res(out&&out.result!==undefined?out.result:out);t.onerror=()=>rej(t.error);t.onabort=()=>rej(t.error)})},
  all(){return this.tx('readonly',s=>s.getAll())},
  put(r){return this.tx('readwrite',s=>s.put(r))},
  del(id){return this.tx('readwrite',s=>s.delete(id))},
  clear(){return this.tx('readwrite',s=>s.clear())}
};
const urls=new Map();
function photoURL(it){
  if(!it.photo)return '';
  const c=urls.get(it.id);if(c&&c.b===it.photo)return c.u;
  if(c)URL.revokeObjectURL(c.u);
  const u=URL.createObjectURL(it.photo);urls.set(it.id,{b:it.photo,u});return u;
}

/* ---------- état ---------- */
const S={items:[],view:'capturer',museum:null,ficheId:null,photo:null,ident:null,cap:'idle',err:'',q:'',fav:false};
async function save(it){const i=S.items.findIndex(x=>x.id===it.id);if(i<0)S.items.unshift(it);else S.items[i]=it;try{await DB.put(it)}catch(e){toast('Enregistrement impossible : '+(e&&e.message||e))}}
function upd(id,patch){const it=S.items.find(x=>x.id===id);if(!it)return;return save({...it,...patch})}

/* ---------- visite en cours ---------- */
const vis=Object.assign({musee:'',ville:'',expo:'',ts:0,source:''},LS.get('mm.visite',{}));
const saveVis=()=>LS.set('mm.visite',vis);
function setVisit(m,v,x,source){
  const changed=norm(m)!==norm(vis.musee);
  vis.musee=m||'';vis.ville=v||'';if(x!==undefined)vis.expo=x;else if(changed)vis.expo='';
  vis.ts=Date.now();vis.source=source;saveVis();
  $('#vMusee').value=vis.musee;$('#vVille').value=vis.ville;$('#vExpo').value=vis.expo;
}
for(const k of ['musee','ville','expo']){
  const el=$('#v'+k[0].toUpperCase()+k.slice(1));el.value=vis[k]||'';
  el.addEventListener('change',()=>{vis[k]=el.value.trim();vis.ts=Date.now();vis.source='manuel';saveVis();
    if(k==='musee')$('#locChips').querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed',norm(c.dataset.name)===norm(vis.musee)));});
}

/* ---------- localisation → musée (OpenStreetMap / Overpass) ---------- */
const OVERPASS=['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter','https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
let lastDetect=0,detecting=false,nearby=[];
function locate(){
  return new Promise((res,rej)=>{
    if(!navigator.geolocation)return rej(new Error('La localisation n’est pas disponible sur cet appareil.'));
    navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy||50}),e=>{
      rej(new Error(e.code===1?'Localisation refusée : autorise-la dans les réglages du téléphone pour MyMuseum.':e.code===3?'La position met trop de temps à arriver (à l’intérieur, le GPS est parfois lent).':'Position introuvable pour le moment.'))
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
    if(!found.has(key))found.set(key,{key,name,city:t['addr:city']||'',kind:t.tourism||t.amenity,d:la!=null?dist(p.lat,p.lon,la,lo):9999});
  }
  const out=[...found.values()].map(x=>({...x,inside:inside.has(x.key),city:x.city||city}));
  out.sort((a,b)=>(b.inside-a.inside)||((a.kind==='gallery')-(b.kind==='gallery'))||(a.d-b.d));
  return {list:out.slice(0,8),city};
}
async function detect(auto){
  if(detecting)return;detecting=true;
  const st=$('#locStatus'),b=$('#locBtn');b.disabled=true;
  st.innerHTML='<span class="spin"></span>Recherche des musées autour de vous…';
  try{
    const p=await locate();
    const {list:ls,city}=await nearbyMuseums(p);
    lastDetect=Date.now();nearby=ls;
    const best=ls[0];
    const sure=best&&(best.inside||best.d<120);
    const manualRecent=vis.source==='manuel'&&Date.now()-vis.ts<4*36e5;
    if(sure&&!(auto&&manualRecent)){
      setVisit(best.name,best.city||city,undefined,'gps');
      st.innerHTML=`<span class="locok">Détecté : <b>${esc(best.name)}</b></span> ${best.inside?'(vous êtes à l’intérieur)':'(à '+Math.round(best.d)+' m)'}`;
    }else if(ls.length){
      st.textContent=auto&&manualRecent&&sure?`Vous semblez être à ${best.name}. Touchez-le pour changer de lieu.`:'Plusieurs lieux à proximité : touchez le vôtre, ou saisissez-le à la main.';
    }else{
      st.textContent='Aucun musée trouvé à moins de '+Math.round(Math.min(1000,Math.max(250,p.acc*1.5)))+' m. Saisissez le lieu à la main.';
    }
    renderChips();
  }catch(e){st.textContent=e.message||'Localisation impossible.';nearby=[];renderChips()}
  finally{detecting=false;b.disabled=false}
}
function renderChips(){
  const c=$('#locChips');
  c.innerHTML=nearby.map((x,i)=>`<button class="chip" data-i="${i}" data-name="${esc(x.name)}" aria-pressed="${norm(x.name)===norm(vis.musee)}">${esc(x.name)}<small>${x.inside?'ici':Math.round(x.d)+' m'}</small></button>`).join('');
  c.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{const x=nearby[+b.dataset.i];setVisit(x.name,x.city,undefined,'manuel');renderChips();$('#locStatus').innerHTML=`<span class="locok">Lieu choisi : <b>${esc(x.name)}</b></span>`});
}
$('#locBtn').onclick=()=>detect(false);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&cfg.autoLoc&&Date.now()-lastDetect>20*6e4&&S.view==='capturer')detect(true)});

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
async function takeFile(file){
  if(!file)return;
  if(S.cap==='ident'||S.cap==='fiche')return;
  try{
    const blob=await shrink(file);
    if(S.photo)URL.revokeObjectURL(S.photo.url);
    S.photo={blob,url:URL.createObjectURL(blob)};S.ident=null;S.err='';
    identify();
  }catch(e){S.err=e.message;S.cap='error';renderCap()}
}
$('#inCam').addEventListener('change',e=>{takeFile(e.target.files[0]);e.target.value=''});
$('#inImp').addEventListener('change',e=>{takeFile(e.target.files[0]);e.target.value=''});
const cv=$('#canvas');
cv.addEventListener('dragover',e=>{e.preventDefault();cv.classList.add('drag')});
cv.addEventListener('dragleave',()=>cv.classList.remove('drag'));
cv.addEventListener('drop',e=>{e.preventDefault();cv.classList.remove('drag');takeFile(e.dataTransfer.files[0])});

/* ---------- API Claude ---------- */
const b64=blob=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(String(r.result).split(',')[1]);r.onerror=()=>rej(r.error);r.readAsDataURL(blob)});
function apiError(status,body){
  let m='';try{m=JSON.parse(body).error.message}catch(e){m=String(body||'').slice(0,200)}
  if(status===401)return new Error('Clé API refusée : vérifiez-la dans les réglages.');
  if(status===429)return new Error('Trop de demandes d’un coup : réessayez dans une minute.');
  if(status===529||status===503)return new Error('Les serveurs de Claude sont surchargés : réessayez dans un instant.');
  if(/credit balance/i.test(m))return new Error('Crédit API épuisé : rechargez votre compte sur console.anthropic.com.');
  return new Error('Erreur de l’API ('+status+') : '+m);
}
async function claude({prompt,image,maxTokens=4096,web=false,onText}){
  if(!cfg.apiKey){const e=new Error('Ajoutez votre clé API Anthropic dans les réglages pour activer la reconnaissance.');e.noKey=true;throw e}
  if(!navigator.onLine)throw new Error('Pas de connexion internet : la reconnaissance a besoin du réseau.');
  const content=[];
  if(image)content.push({type:'image',source:{type:'base64',media_type:'image/jpeg',data:await b64(image)}});
  content.push({type:'text',text:prompt});
  const body={model:cfg.model,max_tokens:maxTokens,messages:[{role:'user',content}]};
  if(web)body.tools=[{type:'web_search_20250305',name:'web_search',max_uses:3}];
  if(onText)body.stream=true;
  const post=()=>fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':cfg.apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify(body)});
  let text='';
  for(let turn=0;turn<4;turn++){
    let r;try{r=await post()}catch(e){throw new Error('Impossible de joindre Claude : vérifiez la connexion.')}
    if(!r.ok){
      const t=await r.text();
      if(body.tools&&r.status===400&&/tool|web_search/i.test(t)){delete body.tools;turn--;continue}
      throw apiError(r.status,t);
    }
    if(onText){
      const rd=r.body.getReader(),dec=new TextDecoder();let buf='';
      for(;;){const {value,done}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;
        while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line.startsWith('data:'))continue;
          let ev;try{ev=JSON.parse(line.slice(5))}catch(e){continue}
          if(ev.type==='content_block_delta'&&ev.delta&&ev.delta.type==='text_delta'){text+=ev.delta.text;onText(text)}
          else if(ev.type==='error')throw new Error((ev.error&&ev.error.message)||'Erreur pendant la réponse');}}
      return text;
    }
    const j=await r.json();
    text+=(j.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    if(j.stop_reason==='pause_turn'){body.messages=[...body.messages,{role:'assistant',content:j.content}];text='';continue}
    if(j.stop_reason==='max_tokens'){const e=new Error('Réponse coupée (trop longue).');e.partial=text;throw e}
    return text;
  }
  return text;
}
function parseJ(t){
  const s=String(t||'');
  const f=s.match(/```(?:json)?\s*([\s\S]*?)```/);if(f){try{return JSON.parse(f[1])}catch(e){}}
  const b=s.lastIndexOf('}');let a=s.indexOf('{');
  while(a>=0&&a<b){try{return JSON.parse(s.slice(a,b+1))}catch(e){a=s.indexOf('{',a+1)}}
  throw new Error('Réponse de Claude illisible : réessayez.');
}
async function claudeJSON(o){return parseJ(await claude(o))}

/* ---------- prompts ---------- */
function ctxText(){
  const v=[$('#vMusee').value.trim(),$('#vVille').value.trim()].filter(Boolean).join(', ');
  const x=$('#vExpo').value.trim();
  return `Lieu de visite indiqué par le visiteur : ${v||'non précisé'}${vis.source==='gps'&&v?' (détecté par géolocalisation)':''}. Exposition temporaire : ${x||'aucune indiquée'}. Date de la visite : ${today()}.`;
}
function identPrompt(hint){
  return `Tu es conservateur de musée et historien de l'art. Identifie l'œuvre sur cette photo prise par un visiteur (prise de biais possible, reflets, cadre, cartel visible ou non).
${ctxText()}${hint?'\nIndice donné par le visiteur : '+hint:''}
${cfg.web?'Tu peux faire une ou deux recherches web pour confirmer l’identification ou retrouver l’exposition temporaire en cours dans ce lieu.\n':''}Réponds UNIQUEMENT par un objet JSON, sans texte avant ni après :
{"reconnu":true,"confiance":"haute|moyenne|faible","titre":"titre usuel en français","titre_original":"","artiste":"nom complet ou 'Anonyme' + atelier/culture","date":"date ou période","technique":"technique et support","dimensions":"si connues, sinon ''","mouvement":"mouvement, école ou période","conservation":{"institution":"institution qui possède ou conserve habituellement l'œuvre","ville":""},"lieu_visite":{"musee":"nom officiel complet du lieu où le visiteur la voit","ville":""},"exposition":"nom de l'exposition temporaire si elle y est présentée, sinon ''","en_pret":false,"candidats":[{"titre":"","artiste":"","institution":""}],"remarque":"une phrase sur ce qui fonde ou limite l'identification"}
Règles : n'invente jamais. Si tu hésites, confiance "faible" ou "moyenne" et jusqu'à 3 candidats crédibles. Si l'œuvre n'est pas célèbre ou est anonyme, donne un titre descriptif (ex. « Vase à figures rouges ») et la culture, l'époque et la fonction probables. Si le visiteur a indiqué un lieu, reprends-le dans lieu_visite sous son nom officiel ; sinon, mets l'institution de conservation la plus probable. Si le visiteur indique une exposition temporaire et que l'œuvre appartient à une autre institution, en_pret = true. Si un cartel est lisible sur la photo, sers-t'en.`;
}
function fichePrompt(f){
  return `Tu es historien de l'art et médiateur de musée. Rédige en français la fiche d'une œuvre qu'un visiteur a aimée, pour qu'il en apprenne plus après sa visite. Ton : expert mais vivant, précis, sans remplissage.
Œuvre : « ${f.titre} »${f.artiste?', '+f.artiste:''}${f.date?', '+f.date:''}${f.technique?', '+f.technique:''}. Conservée par : ${f.conservation||'non précisé'}. Vue par le visiteur à : ${f.musee||'?'}${f.ville?' ('+f.ville+')':''}${f.expo?', dans l’exposition temporaire « '+f.expo+' »':''}.
${f.withPhoto?'La photo jointe est celle du visiteur : appuie la description sur ce qu’on y voit.\n':''}${cfg.web?'Tu peux vérifier sur le web (deux recherches au plus) les faits dont tu n’es pas sûr.\n':''}Réponds UNIQUEMENT par un objet JSON, sans texte avant ni après :
{"accroche":"2 ou 3 phrases qui disent pourquoi cette œuvre compte","technique":"technique et support (corrige si besoin)","dimensions":"ou ''","mouvement":"","contexte":"contexte historique, commande et création (2 paragraphes séparés par \\n)","description":"ce qu'on voit, du général au détail (1 à 2 paragraphes)","analyse":{"composition":"","couleur_lumiere_matiere":"","symbolique_interpretations":""},"artiste":"portrait de l'artiste centré sur ce qui éclaire l'œuvre (1 paragraphe ; atelier ou culture si anonyme)","histoire_oeuvre":"provenance, réception, restaurations, déplacements notables","anecdotes":["2 à 4 faits surprenants mais vérifiés"],"a_regarder":["4 à 6 détails précis à observer en la revoyant"],"oeuvres_liees":[{"titre":"","artiste":"","lieu":"où la voir","lien":"pourquoi la rapprocher"}],"aller_plus_loin":["3 à 5 livres, documentaires ou visites réels"],"debats":"ce qui est incertain ou discuté (attribution, datation, lecture) ; '' si rien","mots_cles":["5 à 8 mots-clés"]}
Règles : uniquement des faits que tu sais exacts ; signale l'incertitude plutôt que d'inventer ; pas de références bibliographiques imaginaires.`;
}

/* ---------- capture ---------- */
async function identify(){
  S.cap='ident';renderCap();
  try{S.ident=await claudeJSON({prompt:identPrompt(LS.get('mm.hint','')),image:S.photo.blob,maxTokens:2000,web:cfg.web});S.cap='confirm'}
  catch(e){S.err=e.message;S.noKey=!!e.noKey;S.cap='error'}
  renderCap();
}
function renderCap(){
  const has=!!S.photo;
  $('#empty').hidden=has;
  cv.querySelectorAll(':scope>img,.scan').forEach(n=>n.remove());
  if(has){const i=new Image();i.src=S.photo.url;i.alt='Votre photo';cv.appendChild(i)}
  if(S.cap==='ident'||S.cap==='fiche'){const sc=document.createElement('div');sc.className='scan';cv.appendChild(sc)}
  const side=$('#side');
  const again=`<div class="row" style="margin-top:14px"><label class="btn small"><input type="file" accept="image/*" capture="environment" class="re" hidden>Reprendre une photo</label><label class="btn small"><input type="file" accept="image/*" class="re" hidden>Importer une autre</label>${has?'<button class="btn small" id="cancel">Annuler</button>':''}</div>`;
  if(S.cap==='idle'){
    side.innerHTML=`<h2>Photographiez, on s’occupe du reste</h2><p class="lead">L’œuvre est reconnue, une fiche complète est rédigée (contexte, analyse, détails à regarder) puis rangée dans le dossier du musée, et de l’exposition si elle est temporaire.</p>
    <label class="f">Un indice pour aider (facultatif)<input id="hint" placeholder="Texte du cartel, salle, nom de l’artiste…"></label>
    ${cfg.apiKey?'':'<p class="err">Pour activer la reconnaissance, ajoutez d’abord votre clé API Anthropic.</p><button class="btn main" id="goSet">Ouvrir les réglages</button>'}`;
    $('#hint').value=LS.get('mm.hint','');$('#hint').addEventListener('input',e=>LS.set('mm.hint',e.target.value));
    const g=$('#goSet');if(g)g.onclick=()=>show('reglages');
  }else if(S.cap==='ident'){
    side.innerHTML=`<h2>Je regarde l’œuvre…</h2><p class="lead">Identification de l’œuvre, de l’artiste et de son lieu de conservation${cfg.web?', avec vérification sur le web si besoin':''}.</p>`;
  }else if(S.cap==='fiche'){
    side.innerHTML=`<h2>Rédaction de la fiche…</h2><p class="lead">Contexte, analyse, anecdotes et œuvres liées. Comptez de 20 secondes à une minute.</p>`;
  }else if(S.cap==='error'){
    side.innerHTML=`<h2>Pas de réponse</h2><p class="err">${esc(S.err)}</p><div class="row">${S.noKey?'<button class="btn main" id="goSet">Ouvrir les réglages</button>':S.photo?'<button class="btn main" id="retry">Réessayer</button>':''}</div>${again}`;
    const r=$('#retry');if(r)r.onclick=identify;const g=$('#goSet');if(g)g.onclick=()=>show('reglages');
  }else if(S.cap==='confirm'){
    const d=S.ident||{};const c=['haute','moyenne','faible'].includes(d.confiance)?d.confiance:'moyenne';
    const lv=d.lieu_visite||{},co=d.conservation||{};
    const vm=$('#vMusee').value.trim(),vx=$('#vExpo').value.trim();
    const cand=(Array.isArray(d.candidats)?d.candidats:[]).filter(x=>x&&x.titre).slice(0,3);
    side.innerHTML=`<div class="cartel"><span class="conf ${c}">${d.reconnu===false?'Œuvre non identifiée avec certitude':'Confiance '+c}</span>
    ${cand.length?`<div class="meta">Autres pistes :</div><div class="chips">${cand.map((x,i)=>`<button class="chip" data-c="${i}">${esc(x.titre)}${x.artiste?' · '+esc(x.artiste):''}</button>`).join('')}</div>`:''}
    <label class="f">Titre<input id="cTitre"></label>
    <div class="g2"><label class="f">Artiste<input id="cArt"></label><label class="f">Date<input id="cDate"></label></div>
    <label class="f">Conservée habituellement à<input id="cCons"></label>
    <div class="g2"><label class="f">Vue au musée<input id="cMus" list="dlMusees"></label><label class="f">Ville<input id="cVille"></label></div>
    <label class="f">Exposition temporaire<input id="cExpo" list="dlExpos" placeholder="Vide = collections permanentes"></label>
    ${d.remarque?`<p class="note" style="margin:-4px 0 12px">${esc(d.remarque)}</p>`:''}
    <div class="row"><button class="btn main" id="go">Créer la fiche</button></div></div>${again}`;
    const set=(id,v)=>{$(id).value=v||''};
    set('#cTitre',d.titre);set('#cArt',d.artiste);set('#cDate',d.date);
    set('#cCons',[co.institution,co.ville].filter(Boolean).join(', '));
    set('#cMus',vm||lv.musee||co.institution);set('#cVille',$('#vVille').value.trim()||lv.ville||co.ville);
    set('#cExpo',vx||d.exposition);
    side.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>{const x=cand[+b.dataset.c];set('#cTitre',x.titre);set('#cArt',x.artiste);set('#cCons',x.institution);side.querySelectorAll('[data-c]').forEach(z=>z.setAttribute('aria-pressed',z===b))});
    $('#go').onclick=create;
  }
  side.querySelectorAll('input.re').forEach(n=>n.addEventListener('change',e=>takeFile(e.target.files[0])));
  const cn=$('#cancel');if(cn)cn.onclick=()=>{if(S.photo)URL.revokeObjectURL(S.photo.url);S.photo=null;S.ident=null;S.cap='idle';renderCap()};
}
const enPret=(f)=>!!(f.expo&&f.conservation&&norm(f.conservation).indexOf(norm(f.musee))<0);
async function create(){
  const v=id=>$(id).value.trim();
  const id0=S.ident||{};
  const f={titre:v('#cTitre')||'Œuvre sans titre',artiste:v('#cArt'),date:v('#cDate'),conservation:v('#cCons'),musee:v('#cMus')||'Lieu non précisé',ville:v('#cVille'),expo:v('#cExpo'),technique:id0.technique||'',dimensions:id0.dimensions||'',mouvement:id0.mouvement||''};
  setVisit(f.musee,f.ville,f.expo,vis.source==='gps'&&norm(f.musee)===norm(vis.musee)?'gps':'manuel');
  S.cap='fiche';renderCap();
  const blob=S.photo.blob;
  let fiche;
  try{fiche=await claudeJSON({prompt:fichePrompt({...f,withPhoto:true}),image:blob,maxTokens:8000,web:cfg.web})}
  catch(e){S.cap='confirm';renderCap();$('#cTitre').value=f.titre;$('#cArt').value=f.artiste;$('#cDate').value=f.date;$('#cCons').value=f.conservation;$('#cMus').value=f.musee;$('#cVille').value=f.ville;$('#cExpo').value=f.expo;
    toast(e.message,6000);return}
  const it={id:newId(),createdAt:Date.now(),visite:today(),...f,enPret:enPret(f),photo:blob,fiche,notes:'',favori:false,qa:[]};
  if(fiche.technique)it.technique=fiche.technique;if(fiche.dimensions)it.dimensions=fiche.dimensions;if(fiche.mouvement)it.mouvement=fiche.mouvement;
  await save(it);
  URL.revokeObjectURL(S.photo.url);S.photo=null;S.ident=null;S.cap='idle';LS.set('mm.hint','');
  renderCap();fillLists();openFiche(it.id);
}

/* ---------- regroupements ---------- */
const thumb=it=>{const u=photoURL(it);return u?`<img src="${esc(u)}" alt="" loading="lazy">`:''};
function museums(){
  const m=new Map();
  for(const it of S.items){const k=norm(it.musee)||'_';if(!m.has(k))m.set(k,{key:k,nom:it.musee||'Lieu non précisé',ville:it.ville||'',items:[]});const g=m.get(k);g.items.push(it);if(!g.ville&&it.ville)g.ville=it.ville}
  for(const g of m.values())g.items.sort((a,b)=>b.createdAt-a.createdAt);
  return [...m.values()].sort((a,b)=>b.items[0].createdAt-a.items[0].createdAt);
}
function ocard(it){
  return `<button class="ocard" data-o="${esc(it.id)}"><div class="im">${thumb(it)}</div><h3>${esc(it.titre)}</h3><div class="meta">${esc([it.artiste,it.date].filter(Boolean).join(', '))}</div>${it.favori?'<span class="tag">Coup de cœur</span> ':''}${it.enPret?'<span class="tag l">Prêt</span>':''}</button>`;
}
function bindCards(root){root.querySelectorAll('[data-o]').forEach(b=>b.onclick=()=>openFiche(b.dataset.o))}

/* ---------- vue musées ---------- */
function renderMusees(){
  const root=$('#v-musees');
  if(S.museum){
    const g=museums().find(x=>x.key===S.museum);
    if(!g){S.museum=null;return renderMusees()}
    const groups=new Map();
    for(const it of g.items){const k=it.expo?norm(it.expo):'';if(!groups.has(k))groups.set(k,{nom:it.expo,items:[],dates:new Set()});const x=groups.get(k);x.items.push(it);x.dates.add(it.visite)}
    const order=[...groups.entries()].sort((a,b)=>(a[0]===''?-1:b[0]===''?1:b[1].items[0].createdAt-a[1].items[0].createdAt));
    root.innerHTML=`<button class="back" id="bk">← Tous les musées</button><div class="head"><h2>${esc(g.nom)}</h2><div class="meta">${esc(g.ville?g.ville+' · ':'')}${plural(g.items.length,'œuvre')}</div></div>`+
    order.map(([k,x])=>`<div class="sect"><h3>${k?'Exposition « '+esc(x.nom)+' »':'Collections permanentes'}</h3><span class="meta">${plural(x.items.length,'œuvre')} · ${x.items.length>1?'vues':'vue'} le ${[...x.dates].filter(Boolean).sort().map(fdate).map(esc).join(', ')}</span></div><div class="ogrid">${x.items.map(ocard).join('')}</div>`).join('');
    $('#bk').onclick=()=>{S.museum=null;renderMusees();scrollTo(0,0)};bindCards(root);return;
  }
  const ms=museums();
  root.innerHTML=`<div class="head"><h2>Mes musées</h2>${S.items.length?'<button class="btn small" id="rnd">Revoir une œuvre au hasard</button>':''}</div>`+
  (ms.length?`<div class="mgrid">${ms.map(g=>{const ex=new Set(g.items.filter(i=>i.expo).map(i=>norm(i.expo))).size;const p=g.items.slice(0,3);
    return `<button class="mcard" data-m="${esc(g.key)}"><div class="ph">${p[0]?thumb(p[0]):''}<div class="stackp">${p[1]?thumb(p[1]):''}${p[2]?thumb(p[2]):''}</div></div><div class="tx"><h3>${esc(g.nom)}</h3><div class="meta">${esc(g.ville?g.ville+' · ':'')}${plural(g.items.length,'œuvre')}${ex?' · '+plural(ex,'expo')+' temporaire'+(ex>1?'s':''):''}</div></div></button>`}).join('')}</div>`
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
  const it=S.items.filter(x=>(!S.fav||x.favori)&&(!q||norm([x.titre,x.artiste,x.musee,x.ville,x.expo,x.mouvement,...((x.fiche&&x.fiche.mots_cles)||[])].join(' ')).includes(q))).sort((a,b)=>b.createdAt-a.createdAt);
  $('#ol').innerHTML=it.length?`<div class="ogrid">${it.map(ocard).join('')}</div>`:`<div class="emptyst"><h3>${S.items.length?'Rien ne correspond':'Votre carnet est vide'}</h3>${S.items.length?'Essayez un autre mot.':'Les œuvres que vous photographiez s’afficheront ici.'}</div>`;
  bindCards($('#ol'));
}

/* ---------- fiche ---------- */
function openFiche(id){S.ficheId=id;show('fiche');scrollTo(0,0)}
function ficheText(it){const f=it.fiche||{},a=f.analyse||{};return [it.titre,[it.artiste,it.date].filter(Boolean).join(', '),it.technique,'Vue à '+it.musee+(it.expo?' — exposition « '+it.expo+' »':'')+' le '+fdate(it.visite),'',f.accroche,'','CONTEXTE',f.contexte,'','CE QUE L’ON VOIT',f.description,'','ANALYSE',a.composition,a.couleur_lumiere_matiere,a.symbolique_interpretations,'','À REGARDER DE PRÈS',...(f.a_regarder||[]).map(x=>'• '+x),it.notes?'\nMES NOTES\n'+it.notes:''].filter(x=>x!=null).join('\n')}
async function copyText(t){
  try{await navigator.clipboard.writeText(t);toast('Fiche copiée')}
  catch(e){const a=document.createElement('textarea');a.value=t;document.body.appendChild(a);a.select();try{document.execCommand('copy');toast('Fiche copiée')}catch(x){toast('Copie impossible')}a.remove()}
}
function renderFiche(){
  const root=$('#v-fiche');const it=S.items.find(x=>x.id===S.ficheId);
  if(!it){root.innerHTML=`<button class="back" id="bk">← Retour</button><div class="emptyst"><h3>Fiche introuvable</h3></div>`;$('#bk').onclick=()=>show('musees');return}
  const f=it.fiche||{},a=f.analyse||{};
  const spec=[['Technique',it.technique],['Dimensions',it.dimensions],['Mouvement',it.mouvement],['Conservée à',it.conservation]].filter(x=>x[1]);
  const lies=(f.oeuvres_liees||[]).filter(x=>x&&x.titre).map(x=>`<li><i>${esc(x.titre)}</i>${x.artiste?', '+esc(x.artiste):''}${x.lieu?' ('+esc(x.lieu)+')':''}${x.lien?' : '+esc(x.lien):''}</li>`).join('');
  root.innerHTML=`<button class="back" id="bk">← ${esc(it.musee)}</button>
  <div class="fiche"><div class="left"><div class="frame"><div class="mat"><div class="canvas">${thumb(it)||'<div class="empty">Pas de photo</div>'}</div></div></div>
    <div class="seen">Vue le <b>${esc(fdate(it.visite))}</b> à <b>${esc(it.musee)}</b>${it.ville?', '+esc(it.ville):''}${it.expo?`<br>Exposition temporaire « <b>${esc(it.expo)}</b> »${it.enPret&&it.conservation?' — prêt de '+esc(it.conservation):''}`:'<br>Collections permanentes'}</div>
    <div class="toolbar"><button class="btn small fav" id="fv" aria-pressed="${!!it.favori}">${it.favori?'Coup de cœur':'Ajouter aux coups de cœur'}</button><button class="btn small" id="cp">Copier la fiche</button><button class="btn small" id="rg">Régénérer</button><button class="btn small" id="dl">Supprimer</button></div>
    <details class="edit"><summary>Corriger l’œuvre ou le lieu</summary>
      <label class="f">Titre<input id="eT"></label><div class="g2"><label class="f">Artiste<input id="eA"></label><label class="f">Date<input id="eD"></label></div>
      <div class="g2"><label class="f">Musée<input id="eM" list="dlMusees"></label><label class="f">Ville<input id="eV"></label></div>
      <div class="g2"><label class="f">Exposition temporaire<input id="eX" list="dlExpos"></label><label class="f">Date de visite<input id="eW" type="date"></label></div>
      <label class="f">Conservée habituellement à<input id="eC"></label>
      <button class="btn main small" id="es">Enregistrer</button></details>
  </div>
  <div><h2>${esc(it.titre)}</h2><div class="who">${esc([it.artiste,it.date].filter(Boolean).join(', '))}</div>
    ${spec.length?`<dl class="spec">${spec.map(([k,v])=>`<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`:''}
    ${f.accroche?`<p class="lead2">${esc(f.accroche)}</p>`:''}
    ${f.contexte?`<div class="blk"><h3>Contexte</h3>${paras(f.contexte)}</div>`:''}
    ${f.description?`<div class="blk"><h3>Ce que l’on voit</h3>${paras(f.description)}</div>`:''}
    ${(a.composition||a.couleur_lumiere_matiere||a.symbolique_interpretations)?`<div class="blk"><h3>Analyse</h3>${a.composition?'<h4>Composition</h4>'+paras(a.composition):''}${a.couleur_lumiere_matiere?'<h4>Couleur, lumière, matière</h4>'+paras(a.couleur_lumiere_matiere):''}${a.symbolique_interpretations?'<h4>Symbolique et interprétations</h4>'+paras(a.symbolique_interpretations):''}</div>`:''}
    ${f.a_regarder&&f.a_regarder.length?`<div class="blk"><h3>À regarder de près</h3>${list(f.a_regarder)}</div>`:''}
    ${f.artiste?`<div class="blk"><h3>${esc(it.artiste||'L’artiste')}</h3>${paras(f.artiste)}</div>`:''}
    ${f.histoire_oeuvre?`<div class="blk"><h3>Histoire de l’œuvre</h3>${paras(f.histoire_oeuvre)}</div>`:''}
    ${f.anecdotes&&f.anecdotes.length?`<div class="blk"><h3>Anecdotes</h3>${list(f.anecdotes)}</div>`:''}
    ${f.debats?`<div class="blk"><h3>Débats et incertitudes</h3>${paras(f.debats)}</div>`:''}
    ${lies?`<div class="blk"><h3>Œuvres à rapprocher</h3><ul>${lies}</ul></div>`:''}
    ${f.aller_plus_loin&&f.aller_plus_loin.length?`<div class="blk"><h3>Pour aller plus loin</h3>${list(f.aller_plus_loin)}</div>`:''}
    <div class="blk"><h3>Mes notes</h3><textarea class="inp" id="nt" placeholder="Ce qui m’a touché, avec qui j’étais, ce que je veux revoir…"></textarea></div>
    <div class="blk"><h3>Poser une question</h3><div id="qal">${(it.qa||[]).map(x=>`<div class="qa"><div class="q">${esc(x.q)}</div><div class="a">${esc(x.a)}</div></div>`).join('')}</div>
      <form class="row" id="qf"><input class="inp" id="qi" placeholder="Pourquoi ce bleu ? Qui est le personnage à gauche ?" style="flex:1 1 240px;margin:0"><button class="btn main">Demander</button></form></div>
    ${f.mots_cles&&f.mots_cles.length?`<p class="note" style="margin-top:24px">${f.mots_cles.map(esc).join(' · ')}</p>`:''}
  </div></div>`;
  const cur=()=>S.items.find(x=>x.id===it.id)||it;
  $('#bk').onclick=()=>{S.museum=norm(it.musee)||'_';show('musees')};
  $('#nt').value=it.notes||'';$('#nt').addEventListener('change',e=>{upd(it.id,{notes:e.target.value});toast('Notes enregistrées')});
  $('#fv').onclick=async()=>{await upd(it.id,{favori:!cur().favori});renderFiche()};
  $('#cp').onclick=()=>copyText(ficheText(cur()));
  const E={eT:'titre',eA:'artiste',eD:'date',eM:'musee',eV:'ville',eX:'expo',eW:'visite',eC:'conservation'};
  for(const k in E)$('#'+k).value=it[E[k]]||'';
  $('#es').onclick=async()=>{const p={};for(const k in E)p[E[k]]=$('#'+k).value.trim();p.musee=p.musee||'Lieu non précisé';p.enPret=enPret(p);await upd(it.id,p);fillLists();renderFiche();toast('Fiche mise à jour')};
  const dl=$('#dl');let armed=false;dl.onclick=async()=>{
    if(!armed){armed=true;dl.textContent='Confirmer la suppression';dl.classList.add('danger');setTimeout(()=>{armed=false;if(dl.isConnected){dl.textContent='Supprimer';dl.classList.remove('danger')}},4000);return}
    S.items=S.items.filter(x=>x.id!==it.id);const c=urls.get(it.id);if(c){URL.revokeObjectURL(c.u);urls.delete(it.id)}
    try{await DB.del(it.id)}catch(e){}
    toast('Œuvre supprimée');S.museum=norm(it.musee)||'_';show('musees');
  };
  $('#rg').onclick=async()=>{
    const b=$('#rg');b.disabled=true;b.textContent='Rédaction…';const c=cur();
    try{const nf=await claudeJSON({prompt:fichePrompt({...c,withPhoto:!!c.photo}),image:c.photo||null,maxTokens:8000,web:cfg.web});await upd(it.id,{fiche:nf});if(S.ficheId===it.id&&S.view==='fiche')renderFiche();toast('Fiche régénérée')}
    catch(e){toast(e.message,6000);if(b.isConnected){b.disabled=false;b.textContent='Régénérer'}}
  };
  $('#qf').addEventListener('submit',async e=>{
    e.preventDefault();const q=$('#qi').value.trim();if(!q)return;
    $('#qi').value='';const box=document.createElement('div');box.className='qa';box.innerHTML=`<div class="q"></div><div class="a">…</div>`;box.firstChild.textContent=q;$('#qal').appendChild(box);
    const c=cur();const prev=(c.qa||[]).slice(-3).map(x=>'Q : '+x.q+'\nR : '+x.a).join('\n');
    const prompt=`Tu es historien de l'art. Réponds en français, précisément, en 1 à 3 paragraphes sans titres ni listes, à la question d'un visiteur sur l'œuvre « ${c.titre} »${c.artiste?' de '+c.artiste:''}${c.date?' ('+c.date+')':''}, conservée par ${c.conservation||c.musee}.
Résumé de sa fiche : ${f.accroche||''} ${(f.description||'').slice(0,900)}
${prev?'Questions déjà posées :\n'+prev+'\n':''}Si tu n'es pas sûr, dis-le. Réponds directement, sans préambule.
Question : ${q}`;
    try{const t=await claude({prompt,maxTokens:1500,web:cfg.web,onText:txt=>{box.lastChild.textContent=txt}});box.lastChild.textContent=t;await upd(it.id,{qa:[...(cur().qa||[]),{q,a:t,t:Date.now()}]})}
    catch(er){box.lastChild.textContent=er.message}
  });
}

/* ---------- réglages & sauvegarde ---------- */
async function renderReglages(){
  const root=$('#v-reglages');
  let used='';try{const e=await navigator.storage.estimate();used=(e.usage/1048576).toFixed(1)+' Mo utilisés'}catch(e){}
  root.innerHTML=`<div class="set"><div class="head"><h2>Réglages</h2></div>
  <div class="card"><h3>Reconnaissance par Claude</h3>
    <p>L’app utilise votre propre clé API Anthropic. Elle reste sur ce téléphone et n’est envoyée qu’à api.anthropic.com. Chaque photo est facturée sur votre compte API. Créez une clé sur <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>.</p>
    <label class="f">Clé API<input id="sKey" type="password" autocomplete="off" placeholder="sk-ant-…"></label>
    <div class="row" style="margin:-4px 0 12px"><button class="btn small" id="sShow">Afficher</button><button class="btn small" id="sTest">Tester la clé</button><span class="note" id="sTestR" style="margin:0"></span></div>
    <label class="f">Modèle<select id="sModel">${MODELS.map(([v,l])=>`<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
    <label class="sw"><input type="checkbox" id="sWeb"><div><b>Vérifier sur le web</b><span>Claude peut faire quelques recherches pour confirmer l’œuvre, trouver l’exposition en cours et vérifier les faits. Plus fiable, un peu plus lent.</span></div></label>
  </div>
  <div class="card"><h3>Localisation</h3>
    <label class="sw"><input type="checkbox" id="sLoc"><div><b>Détecter automatiquement le musée</b><span>À l’ouverture de l’app (et au retour après 20 min), votre position est comparée aux musées d’OpenStreetMap. Vous pouvez toujours saisir ou corriger le lieu à la main.</span></div></label>
  </div>
  <div class="card"><h3>Mes données</h3>
    <p>${plural(S.items.length,'œuvre')} enregistrée${S.items.length>1?'s':''} sur cet appareil${used?' · '+used:''}. Elles ne sont pas synchronisées : faites une sauvegarde de temps en temps (par exemple vers Google Drive).</p>
    <div class="row"><button class="btn" id="sExp">Exporter une sauvegarde</button><button class="btn" id="sImp">Importer une sauvegarde</button><button class="btn danger" id="sClr">Tout effacer</button></div>
  </div>
  <p class="note">MyMuseum · données de lieux © contributeurs OpenStreetMap</p></div>`;
  const k=$('#sKey');k.value=cfg.apiKey;k.addEventListener('change',()=>{cfg.apiKey=k.value.trim();saveCfg();renderCap()});
  $('#sShow').onclick=()=>{k.type=k.type==='password'?'text':'password';$('#sShow').textContent=k.type==='password'?'Afficher':'Masquer'};
  $('#sTest').onclick=async()=>{cfg.apiKey=k.value.trim();saveCfg();const r=$('#sTestR');r.textContent='Test…';
    try{await claude({prompt:'Réponds juste : OK',maxTokens:5});r.innerHTML='<span class="locok">Clé valide</span>'}catch(e){r.textContent=e.message}};
  const m=$('#sModel');m.value=cfg.model;m.onchange=()=>{cfg.model=m.value;saveCfg()};
  const w=$('#sWeb');w.checked=cfg.web;w.onchange=()=>{cfg.web=w.checked;saveCfg()};
  const l=$('#sLoc');l.checked=cfg.autoLoc;l.onchange=()=>{cfg.autoLoc=l.checked;saveCfg();if(l.checked)toast('La détection se fera à la prochaine ouverture, ou avec « Me localiser ».')};
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
  const items=[];for(const it of S.items){const o={...it};if(it.photo)o.photo=await blobToDataURL(it.photo);items.push(o)}
  const json=JSON.stringify({app:'MyMuseum',version:1,exported:new Date().toISOString(),items});
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
    for(const o of data.items){if(!o||!o.id)continue;const it={...o};if(typeof o.photo==='string'&&o.photo.startsWith('data:image/'))it.photo=await (await fetch(o.photo)).blob();else delete it.photo;await DB.put(it);n++}
    S.items=(await DB.all()).sort((a,b)=>b.createdAt-a.createdAt);fillLists();
    toast(plural(n,'œuvre')+' importée'+(n>1?'s':''));if(S.view==='reglages')renderReglages();
  }catch(er){toast('Import impossible : '+er.message,6000)}
});

/* ---------- navigation ---------- */
function fillLists(){
  const ms=[...new Set(S.items.map(i=>i.musee).filter(Boolean))],xs=[...new Set(S.items.map(i=>i.expo).filter(Boolean))];
  $('#dlMusees').innerHTML=ms.map(m=>`<option value="${esc(m)}">`).join('');$('#dlExpos').innerHTML=xs.map(m=>`<option value="${esc(m)}">`).join('');
}
const TABS=['capturer','musees','oeuvres','reglages'];
function show(v){
  S.view=v;
  document.querySelectorAll('.view').forEach(s=>s.hidden=s.id!=='v-'+v);
  document.querySelectorAll('nav button').forEach(b=>b.setAttribute('aria-current',b.dataset.v===v||(v==='fiche'&&b.dataset.v==='musees')));
  if(TABS.includes(v)&&location.hash!=='#'+v)history.replaceState(null,'','#'+v);
  if(v==='musees')renderMusees();else if(v==='oeuvres')renderOeuvres();else if(v==='fiche')renderFiche();else if(v==='reglages')renderReglages();else if(S.cap==='idle')renderCap();
}
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{if(b.dataset.v==='musees')S.museum=null;show(b.dataset.v);scrollTo(0,0)});
addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(TABS.includes(h)&&h!==S.view)show(h)});

/* ---------- démarrage ---------- */
(async()=>{
  renderCap();
  {const h=location.hash.slice(1);show(TABS.includes(h)?h:'capturer')}
  try{S.items=(await DB.all()).sort((a,b)=>b.createdAt-a.createdAt)}catch(e){toast('Stockage local indisponible : '+(e&&e.message||e),8000)}
  fillLists();show(S.view);
  try{if(navigator.storage&&navigator.storage.persist)navigator.storage.persist()}catch(e){}
  if(cfg.autoLoc){const manualRecent=vis.source==='manuel'&&Date.now()-vis.ts<4*36e5;if(!manualRecent||!vis.musee)detect(true);else{$('#locStatus').textContent='Lieu saisi à la main. Touchez « Me localiser » pour le détecter.'}}
  if('serviceWorker' in navigator&&!isNative()&&location.protocol==='https:')navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
}
