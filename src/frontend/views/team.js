/**
 * Team (Équipe) view module.
 */
import { api, SECTOR_LABELS, userSector, sectorLabels, categoryLabels, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { cswHTML } from './agenda/color-swatches.js';

let pPendingPhoto=null;

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function escH(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function loadTeam(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const [r,calR]=await Promise.all([
      fetch('/api/practitioners',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/calendar/connections',{headers:{'Authorization':'Bearer '+api.getToken()}}).catch(()=>({ok:false}))
    ]);
    const d=await r.json();
    const calData=calR.ok?await calR.json():{connections:[]};
    const calConns=calData.connections||[];
    const practs=d.practitioners||[];
    const pracLabel=sectorLabels.practitioner.toLowerCase();
    let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:.95rem;font-weight:700">${practs.length} membre${practs.length>1?'s':''} de l'équipe</h3><button class="btn-primary" onclick="openPractModal()">+ Ajouter</button></div>`;

    if(practs.length===0){h+=`<div class="card"><div class="empty">Aucun ${pracLabel}. Ajoutez votre premier membre !</div></div>`;}
    else{
      h+=`<div class="team-grid2">`;
      practs.forEach(p=>{
        const initials=p.display_name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'??';
        const hasLogin=!!p.user_email;
        const avatarContent=p.photo_url
          ?`<img src="${p.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
          :initials;
        h+=`<div class="team-member${p.is_active?'':' inactive'}">
          <div class="tm-header">
            <div class="tm-avatar" style="background:${p.color||'var(--primary)'}">${avatarContent}</div>
            <div class="tm-info">
              <h4>${p.display_name}</h4>
              <div class="tm-title">${p.title||'—'}${p.years_experience?' · '+p.years_experience+' ans':''}</div>
              ${p.user_email?`<div class="tm-email"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> ${p.user_email}</div>`:`<div class="tm-email" style="color:var(--text-4)">Pas de compte</div>`}
            </div>
          </div>
          <div class="tm-stats">
            <div class="tm-stat"><div class="v">${p.bookings_30d||0}</div><div class="l">RDV / 30j</div></div>
            <div class="tm-stat"><div class="v">${p.service_count||0}</div><div class="l">${categoryLabels.services}</div></div>
            <div class="tm-stat"><div class="v">${p.last_login_at?new Date(p.last_login_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short'}):'—'}</div><div class="l">Dern. connexion</div></div>
          </div>
          <div class="tm-badges">
            <span class="tm-badge ${p.is_active?'active':'inactive'}">${p.is_active?'Actif':'Inactif'}</span>
            <span class="tm-badge ${p.booking_enabled?'booking':'no-booking'}">${p.booking_enabled?'Réservable':'Non réservable'}</span>
            ${p.waitlist_mode&&p.waitlist_mode!=='off'?`<span class="tm-badge" style="background:${p.waitlist_mode==='auto'?'#DCFCE7;color:#15803D':'#FEF3C7;color:#92400E'}">${p.waitlist_mode==='auto'?'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg> Waitlist auto':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg> Waitlist manuelle'}</span>`:''}
            ${p.vacation_until&&new Date(p.vacation_until)>=new Date(new Date().toDateString())?`<span class="tm-badge" style="background:#FEF3C7;color:#92400E"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> Vacances → ${new Date(p.vacation_until).toLocaleDateString('fr-BE',{day:'numeric',month:'short'})}</span>`:''}
            ${(()=>{const pc=calConns.filter(c=>c.practitioner_id===p.id);if(pc.length===0)return'';const providers=pc.map(c=>c.provider==='google'?'Google':c.provider==='outlook'?'Outlook':'iCal').join(', ');return`<span class="tm-badge" style="background:#EFF9F8;color:#0D7377"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${providers}</span>`;})()}
            ${hasLogin?`<span class="tm-badge has-login">${sectorLabels[p.user_role]||p.user_role||'Compte lié'}</span>`:''}
          </div>
          <div class="tm-actions">
            <button class="btn-outline btn-sm" onclick="openPracTasks('${p.id}','${esc(p.display_name)}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Tâches</button>
            <button class="btn-outline btn-sm" onclick="openPractModal('${p.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modifier</button>
            ${hasLogin?`<button class="btn-outline btn-sm" onclick="openRoleModal('${p.id}','${esc(p.display_name)}','${p.user_role||'practitioner'}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10s3-3 10-3 10 3 10 3"/><path d="M2 14s3 3 10 3 10-3 10-3"/><circle cx="8" cy="12" r="1" fill="currentColor"/><circle cx="16" cy="12" r="1" fill="currentColor"/></svg> Rôle</button>`:''}
            ${!hasLogin?`<button class="btn-outline btn-sm" onclick="openInviteModal('${p.id}','${esc(p.display_name)}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Créer un accès</button>`:''}
            ${p.is_active?`<button class="btn-outline btn-sm btn-danger" onclick="if(confirm('Désactiver ${esc(p.display_name)} ?'))deactivatePract('${p.id}')">Désactiver</button>`:`<button class="btn-outline btn-sm" onclick="reactivatePract('${p.id}')">Réactiver</button>`}
          </div>
        </div>`;
      });
      h+=`</div>`;
    }
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

function openPractModal(editId){
  if(editId){
    fetch('/api/practitioners',{headers:{'Authorization':'Bearer '+api.getToken()}}).then(r=>r.json()).then(d=>{
      renderPractModal(d.practitioners.find(p=>p.id===editId));
    });
  }else{renderPractModal(null);}
}

function renderPractModal(p){
  pPendingPhoto=null;
  const isEdit=!!p;
  const photoSrc=p?.photo_url||'';
  const initials=p?.display_name?p.display_name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase():'';
  const pracLbl=sectorLabels.practitioner.toLowerCase();
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier':'Nouveau '+pracLbl}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">
    <div style="text-align:center;margin-bottom:16px">
      <div id="p_photo_preview" style="width:80px;height:80px;border-radius:50%;margin:0 auto 10px;overflow:hidden;background:${p?.color||'var(--primary)'};display:flex;align-items:center;justify-content:center;cursor:pointer;position:relative" onclick="document.getElementById('p_photo_input').click()" title="Cliquer pour changer la photo">
        ${photoSrc?`<img src="${photoSrc}" style="width:100%;height:100%;object-fit:cover">`:`<span style="color:#fff;font-size:1.5rem;font-weight:600">${initials||'+'}</span>`}
      </div>
      <input type="file" id="p_photo_input" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="pPhotoPreview(this)">
      <div style="font-size:.7rem;color:var(--text-4)">Cliquer pour ${photoSrc?'changer':'ajouter'} la photo</div>
      ${photoSrc?`<button onclick="pRemovePhoto('${p.id}')" style="font-size:.7rem;color:var(--red);background:none;border:none;cursor:pointer;margin-top:4px">Supprimer la photo</button>`:''}
    </div>
    <div class="field"><label>Nom complet *</label><input id="p_name" value="${p?.display_name||''}" placeholder="Ex: Dr. Sophie Laurent"></div>
    <div class="field"><label>Titre / Spécialité</label><input id="p_title" value="${p?.title||''}" placeholder="Ex: Kinésithérapeute sportif"></div>
    <div class="field-row"><div class="field"><label>Années d'expérience</label><input type="number" id="p_years" value="${p?.years_experience||''}" min="0"></div><div class="field"><label>Couleur agenda</label><div id="p_color_wrap"></div></div></div>
    <div class="field"><label>Incrément agenda</label><select id="p_slot_inc" style="width:100%;padding:8px 12px;border:1.5px solid var(--border-light);border-radius:8px;font-size:.85rem">
      ${[5,10,15,20,30,45,60].map(v=>`<option value="${v}"${(p?.slot_increment_min||15)===v?' selected':''}>${v} min</option>`).join('')}
    </select><span style="font-size:.7rem;color:var(--text-4)">Granularité de la grille horaire pour ce praticien</span></div>
    <div class="field-row"><div class="field"><label>Email</label><input id="p_email" type="email" value="${p?.email||''}"></div><div class="field"><label>Téléphone</label><input id="p_phone" value="${p?.phone||''}"></div></div>
    <div class="field"><label>Bio</label><textarea id="p_bio">${p?.bio||''}</textarea></div>
    <div class="field"><label>LinkedIn</label><input id="p_linkedin" value="${p?.linkedin_url||''}" placeholder="https://linkedin.com/in/..."></div>
    <div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="p_booking" ${p?.booking_enabled!==false?'checked':''}> Peut recevoir des réservations en ligne</label></div>
    <div class="field"><label><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg> En vacances jusqu'au</label><input type="date" id="p_vacation" value="${p?.vacation_until||''}" style="width:100%;padding:8px 12px;border:1.5px solid var(--border-light);border-radius:8px;font-size:.85rem"><span style="font-size:.7rem;color:var(--text-4)">Si renseigné, ce praticien ne sera plus réservable en ligne. Si tous les praticiens sont en vacances, le filtre d'appels passe automatiquement en mode vacances.</span></div>
    <div class="field"><label>Liste d'attente</label><select id="p_waitlist" style="width:100%;padding:8px 12px;border:1.5px solid var(--border-light);border-radius:8px;font-size:.85rem">
      <option value="off"${(p?.waitlist_mode||'off')==='off'?' selected':''}><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#EF4444"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg> Désactivée</option>
      <option value="manual"${p?.waitlist_mode==='manual'?' selected':''}><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#EAB308"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg> Manuelle — je contacte le client moi-même</option>
      <option value="auto"${p?.waitlist_mode==='auto'?' selected':''}><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:#22C55E"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg> Automatique — offre envoyée au 1er en file</option>
    </select><span style="font-size:.7rem;color:var(--text-4)">Quand un RDV est annulé, propose le créneau aux personnes en liste d'attente</span></div>
    ${isEdit?`<div style="margin-top:16px;padding:16px;border:1.5px solid var(--border-light);border-radius:var(--radius-sm);background:var(--surface)">
      <div style="font-size:.85rem;font-weight:700;margin-bottom:10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Synchronisation calendrier</div>
      <div id="p_cal_area" style="font-size:.82rem;color:var(--text-4)">Chargement...</div>
    </div>`:''}
  </div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="savePract(${isEdit?"'"+p.id+"'":'null'})">${isEdit?'Enregistrer':'Créer'}</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
  document.getElementById('p_color_wrap').innerHTML=cswHTML('p_color',p?.color||'#0D7377',false);
  if(isEdit) window.loadPracCalSync(p.id);
}

function pPhotoPreview(input){
  const file=input.files[0];
  if(!file)return;
  if(file.size>2*1024*1024){GendaUI.toast('Photo trop lourde (max 2 Mo)','error');return;}
  const reader=new FileReader();
  reader.onload=function(e){
    pPendingPhoto=e.target.result;
    document.getElementById('p_photo_preview').innerHTML=`<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

async function pRemovePhoto(id){
  if(!confirm('Supprimer la photo ?'))return;
  try{
    await fetch(`/api/practitioners/${id}/photo`,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    GendaUI.toast('Photo supprimée','success');
    document.querySelector('.modal-overlay')?.remove();
    loadTeam();
  }catch(e){GendaUI.toast('Erreur','error');}
}

async function savePract(id){
  const body={display_name:document.getElementById('p_name').value,title:document.getElementById('p_title').value||null,years_experience:parseInt(document.getElementById('p_years').value)||null,color:document.getElementById('p_color').value,email:document.getElementById('p_email').value||null,phone:document.getElementById('p_phone').value||null,bio:document.getElementById('p_bio').value||null,linkedin_url:document.getElementById('p_linkedin').value||null,booking_enabled:document.getElementById('p_booking').checked,slot_increment_min:parseInt(document.getElementById('p_slot_inc').value)||15,waitlist_mode:document.getElementById('p_waitlist').value,vacation_until:document.getElementById('p_vacation').value||null};
  try{
    const url=id?`/api/practitioners/${id}`:'/api/practitioners';
    const method=id?'PATCH':'POST';
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);
    const data=await r.json();
    const pracId=id||data.practitioner?.id;

    // Upload photo if one was selected
    if(pPendingPhoto&&pracId){
      await fetch(`/api/practitioners/${pracId}/photo`,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
        body:JSON.stringify({photo:pPendingPhoto})
      });
      pPendingPhoto=null;
    }

    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast(id?sectorLabels.practitioner+' modifié':sectorLabels.practitioner+' ajouté','success');loadTeam();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deactivatePract(id){
  try{const r=await fetch(`/api/practitioners/${id}`,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast(sectorLabels.practitioner+' désactivé','success');loadTeam();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function openPracTasks(pracId,pracName){
  try{
    const r=await fetch(`/api/practitioners/${pracId}/tasks`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error('Erreur');
    const data=await r.json();
    const todos=data.todos||[], reminders=data.reminders||[];
    const pendingTodos=todos.filter(t=>!t.is_done), doneTodos=todos.filter(t=>t.is_done);
    const pendingReminders=reminders.filter(r=>!r.is_sent), sentReminders=reminders.filter(r=>r.is_sent);

    let h=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:560px"><div class="modal-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> ${pracName}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body" style="max-height:70vh;overflow-y:auto">`;

    // Todos
    h+=`<div style="font-size:.82rem;font-weight:700;margin-bottom:8px">Tâches en cours (${pendingTodos.length})</div>`;
    if(pendingTodos.length===0){h+=`<div style="font-size:.8rem;color:var(--text-4);margin-bottom:16px">Aucune tâche en cours</div>`;}
    else{pendingTodos.forEach(t=>{
      const dt=t.booking_start?new Date(t.booking_start).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
      h+=`<div style="padding:8px 0;border-bottom:1px solid var(--border-light);display:flex;gap:10px;align-items:flex-start">
        <input type="checkbox" onchange="togglePracTodo('${t.id}','${t.booking_id}',this.checked,'${pracId}','${esc(pracName)}')" style="margin-top:3px">
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem">${escH(t.content)}</div>
          <div style="font-size:.7rem;color:var(--text-4)">${t.client_name||''} ${t.service_name?'· '+t.service_name:''} ${dt?'· '+dt:''}</div>
        </div>
      </div>`;
    });}

    if(doneTodos.length>0){
      h+=`<div style="font-size:.82rem;font-weight:700;margin:16px 0 8px;color:var(--text-4)">Terminées (${doneTodos.length})</div>`;
      doneTodos.slice(0,10).forEach(t=>{
        h+=`<div style="padding:6px 0;border-bottom:1px solid var(--border-light);opacity:.5">
          <div style="font-size:.8rem;text-decoration:line-through">${escH(t.content)}</div>
          <div style="font-size:.68rem;color:var(--text-4)">${t.client_name||''} · ${t.done_at?new Date(t.done_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short'}):''}</div>
        </div>`;
      });
      if(doneTodos.length>10)h+=`<div style="font-size:.72rem;color:var(--text-4);padding:4px 0">+ ${doneTodos.length-10} autres</div>`;
    }

    // Reminders
    h+=`<div style="font-size:.82rem;font-weight:700;margin:20px 0 8px">Rappels à venir (${pendingReminders.length})</div>`;
    if(pendingReminders.length===0){h+=`<div style="font-size:.8rem;color:var(--text-4)">Aucun rappel en attente</div>`;}
    else{pendingReminders.forEach(r=>{
      const dt=new Date(r.remind_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      const ch=r.channel==='email'?'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>':r.channel==='both'?'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>+<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>';
      h+=`<div style="padding:8px 0;border-bottom:1px solid var(--border-light)">
        <div style="font-size:.82rem">${ch} ${dt}</div>
        <div style="font-size:.7rem;color:var(--text-4)">${r.client_name||''} ${r.service_name?'· '+r.service_name:''} ${r.message?'· '+escH(r.message):''}</div>
      </div>`;
    });}

    if(sentReminders.length>0){
      h+=`<div style="font-size:.72rem;color:var(--text-4);margin-top:8px">${sentReminders.length} rappel${sentReminders.length>1?'s':''} déjà envoyé${sentReminders.length>1?'s':''}</div>`;
    }

    h+=`</div></div></div>`;
    document.body.insertAdjacentHTML('beforeend',h);
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function togglePracTodo(todoId,bookingId,done,pracId,pracName){
  try{
    await fetch(`/api/bookings/${bookingId}/todos/${todoId}`,{
      method:'PATCH',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({is_done:done})
    });
    // Refresh the modal
    document.querySelector('.modal-overlay')?.remove();
    openPracTasks(pracId,pracName);
  }catch(e){GendaUI.toast('Erreur','error');}
}

async function reactivatePract(id){
  try{const r=await fetch(`/api/practitioners/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({is_active:true,booking_enabled:true})});
    if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast(sectorLabels.practitioner+' réactivé','success');loadTeam();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function openInviteModal(practId,name){
  const sl=SECTOR_LABELS[userSector]||SECTOR_LABELS.autre;
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:440px"><div class="modal-h"><h3>Créer un accès — ${name}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">
    <p style="font-size:.85rem;color:var(--text-3);margin-bottom:14px">Créez un compte pour que <strong>${name}</strong> puisse se connecter au dashboard.</p>
    <div class="field"><label>Email *</label><input id="inv_email" type="email" placeholder="email@exemple.com"></div>
    <div class="field"><label>Mot de passe temporaire *</label><input id="inv_pwd" type="text" value="${generateTempPwd()}" style="font-family:monospace"><div class="hint">Communiquez ce mot de passe. Il pourra être changé plus tard.</div></div>
    <div class="field"><label>Rôle *</label><select id="inv_role" style="width:100%;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem">
      <option value="practitioner">${sl.practitioner} — Voit uniquement son propre agenda et ses clients</option>
      <option value="receptionist">${sl.receptionist} — Voit l'agenda de tous, gère les RDV et clients</option>
      <option value="manager">${sl.manager} — Agenda de tous, clients, documents, statistiques</option>
    </select></div>
  </div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="sendInvite('${practId}')">Créer le compte</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
}

function generateTempPwd(){const chars='ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';let pwd='';for(let i=0;i<10;i++)pwd+=chars[Math.floor(Math.random()*chars.length)];return pwd;}

async function sendInvite(practId){
  const email=document.getElementById('inv_email').value;
  const password=document.getElementById('inv_pwd').value;
  const role=document.getElementById('inv_role').value;
  if(!email||!password)return GendaUI.toast('Email et mot de passe requis','error');
  try{
    const r=await fetch(`/api/practitioners/${practId}/invite`,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({email,password,role})});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast('Compte créé ! Communiquez les identifiants.','success');loadTeam();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function openRoleModal(practId,name,currentRole){
  const sl=SECTOR_LABELS[userSector]||SECTOR_LABELS.autre;
  const roles=[
    {value:'practitioner',label:sl.practitioner,desc:'Voit uniquement son propre agenda et ses clients'},
    {value:'receptionist',label:sl.receptionist,desc:'Voit l\'agenda de tous, gère les RDV et clients'},
    {value:'manager',label:sl.manager,desc:'Agenda de tous, clients, documents, statistiques'}
  ];
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal" style="max-width:460px"><div class="modal-h"><h3>Modifier le rôle — ${name}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;
  m+=`<div style="display:flex;flex-direction:column;gap:8px">`;
  roles.forEach(r=>{
    const checked=r.value===currentRole?'checked':'';
    const borderColor=r.value===currentRole?'var(--primary)':'var(--border)';
    m+=`<label style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1.5px solid ${borderColor};border-radius:10px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='${r.value===currentRole?'var(--primary)':'var(--border)'}'" onclick="this.parentElement.querySelectorAll('label').forEach(l=>l.style.borderColor='var(--border)');this.style.borderColor='var(--primary)'">
      <input type="radio" name="role_pick" value="${r.value}" ${checked} style="margin-top:2px">
      <div><div style="font-size:.88rem;font-weight:600">${r.label}</div><div style="font-size:.75rem;color:var(--text-4);margin-top:2px">${r.desc}</div></div>
    </label>`;
  });
  m+=`</div>`;
  m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="saveRole('${practId}')">Enregistrer</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
}

async function saveRole(practId){
  const picked=document.querySelector('input[name="role_pick"]:checked');
  if(!picked)return GendaUI.toast('Sélectionnez un rôle','error');
  try{
    const r=await fetch(`/api/practitioners/${practId}/role`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({role:picked.value})});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast('Rôle modifié','success');loadTeam();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

bridge({ loadTeam, openPractModal, savePract, deactivatePract, openPracTasks, togglePracTodo, reactivatePract, openInviteModal, generateTempPwd, sendInvite, openRoleModal, saveRole, pPhotoPreview, pRemovePhoto });

export { loadTeam, openPractModal, savePract, deactivatePract, openPracTasks, togglePracTodo, reactivatePract, openInviteModal, sendInvite, openRoleModal, saveRole, pPhotoPreview, pRemovePhoto };
