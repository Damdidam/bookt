/**
 * Hours / Disponibilités view module.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

const DAYS_WEEK=['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'];
let scheduleData={};

async function loadHours(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const[ar,pr,er]=await Promise.all([
      fetch('/api/availabilities',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/dashboard',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/availabilities/exceptions',{headers:{'Authorization':'Bearer '+api.getToken()}})
    ]);
    const ad=await ar.json(),pd=await pr.json(),ed=await er.json();
    const avails=ad.availabilities||{};
    const practs=pd.practitioners||[];
    const excepts=ed.exceptions||[];
    scheduleData={};
    practs.forEach(p=>{
      const pa=avails[p.id];
      scheduleData[p.id]={name:p.display_name,color:p.color,schedule:{}};
      for(let d=0;d<7;d++){scheduleData[p.id].schedule[d]=pa?.schedule?.[d]||[];}
    });

    let h=`<p style="font-size:.85rem;color:var(--text-3);margin-bottom:16px">Gérez les créneaux de disponibilité par praticien. Les modifications s'appliquent aux prochaines réservations.</p>`;
    practs.forEach(p=>{
      const sc=scheduleData[p.id].schedule;
      h+=`<div class="card pract-block" style="margin-bottom:16px"><div class="card-h"><h3 style="display:flex;align-items:center;gap:8px"><span style="width:24px;height:24px;border-radius:6px;background:${p.color||'var(--primary)'};display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:.6rem;font-family:var(--serif)">${p.display_name?.charAt(0)||'?'}</span>${p.display_name}</h3><button class="btn-primary btn-sm" onclick="saveSchedule('${p.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Enregistrer</button></div><div style="padding:14px 18px">`;
      for(let d=0;d<7;d++){
        const slots=sc[d]||[];
        h+=`<div class="day-row"><span class="day-name">${DAYS_WEEK[d]}</span><div class="slots">`;
        if(slots.length===0){h+=`<span class="day-closed">Fermé</span>`;}
        else{slots.forEach((s,i)=>{h+=`<span class="slot-chip">${s.start_time?.slice(0,5)} – ${s.end_time?.slice(0,5)}<button class="remove-slot" onclick="removeSlot('${p.id}',${d},${i})"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></span>`;});}
        h+=`<button class="add-slot-btn" onclick="addSlot('${p.id}',${d})">+ Ajouter</button></div></div>`;
      }
      h+=`</div></div>`;
    });

    h+=`<div class="card"><div class="card-h"><h3>Exceptions & congés</h3><button class="btn-primary btn-sm" onclick="openExceptionModal()">+ Ajouter</button></div>`;
    if(excepts.length===0){h+=`<div class="empty">Aucune exception planifiée</div>`;}
    else{h+=`<div style="padding:10px 18px">`;excepts.forEach(ex=>{
      const dt=new Date(ex.date).toLocaleDateString('fr-BE',{weekday:'short',day:'numeric',month:'short'});
      h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--border-light)"><div><span style="font-size:.85rem;font-weight:600">${dt}</span><span style="font-size:.78rem;color:var(--text-4);margin-left:8px">${ex.practitioner_name} — ${ex.type==='closed'?'Fermé':ex.start_time?.slice(0,5)+' – '+ex.end_time?.slice(0,5)}</span>${ex.note?`<span style="font-size:.72rem;color:var(--text-4);margin-left:8px">(${ex.note})</span>`:''}</div><button class="btn-outline btn-sm btn-danger" onclick="if(confirm('Supprimer ?'))deleteException('${ex.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`;
    });h+=`</div>`;}
    h+=`</div>`;
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

function addSlot(pid,day){
  const last=scheduleData[pid].schedule[day].slice(-1)[0];
  const ds=last?last.end_time:'09:00:00';
  const hr=parseInt(ds.split(':')[0]);
  const de=`${String(Math.min(hr+4,20)).padStart(2,'0')}:00`;
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:340px"><div class="modal-h"><h3>Créneau — ${DAYS_WEEK[day]}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">
    <div class="field-row"><div class="field"><label>Début</label><input type="time" id="slot_start" value="${ds.slice(0,5)}"></div><div class="field"><label>Fin</label><input type="time" id="slot_end" value="${de}"></div></div>
  </div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="confirmAddSlot('${pid}',${day})">Ajouter</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
}

function confirmAddSlot(pid,day){
  const st=document.getElementById('slot_start').value+':00',en=document.getElementById('slot_end').value+':00';
  if(!scheduleData[pid].schedule[day])scheduleData[pid].schedule[day]=[];
  scheduleData[pid].schedule[day].push({start_time:st,end_time:en});
  scheduleData[pid].schedule[day].sort((a,b)=>a.start_time.localeCompare(b.start_time));
  document.querySelector('.modal-overlay')?.remove();loadHours();
}

function removeSlot(pid,day,idx){scheduleData[pid].schedule[day].splice(idx,1);loadHours();}

async function saveSchedule(pid){
  const schedule={};
  for(let d=0;d<7;d++){const sl=scheduleData[pid].schedule[d]||[];if(sl.length>0)schedule[d]=sl.map(s=>({start_time:s.start_time?.slice(0,5),end_time:s.end_time?.slice(0,5)}));}
  try{const r=await fetch('/api/availabilities',{method:'PUT',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({practitioner_id:pid,schedule})});
    if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast('Horaires enregistrés','success');loadHours();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function openExceptionModal(){
  const pids=Object.entries(scheduleData).map(([id,d])=>`<option value="${id}">${d.name}</option>`).join('');
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:400px"><div class="modal-h"><h3>Nouvelle exception</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">
    <div class="field"><label>Praticien</label><select id="exc_pract">${pids}</select></div>
    <div class="field"><label>Date</label><input type="date" id="exc_date" value="${new Date().toISOString().split('T')[0]}"></div>
    <div class="field"><label>Type</label><select id="exc_type" onchange="document.getElementById('exc_times').style.display=this.value==='custom'?'flex':'none'"><option value="closed">Fermé toute la journée</option><option value="custom">Horaires modifiés</option></select></div>
    <div class="field-row" id="exc_times" style="display:none"><div class="field"><label>Début</label><input type="time" id="exc_start" value="09:00"></div><div class="field"><label>Fin</label><input type="time" id="exc_end" value="17:00"></div></div>
    <div class="field"><label>Note</label><input id="exc_note" placeholder="Ex: Congé, formation..."></div>
  </div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="saveException()">Enregistrer</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
}

async function saveException(){
  const type=document.getElementById('exc_type').value;
  const body={practitioner_id:document.getElementById('exc_pract').value,date:document.getElementById('exc_date').value,type,note:document.getElementById('exc_note').value||null};
  if(type==='custom'){body.start_time=document.getElementById('exc_start').value;body.end_time=document.getElementById('exc_end').value;}
  try{const r=await fetch('/api/availabilities/exceptions',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);document.querySelector('.modal-overlay')?.remove();GendaUI.toast('Exception ajoutée','success');loadHours();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deleteException(id){
  try{await fetch(`/api/availabilities/exceptions/${id}`,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});GendaUI.toast('Exception supprimée','success');loadHours();}catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

bridge({ loadHours, addSlot, confirmAddSlot, removeSlot, saveSchedule, openExceptionModal, saveException, deleteException });

export { loadHours, addSlot, confirmAddSlot, removeSlot, saveSchedule, openExceptionModal, saveException, deleteException };
