/**
 * Deposits (Acomptes) view module — transaction reconciliation & dispute.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

let depositFilter='all',depositFrom='',depositTo='';
let _lastDeps=[];

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmtEur(cents){return((cents||0)/100).toFixed(2).replace('.',',')+' \u20ac';}

async function loadDeposits(){
  const c=document.getElementById('contentArea');
  c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try{
    const params=new URLSearchParams();
    if(depositFilter!=='all')params.set('status',depositFilter);
    if(depositFrom)params.set('from',depositFrom);
    if(depositTo)params.set('to',depositTo);
    const data=await api.get(`/api/deposits?${params}`);
    const deps=data.deposits||[];
    _lastDeps=deps;
    const st=data.stats||{};
    let h='';

    // ── KPI CARDS ──
    h+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card" style="cursor:pointer" onclick="depositFilter='pending';loadDeposits()"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${fmtEur(parseInt(st.pending_cents||0))}</div><div class="sub">${st.pending_count||0} acomptes</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="depositFilter='paid';loadDeposits()"><div class="label">Encaiss\u00e9s</div><div class="val" style="color:var(--green)">${fmtEur(parseInt(st.paid_cents||0))}</div><div class="sub">${st.paid_count||0} acomptes</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="depositFilter='refunded';loadDeposits()"><div class="label">Rembours\u00e9s</div><div class="val" style="color:var(--red)">${fmtEur(parseInt(st.refunded_cents||0))}</div><div class="sub">${st.refunded_count||0} acomptes</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="depositFilter='cancelled';loadDeposits()"><div class="label">Conserv\u00e9s</div><div class="val" style="color:var(--primary)">${fmtEur(parseInt(st.kept_cents||0))}</div><div class="sub">${st.kept_count||0} acomptes</div></div>
    </div>`;

    // ── FILTER BAR ──
    h+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
      <select onchange="depositFilter=this.value;loadDeposits()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${depositFilter==='all'?'selected':''}>Tous statuts</option>
        <option value="pending" ${depositFilter==='pending'?'selected':''}>En attente</option>
        <option value="paid" ${depositFilter==='paid'?'selected':''}>Pay\u00e9s</option>
        <option value="refunded" ${depositFilter==='refunded'?'selected':''}>Rembours\u00e9s</option>
        <option value="cancelled" ${depositFilter==='cancelled'?'selected':''}>Conserv\u00e9s</option>
      </select>
      <input type="date" value="${esc(depositFrom)}" onchange="depositFrom=this.value;loadDeposits()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem" title="Date d\u00e9but">
      <input type="date" value="${esc(depositTo)}" onchange="depositTo=this.value;loadDeposits()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem" title="Date fin">
      ${(depositFilter!=='all'||depositFrom||depositTo)?`<button onclick="depositFilter='all';depositFrom='';depositTo='';loadDeposits()" style="padding:6px 12px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem;cursor:pointer">Effacer filtres</button>`:''}
      <div style="flex:1"></div>
      <button onclick="exportDepositsCSV()" style="padding:8px 16px;background:var(--primary);color:#fff;border:none;border-radius:var(--radius-xs);font-size:.8rem;font-weight:600;cursor:pointer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export CSV</button>
    </div>`;

    // ── TABLE ──
    if(deps.length===0){
      h+=`<div class="card"><div class="empty">Aucun acompte enregistr\u00e9.</div></div>`;
    }else{
      h+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Prestation</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut acompte</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Paiement</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut RDV</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Audit</th>
        </tr></thead><tbody>`;

      const depStatusColors={pending:'var(--gold)',paid:'var(--green)',refunded:'#2563EB',cancelled:'var(--primary)'};
      const depStatusLabels={pending:'En attente',paid:'Pay\u00e9',refunded:'Rembours\u00e9',cancelled:'Conserv\u00e9'};
      const bkStatusColors={pending:'var(--gold)',confirmed:'var(--green)',cancelled:'var(--red)',completed:'var(--text-3)',no_show:'#B45309',pending_deposit:'var(--gold)',modified_pending:'var(--gold)'};
      const bkStatusLabels={pending:'En attente',confirmed:'Confirm\u00e9',cancelled:'Annul\u00e9',completed:'Termin\u00e9',no_show:'No-show',pending_deposit:'Att. acompte',modified_pending:'Modifi\u00e9'};

      deps.forEach(d=>{
        const dc=depStatusColors[d.deposit_status]||'var(--text-4)';
        const bc=bkStatusColors[d.booking_status]||'var(--text-4)';
        const rdvDate=new Date(d.start_at).toLocaleDateString('fr-BE');
        const createdDate=new Date(d.created_at).toLocaleDateString('fr-BE');
        const paidDate=d.deposit_paid_at?new Date(d.deposit_paid_at).toLocaleDateString('fr-BE'):'\u2014';
        const hasAudit=d.audit_trail&&d.audit_trail.length>0;

        h+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px"><div style="font-weight:600">${rdvDate}</div><div style="font-size:.7rem;color:var(--text-4)">Cr\u00e9\u00e9 ${createdDate}</div></td>
          <td style="padding:10px"><div style="font-weight:500">${esc(d.client_name)}</div><div style="font-size:.7rem;color:var(--text-4)">${esc(d.client_email||'')}</div></td>
          <td style="padding:10px"><span style="font-size:.78rem">${esc(d.service_name)}</span><div style="font-size:.7rem;color:var(--text-4)">${esc(d.practitioner_name||'')}</div></td>
          <td style="padding:10px;text-align:right;font-weight:600">${fmtEur(d.deposit_amount_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${dc}12;color:${dc};font-weight:600">${depStatusLabels[d.deposit_status]||d.deposit_status||'\u2014'}</span></td>
          <td style="padding:10px;color:var(--text-3);font-size:.78rem">${paidDate}${d.deposit_payment_intent_id?'<div style="font-size:.65rem;color:var(--text-4);font-family:monospace">'+esc(d.deposit_payment_intent_id.slice(-8))+'</div>':''}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${bc}12;color:${bc};font-weight:600">${bkStatusLabels[d.booking_status]||d.booking_status}</span></td>
          <td style="padding:10px;text-align:center">${hasAudit?`<button onclick="showDepositAudit('${d.id}')" title="Voir l'historique" style="background:none;border:none;cursor:pointer;font-size:.85rem;color:var(--primary)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>`:'<span style="color:var(--text-4)">\u2014</span>'}</td>
        </tr>`;
      });
      h+=`</tbody></table></div>`;
    }

    // ── INFO CARD ──
    h+=`<div class="card" style="background:var(--surface);margin-top:14px;padding:14px 18px">
      <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;vertical-align:-3px"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Dispute ?</strong> Exportez un CSV complet via le bouton ci-dessus. Il contient les identifiants Stripe, dates de paiement et raisons d\u2019annulation pour toute r\u00e9conciliation bancaire.</p>
    </div>`;

    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

// ── Audit trail modal ──
function showDepositAudit(bookingId){
  const dep=_lastDeps.find(d=>d.id===bookingId);
  if(!dep){GendaUI.toast('Acompte introuvable','error');return;}

  const trail=dep.audit_trail||[];
  const actionLabels={deposit_refund:'Remboursement',status_change:'Changement de statut'};

  let auditHtml=trail.map(a=>{
    const date=new Date(a.audit_date).toLocaleString('fr-BE');
    const label=actionLabels[a.action]||a.action;
    const nd=a.new_data||{};
    let details=[];
    if(nd.status)details.push('Statut \u2192 '+nd.status);
    if(nd.deposit_status)details.push('Acompte \u2192 '+nd.deposit_status);
    if(nd.amount_cents)details.push('Montant: '+fmtEur(nd.amount_cents));
    return `<div style="padding:10px 0;border-bottom:1px solid var(--border-light)">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong style="font-size:.82rem">${esc(label)}</strong><span style="color:var(--text-4);font-size:.72rem">${date}</span></div>
      <div style="color:var(--text-3);font-size:.75rem;margin-top:3px">Par: ${esc(a.actor_email||'Syst\u00e8me')}</div>
      ${details.length?`<div style="color:var(--text-2);font-size:.75rem;margin-top:3px">${details.join(' \u2022 ')}</div>`:''}
    </div>`;
  }).join('');

  if(trail.length===0)auditHtml='<div class="empty" style="padding:20px">Aucune action enregistr\u00e9e</div>';

  const depStatusLabels={pending:'En attente',paid:'Pay\u00e9',refunded:'Rembours\u00e9',cancelled:'Conserv\u00e9'};

  const modal=document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:100;display:flex;align-items:center;justify-content:center';
  modal.onclick=e=>{if(e.target===modal)modal.remove();};
  modal.innerHTML=`<div style="background:var(--white);border-radius:var(--radius);padding:24px;width:500px;max-width:95vw;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.2)">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
      <h3 style="font-size:1rem;font-weight:700;color:var(--text);margin:0">Historique acompte</h3>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="background:none;border:none;font-size:1.3rem;cursor:pointer;color:var(--text-3)">\u00d7</button>
    </div>
    <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
      <div style="font-size:.85rem;font-weight:600">${esc(dep.client_name)} \u2014 ${esc(dep.service_name)}</div>
      <div style="font-size:.75rem;color:var(--text-3);margin-top:4px">Montant: ${fmtEur(dep.deposit_amount_cents)} \u2022 RDV: ${new Date(dep.start_at).toLocaleDateString('fr-BE')} \u2022 Statut: ${depStatusLabels[dep.deposit_status]||dep.deposit_status}</div>
    </div>
    ${auditHtml}
  </div>`;
  document.body.appendChild(modal);
}

// ── CSV export ──
function exportDepositsCSV(){
  const token=localStorage.getItem('genda_token');
  const params=new URLSearchParams();
  if(depositFilter!=='all')params.set('status',depositFilter);
  if(depositFrom)params.set('from',depositFrom);
  if(depositTo)params.set('to',depositTo);
  params.set('token',token);
  window.open(`/api/deposits/export?${params}`,'_blank');
}

// Expose for inline handlers
Object.defineProperty(window,'depositFilter',{get(){return depositFilter;},set(v){depositFilter=v;},configurable:true});
Object.defineProperty(window,'depositFrom',{get(){return depositFrom;},set(v){depositFrom=v;},configurable:true});
Object.defineProperty(window,'depositTo',{get(){return depositTo;},set(v){depositTo=v;},configurable:true});

bridge({loadDeposits,showDepositAudit,exportDepositsCSV});

export {loadDeposits,showDepositAudit,exportDepositsCSV};
