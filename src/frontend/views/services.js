/**
 * Services (Prestations) view module.
 */
import { api, userSector, categoryLabels, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { cswHTML } from './agenda/color-swatches.js';

let allPractitioners=[];

async function loadServices(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const[sr,pr]=await Promise.all([
      fetch('/api/services',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/dashboard',{headers:{'Authorization':'Bearer '+api.getToken()}})
    ]);
    const sd=await sr.json(), pd=await pr.json();
    const svcs=sd.services||[];
    allPractitioners=pd.practitioners||[];
    const svcLabel=categoryLabels.service.toLowerCase(), svcsLabel=categoryLabels.services.toLowerCase();
    let h=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:.95rem;font-weight:700">${svcs.length} ${svcs.length>1?svcsLabel:svcLabel}</h3><button class="btn-primary" onclick="openServiceModal()">+ ${categoryLabels.service}</button></div>`;
    if(svcs.length===0){h+=`<div class="card"><div class="empty">Aucune ${svcLabel}. Créez votre première !</div></div>`;}
    else{
      h+=`<div class="svc-grid">`;
      svcs.forEach(s=>{
        const price=s.price_cents?`${(s.price_cents/100).toFixed(0)} €`:(s.price_label||'Gratuit');
        const modes=(s.mode_options||['cabinet']).map(m=>`<span class="mode-tag">${{cabinet:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg> Cabinet',visio:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Visio',phone:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Tél'}[m]||m}</span>`).join('');
        const physOnly=['coiffeur','esthetique','kine','dentiste','veterinaire'].includes(userSector);
        const pIds=s.practitioner_ids||[];
        const pNames=pIds.length>0?pIds.map(pid=>{const p=allPractitioners.find(x=>x.id===pid);return p?p.display_name:'?';}).join(', '):'Tous les membres';
        h+=`<div class="svc-card${s.is_active===false?' inactive':''}" style="border-left-color:${s.color||'var(--primary)'}">
          <h4>${s.name}</h4>
          <div class="svc-meta">${s.duration_min}min · Buffer: ${s.buffer_before_min||0}+${s.buffer_after_min||0}min${s.category?' · '+s.category:''}</div>
          <div class="svc-price">${price}</div>
          ${physOnly?'':`<div class="svc-modes">${modes}</div>`}
          <div style="font-size:.72rem;color:var(--text-4);margin-top:4px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${pNames}</div>
          <div class="svc-actions">
            <button class="btn-outline btn-sm" onclick="openServiceModal('${s.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modifier</button>
            ${s.is_active!==false?`<button class="btn-outline btn-sm btn-danger" onclick="if(confirm('Désactiver cette ${categoryLabels.service.toLowerCase()} ?'))deleteService('${s.id}')">Désactiver</button>`:`<span style="font-size:.72rem;color:var(--text-4);padding:5px">Inactive</span>`}
          </div>
        </div>`;
      });
      h+=`</div>`;
    }
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

function openServiceModal(editId){
  if(editId){
    fetch(`/api/services`,{headers:{'Authorization':'Bearer '+api.getToken()}}).then(r=>r.json()).then(d=>{
      renderServiceModal(d.services.find(s=>s.id===editId));
    });
  }else{renderServiceModal(null);}
}

function renderServiceModal(svc){
  const isEdit=!!svc;
  const svcLabel=categoryLabels.service.toLowerCase();
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier la '+svcLabel:'Nouvelle '+svcLabel}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;
  m+=`<div class="field"><label>Nom *</label><input id="svc_name" value="${svc?.name||''}" placeholder="Ex: Consultation initiale"></div>`;
  m+=`<div class="field-row"><div class="field"><label>Durée (min) *</label><input type="number" id="svc_dur" value="${svc?.duration_min||30}" min="5" step="5"></div><div class="field"><label>Prix (€)</label><input type="number" id="svc_price" value="${svc?.price_cents?(svc.price_cents/100):''}" step="0.01" placeholder="Gratuit si vide"></div></div>`;
  m+=`<div class="field-row"><div class="field"><label>Buffer avant (min)</label><input type="number" id="svc_bbefore" value="${svc?.buffer_before_min||0}" min="0"></div><div class="field"><label>Buffer après (min)</label><input type="number" id="svc_bafter" value="${svc?.buffer_after_min||0}" min="0"></div></div>`;
  m+=`<div class="field"><label>Catégorie</label><input id="svc_cat" value="${svc?.category||''}" placeholder="Ex: Consultation, Soin..."></div>`;
  m+=`<div class="field"><label>Couleur</label><div id="svc_color_wrap"></div></div>`;
  const modes=svc?.mode_options||['cabinet'];
  // Only show mode options for sectors that can do remote consultations
  const physicalOnlySectors=['coiffeur','esthetique','kine','dentiste','veterinaire'];
  const showModes=!physicalOnlySectors.includes(userSector);
  if(showModes){
  m+=`<div class="field"><label>Modes de consultation</label><div style="display:flex;gap:8px;margin-top:4px">
    <label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="checkbox" id="svc_m_cab" ${modes.includes('cabinet')?'checked':''}> <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg> Cabinet</label>
    <label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="checkbox" id="svc_m_vis" ${modes.includes('visio')?'checked':''}> <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Visio</label>
    <label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="checkbox" id="svc_m_tel" ${modes.includes('phone')?'checked':''}> <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Tél</label>
  </div></div>`;
  }else{
  // Physical-only sector: modes handled in saveService()
  }
  m+=`<div class="field"><label>Label prix (si pas de montant)</label><input id="svc_plabel" value="${svc?.price_label||''}" placeholder="Ex: Sur devis, Gratuit..."></div>`;
  // Practitioner assignment
  const assignedIds=svc?.practitioner_ids||[];
  if(allPractitioners.length>0){
    m+=`<div class="field"><label>Assigné à</label><div id="svc_practitioners" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">`;
    allPractitioners.forEach(p=>{
      const checked=assignedIds.includes(p.id)?'checked':'';
      m+=`<label style="font-size:.82rem;display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--bg-card);border:1.5px solid var(--border);border-radius:8px;cursor:pointer"><input type="checkbox" class="svc_pract_cb" value="${p.id}" ${checked}> ${p.display_name}</label>`;
    });
    m+=`</div><div style="font-size:.72rem;color:var(--text-4);margin-top:4px">Si aucun coché, la prestation sera disponible pour tous</div></div>`;
  }
  m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="saveService(${isEdit?"'"+svc.id+"'":'null'})">${isEdit?'Enregistrer':'Créer'}</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
  document.getElementById('svc_color_wrap').innerHTML=cswHTML('svc_color',svc?.color||'#0D7377',false);
}

async function saveService(id){
  const physicalOnlySectors=['coiffeur','esthetique','kine','dentiste','veterinaire'];
  let modes;
  if(physicalOnlySectors.includes(userSector)){
    modes=['cabinet'];
  }else{
    modes=[];
    if(document.getElementById('svc_m_cab')?.checked)modes.push('cabinet');
    if(document.getElementById('svc_m_vis')?.checked)modes.push('visio');
    if(document.getElementById('svc_m_tel')?.checked)modes.push('phone');
  }
  const priceVal=document.getElementById('svc_price').value;
  const body={name:document.getElementById('svc_name').value,duration_min:parseInt(document.getElementById('svc_dur').value),price_cents:priceVal?Math.round(parseFloat(priceVal)*100):null,price_label:document.getElementById('svc_plabel').value||null,buffer_before_min:parseInt(document.getElementById('svc_bbefore').value)||0,buffer_after_min:parseInt(document.getElementById('svc_bafter').value)||0,category:document.getElementById('svc_cat').value||null,color:document.getElementById('svc_color').value,mode_options:modes.length?modes:['cabinet'],practitioner_ids:[...document.querySelectorAll('.svc_pract_cb:checked')].map(cb=>cb.value)};
  try{
    const url=id?`/api/services/${id}`:'/api/services';
    const method=id?'PATCH':'POST';
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast(id?categoryLabels.service+' modifiée':categoryLabels.service+' créée','success');loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deleteService(id){
  try{
    const r=await fetch(`/api/services/${id}`,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast(categoryLabels.service+' désactivée','success');loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

bridge({ loadServices, openServiceModal, saveService, deleteService });

export { loadServices, openServiceModal, saveService, deleteService };
