/**
 * Services (Prestations) view module.
 */
import { api, userSector, categoryLabels, GendaUI } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';
import { cswHTML } from './agenda/color-swatches.js';

let allPractitioners=[];
let allSectorCats=[];
let allTemplateGroups=[];

const DAY_LABELS=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

async function loadServices(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const[sr,pr,cr]=await Promise.all([
      fetch('/api/services',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/dashboard',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/business/sector-categories',{headers:{'Authorization':'Bearer '+api.getToken()}})
    ]);
    const sd=await sr.json(), pd=await pr.json();
    const svcs=sd.services||[];
    allPractitioners=pd.practitioners||[];
    if(cr.ok){const cd=await cr.json();allSectorCats=cd.categories||[];}
    // Pre-fetch templates for "+" buttons
    try{
      const tr=await fetch('/api/business/service-templates',{headers:{'Authorization':'Bearer '+api.getToken()}});
      if(tr.ok){const td=await tr.json();allTemplateGroups=td.groups||[];}
    }catch(e){allTemplateGroups=[];}

    const svcLabel=categoryLabels.service.toLowerCase(), svcsLabel=categoryLabels.services.toLowerCase();
    let h='';
    if(svcs.length===0 && allSectorCats.length===0){
      h+=`<div class="card qs-hero"><div class="qs-hero-content">
        <div class="qs-hero-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
        <h3>Créez votre carte en 2 minutes</h3>
        <p>Sélectionnez vos catégories, ajustez les prix et durées, et c'est parti !</p>
        <button class="btn-primary qs-hero-btn" onclick="openQuickStart()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Démarrage rapide</button>
        <button class="qs-hero-secondary" onclick="openServiceModal()">ou créer manuellement</button>
      </div></div>`;
    } else {
      const showQS=svcs.length<20;
      h+=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px"><h3 style="font-size:.95rem;font-weight:700">${svcs.length} ${svcs.length>1?svcsLabel:svcLabel}</h3><div style="display:flex;gap:8px;flex-wrap:wrap">${showQS?'<button class="btn-outline btn-sm" onclick="openQuickStart()" style="display:flex;align-items:center;gap:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Rapide</button>':''}<button class="btn-outline btn-sm" onclick="svcNewCategory()" style="display:flex;align-items:center;gap:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg> Catégorie</button><button class="btn-primary" onclick="openServiceModal()">+ ${categoryLabels.service}</button></div></div>`;

      // Group services by category
      const catMap={};
      svcs.forEach(s=>{
        const cat=s.category||'Autres';
        if(!catMap[cat])catMap[cat]=[];
        catMap[cat].push(s);
      });
      // Build ordered list of categories: sector cats first (by sort_order), then custom, then "Autres"
      const catOrder=[];
      const catIcons={};
      allSectorCats.forEach(c=>{catIcons[c.label]=c.icon_svg||'';if(!catOrder.includes(c.label))catOrder.push(c.label);});
      Object.keys(catMap).forEach(cat=>{if(!catOrder.includes(cat))catOrder.push(cat);});
      // Move "Autres" to end
      const autresIdx=catOrder.indexOf('Autres');
      if(autresIdx>-1){catOrder.splice(autresIdx,1);catOrder.push('Autres');}

      catOrder.forEach(cat=>{
        const groupSvcs=catMap[cat]||[];
        const iconSvg=catIcons[cat]||'';
        const collapsed='';
        h+=`<div class="svc-cat-section" data-cat="${esc(cat)}">`;
        h+=`<div class="svc-cat-header" onclick="svcToggleSection(this)">`;
        if(iconSvg)h+=`<span class="svc-cat-icon">${iconSvg}</span>`;
        h+=`<span class="svc-cat-label">${esc(cat)}</span>`;
        h+=`<span class="svc-cat-count">${groupSvcs.length}</span>`;
        h+=`<button class="svc-cat-add" onclick="event.stopPropagation();svcAddFromTemplate('${esc(cat)}')" title="Ajouter une prestation"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        h+=`<span class="svc-cat-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg></span>`;
        h+=`</div>`;
        h+=`<div class="svc-cat-body">`;
        if(groupSvcs.length===0){
          h+=`<div style="padding:20px;text-align:center;color:var(--text-4);font-size:.82rem">Aucune prestation dans cette catégorie</div>`;
        }else{
          h+=`<div class="svc-grid">`;
          groupSvcs.forEach(s=>{
            h+=renderServiceCard(s);
          });
          h+=`</div>`;
        }
        h+=`</div></div>`;
      });
    }
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

function renderServiceCard(s){
  const price=s.price_cents?`${(s.price_cents/100).toFixed(0)} €`:(s.price_label||'Gratuit');
  const modes=(s.mode_options||['cabinet']).map(m=>`<span class="mode-tag">${{cabinet:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg> Cabinet',visio:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Visio',phone:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> Tél'}[m]||m}</span>`).join('');
  const physOnly=['coiffeur','esthetique','kine','dentiste','veterinaire'].includes(userSector);
  const pIds=s.practitioner_ids||[];
  const pNames=pIds.length>0?pIds.map(pid=>{const p=allPractitioners.find(x=>x.id===pid);return p?p.display_name:'?';}).join(', '):'Tous les membres';

  // Schedule restriction badge
  let scheduleBadge='';
  if(s.available_schedule?.type==='restricted'){
    const w=s.available_schedule.windows||[];
    const days=[...new Set(w.map(x=>DAY_LABELS[x.day]))].join(', ');
    const times=w.length>0?w[0].from+'-'+w[0].to:'';
    scheduleBadge=`<span style="font-size:.68rem;padding:2px 8px;border-radius:6px;background:var(--orange-light,#fff3e0);color:var(--orange,#e65100);font-weight:500;display:inline-flex;align-items:center;gap:3px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${days}${times?' '+times:''}</span>`;
  }

  return `<div class="svc-card${s.is_active===false?' inactive':''}" style="border-left-color:${s.color||'var(--primary)'}">
    <h4>${esc(s.name)}</h4>
    <div class="svc-meta">${s.duration_min}min \u00b7 Buffer: ${s.buffer_before_min||0}+${s.buffer_after_min||0}min</div>
    <div class="svc-price">${price}</div>
    ${s.description?`<div style="font-size:.75rem;color:var(--text-3);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.description)}</div>`:''}
    ${s.variants&&s.variants.length>0?`<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">${s.variants.map(v=>`<span style="font-size:.68rem;padding:2px 8px;border-radius:6px;background:var(--surface);color:var(--text-3);font-weight:500">${esc(v.name)}${v.price_cents?' \u00b7 '+(v.price_cents/100).toFixed(0)+'\u20ac':''}</span>`).join('')}</div>`:''}
    ${scheduleBadge?`<div style="margin-top:4px">${scheduleBadge}</div>`:''}
    ${physOnly?'':`<div class="svc-modes">${modes}</div>`}
    <div style="font-size:.72rem;color:var(--text-4);margin-top:4px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> ${pNames}</div>
    <div class="svc-actions">
      <button class="btn-outline btn-sm" onclick="openServiceModal('${s.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modifier</button>
      ${s.is_active!==false?`<button class="btn-outline btn-sm btn-danger" onclick="if(confirm('D\u00e9sactiver cette ${categoryLabels.service.toLowerCase()} ?'))deactivateService('${s.id}')">D\u00e9sactiver</button>`:`<button class="btn-outline btn-sm" onclick="if(confirm('R\u00e9activer cette ${categoryLabels.service.toLowerCase()} ?'))reactivateService('${s.id}')">R\u00e9activer</button>`}
      <button class="btn-outline btn-sm btn-danger" onclick="if(confirm('Supprimer d\u00e9finitivement cette ${categoryLabels.service.toLowerCase()} ? Cette action est irr\u00e9versible.'))deleteService('${s.id}')" title="Supprimer d\u00e9finitivement"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
    </div>
  </div>`;
}

function svcToggleSection(headerEl){
  const section=headerEl.closest('.svc-cat-section');
  if(section)section.classList.toggle('collapsed');
}

async function svcNewCategory(){
  const v=prompt('Nom de la nouvelle cat\u00e9gorie :');
  if(!v||!v.trim())return;
  try{
    const r=await fetch('/api/business/categories',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({label:v.trim()})});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast('Cat\u00e9gorie cr\u00e9\u00e9e','success');loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function svcAddFromTemplate(cat){
  // Find templates for this category
  const group=allTemplateGroups.find(g=>g.category===cat);
  if(!group||!group.templates||group.templates.length===0){
    // No templates — just open empty modal with category pre-filled
    openServiceModal(null,{category:cat,color:catColor(cat)});
    return;
  }
  // Show template picker dropdown
  const existing=document.querySelectorAll('.svc-tpl-picker');
  existing.forEach(el=>el.remove());

  // Find the header button
  const section=document.querySelector(`.svc-cat-section[data-cat="${cat}"]`);
  const btn=section?.querySelector('.svc-cat-add');
  if(!btn)return;

  let dd=`<div class="svc-tpl-picker">`;
  dd+=`<div class="svc-tpl-picker-title">${esc(cat)} \u2014 Templates</div>`;
  group.templates.forEach(t=>{
    const price=t.suggested_price_cents?`${Math.round(t.suggested_price_cents/100)}\u20ac`:'';
    dd+=`<div class="svc-tpl-picker-item" onclick="svcPickTemplate('${esc(cat)}','${esc(t.name)}',${t.suggested_duration_min||30},${t.suggested_price_cents||0})">
      <span class="svc-tpl-picker-name">${esc(t.name)}</span>
      <span class="svc-tpl-picker-meta">${t.suggested_duration_min||30}min${price?' \u00b7 '+price:''}</span>
    </div>`;
  });
  dd+=`<div class="svc-tpl-picker-item svc-tpl-picker-custom" onclick="svcPickTemplate('${esc(cat)}','',30,0)">
    <span class="svc-tpl-picker-name">+ Cr\u00e9er manuellement</span>
  </div>`;
  dd+=`</div>`;
  btn.style.position='relative';
  btn.insertAdjacentHTML('afterend',dd);
  // Close on outside click
  setTimeout(()=>{
    document.addEventListener('click',function closePicker(e){
      if(!e.target.closest('.svc-tpl-picker')&&!e.target.closest('.svc-cat-add')){
        document.querySelectorAll('.svc-tpl-picker').forEach(el=>el.remove());
        document.removeEventListener('click',closePicker);
      }
    });
  },10);
}

function svcPickTemplate(cat,name,dur,priceCents){
  document.querySelectorAll('.svc-tpl-picker').forEach(el=>el.remove());
  const prefill={category:cat,color:catColor(cat)};
  if(name)prefill.name=name;
  if(dur)prefill.duration_min=dur;
  if(priceCents)prefill.price_cents=priceCents;
  openServiceModal(null,prefill);
}

async function openServiceModal(editId,prefill){
  let sectorCats=allSectorCats;
  if(!sectorCats.length){
    try{
      const r=await fetch('/api/business/sector-categories',{headers:{'Authorization':'Bearer '+api.getToken()}});
      if(r.ok){const data=await r.json();sectorCats=data.categories||[];}
    }catch(e){console.warn('Failed to load sector categories:',e.message);}
  }
  if(editId){
    const sr=await fetch(`/api/services`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await sr.json();
    renderServiceModal(d.services.find(s=>s.id===editId),sectorCats,null);
  }else{renderServiceModal(null,sectorCats,prefill||null);}
}

function renderServiceModal(svc,sectorCats,prefill){
  const isEdit=!!svc;
  const pf=prefill||{};
  const svcLabel=categoryLabels.service.toLowerCase();
  let m=`<div class="modal-overlay" onclick="if(event.target===this)this.remove()"><div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier le '+svcLabel:'Nouveau '+svcLabel}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div><div class="modal-body">`;
  m+=`<div class="field"><label>Cat\u00e9gorie</label><select id="svc_cat" style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-family:var(--sans);font-size:.85rem;background:var(--white)">`;
  m+=`<option value="">\u2014 Choisir une cat\u00e9gorie \u2014</option>`;
  const currentCat=svc?.category||pf.category||'';
  (sectorCats||[]).forEach(c=>{
    const sel=c.label===currentCat?' selected':'';
    const suffix=c.source==='custom'?' (personnalis\u00e9e)':'';
    m+=`<option value="${c.label}"${sel}>${c.label}${suffix}</option>`;
  });
  const isUnknown=currentCat&&!(sectorCats||[]).some(c=>c.label===currentCat);
  if(isUnknown){m+=`<option value="${currentCat}" selected>${currentCat} (personnalis\u00e9e)</option>`;}
  m+=`<option value="__custom__">+ Cat\u00e9gorie personnalis\u00e9e...</option>`;
  m+=`</select></div>`;
  m+=`<div class="field"><label>Nom *</label><input id="svc_name" value="${esc(svc?.name||pf.name||'')}" placeholder="Ex: Consultation initiale"></div>`;
  m+=`<div class="field"><label>Description <span style="font-weight:400;color:var(--text-4)">(visible par les clients)</span></label><textarea id="svc_desc" rows="2" placeholder="D\u00e9crivez la prestation pour vos clients..." style="width:100%;padding:9px 12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-family:var(--sans);font-size:.85rem;resize:vertical">${svc?.description||''}</textarea></div>`;
  const durVal=svc?.duration_min||pf.duration_min||30;
  const priceVal=svc?.price_cents?(svc.price_cents/100):(pf.price_cents?(pf.price_cents/100):'');
  m+=`<div class="field-row"><div class="field"><label>Dur\u00e9e (min) *</label><input type="number" id="svc_dur" value="${durVal}" min="5" step="5"></div><div class="field"><label>Prix (\u20ac)</label><input type="number" id="svc_price" value="${priceVal}" step="0.01" placeholder="Gratuit si vide"></div></div>`;
  m+=`<div class="field-row"><div class="field"><label>Buffer avant (min)</label><input type="number" id="svc_bbefore" value="${svc?.buffer_before_min||0}" min="0"></div><div class="field"><label>Buffer apr\u00e8s (min)</label><input type="number" id="svc_bafter" value="${svc?.buffer_after_min||0}" min="0"></div></div>`;
  m+=`<div class="field"><label>Couleur</label><div id="svc_color_wrap"></div></div>`;
  const modes=svc?.mode_options||['cabinet'];
  const physicalOnlySectors=['coiffeur','esthetique','kine','dentiste','veterinaire'];
  const showModes=!physicalOnlySectors.includes(userSector);
  if(showModes){
  m+=`<div class="field"><label>Modes de consultation</label><div style="display:flex;gap:8px;margin-top:4px">
    <label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="checkbox" id="svc_m_cab" ${modes.includes('cabinet')?'checked':''}> Cabinet</label>
    <label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="checkbox" id="svc_m_vis" ${modes.includes('visio')?'checked':''}> Visio</label>
    <label style="font-size:.82rem;display:flex;align-items:center;gap:4px"><input type="checkbox" id="svc_m_tel" ${modes.includes('phone')?'checked':''}> T\u00e9l</label>
  </div></div>`;
  }
  m+=`<div class="field"><label>Label prix (si pas de montant)</label><input id="svc_plabel" value="${svc?.price_label||''}" placeholder="Ex: Sur devis, Gratuit..."></div>`;
  // Variants section
  const existingVars=svc?.variants||[];
  m+=`<div class="field"><label>Variantes <span style="font-weight:400;color:var(--text-4)">(optionnel)</span></label><div id="svc_variants_list">`;
  existingVars.forEach(v=>{
    m+=`<div class="svc-var-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="svc-var-name" value="${esc(v.name)}" placeholder="Nom" style="flex:2;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="number" class="svc-var-dur" value="${v.duration_min}" min="5" step="5" placeholder="Min" style="width:70px;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="number" class="svc-var-price" value="${v.price_cents?(v.price_cents/100):''}" step="0.01" placeholder="\u20ac" style="width:70px;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="hidden" class="svc-var-id" value="${v.id}"><button type="button" onclick="svcRemoveVariant(this)" style="background:none;border:none;color:var(--red);cursor:pointer;padding:4px;font-size:1.1rem;line-height:1">&times;</button></div>`;
  });
  m+=`</div><button type="button" class="btn-outline btn-sm" onclick="svcAddVariant()" style="margin-top:4px;font-size:.78rem">+ Variante</button><div style="font-size:.72rem;color:var(--text-4);margin-top:4px">Ex: Courts (60min, 45\u20ac), Mi-Longs (75min, 55\u20ac)</div></div>`;
  // Schedule restriction section
  const sched=svc?.available_schedule||null;
  const isRestricted=sched?.type==='restricted';
  m+=`<div class="field"><label>Disponibilit\u00e9</label>`;
  m+=`<div style="margin-top:4px"><label style="font-size:.82rem;display:flex;align-items:center;gap:6px;cursor:pointer"><input type="checkbox" id="svc_sched_toggle" ${isRestricted?'checked':''} onchange="svcToggleSched()"> Restreindre les horaires</label></div>`;
  m+=`<div id="svc_sched_editor" style="display:${isRestricted?'block':'none'};margin-top:8px;border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:10px">`;
  for(let d=0;d<7;d++){
    const dayWindows=isRestricted?(sched.windows||[]).filter(w=>w.day===d):[];
    const active=dayWindows.length>0;
    m+=`<div class="svc-sched-day" data-day="${d}" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid var(--border-light)">`;
    m+=`<label style="width:36px;font-size:.78rem;font-weight:600;padding-top:6px">${DAY_LABELS[d]}</label>`;
    m+=`<input type="checkbox" class="svc-sched-day-cb" ${active?'checked':''} onchange="svcSchedDayToggle(this)" style="margin-top:7px">`;
    m+=`<div class="svc-sched-windows" style="flex:1">`;
    if(active){
      dayWindows.forEach(w=>{
        m+=`<div class="svc-sched-win" style="display:flex;gap:4px;align-items:center;margin-bottom:4px"><input type="time" class="svc-sched-from" value="${w.from}" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.78rem"><span style="font-size:.78rem">\u2014</span><input type="time" class="svc-sched-to" value="${w.to}" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.78rem"><button type="button" onclick="this.closest('.svc-sched-win').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1rem">&times;</button></div>`;
      });
    }else{
      m+=`<div class="svc-sched-win" style="display:none;gap:4px;align-items:center;margin-bottom:4px"><input type="time" class="svc-sched-from" value="09:00" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.78rem"><span style="font-size:.78rem">\u2014</span><input type="time" class="svc-sched-to" value="12:00" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.78rem"><button type="button" onclick="this.closest('.svc-sched-win').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1rem">&times;</button></div>`;
    }
    m+=`</div>`;
    m+=`<button type="button" onclick="svcSchedAddWin(this)" style="background:none;border:none;color:var(--primary);cursor:pointer;font-size:.72rem;padding-top:6px;white-space:nowrap">+ plage</button>`;
    m+=`</div>`;
  }
  m+=`<div style="font-size:.72rem;color:var(--text-4);margin-top:4px">D\u00e9finissez les jours et heures o\u00f9 cette prestation est disponible</div>`;
  m+=`</div></div>`;
  // Practitioner assignment
  const assignedIds=svc?.practitioner_ids||[];
  if(allPractitioners.length>0){
    m+=`<div class="field"><label>Assign\u00e9 \u00e0</label><div id="svc_practitioners" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px">`;
    allPractitioners.forEach(p=>{
      const checked=assignedIds.includes(p.id)?'checked':'';
      m+=`<label style="font-size:.82rem;display:flex;align-items:center;gap:4px;padding:4px 10px;background:var(--bg-card);border:1.5px solid var(--border);border-radius:8px;cursor:pointer"><input type="checkbox" class="svc_pract_cb" value="${p.id}" ${checked}> ${p.display_name}</label>`;
    });
    m+=`</div><div style="font-size:.72rem;color:var(--text-4);margin-top:4px">Si aucun coch\u00e9, la prestation sera disponible pour tous</div></div>`;
  }
  m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="saveService(${isEdit?"'"+svc.id+"'":'null'})">${isEdit?'Enregistrer':'Cr\u00e9er'}</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
  document.getElementById('svc_color_wrap').innerHTML=cswHTML('svc_color',svc?.color||pf.color||'#0D7377',false);
  document.getElementById('svc_cat').addEventListener('change',function(){
    if(this.value==='__custom__'){
      const v=prompt('Nom de la cat\u00e9gorie personnalis\u00e9e :');
      if(v&&v.trim()){
        const opt=document.createElement('option');
        opt.value=v.trim();
        opt.textContent=v.trim()+' (personnalis\u00e9e)';
        opt.selected=true;
        this.insertBefore(opt,this.querySelector('option[value="__custom__"]'));
      }else{this.value='';}
    }
  });
}

function svcToggleSched(){
  const ed=document.getElementById('svc_sched_editor');
  const cb=document.getElementById('svc_sched_toggle');
  if(ed)ed.style.display=cb?.checked?'block':'none';
}

function svcSchedDayToggle(cb){
  const day=cb.closest('.svc-sched-day');
  const wins=day.querySelectorAll('.svc-sched-win');
  if(cb.checked){
    if(wins.length===0||[...wins].every(w=>w.style.display==='none')){
      // Show existing hidden or add new
      const hidden=[...wins].find(w=>w.style.display==='none');
      if(hidden){hidden.style.display='flex';}
      else{svcSchedAddWin(day.querySelector('button:last-child'));}
    }
    wins.forEach(w=>{if(w.style.display==='none')w.style.display='flex';});
  }else{
    wins.forEach(w=>w.style.display='none');
  }
}

function svcSchedAddWin(btn){
  const day=btn.closest('.svc-sched-day');
  const container=day.querySelector('.svc-sched-windows');
  container.insertAdjacentHTML('beforeend',`<div class="svc-sched-win" style="display:flex;gap:4px;align-items:center;margin-bottom:4px"><input type="time" class="svc-sched-from" value="09:00" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.78rem"><span style="font-size:.78rem">\u2014</span><input type="time" class="svc-sched-to" value="12:00" style="padding:4px 6px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.78rem"><button type="button" onclick="this.closest('.svc-sched-win').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:1rem">&times;</button></div>`);
  // Ensure day checkbox is checked
  const cb=day.querySelector('.svc-sched-day-cb');
  if(cb)cb.checked=true;
}

function buildScheduleFromEditor(){
  const toggle=document.getElementById('svc_sched_toggle');
  if(!toggle?.checked)return null;
  const windows=[];
  document.querySelectorAll('.svc-sched-day').forEach(dayEl=>{
    const day=parseInt(dayEl.dataset.day);
    const cb=dayEl.querySelector('.svc-sched-day-cb');
    if(!cb?.checked)return;
    dayEl.querySelectorAll('.svc-sched-win').forEach(winEl=>{
      if(winEl.style.display==='none')return;
      const from=winEl.querySelector('.svc-sched-from')?.value;
      const to=winEl.querySelector('.svc-sched-to')?.value;
      if(from&&to&&from<to)windows.push({day,from,to});
    });
  });
  if(windows.length===0){
    GendaUI.toast('Attention : aucun cr\u00e9neau d\u00e9fini, la prestation ne sera jamais disponible','error');
    return null;
  }
  return {type:'restricted',windows};
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
  // Schedule restriction
  body.available_schedule=buildScheduleFromEditor();
  const varRows=document.querySelectorAll('#svc_variants_list .svc-var-row');
  body.variants=[...varRows].map(row=>({id:row.querySelector('.svc-var-id').value||undefined,name:row.querySelector('.svc-var-name').value.trim(),duration_min:parseInt(row.querySelector('.svc-var-dur').value)||0,price_cents:row.querySelector('.svc-var-price').value?Math.round(parseFloat(row.querySelector('.svc-var-price').value)*100):null})).filter(v=>v.name&&v.duration_min>0);
  try{
    const url=id?`/api/services/${id}`:'/api/services';
    const method=id?'PATCH':'POST';
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast(id?categoryLabels.service+' modifi\u00e9e':categoryLabels.service+' cr\u00e9\u00e9e','success');loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deactivateService(id){
  try{
    const r=await fetch(`/api/services/${id}/deactivate`,{method:'PATCH',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast(categoryLabels.service+' d\u00e9sactiv\u00e9e','success');loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function reactivateService(id){
  try{
    const r=await fetch(`/api/services/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({is_active:true})});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast(categoryLabels.service+' r\u00e9activ\u00e9e','success');loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function deleteService(id){
  try{
    const r=await fetch(`/api/services/${id}`,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast(categoryLabels.service+' supprim\u00e9e','success');loadServices();
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
    <div class="modal-h"><h3>Choisissez vos cat\u00e9gories</h3><button class="close" onclick="this.closest('.modal-overlay').remove()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>
    <div class="modal-body">
      <p class="qs-subtitle">D\u00e9cochez les cat\u00e9gories qui ne vous concernent pas</p>
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
      <span class="qs-count" id="qsCatCount"><strong>${qsSelectedCats.size}</strong> cat\u00e9gories s\u00e9lectionn\u00e9es</span>
      <button class="btn-primary" onclick="qsGoStep2()" id="qsNextBtn">Continuer \u2192</button>
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
  if(cnt)cnt.innerHTML=`<strong>${qsSelectedCats.size}</strong> cat\u00e9gories s\u00e9lectionn\u00e9es`;
}

function qsGoStep2(){
  if(qsSelectedCats.size===0){GendaUI.toast('S\u00e9lectionnez au moins une cat\u00e9gorie','error');return;}
  const modal=qsOverlay?.querySelector('.qs-modal');
  if(!modal)return;
  const svcsLabel=categoryLabels.services.toLowerCase();
  const svcLabel=categoryLabels.service.toLowerCase();
  const steps=modal.querySelectorAll('.qs-step');
  const line=modal.querySelector('.qs-line');
  if(steps[0])steps[0].classList.replace('active','done');
  if(line)line.classList.add('done');
  if(steps[1])steps[1].classList.add('active');
  modal.querySelector('.modal-h h3').textContent='Ajustez vos prestations';
  const durations=[15,30,45,60,90,120];
  let body=`<p class="qs-subtitle">Modifiez les noms, dur\u00e9es et prix selon votre carte</p>`;
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
        <div class="qs-price-wrap"><input type="number" class="qs-tpl-price" value="${price}" step="1" min="0"><span>\u20ac</span></div>
      </div>`;
    });
    body+=`</div>`;
  });
  modal.querySelector('.modal-body').innerHTML=body;
  const totalTpl=selectedGroups.reduce((s,g)=>s+g.templates.length,0);
  modal.querySelector('.modal-foot').innerHTML=`
    <button class="qs-back" onclick="qsBack()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Retour</button>
    <span class="qs-count" id="qsTplCount"><strong>${totalTpl}</strong> ${svcsLabel}</span>
    <button class="btn-primary qs-submit" onclick="qsSubmitAll()" id="qsSubmitBtn">Cr\u00e9er ${totalTpl} ${totalTpl>1?svcsLabel:svcLabel}</button>`;
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
  if(btn){btn.textContent=`Cr\u00e9er ${checked} ${checked>1?svcsLabel:svcLabel}`;btn.disabled=checked===0;}
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
  if(!toCreate.length){GendaUI.toast('S\u00e9lectionnez au moins une prestation','error');return;}
  const btn=document.getElementById('qsSubmitBtn');
  const svcsLabel=categoryLabels.services.toLowerCase();
  btn.disabled=true;
  let created=0,errors=0;
  for(let i=0;i<toCreate.length;i++){
    btn.textContent=`Cr\u00e9ation ${i+1}/${toCreate.length}...`;
    try{
      const r=await fetch('/api/services',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(toCreate[i])});
      if(r.ok)created++;else errors++;
    }catch(e){errors++;}
  }
  document.querySelector('.qs-overlay')?.remove();
  GendaUI.toast(`${created} ${svcsLabel} cr\u00e9\u00e9es !`,'success');
  if(errors>0)GendaUI.toast(`${errors} erreur(s)`,'error');
  loadServices();
}

function svcAddVariant(){
  document.getElementById('svc_variants_list').insertAdjacentHTML('beforeend',`<div class="svc-var-row" style="display:flex;gap:6px;align-items:center;margin-bottom:6px"><input class="svc-var-name" value="" placeholder="Nom" style="flex:2;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="number" class="svc-var-dur" value="" min="5" step="5" placeholder="Min" style="width:70px;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="number" class="svc-var-price" value="" step="0.01" placeholder="\u20ac" style="width:70px;padding:7px 10px;border:1.5px solid var(--border);border-radius:var(--radius-sm);font-size:.82rem"><input type="hidden" class="svc-var-id" value=""><button type="button" onclick="svcRemoveVariant(this)" style="background:none;border:none;color:var(--red);cursor:pointer;padding:4px;font-size:1.1rem;line-height:1">&times;</button></div>`);
}
function svcRemoveVariant(btn){btn.closest('.svc-var-row').remove();}

bridge({ loadServices, openServiceModal, saveService, deactivateService, reactivateService, deleteService, openQuickStart, qsToggleCat, qsGoStep2, qsBack, qsDur, qsToggleTpl, qsSubmitAll, qsUpdateCount, svcAddVariant, svcRemoveVariant, svcToggleSection, svcNewCategory, svcAddFromTemplate, svcPickTemplate, svcToggleSched, svcSchedDayToggle, svcSchedAddWin });

export { loadServices, openServiceModal, saveService, deactivateService, reactivateService, deleteService, openQuickStart };
