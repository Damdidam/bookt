/**
 * Waitlist (Liste d'attente) view module.
 */
import { api, GendaUI, viewState } from '../state.js';
import { trapFocus, releaseFocus } from '../utils/focus-trap.js';
import { esc, escJs } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';
import { closeModal, guardModal, showConfirmDialog } from '../utils/dirty-guard.js';
import { isPro, showProGate } from '../utils/plan-gate.js';
import { renderPagination } from '../utils/pagination.js';

const WL_PAGE_SIZE=50;

async function loadWaitlist(){
  if (!isPro()) { showProGate(document.getElementById('contentArea'), "Liste d'attente"); return; }
  if(viewState.wlFilter===undefined)viewState.wlFilter='';
  if(viewState.wlOffset===undefined)viewState.wlOffset=0;
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const qs=new URLSearchParams();
    if(viewState.wlFilter)qs.set('status',viewState.wlFilter);
    if(viewState.wlPracFilter)qs.set('practitioner_id',viewState.wlPracFilter);
    qs.set('limit', String(WL_PAGE_SIZE));
    qs.set('offset', String(viewState.wlOffset||0));
    const [wData,pData,sData]=await Promise.all([
      api.get('/api/waitlist?'+qs),
      api.get('/api/practitioners'),
      api.get('/api/services')
    ]);
    const entries=wData.entries||[];
    const stats=wData.stats||{};
    const pag = wData.pagination || {total_count: entries.length, limit: WL_PAGE_SIZE, offset: viewState.wlOffset||0};
    const pracs=(pData.practitioners||pData||[]).filter(p=>p.is_active!==false);
    const services=(sData.services||sData||[]).filter(s=>s.is_active!==false);

    // Warning if no practitioner has waitlist enabled
    const wlEnabled=pracs.filter(p=>p.waitlist_mode&&p.waitlist_mode!=='off');
    let h='';
    if(!wlEnabled.length){
      h+=`<div style="background:var(--amber-bg);border:1px solid var(--gold);border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px;font-size:.82rem"><span style="font-size:1.2rem">${IC.alertTriangle}</span><div><strong>Aucun praticien n'a la liste d'attente activée.</strong><br><span style="color:var(--text-3)">Allez dans <strong>Équipe → Modifier</strong> un praticien pour activer le mode <em>manuelle</em> ou <em>automatique</em>.</span></div></div>`;
    }

    // KPIs
    h+=`<div class="kpis">`;
    h+=`<div class="kpi" onclick="viewState.wlFilter='waiting';viewState.wlOffset=0;loadWaitlist()" style="cursor:pointer"><div class="kpi-val" style="color:var(--purple)">${stats.waiting||0}</div><div class="kpi-label">${IC.hourglass} En attente</div></div>`;
    h+=`<div class="kpi" onclick="viewState.wlFilter='offered';viewState.wlOffset=0;loadWaitlist()" style="cursor:pointer"><div class="kpi-val" style="color:var(--amber-dark)">${stats.offered||0}</div><div class="kpi-label">${IC.mail} Offre envoyée</div></div>`;
    h+=`<div class="kpi" onclick="viewState.wlFilter='booked';viewState.wlOffset=0;loadWaitlist()" style="cursor:pointer"><div class="kpi-val" style="color:var(--green)">${stats.booked||0}</div><div class="kpi-label">${IC.check} Réservé</div></div>`;
    h+=`<div class="kpi" onclick="viewState.wlFilter='expired';viewState.wlOffset=0;loadWaitlist()" style="cursor:pointer"><div class="kpi-val" style="color:var(--text-4)">${stats.expired||0}</div><div class="kpi-label">${IC.hourglass} Expiré</div></div>`;
    h+=`</div>`;

    // Filter bar
    h+=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">`;
    h+=`<div style="display:flex;gap:4px">`;
    h+=`<button class="btn-sm ${viewState.wlFilter==='waiting'?'active':''}" onclick="viewState.wlFilter='waiting';viewState.wlOffset=0;loadWaitlist()">En attente</button>`;
    h+=`<button class="btn-sm ${viewState.wlFilter==='offered'?'active':''}" onclick="viewState.wlFilter='offered';viewState.wlOffset=0;loadWaitlist()">Offre envoyée</button>`;
    h+=`<button class="btn-sm ${viewState.wlFilter===''?'active':''}" onclick="viewState.wlFilter='';viewState.wlOffset=0;loadWaitlist()">Tous</button>`;
    h+=`</div>`;
    if(pracs.length>1){
      h+=`<select onchange="viewState.wlPracFilter=this.value;viewState.wlOffset=0;loadWaitlist()" style="padding:6px 12px;border-radius:7px;border:1.5px solid var(--border);font-size:.75rem;font-family:var(--sans);background:var(--white);color:var(--text-2)">`;
      h+=`<option value="" ${!viewState.wlPracFilter?'selected':''}>Tous les praticiens</option>`;
      pracs.forEach(p=>{h+=`<option value="${esc(p.id)}" ${viewState.wlPracFilter===p.id?'selected':''}>${esc(p.display_name)}</option>`;});
      h+=`</select>`;
    }
    h+=`<button class="btn-primary btn-sm" onclick="wlOpenAdd()" style="margin-left:auto">+ Ajouter</button>`;
    h+=`</div>`;

    // Entries list
    h+=`<div class="card"><div class="card-h"><h3>Liste d'attente</h3><span class="badge badge-teal">${entries.length}</span></div>`;
    if(!entries.length){
      h+=`<div class="empty">Aucune entrée ${viewState.wlFilter==='waiting'?'en attente':viewState.wlFilter==='offered'?'avec offre en cours':''}</div>`;
    }else{
      viewState.wlEntries=entries;
      const WL_ST={waiting:'En attente',offered:'Offre envoyée',booked:'Réservé',expired:'Expiré',cancelled:'Annulé',declined:'Décliné'};
      const DAY_S=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
      const TIME_L={any:'Toute la journée',morning:'Matin',afternoon:'Après-midi'};
      entries.forEach((e,i)=>{
        const prio=e.priority||i+1;
        h+=`<div class="wl-row" onclick="wlDetail(${i})">`;
        h+=`<div class="wl-priority ${prio<=3?'top':''}">${prio}</div>`;
        h+=`<div class="wl-info">`;
        h+=`<div class="wl-name">${esc(e.client_name)} <span class="email">${esc(e.client_email)}</span></div>`;
        h+=`<div class="wl-meta"><span>${esc(e.service_name||'—')}</span><span class="dot-sep">·</span><span>${esc(e.practitioner_name||'—')}</span>`;
        h+=`<span class="dot-sep">·</span><span class="badge st-${e.status}" style="font-size:.6rem;padding:2px 7px">${WL_ST[e.status]||e.status}</span>`;
        h+=`</div>`;
        if(e.staff_notes){
          const preview=e.staff_notes.length>60?e.staff_notes.slice(0,60)+'\u2026':e.staff_notes;
          h+=`<div style="font-size:.68rem;color:var(--primary);margin-top:2px">${IC.fileText} ${esc(preview)}</div>`;
        }
        if(e.status==='offered'&&e.offer_expires_at){
          const mins=Math.max(0,Math.round((new Date(e.offer_expires_at)-new Date())/60000));
          h+=`<div class="wl-offer-info"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${mins>60?Math.floor(mins/60)+'h'+String(mins%60).padStart(2,'0'):mins+' min'}</div>`;
        }
        h+=`</div>`;
        h+=`<span class="wl-chevron">\u203a</span>`;
        h+=`</div>`;
      });
    }
    h+=`</div>`;
    h+=renderPagination({ total: pag.total_count, limit: pag.limit, offset: pag.offset, onPage: 'waitlistGoToPage', label: 'entrées' });
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty">Erreur: ${esc(e.message)}</div>`;}
}

