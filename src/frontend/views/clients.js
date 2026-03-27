/**
 * Clients view module.
 */
import { api, categoryLabels, GendaUI } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';
import { guardModal } from '../utils/dirty-guard.js';

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
    let h=`<div class="kpis"><div class="kpi" onclick="clientFilter='';loadClients()" style="cursor:pointer"><div class="kpi-val">${stats.total||0}</div><div class="kpi-label">Total ${clLabel}</div></div><div class="kpi" onclick="clientFilter='blocked';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:var(--red)">${stats.blocked||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqués</div></div><div class="kpi" onclick="clientFilter='flagged';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:var(--amber-dark)">${stats.flagged||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No-shows</div></div><div class="kpi" onclick="clientFilter='fantome';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:var(--purple)">${stats.fantome||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> Fantômes</div></div><div class="kpi" onclick="clientFilter='vip';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:var(--gold)">${stats.vip||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> VIP</div></div><div class="kpi" onclick="clientFilter='birthday_week';loadClients()" style="cursor:pointer"><div class="kpi-val" style="color:var(--pink)">${stats.birthday_week||0}</div><div class="kpi-label">${IC.gift} Anniversaires</div></div><div class="kpi"><div class="kpi-val" style="color:var(--primary)">${stats.clean||0}</div><div class="kpi-label"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> OK</div></div></div>`;
    h+=`<div class="search-bar" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><div style="position:relative;flex:1;min-width:200px"><input type="text" placeholder="Rechercher par nom, email ou téléphone..." value="${clientSearch}" id="clientSearchInput" oninput="clientLiveSearch(this.value)" onkeydown="if(event.key==='Enter'){document.getElementById('clientAcDrop').style.display='none';clientSearch=this.value;clientFilter='';loadClients()}" onfocus="if(this.value.length>=3)clientLiveSearch(this.value)" onblur="setTimeout(()=>{const d=document.getElementById('clientAcDrop');if(d)d.style.display='none'},200)" style="width:100%" autocomplete="off"><div id="clientAcDrop" class="ac-results" style="display:none"></div></div><button class="btn-primary" onclick="document.getElementById('clientAcDrop').style.display='none';clientSearch=document.getElementById('clientSearchInput').value;clientFilter='';loadClients()">Rechercher</button><button class="btn-primary" onclick="openNewClientModal()" title="Ajouter un client"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>${clientSearch||clientFilter?`<button class="btn-outline" onclick="clientSearch='';clientFilter='';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Reset</button>`:''}</div>`;
    h+=`<div style="display:flex;gap:6px;margin-bottom:12px"><button class="btn-sm ${!clientFilter?'active':''}" onclick="clientFilter='';loadClients()">Tous</button><button class="btn-sm ${clientFilter==='blocked'?'active':''}" onclick="clientFilter='blocked';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloqués</button><button class="btn-sm ${clientFilter==='flagged'?'active':''}" onclick="clientFilter='flagged';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> No-shows</button><button class="btn-sm ${clientFilter==='fantome'?'active':''}" onclick="clientFilter='fantome';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> Fantômes</button><button class="btn-sm ${clientFilter==='vip'?'active':''}" onclick="clientFilter='vip';loadClients()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg> VIP</button><button class="btn-sm ${clientFilter==='birthday_week'?'active':''}" onclick="clientFilter='birthday_week';loadClients()">${IC.gift} Anniversaires</button></div>`;
    h+=`<div class="card"><div class="card-h"><h3>${clientFilter==='blocked'?categoryLabels.clients+' bloqué·e·s':clientFilter==='flagged'?categoryLabels.clients+' avec no-shows':clientFilter==='fantome'?categoryLabels.clients+' fantômes':clientFilter==='vip'?categoryLabels.clients+' VIP':clientFilter==='birthday_week'?'Anniversaires cette semaine':'Tous les '+clLabel}</h3><span class="badge badge-teal">${d.total||clients.length}</span></div>`;
    if(clients.length===0){h+=`<div class="empty">Aucun client${clientSearch?' trouvé':clientFilter?' dans cette catégorie':' encore'}</div>`;}
    else{
      h+=`<div style="overflow-x:auto"><table class="table"><thead><tr><th>Nom</th><th>Téléphone</th><th>Email</th><th>RDV</th><th>NS</th><th title="Réservations jamais confirmées">Exp.</th><th>Dernière visite</th><th>Statut</th></tr></thead><tbody>`;
      clients.forEach(cl=>{
        const last=cl.last_visit?new Date(cl.last_visit).toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric'}):'—';
        const tagColors={'bloqué':'#dc2626','récidiviste':'#B45309','à surveiller':'#ca8a04','fantôme':'#7C3AED','fidèle':'#15803d','actif':'#0D7377','nouveau':'#888'};
        const tagColor=tagColors[cl.tag]||'#888';
        const nsDisplay=cl.no_show_count>0?`<span style="color:var(--amber-dark);font-weight:600">${cl.no_show_count}</span>`:'0';
        const epDisplay=cl.expired_pending_count>0?`<span style="color:var(--purple);font-weight:600">${cl.expired_pending_count}</span>`:'0';
        const vipStar=cl.is_vip?`<span style="color:var(--gold);margin-right:4px" title="VIP">${IC.star}</span>`:'';
        const blockedIcon=cl.is_blocked?` ${IC.ban}`:'';
        h+=`<tr${cl.is_blocked?' style="opacity:.6"':''}><td class="client-name" onclick="openClientDetail('${cl.id}')">${vipStar}${esc(cl.full_name)}${blockedIcon}</td><td>${esc(cl.phone||'—')}</td><td style="font-size:.78rem">${esc(cl.email||'—')}</td><td>${cl.total_bookings}</td><td>${nsDisplay}</td><td>${epDisplay}</td><td style="font-size:.78rem">${last}</td><td><span style="font-size:.72rem;font-weight:600;color:${tagColor};background:${tagColor}15;padding:2px 8px;border-radius:10px">${esc(cl.tag)}</span></td></tr>`;
      });
      h+=`</tbody></table></div>`;
    }
    h+=`</div>`;
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;}
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
        const vip = c.is_vip
          ? `<span style="font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:8px;background:var(--amber-bg);color:var(--gold);margin-left:6px">${IC.star} VIP</span>`
          : '';
        const ns = c.no_show_count > 0
          ? `<span style="font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:8px;background:var(--amber-bg);color:var(--amber-dark);margin-left:6px">${IC.alertTriangle} ${c.no_show_count} no-show${c.no_show_count > 1 ? 's' : ''}</span>`
          : '';
        const bl = c.is_blocked
          ? `<span style="font-size:.62rem;font-weight:700;padding:1px 6px;border-radius:8px;background:var(--red-bg);color:var(--red);margin-left:6px">Bloqué</span>`
          : '';
        const meta = [c.phone, c.email].filter(Boolean).join(' · ');
        const tagColors = { 'récidiviste': '#B45309', 'à surveiller': '#ca8a04', 'fantôme': '#7C3AED', 'fidèle': '#15803d', 'actif': '#0D7377', 'nouveau': '#888', 'bloqué': '#dc2626' };
        const tc = tagColors[c.tag] || '#888';
        return `<div class="ac-item" onmousedown="event.preventDefault();openClientDetail('${c.id}');document.getElementById('clientAcDrop').style.display='none'"><div class="ac-name">${esc(c.full_name)}${vip}${ns}${bl}</div><div class="ac-meta">${esc(meta)}${meta ? ' · ' : ''}${c.total_bookings} RDV <span style="color:${tc};font-weight:600">${esc(c.tag)}</span></div></div>`;
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
    const vipIcon=cl.is_vip?`<span style="color:var(--gold);margin-right:6px">${IC.star}</span>`:'';
    const blockedMark=cl.is_blocked?` ${IC.ban}`:'';
    let m=`<div class="m-overlay open" id="clientModal"><div class="m-dialog m-md"><div class="m-header-simple"><h3>${vipIcon}${esc(cl.full_name)}${blockedMark}</h3><button class="m-close" onclick="closeModal('clientModal')">${IC.x}</button></div><div class="m-body">`;
    if(cl.is_blocked){
      m+=`<div style="background:var(--red-bg);border:1px solid var(--red-bg);border-radius:8px;padding:12px;margin-bottom:12px;font-size:.82rem"><strong style="color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> ${categoryLabels.client} bloqué·e</strong><br><span style="color:var(--text-3)">${cl.blocked_reason||'Bloqué manuellement'}</span><br><button class="btn-sm" style="margin-top:6px;background:var(--green);color:#fff;border:none" onclick="unblockClient('${cl.id}')">Débloquer</button> <button class="btn-sm" style="margin-top:6px;background:var(--text-3);color:#fff;border:none" onclick="resetNoShow('${cl.id}')">Reset no-shows</button></div>`;
    }else if(cl.no_show_count>0){
      m+=`<div style="background:var(--amber-bg);border:1px solid var(--amber-bg);border-radius:8px;padding:12px;margin-bottom:12px;font-size:.82rem"><strong style="color:var(--amber-dark)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> ${cl.no_show_count} no-show${cl.no_show_count>1?'s':''}</strong>${cl.last_no_show_at?` <span style="color:var(--text-4)">· dernier le ${new Date(cl.last_no_show_at).toLocaleDateString('fr-BE')}</span>`:''}<br><button class="btn-sm btn-danger" style="margin-top:6px" onclick="blockClient('${cl.id}')">Bloquer</button> <button class="btn-sm" style="margin-top:6px;background:var(--text-3);color:#fff;border:none" onclick="resetNoShow('${cl.id}')">Reset</button></div>`;
    }
    if(cl.expired_pending_count>0){
      m+=`<div style="background:var(--purple-bg);border:1px solid var(--purple-bg);border-radius:8px;padding:12px;margin-bottom:12px;font-size:.82rem"><strong style="color:var(--purple)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg> ${cl.expired_pending_count} réservation${cl.expired_pending_count>1?'s':''} jamais confirmée${cl.expired_pending_count>1?'s':''}</strong>${cl.last_expired_pending_at?` <span style="color:var(--text-4)">· dernière le ${new Date(cl.last_expired_pending_at).toLocaleDateString('fr-BE')}</span>`:''}<br><button class="btn-sm" style="margin-top:6px;background:var(--text-3);color:#fff;border:none" onclick="resetExpired('${cl.id}')">Reset</button></div>`;
    }
    m+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:${cl.is_vip?'var(--amber-bg)':'var(--surface)'};border:1px solid ${cl.is_vip?'var(--gold)':'var(--border-light)'};border-radius:10px;margin-bottom:14px;transition:all .2s">
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:1.1rem;color:var(--gold)">${IC.star}</span>
        <div><div style="font-size:.82rem;font-weight:600;color:${cl.is_vip?'var(--gold)':'var(--text)'}">Client VIP</div></div>
      </div>
      <label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;cursor:pointer">
        <input type="checkbox" id="cl_vip" ${cl.is_vip?'checked':''} onchange="(function(t){var w=t.closest('div[style*=padding]');var spans=t.parentElement.querySelectorAll('span');spans[0].style.background=t.checked?'var(--gold)':'var(--border)';spans[1].style.left=t.checked?'22px':'2px';w.style.background=t.checked?'var(--amber-bg)':'var(--surface)';w.style.borderColor=t.checked?'var(--gold)':'var(--border-light)';w.querySelector('div>div>div').style.color=t.checked?'var(--gold)':'var(--text)'})(this)" style="opacity:0;width:0;height:0;position:absolute">
        <span style="position:absolute;inset:0;border-radius:100px;background:${cl.is_vip?'var(--gold)':'var(--border)'};transition:all .2s"></span>
        <span style="position:absolute;left:${cl.is_vip?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    m+=`<div class="m-row m-row-2"><div><label class="m-field-label">Nom</label><input class="m-input" id="cl_name" value="${esc(cl.full_name||'')}"></div><div><label class="m-field-label">Téléphone</label><input class="m-input" id="cl_phone" value="${esc(cl.phone||'')}"></div></div>`;
    m+=`<div class="m-row m-row-2"><div><label class="m-field-label">Email</label><input class="m-input" id="cl_email" value="${esc(cl.email||'')}"></div><div><label class="m-field-label">N° BCE</label><input class="m-input" id="cl_bce" value="${esc(cl.bce_number||'')}"></div></div>`;
    m+=`<div class="m-row m-row-2"><div><label class="m-field-label">Anniversaire</label><input class="m-input" type="date" id="cl_birthday" value="${cl.birthday?cl.birthday.substring(0,10):''}"></div><div></div></div>`;
    m+=`<div><label class="m-field-label">Notes</label><textarea class="m-input" id="cl_notes">${esc(cl.notes||'')}</textarea></div>`;

    // ── Notes from bookings (internal + client comments) ──
    const allNotes=bks.filter(b=>(b.internal_note&&b.internal_note.trim())||(b.comment_client&&b.comment_client.trim()));
    if(allNotes.length>0){
      m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Notes des RDV (${allNotes.length})</span><span class="m-sec-line"></span></div>`;
      m+=`<div style="border-radius:8px;border:1px solid var(--border-light);overflow:hidden;max-height:200px;overflow-y:auto">`;
      allNotes.forEach((b,i)=>{
        const bg=i%2===0?'var(--white)':'var(--surface)';
        const dt=new Date(b.start_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short'});
        m+=`<div style="padding:8px 12px;background:${bg};font-size:.8rem;cursor:pointer" onclick="fcOpenDetail('${b.id}')">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
            <span style="font-weight:600;color:var(--text)">${b.service_name||'RDV libre'} · ${dt}</span>
            <span style="font-size:.68rem;color:var(--text-4)">${b.practitioner_name||''}</span>
          </div>`;
        if(b.comment_client&&b.comment_client.trim()){
          m+=`<div style="font-size:.78rem;color:var(--text-3);line-height:1.4"><span style="font-weight:600;color:var(--primary)">Client :</span> ${esc(b.comment_client)}</div>`;
        }
        if(b.internal_note&&b.internal_note.trim()){
          m+=`<div style="font-size:.78rem;color:var(--text-3);line-height:1.4"><span style="font-weight:600;color:var(--amber-dark)">Interne :</span> ${esc(b.internal_note)}</div>`;
        }
        m+=`</div>`;
      });
      m+=`</div></div>`;
    }

    // ── Gift cards section ──
    const gcs = d.gift_cards || [];
    if (gcs.length > 0) {
      const totalBalance = gcs.reduce((s, g) => s + (g.status === 'active' ? g.balance_cents : 0), 0);
      m += `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">${IC.gift} Cartes cadeau${totalBalance > 0 ? ' · <span style="color:var(--green);font-weight:700">' + (totalBalance/100).toFixed(2) + ' €</span>' : ''}</span><span class="m-sec-line"></span></div>`;
      m += `<div style="border-radius:8px;border:1px solid var(--border-light);overflow:hidden">`;
      gcs.forEach((g, i) => {
        const bg = i % 2 === 0 ? 'var(--white)' : 'var(--surface)';
        const bal = (g.balance_cents / 100).toFixed(2);
        const orig = (g.amount_cents / 100).toFixed(2);
        const exp = g.expires_at ? new Date(g.expires_at).toLocaleDateString('fr-BE', {day:'numeric',month:'short',year:'numeric'}) : '—';
        const active = g.status === 'active' && g.balance_cents > 0;
        m += `<div style="background:${bg}">`;
        m += `<div style="padding:8px 12px;font-size:.8rem;display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-weight:600;font-family:monospace;letter-spacing:.5px">${g.code}</span>
            <span style="font-size:.72rem;color:var(--text-4);margin-left:6px">exp. ${exp}</span>
          </div>
          <div style="text-align:right">
            <span style="font-weight:700;color:${active?'var(--green)':'var(--text-4)'}">${bal} €</span>
            ${g.balance_cents < g.amount_cents ? '<span style="font-size:.7rem;color:var(--text-4);margin-left:4px;text-decoration:line-through">' + orig + ' €</span>' : ''}
          </div>
        </div>`;
        const gcTxs = g.transactions || [];
        if (gcTxs.length > 0) {
          const txColors = {purchase:'var(--green)',debit:'var(--red)',refund:'var(--primary)'};
          const txLabels = {purchase:'Achat',debit:'Débit',refund:'Remboursement'};
          const txSigns = {purchase:'+',debit:'-',refund:'+'};
          m += `<div style="padding:0 12px 8px;font-size:.72rem">`;
          gcTxs.forEach(t => {
            const dt = new Date(t.created_at).toLocaleDateString('fr-BE', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
            const col = txColors[t.type] || 'var(--text-4)';
            const sign = txSigns[t.type] || '';
            const label = txLabels[t.type] || t.type;
            const amt = (Math.abs(t.amount_cents) / 100).toFixed(2);
            m += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;color:var(--text-3)">
              <span><span style="color:${col};font-weight:600">${sign}${amt} €</span> ${esc(label)}${t.note ? ' — ' + esc(t.note) : ''}</span>
              <span style="color:var(--text-4)">${dt}</span>
            </div>`;
          });
          m += `</div>`;
        }
        m += `</div>`;
      });
      m += `</div></div>`;
    }

    // ── Passes / Abonnements section ──
    const passes = d.passes || [];
    if (passes.length > 0) {
      const totalSessions = passes.reduce((s, p) => s + (p.status === 'active' ? p.sessions_remaining : 0), 0);
      m += `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">${IC.listChecks} Abonnements${totalSessions > 0 ? ' · <span style="color:var(--green);font-weight:700">' + totalSessions + ' séance' + (totalSessions > 1 ? 's' : '') + '</span>' : ''}</span><span class="m-sec-line"></span></div>`;
      m += `<div style="border-radius:8px;border:1px solid var(--border-light);overflow:hidden">`;
      passes.forEach((p, i) => {
        const bg = i % 2 === 0 ? 'var(--white)' : 'var(--surface)';
        const exp = p.expires_at ? new Date(p.expires_at).toLocaleDateString('fr-BE', {day:'numeric',month:'short',year:'numeric'}) : '—';
        const active = p.status === 'active' && p.sessions_remaining > 0;
        m += `<div style="background:${bg}">`;
        m += `<div style="padding:8px 12px;font-size:.8rem;display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-weight:600;font-family:monospace;letter-spacing:.5px">${esc(p.code)}</span>
            <span style="font-size:.72rem;color:var(--text-4);margin-left:6px">${esc(p.service_name || p.name)}</span>
            <span style="font-size:.72rem;color:var(--text-4);margin-left:6px">exp. ${exp}</span>
          </div>
          <div style="text-align:right">
            <span style="font-weight:700;color:${active?'var(--green)':'var(--text-4)'}">${p.sessions_remaining}/${p.sessions_total}</span>
            <span style="font-size:.72rem;color:var(--text-4);margin-left:4px">séance${p.sessions_total > 1 ? 's' : ''}</span>
          </div>
        </div>`;
        // Transaction history
        const txs = p.transactions || [];
        if (txs.length > 0) {
          const txColors = {purchase:'var(--green)',debit:'var(--red)',refund:'var(--primary)',cancel:'var(--text-4)'};
          const txLabels = {purchase:'Achat',debit:'Débit',refund:'Remboursement',cancel:'Annulation'};
          const txSigns = {purchase:'+',debit:'-',refund:'+',cancel:''};
          m += `<div style="padding:0 12px 8px;font-size:.72rem">`;
          txs.forEach(t => {
            const dt = new Date(t.created_at).toLocaleDateString('fr-BE', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
            const col = txColors[t.type] || 'var(--text-4)';
            const sign = txSigns[t.type] || '';
            const label = txLabels[t.type] || t.type;
            m += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;color:var(--text-3)">
              <span><span style="color:${col};font-weight:600">${sign}${Math.abs(t.sessions)}</span> ${esc(label)}${t.note ? ' — ' + esc(t.note) : ''}</span>
              <span style="color:var(--text-4)">${dt}</span>
            </div>`;
          });
          m += `</div>`;
        }
        m += `</div>`;
      });
      m += `</div></div>`;
    }

    // ── Historique section (inside m-body, scrollable) ──
    const stColors={completed:'var(--text-4)',cancelled:'var(--red)',no_show:'var(--amber-dark)',confirmed:'var(--primary)',pending:'var(--text-4)',pending_deposit:'var(--amber-dark)'};
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
          return `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;color:${dc};background:${dc}12;margin-left:4px">\ud83d\udcb0 ${((b.deposit_amount_cents||0)/100).toFixed(2).replace('.',',')}\u20ac ${dl}</span>`;
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

    // ── Remarques (rich text for staff) ──
    m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Remarques</span><span class="m-sec-line"></span></div>`;
    m+=`<div style="border:1px solid var(--border-light);border-radius:8px;overflow:hidden">
      <div id="cl_remarks_toolbar" style="display:flex;gap:2px;padding:4px 6px;background:var(--surface);border-bottom:1px solid var(--border-light)">
        <button type="button" style="padding:2px 6px;background:none;border:1px solid var(--border-light);border-radius:4px;cursor:pointer;font-weight:700;font-size:.8rem" onclick="document.execCommand('bold')"><b>G</b></button>
        <button type="button" style="padding:2px 6px;background:none;border:1px solid var(--border-light);border-radius:4px;cursor:pointer;font-style:italic;font-size:.8rem" onclick="document.execCommand('italic')"><i>I</i></button>
        <button type="button" style="padding:2px 6px;background:none;border:1px solid var(--border-light);border-radius:4px;cursor:pointer;font-size:.8rem" onclick="document.execCommand('underline')"><u>S</u></button>
        <button type="button" style="padding:2px 6px;background:none;border:1px solid var(--border-light);border-radius:4px;cursor:pointer;font-size:.8rem" onclick="document.execCommand('insertUnorderedList')">• Liste</button>
      </div>
      <div id="cl_remarks" contenteditable="true" style="min-height:80px;max-height:200px;overflow-y:auto;padding:8px 12px;font-size:.82rem;line-height:1.5;outline:none">${cl.remarks||''}</div>
    </div></div>`;

    // ── Danger zone (subtle, bottom of m-body) ──
    if(!cl.is_blocked&&cl.no_show_count===0){
      m+=`<div style="text-align:right;padding-top:4px"><button style="font-size:.68rem;padding:4px 10px;background:transparent;color:var(--text-4);border:1px solid var(--border-light);border-radius:6px;cursor:pointer;transition:all .15s" onmouseover="this.style.color='var(--red)';this.style.borderColor='var(--red-bg)';this.style.background='var(--red-bg)'" onmouseout="this.style.color='var(--text-4)';this.style.borderColor='var(--border-light)';this.style.background='transparent'" onclick="blockClient('${cl.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg> Bloquer</button></div>`;
    }

    // ── Close m-body → m-bottom with action buttons ──
    m+=`</div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('clientModal')">Fermer</button><button class="m-btn m-btn-primary" onclick="saveClient('${id}')">Enregistrer</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',m);
    guardModal(document.getElementById('clientModal'), { noBackdropClose: true });
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveClient(id){
  try{
    const remarkEl=document.getElementById('cl_remarks');
    const remarksHtml=remarkEl?remarkEl.innerHTML.trim():'';
    const bdayVal=document.getElementById('cl_birthday')?.value||null;
    const r=await fetch(`/api/clients/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({full_name:document.getElementById('cl_name').value,phone:document.getElementById('cl_phone').value,email:document.getElementById('cl_email').value,bce_number:document.getElementById('cl_bce').value,notes:document.getElementById('cl_notes').value,remarks:remarksHtml,birthday:bdayVal||null,is_vip:document.getElementById('cl_vip')?.checked||false})});
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

async function resetExpired(id){
  if(!confirm('Remettre le compteur de réservations non confirmées à zéro ?'))return;
  try{
    const r=await fetch(`/api/clients/${id}/reset-expired`,{method:'POST',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    document.getElementById('clientModal')?._dirtyGuard?.markClean(); closeModal('clientModal');
    GendaUI.toast('Compteur remis à zéro','success');loadClients();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function openNewClientModal(){
  let m=`<div class="m-overlay open" id="newClientModal"><div class="m-dialog m-sm"><div class="m-header-simple"><h3>Nouveau ${categoryLabels.client.toLowerCase()}</h3><button class="m-close" onclick="closeModal('newClientModal')">${IC.x}</button></div><div class="m-body">`;
  m+=`<div class="m-row"><div><label class="m-field-label">Nom *</label><input class="m-input" id="nc_name" placeholder="Nom complet"></div></div>`;
  m+=`<div class="m-row m-row-2"><div><label class="m-field-label">Téléphone</label><input class="m-input" id="nc_phone" placeholder="+32..."></div><div><label class="m-field-label">Email</label><input class="m-input" id="nc_email" type="email" placeholder="email@exemple.com"></div></div>`;
  m+=`</div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('newClientModal')">Annuler</button><button class="m-btn m-btn-primary" onclick="createClient()">Créer</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
  guardModal(document.getElementById('newClientModal'), { noBackdropClose: true });
  document.getElementById('nc_name').focus();
}

async function createClient(){
  const name=document.getElementById('nc_name').value.trim();
  const phone=document.getElementById('nc_phone').value.trim();
  const email=document.getElementById('nc_email').value.trim();
  if(!name){GendaUI.toast('Le nom est requis','error');return;}
  try{
    const r=await fetch('/api/clients',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({full_name:name,phone:phone||null,email:email||null})});
    if(!r.ok)throw new Error((await r.json()).error);
    const d=await r.json();
    closeModal('newClientModal');
    GendaUI.toast(categoryLabels.client+' créé·e','success');
    loadClients();
    openClientDetail(d.client.id);
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Expose to global scope for onclick handlers in dynamic HTML
bridge({ loadClients, openClientDetail, openNewClientModal, createClient, saveClient, blockClient, unblockClient, resetNoShow, resetExpired, clientLiveSearch, get clientSearch(){ return clientSearch; }, set clientSearch(v){ clientSearch=v; }, get clientFilter(){ return clientFilter; }, set clientFilter(v){ clientFilter=v; } });
// Also expose the mutable variables directly on window for inline onclick handlers
Object.defineProperty(window, 'clientSearch', { get(){ return clientSearch; }, set(v){ clientSearch=v; }, configurable: true });
Object.defineProperty(window, 'clientFilter', { get(){ return clientFilter; }, set(v){ clientFilter=v; }, configurable: true });

export { loadClients, openClientDetail, openNewClientModal, createClient, saveClient, blockClient, unblockClient, resetNoShow, resetExpired, clientLiveSearch };
