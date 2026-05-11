// ═══════════════ COSTANTI ═══════════════
const SK='mnemosyne_v5',DAY=864e5,MIN=6e4;
const SETTINGS_KEY='mnemosyne_settings';
const COLORS=['#c8a96e','#4a9c6e','#5c8ab8','#b85c5c','#9c6eb8','#c87a3e','#5cb8b0','#7eb85c','#b8a05c'];

// Palette temi: [accent, accent2, adim]
const THEMES=[
  {name:'Ambra',    ac:'#c8a96e',ac2:'#e8c99a',adim:'rgba(200,169,110,0.13)'},
  {name:'Smeraldo', ac:'#4a9c6e',ac2:'#6ec995',adim:'rgba(74,156,110,0.13)'},
  {name:'Oceano',   ac:'#5c8ab8',ac2:'#80aed4',adim:'rgba(92,138,184,0.13)'},
  {name:'Rosa',     ac:'#c46e9a',ac2:'#e89fc2',adim:'rgba(196,110,154,0.13)'},
  {name:'Viola',    ac:'#9c6eb8',ac2:'#c499d4',adim:'rgba(156,110,184,0.13)'},
  {name:'Ardesia',  ac:'#8a9c6e',ac2:'#b0c490',adim:'rgba(138,156,110,0.13)'},
  {name:'Argento',  ac:'#909090',ac2:'#c0c0c0',adim:'rgba(144,144,144,0.13)'},
];
const DEF={newLimit:20,revLimit:60,learnSteps:[1,10,1440],relearnSteps:[10,1440],maxInterval:36500,leechThreshold:8,newOrder:'due',newInterval:0};

// ═══════════════ STATE ═══════════════
let S=loadState(),view='dashboard';
let appSettings=loadAppSettings();
applyTheme(appSettings.themeIdx||0);
let studyQ=[],againQ=[],studyDid=null;
let sess={again:0,hard:0,good:0,easy:0,reviewed:0};
let delCardId=null,delDeckId=null;
let selColor=COLORS[0],inlineColor=COLORS[0];
let importParsed=[],barChart=null,statsDid=null;
let undoStack=[];  // [{cardSnapshot, item, fromAgain, sessSnapshot, tcSnapshot}]

function loadState(){
  try{
    const s=JSON.parse(localStorage.getItem(SK));
    if(s?.decks&&s?.cards){
      s.cards.forEach(c=>{
        if(!c.status)c.status='new';
        if(c.lapses==null)c.lapses=0;
        if(c.stepIdx==null)c.stepIdx=0;
        if(c.suspended==null)c.suspended=false;
        if(c.repetitions>0&&c.status==='new')c.status='review';
      });
      s.decks.forEach(d=>{d.settings={...DEF,...(d.settings||{})};});
      if(!s.todayCounts)s.todayCounts={};
      if(!s.studyLog)s.studyLog=[];
      if(!s.streak)s.streak=0;
      return s;
    }
  }catch(e){}
  return defState();
}

function defState(){
  return{
    decks:[],
    cards:[],
    reviews:[],streak:0,lastStudyDate:'',todayCounts:{},studyLog:[],
  };
}

function mkCard(deckId,front,back,tags,id){
  return{id:id||uid(),deckId,front,back,tags:tags||'',created:Date.now(),
    interval:0,easeFactor:2.5,repetitions:0,dueDate:Date.now(),
    lapses:0,stepIdx:0,status:'new',suspended:false};
}

function save(){localStorage.setItem(SK,JSON.stringify(S));}
function uid(){return Math.random().toString(36).slice(2,11);}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function getDeck(id){return S.decks.find(d=>d.id===id);}
function cfg(did){return getDeck(did)?.settings||{...DEF};}
function parseSteps(s){return String(s).split(/[\s,]+/).map(Number).filter(n=>!isNaN(n)&&n>0);}
function getSteps(did,type){const c=cfg(did);const r=type==='learn'?c.learnSteps:c.relearnSteps;return Array.isArray(r)?r:parseSteps(r);}

// ═══════════════ TODAY COUNTS ═══════════════
function todayKey(){return new Date().toDateString();}
function getTc(did){
  const k=todayKey();
  if(!S.todayCounts[k])S.todayCounts[k]={};
  if(!S.todayCounts[k][did])S.todayCounts[k][did]={newDone:0,revDone:0};
  Object.keys(S.todayCounts).forEach(x=>{if(x!==k)delete S.todayCounts[x];});
  return S.todayCounts[k][did];
}
function incTc(did,type){const c=getTc(did);if(type==='new')c.newDone++;else c.revDone++;}

// ═══════════════ SM-2 COMPLETO ═══════════════
function sm2(card,rating){
  const c=cfg(card.deckId);
  let{interval,easeFactor,repetitions,lapses,stepIdx,status}=card;
  const ls=getSteps(card.deckId,'learn'),rs=getSteps(card.deckId,'relearn');
  let due,ns;

  if(status==='new'||status==='learning'){
    if(rating==='again'){
      stepIdx=0;ns='learning';due=Date.now()+ls[0]*MIN;
    }else if(rating==='easy'){
      interval=Math.min(Math.max(4,Math.round(ls[ls.length-1]/1440*easeFactor)),c.maxInterval);
      repetitions=1;ns=interval>=21?'mature':'review';due=Date.now()+interval*DAY;stepIdx=ls.length;
    }else if(rating==='medium'){
      stepIdx=Math.min(stepIdx+1,ls.length);
      if(stepIdx>=ls.length){interval=Math.min(Math.max(1,Math.round(ls[ls.length-1]/1440)),c.maxInterval);repetitions=1;ns=interval>=21?'mature':'review';due=Date.now()+interval*DAY;}
      else{ns='learning';due=Date.now()+ls[stepIdx]*MIN;}
    }else{
      // Hard in learning: media tra step corrente e precedente (Anki: average of Again and Good)
      const hardMin=stepIdx===0?ls[0]:(ls[stepIdx-1]+ls[stepIdx])/2;
      ns='learning';due=Date.now()+hardMin*MIN;
    }

  }else if(status==='relearning'){
    if(rating==='again'){stepIdx=0;ns='relearning';due=Date.now()+rs[0]*MIN;}  // no lapses++ qui, già contato quando è uscita da review
    else if(rating==='medium'||rating==='easy'){
      stepIdx=Math.min(stepIdx+1,rs.length);
      if(stepIdx>=rs.length){interval=Math.min(Math.max(1,Math.round(interval*0.5)),c.maxInterval);repetitions++;ns=interval>=21?'mature':'review';due=Date.now()+interval*DAY;}
      else{ns='relearning';due=Date.now()+rs[stepIdx]*MIN;}
    }else{
      // Hard in relearning: media tra step corrente e precedente
      const hardMin=stepIdx===0?rs[0]:(rs[stepIdx-1]+rs[stepIdx])/2;
      ns='relearning';due=Date.now()+hardMin*MIN;
    }

  }else{
    if(rating==='again'){
      // Again in review: intervallo azzerato (new interval = 0%, default Anki), ease -0.20
      lapses++;interval=Math.max(1,Math.round(interval*(c.newInterval||0)));
      easeFactor=Math.max(1.3,easeFactor-0.2);
      stepIdx=0;ns='relearning';due=Date.now()+rs[0]*MIN;
    }else{
      // Intervallo: hard x1.2, good x ease, easy x ease x1.3
      if(rating==='hard'){interval=Math.round(interval*1.2);}
      else if(rating==='medium'){interval=Math.round(interval*easeFactor);}
      else{interval=Math.round(interval*easeFactor*1.3);}
      // EaseFactor secondo Anki: hard -0.15, good invariato, easy +0.15
      if(rating==='hard'){easeFactor=Math.max(1.3,Math.round((easeFactor-0.15)*1000)/1000);}
      else if(rating==='easy'){easeFactor=Math.min(Math.round((easeFactor+0.15)*1000)/1000,4.0);}
      // Minimo 4 giorni per review (Anki default), massimo maxInterval
      interval=Math.min(Math.max(interval,4),c.maxInterval);
      repetitions++;stepIdx=0;ns=interval>=21?'mature':'review';due=Date.now()+interval*DAY;
    }
  }

  const lt=c.leechThreshold||8;
  let suspended=card.suspended,isLeech=false;
  if(lapses>=lt&&!suspended){suspended=true;ns='suspended';isLeech=true;}
  return{interval,easeFactor,repetitions,lapses,stepIdx,status:ns,dueDate:due,suspended,isLeech};
}

