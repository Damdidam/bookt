/**
 * Services (Prestations) view module — Redesigned hierarchy layout.
 * Category > Service > Variant — each with descriptions.
 */
import { api, userSector, categoryLabels, GendaUI } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';
import { cswHTML } from './agenda/color-swatches.js';

let allPractitioners=[];
let allSectorCats=[];
let allTemplateGroups=[];
let allServices=[];
let catMeta={}; // { label: { id, icon_svg, description, sort_order, source, color } }

const DAY_LABELS=['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
const GRIP_SVG='<svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16"><circle cx="9" cy="5" r="1.5"/><circle cx="15" cy="5" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="19" r="1.5"/><circle cx="15" cy="19" r="1.5"/></svg>';
const PENCIL_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
const TRASH_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>';
const X_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
const CHEVRON_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
const PLUS_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
const CHECK_CIRCLE_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg>';
const PHONE_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92Z"/></svg>';

// Pastel palette for category icon backgrounds
const CAT_BG_PALETTE=['#FCE4EC','#E3F2FD','#E8F5E9','#FFF3E0','#F3E5F5','#E0F7FA','#FFF8E1','#E8EAF6','#FFEBEE','#E0F2F1','#FBE9E7','#ECEFF1'];
const CSW_COLORS=['#1E3A8A','#B91C1C','#059669','#EA580C','#7C3AED','#DB2777','#0EA5A4','#374151'];
function catColor(cat){let h=0;for(let i=0;i<cat.length;i++)h=((h<<5)-h)+cat.charCodeAt(i);return CSW_COLORS[Math.abs(h)%CSW_COLORS.length];}
function catBg(cat){let h=0;for(let i=0;i<cat.length;i++)h=((h<<5)-h)+cat.charCodeAt(i);return CAT_BG_PALETTE[Math.abs(h)%CAT_BG_PALETTE.length];}
function hexToRgb(hex){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return`${r},${g},${b}`;}
// Safe string for JS inside HTML attribute: JS-escape first, then HTML-escape
function jsAttr(s){return String(s).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// ===== MAIN RENDER =====

// Persist open/collapsed state across re-renders (default: all collapsed)
let openCats=null; // null = first load (all collapsed), Set = user has interacted
function saveOpenState(){
  if(!document.querySelector('.svc-category'))return; // nothing rendered yet
  openCats=new Set();
  document.querySelectorAll('.svc-category:not(.collapsed)').forEach(el=>{const cat=el.dataset.cat;if(cat)openCats.add(cat);});
}
function restoreCollapsedState(){
  document.querySelectorAll('.svc-category').forEach(el=>{
    const cat=el.dataset.cat;
    if(openCats&&openCats.has(cat))el.classList.remove('collapsed');
    else el.classList.add('collapsed');
  });
}

async function loadServices(){
  saveOpenState();
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
    allServices=svcs;
    allPractitioners=pd.practitioners||[];
    if(cr.ok){const cd=await cr.json();allSectorCats=cd.categories||[];}
    // Build catMeta
    catMeta={};
    allSectorCats.forEach(c=>{catMeta[c.label]={id:c.id||null,icon_svg:c.icon_svg||'',description:c.description||'',sort_order:c.sort_order||0,source:c.source||'catalog',color:c.color||null};});
    // Pre-fetch templates
    try{
      const tr=await fetch('/api/business/service-templates',{headers:{'Authorization':'Bearer '+api.getToken()}});
      if(tr.ok){const td=await tr.json();allTemplateGroups=td.groups||[];}
    }catch(e){allTemplateGroups=[];}

    let h='';
    if(svcs.length===0 && allSectorCats.length===0){
      h+=`<div class="card qs-hero"><div class="qs-hero-content">
        <div class="qs-hero-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
        <h3>Créez votre carte en 2 minutes</h3>
        <p>Sélectionnez vos catégories, ajustez les prix et durées, et c'est parti !</p>
        <button class="btn-primary qs-hero-btn" onclick="openQuickStart()">${PLUS_SVG} Démarrage rapide</button>
        <button class="qs-hero-secondary" onclick="openServiceModal()">ou créer manuellement</button>
      </div></div>`;
    } else {
      const showQS=svcs.length<20;
      // Group services by category
      const catMap={};
      svcs.forEach(s=>{const cat=s.category||'Autres';if(!catMap[cat])catMap[cat]=[];catMap[cat].push(s);});
      // Build ordered category list
      const catOrder=[];
      allSectorCats.forEach(c=>{
        const hasServices=!!catMap[c.label]&&catMap[c.label].length>0;
        const isCustom=c.source==='custom';
        const isAdopted=!!c.id; // has a business_categories entry → user explicitly created/adopted it
        if((hasServices||isCustom||isAdopted)&&!catOrder.includes(c.label))catOrder.push(c.label);
      });
      Object.keys(catMap).forEach(cat=>{if(!catOrder.includes(cat))catOrder.push(cat);});
      const autresIdx=catOrder.indexOf('Autres');
      if(autresIdx>-1){catOrder.splice(autresIdx,1);catOrder.push('Autres');}

      const catCount=catOrder.length;
      const svcCount=svcs.length;

      // Top bar
      h+=`<div class="svc-top-bar">
        <div class="svc-section-label">${catCount} catégorie${catCount>1?'s':''} · ${svcCount} prestation${svcCount>1?'s':''}</div>
        <div style="display:flex;gap:8px">`;
      if(showQS) h+=`<button class="btn-outline btn-sm" onclick="openQuickStart()" style="display:flex;align-items:center;gap:4px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Rapide</button>`;
      h+=`<button class="btn-primary" onclick="openCategoryModal()" style="display:flex;align-items:center;gap:5px">${PLUS_SVG} Nouvelle catégorie</button>`;
      h+=`</div></div>`;

      // Categories
      h+=`<div id="svcCatList">`;
      catOrder.forEach((cat,ci)=>{
        const groupSvcs=catMap[cat]||[];
        const meta=catMeta[cat]||{};
        const iconSvg=meta.icon_svg||'';
        const desc=meta.description||'';
        const bg=catBg(cat);
        const safeCat=jsAttr(cat);
        const defaultCatIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';

        h+=`<div class="svc-category" data-cat="${esc(cat)}" data-sort="${ci}" draggable="true" ondragstart="svcDragStart(event,'cat')" ondragover="svcDragOver(event,'cat')" ondragleave="svcDragLeave(event)" ondrop="svcDrop(event,'cat')">`;
        const catClr=meta.color||catColor(cat);
        const rgb=hexToRgb(catClr);
        h+=`<div class="svc-cat-header" style="background:linear-gradient(135deg,rgba(${rgb},0.08) 0%,rgba(${rgb},0.02) 60%,transparent 100%);border-bottom-color:rgba(${rgb},0.15)" onclick="svcToggleSection(this)">`;
        h+=`<span class="drag-handle" onclick="event.stopPropagation()">${GRIP_SVG}</span>`;
        h+=`<div class="svc-cat-icon" style="background:${bg}">${iconSvg||defaultCatIcon}</div>`;
        h+=`<div class="svc-cat-info">`;
        h+=`<div class="svc-cat-name">${esc(cat)}</div>`;
        h+=`<div class="svc-cat-count">${groupSvcs.length} prestation${groupSvcs.length>1?'s':''}</div>`;
        if(desc) h+=`<div class="svc-cat-comment">${esc(desc)}</div>`;
        h+=`</div>`;
        h+=`<div class="svc-cat-actions">`;
        if(cat!=='Autres') h+=`<button class="svc-icon-btn" onclick="event.stopPropagation();openCategoryModal('${safeCat}')" title="Modifier">${PENCIL_SVG}</button>`;
        if(cat!=='Autres') h+=`<button class="svc-icon-btn danger" onclick="event.stopPropagation();svcDeleteCategory('${safeCat}')" title="Supprimer">${TRASH_SVG}</button>`;
        h+=`</div>`;
        h+=`<span class="svc-cat-chevron">${CHEVRON_SVG}</span>`;
        h+=`</div>`; // end header

        h+=`<div class="svc-cat-body">`;
        groupSvcs.forEach((s,si)=>{h+=renderServiceRow(s,si);});
        if(groupSvcs.length===0) h+=`<div style="padding:16px;text-align:center;color:var(--text-4);font-size:.82rem">Aucune prestation dans cette catégorie</div>`;
        h+=`<div class="svc-add-row" onclick="svcAddFromTemplate('${safeCat}')">${PLUS_SVG} Ajouter une prestation</div>`;
        h+=`</div></div>`; // end body + category
      });
      h+=`</div>`; // end catList

      // Bottom add category
      h+=`<div class="svc-add-row svc-add-cat" onclick="openCategoryModal()" style="margin-top:8px">${PLUS_SVG} Nouvelle catégorie</div>`;
    }
    c.innerHTML=h;
    restoreCollapsedState();
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

function renderServiceRow(s,sortIdx){
  const vars=s.variants||[];
  const varPrices=vars.map(v=>v.price_cents).filter(p=>p>0);
  const varDurs=vars.map(v=>v.duration_min).filter(d=>d>0);
  let priceStr;
  if(varPrices.length>0){const mn=Math.min(...varPrices)/100,mx=Math.max(...varPrices)/100;priceStr=mn===mx?mn+' €':mn+' – '+mx+' €';}
  else if(s.price_cents)priceStr=(s.price_cents/100).toFixed(0)+' €';
  else priceStr=s.price_label||'Gratuit';
  let durStr;
  if(varDurs.length>0){const mn=Math.min(...varDurs),mx=Math.max(...varDurs);durStr=mn===mx?mn+' min':mn+' – '+mx+' min';}
  else durStr=s.duration_min+' min';

  // Badges
  let badges='';
  if(s.bookable_online!==false) badges+=`<span class="svc-row-badge">${CHECK_CIRCLE_SVG} Réservable en ligne</span>`;
  else badges+=`<span class="svc-row-badge offline">${PHONE_SVG} Sur rendez-vous tél.</span>`;
  if(s.available_schedule?.type==='restricted'){
    const w=s.available_schedule.windows||[];
    const days=[...new Set(w.map(x=>DAY_LABELS[x.day]))].join(', ');
    badges+=`<span class="svc-row-badge sched"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${days}</span>`;
  }
  if(s.is_active===false) badges+=`<span class="svc-row-badge" style="background:#FFEBEE;color:#C62828">Désactivée</span>`;

  let h=`<div class="svc-row${s.is_active===false?' inactive':''}" data-id="${s.id}" data-sort="${sortIdx}" draggable="true" ondragstart="svcDragStart(event,'svc')" ondragover="svcDragOver(event,'svc')" ondragleave="svcDragLeave(event)" ondrop="svcDrop(event,'svc')">`;
  h+=`<div class="svc-color" style="background:${s.color||'var(--primary)'}"></div>`;
  h+=`<span class="drag-handle">${GRIP_SVG}</span>`;
  h+=`<div class="svc-row-info">`;
  h+=`<div class="svc-row-top"><span class="svc-row-name">${esc(s.name)}</span><span class="svc-row-price">${priceStr}</span><span class="svc-row-duration">· ${durStr}</span></div>`;
  if(s.description) h+=`<div class="svc-row-comment">${esc(s.description)}</div>`;
  if(badges) h+=`<div class="svc-row-meta">${badges}</div>`;
  // Inline variants
  if(vars.length>0) h+=renderVariantList(vars,s.color||'var(--primary)',s.id);
  h+=`</div>`; // end info
  h+=`<div class="svc-row-actions">`;
  h+=`<button class="svc-icon-btn" onclick="openServiceModal('${s.id}')" title="Modifier">${PENCIL_SVG}</button>`;
  if(s.is_active!==false) h+=`<button class="svc-icon-btn danger" onclick="if(confirm('Supprimer cette prestation ?'))deleteService('${s.id}')" title="Supprimer">${TRASH_SVG}</button>`;
  else h+=`<button class="svc-icon-btn" onclick="if(confirm('Réactiver ?'))reactivateService('${s.id}')" title="Réactiver" style="color:#2E7D32;border-color:#C8E6C9"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`;
  h+=`</div>`;
  h+=`</div>`; // end row
  return h;
}

function renderVariantList(vars,color,serviceId){
  let h=`<div class="svc-var-list">`;
  vars.forEach(v=>{h+=renderVariantRow(v,color);});
  h+=`</div>`;
  return h;
}

function renderVariantRow(v,color){
  const price=v.price_cents?(v.price_cents/100).toFixed(0)+' €':'';
  let h=`<div class="svc-var-item" data-variant-id="${v.id}">`;
  h+=`<div class="svc-var-dot" style="background:${color}"></div>`;
  h+=`<div class="svc-var-info">`;
  h+=`<div class="svc-var-top"><span class="svc-var-name">${esc(v.name)}</span>`;
  if(price) h+=`<span class="svc-var-price">${price}</span>`;
  h+=`<span class="svc-var-duration">· ${v.duration_min} min</span></div>`;
  if(v.description) h+=`<div class="svc-var-comment">${esc(v.description)}</div>`;
  h+=`</div></div>`;
  return h;
}

// ===== SECTION TOGGLE =====

function svcToggleSection(headerEl){
  const section=headerEl.closest('.svc-category');
  if(section)section.classList.toggle('collapsed');
}

// ===== CATEGORY CRUD =====

function openCategoryModal(catLabel){
  const isEdit=!!catLabel;
  const meta=isEdit?catMeta[catLabel]||{}:{};
  const label=isEdit?catLabel:'';
  const desc=meta.description||'';
  const catId=meta.id||'';
  const color=meta.color||'#1E3A8A';

  let m=`<div class="modal-overlay"><div class="modal"><div class="modal-h"><h3>${isEdit?'Modifier la catégorie':'Nouvelle catégorie'}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()">${X_SVG}</button></div><div class="modal-body">`;
  m+=`<div class="svc-form-row" style="margin-bottom:14px"><div class="field"><label>Nom *</label><input id="cat_modal_name" value="${esc(label)}" placeholder="Ex: Épilation, Soins visage..."></div>`;
  m+=`<div class="field-color"><label>Couleur</label><div id="cat_color_wrap"></div></div></div>`;
  m+=`<div class="field"><label>Description <span style="font-weight:400;color:var(--text-4)">(visible par les clients)</span></label><textarea id="cat_modal_desc" rows="3" placeholder="Décrivez cette catégorie pour vos clients...">${esc(desc)}</textarea></div>`;
  m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="saveCategory('${jsAttr(catId)}','${jsAttr(label)}')">${isEdit?'Enregistrer':'Créer'}</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
  document.getElementById('cat_color_wrap').innerHTML=cswHTML('cat_color',color,true);
  document.getElementById('cat_modal_name').focus();
}

async function saveCategory(catId,oldLabel){
  const name=document.getElementById('cat_modal_name').value.trim();
  const desc=document.getElementById('cat_modal_desc').value.trim()||null;
  const color=document.getElementById('cat_color')?.value||null;
  if(!name){GendaUI.toast('Nom requis','error');return;}
  try{
    if(catId){
      // Update existing
      const r=await fetch(`/api/business/categories/${catId}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({label:name,description:desc,color})});
      if(!r.ok)throw new Error((await r.json()).error);
      // If name or color changed, update all services in this category
      const svcsToUpdate=allServices.filter(s=>s.category===(oldLabel||name));
      const updates={};
      if(oldLabel&&oldLabel!==name)updates.category=name;
      if(color&&color!==(catMeta[oldLabel||name]?.color||null))updates.color=color;
      if(Object.keys(updates).length>0){
        for(const s of svcsToUpdate){
          await fetch(`/api/services/${s.id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(updates)});
        }
      }
    }else{
      // Create new
      const r=await fetch('/api/business/categories',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({label:name,description:desc,color})});
      if(!r.ok)throw new Error((await r.json()).error);
    }
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast(catId?'Catégorie modifiée':'Catégorie créée','success');
    loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function svcDeleteCategory(cat){
  const svcsInCat=allServices.filter(s=>(s.category||'Autres')===cat);
  const msg=svcsInCat.length>0
    ?`Supprimer la catégorie "${cat}" et ses ${svcsInCat.length} prestation(s) ?\n\nCette action est irréversible.`
    :`Supprimer la catégorie "${cat}" (vide) ?`;
  if(!confirm(msg))return;
  try{
    let errors=0;
    for(const s of svcsInCat){
      try{const r=await fetch(`/api/services/${s.id}`,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});if(!r.ok)errors++;}catch(e){errors++;}
    }
    const bizCat=allSectorCats.find(c=>c.label===cat&&(c.source==='custom'||c.id));
    if(bizCat?.id){await fetch(`/api/business/categories/${bizCat.id}`,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}}).catch(()=>{});}
    if(errors>0)GendaUI.toast(`${errors} erreur(s) lors de la suppression`,'error');
    else GendaUI.toast(`Catégorie "${cat}" supprimée`,'success');
    loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// ===== DRAG & DROP =====

let dragEl=null, dragType=null, dragFromHandle=false;

// Track mousedown on drag handle (e.target in dragstart is always the draggable element, not the child clicked)
document.addEventListener('mousedown',e=>{if(e.target.closest('.drag-handle'))dragFromHandle=true;});
document.addEventListener('mouseup',()=>{dragFromHandle=false;});

function svcDragStart(e,type){
  if(!dragFromHandle){e.preventDefault();return;}
  const item=type==='cat'?e.target.closest('.svc-category'):e.target.closest('.svc-row');
  if(!item){e.preventDefault();return;}
  dragEl=item; dragType=type;
  item.classList.add('dragging');
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','');
  e.stopPropagation(); // Prevent service dragstart from bubbling to parent category
}

function svcDragOver(e,type){
  if(dragType!==type)return;
  const target=type==='cat'?e.target.closest('.svc-category'):e.target.closest('.svc-row');
  // Prevent cross-category service drag visual
  if(type==='svc'&&dragEl&&target&&dragEl.parentNode!==target.parentNode)return;
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  if(target&&target!==dragEl)target.classList.add('drag-over');
}

function svcDragLeave(e){
  const target=e.target.closest('.svc-category')||e.target.closest('.svc-row');
  if(target)target.classList.remove('drag-over');
}

function svcDrop(e,type){
  e.preventDefault();
  const target=type==='cat'?e.target.closest('.svc-category'):e.target.closest('.svc-row');
  if(!target||!dragEl||target===dragEl){cleanupDrag();return;}
  // Prevent cross-category service drag
  if(type==='svc'&&dragEl.parentNode!==target.parentNode){cleanupDrag();return;}
  target.classList.remove('drag-over');
  // Reorder in DOM
  const parent=dragEl.parentNode;
  const items=[...parent.querySelectorAll(type==='cat'?'.svc-category':'.svc-row')];
  const fromIdx=items.indexOf(dragEl), toIdx=items.indexOf(target);
  if(fromIdx<toIdx)target.after(dragEl); else target.before(dragEl);
  cleanupDrag();
  // Persist
  if(type==='cat')persistCatOrder(); else persistSvcOrder(parent);
}

function cleanupDrag(){
  if(dragEl)dragEl.classList.remove('dragging');
  document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over'));
  dragEl=null;dragType=null;dragFromHandle=false;
}
document.addEventListener('dragend',cleanupDrag);

async function persistCatOrder(){
  const cats=[...document.querySelectorAll('#svcCatList .svc-category')];
  const order=[];
  // Ensure all categories have business_categories entries (catalog cats may not)
  for(let i=0;i<cats.length;i++){
    const label=cats[i].dataset.cat;
    let meta=catMeta[label];
    if(!meta?.id&&label!=='Autres'){
      // Create a business_categories entry for this catalog category
      try{
        const r=await fetch('/api/business/categories',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({label})});
        if(r.ok){const d=await r.json();catMeta[label]={...catMeta[label],id:d.category.id};meta=catMeta[label];}
      }catch(e){}
    }
    if(meta?.id)order.push({id:meta.id,sort_order:i});
  }
  if(!order.length)return;
  try{await fetch('/api/business/categories/reorder',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({order})});}catch(e){console.warn('Reorder failed:',e);}
}

