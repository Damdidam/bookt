/**
 * Waitlist (Liste d'attente) view module.
 */
import { api, GendaUI, viewState } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';

async function loadWaitlist(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const qs=new URLSearchParams();
    if(viewState.wlFilter)qs.set('status',viewState.wlFilter);
    if(viewState.wlPracFilter)qs.set('practitioner_id',viewState.wlPracFilter);
    const [wData,pData,sData]=await Promise.all([
      api.get('/api/waitlist?'+qs),
      api.get('/api/practitioners'),
      api.get('/api/services')
    ]);
    const entries=wData.entries||[];
    const stats=wData.stats||{};
    const pracs=(pData.practitioners||pData||[]).filter(p=>p.is_active!==false);
    const services=(sData.services||sData||[]).filter(s=>s.is_active!==false);

    // Warning if no practitioner has waitlist enabled
    const wlEnabled=pracs.filter(p=>p.waitlist_mode&&p.waitlist_mode!=='off');
    let h='';
    if(!wlEnabled.length){
      h+=`<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;padding:14px 18px;margin-bottom:16px;display:flex;align-items:center;gap:12px;font-size:.82rem"><span style="font-size:1.2rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span><div><strong>Aucun praticien n'a la liste d'attente activée.</strong><br><span style="color:var(--text-3)">Allez dans <strong>Équipe → Modifier</strong> un praticien pour activer le mode <em>manuelle</em> ou <em>automatique</em>.</span></div></div>`;
    }

    // KPIs
    h+=`<div class="kpis">`;
    h+=`<div class="kpi" onclick="viewState.wlFilter='waiting';loadWaitlist()" style="cursor:pointer"><div class="kpi-val" style="color:#6D28D9">${stats.waiting||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg> En attente</div></div>`;
    h+=`<div class="kpi" onclick="viewState.wlFilter='offered';loadWaitlist()" style="cursor:pointer"><div class="kpi-val" style="color:#D97706">${stats.offered||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Offre envoyée</div></div>`;
    h+=`<div class="kpi" onclick="viewState.wlFilter='booked';loadWaitlist()" style="cursor:pointer"><div class="kpi-val" style="color:var(--green)">${stats.booked||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Réservé</div></div>`;
    h+=`<div class="kpi" onclick="viewState.wlFilter='expired';loadWaitlist()" style="cursor:pointer"><div class="kpi-val" style="color:var(--text-4)">${stats.expired||0}</div><div class="kpi-label">⌛ Expiré</div></div>`;
    h+=`</div>`;

    // Filter bar
    h+=`<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:16px">`;
    h+=`<div style="display:flex;gap:4px">`;
    h+=`<button class="btn-sm ${viewState.wlFilter==='waiting'?'active':''}" onclick="viewState.wlFilter='waiting';loadWaitlist()">En attente</button>`;
    h+=`<button class="btn-sm ${viewState.wlFilter==='offered'?'active':''}" onclick="viewState.wlFilter='offered';loadWaitlist()">Offre envoyée</button>`;
    h+=`<button class="btn-sm ${viewState.wlFilter===''?'active':''}" onclick="viewState.wlFilter='';loadWaitlist()">Tous</button>`;
    h+=`</div>`;
    if(pracs.length>1){
      h+=`<select onchange="viewState.wlPracFilter=this.value;loadWaitlist()" style="padding:6px 12px;border-radius:7px;border:1.5px solid var(--border);font-size:.75rem;font-family:var(--sans);background:var(--white);color:var(--text-2)">`;
      h+=`<option value="" ${!viewState.wlPracFilter?'selected':''}>Tous les praticiens</option>`;
      pracs.forEach(p=>{h+=`<option value="${p.id}" ${viewState.wlPracFilter===p.id?'selected':''}>${p.display_name}</option>`;});
      h+=`</select>`;
    }
    h+=`<button class="btn-primary" onclick="wlOpenAdd()" style="margin-left:auto">+ Ajouter</button>`;
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
          h+=`<div style="font-size:.68rem;color:var(--primary);margin-top:2px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> ${esc(preview)}</div>`;
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
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty">Erreur: ${e.message}</div>`;}
}

// -- Add to waitlist modal --
function wlOpenAdd(){
  Promise.all([
    api.get('/api/practitioners'),
    api.get('/api/services')
  ]).then(([pData,sData])=>{
    const pracs=(pData.practitioners||pData||[]).filter(p=>p.is_active!==false);
    const services=(sData.services||sData||[]).filter(s=>s.is_active!==false);
    const DAY_S=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><div class="modal-h"><h3>Ajouter \u00e0 la liste d'attente</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;
    m+=`<div class="field"><label>Nom du client *</label><input id="wla_name" placeholder="Nom complet"></div>`;
    m+=`<div class="field"><label>Email *</label><input id="wla_email" type="email" placeholder="email@exemple.be"></div>`;
    m+=`<div class="field"><label>T\u00e9l\u00e9phone</label><input id="wla_phone" placeholder="+32..."></div>`;
    m+=`<div class="field"><label>Praticien *</label><select id="wla_prac">`;
    pracs.forEach(p=>{m+=`<option value="${p.id}">${p.display_name}</option>`;});
    m+=`</select></div>`;
    m+=`<div class="field"><label>Prestation *</label><select id="wla_svc">`;
    services.forEach(s=>{m+=`<option value="${s.id}">${s.name} (${s.duration_min} min)</option>`;});
    m+=`</select></div>`;
    m+=`<div class="field"><label>Jours pr\u00e9f\u00e9r\u00e9s</label><div style="display:flex;gap:4px;flex-wrap:wrap" id="wla_days">`;
    for(let i=0;i<7;i++){
      m+=`<label style="display:flex;align-items:center;gap:3px;font-size:.78rem;background:var(--surface);padding:4px 8px;border-radius:6px;cursor:pointer"><input type="checkbox" value="${i}" ${i<5?'checked':''}> ${DAY_S[i]}</label>`;
    }
    m+=`</div></div>`;
    m+=`<div class="field"><label>Cr\u00e9neau pr\u00e9f\u00e9r\u00e9</label><select id="wla_time"><option value="any">Toute la journ\u00e9e</option><option value="morning">Matin (avant 12h)</option><option value="afternoon">Apr\u00e8s-midi (apr\u00e8s 12h)</option></select></div>`;
    m+=`<div class="field"><label>Note</label><input id="wla_note" placeholder="Info suppl\u00e9mentaire..." maxlength="300"></div>`;
    m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="wlSaveAdd()">Ajouter</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',m);
  });
}

