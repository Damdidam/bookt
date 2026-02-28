/**
 * Documents (Documents pré-RDV) view module.
 * Also contains calendar sync functions used by team.js.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

let _docFieldIdx=0;

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function loadDocuments(){
  const c=document.getElementById('contentArea');
  c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try{
    const[tRes,sRes]=await Promise.all([api.get('/api/documents'),api.get('/api/services')]);
    const templates=tRes.templates||[];
    const services=sRes.services||sRes||[];
    let h='';

    h+=`<div class="card" style="padding:18px 22px;background:var(--primary-light);border:1px solid var(--primary-soft)">
      <p style="font-size:.85rem;color:var(--text-2);margin:0">
        <strong><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Documents pré-rendez-vous</strong> — Créez des fiches d'information, formulaires d'anamnèse ou consentements éclairés. Envoi automatique par email J-2 (configurable) aux clients ayant un RDV confirmé.</p>
    </div>`;

    h+=`<div style="display:flex;gap:10px;margin:14px 0;flex-wrap:wrap">
      <button onclick="openDocModal('info')" style="padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius-xs);font-size:.8rem;font-weight:600;cursor:pointer">+ Fiche d'info</button>
      <button onclick="openDocModal('form')" style="padding:8px 16px;background:var(--gold);color:#fff;border:none;border-radius:var(--radius-xs);font-size:.8rem;font-weight:600;cursor:pointer">+ Formulaire</button>
      <button onclick="openDocModal('consent')" style="padding:8px 16px;background:var(--red);color:#fff;border:none;border-radius:var(--radius-xs);font-size:.8rem;font-weight:600;cursor:pointer">+ Consentement</button>
    </div>`;

    if(templates.length===0){
      h+=`<div class="card"><div class="empty" style="padding:40px">Aucun document configuré. Créez votre premier template !</div></div>`;
    }else{
      h+=`<div style="display:grid;gap:12px">`;
      templates.forEach(t=>{
        const typeLabels={info:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg> Info',form:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Formulaire',consent:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Consentement'};
        const typeBg={info:'var(--primary-light)',form:'var(--gold-bg)',consent:'var(--red-bg)'};
        const typeColor={info:'var(--primary)',form:'var(--gold)',consent:'var(--red)'};
        const fields=t.form_fields||[];
        h+=`<div class="card" style="padding:0;overflow:hidden">
          <div style="display:flex;align-items:center;gap:14px;padding:16px 20px">
            <div style="width:42px;height:42px;border-radius:10px;background:${typeBg[t.type]};display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0">
              ${t.type==='info'?'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>':t.type==='form'?'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>'}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:.92rem;font-weight:700;color:var(--text)">${esc(t.name)}</div>
              <div style="font-size:.75rem;color:var(--text-3);margin-top:2px">
                <span style="padding:2px 6px;border-radius:6px;background:${typeBg[t.type]};color:${typeColor[t.type]};font-weight:600;font-size:.68rem">${typeLabels[t.type]||t.type}</span>
                ${t.service_name?` \u00b7 ${esc(t.service_name)}`:' \u00b7 Toutes prestations'}
                \u00b7 J-${t.send_days_before}
                ${fields.length>0?` \u00b7 ${fields.length} champ${fields.length>1?'s':''}`:''}
              </div>
            </div>
            <div style="text-align:right">
              <span style="font-size:.72rem;color:${t.is_active?'var(--green)':'var(--text-4)'};font-weight:600">${t.is_active?'Actif':'Inactif'}</span>
              <div style="font-size:.68rem;color:var(--text-4)">${t.sends_count||0} envois \u00b7 ${t.completed_count||0} complétés</div>
            </div>
          </div>
          <div style="border-top:1px solid var(--border-light);padding:8px 20px;display:flex;gap:8px;justify-content:flex-end">
            <button onclick="openDocModal('${t.type}','${t.id}')" style="font-size:.78rem;padding:5px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Modifier</button>
            <button onclick="toggleDocActive('${t.id}',${!t.is_active})" style="font-size:.78rem;padding:5px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);cursor:pointer">${t.is_active?'\u23f8 Désactiver':'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Activer'}</button>
            <button onclick="deleteDoc('${t.id}')" style="font-size:.78rem;padding:5px 12px;background:var(--red-bg);border:1px solid #F5C6C6;border-radius:var(--radius-xs);cursor:pointer;color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>
          </div>
        </div>`;
      });
      h+=`</div>`;
    }
    c.innerHTML=h;
    window._docServices=services;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

async function openDocModal(type,editId){
  let existing=null;
  if(editId){try{const r=await api.get('/api/documents');existing=(r.templates||[]).find(t=>t.id===editId);}catch(e){}}
  const services=window._docServices||[];
  const isEdit=!!existing;
  const title=isEdit?'Modifier le document':type==='info'?"Nouvelle fiche d'info":type==='form'?'Nouveau formulaire':'Nouveau consentement';
  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100;display:flex;align-items:center;justify-content:center';
  modal.innerHTML=`<div style="background:var(--white);border-radius:var(--radius);padding:28px;width:620px;max-width:95vw;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
      <h3 style="font-size:1.1rem;font-weight:700;margin:0">${title}</h3>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer">&times;</button>
    </div>
    <div style="display:grid;gap:12px">
      <div><label style="font-size:.75rem;font-weight:600;color:var(--text-3);text-transform:uppercase;display:block;margin-bottom:4px">Nom du document *</label>
        <input id="docName" value="${esc(existing?.name||'')}" placeholder="Ex: Fiche anamn&egrave;se premi&egrave;re consultation" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label style="font-size:.75rem;font-weight:600;color:var(--text-3);text-transform:uppercase;display:block;margin-bottom:4px">Prestation li&eacute;e</label>
          <select id="docService" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem">
            <option value="">Toutes les prestations</option>
            ${services.map(s=>`<option value="${s.id}" ${existing?.service_id===s.id?'selected':''}>${esc(s.name)}</option>`).join('')}
          </select></div>
        <div><label style="font-size:.75rem;font-weight:600;color:var(--text-3);text-transform:uppercase;display:block;margin-bottom:4px">Envoyer J-</label>
          <input id="docDays" type="number" min="1" max="14" value="${existing?.send_days_before||2}" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem">
          <div style="font-size:.68rem;color:var(--text-4);margin-top:2px">Jours avant le RDV</div></div>
      </div>
      <div><label style="font-size:.75rem;font-weight:600;color:var(--text-3);text-transform:uppercase;display:block;margin-bottom:4px">Objet email (optionnel)</label>
        <input id="docSubject" value="${esc(existing?.subject||'')}" placeholder="Par d&eacute;faut: nom du document + nom du cabinet" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem"></div>
      <div><label style="font-size:.75rem;font-weight:600;color:var(--text-3);text-transform:uppercase;display:block;margin-bottom:4px">Contenu *</label>
        <textarea id="docContent" rows="6" style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;resize:vertical;font-family:inherit">${esc(existing?.content_html||'')}</textarea>
        <div style="font-size:.68rem;color:var(--text-4);margin-top:2px">HTML accept&eacute; : h2, p, ul, li, strong</div></div>
      ${type!=='info'?`<div><label style="font-size:.75rem;font-weight:600;color:var(--text-3);text-transform:uppercase;display:block;margin-bottom:6px">Champs du formulaire</label>
        <div id="docFields"></div>
        <button onclick="addDocField()" style="margin-top:6px;padding:6px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem;cursor:pointer">+ Ajouter un champ</button></div>`:''}
    </div>
    <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px">
      <button onclick="this.closest('div[style*=fixed]').remove()" style="padding:9px 18px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;cursor:pointer">Annuler</button>
      <button onclick="saveDoc('${type}','${editId||''}')" style="padding:9px 22px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius-xs);font-size:.82rem;font-weight:600;cursor:pointer">${isEdit?'Enregistrer':'Cr&eacute;er'}</button>
    </div></div>`;
  document.body.appendChild(modal);
  if(type!=='info'&&existing?.form_fields?.length>0){existing.form_fields.forEach(f=>addDocField(f));}
}

function addDocField(preset){
  const container=document.getElementById('docFields');if(!container)return;
  const idx=_docFieldIdx++;const fid=preset?.id||('f'+idx);
  const row=document.createElement('div');
  row.style.cssText='display:grid;grid-template-columns:1fr 120px 30px 30px;gap:6px;align-items:center;margin-bottom:6px';
  row.innerHTML=`<input class="df-label" value="${esc(preset?.label||'')}" placeholder="Libell&eacute; du champ" data-fid="${fid}" style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <select class="df-type" style="padding:7px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
      <option value="text" ${preset?.type==='text'?'selected':''}>Texte</option>
      <option value="textarea" ${preset?.type==='textarea'?'selected':''}>Zone texte</option>
      <option value="checkbox" ${preset?.type==='checkbox'?'selected':''}>Case</option>
      <option value="select" ${preset?.type==='select'?'selected':''}>Choix</option>
      <option value="date" ${preset?.type==='date'?'selected':''}>Date</option>
      <option value="email" ${preset?.type==='email'?'selected':''}>Email</option>
      <option value="phone" ${preset?.type==='phone'?'selected':''}>T&eacute;l</option>
    </select>
    <label style="font-size:.7rem;color:var(--text-4);display:flex;align-items:center;gap:3px;cursor:pointer"><input type="checkbox" class="df-req" ${preset?.required?'checked':''} style="width:14px;height:14px">*</label>
    <button onclick="this.parentElement.remove()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem">&times;</button>`;
  container.appendChild(row);
}

function collectDocFields(){
  const container=document.getElementById('docFields');if(!container)return[];
  const fields=[];
  container.querySelectorAll(':scope > div').forEach(row=>{
    const label=row.querySelector('.df-label')?.value?.trim();
    const type=row.querySelector('.df-type')?.value||'text';
    const required=row.querySelector('.df-req')?.checked||false;
    const fid=row.querySelector('.df-label')?.dataset.fid||('f'+Math.random().toString(36).slice(2,6));
    if(label)fields.push({id:fid,label,type,required});
  });
  return fields;
}

async function saveDoc(type,editId){
  const name=document.getElementById('docName')?.value?.trim();
  const content_html=document.getElementById('docContent')?.value?.trim();
  if(!name){GendaUI.toast('Nom requis','error');return;}
  if(!content_html){GendaUI.toast('Contenu requis','error');return;}
  const body={name,type,service_id:document.getElementById('docService')?.value||null,
    subject:document.getElementById('docSubject')?.value?.trim()||null,content_html,
    send_days_before:parseInt(document.getElementById('docDays')?.value||2),
    form_fields:type!=='info'?collectDocFields():[]};
  try{
    if(editId){await api.patch(`/api/documents/${editId}`,body);}
    else{await api.post('/api/documents',body);}
    document.querySelector('div[style*="position:fixed"][style*="inset:0"]')?.remove();
    GendaUI.toast(editId?'Document modifi\u00e9':'Document cr\u00e9\u00e9 !','success');loadDocuments();
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function toggleDocActive(id,active){
  try{await api.patch(`/api/documents/${id}`,{is_active:active});GendaUI.toast(active?'Activ\u00e9':'D\u00e9sactiv\u00e9','success');loadDocuments();}catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function deleteDoc(id){
  if(!confirm('Supprimer ce document ?'))return;
  try{await api.delete(`/api/documents/${id}`);GendaUI.toast('Supprim\u00e9','success');loadDocuments();}catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

// ============================================================
// CALENDAR SYNC (per practitioner)
// ============================================================
async function loadPracCalSync(pracId){
  const area=document.getElementById('p_cal_area');
  if(!area)return;
  try{
    const r=await fetch(`/api/calendar/connections?practitioner_id=${pracId}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=r.ok?await r.json():{connections:[]};
    const conns=d.connections||[];
    const gConn=conns.find(c=>c.provider==='google');
    const oConn=conns.find(c=>c.provider==='outlook');
    const iConn=conns.find(c=>c.provider==='ical');

    let h=`<div style="display:grid;gap:8px">`;

    // Google
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Google Calendar</div>
          ${gConn?`<div style="font-size:.68rem;color:var(--green)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${esc(gConn.email||'Connecté')}${gConn.last_sync_at?' \u00b7 '+new Date(gConn.last_sync_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}</div>`
          :`<div style="font-size:.68rem;color:var(--text-4)">Non connecté</div>`}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        ${gConn?`
          <button onclick="syncCalendar('${gConn.id}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          <button onclick="disconnectCalendar('${gConn.id}','google','${pracId}')" class="btn-outline btn-sm btn-danger" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        `:`<button onclick="connectCalendar('google','${pracId}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">Connecter</button>`}
      </div>
    </div>`;

    // Outlook
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Outlook</div>
          ${oConn?`<div style="font-size:.68rem;color:var(--green)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${esc(oConn.email||'Connecté')}${oConn.last_sync_at?' \u00b7 '+new Date(oConn.last_sync_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):''}</div>`
          :`<div style="font-size:.68rem;color:var(--text-4)">Non connecté</div>`}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        ${oConn?`
          <button onclick="syncCalendar('${oConn.id}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          <button onclick="disconnectCalendar('${oConn.id}','outlook','${pracId}')" class="btn-outline btn-sm btn-danger" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        `:`<button onclick="connectCalendar('outlook','${pracId}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">Connecter</button>`}
      </div>
    </div>`;

    // iCal
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Apple / iCal</div>
          <div style="font-size:.68rem;color:var(--text-4)">URL d'abonnement</div>
        </div>
      </div>
      <button onclick="generateIcalFeed('${pracId}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">${iConn?'Regénérer':'Générer'}</button>
    </div>`;

    h+=`</div>`;
    h+=`<div id="p_ical_url" style="display:none;margin-top:8px"></div>`;

    // Sync direction (if any connection exists)
    if(gConn||oConn){
      const dir=(gConn||oConn).sync_direction||'both';
      h+=`<div style="margin-top:10px;display:flex;align-items:center;gap:8px;font-size:.78rem">
        <span style="color:var(--text-3)">Direction :</span>
        <select onchange="updateCalSyncDirection(this.value,'${pracId}')" style="padding:3px 8px;border:1px solid var(--border);border-radius:4px;font-size:.75rem">
          <option value="both"${dir==='both'?' selected':''}><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 11 21 7 17 3"/><line x1="21" y1="7" x2="9" y2="7"/><polyline points="7 21 3 17 7 13"/><line x1="15" y1="17" x2="3" y2="17"/></svg> Bidirectionnelle</option>
          <option value="push"${dir==='push'?' selected':''}>\u2192 Push (Genda \u2192 Cal)</option>
          <option value="pull"${dir==='pull'?' selected':''}>\u2190 Pull (Cal \u2192 Genda)</option>
        </select>
      </div>`;
    }

    area.innerHTML=h;
  }catch(e){
    area.innerHTML=`<div style="font-size:.78rem;color:var(--text-4)">Impossible de charger les connexions calendrier.</div>`;
  }
}

async function connectCalendar(provider,pracId){
  try{
    const r=await api.get(`/api/calendar/${provider}/connect?practitioner_id=${pracId||''}`);
    if(r.url)window.location.href=r.url;
    else GendaUI.toast('Erreur de connexion','error');
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function disconnectCalendar(connId,provider,pracId){
  if(!confirm('Déconnecter '+(provider==='google'?'Google Calendar':'Outlook')+' ?'))return;
  try{
    await api.delete(`/api/calendar/connections/${connId}`);
    GendaUI.toast('Calendrier déconnecté','success');
    if(pracId)loadPracCalSync(pracId);
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function syncCalendar(connId){
  try{
    GendaUI.toast('Synchronisation en cours...','info');
    const r=await api.post(`/api/calendar/connections/${connId}/sync`);
    GendaUI.toast('Synchro terminée : '+(r.pushed||0)+' poussés, '+(r.pulled||0)+' récupérés','success');
  }catch(e){GendaUI.toast(e.message||'Erreur synchro','error');}
}

async function updateCalSyncDirection(direction,pracId){
  try{
    const r=await fetch(`/api/calendar/connections?practitioner_id=${pracId}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=r.ok?await r.json():{connections:[]};
    for(const c of (d.connections||[])){
      if(c.provider!=='ical')await api.patch('/api/calendar/connections/'+c.id,{sync_direction:direction});
    }
    GendaUI.toast('Direction de synchro mise à jour','success');
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function generateIcalFeed(pracId){
  try{
    const r=await fetch('/api/calendar/ical/generate',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({practitioner_id:pracId||null})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Erreur');
    const el=document.getElementById('p_ical_url');
    if(!el)return;
    el.style.display='block';
    el.innerHTML=`
      <div style="padding:10px 12px;background:var(--white);border:1px solid var(--border-light);border-radius:6px">
        <div style="font-family:monospace;font-size:.68rem;word-break:break-all;user-select:all;cursor:text;color:var(--text-2);margin-bottom:6px">${d.ical_url}</div>
        <div style="display:flex;gap:6px">
          <button onclick="navigator.clipboard.writeText('${d.ical_url}');GendaUI.toast('URL copiée !','success')" class="btn-outline btn-sm" style="font-size:.7rem;padding:3px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Copier</button>
          <a href="${d.webcal_url}" class="btn-outline btn-sm" style="font-size:.7rem;padding:3px 10px;text-decoration:none;color:var(--primary)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg> Ouvrir</a>
        </div>
      </div>`;
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

// Handle OAuth callback params on page load
(function(){
  const p=new URLSearchParams(location.search);
  if(p.get('cal_connected')){
    const prov=p.get('cal_connected')==='google'?'Google Calendar':'Outlook';
    setTimeout(function(){GendaUI.toast(prov+' connecté avec succès !','success');},500);
    history.replaceState(null,'','/dashboard');
    // Navigate to Team section where calendar sync now lives
    setTimeout(function(){
      document.querySelectorAll('.ni').forEach(function(n){n.classList.remove('active');});
      var el=document.querySelector('[data-section="team"]');if(el)el.classList.add('active');
      document.getElementById('pageTitle').textContent='Équipe';
      // loadTeam is bridged from team.js
      if(window.loadTeam) window.loadTeam();
    },600);
  }
  if(p.get('cal_error')){
    setTimeout(function(){GendaUI.toast('Erreur calendrier: '+p.get('cal_error'),'error');},500);
    history.replaceState(null,'','/dashboard');
  }
})();

bridge({ loadDocuments, openDocModal, addDocField, saveDoc, toggleDocActive, deleteDoc, loadPracCalSync, connectCalendar, disconnectCalendar, syncCalendar, updateCalSyncDirection, generateIcalFeed });

export { loadDocuments, openDocModal, addDocField, saveDoc, toggleDocActive, deleteDoc, loadPracCalSync, connectCalendar, disconnectCalendar, syncCalendar, updateCalSyncDirection, generateIcalFeed };
