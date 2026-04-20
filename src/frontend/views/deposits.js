/**
 * Deposits (Acomptes) view module — transaction reconciliation & dispute.
 */
import { api, GendaUI } from '../state.js';
import { trapFocus, releaseFocus } from '../utils/focus-trap.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';
import { guardModal } from '../utils/dirty-guard.js';
import { isPro, showProGate } from '../utils/plan-gate.js';
import { formatEur as fmtEur } from '../utils/format.js';
import { renderPagination } from '../utils/pagination.js';

let depositFilter='all',depositFrom='',depositTo='';
let depositOffset=0;
const DEPOSIT_PAGE_SIZE=50;
let _lastDepPag={total_count:0,limit:DEPOSIT_PAGE_SIZE,offset:0};
let _lastDeps=[];

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function loadDeposits(){
  if (!isPro()) { showProGate(document.getElementById('contentArea'), 'Acomptes'); return; }
  const c=document.getElementById('contentArea');
  c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try{
    const params=new URLSearchParams();
    if(depositFilter!=='all')params.set('status',depositFilter);
    if(depositFrom)params.set('from',depositFrom);
    if(depositTo)params.set('to',depositTo);
    params.set('limit', String(DEPOSIT_PAGE_SIZE));
    params.set('offset', String(depositOffset));
    const data=await api.get(`/api/deposits?${params}`);
    const deps=data.deposits||[];
    _lastDeps=deps;
    _lastDepPag=data.pagination||{total_count:deps.length,limit:DEPOSIT_PAGE_SIZE,offset:depositOffset};
    const st=data.stats||{};
    let h='';

    // ── KPI CARDS ──
    h+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card" style="cursor:pointer" onclick="depositFilter='pending';depositOffset=0;loadDeposits()"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${fmtEur(parseInt(st.pending_cents||0))}</div><div class="sub">${st.pending_count||0} acomptes</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="depositFilter='paid';depositOffset=0;loadDeposits()"><div class="label">Encaiss\u00e9s</div><div class="val" style="color:var(--green)">${fmtEur(parseInt(st.paid_cents||0))}</div><div class="sub">${st.paid_count||0} acomptes</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="depositFilter='refunded';depositOffset=0;loadDeposits()"><div class="label">Rembours\u00e9s</div><div class="val" style="color:var(--red)">${fmtEur(parseInt(st.refunded_cents||0))}</div><div class="sub">${st.refunded_count||0} acomptes</div></div>
      <div class="stat-card" style="cursor:pointer" onclick="depositFilter='cancelled';depositOffset=0;loadDeposits()"><div class="label">Conserv\u00e9s</div><div class="val" style="color:var(--primary)">${fmtEur(parseInt(st.kept_cents||0))}</div><div class="sub">${st.kept_count||0} acomptes</div></div>
    </div>`;

    // ── FILTER BAR ──
    h+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
      <select onchange="depositFilter=this.value;depositOffset=0;loadDeposits()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${depositFilter==='all'?'selected':''}>Tous statuts</option>
        <option value="pending" ${depositFilter==='pending'?'selected':''}>En attente</option>
        <option value="paid" ${depositFilter==='paid'?'selected':''}>Pay\u00e9s</option>
        <option value="refunded" ${depositFilter==='refunded'?'selected':''}>Rembours\u00e9s</option>
        <option value="cancelled" ${depositFilter==='cancelled'?'selected':''}>Conserv\u00e9s</option>
        <option value="waived" ${depositFilter==='waived'?'selected':''}>Dispens\u00e9s</option>
      </select>
      <input type="date" value="${esc(depositFrom)}" onchange="depositFrom=this.value;depositOffset=0;loadDeposits()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem" title="Date d\u00e9but">
      <input type="date" value="${esc(depositTo)}" onchange="depositTo=this.value;depositOffset=0;loadDeposits()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem" title="Date fin">
      ${(depositFilter!=='all'||depositFrom||depositTo)?`<button onclick="depositFilter='all';depositFrom='';depositTo='';depositOffset=0;loadDeposits()" class="btn-outline btn-sm">Effacer filtres</button>`:''}
      <div style="flex:1"></div>
      <button onclick="exportDepositsCSV()" class="btn-outline btn-sm"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Export CSV</button>
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

      const depStatusColors={pending:'var(--gold)',paid:'var(--green)',refunded:'var(--blue)',cancelled:'var(--primary)',waived:'var(--text-3)'};
      const depStatusLabels={pending:'En attente',paid:'Pay\u00e9',refunded:'Rembours\u00e9',cancelled:'Conserv\u00e9',waived:'Dispens\u00e9'};
      const bkStatusColors={pending:'var(--gold)',confirmed:'var(--green)',cancelled:'var(--red)',completed:'var(--text-3)',no_show:'var(--amber-dark)',pending_deposit:'var(--gold)',modified_pending:'var(--gold)'};
      const bkStatusLabels={pending:'En attente',confirmed:'Confirm\u00e9',cancelled:'Annul\u00e9',completed:'Termin\u00e9',no_show:'No-show',pending_deposit:'Att. acompte',modified_pending:'Modifi\u00e9'};

      deps.forEach(d=>{
        const dc=depStatusColors[d.deposit_status]||'var(--text-4)';
        const bc=bkStatusColors[d.booking_status]||'var(--text-4)';
        const rdvDate=new Date(d.start_at).toLocaleDateString('fr-BE',{timeZone:'Europe/Brussels'});
        const createdDate=new Date(d.created_at).toLocaleDateString('fr-BE',{timeZone:'Europe/Brussels'});
        const paidDate=d.deposit_paid_at?new Date(d.deposit_paid_at).toLocaleDateString('fr-BE',{timeZone:'Europe/Brussels'}):'\u2014';
        const hasAudit=d.audit_trail&&d.audit_trail.length>0;

        h+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px"><div style="font-weight:600">${rdvDate}</div><div style="font-size:.7rem;color:var(--text-4)">Cr\u00e9\u00e9 ${createdDate}</div></td>
          <td style="padding:10px"><div style="font-weight:500">${esc(d.client_name)}</div><div style="font-size:.7rem;color:var(--text-4)">${esc(d.client_email||'')}</div></td>
          <td style="padding:10px"><span style="font-size:.78rem">${esc(d.service_name)}</span><div style="font-size:.7rem;color:var(--text-4)">${esc(d.practitioner_name||'')}</div></td>
          <td style="padding:10px;text-align:right;font-weight:600">${fmtEur(d.deposit_amount_cents)}${(()=>{const gc=parseInt(d.gc_paid_cents)||0;if(gc<=0)return '';const stripe=Math.max(0,(d.deposit_amount_cents||0)-gc);return '<div style="font-size:.65rem;font-weight:400;color:var(--text-4);margin-top:2px">'+IC.gift+' '+fmtEur(gc)+' carte cadeau'+(stripe>0?' · '+fmtEur(stripe)+' Stripe':'')+'</div>';})()}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${dc}12;color:${dc};font-weight:600">${depStatusLabels[d.deposit_status]||d.deposit_status||'\u2014'}</span></td>
          <td style="padding:10px;color:var(--text-3);font-size:.78rem">${paidDate}${d.deposit_payment_intent_id?(d.deposit_payment_intent_id.startsWith('gc_')?'<div style="font-size:.65rem;color:var(--amber-dark)">'+IC.gift+' Carte cadeau</div>':'<div style="font-size:.65rem;color:var(--text-4);font-family:monospace">'+esc(d.deposit_payment_intent_id.slice(-8))+'</div>'):''}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${bc}12;color:${bc};font-weight:600">${bkStatusLabels[d.booking_status]||d.booking_status}</span></td>
          <td style="padding:10px;text-align:center">${hasAudit?`<button onclick="showDepositAudit('${d.id}')" title="Voir l'historique" aria-label="Voir l'historique de l'acompte" style="background:none;border:none;cursor:pointer;font-size:.85rem;color:var(--primary)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></button>`:'<span style="color:var(--text-4)">\u2014</span>'}</td>
        </tr>`;
      });
      h+=`</tbody></table></div>`;
      h+=renderPagination({ total: _lastDepPag.total_count, limit: _lastDepPag.limit, offset: _lastDepPag.offset, onPage: 'depositsGoToPage', label: 'acomptes' });
    }

    // ── INFO CARD ──
    h+=`<div class="card" style="background:var(--surface);margin-top:14px;padding:14px 18px">
      <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;vertical-align:-3px"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Dispute ?</strong> Exportez un CSV complet via le bouton ci-dessus. Il contient les identifiants Stripe, dates de paiement et raisons d\u2019annulation pour toute r\u00e9conciliation bancaire.</p>
    </div>`;

    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;}
}

// ── Audit trail modal ──
function showDepositAudit(bookingId){
  const dep=_lastDeps.find(d=>d.id===bookingId);
  if(!dep){GendaUI.toast('Acompte introuvable','error');return;}

  const trail=dep.audit_trail||[];
  const actionLabels={deposit_refund:'Remboursement',status_change:'Changement de statut'};

  let auditHtml=trail.map(a=>{
    const date=new Date(a.audit_date).toLocaleString('fr-BE',{timeZone:'Europe/Brussels'});
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
  modal.className='m-overlay open';modal.id='depAuditModal';
  modal.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>Historique acompte</h3>
      <button class="m-close" onclick="closeModal('depAuditModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="font-size:.85rem;font-weight:600">${esc(dep.client_name)} \u2014 ${esc(dep.service_name)}</div>
        <div style="font-size:.75rem;color:var(--text-3);margin-top:4px">Montant: ${fmtEur(dep.deposit_amount_cents)}${(()=>{const gc=parseInt(dep.gc_paid_cents)||0;if(gc<=0)return '';const stripe=Math.max(0,(dep.deposit_amount_cents||0)-gc);return ' ('+IC.gift+' '+fmtEur(gc)+' carte cadeau'+(stripe>0?' + '+fmtEur(stripe)+' Stripe':'')+')';})()} \u2022 RDV: ${new Date(dep.start_at).toLocaleDateString('fr-BE',{timeZone:'Europe/Brussels'})} \u2022 Statut: ${depStatusLabels[dep.deposit_status]||dep.deposit_status}</div>
      </div>
      ${auditHtml}
    </div>
  </div>`;
  document.body.appendChild(modal);
  guardModal(modal, { noBackdropClose: true });
  trapFocus(modal, () => closeModal(modal.id));
}

// ── CSV export ──
function exportDepositsCSV(){
  const token=localStorage.getItem('genda_token');
  const params=new URLSearchParams();
  if(depositFilter!=='all')params.set('status',depositFilter);
  if(depositFrom)params.set('from',depositFrom);
  if(depositTo)params.set('to',depositTo);
  params.set('token',token);
  window.open(`/api/deposits/export?${params}`,'_blank','noopener,noreferrer');
}

// Expose for inline handlers
Object.defineProperty(window,'depositFilter',{get(){return depositFilter;},set(v){depositFilter=v;},configurable:true});
Object.defineProperty(window,'depositFrom',{get(){return depositFrom;},set(v){depositFrom=v;},configurable:true});
Object.defineProperty(window,'depositTo',{get(){return depositTo;},set(v){depositTo=v;},configurable:true});

function depositsGoToPage(newOffset){ depositOffset = Math.max(0, parseInt(newOffset) || 0); loadDeposits(); }

bridge({loadDeposits,showDepositAudit,exportDepositsCSV,depositsGoToPage});

export {loadDeposits,showDepositAudit,exportDepositsCSV};