async function wlSaveAdd(){
  const name=document.getElementById('wla_name').value.trim();
  const email=document.getElementById('wla_email').value.trim();
  if(!name||!email){GendaUI.toast('Nom et email requis','error');return;}
  const days=[];
  document.querySelectorAll('#wla_days input:checked').forEach(c=>days.push(parseInt(c.value)));
  try{
    await api.post('/api/waitlist',{
      practitioner_id:document.getElementById('wla_prac').value,
      service_id:document.getElementById('wla_svc').value,
      client_name:name,client_email:email,
      client_phone:document.getElementById('wla_phone').value.trim()||null,
      preferred_days:days,
      preferred_time:document.getElementById('wla_time').value,
      note:document.getElementById('wla_note').value.trim()||null
    });
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast("Ajout\u00e9 \u00e0 la liste d'attente",'success');
    loadWaitlist();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// -- Offer a slot --
function wlOffer(entryId,clientName,pracId,svcId){
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><div class="modal-h"><h3>Proposer un cr\u00e9neau \u00e0 ${clientName}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;
  m+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Le client recevra un lien pour accepter ou d\u00e9cliner. L'offre expire apr\u00e8s <strong>2 heures</strong>.</p>`;
  m+=`<div class="field"><label>Date</label><input type="date" id="wlo_date" value="${new Date().toISOString().split('T')[0]}"></div>`;
  m+=`<div class="field"><label>Heure de d\u00e9but</label><input type="time" id="wlo_start" value="09:00" step="900"></div>`;
  m+=`<div class="field"><label>Heure de fin</label><input type="time" id="wlo_end" value="10:00" step="900"></div>`;
  m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="wlSendOffer('${entryId}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Envoyer l'offre</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
}

async function wlSendOffer(entryId){
  const date=document.getElementById('wlo_date').value;
  const start=document.getElementById('wlo_start').value;
  const end=document.getElementById('wlo_end').value;
  if(!date||!start||!end){GendaUI.toast('Date et heures requises','error');return;}
  try{
    const result=await api.post(`/api/waitlist/${entryId}/offer`,{start_at:date+'T'+start+':00',end_at:date+'T'+end+':00'});
    document.querySelector('.modal-overlay')?.remove();
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
  if(!confirm("Retirer cette personne de la liste d'attente ?"))return;
  try{
    await api.delete(`/api/waitlist/${entryId}`);
    document.querySelector('.modal-overlay')?.remove();
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
  const created=new Date(e.created_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});

  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:520px"><div class="modal-h"><h3>${esc(e.client_name)}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;

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
    m+=`<div style="padding:10px 14px;background:#FFF7ED;border:1px solid #FBBF24;border-radius:8px;font-size:.8rem;color:#92400E;margin-bottom:16px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Offre : <strong>${d.toLocaleDateString('fr-BE',{weekday:'short',day:'numeric',month:'short'})} \u00e0 ${d.toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'})}</strong> \u2014 expire dans <strong>${expMins>60?Math.floor(expMins/60)+'h'+String(expMins%60).padStart(2,'0'):expMins+' min'}</strong></div>`;
  }

  // Staff notes
  m+=`<div class="wl-notes-area">`;
  m+=`<label><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Notes de suivi (visible uniquement par l'\u00e9quipe)</label>`;
  m+=`<textarea id="wlStaffNotes" placeholder="Ex: Contact\u00e9 le 04/03, propos\u00e9 cr\u00e9neau du 06/03 \u00e0 9h30. Le client rappelle demain.">${esc(e.staff_notes||'')}</textarea>`;
  m+=`<div class="wl-notes-hint">Les notes sont sauvegard\u00e9es automatiquement quand vous quittez ce champ</div>`;
  m+=`</div>`;

  // Actions
  m+=`<div class="wl-action-row">`;
  if(e.status==='waiting'){
    m+=`<button class="wl-btn primary" onclick="this.closest('.modal-overlay').remove();wlOffer('${e.id}','${esc(e.client_name).replace(/'/g,"\\'")}','${e.practitioner_id}','${e.service_id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Proposer un cr\u00e9neau</button>`;
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
    document.querySelector('.modal-overlay')?.remove();
    const labels={booked:'RDV obtenu',declined:'D\u00e9clin\u00e9',waiting:'Remis en attente'};
    GendaUI.toast(labels[status]||'Statut mis \u00e0 jour','success');
    loadWaitlist();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Expose viewState to window for inline onclick handlers
Object.defineProperty(window, 'viewState', { get(){return viewState;}, configurable: true });

bridge({ loadWaitlist, wlOpenAdd, wlSaveAdd, wlOffer, wlSendOffer, wlContact, wlRemove, wlDetail, wlSaveNotes, wlChangeStatus });

export { loadWaitlist, wlOpenAdd, wlSaveAdd, wlOffer, wlSendOffer, wlContact, wlRemove, wlDetail, wlSaveNotes, wlChangeStatus };
