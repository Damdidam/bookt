/**
 * Home / Dashboard view module.
 */
import { api, biz, userRole, calState, GendaUI, categoryLabels } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

async function loadDashboard(){
  const c=document.getElementById('contentArea');
  const isPrac=userRole==='practitioner';
  try{
    const[dd,sd]=await Promise.allSettled([api.getDashboard(),api.get('/api/dashboard/summary')]);
    const dash=dd.status==='fulfilled'?dd.value:{},sum=sd.status==='fulfilled'?sd.value:null;
    const slug=dash.business?.slug||biz?.slug||'';
    let h='';
    if(!isPrac){
      h+=`<div class="qlink"><div class="info"><h4>Votre page publique</h4><p>${slug}</p></div><div><a href="/${slug}?preview" target="_blank">Voir ma page</a></div></div>`;
    }
    if(sum){const m=sum.month||{},cl=sum.clients||{},ca=sum.calls||{};
      h+=`<div class="stats"><div class="stat-card"><div class="label">RDV aujourd'hui</div><div class="val">${sum.today?.count||0}</div></div><div class="stat-card"><div class="label">${isPrac?'Mon CA ce mois':'CA ce mois'}</div><div class="val">${m.revenue_formatted||'0 €'}</div><div class="sub">${m.total_bookings||0} RDV</div></div><div class="stat-card"><div class="label">${isPrac?'Mes '+categoryLabels.clients.toLowerCase():categoryLabels.clients}</div><div class="val">${cl.total||0}</div></div>${isPrac?'':`<div class="stat-card"><div class="label">Appels → RDV</div><div class="val">${ca.conversion_rate||0}%</div></div>`}</div>`;
      h+=`<div class="card"><div class="card-h"><h3>${isPrac?'Mes RDV du jour':'RDV du jour'}</h3><span class="badge badge-teal">${sum.today?.count||0}</span></div>`;
      if(sum.today?.bookings?.length>0){sum.today.bookings.forEach(b=>{
        const t=new Date(b.start_at).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
        let badges='';
        if(b.todo_count>0)badges+=`<span class="bk-badge todo"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> ${b.todo_count}</span>`;
        if(b.note_count>0||b.has_internal_note)badges+=`<span class="bk-badge note"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>`;
        h+=`<div class="bk-row" onclick="openBookingDetail('${b.id}')">
          <span style="font-size:.85rem;font-weight:700;color:var(--primary);min-width:50px">${t}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:.85rem;font-weight:600;display:flex;align-items:center;gap:6px">${b.client_name}<span class="bk-badges">${badges}</span></div>
            <div style="font-size:.72rem;color:var(--text-4)">${b.service_name||'RDV libre'} · ${b.duration_min||'—'}min${!isPrac&&b.practitioner_name?' · '+b.practitioner_name:''}</div>
          </div>
          <span class="bk-status ${b.status}">${b.status==='confirmed'?'Confirmé':b.status==='pending'?'En attente':b.status}</span>
        </div>`;
      });}
      else h+=`<div class="empty">Aucun RDV aujourd'hui</div>`;
      h+=`</div>`;
    }else{h+=`<div class="stats"><div class="stat-card"><div class="label">RDV</div><div class="val">0</div></div><div class="stat-card"><div class="label">CA</div><div class="val">0 €</div></div><div class="stat-card"><div class="label">${categoryLabels.clients}</div><div class="val">0</div></div>${isPrac?'':`<div class="stat-card"><div class="label">Appels</div><div class="val">—</div></div>`}</div><div class="card"><div class="card-h"><h3>RDV du jour</h3></div><div class="empty">Aucun RDV</div></div>`;}
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}<br><button onclick="loadDashboard()" style="margin-top:8px;padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--white);cursor:pointer">Réessayer</button></div>`;}
}

// Open booking detail modal from anywhere (dashboard, clients, etc.)
// Loads practitioners on demand if calendar hasn't been opened yet
async function openBookingDetail(bookingId){
  try{
    // Ensure practitioners are loaded (needed for practitioner dropdown in modal)
    if(!calState.fcPractitioners||calState.fcPractitioners.length===0){
      const r=await fetch('/api/practitioners',{headers:{'Authorization':'Bearer '+api.getToken()}});
      if(r.ok){const d=await r.json();calState.fcPractitioners=d.practitioners||[];}
    }
    await window.fcOpenDetail(bookingId);
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

bridge({ loadDashboard, openBookingDetail });

export { loadDashboard, openBookingDetail };
