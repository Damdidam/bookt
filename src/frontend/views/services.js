/**
 * Services (Prestations) view module.
 */
import { api, userSector, categoryLabels, GendaUI } from '../state.js';
import { esc } from '../utils/dom.js';
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
    let h='';
    if(svcs.length===0){
      h+=`<div class="card qs-hero"><div class="qs-hero-content">
        <div class="qs-hero-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
        <h3>Créez votre carte en 2 minutes</h3>
        <p>Sélectionnez vos catégories, ajustez les prix et durées, et c'est parti !</p>
        <button class="btn-primary qs-hero-btn" onclick="openQuickStart()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Démarrage rapide</button>
        <button class="qs-hero-secondary" onclick="openServiceModal()">ou créer manuellement</button>
      </div></div>`;
    } else {
      const showQS=svcs.length<20;
      h+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3 style="font-size:.95rem;font-weight:700">${svcs.length} ${svcs.length>1?svcsLabel:svcLabel}</h3><div style="display:flex;gap:8px">${showQS?'<button class="btn-outline btn-sm" onclick="openQuickStart()" style="display:flex;align-items:center;gap:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Rapide</button>':''}<button class="btn-primary" onclick="openServiceModal()">+ ${categoryLabels.service}</button></div></div>`;
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
          ${s.description?`<div style="font-size:.75rem;color:var(--text-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.description)}</div>`:''}
          ${s.variants&&s.variants.length>0?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${s.variants.map(v=>`<span style="font-size:.68rem;padding:2px 8px;border-radius:6px;background:var(--surface);color:var(--text-3);font-weight:500">${esc(v.name)}${v.price_cents?' · '+(v.price_cents/100).toFixed(0)+'€':''}</span>`).join('')}</div>`:''}
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

async function openServiceModal(editId){
  let sectorCats=[];
  try{
    const r=await fetch('/api/business/sector-categories',{headers:{'Authorization':'Bearer '+api.getToken()}});
    if(r.ok){const data=await r.json();sectorCats=data.categories||[];}
  }catch(e){console.warn('Failed to load sector categories:',e.message);}
  if(editId){
    const sr=await fetch(`/api/services`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await sr.json();
    renderServiceModal(d.services.find(s=>s.id===editId),sectorCats);
  }else{renderServiceModal(null,sectorCats);}
}

function renderServiceModal(svc,sectorCats){
  const isEdit=!!svc;
  const svcLabel=categoryLabels.service.toLowerCase();
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier le '+svcLabel:'Nouveau '+svcLabel}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;
  m+=`<div class="field"><label>Catégorie</label><select id="svc_cat" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-family:var(--sans);font-size:.85rem;background:var(--white)">`;
  m+=`<option value="">— Choisir une catégorie —</option>`;
  const currentCat=svc?.category||'';
  (sectorCats||[]).forEach(c=>{
    const sel=c.label===currentCat?' selected':'';
    const suffix=c.source==='custom'?' (personnalisée)':'';
    m+=`<option value="${c.label}"${sel}>${c.label}${suffix}</option>`;
  });
  const isUnknown=currentCat&&!(sectorCats||[]).some(c=>c.label===currentCat);
  if(isUnknown){m+=`<option value="${currentCat}" selected>${currentCat} (personnalisée)</option>`;}
  m+=`<option value="__custom__">+ Catégorie personnalisée...</option>`;
  m+=`</select></div>`;
  m+=`<div class="field"><label>Nom *</label><input id="svc_name" value="${svc?.name||''}" placeholder="Ex: Consultation initiale"></div>`;
  m+=`<div class="field"><label>Description <span style="font-weight:400;color:var(--text-4)">(visible par les clients)</span></label><textarea id="svc_desc" rows="2" placeholder="Décrivez la prestation pour vos clients..." style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-family:var(--sans);font-size:.85rem;resize:vertical">${svc?.description||''}</textarea></div>`;
  m+=`<div class="field-row"><div class="field"><label>Durée (min) *</label><input type="number" id="svc_dur" value="${svc?.duration_min||30}" min="5" step="5"></div><div class="field"><label>Prix (€)</label><input type="number" id="svc_price" value="${svc?.price_cents?(svc.price_cents/100):''}" step="0.01" placeholder="Gratuit si vide"></div></div>`;
  m+=`<div class="field-row"><div class="field"><label>Buffer avant (min)</label><input type="number" id="svc_bbefore" value="${svc?.buffer_before_min||0}" min="0"></div><div class="field"><label>Buffer après (min)</label><input type="number" id="svc_bafter" value="${svc?.buffer_after_min||0}" min="0"></div></div>`;
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
  // Variants section
  const existingVars=svc?.variants||[];
  m+=`<div class="field"><label>Variantes <span style="font-weight:400;color:var(--text-4)">(optionnel)</span></label><div id="svc_variants_list">`;
  existingVars.forEach(v=>{
    m+=`<div class="svc-var-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="svc-var-name" value="${esc(v.name)}" placeholder="Nom" style="flex:2;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="number" class="svc-var-dur" value="${v.duration_min}" min="5" step="5" placeholder="Min" style="width:70px;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="number" class="svc-var-price" value="${v.price_cents?(v.price_cents/100):''}" step="0.01" placeholder="€" style="width:70px;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="hidden" class="svc-var-id" value="${v.id}"><button type="button" onclick="svcRemoveVariant(this)" style="background:none;border:none;color:var(--red);cursor:pointer;padding:4px;font-size:1.1rem;line-height:1">&times;</button></div>`;
  });
  m+=`</div><button type="button" class="btn-outline btn-sm" onclick="svcAddVariant()" style="margin-top:4px;font-size:.78rem">+ Variante</button><div style="font-size:.72rem;color:var(--text-4);margin-top:4px">Ex: Courts (60min, 45€), Mi-Longs (75min, 55€)</div></div>`;
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
  document.getElementById('svc_cat').addEventListener('change',function(){
    if(this.value==='__custom__'){
      const v=prompt('Nom de la catégorie personnalisée :');
      if(v&&v.trim()){
        const opt=document.createElement('option');
        opt.value=v.trim();
        opt.textContent=v.trim()+' (personnalisée)';
        opt.selected=true;
        this.insertBefore(opt,this.querySelector('option[value="__custom__"]'));
      }else{this.value='';}
    }
  });
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
  body.description=document.getElementById('svc_desc')?.value.trim()||null;
  const varRows=document.querySelectorAll('#svc_variants_list .svc-var-row');
  body.variants=[...varRows].map(row=>({id:row.querySelector('.svc-var-id').value||undefined,name:row.querySelector('.svc-var-name').value.trim(),duration_min:parseInt(row.querySelector('.svc-var-dur').value)||0,price_cents:row.querySelector('.svc-var-price').value?Math.round(parseFloat(row.querySelector('.svc-var-price').value)*100):null})).filter(v=>v.name&&v.duration_min>0);
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

// ===== QUICK START WIZARD =====

const CSW_COLORS=['#0D7377','#2196F3','#3F51B5','#9C27B0','#E91E63','#F44336','#FF9800','#FFB300','#4CAF50','#00BCD4','#795548','#607D8B'];
function catColor(cat){let h=0;for(let i=0;i<cat.length;i++)h=((h<<5)-h)+cat.charCodeAt(i);return CSW_COLORS[Math.abs(h)%CSW_COLORS.length];}
const checkSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const defaultIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';

let qsGroups=[], qsSelectedCats=new Set(), qsOverlay=null;

async function openQuickStart(){
  try{
    const r=await fetch('/api/business/service-templates',{headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error('Erreur chargement');
    const data=await r.json();
    qsGroups=data.groups||[];
    if(!qsGroups.length){GendaUI.toast('Aucun template pour votre secteur','info');return;}
    qsSelectedCats=new Set(qsGroups.map(g=>g.category));
    qsRenderStep1();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function qsRenderStep1(){
  const svcsLabel=categoryLabels.services.toLowerCase();
  let m=`<div class="modal-overlay qs-overlay" onclick="if(event.target===this)this.remove()"><div class="modal qs-modal">
    <div class="qs-progress">
      <div class="qs-step active">1</div><div class="qs-line"></div><div class="qs-step">2</div>
    </div>
    <div class="modal-h"><h3>Choisissez vos catégories</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body">
      <p class="qs-subtitle">Décochez les catégories qui ne vous concernent pas</p>
      <div class="qs-cat-grid">`;
  qsGroups.forEach(g=>{
    const sel=qsSelectedCats.has(g.category);
    m+=`<div class="qs-cat-card${sel?' selected':''}" data-cat="${g.category}" onclick="qsToggleCat(this)">
      <div class="qs-cat-check">${checkSvg}</div>
      <div class="qs-cat-icon">${g.icon_svg||defaultIcon}</div>
      <div class="qs-cat-label">${g.category}</div>
      <div class="qs-cat-count">${g.templates.length} ${svcsLabel}</div>
    </div>`;
  });
  m+=`</div></div>
    <div class="modal-foot">
      <span class="qs-count" id="qsCatCount"><strong>${qsSelectedCats.size}</strong> catégories sélectionnées</span>
      <button class="btn-primary" onclick="qsGoStep2()" id="qsNextBtn">Continuer →</button>
    </div>
  </div></div>`;
  document.querySelector('.qs-overlay')?.remove();
  document.body.insertAdjacentHTML('beforeend',m);
  qsOverlay=document.querySelector('.qs-overlay');
}

function qsToggleCat(el){
  const cat=el.dataset.cat;
  if(qsSelectedCats.has(cat)){qsSelectedCats.delete(cat);el.classList.remove('selected');}
  else{qsSelectedCats.add(cat);el.classList.add('selected');}
  const cnt=document.getElementById('qsCatCount');
  if(cnt)cnt.innerHTML=`<strong>${qsSelectedCats.size}</strong> catégories sélectionnées`;
}

function qsGoStep2(){
  if(qsSelectedCats.size===0){GendaUI.toast('Sélectionnez au moins une catégorie','error');return;}
  const modal=qsOverlay?.querySelector('.qs-modal');
  if(!modal)return;
  const svcsLabel=categoryLabels.services.toLowerCase();
  const svcLabel=categoryLabels.service.toLowerCase();
  // Update progress
  const steps=modal.querySelectorAll('.qs-step');
  const line=modal.querySelector('.qs-line');
  if(steps[0])steps[0].classList.replace('active','done');
  if(line)line.classList.add('done');
  if(steps[1])steps[1].classList.add('active');
  // Update header
  modal.querySelector('.modal-h h3').textContent='Ajustez vos prestations';
  // Build step 2 body
  const durations=[15,30,45,60,90,120];
  let body=`<p class="qs-subtitle">Modifiez les noms, durées et prix selon votre carte</p>`;
  const selectedGroups=qsGroups.filter(g=>qsSelectedCats.has(g.category));
  selectedGroups.forEach(g=>{
    body+=`<div class="qs-cat-section"><div class="qs-cat-header">${g.icon_svg||defaultIcon}<h4>${g.category}</h4><span class="qs-cat-badge">${g.templates.length}</span></div>`;
    g.templates.forEach((t,i)=>{
      const price=t.suggested_price_cents?Math.round(t.suggested_price_cents/100):'';
      const dur=t.suggested_duration_min||30;
      body+=`<div class="qs-tpl-row" data-category="${g.category}">
        <input type="checkbox" class="qs-tpl-check" checked onchange="qsToggleTpl(this)">
        <input class="qs-tpl-name" value="${t.name}">
        <div class="qs-dur-chips">`;
      durations.forEach(d=>{
        body+=`<span class="qs-dur-chip${d===dur?' active':''}" onclick="qsDur(this,${d})">${d}</span>`;
      });
      body+=`</div><input type="hidden" class="qs-tpl-dur" value="${dur}">
        <div class="qs-price-wrap"><input type="number" class="qs-tpl-price" value="${price}" step="1" min="0"><span>€</span></div>
      </div>`;
    });
    body+=`</div>`;
  });
  modal.querySelector('.modal-body').innerHTML=body;
  // Update footer
  const totalTpl=selectedGroups.reduce((s,g)=>s+g.templates.length,0);
  modal.querySelector('.modal-foot').innerHTML=`
    <button class="qs-back" onclick="qsBack()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Retour</button>
    <span class="qs-count" id="qsTplCount"><strong>${totalTpl}</strong> ${svcsLabel}</span>
    <button class="btn-primary qs-submit" onclick="qsSubmitAll()" id="qsSubmitBtn">Créer ${totalTpl} ${totalTpl>1?svcsLabel:svcLabel}</button>`;
  qsUpdateCount();
}

function qsBack(){
  qsRenderStep1();
}

function qsDur(el,val){
  const row=el.closest('.qs-tpl-row');
  row.querySelectorAll('.qs-dur-chip').forEach(c=>c.classList.remove('active'));
  el.classList.add('active');
  row.querySelector('.qs-tpl-dur').value=val;
}

function qsToggleTpl(cb){
  const row=cb.closest('.qs-tpl-row');
  row.classList.toggle('unchecked',!cb.checked);
  qsUpdateCount();
}

function qsUpdateCount(){
  const checked=document.querySelectorAll('.qs-tpl-row:not(.unchecked)').length;
  const svcsLabel=categoryLabels.services.toLowerCase();
  const svcLabel=categoryLabels.service.toLowerCase();
  const cnt=document.getElementById('qsTplCount');
  if(cnt)cnt.innerHTML=`<strong>${checked}</strong> ${svcsLabel}`;
  const btn=document.getElementById('qsSubmitBtn');
  if(btn){btn.textContent=`Créer ${checked} ${checked>1?svcsLabel:svcLabel}`;btn.disabled=checked===0;}
}

async function qsSubmitAll(){
  const rows=document.querySelectorAll('.qs-tpl-row:not(.unchecked)');
  const toCreate=[];
  rows.forEach(row=>{
    const name=row.querySelector('.qs-tpl-name').value.trim();
    if(!name)return;
    const cat=row.dataset.category;
    const dur=parseInt(row.querySelector('.qs-tpl-dur').value)||30;
    const priceVal=parseFloat(row.querySelector('.qs-tpl-price').value);
    const pIds=allPractitioners.map(p=>p.id);
    toCreate.push({name,category:cat,duration_min:dur,price_cents:priceVal?Math.round(priceVal*100):null,buffer_before_min:0,buffer_after_min:0,mode_options:['cabinet'],color:catColor(cat),practitioner_ids:pIds});
  });
  if(!toCreate.length){GendaUI.toast('Sélectionnez au moins une prestation','error');return;}
  const btn=document.getElementById('qsSubmitBtn');
  const svcsLabel=categoryLabels.services.toLowerCase();
  btn.disabled=true;
  let created=0,errors=0;
  for(let i=0;i<toCreate.length;i++){
    btn.textContent=`Création ${i+1}/${toCreate.length}...`;
    try{
      const r=await fetch('/api/services',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(toCreate[i])});
      if(r.ok)created++;else errors++;
    }catch(e){errors++;}
  }
  document.querySelector('.qs-overlay')?.remove();
  GendaUI.toast(`${created} ${svcsLabel} créées !`,'success');
  if(errors>0)GendaUI.toast(`${errors} erreur(s)`,'error');
  loadServices();
}

function svcAddVariant(){
  document.getElementById('svc_variants_list').insertAdjacentHTML('beforeend',`<div class="svc-var-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="svc-var-name" value="" placeholder="Nom" style="flex:2;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="number" class="svc-var-dur" value="" min="5" step="5" placeholder="Min" style="width:70px;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="number" class="svc-var-price" value="" step="0.01" placeholder="€" style="width:70px;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="hidden" class="svc-var-id" value=""><button type="button" onclick="svcRemoveVariant(this)" style="background:none;border:none;color:var(--red);cursor:pointer;padding:4px;font-size:1.1rem;line-height:1">&times;</button></div>`);
}
function svcRemoveVariant(btn){btn.closest('.svc-var-row').remove();}

bridge({ loadServices, openServiceModal, saveService, deleteService, openQuickStart, qsToggleCat, qsGoStep2, qsBack, qsDur, qsToggleTpl, qsSubmitAll, qsUpdateCount, svcAddVariant, svcRemoveVariant });

export { loadServices, openServiceModal, saveService, deleteService, openQuickStart };
