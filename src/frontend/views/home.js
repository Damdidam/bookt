/**
 * Home / Dashboard view module.
 */
import { api, biz, userRole, calState, GendaUI, categoryLabels } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';

function _timeAgo(dateStr){
  const diff=Date.now()-new Date(dateStr).getTime();
  const mins=Math.floor(diff/60000);
  if(mins<1) return 'à l\'instant';
  if(mins<60) return `il y a ${mins}min`;
  const hrs=Math.floor(mins/60);
  if(hrs<24) return `il y a ${hrs}h`;
  const days=Math.floor(hrs/24);
  return `il y a ${days}j`;
}

async function loadDashboard(){
  const c=document.getElementById('contentArea');
  const isPrac=userRole==='practitioner';
  try{
    const plan=biz?.plan||'free';
    window._businessPlan=plan;
    const fetchList=[api.getDashboard(),api.get('/api/dashboard/summary'),api.get('/api/dashboard/announcements')];
    if(plan!=='free')fetchList.push(api.get('/api/calls/usage'));
    const[dd,sd,ad,ud]=await Promise.allSettled(fetchList);
    const dash=dd.status==='fulfilled'?dd.value:{},sum=sd.status==='fulfilled'?sd.value:null,announcements=(ad.status==='fulfilled'?ad.value?.announcements:null)||[],usage=ud?.status==='fulfilled'?ud.value:null;
    const slug=dash.business?.slug||biz?.slug||'';
    let h='';

    // ── System announcements ──
    if(announcements.length>0){
      const typeStyles={
        maintenance:{bg:'var(--amber-bg)',border:'var(--gold)',icon:IC.alertTriangle,color:'var(--amber-dark)'},
        warning:{bg:'var(--red-bg)',border:'var(--red)',icon:IC.alertTriangle,color:'var(--red)'},
        update:{bg:'var(--blue-bg)',border:'var(--blue)',icon:IC.info,color:'var(--blue)'},
        info:{bg:'var(--primary-light)',border:'var(--primary-soft)',icon:IC.info,color:'var(--primary)'}
      };
      announcements.forEach(a=>{
        const s=typeStyles[a.type]||typeStyles.info;
        const dateStr=a.ends_at?`Jusqu'au ${new Date(a.ends_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'})}`:'';
        h+=`<div style="background:${s.bg};border:1px solid ${s.border};border-radius:var(--radius-sm);padding:14px 18px;margin-bottom:12px;display:flex;align-items:flex-start;gap:10px">`;
        h+=`<span style="color:${s.color};flex-shrink:0;margin-top:1px">${s.icon}</span>`;
        h+=`<div style="flex:1;min-width:0">`;
        h+=`<div style="font-size:.85rem;font-weight:700;color:${s.color}">${esc(a.title)}</div>`;
        if(a.body)h+=`<div style="font-size:.78rem;color:var(--text-2);margin-top:2px">${esc(a.body)}</div>`;
        if(dateStr)h+=`<div style="font-size:.68rem;color:var(--text-4);margin-top:4px">${dateStr}</div>`;
        h+=`</div></div>`;
      });
    }

    // Weekly booking bandeau for free tier
    if(plan==='free'&&sum){
      const weekCount=sum?.weekly_booking_count||0;
      if(weekCount>=20){
        h+=`<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px;font-size:.85rem;color:#92400E">
          <strong>${weekCount}/25</strong> RDV cette semaine
          <a href="#settings" style="margin-left:auto;color:#92400E;font-weight:600;text-decoration:underline">Passer au Pro \u2192</a>
        </div>`;
      }
    }

    if(!isPrac){
      h+=`<div class="qlink"><div class="info"><h4>Votre page publique</h4><p>${slug}</p></div><div><a href="/${slug}?preview" target="_blank">Voir ma page</a></div></div>`;
    }
    if(sum){
      const ca=sum.calls||{};
      const nb=sum.next_booking;
      const todos=sum.pending_todos||[];

      // ── KPI tiles ──
      const nbTime=nb?new Date(nb.start_at).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'}):'';
      const nbDate=nb?new Date(nb.start_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',timeZone:'Europe/Brussels'}):'';
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

      // ── Heures par praticien ──
      const pracHrs=sum.prac_hours||[];
      if(pracHrs.length>0){
        const totalMins=pracHrs.reduce((s,p)=>s+p.minutes,0);
        const totalH=Math.floor(totalMins/60),totalM=Math.round(totalMins%60);
        const totalFmt=totalM>0?`${totalH}h${String(totalM).padStart(2,'0')}`:`${totalH}h`;
        h+=`<div class="card"><div class="card-h"><h3>Heures du jour</h3><span class="badge badge-teal">${totalFmt}</span></div>`;
        pracHrs.forEach(p=>{
          h+=`<div class="dph-row"><span class="dot" style="color:${p.color||'var(--primary)'}">●</span><span class="dph-name">${esc(p.name)}</span><span class="dph-val">${p.formatted}</span></div>`;
        });
        h+=`</div>`;
      }

      // ── RDV du jour ──
      h+=`<div class="card"><div class="card-h"><h3>${isPrac?'Mes RDV du jour':'RDV du jour'}</h3><span class="badge badge-teal">${sum.today?.count||0}</span></div>`;
      if(sum.today?.bookings?.length>0){sum.today.bookings.forEach(b=>{
        const t=new Date(b.start_at).toLocaleTimeString('fr-BE',{hour:'2-digit',minute:'2-digit'});
        let badges='';
        if(b.todo_count>0)badges+=`<span class="bk-badge todo">${IC.clipboard} ${b.todo_count}</span>`;
        if(b.note_count>0||b.has_internal_note)badges+=`<span class="bk-badge note">${IC.fileText}</span>`;
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

      // ── Activité récente (3 jours) ──
      const activity=sum.recent_activity||[];
      if(activity.length>0){
        h+=`<div class="card"><div class="card-h"><h3>Activité récente</h3><span class="badge badge-teal">${activity.length}</span></div>`;
        activity.forEach(a=>{
          const chLabel=a.channel==='web'?'Web':a.channel==='phone'?'Tél':'Staff';
          const chCls=a.channel==='web'?'web':a.channel==='phone'?'phone':'manual';
          const ago=_timeAgo(a.created_at);
          const ini=a.practitioner_name?a.practitioner_name.split(/\s+/).map(w=>w[0]).join('').slice(0,2).toUpperCase():'';
          h+=`<div class="da-row" onclick="openBookingDetail('${a.id}')">`;
          h+=`<span class="da-channel ${chCls}">${chLabel}</span>`;
          h+=`<span class="da-client">${esc(a.client_name||'—')}</span>`;
          h+=`<span class="da-service">${esc(a.service_name||'RDV libre')}</span>`;
          if(!isPrac) h+=`<span class="da-prac">${ini}</span>`;
          h+=`<span class="da-date">${ago}</span>`;
          h+=`</div>`;
        });
        h+=`</div>`;
      }

      // ── Alertes & attention ──
      const al=sum.alerts||{};
      const hasAlerts=(al.pending_confirmations||0)+(al.unpaid_deposits||0)+(al.recent_no_shows||0)+(al.upcoming_absences?.length||0)>0;
      if(hasAlerts){
        h+=`<div class="card"><div class="card-h"><h3>Alertes</h3></div>`;
        if(al.pending_confirmations>0) h+=`<div class="da-alert warn">${IC.hourglass} ${al.pending_confirmations} RDV en attente de confirmation (7 prochains jours)</div>`;
        if(al.unpaid_deposits>0) h+=`<div class="da-alert warn">${IC.creditCard} ${al.unpaid_deposits} acompte${al.unpaid_deposits>1?'s':''} en attente de paiement</div>`;
        if(al.recent_no_shows>0) h+=`<div class="da-alert error">${IC.ban} ${al.recent_no_shows} no-show${al.recent_no_shows>1?'s':''} ces 7 derniers jours</div>`;
        if(al.upcoming_absences?.length>0){
          al.upcoming_absences.forEach(a=>{
            const typeLabel=a.type==='maladie'?'maladie':a.type==='conge'?'congé':a.type==='formation'?'formation':'absence';
            const from=new Date(a.date_from).toLocaleDateString('fr-BE',{day:'numeric',month:'short',timeZone:'Europe/Brussels'});
            const to=new Date(a.date_to).toLocaleDateString('fr-BE',{day:'numeric',month:'short',timeZone:'Europe/Brussels'});
            const range=a.date_from===a.date_to?from:`${from} → ${to}`;
            h+=`<div class="da-alert info">${IC.palmTree} ${esc(a.practitioner_name)} — ${typeLabel} ${range}</div>`;
          });
        }
        h+=`</div>`;
      }

      // ── SMS / Appels usage widget (Pro/Premium only) ──
      if(usage&&!isPrac){
        const pct=usage.percent||0;
        const total=usage.total||0;
        const quota=usage.billing?.included_units||0;
        const sms=usage.sms||0;
        const calls=usage.calls||0;
        const overage=usage.billing?.overage||0;
        const overageCents=usage.billing?.overage_total_cents||0;
        const barColor=pct>=100?'var(--red)':pct>=80?'var(--amber)':'var(--green)';
        h+=`<div class="card" style="cursor:pointer" onclick="document.querySelector('[data-section=calls]').click()"><div class="card-h"><h3>${IC.phone} Consommation</h3><span class="badge badge-teal">${total}/${quota}</span></div>`;
        h+=`<div style="padding:14px 20px">`;
        h+=`<div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--text-3);margin-bottom:6px"><span>${calls} appel${calls>1?'s':''} · ${sms} SMS</span><span style="font-weight:700;color:${barColor}">${pct}%</span></div>`;
        h+=`<div style="height:6px;background:var(--surface);border-radius:var(--radius-pill);overflow:hidden"><div style="height:100%;width:${Math.min(pct,100)}%;background:${barColor};border-radius:var(--radius-pill);transition:width .3s"></div></div>`;
        if(overage>0)h+=`<div style="font-size:.68rem;color:var(--red);margin-top:6px">${IC.alertTriangle} ${overage} unité${overage>1?'s':''} en dépassement (${(overageCents/100).toFixed(2)}€)</div>`;
        h+=`</div></div>`;
      }

      // ── Tâches à faire ──
      h+=`<div class="card"><div class="card-h"><h3>Tâches à faire</h3><span class="badge badge-teal">${todos.length}</span></div>`;
      if(todos.length>0){
        todos.forEach(t=>{
          const ctx=t.client_name?`${esc(t.client_name)}${t.service_name?' · '+esc(t.service_name):''}`:t.service_name?esc(t.service_name):'';
          const dt=t.booking_start?new Date(t.booking_start).toLocaleDateString('fr-BE',{day:'numeric',month:'short',timeZone:'Europe/Brussels'}):'';
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
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}<br><button class="btn-outline btn-sm" onclick="loadDashboard()" style="margin-top:8px">Réessayer</button></div>`;}
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
    // Dynamic import — agenda module may not be loaded yet
    const { fcOpenDetail }=await import('./agenda/booking-detail.js');
    await fcOpenDetail(bookingId);
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

bridge({ loadDashboard, openBookingDetail, dashToggleTodo });

export { loadDashboard, openBookingDetail };
