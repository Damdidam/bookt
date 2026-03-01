/**
 * Clients view module.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import './whiteboards.js'; // registers openWhiteboardForClient, loadClientWhiteboards on window

let clientSearch='';
let clientFilter='';
let clientSearchTimer=null;

async function loadClients(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const params=new URLSearchParams();
    if(clientSearch)params.set('search',clientSearch);
    if(clientFilter)params.set('filter',clientFilter);
    const q=params.toString()?'?'+params.toString():'';
    const r=await fetch(`/api/clients${q}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    const clients=d.clients||[];
    const stats=d.stats||{};
    let h=`<div class="kpis"><div class="kpi" onclick="clientFilter='';loadClients()" style="cursor:pointer"><div class="kpi-val">${stats.total||0}</div><div class="kpi-label">Total clients</div></div><div class="kpi" onclick="clientFilter='blocked';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:var(--red)">${stats.blocked||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqués</div></div><div class="kpi" onclick="clientFilter='flagged';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:#B45309">${stats.flagged||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No-shows</div></div><div class="kpi"><div class="kpi-val" style="color:var(--primary)">${stats.clean||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> OK</div></div></div>`;
    h+=`<div class="search-bar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div style="position:relative;flex:1;min-width:200px"><input type="text" placeholder="Rechercher par nom, email ou téléphone..." value="${clientSearch}" id="clientSearchInput" oninput="clientLiveSearch(this.value)" onkeydown="if(event.key==='Enter'){document.getElementById('clientAcDrop').style.display='none';clientSearch=this.value;clientFilter='';loadClients()}" onfocus="if(this.value.length>=3)clientLiveSearch(this.value)" onblur="setTimeout(()=>{const d=document.getElementById('clientAcDrop');if(d)d.style.display='none'},200)" style="width:100%" autocomplete="off"><div id="clientAcDrop" class="ac-results" style="display:none"></div></div><button class="btn-primary" onclick="document.getElementById('clientAcDrop').style.display='none';clientSearch=document.getElementById('clientSearchInput').value;clientFilter='';loadClients()">Rechercher</button>${clientSearch||clientFilter?`<button class="btn-outline" onclick="clientSearch='';clientFilter='';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reset</button>`:''}</div>`;
    h+=`<div style="display:flex;gap:6px;margin-bottom:12px"><button class="btn-sm ${!clientFilter?'active':''}" onclick="clientFilter='';loadClients()">Tous</button><button class="btn-sm ${clientFilter==='blocked'?'active':''}" onclick="clientFilter='blocked';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqués</button><button class="btn-sm ${clientFilter==='flagged'?'active':''}" onclick="clientFilter='flagged';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No-shows</button></div>`;
    h+=`<div class="card"><div class="card-h"><h3>${clientFilter==='blocked'?'Clients bloqués':clientFilter==='flagged'?'Clients avec no-shows':'Tous les clients'}</h3><span class="badge badge-teal">${d.total||clients.length}</span></div>`;
    if(clients.length===0){h+=`<div class="empty">Aucun client${clientSearch?' trouvé':clientFilter?' dans cette catégorie':' encore'}</div>`;}
    else{
      h+=`<div style="overflow-x:auto"><table class="table"><thead><tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>RDV</th><th>No-shows</th><th>Dernière visite</th><th>Statut</th></tr></thead><tbody>`;
      clients.forEach(cl=>{
        const last=cl.last_visit?new Date(cl.last_visit).toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric'}):'—';
        const tagColors={'bloqué':'#dc2626','récidiviste':'#B45309','à surveiller':'#ca8a04','fidèle':'#15803d','actif':'#0D7377','nouveau':'#888'};
        const tagColor=tagColors[cl.tag]||'#888';
        const nsDisplay=cl.no_show_count>0?`<span style="color:#B45309;font-weight:600">${cl.no_show_count}</span>`:'0';
        h+=`<tr${cl.is_blocked?' style="opacity:.6"':''}><td class="client-name" onclick="openClientDetail('${cl.id}')">${cl.full_name}${cl.is_blocked?' <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>':''}</td><td>${cl.phone||'—'}</td><td style="font-size:.78rem">${cl.email||'—'}</td><td>${cl.total_bookings}</td><td>${nsDisplay}</td><td style="font-size:.78rem">${last}</td><td><span style="font-size:.72rem;font-weight:600;color:${tagColor};background:${tagColor}15;padding:2px 8px;border-radius:10px">${cl.tag}</span></td></tr>`;
      });
      h+=`</tbody></table></div>`;
    }
    h+=`</div>`;
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

// ── Live autocomplete for client search (3+ chars) ──
function clientLiveSearch(q) {
  clearTimeout(clientSearchTimer);
  const dd = document.getElementById('clientAcDrop');
  if (!dd) return;
  if (q.length < 3) { dd.style.display = 'none'; return; }
  clientSearchTimer = setTimeout(async () => {
    try {
      const r = await fetch(`/api/clients?search=${encodeURIComponent(q)}&limit=8`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
      const d = await r.json();
      const cls = d.clients || [];
      if (cls.length === 0) {
        dd.innerHTML = `<div style="padding:12px;text-align:center;font-size:.8rem;color:var(--text-4)">Aucun résultat pour "${q}"</div>`;
        dd.style.display = 'block'; return;
      }
      dd.innerHTML = cls.map(c => {
        const ns = c.no_show_count > 0
          ? `<span style="font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:8px;background:#FDE68A;color:#B45309;margin-left:6px">⚠ ${c.no_show_count} no-show${c.no_show_count > 1 ? 's' : ''}</span>`
          : '';
        const bl = c.is_blocked
          ? `<span style="font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:8px;background:#FECACA;color:#dc2626;margin-left:6px">Bloqué</span>`
          : '';
        const meta = [c.phone, c.email].filter(Boolean).join(' · ');
        const tagColors = { 'récidiviste': '#B45309', 'à surveiller': '#ca8a04', 'fidèle': '#15803d', 'actif': '#0D7377', 'nouveau': '#888', 'bloqué': '#dc2626' };
        const tc = tagColors[c.tag] || '#888';
        return `<div class="ac-item" onmousedown="event.preventDefault();openClientDetail('${c.id}');document.getElementById('clientAcDrop').style.display='none'"><div class="ac-name">${c.full_name}${ns}${bl}</div><div class="ac-meta">${meta}${meta ? ' · ' : ''}${c.total_bookings} RDV <span style="color:${tc};font-weight:600">${c.tag}</span></div></div>`;
      }).join('');
      dd.style.display = 'block';
    } catch (e) { dd.style.display = 'none'; }
  }, 250);
}

async function openClientDetail(id){
  try{
    const r=await fetch(`/api/clients/${id}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    const cl=d.client, bks=d.bookings||[];
    let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><div class="modal-h"><h3>${cl.full_name}${cl.is_blocked?' <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>':''}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;
    if(cl.is_blocked){
      m+=`<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:12px;font-size:.82rem"><strong style="color:#dc2626"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Client bloqué</strong><br><span style="color:#666">${cl.blocked_reason||'Bloqué manuellement'}</span><br><button style="margin-top:6px;font-size:.75rem;padding:4px 10px;background:#15803d;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="unblockClient('${cl.id}')">Débloquer</button> <button style="margin-top:6px;font-size:.75rem;padding:4px 10px;background:#666;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="resetNoShow('${cl.id}')">Reset no-shows</button></div>`;
    }else if(cl.no_show_count>0){
      m+=`<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:12px;font-size:.82rem"><strong style="color:#B45309"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${cl.no_show_count} no-show${cl.no_show_count>1?'s':''}</strong>${cl.last_no_show_at?` <span style="color:#888">· dernier le ${new Date(cl.last_no_show_at).toLocaleDateString('fr-BE')}</span>`:''}<br><button style="margin-top:6px;font-size:.75rem;padding:4px 10px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="blockClient('${cl.id}')">Bloquer</button> <button style="margin-top:6px;font-size:.75rem;padding:4px 10px;background:#666;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="resetNoShow('${cl.id}')">Reset</button></div>`;
    }
    m+=`<div class="field-row"><div class="field"><label>Nom</label><input id="cl_name" value="${cl.full_name||''}"></div><div class="field"><label>Téléphone</label><input id="cl_phone" value="${cl.phone||''}"></div></div>`;
    m+=`<div class="field-row"><div class="field"><label>Email</label><input id="cl_email" value="${cl.email||''}"></div><div class="field"><label>N° BCE</label><input id="cl_bce" value="${cl.bce_number||''}"></div></div>`;
    m+=`<div class="field"><label>Notes</label><textarea id="cl_notes">${cl.notes||''}</textarea></div>`;

    // ── Historique section (inside modal-body, scrollable) ──
    const stColors={completed:'var(--text-4)',cancelled:'var(--red)',no_show:'#B45309',confirmed:'var(--primary)',pending:'#888',pending_deposit:'#B45309'};
    const stLabels={completed:'Terminé',cancelled:'Annulé',no_show:'No-show',confirmed:'Confirmé',pending:'En attente',pending_deposit:'Acompte requis'};
    m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Historique${bks.length>0?' ('+bks.length+' RDV)':''}</span><span class="m-sec-line"></span></div>`;
    if(bks.length>0){
      m+=`<div style="border-radius:8px;border:1px solid var(--border-light);overflow:hidden;max-height:200px;overflow-y:auto">`;
      bks.slice(0,15).forEach((b,i)=>{
        const dt=new Date(b.start_at);
        const bg=i%2===0?'var(--white)':'var(--surface)';
        const sc=stColors[b.status]||'var(--text-4)';
        const depTag = b.deposit_required ? (() => {
          const dc = {paid:'#15803D',refunded:'#1D4ED8',cancelled:'#DC2626',pending:'#B45309'}[b.deposit_status] || '#888';
          const dl = {paid:'Payé',refunded:'Remboursé',cancelled:'Conservé',pending:'En attente'}[b.deposit_status] || '';
          return `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;color:${dc};background:${dc}12;margin-left:4px">\ud83d\udcb0 ${((b.deposit_amount_cents||0)/100).toFixed(0)}\u20ac ${dl}</span>`;
        })() : '';
        m+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${bg};font-size:.8rem"><span style="color:var(--text)">${dt.toLocaleDateString('fr-BE',{day:'numeric',month:'short'})} — ${b.service_name||'RDV libre'}${depTag}</span><span style="font-size:.68rem;font-weight:600;padding:2px 8px;border-radius:10px;color:${sc};background:${sc}12">${stLabels[b.status]||b.status}</span></div>`;
      });
      m+=`</div>`;
    } else {
      m+=`<div style="text-align:center;padding:16px;font-size:.8rem;color:var(--text-4)">Aucun rendez-vous</div>`;
    }
    m+=`</div>`;

    // ── Whiteboards section ──
    m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg> Whiteboards</span><span class="m-sec-line"></span><button style="font-size:.68rem;padding:3px 10px;background:var(--primary-light);color:var(--primary);border:1px solid var(--primary);border-radius:6px;cursor:pointer;font-weight:700" onclick="openWhiteboardForClient('${cl.id}')">+ Nouveau</button></div><div id="clientWbList" style="font-size:.8rem;color:var(--text-4)">Chargement...</div></div>`;

    // ── Danger zone (subtle, bottom of modal-body) ──
    if(!cl.is_blocked&&cl.no_show_count===0){
      m+=`<div style="text-align:right;padding-top:4px"><button style="font-size:.68rem;padding:4px 10px;background:transparent;color:var(--text-4);border:1px solid var(--border-light);border-radius:6px;cursor:pointer;transition:all .15s" onmouseover="this.style.color='#dc2626';this.style.borderColor='#fecaca';this.style.background='#fef2f2'" onmouseout="this.style.color='var(--text-4)';this.style.borderColor='var(--border-light)';this.style.background='transparent'" onclick="blockClient('${cl.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloquer</button></div>`;
    }

    // ── Close modal-body → single modal-foot with action buttons ──
    m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Fermer</button><button class="btn-primary" onclick="saveClient('${id}')">Enregistrer</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',m);
    // Load whiteboards for this client
    window.loadClientWhiteboards(cl.id).then(wbs=>{
      const el=document.getElementById('clientWbList');
      if(!el)return;
      if(wbs.length===0){el.textContent='Aucun whiteboard';return;}
      el.innerHTML=wbs.map(w=>{
        const dt=new Date(w.created_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border-light)"><span style="cursor:pointer;color:var(--primary);font-weight:500" onclick="window.open('/whiteboard/${w.id}','_blank')">${w.title||'Whiteboard'}</span><span style="font-size:.72rem;color:var(--text-4)">${dt}</span></div>`;
      }).join('');
    });
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveClient(id){
  try{
    const r=await fetch(`/api/clients/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({full_name:document.getElementById('cl_name').value,phone:document.getElementById('cl_phone').value,email:document.getElementById('cl_email').value,bce_number:document.getElementById('cl_bce').value,notes:document.getElementById('cl_notes').value})});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast('Client mis à jour','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function blockClient(id){
  const reason=prompt('Raison du blocage (optionnel):');
  if(reason===null)return;
  try{
    const r=await fetch(`/api/clients/${id}/block`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({reason:reason||'Bloqué manuellement'})});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast('Client bloqué','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function unblockClient(id){
  if(!confirm('Débloquer ce client ? Il pourra à nouveau réserver en ligne.'))return;
  try{
    const r=await fetch(`/api/clients/${id}/unblock`,{method:'POST',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast('Client débloqué','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function resetNoShow(id){
  if(!confirm('Remettre le compteur no-show à zéro et débloquer ?'))return;
  try{
    const r=await fetch(`/api/clients/${id}/reset-noshow`,{method:'POST',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast('Compteur remis à zéro','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Expose to global scope for onclick handlers in dynamic HTML
bridge({ loadClients, openClientDetail, saveClient, blockClient, unblockClient, resetNoShow, clientLiveSearch, get clientSearch(){ return clientSearch; }, set clientSearch(v){ clientSearch=v; }, get clientFilter(){ return clientFilter; }, set clientFilter(v){ clientFilter=v; } });
// Also expose the mutable variables directly on window for inline onclick handlers
Object.defineProperty(window, 'clientSearch', { get(){ return clientSearch; }, set(v){ clientSearch=v; }, configurable: true });
Object.defineProperty(window, 'clientFilter', { get(){ return clientFilter; }, set(v){ clientFilter=v; }, configurable: true });

export { loadClients, openClientDetail, saveClient, blockClient, unblockClient, resetNoShow, clientLiveSearch };
