/**
 * Home / Dashboard view module.
 */
import { api, biz, userRole, calState, GendaUI, categoryLabels } from '../state.js';
import { esc } from '../utils/dom.js';
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
    if(sum){
      const ca=sum.calls||{};
      const nb=sum.next_booking;
      const todos=sum.pending_todos||[];

      // ── KPI tiles ──
      const nbTime=nb?new Date(nb.start_at).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'}):'';
      const nbDate=nb?new Date(nb.start_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short'}):'';
      h+=`<div class="stats">`;
      h+=`<div class="stat-card"><div class="label">RDV aujourd'hui</div><div class="val">${sum.today?.count||0}</div></div>`;
      h+=`<div class="stat-card${nb?' stat-card-link':''}"${nb?` onclick="openBookingDetail('${nb.id}')"`:''}><div class="label">Prochain RDV</div>${nb?`<div class="val" style="font-size:1.2rem">${nbTime}</div><div class="sub">${esc(nb.client_name||'—')} · ${nbDate}</div>`:`<div class="val" style="font-size:.9rem;color:var(--text-4)">—</div><div class="sub">Aucun prévu</div>`}</div>`;
      h+=`<div class="stat-card"><div class="label">Tâches</div><div class="val">${todos.length}</div><div class="sub">à faire</div></div>`;
      if(!isPrac) h+=`<div class="stat-card"><div class="label">Appels → RDV</div><div class="val">${ca.conversion_rate||0}%</div></div>`;
      h+=`</div>`;

      // ── Prochain RDV card ──
      if(nb){
        const nbSt=nb.status==='confirmed'?'Confirmé':'En attente';
        const nbStCls=nb.status==='confirmed'?'confirmed':'pending';
        h+=`<div class="card dash-next"><div class="card-h"><h3>Prochain RDV</h3><span class="badge badge-teal">${nbDate} · ${nbTime}</span></div>`;
        h+=`<div class="bk-row" onclick="openBookingDetail('${nb.id}')">`;
        h+=`<span style="font-size:.85rem;font-weight:700;color:var(--primary);min-width:50px">${nbTime}</span>`;
        h+=`<div style="flex:1;min-width:0"><div style="font-size:.85rem;font-weight:600">${esc(nb.client_name||'—')}</div><div style="font-size:.72rem;color:var(--text-4)">${esc(nb.service_name||'RDV libre')} · ${nb.duration_min||'—'}min${!isPrac&&nb.practitioner_name?' · '+esc(nb.practitioner_name):''}</div></div>`;
        h+=`<span class="bk-status ${nbStCls}">${nbSt}</span>`;
        h+=`</div></div>`;
      }

      // ── RDV du jour ──
      h+=`<div class="card"><div class="card-h"><h3>${isPrac?'Mes RDV du jour':'RDV du jour'}</h3><span class="badge badge-teal">${sum.today?.count||0}</span></div>`;
      if(sum.today?.bookings?.length>0){sum.today.bookings.forEach(b=>{
        const t=new Date(b.start_at).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
        let badges='';
        if(b.todo_count>0)badges+=`<span class="bk-badge todo"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> ${b.todo_count}</span>`;
        if(b.note_count>0||b.has_internal_note)badges+=`<span class="bk-badge note"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></span>`;
        h+=`<div class="bk-row" onclick="openBookingDetail('${b.id}')">
          <span style="font-size:.85rem;font-weight:700;color:var(--primary);min-width:50px">${t}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:.85rem;font-weight:600;display:flex;align-items:center;gap:6px">${esc(b.client_name)}<span class="bk-badges">${badges}</span></div>
            <div style="font-size:.72rem;color:var(--text-4)">${esc(b.service_name||'RDV libre')} · ${b.duration_min||'—'}min${!isPrac&&b.practitioner_name?' · '+esc(b.practitioner_name):''}</div>
          </div>
          <span class="bk-status ${b.status}">${b.status==='confirmed'?'Confirmé':b.status==='pending'?'En attente':b.status}</span>
        </div>`;
      });}
      else h+=`<div class="empty">Aucun RDV aujourd'hui</div>`;
      h+=`</div>`;

      // ── Tâches à faire ──
      h+=`<div class="card"><div class="card-h"><h3>Tâches à faire</h3><span class="badge badge-teal">${todos.length}</span></div>`;
      if(todos.length>0){
        todos.forEach(t=>{
          const ctx=t.client_name?`${esc(t.client_name)}${t.service_name?' · '+esc(t.service_name):''}`:t.service_name?esc(t.service_name):'';
          const dt=t.booking_start?new Date(t.booking_start).toLocaleDateString('fr-BE',{day:'numeric',month:'short'}):'';
          h+=`<div class="dash-todo-row">
            <input type="checkbox" class="todo-check" onchange="dashToggleTodo('${t.id}','${t.booking_id||''}',this.checked)">
            <div style="flex:1;min-width:0">
              <div class="dash-todo-text">${esc(t.content)}</div>
              ${ctx?`<div class="dash-todo-ctx">${ctx}${dt?' · '+dt:''}</div>`:''}
            </div>
            ${t.booking_id?`<button class="dash-todo-open" onclick="openBookingDetail('${t.booking_id}')" title="Ouvrir le RDV"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></button>`:''}
          </div>`;
        });
      }else{
        h+=`<div class="empty">Aucune tâche en cours</div>`;
      }
      h+=`</div>`;

    }else{
      h+=`<div class="stats"><div class="stat-card"><div class="label">RDV</div><div class="val">0</div></div><div class="stat-card"><div class="label">Prochain RDV</div><div class="val" style="font-size:.9rem;color:var(--text-4)">—</div></div><div class="stat-card"><div class="label">Tâches</div><div class="val">0</div></div>${isPrac?'':`<div class="stat-card"><div class="label">Appels</div><div class="val">—</div></div>`}</div><div class="card"><div class="card-h"><h3>RDV du jour</h3></div><div class="empty">Aucun RDV</div></div>`;
    }
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}<br><button onclick="loadDashboard()" style="margin-top:8px;padding:6px 14px;border-radius:6px;border:1px solid var(--border);background:var(--white);cursor:pointer">Réessayer</button></div>`;}
}

// Toggle a todo from dashboard
async function dashToggleTodo(todoId, bookingId, isDone){
  if(!bookingId) return;
  try{
    await fetch(`/api/bookings/${bookingId}/todos/${todoId}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({is_done:isDone})
    });
    // Fade out the row
    const row=document.querySelector(`.dash-todo-row input[onchange*="${todoId}"]`)?.closest('.dash-todo-row');
    if(row&&isDone){row.style.opacity='.3';row.style.textDecoration='line-through';setTimeout(()=>row.remove(),800);}
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// Open booking detail modal from anywhere (dashboard, clients, etc.)
async function openBookingDetail(bookingId){
  try{
    if(!calState.fcPractitioners||calState.fcPractitioners.length===0){
      const r=await fetch('/api/practitioners',{headers:{'Authorization':'Bearer '+api.getToken()}});
      if(r.ok){const d=await r.json();calState.fcPractitioners=d.practitioners||[];}
    }
    await window.fcOpenDetail(bookingId);
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

bridge({ loadDashboard, openBookingDetail, dashToggleTodo });

export { loadDashboard, openBookingDetail };
