/**
 * Passes (Abonnements) view module — staff dashboard management.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { guardModal, showConfirmDialog } from '../utils/dirty-guard.js';

let passFilter='all', passSearch='';
let _lastPasses=[];

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmtEur(cents){return((cents||0)/100).toFixed(2).replace('.',',')+' €';}

export async function loadPasses(){
  const c=document.getElementById('contentArea');
  c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try{
    const params=new URLSearchParams();
    if(passFilter!=='all')params.set('status',passFilter);
    if(passSearch.trim())params.set('search',passSearch.trim());
    const data=await api.get(`/api/passes?${params}`);
    const passes=data.passes||[];
    _lastPasses=passes;
    const st=data.stats||{};
    renderPasses(c,passes,st);
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;}
}

function renderPasses(c,passes,st){
  passes=passes||_lastPasses;
  st=st||{};
  let h='';

  // ── KPI CARDS ──
  h+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat-card"><div class="label">Total vendus</div><div class="val" style="color:var(--primary)">${st.total_sessions_sold||0} séances</div><div class="sub">${st.total_count||0} passes</div></div>
    <div class="stat-card"><div class="label">Séances restantes</div><div class="val" style="color:var(--gold)">${st.total_sessions_remaining||0}</div><div class="sub">non utilisées</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="passFilter='active';loadPasses()"><div class="label">Passes actifs</div><div class="val" style="color:var(--green)">${st.active_count||0}</div><div class="sub">en circulation</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="passFilter='used';loadPasses()"><div class="label">Passes utilisés</div><div class="val" style="color:var(--text-3)">${st.used_count||0}</div><div class="sub">séances épuisées</div></div>
  </div>`;

  // ── FILTER BAR ──
  const filters=[
    {v:'all',l:'Tous'},
    {v:'active',l:'Actifs'},
    {v:'used',l:'Utilisés'},
    {v:'expired',l:'Expirés'},
    {v:'cancelled',l:'Annulés'}
  ];
  const filterBtns=filters.map(f=>{
    const active=passFilter===f.v;
    return `<button onclick="passFilter='${f.v}';loadPasses()" class="btn-sm${active?' active':''}">${f.l}</button>`;
  }).join('');

  h+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    ${filterBtns}
    <div style="flex:1"></div>
    <input type="text" placeholder="Rechercher par code ou nom..." value="${esc(passSearch)}" onkeydown="if(event.key==='Enter'){passSearch=this.value;loadPasses()}" onblur="passSearchInput(this.value)" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem;min-width:200px">
    <button onclick="openCreatePass()" class="btn-primary"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Créer un pass</button>
  </div>`;

  // ── TABLE ──
  if(passes.length===0){
    h+=`<div class="card"><div class="empty">Aucun pass trouvé.</div></div>`;
  }else{
    h+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Code</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Prestation</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Séances</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Expiration</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`;

    const statusColors={active:'var(--green)',used:'var(--text-3)',expired:'var(--gold)',cancelled:'var(--red)'};
    const statusLabels={active:'Actif',used:'Utilisé',expired:'Expiré',cancelled:'Annulé'};

    passes.forEach(p=>{
      const sc=statusColors[p.status]||'var(--text-4)';
      const expiresDate=p.expires_at?new Date(p.expires_at).toLocaleDateString('fr-BE'):'—';
      const buyerName=p.buyer_name||'—';
      const buyerEmail=p.buyer_email||'';
      const serviceName=p.service_name||'—';
      const isActive=p.status==='active';
      const sessionsRemaining=parseInt(p.sessions_remaining||0);
      const sessionsTotal=parseInt(p.sessions_total||0);

      let actions='';
      if(isActive){
        actions+=`<button onclick="openDebitPass('${p.id}')" title="Débiter 1 séance" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        actions+=`<button onclick="refundPass('${p.id}')" title="Rembourser 1 séance" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`;
        actions+=`<button onclick="cancelPass('${p.id}')" title="Annuler" style="background:none;border:none;cursor:pointer;color:var(--gold);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>`;
      }else if(p.status==='used'){
        actions+=`<button onclick="refundPass('${p.id}')" title="Rembourser 1 séance" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`;
      }
      // Delete button always visible
      actions+=`<button onclick="deletePass('${p.id}','${esc(p.code)}')" title="Supprimer" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`;

      h+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px"><span style="font-family:monospace;font-weight:600;font-size:.8rem;letter-spacing:.5px">${esc(p.code)}</span></td>
        <td style="padding:10px"><div style="font-weight:500">${esc(buyerName)}</div>${buyerEmail?`<div style="font-size:.7rem;color:var(--text-4)">${esc(buyerEmail)}</div>`:''}</td>
        <td style="padding:10px;color:var(--text-2)">${esc(serviceName)}</td>
        <td style="padding:10px;text-align:center;font-weight:600"><span style="color:${sessionsRemaining>0?'var(--green)':'var(--text-4)'}">${sessionsRemaining}</span><span style="color:var(--text-4);font-weight:400">/${sessionsTotal}</span></td>
        <td style="padding:10px;font-size:.78rem;color:var(--text-3)">${expiresDate}</td>
        <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${sc}12;color:${sc};font-weight:600">${statusLabels[p.status]||p.status}</span></td>
        <td style="padding:10px;text-align:center;white-space:nowrap">${actions}</td>
      </tr>`;
    });
    h+=`</tbody></table></div>`;
  }

  c.innerHTML=h;
}

// ── Create Pass Modal ──
async function openCreatePass(){
  const existing=document.getElementById('passCreateModal');
  if(existing)existing.remove();

  // Fetch services list
  let services=[];
  try{
    const data=await api.get('/api/services');
    services=(data.services||data||[]).filter(s=>s.is_active!==false);
  }catch(e){
    console.error('[passes] fetch services failed',e);
    GendaUI.toast('Impossible de charger les prestations: '+e.message,'error');
  }

  const serviceOpts=services.map(s=>`<option value="${esc(s.id)}">${esc(s.name)}${s.price_cents!=null?' — '+fmtEur(s.price_cents):''}</option>`).join('');

  const modal=document.createElement('div');
  modal.className='m-overlay open';modal.id='passCreateModal';
  modal.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>Créer un pass</h3>
      <button class="m-close" onclick="document.getElementById('passCreateModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Prestation</label>
        <select id="passServiceSelect" onchange="passServiceChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">— Saisie manuelle —</option>
          ${serviceOpts}
        </select>
      </div>

      <div id="passManualNameRow" style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Nom du pass <span style="color:var(--text-4);font-weight:400">(saisie manuelle)</span></label>
        <input type="text" id="passNameManual" placeholder="Ex: Pack 10 Massages" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px;display:flex;gap:12px">
        <div style="flex:1">
          <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Nombre de séances</label>
          <input type="number" id="passSessionsTotal" min="1" step="1" placeholder="10" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
        </div>
        <div style="flex:1">
          <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Prix total (€)</label>
          <input type="number" id="passAmountEur" min="0" step="0.01" placeholder="0,00" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
        </div>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Nom du client</label>
        <input type="text" id="passBuyerName" placeholder="Prénom Nom" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Email du client <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="email" id="passBuyerEmail" placeholder="email@exemple.com" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date d'expiration <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="date" id="passExpiresAt" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('passCreateModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitCreatePass()">Créer le pass</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  guardModal(modal, { noBackdropClose: true });
}

function passServiceChanged(){
  const sel=document.getElementById('passServiceSelect');
  const manualRow=document.getElementById('passManualNameRow');
  if(sel.value){
    manualRow.style.display='none';
  }else{
    manualRow.style.display='';
  }
}

async function submitCreatePass(){
  const serviceId=document.getElementById('passServiceSelect').value.trim();
  const nameManual=document.getElementById('passNameManual').value.trim();
  const sessionsTotal=parseInt(document.getElementById('passSessionsTotal').value);
  const amountEur=parseFloat(document.getElementById('passAmountEur').value);
  const buyerName=document.getElementById('passBuyerName').value.trim();
  const buyerEmail=document.getElementById('passBuyerEmail').value.trim();
  const expiresAt=document.getElementById('passExpiresAt').value;

  // Build pass name: use selected service name or manual input
  const sel=document.getElementById('passServiceSelect');
  const passName=serviceId?sel.options[sel.selectedIndex].text.split(' — ')[0]:nameManual;

  if(!passName){GendaUI.toast('Veuillez choisir une prestation ou saisir un nom','error');return;}
  if(!sessionsTotal||sessionsTotal<1){GendaUI.toast('Veuillez saisir un nombre de séances valide','error');return;}
  if(!amountEur||amountEur<=0){GendaUI.toast('Veuillez saisir un prix valide','error');return;}
  if(!buyerName){GendaUI.toast('Veuillez saisir le nom du client','error');return;}

  try{
    await api.post('/api/passes',{
      service_id:serviceId||undefined,
      name:passName,
      sessions_total:sessionsTotal,
      price_cents:Math.round(amountEur*100),
      buyer_name:buyerName,
      buyer_email:buyerEmail||undefined,
      expires_at:expiresAt||undefined
    });
    document.getElementById('passCreateModal').remove();
    GendaUI.toast('Pass créé avec succès','success');
    loadPasses();
  }catch(e){GendaUI.toast(e.message||'Erreur lors de la création','error');}
}

// ── Debit Modal ──
function openDebitPass(id){
  const p=_lastPasses.find(x=>x.id===id);
  if(!p){GendaUI.toast('Pass introuvable','error');return;}

  const existing=document.getElementById('passDebitModal');
  if(existing)existing.remove();

  const sessionsRemaining=parseInt(p.sessions_remaining||0);

  const modal=document.createElement('div');
  modal.className='m-overlay open';modal.id='passDebitModal';
  modal.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Débiter — ${esc(p.code)}</h3>
      <button class="m-close" onclick="document.getElementById('passDebitModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="font-size:.82rem;color:var(--text-3)">Séances restantes</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--green)">${sessionsRemaining} / ${parseInt(p.sessions_total||0)}</div>
        <div style="font-size:.75rem;color:var(--text-3);margin-top:2px">${esc(p.service_name||'—')}</div>
      </div>
      ${sessionsRemaining<=0?`<div style="padding:10px;background:var(--red)12;border-radius:var(--radius-xs);color:var(--red);font-size:.82rem;text-align:center">Aucune séance disponible</div>`:`<p style="font-size:.85rem;color:var(--text-2);margin:0">Cliquez sur "Débiter" pour déduire 1 séance de ce pass.</p>`}
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('passDebitModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="debitPass('${p.id}')" ${sessionsRemaining<=0?'disabled':''}>Débiter 1 séance</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  guardModal(modal, { noBackdropClose: true });
}

async function debitPass(id){
  try{
    await api.post(`/api/passes/${id}/debit`);
    document.getElementById('passDebitModal').remove();
    GendaUI.toast('Séance débitée avec succès','success');
    loadPasses();
  }catch(e){GendaUI.toast(e.message||'Erreur lors du débit','error');}
}

// ── Refund ──
async function refundPass(id){
  const p=_lastPasses.find(x=>x.id===id);
  if(!p){GendaUI.toast('Pass introuvable','error');return;}

  const existing=document.getElementById('passRefundModal');
  if(existing)existing.remove();

  const sessionsRemaining=parseInt(p.sessions_remaining||0);
  const sessionsTotal=parseInt(p.sessions_total||0);

  const modal=document.createElement('div');
  modal.className='m-overlay open';modal.id='passRefundModal';
  modal.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Rembourser — ${esc(p.code)}</h3>
      <button class="m-close" onclick="document.getElementById('passRefundModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="display:flex;justify-content:space-between;font-size:.82rem">
          <span style="color:var(--text-3)">Séances totales</span><span style="font-weight:600">${sessionsTotal}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Séances restantes</span><span style="font-weight:600;color:var(--green)">${sessionsRemaining}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Séances utilisées</span><span style="font-weight:600">${sessionsTotal-sessionsRemaining}</span>
        </div>
      </div>
      <p style="font-size:.85rem;color:var(--text-2);margin:0">Cliquez sur "Rembourser" pour ajouter 1 séance à ce pass.</p>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('passRefundModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitRefundPass('${p.id}')">Rembourser 1 séance</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  guardModal(modal, { noBackdropClose: true });
}

async function submitRefundPass(id){
  try{
    await api.post(`/api/passes/${id}/refund`);
    document.getElementById('passRefundModal').remove();
    GendaUI.toast('Séance remboursée avec succès','success');
    loadPasses();
  }catch(e){GendaUI.toast(e.message||'Erreur lors du remboursement','error');}
}

// ── Cancel ──
async function cancelPass(id){
  const p=_lastPasses.find(x=>x.id===id);
  if(!p){GendaUI.toast('Pass introuvable','error');return;}
  const confirmed = await showConfirmDialog('Annuler le pass', `Annuler le pass ${p.code} ? Cette action est irréversible.`, 'Annuler le pass', 'danger');
  if(!confirmed)return;

  try{
    await api.patch(`/api/passes/${id}`,{status:'cancelled'});
    GendaUI.toast('Pass annulé','success');
    loadPasses();
  }catch(e){GendaUI.toast(e.message||'Erreur lors de l\'annulation','error');}
}

// ── Delete (hard) ──
async function deletePass(id,code){
  const confirmed = await showConfirmDialog('Supprimer le pass', `Supprimer définitivement le pass ${code} ? Cette action est irréversible.`, 'Supprimer', 'danger');
  if(!confirmed)return;
  try{
    await api.delete(`/api/passes/${id}`);
    GendaUI.toast('Pass supprimé','success');
    loadPasses();
  }catch(e){GendaUI.toast(e.message||'Erreur lors de la suppression','error');}
}

function setPassFilter(v){passFilter=v;}
function passSearchInput(v){passSearch=v;}

// Expose filter/search state for inline handlers
Object.defineProperty(window,'passFilter',{get(){return passFilter;},set(v){passFilter=v;},configurable:true});
Object.defineProperty(window,'passSearch',{get(){return passSearch;},set(v){passSearch=v;},configurable:true});

bridge({loadPasses,openCreatePass,submitCreatePass,passServiceChanged,openDebitPass,debitPass,refundPass,submitRefundPass,cancelPass,deletePass,setPassFilter,passSearchInput});

export {renderPasses};