function nextIv(card,rating){
  const c=cfg(card.deckId);
  const ls=getSteps(card.deckId,'learn'),rs=getSteps(card.deckId,'relearn');
  const{status,stepIdx,interval,easeFactor}=card;
  const fmt=m=>m<60?Math.round(m)+' min':m<1440?Math.round(m/60)+' h':Math.round(m/1440)+' gg';
  if(status==='new'||status==='learning'){
    if(rating==='again')return fmt(ls[0]);
    if(rating==='easy')return Math.min(Math.max(4,Math.round(ls[ls.length-1]/1440*easeFactor)),c.maxInterval)+' gg';
    if(rating==='medium'){const ni=stepIdx+1;if(ni>=ls.length)return Math.max(1,Math.round(ls[ls.length-1]/1440))+' gg';return fmt(ls[ni]);}
    // Hard: media tra step corrente e precedente
    const hardMin=stepIdx===0?ls[0]:(ls[stepIdx-1]+ls[stepIdx])/2;
    return fmt(hardMin);
  }
  if(status==='relearning'){
    if(rating==='again')return fmt(rs[0]);
    if(rating==='hard'){const hm=stepIdx===0?rs[0]:(rs[stepIdx-1]+rs[stepIdx])/2;return fmt(hm);}
    const ni=stepIdx+1;return ni>=rs.length?Math.max(1,Math.round(interval*0.5))+' gg':fmt(rs[ni]);
  }
  if(rating==='again')return fmt(rs[0]);
  if(rating==='hard')return Math.min(Math.max(Math.round(interval*1.2),4),c.maxInterval)+' gg';
  if(rating==='medium')return Math.min(Math.max(Math.round(interval*easeFactor),4),c.maxInterval)+' gg';
  return Math.min(Math.max(Math.round(interval*easeFactor*1.3),4),c.maxInterval)+' gg';
}

// ═══════════════ COMPUTED ═══════════════
function deckCounts(did){
  const now=Date.now(),tc=getTc(did),c=cfg(did);
  const rev=Math.min(S.cards.filter(x=>x.deckId===did&&!x.suspended&&(x.status==='review'||x.status==='mature')&&x.dueDate<=now).length,Math.max(0,c.revLimit-tc.revDone));
  const newC=Math.min(S.cards.filter(x=>x.deckId===did&&!x.suspended&&x.status==='new').length,Math.max(0,c.newLimit-tc.newDone));
  const learn=S.cards.filter(x=>x.deckId===did&&!x.suspended&&(x.status==='learning'||x.status==='relearning')&&x.dueDate<=now).length;
  return{rev,newC,learn};
}
function totalDue(){return S.decks.reduce((a,d)=>{const c=deckCounts(d.id);return a+c.rev+c.newC+c.learn;},0);}

