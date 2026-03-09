/**
 * Clients view module.
 */
import { api, categoryLabels, GendaUI } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';
import { guardModal } from '../utils/dirty-guard.js';
import './whiteboards.js'; // registers openWhiteboardForClient, loadClientWhiteboards on window

let clientSearch='';
let clientFilter='';
let clientSearchTimer=null;
let clientSearchSeq=0;

async function loadClients(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const params=new URLSearchParams();
    if(clientSearch)params.set('search',clientSearch);
    if(clientFilter)params.set('filter',clientFilter);
    const q=params.toString()?'?'+params.toString():'';
    const r=await fetch(`/api/clients${q}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok){ const err=await r.json().catch(()=>({})); throw new Error(err.error||'Erreur chargement clients'); }
    const d=await r.json();
    const clients=d.clients||[];
    const stats=d.stats||{};
    const clLabel=categoryLabels.clients.toLowerCase();
    let h=`<div class="kpis"><div class="kpi" onclick="clientFilter='';loadClients()" style="cursor:pointer"><div class="kpi-val">${stats.total||0}</div><div class="kpi-label">Total ${clLabel}</div></div><div class="kpi" onclick="clientFilter='blocked';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:var(--red)">${stats.blocked||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqués</div></div><div class="kpi" onclick="clientFilter='flagged';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:#B45309">${stats.flagged||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No-shows</div></div><div class="kpi"><div class="kpi-val" style="color:var(--primary)">${stats.clean||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> OK</div></div></div>`;
    h+=`<div class="search-bar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div style="position:relative;flex:1;min-width:200px"><input type="text" placeholder="Rechercher par nom, email ou téléphone..." value="${clientSearch}" id="clientSearchInput" oninput="clientLiveSearch(this.value)" onkeydown="if(event.key==='Enter'){document.getElementById('clientAcDrop').style.display='none';clientSearch=this.value;clientFilter='';loadClients()}" onfocus="if(this.value.length>=3)clientLiveSearch(this.value)" onblur="setTimeout(()=>{const d=document.getElementById('clientAcDrop');if(d)d.style.display='none'},200)" style="width:100%" autocomplete="off"><div id="clientAcDrop" class="ac-results" style="display:none"></div></div><button class="btn-primary" onclick="document.getElementById('clientAcDrop').style.display='none';clientSearch=document.getElementById('clientSearchInput').value;clientFilter='';loadClients()">Rechercher</button>${clientSearch||clientFilter?`<button class="btn-outline" onclick="clientSearch='';clientFilter='';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reset</button>`:''}</div>`;
    h+=`<div style="display:flex;gap:6px;margin-bottom:12px"><button class="btn-sm ${!clientFilter?'active':''}" onclick="clientFilter='';loadClients()">Tous</button><button class="btn-sm ${clientFilter==='blocked'?'active':''}" onclick="clientFilter='blocked';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqués</button><button class="btn-sm ${clientFilter==='flagged'?'active':''}" onclick="clientFilter='flagged';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No-shows</button></div>`;
    h+=`<div class="card"><div class="card-h"><h3>${clientFilter==='blocked'?categoryLabels.clients+' bloqué·e·s':clientFilter==='flagged'?categoryLabels.clients+' avec no-shows':'Tous les '+clLabel}</h3><span class="badge badge-teal">${d.total||clients.length}</span></div>`;
    if(clients.length===0){h+=`<div class="empty">Aucun client${clientSearch?' trouvé':clientFilter?' dans cette catégorie':' encore'}</div>`;}
    else{
      h+=`<div style="overflow-x:auto"><table class="table"><thead><tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>RDV</th><th>No-shows</th><th>Dernière visite</th><th>Statut</th></tr></thead><tbody>`;
      clients.forEach(cl=>{
        const last=cl.last_visit?new Date(cl.last_visit).toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric'}):'—';
        const tagColors={'bloqué':'#dc2626','récidiviste':'#B45309','à surveiller':'#ca8a04','fidèle':'#15803d','actif':'#0D7377','nouveau':'#888'};
        const tagColor=tagColors[cl.tag]||'#888';
        const nsDisplay=cl.no_show_count>0?`<span style="color:#B45309;font-weight:600">${cl.no_show_count}</span>`:'0';
        h+=`<tr${cl.is_blocked?' style="opacity:.6"':''}><td class="client-name" onclick="openClientDetail('${cl.id}')">${esc(cl.full_name)}${cl.is_blocked?' <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>':''}</td><td>${esc(cl.phone||'—')}</td><td style="font-size:.78rem">${esc(cl.email||'—')}</td><td>${cl.total_bookings}</td><td>${nsDisplay}</td><td style="font-size:.78rem">${last}</td><td><span style="font-size:.72rem;font-weight:600;color:${tagColor};background:${tagColor}15;padding:2px 8px;border-radius:10px">${esc(cl.tag)}</span></td></tr>`;
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
    const seq = ++clientSearchSeq;
    try {
      const r = await fetch(`/api/clients?search=${encodeURIComponent(q)}&limit=8`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
      if (seq !== clientSearchSeq) return; // stale response, ignore
      const d = await r.json();
      const cls = d.clients || [];
      if (cls.length === 0) {
        dd.innerHTML = `<div style="padding:12px;text-align:center;font-size:.8rem;color:var(--text-4)">Aucun résultat pour "${esc(q)}"</div>`;
        dd.style.display = 'block'; return;
      }
      dd.innerHTML = cls.map(c => {
        const ns = c.no_show_count > 0
          ? `<span style="font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:8px;background:#FDE68A;color:#B45309;margin-left:6px">${IC.alertTriangle} ${c.no_show_count} no-show${c.no_show_count > 1 ? 's' : ''}</span>`
          : '';
        const bl = c.is_blocked
          ? `<span style="font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:8px;background:#FECACA;color:#dc2626;margin-left:6px">Bloqué</span>`
          : '';
        const meta = [c.phone, c.email].filter(Boolean).join(' · ');
        const tagColors = { 'récidiviste': '#B45309', 'à surveiller': '#ca8a04', 'fidèle': '#15803d', 'actif': '#0D7377', 'nouveau': '#888', 'bloqué': '#dc2626' };
        const tc = tagColors[c.tag] || '#888';
        return `<div class="ac-item" onmousedown="event.preventDefault();openClientDetail('${c.id}');document.getElementById('clientAcDrop').style.display='none'"><div class="ac-name">${esc(c.full_name)}${ns}${bl}</div><div class="ac-meta">${esc(meta)}${meta ? ' · ' : ''}${c.total_bookings} RDV <span style="color:${tc};font-weight:600">${esc(c.tag)}</span></div></div>`;
      }).join('');
      dd.style.display = 'block';
    } catch (e) { dd.style.display = 'none'; }
  }, 250);
}

async function openClientDetail(id){
  try{
    const r=await fetch(`/api/clients/${id}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok){ const err=await r.json().catch(()=>({})); throw new Error(err.error||'Erreur chargement client'); }
    const d=await r.json();
    const cl=d.client, bks=d.bookings||[];
    const X_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    let m=`<div class="m-overlay open" id="clientModal"><div class="m-dialog m-md"><div class="m-header-simple"><h3>${esc(cl.full_name)}${cl.is_blocked?' <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>':''}</h3><button class="m-close" onclick="closeModal('clientModal')">${X_SVG}</button></div><div class="m-body">`;
    if(cl.is_blocked){
      m+=`<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:12px;margin-bottom:12px;font-size:.82rem"><strong style="color:#dc2626"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ${categoryLabels.client} bloqué·e</strong><br><span style="color:#666">${cl.blocked_reason||'Bloqué manuellement'}</span><br><button style="margin-top:6px;font-size:.75rem;padding:4px 10px;background:#15803d;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="unblockClient('${cl.id}')">Débloquer</button> <button style="margin-top:6px;font-size:.75rem;padding:4px 10px;background:#666;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="resetNoShow('${cl.id}')">Reset no-shows</button></div>`;
    }else if(cl.no_show_count>0){
      m+=`<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:12px;margin-bottom:12px;font-size:.82rem"><strong style="color:#B45309"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${cl.no_show_count} no-show${cl.no_show_count>1?'s':''}</strong>${cl.last_no_show_at?` <span style="color:#888">· dernier le ${new Date(cl.last_no_show_at).toLocaleDateString('fr-BE')}</span>`:''}<br><button style="margin-top:6px;font-size:.75rem;padding:4px 10px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="blockClient('${cl.id}')">Bloquer</button> <button style="margin-top:6px;font-size:.75rem;padding:4px 10px;background:#666;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="resetNoShow('${cl.id}')">Reset</button></div>`;
    }
    m+=`<div class="m-row m-row-2"><div><label class="m-field-label">Nom</label><input class="m-input" id="cl_name" value="${esc(cl.full_name||'')}"></div><div><label class="m-field-label">Téléphone</label><input class="m-input" id="cl_phone" value="${esc(cl.phone||'')}"></div></div>`;
    m+=`<div class="m-row m-row-2"><div><label class="m-field-label">Email</label><input class="m-input" id="cl_email" value="${esc(cl.email||'')}"></div><div><label class="m-field-label">N° BCE</label><input class="m-input" id="cl_bce" value="${esc(cl.bce_number||'')}"></div></div>`;
    m+=`<div><label class="m-field-label">Notes</label><textarea class="m-input" id="cl_notes">${esc(cl.notes||'')}</textarea></div>`;

    // ── Notes internes (from bookings) ──
    const intNotes=bks.filter(b=>b.internal_note&&b.internal_note.trim());
    if(intNotes.length>0){
      m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Notes internes (${intNotes.length})</span><span class="m-sec-line"></span></div>`;
      m+=`<div style="border-radius:8px;border:1px solid var(--border-light);overflow:hidden;max-height:200px;overflow-y:auto">`;
      intNotes.forEach((b,i)=>{
        const bg=i%2===0?'var(--white)':'var(--surface)';
        const dt=new Date(b.start_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short'});
        m+=`<div style="padding:8px 12px;background:${bg};font-size:.8rem;cursor:pointer" onclick="fcOpenDetail('${b.id}')">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <span style="font-weight:600;color:var(--text)">${b.service_name||'RDV libre'} · ${dt}</span>
            <span style="font-size:.68rem;color:var(--text-4)">${b.practitioner_name||''}</span>
          </div>
          <div style="font-size:.78rem;color:var(--text-3);line-height:1.4">${esc(b.internal_note)}</div>
        </div>`;
      });
      m+=`</div></div>`;
    }

    // ── Historique section (inside m-body, scrollable) ──
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
        const createdDt=b.created_at?new Date(b.created_at):null;
        const createdStr=createdDt?createdDt.toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric'}):'';
        const creatorStr=b.channel==='web'?'Client (en ligne)':b.created_by_name||'Staff';
        m+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${bg};font-size:.8rem"><div style="display:flex;flex-direction:column;gap:2px"><span style="color:var(--text)">${dt.toLocaleDateString('fr-BE',{day:'numeric',month:'short'})} — ${b.service_name||'RDV libre'}${depTag}</span><span style="font-size:.65rem;color:var(--text-4)">Créé le ${createdStr} par ${creatorStr}</span></div><span style="font-size:.68rem;font-weight:600;padding:2px 8px;border-radius:10px;color:${sc};background:${sc}12;white-space:nowrap">${stLabels[b.status]||b.status}</span></div>`;
      });
      m+=`</div>`;
    } else {
      m+=`<div style="text-align:center;padding:16px;font-size:.8rem;color:var(--text-4)">Aucun rendez-vous</div>`;
    }
    m+=`</div>`;

    // ── Whiteboards section ──
    m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg> Whiteboards</span><span class="m-sec-line"></span><button style="font-size:.68rem;padding:3px 10px;background:var(--primary-light);color:var(--primary);border:1px solid var(--primary);border-radius:6px;cursor:pointer;font-weight:700" onclick="openWhiteboardForClient('${cl.id}')">+ Nouveau</button></div><div id="clientWbList" style="font-size:.8rem;color:var(--text-4)">Chargement...</div></div>`;

    // ── Session notes section ──
    const sessionBookings = (d.bookings || []).filter(b => b.session_notes && b.session_notes.trim() && b.session_notes.trim() !== '<br>');
    m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Notes de séance${sessionBookings.length > 0 ? ' (' + sessionBookings.length + ')' : ''}</span><span class="m-sec-line"></span></div>`;
    if (sessionBookings.length > 0) {
      m+=`<div style="border-radius:8px;border:1px solid var(--border-light);overflow:hidden;max-height:200px;overflow-y:auto">`;
      sessionBookings.forEach((sb, i) => {
        const bg = i % 2 === 0 ? 'var(--white)' : 'var(--surface)';
        const dt = new Date(sb.start_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
        const sent = sb.session_notes_sent_at;
        const badge = sent
          ? '<span style="font-size:.68rem;font-weight:600;padding:2px 8px;border-radius:10px;color:#1B7A42;background:#1B7A4212">Envoyé</span>'
          : '<span style="font-size:.68rem;font-weight:600;padding:2px 8px;border-radius:10px;color:#9C958E;background:#9C958E12">Brouillon</span>';
        m+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${bg};font-size:.8rem;cursor:pointer" onclick="fcOpenDetail('${sb.id}')">
          <span style="color:var(--text)">${sb.service_name || 'RDV'} du ${dt} · ${sb.practitioner_name || ''}</span>
          ${badge}
        </div>`;
      });
      m+=`</div>`;
    } else {
      m+=`<div style="text-align:center;padding:16px;font-size:.8rem;color:var(--text-4)">Aucune note de séance</div>`;
    }
    m+=`</div>`;

    // ── Documents pré-RDV section ──
    const docsList = d.documents || [];
    m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">${IC.fileText} Documents pré-RDV${docsList.length > 0 ? ' (' + docsList.length + ')' : ''}</span><span class="m-sec-line"></span></div>`;
    if (docsList.length > 0) {
      const docStColors = { pending: '#9C958E', sent: '#E6A817', viewed: '#3B82F6', completed: '#1B7A42' };
      const docStLabels = { pending: 'En attente', sent: 'Envoyé', viewed: 'Consulté', completed: 'Complété' };
      const docTypeIco = { info: IC.info, form: IC.clipboard, consent: IC.penTool };
      m+=`<div style="border-radius:8px;border:1px solid var(--border-light);overflow:hidden;max-height:200px;overflow-y:auto">`;
      docsList.forEach((doc, i) => {
        const bg = i % 2 === 0 ? 'var(--white)' : 'var(--surface)';
        const sc = docStColors[doc.status] || '#888';
        const bkDate = doc.booking_date ? new Date(doc.booking_date).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' }) : '';
        m+=`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:${bg};font-size:.8rem">
          <span style="color:var(--text)">${docTypeIco[doc.template_type] || IC.fileText} ${doc.template_name}${bkDate ? ' · RDV ' + bkDate : ''}</span>
          <span style="font-size:.68rem;font-weight:600;padding:2px 8px;border-radius:10px;color:${sc};background:${sc}12">${docStLabels[doc.status] || doc.status}</span>
        </div>`;
      });
      m+=`</div>`;
    } else {
      m+=`<div style="text-align:center;padding:16px;font-size:.8rem;color:var(--text-4)">Aucun document envoyé</div>`;
    }
    m+=`</div>`;

    // ── Danger zone (subtle, bottom of m-body) ──
    if(!cl.is_blocked&&cl.no_show_count===0){
      m+=`<div style="text-align:right;padding-top:4px"><button style="font-size:.68rem;padding:4px 10px;background:transparent;color:var(--text-4);border:1px solid var(--border-light);border-radius:6px;cursor:pointer;transition:all .15s" onmouseover="this.style.color='#dc2626';this.style.borderColor='#fecaca';this.style.background='#fef2f2'" onmouseout="this.style.color='var(--text-4)';this.style.borderColor='var(--border-light)';this.style.background='transparent'" onclick="blockClient('${cl.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloquer</button></div>`;
    }

    // ── Close m-body → m-bottom with action buttons ──
    m+=`</div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('clientModal')">Fermer</button><button class="m-btn m-btn-primary" onclick="saveClient('${id}')">Enregistrer</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',m);
    guardModal(document.getElementById('clientModal'));
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
    document.getElementById('clientModal')?._dirtyGuard?.markClean(); closeModal('clientModal');
    GendaUI.toast(categoryLabels.client+' mis·e à jour','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function blockClient(id){
  const reason=prompt('Raison du blocage (optionnel):');
  if(reason===null)return;
  try{
    const r=await fetch(`/api/clients/${id}/block`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({reason:reason||'Bloqué manuellement'})});
    if(!r.ok)throw new Error((await r.json()).error);
    document.getElementById('clientModal')?._dirtyGuard?.markClean(); closeModal('clientModal');
    GendaUI.toast(categoryLabels.client+' bloqué·e','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function unblockClient(id){
  if(!confirm('Débloquer ? Il/elle pourra à nouveau réserver en ligne.'))return;
  try{
    const r=await fetch(`/api/clients/${id}/unblock`,{method:'POST',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    document.getElementById('clientModal')?._dirtyGuard?.markClean(); closeModal('clientModal');
    GendaUI.toast(categoryLabels.client+' débloqué·e','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function resetNoShow(id){
  if(!confirm('Remettre le compteur no-show à zéro et débloquer ?'))return;
  try{
    const r=await fetch(`/api/clients/${id}/reset-noshow`,{method:'POST',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    document.getElementById('clientModal')?._dirtyGuard?.markClean(); closeModal('clientModal');
    GendaUI.toast('Compteur remis à zéro','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Expose to global scope for onclick handlers in dynamic HTML
bridge({ loadClients, openClientDetail, saveClient, blockClient, unblockClient, resetNoShow, clientLiveSearch, get clientSearch(){ return clientSearch; }, set clientSearch(v){ clientSearch=v; }, get clientFilter(){ return clientFilter; }, set clientFilter(v){ clientFilter=v; } });
// Also expose the mutable variables directly on window for inline onclick handlers
Object.defineProperty(window, 'clientSearch', { get(){ return clientSearch; }, set(v){ clientSearch=v; }, configurable: true });
Object.defineProperty(window, 'clientFilter', { get(){ return clientFilter; }, set(v){ clientFilter=v; }, configurable: true });

export { loadClients, openClientDetail, saveClient, blockClient, unblockClient, resetNoShow, clientLiveSearch };