async function persistSvcOrder(container){
  const rows=[...container.querySelectorAll('.svc-row')];
  const order=rows.map((el,i)=>({id:el.dataset.id,sort_order:i}));
  if(!order.length)return;
  try{await fetch('/api/services/reorder',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({order})});}catch(e){console.warn('Reorder failed:',e);}
}

// ===== TEMPLATE PICKER =====

function svcAddFromTemplate(cat){
  const group=allTemplateGroups.find(g=>g.category===cat);
  if(!group||!group.templates||group.templates.length===0){
    openServiceModal(null,{category:cat,color:catMeta[cat]?.color||catColor(cat)});return;
  }
  document.querySelectorAll('.svc-tpl-picker').forEach(el=>el.remove());
  const section=document.querySelector(`.svc-category[data-cat="${CSS.escape(cat)}"]`);
  const btn=section?.querySelector('.svc-add-row');
  if(!btn)return;
  const rect=btn.getBoundingClientRect();
  let dd=`<div class="svc-tpl-picker" style="position:fixed;top:${rect.top-4}px;left:${Math.max(8,rect.left)}px;right:auto;transform:translateY(-100%)">`;
  dd+=`<div class="svc-tpl-picker-title">${esc(cat)} — Templates</div>`;
  group.templates.forEach(t=>{
    const price=t.suggested_price_cents?`${Math.round(t.suggested_price_cents/100)}€`:'';
    const safeCat=jsAttr(cat);
    const safeName=jsAttr(t.name);
    dd+=`<div class="svc-tpl-picker-item" onclick="svcPickTemplate('${safeCat}','${safeName}',${t.suggested_duration_min||30},${t.suggested_price_cents||0})">
      <span class="svc-tpl-picker-name">${esc(t.name)}</span>
      <span class="svc-tpl-picker-meta">${t.suggested_duration_min||30}min${price?' · '+price:''}</span>
    </div>`;
  });
  const safeCat2=jsAttr(cat);
  dd+=`<div class="svc-tpl-picker-item svc-tpl-picker-custom" onclick="svcPickTemplate('${safeCat2}','',30,0)">
    <span class="svc-tpl-picker-name">+ Créer manuellement</span>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend',dd);
  setTimeout(()=>{
    document.addEventListener('click',function closePicker(e){
      if(!e.target.closest('.svc-tpl-picker')&&!e.target.closest('.svc-add-row')){
        document.querySelectorAll('.svc-tpl-picker').forEach(el=>el.remove());
        document.removeEventListener('click',closePicker);
      }
    });
  },10);
}

function svcPickTemplate(cat,name,dur,priceCents){
  document.querySelectorAll('.svc-tpl-picker').forEach(el=>el.remove());
  const prefill={category:cat,color:catMeta[cat]?.color||catColor(cat)};
  if(name)prefill.name=name;
  if(dur)prefill.duration_min=dur;
  if(priceCents)prefill.price_cents=priceCents;
  openServiceModal(null,prefill);
}

// ===== SERVICE MODAL (preserved) =====

async function openServiceModal(editId,prefill){
  let sectorCats=allSectorCats;
  if(!sectorCats.length){
    try{const r=await fetch('/api/business/sector-categories',{headers:{'Authorization':'Bearer '+api.getToken()}});if(r.ok){const data=await r.json();sectorCats=data.categories||[];}}catch(e){}
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
  const sec=(title)=>`<div class="svc-section"><div class="svc-section-head"><span class="svc-section-title">${title}</span><span class="svc-section-line"></span></div>`;

  const currentCat=svc?.category||pf.category||'';
  let m=`<div class="modal-overlay"><div class="modal svc-modal"><div class="modal-h"><h3>${isEdit?'Modifier la prestation':'Nouvelle prestation'}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()">${X_SVG}</button></div><div class="modal-body">`;

  // ── SECTION 1: Informations ──
  m+=sec('Informations');
  m+=`<input type="hidden" id="svc_cat" value="${esc(currentCat)}">`;
  m+=`<div class="field"><label>Nom *</label><input id="svc_name" value="${esc(svc?.name||pf.name||'')}" placeholder="Ex: Consultation initiale"></div>`;
  m+=`<div class="field" style="margin-bottom:0"><label>Description <span style="font-weight:400;color:var(--text-4)">(visible clients)</span></label><textarea id="svc_desc" rows="2" placeholder="Décrivez cette prestation...">${esc(svc?.description||'')}</textarea></div>`;
  m+=`</div>`;

  // ── SECTION 2: Tarification ──
  m+=sec('Tarification');
  const existingVars=svc?.variants||[];
  const hasVars=existingVars.length>0;
  const durVal=svc?.duration_min||pf.duration_min||30;
  const priceVal=svc?.price_cents?(svc.price_cents/100):(pf.price_cents?(pf.price_cents/100):'');
  m+=`<div id="svc_pricing_main"${hasVars?' style="display:none"':''}>`;
  m+=`<div class="svc-form-row" style="margin-bottom:12px"><div class="field"><label>Durée (min) *</label><input type="number" id="svc_dur" value="${durVal}" min="5" step="5"></div><div class="field"><label>Prix (€)</label><input type="number" id="svc_price" value="${priceVal}" step="0.01" placeholder="Gratuit si vide"></div><div class="field"><label>Label prix</label><input id="svc_plabel" value="${esc(svc?.price_label||'')}" placeholder="Sur devis..."></div></div>`;
  m+=`</div>`;
  m+=`<div style="margin-top:${hasVars?'0':'14'}px"><label style="display:block;font-size:.78rem;font-weight:600;color:var(--text-3);margin-bottom:8px">Variantes <span style="font-weight:400;color:var(--text-4)">(optionnel)</span></label>`;
  m+=`<div id="svc_variants_list">`;
  existingVars.forEach(v=>{m+=svcVarRowHTML(v);});
  m+=`</div>`;
  m+=`<button type="button" class="svc-var-add" onclick="svcAddVariant()">${PLUS_SVG} Ajouter une variante</button>`;
  m+=`</div>`;
  m+=`</div>`;

  // ── SECTION 3: Planification ──
  m+=sec('Planification');
  m+=`<div class="svc-form-row" id="svc_buffers_row" style="margin-bottom:14px"><div class="field"><label>Buffer avant (min)</label><input type="number" id="svc_bbefore" value="${svc?.buffer_before_min||0}" min="0"></div><div class="field"><label>Buffer après (min)</label><input type="number" id="svc_bafter" value="${svc?.buffer_after_min||0}" min="0"></div></div>`;
  const modes=svc?.mode_options||['cabinet'];
  const physicalOnlySectors=['coiffeur','esthetique','kine','dentiste','veterinaire'];
  const showModes=!physicalOnlySectors.includes(userSector);
  if(showModes){
    m+=`<div class="field"><label>Mode</label><div style="display:flex;gap:10px;margin-top:4px">
      <label class="svc-mode-opt"><input type="checkbox" id="svc_m_cab" ${modes.includes('cabinet')?'checked':''}> Cabinet</label>
      <label class="svc-mode-opt"><input type="checkbox" id="svc_m_vis" ${modes.includes('visio')?'checked':''}> Visio</label>
      <label class="svc-mode-opt"><input type="checkbox" id="svc_m_tel" ${modes.includes('phone')?'checked':''}> Tél.</label>
    </div></div>`;
  }
  const sched=svc?.available_schedule||null;
  const isRestricted=sched?.type==='restricted';
  m+=`<div class="field"><label class="svc-switch"><input type="checkbox" id="svc_sched_toggle" ${isRestricted?'checked':''} onchange="svcToggleSched()"><span class="svc-switch-track"></span> Restreindre les horaires</label>`;
  m+=`<div id="svc_sched_editor" class="svc-sched-editor"${isRestricted?'':' style="display:none"'}>`;
  const DAY_SHORTS=['L','M','M','J','V','S','D'];
  m+=`<div class="svc-day-bar">`;
  for(let d=0;d<7;d++){
    const dayW=isRestricted?(sched.windows||[]).filter(w=>w.day===d):[];
    m+=`<button type="button" class="svc-day-pill${dayW.length>0?' active':''}" data-day="${d}" onclick="svcDayPillClick(this)">${DAY_SHORTS[d]}</button>`;
  }
  m+=`</div>`;
  for(let d=0;d<7;d++){
    const dayW=isRestricted?(sched.windows||[]).filter(w=>w.day===d):[];
    const active=dayW.length>0;
    m+=`<div class="svc-sched-day" data-day="${d}"${active?'':' style="display:none"'}>`;
    m+=`<input type="checkbox" class="svc-sched-day-cb" ${active?'checked':''} style="display:none">`;
    m+=`<span class="svc-sched-day-name">${DAY_LABELS[d]}</span>`;
    m+=`<div class="svc-sched-windows">`;
    if(active){dayW.forEach(w=>{m+=`<div class="svc-sched-win"><input type="time" class="svc-sched-from" value="${w.from}"><span>—</span><input type="time" class="svc-sched-to" value="${w.to}"><button type="button" onclick="this.closest('.svc-sched-win').remove()" class="svc-sched-x">${X_SVG}</button></div>`;});}
    else{m+=`<div class="svc-sched-win" style="display:none"><input type="time" class="svc-sched-from" value="09:00"><span>—</span><input type="time" class="svc-sched-to" value="12:00"><button type="button" onclick="this.closest('.svc-sched-win').remove()" class="svc-sched-x">${X_SVG}</button></div>`;}
    m+=`</div><button type="button" onclick="svcSchedAddWin(this)" class="svc-sched-add">+</button></div>`;
  }
  m+=`</div></div>`;
  const isBookable=svc?svc.bookable_online!==false:true;
  m+=`<div class="field" style="margin-top:10px;margin-bottom:0"><label class="svc-switch"><input type="checkbox" id="svc_bookable_online" ${isBookable?'checked':''}><span class="svc-switch-track"></span> Réservable en ligne</label></div>`;
  m+=`</div>`;

  // ── SECTION 4: Affectation ──
  const assignedIds=svc?.practitioner_ids||[];
  if(allPractitioners.length>0){
    m+=sec('Affectation');
    m+=`<div class="field" style="margin-bottom:0"><label>Praticiens assignés</label><div class="section-hint" style="font-size:.72rem;color:var(--text-4);margin:2px 0 8px">Cliquez dans l'ordre de priorité</div>`;
    m+=`<div id="svc_practitioners" class="prac-priority${assignedIds.length>0?' has-selection':''}">`;
    allPractitioners.forEach(p=>{
      const rank=assignedIds.indexOf(p.id);
      const isSelected=rank>=0;
      const order=isSelected?rank+1:0;
      const rankClass=isSelected?` selected rank-${Math.min(order,4)}`:'';
      const initials=p.display_name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'??';
      m+=`<div class="prac-pill${rankClass}" data-pid="${p.id}"${isSelected?` data-order="${order}"`:''} onclick="svcTogglePrac(this)">`;
      m+=`<div class="prac-avatar" style="background:${p.color||'var(--primary)'}">${initials}</div>`;
      m+=`<span class="prac-name">${esc(p.display_name)}</span>`;
      m+=`<span class="prac-badge">${isSelected?order:''}</span>`;
      m+=`</div>`;
    });
    m+=`</div>`;
    m+=`<div style="font-size:.72rem;color:var(--text-4);margin-top:6px"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;vertical-align:-2px;margin-right:3px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>Si aucun sélectionné → disponible pour tous à égalité</div></div>`;
    m+=`</div>`;
  }

  m+=`</div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="saveService(${isEdit?"'"+svc.id+"'":'null'})">${isEdit?'Enregistrer':'Créer'}</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend',m);
}

// ===== PRACTITIONER PRIORITY =====

function svcTogglePrac(pill){
  const container=pill.closest('.prac-priority');
  const pills=[...container.querySelectorAll('.prac-pill')];
  if(pill.classList.contains('selected')){
    pill.classList.remove('selected');pill.removeAttribute('data-order');
  }else{
    const maxOrder=Math.max(0,...pills.filter(p=>p.dataset.order).map(p=>parseInt(p.dataset.order)));
    pill.classList.add('selected');pill.dataset.order=maxOrder+1;
  }
  // Recalculate sequential ranks
  const selected=pills.filter(p=>p.dataset.order).sort((a,b)=>parseInt(a.dataset.order)-parseInt(b.dataset.order));
  pills.forEach(p=>{p.classList.remove('rank-1','rank-2','rank-3','rank-4');p.querySelector('.prac-badge').textContent='';});
  selected.forEach((p,i)=>{const rank=i+1;p.dataset.order=rank;p.querySelector('.prac-badge').textContent=rank;p.classList.add('rank-'+Math.min(rank,4));});
  container.classList.toggle('has-selection',selected.length>0);
}

function svcGetPracOrder(){
  const pills=[...document.querySelectorAll('#svc_practitioners .prac-pill[data-order]')];
  return pills.sort((a,b)=>parseInt(a.dataset.order)-parseInt(b.dataset.order)).map(p=>p.dataset.pid);
}

// ===== SCHEDULE HELPERS =====

function svcToggleSched(){
  const ed=document.getElementById('svc_sched_editor');
  const cb=document.getElementById('svc_sched_toggle');
  if(ed)ed.style.display=cb?.checked?'block':'none';
}
function svcSchedDayToggle(cb){
  const day=cb.closest('.svc-sched-day');const wins=day.querySelectorAll('.svc-sched-win');
  if(cb.checked){if(wins.length===0||[...wins].every(w=>w.style.display==='none')){const hidden=[...wins].find(w=>w.style.display==='none');if(hidden)hidden.style.display='flex';else svcSchedAddWin(day.querySelector('button:last-child'));}wins.forEach(w=>{if(w.style.display==='none')w.style.display='flex';});}
  else{wins.forEach(w=>w.style.display='none');}
}
function svcSchedAddWin(btn){
  const day=btn.closest('.svc-sched-day');const container=day.querySelector('.svc-sched-windows');
  container.insertAdjacentHTML('beforeend',`<div class="svc-sched-win"><input type="time" class="svc-sched-from" value="09:00"><span>—</span><input type="time" class="svc-sched-to" value="12:00"><button type="button" onclick="this.closest('.svc-sched-win').remove()" class="svc-sched-x">×</button></div>`);
  const cb=day.querySelector('.svc-sched-day-cb');if(cb)cb.checked=true;
}
function buildScheduleFromEditor(){
  const toggle=document.getElementById('svc_sched_toggle');if(!toggle?.checked)return null;
  const windows=[];
  document.querySelectorAll('.svc-sched-day').forEach(dayEl=>{
    const day=parseInt(dayEl.dataset.day);const cb=dayEl.querySelector('.svc-sched-day-cb');if(!cb?.checked)return;
    dayEl.querySelectorAll('.svc-sched-win').forEach(winEl=>{
      if(winEl.style.display==='none')return;
      const from=winEl.querySelector('.svc-sched-from')?.value;const to=winEl.querySelector('.svc-sched-to')?.value;
      if(from&&to&&from<to)windows.push({day,from,to});
    });
  });
  if(windows.length===0){GendaUI.toast('Attention : aucun créneau défini','error');return null;}
  return{type:'restricted',windows};
}
function svcDayPillClick(btn){
  btn.classList.toggle('active');const d=btn.dataset.day;
  const dayEl=document.querySelector(`.svc-sched-day[data-day="${d}"]`);if(!dayEl)return;
  const cb=dayEl.querySelector('.svc-sched-day-cb');
  if(btn.classList.contains('active')){
    dayEl.style.display='flex';if(cb)cb.checked=true;
    const wins=dayEl.querySelectorAll('.svc-sched-win');
    if(wins.length===0||[...wins].every(w=>w.style.display==='none')){const hidden=[...wins].find(w=>w.style.display==='none');if(hidden)hidden.style.display='flex';else svcSchedAddWin(dayEl.querySelector('.svc-sched-add'));}
    wins.forEach(w=>{if(w.style.display==='none')w.style.display='flex';});
  }else{dayEl.style.display='none';if(cb)cb.checked=false;}
}

// ===== SAVE SERVICE =====

async function saveService(id){
  const physicalOnlySectors=['coiffeur','esthetique','kine','dentiste','veterinaire'];
  let modes;
  if(physicalOnlySectors.includes(userSector)){modes=['cabinet'];}
  else{modes=[];if(document.getElementById('svc_m_cab')?.checked)modes.push('cabinet');if(document.getElementById('svc_m_vis')?.checked)modes.push('visio');if(document.getElementById('svc_m_tel')?.checked)modes.push('phone');}
  const priceVal=document.getElementById('svc_price').value;
  const selectedCat=document.getElementById('svc_cat').value||null;
  const catColorVal=selectedCat&&catMeta[selectedCat]?.color?catMeta[selectedCat].color:null;
  const body={name:document.getElementById('svc_name').value,duration_min:parseInt(document.getElementById('svc_dur').value),price_cents:priceVal?Math.round(parseFloat(priceVal)*100):null,price_label:document.getElementById('svc_plabel').value||null,buffer_before_min:parseInt(document.getElementById('svc_bbefore').value)||0,buffer_after_min:parseInt(document.getElementById('svc_bafter').value)||0,category:selectedCat,color:catColorVal||'#1E3A8A',mode_options:modes.length?modes:['cabinet'],practitioner_ids:svcGetPracOrder()};
  body.description=document.getElementById('svc_desc')?.value.trim()||null;
  body.bookable_online=document.getElementById('svc_bookable_online').checked;
  body.available_schedule=buildScheduleFromEditor();
  // Duplicate check: same name + same category (exclude current service if editing)
  const dupName=body.name.trim().toLowerCase();
  const dupCat=(body.category||'').toLowerCase();
  const dup=allServices.find(s=>s.name.trim().toLowerCase()===dupName&&(s.category||'').toLowerCase()===dupCat&&s.is_active!==false&&s.id!==id);
  if(dup){GendaUI.toast('Une prestation avec ce nom existe déjà dans cette catégorie','error');return;}
  const varRows=document.querySelectorAll('#svc_variants_list .svc-var-row');
  body.variants=[...varRows].map(row=>({id:row.querySelector('.svc-var-id').value||undefined,name:row.querySelector('.svc-var-name').value.trim(),duration_min:parseInt(row.querySelector('.svc-var-dur').value)||0,price_cents:row.querySelector('.svc-var-price').value?Math.round(parseFloat(row.querySelector('.svc-var-price').value)*100):null,description:row.querySelector('.svc-var-desc')?.value.trim()||null})).filter(v=>v.name&&v.duration_min>0);
  try{
    const url=id?`/api/services/${id}`:'/api/services';const method=id?'PATCH':'POST';
    const r=await fetch(url,{method,headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);
    document.querySelector('.modal-overlay')?.remove();
    GendaUI.toast(id?categoryLabels.service+' modifiée':categoryLabels.service+' créée','success');loadServices();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// ===== SERVICE CRUD =====

async function deactivateService(id){
  try{const r=await fetch(`/api/services/${id}/deactivate`,{method:'PATCH',headers:{'Authorization':'Bearer '+api.getToken()}});if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast(categoryLabels.service+' désactivée','success');loadServices();}catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}
async function reactivateService(id){
  try{const r=await fetch(`/api/services/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({is_active:true})});if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast(categoryLabels.service+' réactivée','success');loadServices();}catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}