function waitlistGoToPage(newOffset){ viewState.wlOffset = Math.max(0, parseInt(newOffset) || 0); loadWaitlist(); }

// -- Add to waitlist modal --
function wlOpenAdd(){
  Promise.all([
    api.get('/api/practitioners'),
    api.get('/api/services')
  ]).then(([pData,sData])=>{
    const pracs=(pData.practitioners||pData||[]).filter(p=>p.is_active!==false);
    const services=(sData.services||sData||[]).filter(s=>s.is_active!==false);
    const DAY_S=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    let m=`<div class="m-overlay open" id="wlAddModal"><div class="m-dialog m-md"><div class="m-header-simple"><h3>Ajouter \u00e0 la liste d'attente</h3><button class="m-close" onclick="closeModal('wlAddModal')" aria-label="Fermer">${IC.x}</button></div><div class="m-body">`;
    m+=`<div><label class="m-field-label">Nom du client *</label><input class="m-input" id="wla_name" placeholder="Nom complet"></div>`;
    m+=`<div><label class="m-field-label">Email *</label><input class="m-input" id="wla_email" type="email" placeholder="email@exemple.be"></div>`;
    m+=`<div><label class="m-field-label">T\u00e9l\u00e9phone</label><input class="m-input" id="wla_phone" placeholder="+32 / +33..."></div>`;
    m+=`<div><label class="m-field-label">Praticien *</label><select class="m-input" id="wla_prac">`;
    pracs.forEach(p=>{m+=`<option value="${esc(p.id)}">${esc(p.display_name)}</option>`;});
    m+=`</select></div>`;
    m+=`<div><label class="m-field-label">Prestation *</label><select class="m-input" id="wla_svc" onchange="wlOnSvcChange()">`;
    services.forEach(s=>{m+=`<option value="${esc(s.id)}">${esc(s.name)} (${s.duration_min} min)</option>`;});
    m+=`</select></div>`;
    m+=`<div id="wla_variant_wrap" style="display:none"><label class="m-field-label">Variante</label><select class="m-input" id="wla_variant"></select></div>`;
    // Expose services map + variants to wlOnSvcChange
    window._wlServicesMap = services.reduce((acc,s)=>{ acc[s.id] = s.variants || []; return acc; }, {});
    m+=`<div><label class="m-field-label">Jours pr\u00e9f\u00e9r\u00e9s</label><div style="display:flex;gap:4px;flex-wrap:wrap" id="wla_days">`;
    for(let i=0;i<7;i++){
      m+=`<button type="button" class="btn-sm ${i<5?'active':''}" data-day="${i}" onclick="this.classList.toggle('active')" style="min-width:42px">${DAY_S[i]}</button>`;
    }
    m+=`</div></div>`;
    m+=`<div><label class="m-field-label">Cr\u00e9neau pr\u00e9f\u00e9r\u00e9</label><select class="m-input" id="wla_time"><option value="any">Toute la journ\u00e9e</option><option value="morning">Matin (avant 12h)</option><option value="afternoon">Apr\u00e8s-midi (apr\u00e8s 12h)</option></select></div>`;
    m+=`<div><label class="m-field-label">Note</label><input class="m-input" id="wla_note" placeholder="Info suppl\u00e9mentaire..." maxlength="300"></div>`;
    m+=`</div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('wlAddModal')">Annuler</button><button class="m-btn m-btn-primary" onclick="wlSaveAdd()">Ajouter</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',m);
    guardModal(document.getElementById('wlAddModal'), { noBackdropClose: true });
    trapFocus(document.getElementById('wlAddModal'), () => closeModal('wlAddModal'));
    wlOnSvcChange(); // init variant picker visibility for preselected service
  });
}

function wlOnSvcChange(){
  const svcId = document.getElementById('wla_svc').value;
  const variants = (window._wlServicesMap || {})[svcId] || [];
  const wrap = document.getElementById('wla_variant_wrap');
  const sel = document.getElementById('wla_variant');
  if (variants.length === 0) {
    wrap.style.display = 'none';
    sel.innerHTML = '';
    return;
  }
  wrap.style.display = '';
  sel.innerHTML = '<option value="">— Toute variante —</option>' +
    variants.map(v=>`<option value="${esc(v.id)}">${esc(v.name)}${v.price_cents?' ('+(v.price_cents/100).toFixed(2).replace('.',',')+' €)':''}</option>`).join('');
}

async function wlSaveAdd(){
  const name=document.getElementById('wla_name').value.trim();
  const email=document.getElementById('wla_email').value.trim();
  if(!name||!email){GendaUI.toast('Nom et email requis','error');return;}
  const days=[];
  document.querySelectorAll('#wla_days .btn-sm.active').forEach(b=>days.push(parseInt(b.dataset.day)));
  const variantEl=document.getElementById('wla_variant');
  const variantId=(variantEl && variantEl.value) ? variantEl.value : null;
  try{
    await api.post('/api/waitlist',{
      practitioner_id:document.getElementById('wla_prac').value,
      service_id:document.getElementById('wla_svc').value,
      service_variant_id:variantId,
      client_name:name,client_email:email,
      client_phone:document.getElementById('wla_phone').value.trim()||null,
      preferred_days:days,
      preferred_time:document.getElementById('wla_time').value,
      note:document.getElementById('wla_note').value.trim()||null
    });
    closeModal('wlAddModal');
    GendaUI.toast("Ajout\u00e9 \u00e0 la liste d'attente",'success');
    loadWaitlist();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// -- Offer a slot --
function wlOffer(entryId,clientName,pracId,svcId){
  let m=`<div class="m-overlay open" id="wlOfferModal"><div class="m-dialog m-sm"><div class="m-header-simple"><h3>Proposer un cr\u00e9neau \u00e0 ${clientName}</h3><button class="m-close" onclick="closeModal('wlOfferModal')" aria-label="Fermer">${IC.x}</button></div><div class="m-body">`;
  m+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Le client recevra un lien pour accepter ou d\u00e9cliner. L'offre expire apr\u00e8s <strong>2 heures</strong>.</p>`;
  m+=`<div><label class="m-field-label">Date</label><input type="date" class="m-input" id="wlo_date" value="${new Date().toLocaleDateString('en-CA',{timeZone:'Europe/Brussels'})}"></div>`;
  m+=`<div><label class="m-field-label">Heure de d\u00e9but</label><input type="time" class="m-input" id="wlo_start" value="09:00" step="900"></div>`;
  m+=`<div><label class="m-field-label">Heure de fin</label><input type="time" class="m-input" id="wlo_end" value="10:00" step="900"></div>`;
  m+=`</div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('wlOfferModal')">Annuler</button><button class="m-btn m-btn-primary" onclick="wlSendOffer('${entryId}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Envoyer l'offre</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
  guardModal(document.getElementById('wlOfferModal'), { noBackdropClose: true });
  trapFocus(document.getElementById('wlOfferModal'), () => closeModal('wlOfferModal'));
}

async function wlSendOffer(entryId){
  const date=document.getElementById('wlo_date').value;
  const start=document.getElementById('wlo_start').value;
  const end=document.getElementById('wlo_end').value;
  if(!date||!start||!end){GendaUI.toast('Date et heures requises','error');return;}
  try{
    const result=await api.post(`/api/waitlist/${entryId}/offer`,{start_at:date+'T'+start+':00',end_at:date+'T'+end+':00'});
    closeModal('wlOfferModal');
    if(result.offer_url){
      const fullUrl=window.location.origin+result.offer_url;
      navigator.clipboard?.writeText(fullUrl).catch(()=>{});
      GendaUI.toast('Offre cr\u00e9\u00e9e \u2014 lien copi\u00e9 !','success');
    }else{
      GendaUI.toast('Offre envoy\u00e9e','success');
    }
    loadWaitlist();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// -- Mark outcome --
async function wlContact(entryId,outcome){
  try{
    await api.post(`/api/waitlist/${entryId}/contact`,{outcome});
    GendaUI.toast(`Marqu\u00e9 comme ${outcome==='booked'?'r\u00e9serv\u00e9':'d\u00e9clin\u00e9'}`,'success');
    loadWaitlist();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// -- Remove entry --
async function wlRemove(entryId){
  const confirmed = await showConfirmDialog('Retirer de la liste', "Retirer cette personne de la liste d'attente ?", 'Retirer', 'danger');
  if(!confirmed)return;
  try{
    await api.delete(`/api/waitlist/${entryId}`);
    closeModal('wlDetailModal');
    GendaUI.toast("Retir\u00e9 de la liste",'success');
    loadWaitlist();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// -- Detail modal --
function wlDetail(idx){
  const e=viewState.wlEntries[idx];
  if(!e)return;
  const WL_ST={waiting:'En attente',offered:'Offre envoy\u00e9e',booked:'R\u00e9serv\u00e9',expired:'Expir\u00e9',cancelled:'Annul\u00e9',declined:'D\u00e9clin\u00e9'};
  const DAY_S=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
  const TIME_L={any:'Toute la journ\u00e9e',morning:'Matin',afternoon:'Apr\u00e8s-midi'};
  const days=(e.preferred_days||[]).map(d=>DAY_S[d]||d).join(', ');
  const created=new Date(e.created_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'});

  let m=`<div class="m-overlay open" id="wlDetailModal"><div class="m-dialog m-md"><div class="m-header-simple"><h3>${esc(e.client_name)}</h3><button class="m-close" onclick="closeModal('wlDetailModal')" aria-label="Fermer">${IC.x}</button></div><div class="m-body">`;

  // Status badge
  m+=`<div style="margin-bottom:16px"><span class="badge st-${e.status}" style="font-size:.72rem;padding:4px 12px">${WL_ST[e.status]||e.status}</span><span style="font-size:.72rem;color:var(--text-4);margin-left:8px">Inscrit le ${created}</span></div>`;

  // Info grid
  m+=`<div class="wl-detail-grid">`;
  m+=`<div class="wl-detail-item"><div class="dl">Prestation</div><div class="dv">${esc(e.service_name||'\u2014')}</div></div>`;
  m+=`<div class="wl-detail-item"><div class="dl">Praticien</div><div class="dv">${esc(e.practitioner_name||'\u2014')}</div></div>`;
  m+=`<div class="wl-detail-item"><div class="dl">Email</div><div class="dv" style="font-size:.78rem">${esc(e.client_email)}</div></div>`;
  m+=`<div class="wl-detail-item"><div class="dl">T\u00e9l\u00e9phone</div><div class="dv">${esc(e.client_phone||'\u2014')}</div></div>`;
  m+=`<div class="wl-detail-item"><div class="dl">Jours pr\u00e9f\u00e9r\u00e9s</div><div class="dv" style="font-size:.78rem">${days||'Tous'}</div></div>`;
  m+=`<div class="wl-detail-item"><div class="dl">Cr\u00e9neau</div><div class="dv" style="font-size:.78rem">${TIME_L[e.preferred_time]||'Toute la journ\u00e9e'}</div></div>`;
  m+=`</div>`;

  // Client note
  if(e.note){
    m+=`<div class="wl-client-note"><strong>Note du client :</strong> ${esc(e.note)}</div>`;
  }

  // Offer info
  if(e.status==='offered'&&e.offer_booking_start){
    const d=new Date(e.offer_booking_start);
    const expMins=e.offer_expires_at?Math.max(0,Math.round((new Date(e.offer_expires_at)-new Date())/60000)):0;
    m+=`<div style="padding:10px 14px;background:var(--amber-bg);border:1px solid var(--gold);border-radius:8px;font-size:.8rem;color:var(--amber-dark);margin-bottom:16px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Offre : <strong>${d.toLocaleDateString('fr-BE',{weekday:'short',day:'numeric',month:'short',timeZone:'Europe/Brussels'})} \u00e0 ${d.toLocaleTimeString('fr-BE',{timeZone:'Europe/Brussels',hour:'2-digit',minute:'2-digit'})}</strong> \u2014 expire dans <strong>${expMins>60?Math.floor(expMins/60)+'h'+String(expMins%60).padStart(2,'0'):expMins+' min'}</strong></div>`;
  }

  // Staff notes
  m+=`<div class="wl-notes-area">`;
  m+=`<label>${IC.fileText} Notes de suivi (visible uniquement par l'\u00e9quipe)</label>`;
  m+=`<textarea id="wlStaffNotes" placeholder="Ex: Contact\u00e9 le 04/03, propos\u00e9 cr\u00e9neau du 06/03 \u00e0 9h30. Le client rappelle demain.">${esc(e.staff_notes||'')}</textarea>`;
  m+=`<div class="wl-notes-hint">Les notes sont sauvegard\u00e9es automatiquement quand vous quittez ce champ</div>`;
  m+=`</div>`;

  // Actions
  m+=`<div class="wl-action-row">`;
  if(e.status==='waiting'){
    m+=`<button class="wl-btn primary" onclick="closeModal('wlDetailModal');wlOffer('${e.id}','${escJs(e.client_name)}','${e.practitioner_id}','${e.service_id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Proposer un cr\u00e9neau</button>`;
    m+=`<button class="wl-btn" onclick="wlChangeStatus('${e.id}','booked')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> RDV obtenu</button>`;
    m+=`<button class="wl-btn danger" onclick="wlRemove('${e.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Retirer</button>`;
  }else if(e.status==='offered'){
    m+=`<button class="wl-btn" onclick="wlChangeStatus('${e.id}','booked')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> RDV confirm\u00e9</button>`;
    m+=`<button class="wl-btn danger" onclick="wlChangeStatus('${e.id}','declined')">D\u00e9clin\u00e9</button>`;
  }else if(e.status==='expired'||e.status==='declined'){
    m+=`<button class="wl-btn" onclick="wlChangeStatus('${e.id}','waiting')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Remettre en attente</button>`;
    m+=`<button class="wl-btn danger" onclick="wlRemove('${e.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg> Retirer</button>`;
  }else if(e.status==='booked'){
    m+=`<span style="font-size:.8rem;color:var(--green)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Trait\u00e9</span>`;
  }
  m+=`</div>`;

  m+=`</div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
  guardModal(document.getElementById('wlDetailModal'), { noBackdropClose: true });
  trapFocus(document.getElementById('wlDetailModal'), () => closeModal('wlDetailModal'));

  // Auto-save notes on blur
  document.getElementById('wlStaffNotes')?.addEventListener('blur',function(){
    wlSaveNotes(e.id,this.value);
  });
}

async function wlSaveNotes(entryId,notes){
  try{
    await api.patch(`/api/waitlist/${entryId}`,{staff_notes:notes});
  }catch(e){/* silent */}
}

async function wlChangeStatus(entryId,status){
  const noteEl=document.getElementById('wlStaffNotes');
  const notes=noteEl?noteEl.value:undefined;
  try{
    const body={status};
    if(notes!==undefined)body.staff_notes=notes;
    await api.patch(`/api/waitlist/${entryId}`,body);
    closeModal('wlDetailModal');
    const labels={booked:'RDV obtenu',declined:'D\u00e9clin\u00e9',waiting:'Remis en attente'};
    GendaUI.toast(labels[status]||'Statut mis \u00e0 jour','success');
    loadWaitlist();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Expose viewState to window for inline onclick handlers
Object.defineProperty(window, 'viewState', { get(){return viewState;}, configurable: true });

bridge({ loadWaitlist, wlOpenAdd, wlOnSvcChange, wlSaveAdd, wlOffer, wlSendOffer, wlContact, wlRemove, wlDetail, wlSaveNotes, wlChangeStatus, waitlistGoToPage });

// Debounced auto-reload on SSE booking_update / waitlist_match si l'utilisateur est sur la page waitlist.
let _wlReloadTimer = null;
function _wlReloadIfActive() {
  const onWl = document.querySelector('.ni.active[data-section="waitlist"]');
  if (!onWl) return;
  if (_wlReloadTimer) clearTimeout(_wlReloadTimer);
  _wlReloadTimer = setTimeout(() => { _wlReloadTimer = null; loadWaitlist().catch(() => {}); }, 500);
}
window.addEventListener('genda:booking_update', _wlReloadIfActive);
window.addEventListener('genda:waitlist_match', _wlReloadIfActive);

export { loadWaitlist, wlOpenAdd, wlOnSvcChange, wlSaveAdd, wlOffer, wlSendOffer, wlContact, wlRemove, wlDetail, wlSaveNotes, wlChangeStatus };