// ═══════════════ SIDEBAR ═══════════════
function updateSidebar(){
  const due=totalDue();
  const b=document.getElementById('badge-tot');b.textContent=due;b.style.display=due>0?'':'none';
  document.getElementById('ft-cards').textContent=S.cards.length;
  document.getElementById('ft-due').textContent=due;
  document.getElementById('ft-streak').textContent=S.streak||0;
  const el=document.getElementById('sb-decks');
  if(!S.decks.length){el.innerHTML='<div class="no-decks">Nessun mazzo.<br>Premi <strong>+</strong> per crearne uno.</div>';return;}
  el.innerHTML=S.decks.map(d=>{
    const c=deckCounts(d.id),tot=c.rev+c.newC+c.learn;
    const parts=[];if(c.rev>0)parts.push(`<span class="rc">${c.rev}</span>`);if(c.newC>0)parts.push(`<span class="nc">${c.newC}</span>`);
    return`<div class="deck-item" onclick="studyDeck('${d.id}')">
      <div class="ddot" style="background:${d.color}"></div>
      <span class="dname">${esc(d.name)}</span>
      <div class="d-right">
        <div class="d-counts">${parts.join(' · ')||(tot===0?'<span style="color:var(--tx4)"><i class="bi bi-check2"></i></span>':'')}</div>
        <div class="d-btns">
          <button class="ibt" onclick="event.stopPropagation();openEditDeck('${d.id}')" title="Modifica"><i class="bi bi-pencil"></i></button>
          <button class="ibt del" onclick="event.stopPropagation();promptDelDeck('${d.id}')" title="Elimina"><i class="bi bi-trash3"></i></button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════ NAVIGATION ═══════════════
const TITLES={dashboard:'Panoramica',studyall:'Studia tutto',study:'Studio',manage:'Gestisci mazzi',add:'Aggiungi carta',browse:'Sfoglia carte',stats:'Statistiche',import:'Importa CSV',settings:'Impostazioni'};
function nav(name,opts={}){
  closeMob();
  const vid='view-'+(name==='studyall'?'study':name);
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(vid)?.classList.add('active');
  // Aggiorna nav-item attivo nella sidebar
  document.querySelectorAll('.nav-item').forEach(el=>{
    const oc=el.getAttribute('onclick')||'';
    el.classList.toggle('active',oc.includes(`'${name}'`));
  });
  view=name;
  document.getElementById('tb-title').textContent=TITLES[name]||name;
  const r=document.getElementById('tb-right');
  if(name==='dashboard')r.innerHTML=`<button class="btn btn-p btn-sm" onclick="nav('add')"><i class="bi bi-plus-lg"></i> Carta</button>`;
  else if(name==='manage')r.innerHTML=`<button class="btn btn-p btn-sm" onclick="openNewDeck()"><i class="bi bi-plus-lg"></i> Nuovo mazzo</button>`;
  else if(name==='browse')r.innerHTML=`<button class="btn btn-s btn-sm" onclick="exportCSV()"><i class="bi bi-download"></i> Esporta</button><button class="btn btn-p btn-sm" onclick="nav('add')"><i class="bi bi-plus-lg"></i> Carta</button>`;
  else r.innerHTML='';
  ({
    dashboard:renderDashboard,
    studyall:()=>startStudy(null),
    study:()=>startStudy(opts.deckId),
    manage:renderManage,
    add:()=>{buildSels();opts.editId?loadCardEdit(opts.editId):resetEditor();},
    browse:renderBrowse,
    stats:renderStats,
    import:()=>{buildSels();buildInlineSwatches();cancelInlineDeck();},
    settings:renderSettingsView,
  })[name]?.();
  updateSidebar();
}

// ═══════════════ DASHBOARD ═══════════════
function renderDashboard(){
  const due=totalDue();
  document.getElementById('dash-h1').innerHTML=due>0?`Hai <em>${due}</em> cart${due===1?'a':'e'} da ripassare.`:'Sei in pari. <em>Ottimo!</em>';
  document.getElementById('dash-sub').textContent=due>0?'Seleziona un mazzo qui sotto per iniziare.':'Aggiungi nuove carte o crea un nuovo mazzo.';
  const grid=document.getElementById('decks-grid');
  let html=S.decks.map(deck=>{
    const c=deckCounts(deck.id),all=S.cards.filter(x=>x.deckId===deck.id);
    const rev=all.filter(x=>x.repetitions>0).length,pct=all.length?Math.round(rev/all.length*100):0;
    const tot=c.rev+c.newC+c.learn;
    return`<div class="deck-card" style="--dc:${deck.color}">
      <div class="dk-stripe"></div>
      <div class="dk-body">
        <div class="dk-name">${esc(deck.name)}</div>
        <div class="dk-meta">${all.length} carte · ${pct}% revisionate</div>
        <div class="dk-prog"><div class="dk-prog-fill" style="width:${pct}%"></div></div>
      </div>
      <div class="dk-stats">
        <div class="dkst snew"><div class="dn">${c.newC}</div><div class="dl">Nuove</div></div>
        <div class="dkst slearn"><div class="dn">${c.learn}</div><div class="dl">In studio</div></div>
        <div class="dkst srev"><div class="dn">${c.rev}</div><div class="dl">Ripasso</div></div>
      </div>
      <div class="dk-actions">
        <button class="da-btn study" onclick="studyDeck('${deck.id}')"><i class="bi bi-play-fill"></i> ${tot>0?`Studia (${tot})`:'Studia'}</button>
        <button class="da-btn" onclick="nav('add');setTimeout(()=>{const s=document.getElementById('card-deck-sel');if(s)s.value='${deck.id}'},50)" title="Aggiungi carta"><i class="bi bi-plus-lg"></i></button>
        <button class="da-btn" onclick="openSettings('${deck.id}')" title="Impostazioni"><i class="bi bi-gear"></i></button>
        <button class="da-btn" onclick="openEditDeck('${deck.id}')" title="Modifica"><i class="bi bi-pencil"></i></button>
        <button class="da-btn danger" onclick="promptDelDeck('${deck.id}')" title="Elimina"><i class="bi bi-trash3"></i></button>
      </div>
    </div>`;
  }).join('');
  html+=`<div class="deck-add" onclick="openNewDeck()"><div class="plus">+</div><div class="lbl">Crea nuovo mazzo</div></div>`;
  grid.innerHTML=html;
}

// ═══════════════ STUDIO ═══════════════
function studyDeck(did){nav('study',{deckId:did});}

function startStudy(did){
  studyDid=did;sess={again:0,hard:0,good:0,easy:0,reviewed:0};againQ=[];undoStack=[];
  const now=Date.now();
  const decks=did?[did]:S.decks.map(d=>d.id);
  let revCards=[],newCards=[];
  decks.forEach(id=>{
    const c=cfg(id),tc=getTc(id);
    const rr=Math.max(0,c.revLimit-tc.revDone),nr=Math.max(0,c.newLimit-tc.newDone);
    // Solo review/mature nel budget rev; learning scadute vanno direttamente in againQ
    revCards.push(...S.cards.filter(x=>x.deckId===id&&!x.suspended&&(x.status==='review'||x.status==='mature')&&x.dueDate<=now).slice(0,rr));
    const rawN=S.cards.filter(x=>x.deckId===id&&!x.suspended&&x.status==='new');
    const ordN=c.newOrder==='random'?shuffle([...rawN]):rawN.sort((a,b)=>a.created-b.created);
    newCards.push(...ordN.slice(0,nr));
    // Carte learning/relearning scadute: caricale subito in againQ
    const lrnDue=S.cards.filter(x=>x.deckId===id&&!x.suspended&&(x.status==='learning'||x.status==='relearning')&&x.dueDate<=now);
    againQ.push(...lrnDue.map(c=>({card:c,phase:'learn'})));
  });
  studyQ=[...revCards.map(c=>({card:c,phase:'rev'})),...newCards.map(c=>({card:c,phase:'new'}))];
  renderStudyCard();
}

function getCur(){
  const now=Date.now();
  // Le carte learning con dueDate scaduta hanno priorità assoluta
  const learnIdx=againQ.findIndex(i=>i.card.dueDate<=now);
  if(learnIdx!==-1)return{item:againQ[learnIdx],fromAgain:true,idx:learnIdx};
  // Poi la coda principale
  if(studyQ.length>0)return{item:studyQ[0],fromAgain:false,idx:0};
  // Carte learning ancora in attesa: mostra il tempo rimanente
  if(againQ.length>0){
    const next=againQ.reduce((a,b)=>a.card.dueDate<b.card.dueDate?a:b);
    const wait=Math.ceil((next.card.dueDate-now)/1000);
    return{item:null,waiting:true,waitSec:wait};
  }
  return null;
}

function renderStudyCard(){
  const wrap=document.getElementById('study-wrap');
  const cur=getCur();

  // Stato "in attesa" — tutte le carte main sono finite ma alcune learning non sono ancora scadute
  if(cur?.waiting){
    let sec=cur.waitSec;
    wrap.innerHTML=`<div class="done-box">
      <div class="done-icon"><i class="bi bi-hourglass-split" style="color:var(--tx2)"></i></div>
      <h2 style="color:var(--tx)">In attesa…</h2>
      <p id="wait-msg">Prossima carta tra <strong>${sec}</strong> secondi</p>
      <div class="done-btns"><button class="btn btn-g" onclick="nav('dashboard')">← Panoramica</button></div>
    </div>`;
    const t=setInterval(()=>{
      sec--;
      const el=document.getElementById('wait-msg');
      if(!el){clearInterval(t);return;}
      if(sec<=0){clearInterval(t);renderStudyCard();}
      else el.innerHTML=`Prossima carta tra <strong>${sec}</strong> secondi`;
    },1000);
    document.title='Mnemosyne';
    return;
  }

  if(!cur){renderDone();return;}
  const{item}=cur,card=item.card,deck=getDeck(card.deckId);
  const done=sess.reviewed,tot=studyQ.length+againQ.length;
  const pct=done+tot>0?Math.round(done/(done+tot)*100):0;
  const c=cfg(card.deckId),ls=getSteps(card.deckId,'learn');
  const isL=card.status==='learning'||card.status==='new',isRL=card.status==='relearning';
  let stepInfo='';
  if(isL&&ls.length>1)stepInfo=`Passo ${card.stepIdx+1}/${ls.length}`;
  else if(isRL)stepInfo='Reapprendimento';

  // Contatori sessione
  const revLeft=studyQ.filter(i=>i.phase==='rev').length;
  const newLeft=studyQ.filter(i=>i.phase==='new').length;
  const lrnLeft=againQ.length;
  const countsHtml=`<div class="sess-counts">
    ${revLeft>0?`<span class="sc rev"><i class="bi bi-arrow-repeat"></i> ${revLeft} ripasso</span>`:''}
    ${newLeft>0?`<span class="sc newc"><i class="bi bi-stars"></i> ${newLeft} nuove</span>`:''}
    ${againQ.length>0?`<span class="sc lrn"><i class="bi bi-arrow-clockwise"></i> ${againQ.length} carta${againQ.length===1?'':'e'} da ripetere</span>`:''}
    ${sess.again>0?`<span class="sc err"><i class="bi bi-x"></i> ${sess.again} errori</span>`:''}
  </div>`;

  // Titolo tab dinamico
  const remaining=tot;
  document.title=remaining>0?`(${remaining}) Mnemosyne`:'Mnemosyne';

  wrap.innerHTML=`
    <div class="study-top">
      <span class="study-lbl">${esc(deck?.name||'Tutti i mazzi')}</span>
      <div class="prog-w"><div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div><span class="prog-txt">${done}/${done+tot}</span></div>
    </div>
    ${countsHtml}
    <div class="flashcard" id="fc">
      ${card.tags?`<div class="card-tag">${esc(card.tags.split(',')[0].trim())}</div>`:''}
      ${card.lapses>=(c.leechThreshold-1)?`<div class="card-leech"><i class="bi bi-exclamation-triangle-fill"></i> Leech (${card.lapses} err.)</div>`:''}
      ${stepInfo?`<div class="card-step">${stepInfo}</div>`:''}
      <div class="card-q" id="cq">${esc(card.front)}</div>
      <div class="card-sep"></div>
      <div class="card-a" id="ca">${esc(card.back)}</div>
      <div class="card-hint" id="chint">Tocca · swipe · <span class="kbd">spazio</span></div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px">
      <button class="show-btn" style="flex:1" id="show-btn" onclick="reveal()">Mostra risposta</button>
      <button class="btn btn-g" style="min-width:44px" onclick="buryCurrent()" title="Rimanda a domani"><i class="bi bi-skip-forward-fill"></i></button>
      <button class="btn btn-g" style="min-width:44px" id="undo-btn" onclick="undoLast()" title="Annulla ultima valutazione" ${undoStack.length===0?'disabled':''}><i class="bi bi-arrow-counterclockwise"></i></button>
      <button class="btn btn-g" style="min-width:44px" onclick="editCurrent()" title="Modifica questa carta"><i class="bi bi-pencil"></i></button>
    </div>
    <div class="rating-grid" id="rg">
      <button class="rate-btn again" id="rb-again" onclick="rate('again')">Di nuovo<div class="iv">${nextIv(card,'again')}</div></button>
      <button class="rate-btn hard"  id="rb-hard"  onclick="rate('hard')">Difficile<div class="iv">${nextIv(card,'hard')}</div></button>
      <button class="rate-btn good"  id="rb-good"  onclick="rate('medium')">Medio<div class="iv">${nextIv(card,'medium')}</div></button>
      <button class="rate-btn easy"  id="rb-easy"  onclick="rate('easy')">Facile<div class="iv">${nextIv(card,'easy')}</div></button>
    </div>
    <div class="kbd-hint"><span class="kbd">1</span> Di nuovo &nbsp;<span class="kbd">2</span> Difficile &nbsp;<span class="kbd">3</span> Bene &nbsp;<span class="kbd">4</span> Facile &nbsp;<span class="kbd">B</span> Rimanda &nbsp;<span class="kbd">Z</span> Annulla</div>`;
  typeset([document.getElementById('fc')]);
}

function typeset(els){if(window.MathJax?.typesetPromise)MathJax.typesetPromise(els).catch(()=>{});}

function reveal(){
  const ca=document.getElementById('ca'),rg=document.getElementById('rg');
  const sb=document.getElementById('show-btn'),ch=document.getElementById('chint');
  if(!ca||ca.classList.contains('shown'))return;
  ca.classList.add('shown');rg.classList.add('shown');
  const kh = document.querySelector('.kbd-hint');
  if(sb)sb.style.display='none'; if(ch)ch.style.display='none'; if(kh)kh.style.display='';
  typeset([ca]);
}

function rate(rating){
  const cur=getCur();if(!cur||cur.waiting)return;
  const{item,fromAgain,idx}=cur,card=item.card;
  const wasNew=item.phase==='new'||card.status==='new'||card.status==='learning';

  // Feedback visivo sul pulsante
  const btnMap={again:'rb-again',hard:'rb-hard',good:'rb-good',easy:'rb-easy'};
  const btn=document.getElementById(btnMap[rating]);
  if(btn){btn.classList.add('flash');setTimeout(()=>btn.classList.remove('flash'),250);}

  // Salva snapshot per undo (max 1 livello)
  const tcSnap=JSON.parse(JSON.stringify(getTc(card.deckId)));
  const cardSnap=JSON.parse(JSON.stringify(card));
  const sessSnap={...sess};
  undoStack=[{cardSnap,item:JSON.parse(JSON.stringify(item)),fromAgain,idx,tcSnap,sessSnap,rating,wasNew}];

  const upd=sm2(card,rating);
  Object.assign(card,upd);
  const i=S.cards.findIndex(c=>c.id===card.id);if(i!==-1)Object.assign(S.cards[i],upd);

  if(rating!=='again'){
    const originalPhase=item.phase;
    if(originalPhase==='new')incTc(card.deckId,'new');
    else if(originalPhase==='rev')incTc(card.deckId,'rev');
    // phase='learn': non consuma né newDone né revDone (già contata alla prima valutazione)
  }
  sess[rating]++;sess.reviewed++;
  S.reviews.push({date:Date.now(),deckId:card.deckId,rating});
  S.studyLog.push({date:Date.now(),deckId:card.deckId,rating,wasNew});
  updateStreak();
  if(upd.isLeech)toast(`Carta sospesa automaticamente (${upd.lapses} errori)`);

  // Gestione coda: rimuovi dalla posizione corretta
  if(fromAgain)againQ.splice(idx,1);else studyQ.shift();

  // Se "Di nuovo" o carta ancora in learning: rimetti in againQ con il nuovo dueDate
  if(rating==='again'||(upd.status==='learning'||upd.status==='relearning')){
    // Aggiorna la card nell'item con i nuovi dati
    item.card=S.cards.find(c=>c.id===card.id)||card;
    againQ.push(item);
  }

  save();
  updateSidebar();
  // Piccolo delay per far vedere il flash prima di cambiare carta
  setTimeout(renderStudyCard,120);
}

function undoLast(){
  if(!undoStack.length){toast('Niente da annullare.');return;}
  const{cardSnap,item,fromAgain,idx,tcSnap,sessSnap,rating,wasNew}=undoStack.pop();
  // Ripristina la carta
  const i=S.cards.findIndex(c=>c.id===cardSnap.id);
  if(i!==-1)Object.assign(S.cards[i],cardSnap);
  Object.assign(item.card,cardSnap);
  // Ripristina contatori sessione
  Object.assign(sess,sessSnap);
  // Ripristina today counts
  const k=todayKey();
  if(S.todayCounts[k]&&S.todayCounts[k][cardSnap.deckId])Object.assign(S.todayCounts[k][cardSnap.deckId],tcSnap);
  // Ripristina la carta nella coda giusta
  // Rimuovi eventuale copia in againQ aggiunta da rate()
  const inAgain=againQ.findIndex(x=>x.card.id===cardSnap.id);
  if(inAgain!==-1)againQ.splice(inAgain,1);
  // Rimetti in testa alla coda originale
  if(fromAgain)againQ.unshift(item);else studyQ.unshift(item);
  // Rimuovi l'ultimo review log
  S.reviews.pop();S.studyLog.pop();
  save();undoStack=[];toast('Ultima valutazione annullata.');renderStudyCard();
}

function buryCurrent(){
  const cur=getCur();if(!cur||cur.waiting)return;
  const{item,fromAgain,idx}=cur,card=item.card;
  // Sposta la dueDate a domani
  const tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);tomorrow.setHours(4,0,0,0);
  card.dueDate=tomorrow.getTime();
  const i=S.cards.findIndex(c=>c.id===card.id);if(i!==-1)S.cards[i].dueDate=card.dueDate;
  if(fromAgain)againQ.splice(idx,1);else studyQ.shift();
  save();toast('Carta rimandata a domani.');renderStudyCard();
}

function editCurrent(){
  const cur=getCur();if(!cur||cur.waiting)return;
  const card=cur.item.card;
  // Apri l'editor in una nuova tab mantenendo la sessione attiva
  nav('add',{editId:card.id});
}

function renderDone(){
  const tot=sess.reviewed,corr=sess.good+sess.easy,pct=tot>0?Math.round(corr/tot*100):0;
  document.getElementById('study-wrap').innerHTML=`<div class="done-box">
    <div class="done-icon"><i class="bi bi-patch-check-fill" style="color:var(--ac)"></i></div><h2>Sessione completata!</h2>
    <p>Hai ripassato tutte le carte disponibili per oggi.</p>
    <div class="done-row">
      <div class="done-stat"><div class="dn" style="color:var(--gr)">${corr}</div><div class="dl">Corrette</div></div>
      <div class="done-stat"><div class="dn" style="color:var(--re)">${sess.again}</div><div class="dl">Errori</div></div>
      <div class="done-stat"><div class="dn">${pct}%</div><div class="dl">Precisione</div></div>
      <div class="done-stat"><div class="dn">${tot}</div><div class="dl">Totale</div></div>
    </div>
    <div class="done-btns">
      <button class="btn btn-g" onclick="nav('dashboard')"><i class="bi bi-arrow-left"></i> Panoramica</button>
      ${studyDid?`<button class="btn btn-p" onclick="studyDeck('${studyDid}')">Studia ancora</button>`:''}
    </div>
  </div>`;
}

function updateStreak(){
  const today=new Date().toDateString(),yest=new Date(Date.now()-DAY).toDateString();
  // Controlla se almeno una carta è stata completata oggi in qualsiasi mazzo
  const doneSomething=Object.values(S.todayCounts[todayKey()]||{}).some(tc=>(tc.newDone||0)+(tc.revDone||0)>0);
  if(!doneSomething)return;
  if(S.lastStudyDate!==today){S.streak=S.lastStudyDate===yest?(S.streak||0)+1:1;S.lastStudyDate=today;}
}

// Swipe per rivelare (mobile)
let tx=0,ty=0;
document.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY;},{passive:true});
document.addEventListener('touchend',e=>{
  if(view!=='study')return;
  const dx=e.changedTouches[0].clientX-tx,dy=Math.abs(e.changedTouches[0].clientY-ty);
  if(dy<40&&dx>60)reveal();
},{passive:true});

// ═══════════════ GESTISCI MAZZI ═══════════════
function renderManage(){
  const body=document.getElementById('manage-body');
  if(!S.decks.length){body.innerHTML=`<div class="empty"><div class="empty-ico"><i class="bi bi-journals"></i></div><h3>Nessun mazzo</h3><p>Crea il tuo primo mazzo.</p><button class="btn btn-p" onclick="openNewDeck()"><i class="bi bi-plus-lg"></i> Nuovo mazzo</button></div>`;return;}
  const isMob=window.innerWidth<=640;
  if(isMob){
    body.innerHTML=`<div class="mgmt-cards">${S.decks.map(d=>{
      const all=S.cards.filter(c=>c.deckId===d.id),susp=all.filter(c=>c.suspended).length,c=d.settings||DEF;
      return`<div class="mgmt-card">
        <div class="mgmt-card-head">
          <div class="ddot" style="background:${d.color};width:9px;height:9px;border-radius:50%;flex-shrink:0"></div>
          <strong style="flex:1;font-size:14.5px">${esc(d.name)}</strong>
        </div>
        <div class="mgmt-card-body">
          <div class="mgmt-card-stat"><div class="mn">${all.length}</div><div class="ml">Carte</div></div>
          <div class="mgmt-card-stat"><div class="mn">${c.newLimit}</div><div class="ml">Nuove/gg</div></div>
          <div class="mgmt-card-stat"><div class="mn" style="${susp>0?'color:var(--re)':''}">${susp||'—'}</div><div class="ml">Sospese</div></div>
        </div>
        <div class="mgmt-card-actions">
          <button class="btn btn-g" onclick="openSettings('${d.id}')"><i class="bi bi-gear"></i> Impost.</button>
          <button class="btn btn-g" onclick="openEditDeck('${d.id}')"><i class="bi bi-pencil"></i> Modifica</button>
          <button class="btn btn-d" onclick="promptDelDeck('${d.id}')"><i class="bi bi-trash3"></i></button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }else{
    body.innerHTML=`<div class="tbl-wrap"><table class="mgmt-tbl">
      <thead><tr><th>Mazzo</th><th>Carte</th><th>Nuove/giorno</th><th>Ripassi/giorno</th><th>Sospese</th><th></th></tr></thead>
      <tbody>${S.decks.map(d=>{
        const all=S.cards.filter(c=>c.deckId===d.id),susp=all.filter(c=>c.suspended).length,c=d.settings||DEF;
        return`<tr>
          <td><span class="cdot" style="background:${d.color}"></span><strong>${esc(d.name)}</strong></td>
          <td style="color:var(--tx2)">${all.length}</td><td style="color:var(--tx2)">${c.newLimit}</td><td style="color:var(--tx2)">${c.revLimit}</td>
          <td>${susp>0?`<span style="color:var(--re)">${susp}</span>`:'—'}</td>
          <td><div class="td-acts">
            <button class="btn btn-g btn-xs" onclick="openSettings('${d.id}')"><i class="bi bi-gear"></i> Impostazioni</button>
            <button class="btn btn-g btn-xs" onclick="openEditDeck('${d.id}')"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-d btn-xs" onclick="promptDelDeck('${d.id}')"><i class="bi bi-trash3"></i></button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }
}

// ═══════════════ ADD/EDIT CARD ═══════════════
function buildSels(){
  const opts=S.decks.length?S.decks.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join(''):'<option value="">Nessun mazzo</option>';
  ['card-deck-sel','import-deck-sel'].forEach(id=>{const el=document.getElementById(id);if(el)el.innerHTML=opts;});
  const bf=document.getElementById('browse-deck-f');
  if(bf)bf.innerHTML='<option value="">Tutti i mazzi</option>'+S.decks.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('');
}
function updatePreview(){
  const q=document.getElementById('card-front')?.value.trim()||'';
  const a=document.getElementById('card-back')?.value.trim()||'';
  const pq=document.getElementById('prev-q'),pa=document.getElementById('prev-a');
  pq.textContent=q||'La domanda apparirà qui';pq.classList.toggle('ok',!!q);
  pa.textContent=a||'La risposta';pa.classList.toggle('ok',!!a);
  if(q||a)typeset([pq,pa]);
}
function saveCard(addAnother){
  const front=document.getElementById('card-front').value.trim();
  const back=document.getElementById('card-back').value.trim();
  const deckId=document.getElementById('card-deck-sel').value;
  const tags=document.getElementById('card-tags').value.trim();
  const editId=document.getElementById('edit-card-id').value;
  if(!front||!back){toast('Compila domanda e risposta.');return;}
  if(!deckId){toast('Crea almeno un mazzo prima.');return;}
  if(editId){const i=S.cards.findIndex(c=>c.id===editId);if(i!==-1)Object.assign(S.cards[i],{front,back,tags,deckId});toast('Carta aggiornata!');document.getElementById('edit-card-id').value='';}
  else{S.cards.push(mkCard(deckId,front,back,tags));toast('Carta salvata!');}
  save();if(addAnother)resetEditor();else nav('browse');
}
function resetEditor(){
  ['card-front','card-back','card-tags'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('edit-card-id').value='';
  document.getElementById('editor-h2').textContent='Aggiungi una carta';
  document.getElementById('save-btn').textContent='Salva carta';
  updatePreview();
}
function loadCardEdit(id){
  const c=S.cards.find(c=>c.id===id);if(!c)return;
  buildSels();
  document.getElementById('card-front').value=c.front;
  document.getElementById('card-back').value=c.back;
  document.getElementById('card-tags').value=c.tags||'';
  document.getElementById('card-deck-sel').value=c.deckId;
  document.getElementById('edit-card-id').value=id;
  document.getElementById('editor-h2').textContent='Modifica carta';
  document.getElementById('save-btn').textContent='Aggiorna carta';
  updatePreview();
}

// ═══════════════ BROWSE ═══════════════
let browseSort={col:'created',dir:1};
function setBrowseSort(col){
  if(browseSort.col===col)browseSort.dir*=-1;else{browseSort.col=col;browseSort.dir=1;}
  renderBrowse();
}
function renderBrowse(){
  buildSels();
  const search=(document.getElementById('browse-search')?.value||'').toLowerCase();
  const df=document.getElementById('browse-deck-f')?.value||'';
  const sf=document.getElementById('browse-status-f')?.value||'';
  let cards=S.cards;
  if(df)cards=cards.filter(c=>c.deckId===df);
  if(sf)cards=cards.filter(c=>sf==='suspended'?c.suspended:c.status===sf);
  if(search)cards=cards.filter(c=>c.front.toLowerCase().includes(search)||c.back.toLowerCase().includes(search)||(c.tags||'').toLowerCase().includes(search));
  // Ordinamento
  const{col,dir}=browseSort;
  cards=[...cards].sort((a,b)=>{
    let va=a[col]??0,vb=b[col]??0;
    if(typeof va==='string')va=va.toLowerCase(),vb=String(vb).toLowerCase();
    return va<vb?-dir:va>vb?dir:0;
  });
  document.getElementById('browse-count').textContent=`${cards.length} carta${cards.length===1?'':'e'}`;
  const body=document.getElementById('browse-body');
  if(!cards.length){body.innerHTML=`<div class="empty"><div class="empty-ico"><i class="bi bi-search"></i></div><h3>Nessuna carta trovata</h3><p>${search?'Prova un termine diverso.':'Aggiungi la tua prima carta.'}</p><button class="btn btn-p" onclick="nav('add')"><i class="bi bi-plus-lg"></i> Aggiungi carta</button></div>`;return;}
  const sm={new:'Nuova',learning:'In studio',relearning:'Reapprend.',review:'Ripasso',mature:'Matura',suspended:'Sospesa'};
  const sc={new:'s-new',learning:'s-learning',relearning:'s-relearning',review:'s-review',mature:'s-mature',suspended:'s-suspended'};
  const isMob=window.innerWidth<=640;
  if(isMob){
    body.innerHTML=`<div class="browse-mob-cards">${cards.map(c=>{
      const d=getDeck(c.deckId),sk=c.suspended?'suspended':c.status;
      return`<div class="mgmt-card">
        <div class="mgmt-card-head" style="gap:10px;flex-wrap:nowrap">
          <span class="status-pill ${sc[sk]||'s-new'}" style="flex-shrink:0">${sm[sk]||'Nuova'}</span>
          <span style="flex:1;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.front)}">${esc(c.front)}</span>
        </div>
        <div style="padding:8px 14px 10px;font-size:13px;color:var(--tx2);line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${esc(c.back)}</div>
        <div style="padding:0 14px 10px;display:flex;gap:10px;font-size:11px;color:var(--tx3)">
          ${d?`<span><span class="cdot" style="background:${d.color}"></span>${esc(d.name)}</span>`:''}
          <span>Ripasso: ${fmtDate(c.dueDate)}</span>
          ${c.interval>0?`<span>Int: ${c.interval}gg</span>`:''}
          ${c.lapses>0?`<span style="color:var(--re)">Err: ${c.lapses}</span>`:''}
        </div>
        <div class="mgmt-card-actions">
          ${c.suspended?`<button class="btn btn-g" onclick="toggleSusp('${c.id}')"><i class="bi bi-play-fill"></i> Riattiva</button>`:`<button class="btn btn-g" onclick="toggleSusp('${c.id}')"><i class="bi bi-pause-fill"></i> Sospendi</button>`}
          <button class="btn btn-g" onclick="nav('add',{editId:'${c.id}'})"><i class="bi bi-pencil"></i> Modifica</button>
          <button class="btn btn-d" onclick="promptDelCard('${c.id}')"><i class="bi bi-trash3"></i></button>
        </div>
      </div>`;
    }).join('')}</div>`;
  }else{
    body.innerHTML=`<div class="tbl-wrap"><table class="ct">
      <thead><tr>
        <th onclick="setBrowseSort('front')" style="cursor:pointer">Domanda ${browseSort.col==='front'?(browseSort.dir===1?'↑':'↓'):''}</th>
        <th>Risposta</th>
        <th>Mazzo</th>
        <th onclick="setBrowseSort('status')" style="cursor:pointer">Stato ${browseSort.col==='status'?(browseSort.dir===1?'↑':'↓'):''}</th>
        <th onclick="setBrowseSort('dueDate')" style="cursor:pointer">Prossimo ripasso ${browseSort.col==='dueDate'?(browseSort.dir===1?'↑':'↓'):''}</th>
        <th onclick="setBrowseSort('interval')" style="cursor:pointer">Int. ${browseSort.col==='interval'?(browseSort.dir===1?'↑':'↓'):''}</th>
        <th onclick="setBrowseSort('lapses')" style="cursor:pointer">Err. ${browseSort.col==='lapses'?(browseSort.dir===1?'↑':'↓'):''}</th>
        <th></th>
      </tr></thead>
      <tbody>${cards.map(c=>{
        const d=getDeck(c.deckId),sk=c.suspended?'suspended':c.status;
        return`<tr>
          <td class="td-clip" title="${esc(c.front)}">${esc(c.front)}</td>
          <td class="td-clip" style="color:var(--tx2)" title="${esc(c.back)}">${esc(c.back)}</td>
          <td><span class="cdot" style="background:${d?.color||'#888'}"></span>${esc(d?.name||'—')}</td>
          <td><span class="status-pill ${sc[sk]||'s-new'}">${sm[sk]||'Nuova'}</span></td>
          <td style="font-size:12px;color:var(--tx2)">${fmtDate(c.dueDate)}</td>
          <td style="font-size:12px;color:var(--tx3)">${c.interval>0?c.interval+'gg':'—'}</td>
          <td style="font-size:12px;color:${c.lapses>0?'var(--re)':'var(--tx3)'}">${c.lapses||0}</td>
          <td><div class="td-acts">
            ${c.suspended?`<button class="btn btn-g btn-xs" onclick="toggleSusp('${c.id}')"><i class="bi bi-play-fill"></i></button>`:`<button class="btn btn-g btn-xs" onclick="toggleSusp('${c.id}')"><i class="bi bi-pause-fill"></i></button>`}
            <button class="btn btn-g btn-xs" onclick="nav('add',{editId:'${c.id}'})"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-d btn-xs" onclick="promptDelCard('${c.id}')"><i class="bi bi-trash3"></i></button>
          </div></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`;
  }
}
function toggleSusp(id){
  const c=S.cards.find(c=>c.id===id);if(!c)return;
  c.suspended=!c.suspended;
  if(!c.suspended)c.status=c.repetitions>0?(c.interval>=21?'mature':'review'):'new';
  else c.status='suspended';
  save();renderBrowse();updateSidebar();toast(c.suspended?'Carta sospesa.':'Carta riattivata.');
}

// ═══════════════ STATISTICHE ═══════════════
function renderStats(){
  const tabs=document.getElementById('stats-tabs');
  tabs.innerHTML=`<div class="stats-tab${!statsDid?' active':''}" onclick="setStatsDid(null)">Globale</div>`+
    S.decks.map(d=>`<div class="stats-tab${statsDid===d.id?' active':''}" onclick="setStatsDid('${d.id}')">${esc(d.name)}</div>`).join('');
  renderStatsBody();
}
function setStatsDid(did){statsDid=did;renderStats();}
function renderStatsBody(){
  const did=statsDid;
  const cards=did?S.cards.filter(c=>c.deckId===did):S.cards;
  const revs=did?S.reviews.filter(r=>r.deckId===did):S.reviews;
  const total=cards.length,mature=cards.filter(c=>c.status==='mature').length;
  const susp=cards.filter(c=>c.suspended).length,leeches=cards.filter(c=>c.lapses>=4).length;
  const todayRevs=revs.filter(r=>new Date(r.date).toDateString()===new Date().toDateString()).length;
  const dist={new:0,learning:0,relearning:0,review:0,mature:0,suspended:0};
  cards.forEach(c=>{const k=c.suspended?'suspended':c.status;dist[k]=(dist[k]||0)+1;});
  const fc=[];for(let i=0;i<7;i++){const d=new Date();d.setDate(d.getDate()+i);d.setHours(0,0,0,0);const e=new Date(d);e.setDate(e.getDate()+1);fc.push({l:i===0?'Oggi':i===1?'Dom':`+${i}gg`,n:cards.filter(c=>!c.suspended&&c.dueDate>=d.getTime()&&c.dueDate<e.getTime()).length});}
  const maxFc=Math.max(...fc.map(f=>f.n),1);
  const body=document.getElementById('stats-body');
  const distItems=[
    ['new','Nuove','var(--bl)'],['learning','In studio','var(--or)'],
    ['relearning','Reapprend.','var(--re)'],['review','Ripasso','var(--gr)'],
    ['mature','Mature','var(--ac)'],['suspended','Sospese','var(--tx3)']
  ].filter(([k])=>dist[k]>0);
  body.innerHTML=`
    <div class="stats-grid">
      <div class="stat-card"><div class="sbig">${total}</div><div class="slabel">Carte totali</div></div>
      <div class="stat-card"><div class="sbig">${mature}</div><div class="slabel">Mature</div></div>
      <div class="stat-card"><div class="sbig">${revs.length}</div><div class="slabel">Ripassi totali</div></div>
      <div class="stat-card"><div class="sbig">${todayRevs}</div><div class="slabel">Oggi</div></div>
      <div class="stat-card"><div class="sbig">${S.streak||0}</div><div class="slabel">Streak</div></div>
      <div class="stat-card"><div class="sbig">${susp}</div><div class="slabel">Sospese</div></div>
      <div class="stat-card"><div class="sbig">${leeches}</div><div class="slabel">Leech</div></div>
      <div class="stat-card"><div class="sbig">${revs.length&&S.streak?Math.round(revs.length/Math.max(S.streak,1)):0}</div><div class="slabel">Rip./giorno</div></div>
    </div>
    ${distItems.length?`<div class="chart-box">
      <h3>Distribuzione stati</h3>
      <div class="dist-pills">
        ${distItems.map(([k,l,col])=>`<div class="dist-pill"><div class="dist-n" style="color:${col}">${dist[k]}</div><div class="dist-l">${l}</div></div>`).join('')}
      </div>
    </div>`:''}
    <div class="chart-box">
      <h3>Ripassi previsti · 7 giorni</h3>
      <div class="fc-bars">
        ${fc.map(f=>`<div class="fc-col"><div class="fc-n">${f.n}</div><div class="fc-bar-wrap"><div class="fc-bar" style="height:${Math.round(f.n/maxFc*60)+2}px"></div></div><div class="fc-l">${f.l}</div></div>`).join('')}
      </div>
    </div>
    <div class="chart-box"><h3>Attività · ultime 12 settimane</h3><div class="heatmap" id="heatmap"></div></div>
    <div class="chart-box stats-chart-last"><h3>Ripassi per mazzo</h3><canvas id="bar-chart" height="120"></canvas></div>`;
  const byDay={};revs.forEach(r=>{const d=new Date(r.date).toDateString();byDay[d]=(byDay[d]||0)+1;});
  document.getElementById('heatmap').innerHTML=Array.from({length:84},(_,i)=>{const d=new Date(Date.now()-(83-i)*DAY).toDateString();const n=byDay[d]||0;return`<div class="hm-cell${n===0?'':n<5?' l1':n<15?' l2':n<30?' l3':' l4'}" title="${d}: ${n}"></div>`;}).join('');
  if(barChart){barChart.destroy();barChart=null;}
  const ctx=document.getElementById('bar-chart')?.getContext('2d');
  if(ctx){
    const show=did?[getDeck(did)].filter(Boolean):S.decks;
    barChart=new Chart(ctx,{type:'bar',data:{labels:show.map(d=>d.name),datasets:[{data:show.map(d=>S.reviews.filter(r=>r.deckId===d.id).length),backgroundColor:show.map(d=>d.color+'88'),borderColor:show.map(d=>d.color),borderWidth:1.5,borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#8a8680',font:{family:'DM Sans'}},grid:{color:'rgba(255,255,255,0.04)'}},y:{ticks:{color:'#8a8680',font:{family:'DM Sans'}},grid:{color:'rgba(255,255,255,0.04)'}}}}});
  }
}

// ═══════════════ IMPORT / EXPORT ═══════════════
function parseCSV(text){const rows=[];for(const line of text.split(/\r?\n/).filter(l=>l.trim())){const cols=csvSplit(line);if(cols.length>=2){const f=cols[0].trim(),b=cols.slice(1).join(',').trim();if(f&&b)rows.push({front:f,back:b});}}return rows;}
function csvSplit(line){const cols=[];let cur='',inQ=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(inQ&&line[i+1]==='"'){cur+='"';i++;}else inQ=!inQ;}else if(ch===','&&!inQ){cols.push(cur);cur='';}else cur+=ch;}cols.push(cur);return cols;}
function loadFile(inp){const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=e=>processImport(e.target.result);r.readAsText(f,'UTF-8');}
function dragOver(e){e.preventDefault();document.getElementById('import-zone').classList.add('drag');}
function dragLeave(){document.getElementById('import-zone').classList.remove('drag');}
function dropFile(e){e.preventDefault();dragLeave();const f=e.dataTransfer.files[0];if(!f)return;const r=new FileReader();r.onload=ev=>processImport(ev.target.result);r.readAsText(f,'UTF-8');}
function processImport(text){
  importParsed=parseCSV(text);
  if(!importParsed.length){toast('Nessuna carta trovata.');return;}
  document.getElementById('import-count').textContent=importParsed.length;
  document.getElementById('import-n').textContent=importParsed.length;
  document.getElementById('import-list').innerHTML=importParsed.slice(0,8).map(c=>`<div class="prev-row"><div style="margin-bottom:2px">${esc(c.front.slice(0,80))}${c.front.length>80?'…':''}</div><div style="color:var(--tx2);font-size:12px">${esc(c.back.slice(0,80))}${c.back.length>80?'…':''}</div></div>`).join('')+(importParsed.length>8?`<div class="prev-row" style="color:var(--tx3);font-size:12px">…e altre ${importParsed.length-8} carte</div>`:'');
  document.getElementById('import-preview').style.display='';
}
function confirmImport(){
  const did=document.getElementById('import-deck-sel').value;
  if(!did){toast('Seleziona un mazzo.');return;}
  S.cards.push(...importParsed.map(c=>mkCard(did,c.front,c.back,'')));
  save();toast(`${importParsed.length} carte importate!`);cancelImport();nav('browse');
}
function cancelImport(){importParsed=[];document.getElementById('import-preview').style.display='none';document.getElementById('file-input').value='';}
function exportCSV(){
  const df=document.getElementById('browse-deck-f')?.value||'';
  const cards=df?S.cards.filter(c=>c.deckId===df):S.cards;
  if(!cards.length){toast('Nessuna carta da esportare.');return;}
  const csv=cards.map(c=>{const q=c.front.includes(',')?`"${c.front.replace(/"/g,'""')}"`:c.front;const a=c.back.includes(',')?`"${c.back.replace(/"/g,'""')}"`:c.back;return`${q},${a}`;}).join('\n');
  dl(new Blob([csv],{type:'text/csv;charset=utf-8'}),'mnemosyne_export.csv');toast('CSV esportato!');
}
function exportBackup(){dl(new Blob([JSON.stringify(S,null,2)],{type:'application/json'}),`mnemosyne_backup_${new Date().toISOString().slice(0,10)}.json`);toast('Backup esportato!');}
function importBackup(inp){const f=inp.files[0];if(!f)return;const r=new FileReader();r.onload=e=>{try{const d=JSON.parse(e.target.result);if(!d.decks||!d.cards)throw 0;S=d;save();nav('dashboard');toast('Backup ripristinato!');}catch{toast('File non valido.');}};r.readAsText(f,'UTF-8');}
function dl(blob,name){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);}

// Inline nuovo mazzo
function buildInlineSwatches(){const el=document.getElementById('inline-swatches');if(!el)return;el.innerHTML=COLORS.map(c=>`<div class="cswatch${c===inlineColor?' active':''}" style="background:${c}" onclick="pickInline(this,'${c}')"></div>`).join('');}
function pickInline(el,c){inlineColor=c;document.querySelectorAll('#inline-swatches .cswatch').forEach(s=>s.classList.remove('active'));el.classList.add('active');}
function openInlineNewDeck(){document.getElementById('inline-new').style.display='block';document.getElementById('import-new-btn').style.display='none';buildInlineSwatches();}
function cancelInlineDeck(){document.getElementById('inline-new').style.display='none';document.getElementById('import-new-btn').style.display='';}
function createInlineDeck(){
  const name=document.getElementById('inline-name').value.trim();
  if(!name){toast('Inserisci un nome.');return;}
  const d={id:uid(),name,color:inlineColor,created:Date.now(),settings:{...DEF}};
  S.decks.push(d);save();buildSels();
  document.getElementById('import-deck-sel').value=d.id;
  cancelInlineDeck();toast(`Mazzo "${name}" creato!`);updateSidebar();
}

// ═══════════════ DECK CRUD ═══════════════
function buildSwatches(cid,cur){document.getElementById(cid).innerHTML=COLORS.map(c=>`<div class="cswatch${c===cur?' active':''}" style="background:${c}" onclick="pickColor(this,'${c}','${cid}')"></div>`).join('');}
function pickColor(el,c,cid){selColor=c;document.querySelectorAll(`#${cid} .cswatch`).forEach(s=>s.classList.remove('active'));el.classList.add('active');}
function openNewDeck(){selColor=COLORS[0];document.getElementById('deck-name-inp').value='';document.getElementById('edit-deck-id').value='';document.getElementById('modal-deck-h').textContent='Nuovo mazzo';buildSwatches('color-swatches',selColor);openOv('deck');setTimeout(()=>document.getElementById('deck-name-inp').focus(),80);}
function openEditDeck(id){const d=getDeck(id);if(!d)return;selColor=d.color;document.getElementById('deck-name-inp').value=d.name;document.getElementById('edit-deck-id').value=id;document.getElementById('modal-deck-h').textContent='Modifica mazzo';buildSwatches('color-swatches',selColor);openOv('deck');setTimeout(()=>document.getElementById('deck-name-inp').focus(),80);}
function saveDeck(){
  const name=document.getElementById('deck-name-inp').value.trim();if(!name){toast('Inserisci un nome.');return;}
  const id=document.getElementById('edit-deck-id').value;
  if(id){const i=S.decks.findIndex(d=>d.id===id);if(i!==-1)Object.assign(S.decks[i],{name,color:selColor});toast('Mazzo aggiornato!');}
  else{S.decks.push({id:uid(),name,color:selColor,created:Date.now(),settings:{...DEF}});toast('Mazzo creato!');}
  save();closeOv('deck');if(view==='dashboard')renderDashboard();if(view==='manage')renderManage();buildSels();updateSidebar();
}
function openSettings(did){
  const d=getDeck(did);if(!d)return;const c=d.settings||{...DEF};
  document.getElementById('s-deck-name').textContent=d.name;document.getElementById('s-deck-id').value=did;
  document.getElementById('s-new-limit').value=c.newLimit;document.getElementById('s-rev-limit').value=c.revLimit;
  document.getElementById('s-learn-steps').value=(Array.isArray(c.learnSteps)?c.learnSteps:[1,10,1440]).join(' ');
  document.getElementById('s-relearn-steps').value=(Array.isArray(c.relearnSteps)?c.relearnSteps:[10,1440]).join(' ');
  document.getElementById('s-max-iv').value=c.maxInterval;document.getElementById('s-leech').value=c.leechThreshold;
  document.getElementById('s-order').value=c.newOrder||'due';
  document.getElementById('s-new-interval').value=Math.round((c.newInterval||0)*100);
  openOv('settings');
}
function saveSettings(){
  const id=document.getElementById('s-deck-id').value,d=getDeck(id);if(!d)return;
  d.settings={
    newLimit:Math.max(1,parseInt(document.getElementById('s-new-limit').value)||20),
    revLimit:Math.max(1,parseInt(document.getElementById('s-rev-limit').value)||60),
    learnSteps:parseSteps(document.getElementById('s-learn-steps').value),
    relearnSteps:parseSteps(document.getElementById('s-relearn-steps').value),
    maxInterval:Math.max(1,parseInt(document.getElementById('s-max-iv').value)||36500),
    leechThreshold:Math.max(1,parseInt(document.getElementById('s-leech').value)||8),
    newOrder:document.getElementById('s-order').value,
    newInterval:Math.min(1,Math.max(0,parseInt(document.getElementById('s-new-interval').value)||0)/100),
  };
  save();closeOv('settings');toast('Impostazioni salvate!');if(view==='manage')renderManage();updateSidebar();
}
function promptDelDeck(id){delDeckId=id;openOv('del-deck');}
function doDelDeck(){S.cards=S.cards.filter(c=>c.deckId!==delDeckId);S.decks=S.decks.filter(d=>d.id!==delDeckId);save();closeOv('del-deck');toast('Mazzo eliminato.');if(view==='dashboard')renderDashboard();if(view==='manage')renderManage();updateSidebar();delDeckId=null;}
function promptDelCard(id){delCardId=id;openOv('del-card');}
function doDelCard(){S.cards=S.cards.filter(c=>c.id!==delCardId);save();closeOv('del-card');toast('Carta eliminata.');renderBrowse();updateSidebar();delCardId=null;}

// ═══════════════ OVERLAY ═══════════════
function openOv(n){document.getElementById('ov-'+n).classList.add('open');}
function closeOv(n){document.getElementById('ov-'+n).classList.remove('open');}
document.addEventListener('click',e=>{if(e.target.classList.contains('overlay'))e.target.classList.remove('open');});

// ═══════════════ MOBILE ═══════════════
function openMob(){document.getElementById('sidebar').classList.add('mob-open');document.getElementById('mob-ov').classList.add('open');}
function closeMob(){document.getElementById('sidebar').classList.remove('mob-open');document.getElementById('mob-ov').classList.remove('open');}

// ═══════════════ TOAST ═══════════════
let toastT;
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2800);}

// ═══════════════ UTILS ═══════════════
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}
function fmtDate(ts){const diff=Math.round((ts-Date.now())/DAY);if(diff<=0)return'<span style="color:var(--gr)">Oggi</span>';if(diff===1)return'Domani';if(diff<7)return`tra ${diff} gg`;if(diff<30)return`tra ${Math.round(diff/7)} sett.`;return`tra ${Math.round(diff/30)} mes.`;}

// ═══════════════ KEYBOARD ═══════════════
// Nascondi tastiera virtuale su mobile quando si toccano i bottoni di rating
document.addEventListener('touchstart',e=>{
  const rb=e.target.closest('.rate-btn,.show-btn');
  if(rb&&document.activeElement&&['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){
    document.activeElement.blur();
  }
},{passive:true});

document.addEventListener('keydown',e=>{
  if(['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
  // Non attivare shortcut su dispositivi touch-only
  if(window.matchMedia('(hover:none)').matches)return;
  if(view==='study'){
    if(e.key===' '||e.key==='Enter'){e.preventDefault();reveal();}
    if(e.key==='1')rate('again');if(e.key==='2')rate('hard');if(e.key==='3')rate('medium');if(e.key==='4')rate('easy');
    if(e.key==='b'||e.key==='B')buryCurrent();
    if(e.key==='z'||e.key==='Z')undoLast();
  }
  if(e.key==='Escape')document.querySelectorAll('.overlay.open').forEach(o=>o.classList.remove('open'));
});

// ═══════════════ APP SETTINGS ═══════════════
function loadAppSettings(){
  try{const s=JSON.parse(localStorage.getItem(SETTINGS_KEY));if(s)return s;}catch(e){}
  return{themeIdx:0,firebase:null};
}
function saveAppSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(appSettings));}

// ═══════════════ TEMA ═══════════════
function applyTheme(idx){
  const t=THEMES[idx]||THEMES[0];
  const r=document.documentElement.style;
  r.setProperty('--ac',t.ac);
  r.setProperty('--ac2',t.ac2);
  r.setProperty('--adim',t.adim);
  // Aggiorna anche le celle heatmap se già presenti
  document.querySelectorAll('.hm-cell.l1,.hm-cell.l2,.hm-cell.l3,.hm-cell.l4').forEach(el=>{
    const rgb=hexToRgb(t.ac);
    if(!rgb)return;
    const lv=el.classList.contains('l1')?.2:el.classList.contains('l2')?.42:el.classList.contains('l3')?.68:.9;
    el.style.background=`rgba(${rgb},${lv})`;
  });
}
function hexToRgb(hex){const r=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);return r?`${parseInt(r[1],16)},${parseInt(r[2],16)},${parseInt(r[3],16)}`:null;}

function renderSettingsView(){
  buildThemeSwatches();
  fbRestoreFields();
  fbUpdateUI();
}
function buildThemeSwatches(){
  const el=document.getElementById('theme-swatches');if(!el)return;
  el.innerHTML=THEMES.map((t,i)=>`<div class="tswatch${i===appSettings.themeIdx?' active':''}" style="background:${t.ac}" title="${t.name}" onclick="pickTheme(${i})"></div>`).join('');
}
function pickTheme(idx){
  appSettings.themeIdx=idx;
  saveAppSettings();
  applyTheme(idx);
  buildThemeSwatches();
  toast(`Tema "${THEMES[idx].name}" applicato.`);
}

// ═══════════════ FIREBASE ═══════════════
let fbApp=null,fbDb=null;

function fbRestoreFields(){
  const cfg=appSettings.firebase||{};
  ['apikey','authdomain','dburl','projectid'].forEach(k=>{
    const el=document.getElementById('fb-'+k);if(el)el.value=cfg[k]||'';
  });
  // Se già connesso, riconnetti silenziosamente
  if(cfg.apikey&&cfg.dburl)fbInitApp(cfg,true);
}

function fbReadFields(){
  return{
    apikey:document.getElementById('fb-apikey')?.value.trim()||'',
    authdomain:document.getElementById('fb-authdomain')?.value.trim()||'',
    dburl:document.getElementById('fb-dburl')?.value.trim()||'',
    projectid:document.getElementById('fb-projectid')?.value.trim()||'',
  };
}

function fbInitApp(cfg,silent=false){
  try{
    if(fbApp){try{firebase.app('[DEFAULT]').delete();}catch(e){}}
    fbApp=firebase.initializeApp({
      apiKey:cfg.apikey,
      authDomain:cfg.authdomain,
      databaseURL:cfg.dburl,
      projectId:cfg.projectid,
    });
    fbDb=firebase.database(fbApp);
    // Test connessione
    fbDb.ref('.info/connected').once('value').then(snap=>{
      fbApp._connected=true;
      if(!silent)toast('Firebase connesso!');
      fbUpdateUI(true);
    }).catch(err=>{
      fbApp._connected=false;
      fbSetStatus('err',`Connessione fallita: ${err.message}`);
      fbUpdateUI(false);
    });
    return true;
  }catch(err){
    fbSetStatus('err',`Errore inizializzazione: ${err.message}`);
    fbUpdateUI(false);
    return false;
  }
}

function fbConnect(){
  const cfg=fbReadFields();
  if(!cfg.apikey||!cfg.dburl){toast('Inserisci almeno API Key e Database URL.');return;}
  fbSetStatus('loading','Connessione in corso…');
  appSettings.firebase=cfg;
  saveAppSettings();
  fbInitApp(cfg);
}

function fbDisconnect(){
  if(fbApp){try{fbApp.delete();}catch(e){}}
  fbApp=null;fbDb=null;
  appSettings.firebase=null;
  saveAppSettings();
  ['apikey','authdomain','dburl','projectid'].forEach(k=>{const el=document.getElementById('fb-'+k);if(el)el.value='';});
  fbSetStatus(null);
  fbUpdateUI(false);
  toast('Firebase disconnesso.');
}

function fbUpdateUI(connected){
  const disc=document.getElementById('fb-disconnect-btn');
  const up=document.getElementById('fb-upload-btn');
  const down=document.getElementById('fb-download-btn');
  const act=document.getElementById('fb-actions');
  const isConn=connected||(fbApp&&fbApp._connected);
  if(disc)disc.style.display=isConn?'':'none';
  if(act)act.style.display=isConn?'flex':'none';
  if(up){up.disabled=!isConn;}
  if(down){down.disabled=!isConn;}
  if(isConn&&!document.getElementById('fb-status-bar')?.querySelector('.fb-status.ok')){
    fbSetStatus('ok','Connesso al database Firebase.');
  }
}

function fbSetStatus(type,msg){
  const bar=document.getElementById('fb-status-bar');if(!bar)return;
  if(!type){bar.style.display='none';bar.innerHTML='';return;}
  const ico=type==='ok'?'bi-cloud-check-fill':type==='loading'?'bi-hourglass-split':'bi-exclamation-triangle-fill';
  bar.style.display='block';
  bar.innerHTML=`<div class="fb-status ${type}"><i class="bi ${ico}"></i> ${msg}</div>`;
}

async function fbUpload(){
  if(!fbDb){toast('Firebase non connesso.');return;}
  const up=document.getElementById('fb-upload-btn');
  if(up){up.disabled=true;up.innerHTML='<i class="bi bi-hourglass-split"></i> Caricamento…';}
  try{
    const payload={...S,_uploadedAt:new Date().toISOString(),_version:'mnemosyne_v5'};
    await fbDb.ref('mnemosyne/backup').set(payload);
    toast('Backup caricato su Firebase!');
    fbSetStatus('ok',`Backup caricato — ${new Date().toLocaleTimeString('it-IT')}`);
  }catch(err){
    toast('Errore upload: '+err.message);
    fbSetStatus('err','Errore durante il caricamento: '+err.message);
  }finally{
    if(up){up.disabled=false;up.innerHTML='<i class="bi bi-cloud-upload"></i> Carica backup';}
  }
}

async function fbDownload(){
  if(!fbDb){toast('Firebase non connesso.');return;}
  const down=document.getElementById('fb-download-btn');
  if(down){down.disabled=true;down.innerHTML='<i class="bi bi-hourglass-split"></i> Scaricamento…';}
  try{
    const snap=await fbDb.ref('mnemosyne/backup').once('value');
    const data=snap.val();
    if(!data||!data.decks||!data.cards){toast('Nessun backup trovato nel database.');return;}
    delete data._uploadedAt;delete data._version;
    S=data;save();nav('dashboard');
    toast('Backup scaricato e ripristinato!');
  }catch(err){
    toast('Errore download: '+err.message);
    fbSetStatus('err','Errore durante il download: '+err.message);
  }finally{
    if(down){down.disabled=false;down.innerHTML='<i class="bi bi-cloud-download"></i> Scarica backup';}
  }
}

// ═══════════════ INIT ═══════════════
nav('dashboard');