async function deleteService(id){
  try{const r=await fetch(`/api/services/${id}`,{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast(categoryLabels.service+' supprimée','success');loadServices();}catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// ===== VARIANT ROW (in modal) =====

function svcVarRowHTML(v){
  return `<div class="svc-var-row">
    <div class="svc-var-top-row">
      <input class="svc-var-name" value="${v?esc(v.name):''}" placeholder="Nom de la variante">
      <div class="svc-var-field"><span class="svc-var-label">Durée</span><input type="number" class="svc-var-dur" value="${v?v.duration_min:''}" min="5" step="5" placeholder="min"></div>
      <div class="svc-var-field"><span class="svc-var-label">Prix</span><input type="number" class="svc-var-price" value="${v&&v.price_cents?(v.price_cents/100):''}" step="0.01" placeholder="€"></div>
      <button type="button" onclick="svcRemoveVariant(this)" class="svc-var-x">${X_SVG}</button>
    </div>
    <input class="svc-var-desc" value="${v?esc(v.description||''):''}" placeholder="Description (optionnel)">
    <input type="hidden" class="svc-var-id" value="${v?.id||''}">
  </div>`;
}
function svcAddVariant(){document.getElementById('svc_variants_list').insertAdjacentHTML('beforeend',svcVarRowHTML(null));svcUpdatePricingVis();}
function svcRemoveVariant(btn){btn.closest('.svc-var-row').remove();svcUpdatePricingVis();}
function svcUpdatePricingVis(){
  const n=document.querySelectorAll('#svc_variants_list .svc-var-row').length;
  const p=document.getElementById('svc_pricing_main');
  if(p)p.style.display=n>0?'none':'';
}

// ===== QUICK START WIZARD =====

const checkSvg='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
const defaultIcon='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="24" height="24"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>';
let qsGroups=[], qsSelectedCats=new Set(), qsOverlay=null;

async function openQuickStart(){
  try{
    const r=await fetch('/api/business/service-templates',{headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error('Erreur chargement');
    const data=await r.json();qsGroups=data.groups||[];
    if(!qsGroups.length){GendaUI.toast('Aucun template pour votre secteur','info');return;}
    qsSelectedCats=new Set(qsGroups.map(g=>g.category));qsRenderStep1();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function qsRenderStep1(){
  const svcsLabel=categoryLabels.services.toLowerCase();
  let m=`<div class="modal-overlay qs-overlay"><div class="modal qs-modal">
    <div class="qs-progress"><div class="qs-step active">1</div><div class="qs-line"></div><div class="qs-step">2</div></div>
    <div class="modal-h"><h3>Choisissez vos catégories</h3><button class="close" onclick="this.closest('.modal-overlay').remove()">${X_SVG}</button></div>
    <div class="modal-body"><p class="qs-subtitle">Décochez les catégories qui ne vous concernent pas</p><div class="qs-cat-grid">`;
  qsGroups.forEach(g=>{
    const sel=qsSelectedCats.has(g.category);
    m+=`<div class="qs-cat-card${sel?' selected':''}" data-cat="${g.category}" onclick="qsToggleCat(this)">
      <div class="qs-cat-check">${checkSvg}</div><div class="qs-cat-icon">${g.icon_svg||defaultIcon}</div>
      <div class="qs-cat-label">${g.category}</div><div class="qs-cat-count">${g.templates.length} ${svcsLabel}</div></div>`;
  });
  m+=`</div></div><div class="modal-foot"><span class="qs-count" id="qsCatCount"><strong>${qsSelectedCats.size}</strong> catégories sélectionnées</span><button class="btn-primary" onclick="qsGoStep2()" id="qsNextBtn">Continuer →</button></div></div></div>`;
  document.querySelector('.qs-overlay')?.remove();
  document.body.insertAdjacentHTML('beforeend',m);
  qsOverlay=document.querySelector('.qs-overlay');
}

function qsToggleCat(el){
  const cat=el.dataset.cat;
  if(qsSelectedCats.has(cat)){qsSelectedCats.delete(cat);el.classList.remove('selected');}
  else{qsSelectedCats.add(cat);el.classList.add('selected');}
  const cnt=document.getElementById('qsCatCount');if(cnt)cnt.innerHTML=`<strong>${qsSelectedCats.size}</strong> catégories sélectionnées`;
}

function qsGoStep2(){
  if(qsSelectedCats.size===0){GendaUI.toast('Sélectionnez au moins une catégorie','error');return;}
  const modal=qsOverlay?.querySelector('.qs-modal');if(!modal)return;
  const svcsLabel=categoryLabels.services.toLowerCase(),svcLabel=categoryLabels.service.toLowerCase();
  const steps=modal.querySelectorAll('.qs-step');const line=modal.querySelector('.qs-line');
  if(steps[0])steps[0].classList.replace('active','done');if(line)line.classList.add('done');if(steps[1])steps[1].classList.add('active');
  modal.querySelector('.modal-h h3').textContent='Ajustez vos prestations';
  const durations=[15,30,45,60,90,120];
  let body=`<p class="qs-subtitle">Modifiez les noms, durées et prix selon votre carte</p>`;
  const existingNames=new Set(allServices.map(s=>(s.name||'').trim().toLowerCase()));
  const selectedGroups=qsGroups.filter(g=>qsSelectedCats.has(g.category));
  selectedGroups.forEach(g=>{
    body+=`<div class="qs-cat-section"><div class="qs-cat-header">${g.icon_svg||defaultIcon}<h4>${g.category}</h4><span class="qs-cat-badge">${g.templates.length}</span></div>`;
    g.templates.forEach(t=>{
      const price=t.suggested_price_cents?Math.round(t.suggested_price_cents/100):'';
      const dur=t.suggested_duration_min||30;
      const alreadyExists=existingNames.has((t.name||'').trim().toLowerCase());
      body+=`<div class="qs-tpl-row${alreadyExists?' unchecked':''}" data-category="${g.category}">
        <input type="checkbox" class="qs-tpl-check" ${alreadyExists?'':'checked'} onchange="qsToggleTpl(this)">
        <input class="qs-tpl-name" value="${t.name}">${alreadyExists?'<span style="font-size:.68rem;color:var(--orange,#e65100);font-weight:500;white-space:nowrap">déjà créée</span>':''}
        <div class="qs-dur-chips">`;
      durations.forEach(d=>{body+=`<span class="qs-dur-chip${d===dur?' active':''}" onclick="qsDur(this,${d})">${d}</span>`;});
      body+=`</div><input type="hidden" class="qs-tpl-dur" value="${dur}">
        <div class="qs-price-wrap"><input type="number" class="qs-tpl-price" value="${price}" step="1" min="0"><span>€</span></div></div>`;
    });
    const safeCatQs=jsAttr(g.category);
    body+=`<button type="button" class="qs-add-row" onclick="qsAddCustomRow(this,'${safeCatQs}')" title="Ajouter">${PLUS_SVG}</button></div>`;
  });
  modal.querySelector('.modal-body').innerHTML=body;
  const totalTpl=selectedGroups.reduce((s,g)=>s+g.templates.length,0);
  modal.querySelector('.modal-foot').innerHTML=`
    <button class="qs-back" onclick="qsBack()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg> Retour</button>
    <span class="qs-count" id="qsTplCount"><strong>${totalTpl}</strong> ${svcsLabel}</span>
    <button class="btn-primary qs-submit" onclick="qsSubmitAll()" id="qsSubmitBtn">Créer ${totalTpl} ${totalTpl>1?svcsLabel:svcLabel}</button>`;
  modal.querySelector('.modal-foot').style.alignItems='center';
  qsUpdateCount();
}

function qsBack(){qsRenderStep1();}
function qsDur(el,val){const row=el.closest('.qs-tpl-row');row.querySelectorAll('.qs-dur-chip').forEach(c=>c.classList.remove('active'));el.classList.add('active');row.querySelector('.qs-tpl-dur').value=val;}
function qsToggleTpl(cb){cb.closest('.qs-tpl-row').classList.toggle('unchecked',!cb.checked);qsUpdateCount();}

function qsAddCustomRow(btn,cat){
  const durations=[15,30,45,60,90,120];
  let row=`<div class="qs-tpl-row" data-category="${cat}"><input type="checkbox" class="qs-tpl-check" checked onchange="qsToggleTpl(this)"><input class="qs-tpl-name" value="" placeholder="Nom de la prestation"><div class="qs-dur-chips">`;
  durations.forEach(d=>{row+=`<span class="qs-dur-chip${d===30?' active':''}" onclick="qsDur(this,${d})">${d}</span>`;});
  row+=`</div><input type="hidden" class="qs-tpl-dur" value="30"><div class="qs-price-wrap"><input type="number" class="qs-tpl-price" value="" step="1" min="0" placeholder="0"><span>€</span></div></div>`;
  btn.insertAdjacentHTML('beforebegin',row);
  const section=btn.closest('.qs-cat-section');const badge=section?.querySelector('.qs-cat-badge');
  if(badge)badge.textContent=section.querySelectorAll('.qs-tpl-row').length;
  qsUpdateCount();btn.previousElementSibling?.querySelector('.qs-tpl-name')?.focus();
}

function qsUpdateCount(){
  const checked=document.querySelectorAll('.qs-tpl-row:not(.unchecked)').length;
  const svcsLabel=categoryLabels.services.toLowerCase(),svcLabel=categoryLabels.service.toLowerCase();
  const cnt=document.getElementById('qsTplCount');if(cnt)cnt.innerHTML=`<strong>${checked}</strong> ${svcsLabel}`;
  const btn=document.getElementById('qsSubmitBtn');if(btn){btn.textContent=`Créer ${checked} ${checked>1?svcsLabel:svcLabel}`;btn.disabled=checked===0;}
}

async function qsSubmitAll(){
  const rows=document.querySelectorAll('.qs-tpl-row:not(.unchecked)');const toCreate=[];
  rows.forEach(row=>{
    const name=row.querySelector('.qs-tpl-name').value.trim();if(!name)return;
    const cat=row.dataset.category;const dur=parseInt(row.querySelector('.qs-tpl-dur').value)||30;
    const priceVal=parseFloat(row.querySelector('.qs-tpl-price').value);const pIds=allPractitioners.map(p=>p.id);
    toCreate.push({name,category:cat,duration_min:dur,price_cents:priceVal?Math.round(priceVal*100):null,buffer_before_min:0,buffer_after_min:0,mode_options:['cabinet'],color:catMeta[cat]?.color||catColor(cat),practitioner_ids:pIds});
  });
  if(!toCreate.length){GendaUI.toast('Sélectionnez au moins une prestation','error');return;}
  const btn=document.getElementById('qsSubmitBtn');const svcsLabel=categoryLabels.services.toLowerCase();
  btn.disabled=true;let created=0,errors=0;
  for(let i=0;i<toCreate.length;i++){
    btn.textContent=`Création ${i+1}/${toCreate.length}...`;
    try{const r=await fetch('/api/services',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(toCreate[i])});if(r.ok)created++;else errors++;}catch(e){errors++;}
  }
  document.querySelector('.qs-overlay')?.remove();
  GendaUI.toast(`${created} ${svcsLabel} créées !`,'success');
  if(errors>0)GendaUI.toast(`${errors} erreur(s)`,'error');
  loadServices();
}

// ===== BRIDGE =====

bridge({ loadServices, openServiceModal, saveService, deactivateService, reactivateService, deleteService, openQuickStart, qsToggleCat, qsGoStep2, qsBack, qsDur, qsToggleTpl, qsAddCustomRow, qsSubmitAll, qsUpdateCount, svcAddVariant, svcRemoveVariant, svcVarRowHTML, svcUpdatePricingVis, svcToggleSection, svcDeleteCategory, svcAddFromTemplate, svcPickTemplate, svcToggleSched, svcSchedDayToggle, svcSchedAddWin, svcDayPillClick, openCategoryModal, saveCategory, svcDragStart, svcDragOver, svcDragLeave, svcDrop, svcTogglePrac });

export { loadServices, openServiceModal, saveService, deactivateService, reactivateService, deleteService, openQuickStart };
