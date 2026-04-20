/**
 * Invoices (Facturation) view module.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { guardModal, showConfirmDialog, closeModal } from '../utils/dirty-guard.js';
import { isPro, showProGate } from '../utils/plan-gate.js';
import { trapFocus, releaseFocus } from '../utils/focus-trap.js';
import { formatEur as fmtEur } from '../utils/format.js';

let invoiceFilter='all',invoiceType='all';
let _unbilledBookings=[];

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function loadInvoices(){
  if (!isPro()) { showProGate(document.getElementById('contentArea'), 'Facturation'); return; }
  const c=document.getElementById('contentArea');
  c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try{
    const params=new URLSearchParams();
    if(invoiceFilter!=='all')params.set('status',invoiceFilter);
    if(invoiceType!=='all')params.set('type',invoiceType);
    const data=await api.get(`/api/invoices?${params}`);
    const inv=data.invoices||[];
    const st=data.stats||{};
    let h='';

    // KPIs
    h+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="label">Brouillons</div><div class="val">${st.drafts||0}</div></div>
      <div class="stat-card"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${fmtEur(parseInt(st.total_pending||0))}</div><div class="sub">${(parseInt(st.sent||0)+parseInt(st.overdue||0))} factures</div></div>
      <div class="stat-card"><div class="label">Payées</div><div class="val" style="color:var(--green)">${fmtEur(parseInt(st.total_paid||0))}</div><div class="sub">${st.paid||0} factures</div></div>
      <div class="stat-card"><div class="label">En retard</div><div class="val" style="color:var(--red)">${st.overdue||0}</div></div>
    </div>`;

    // Actions bar
    h+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
      <button onclick="openInvoiceModal()" class="btn-primary btn-sm">+ Nouvelle facture</button>
      <button onclick="openInvoiceModal('quote')" class="btn-primary btn-sm" style="background:var(--gold)">+ Devis</button>
      <div style="flex:1"></div>
      <select onchange="invoiceType=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${invoiceType==='all'?'selected':''}>Tous types</option>
        <option value="invoice" ${invoiceType==='invoice'?'selected':''}>Factures</option>
        <option value="quote" ${invoiceType==='quote'?'selected':''}>Devis</option>
        <option value="credit_note" ${invoiceType==='credit_note'?'selected':''}>Notes de crédit</option>
      </select>
      <select onchange="invoiceFilter=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${invoiceFilter==='all'?'selected':''}>Tous statuts</option>
        <option value="draft" ${invoiceFilter==='draft'?'selected':''}>Brouillons</option>
        <option value="sent" ${invoiceFilter==='sent'?'selected':''}>Envoyées</option>
        <option value="paid" ${invoiceFilter==='paid'?'selected':''}>Payées</option>
        <option value="overdue" ${invoiceFilter==='overdue'?'selected':''}>En retard</option>
        <option value="cancelled" ${invoiceFilter==='cancelled'?'selected':''}>Annulées</option>
      </select>
    </div>`;

    // Table
    if(inv.length===0){
      h+=`<div class="card"><div class="empty">Aucune facture. Créez votre première facture ou devis !</div></div>`;
    }else{
      h+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">N\u00b0</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Type</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant TTC</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
        </tr></thead><tbody>`;
      inv.forEach(f=>{
        const statusColors={draft:'var(--text-4)',sent:'var(--gold)',paid:'var(--green)',overdue:'var(--red)',cancelled:'var(--text-4)'};
        const statusLabels={draft:'Brouillon',sent:'Envoyée',paid:'Payée',overdue:'En retard',cancelled:'Annulée'};
        const typeLabels={invoice:'Facture',quote:'Devis',credit_note:'Note crédit'};
        const typeColors={invoice:'var(--primary)',quote:'var(--gold)',credit_note:'var(--text-3)'};
        const sc=statusColors[f.status]||'var(--text-4)';
        const d=new Date(f.issue_date).toLocaleDateString('fr-BE',{timeZone:'Europe/Brussels'});
        h+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px;font-weight:600">${esc(f.invoice_number)}</td>
          <td style="padding:10px"><span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${typeColors[f.type]}15;color:${typeColors[f.type]};font-weight:600">${typeLabels[f.type]||f.type}</span></td>
          <td style="padding:10px">${esc(f.client_name)}</td>
          <td style="padding:10px;color:var(--text-3)">${d}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${fmtEur(f.total_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${sc}12;color:${sc};font-weight:600">${statusLabels[f.status]||f.status}</span></td>
          <td style="padding:10px;text-align:right">
            <button onclick="downloadInvoicePDF('${f.id}')" title="Télécharger PDF" aria-label="Télécharger PDF" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
            ${f.status==='draft'?`<button onclick="changeInvoiceStatus('${f.id}','sent')" title="Marquer envoyée" aria-label="Marquer envoyée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`:''}
            ${f.status==='sent'||f.status==='overdue'?`<button onclick="changeInvoiceStatus('${f.id}','paid')" title="Marquer payée" aria-label="Marquer payée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`:''}
            ${(f.type==='invoice'&&['sent','paid','overdue'].includes(f.status))?`<button onclick="issueCreditNote('${f.id}','${esc(f.invoice_number||'')}')" title="Émettre une note de crédit (conformité BE)" aria-label="Émettre une note de crédit (conformité BE)" style="background:none;border:none;cursor:pointer;font-size:1rem;color:var(--gold)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg></button>`:''}
            ${f.status==='draft'?`<button onclick="deleteInvoice('${f.id}')" title="Supprimer" aria-label="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`:''}
          </td>
        </tr>`;
      });
      h+=`</tbody></table></div>`;
    }

    // IBAN/BIC reminder
    const bizData=api.getBusiness();
    if(!bizData?.settings?.iban){
      h+=`<div class="card" style="background:var(--gold-bg);border:1px solid #E0D4A8;margin-top:14px;padding:14px 18px">
        <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Ajoutez votre IBAN</strong> dans Paramètres \u2192 Infos salon pour l'afficher sur vos factures et générer la communication structurée belge.</p>
      </div>`;
    }

    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;}
}

// Invoice creation modal
async function openInvoiceModal(type='invoice',prefill={}){
  let clients=[];
  try{const r=await api.get('/api/clients');clients=r.clients||r||[];}catch(e){console.warn('Impossible de charger les clients pour la facture:',e.message);}

  const isQuote=type==='quote';
  const title=isQuote?'Nouveau devis':'Nouvelle facture';

  const modal=document.createElement('div');
  modal.className='m-overlay open';modal.id='invModal';
  modal.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${title}</h3>
      <button class="m-close" onclick="closeModal('invModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="m-body" style="display:grid;gap:12px">
      <div>
        <label class="m-field-label">Client</label>
        <select class="m-input" id="invClient" onchange="invClientChanged()">
          <option value="">\u2014 Sélectionner un client \u2014</option>
          ${clients.map(c=>`<option value="${c.id}">${esc(c.full_name)}${c.email?' ('+esc(c.email)+')':''}</option>`).join('')}
        </select>
      </div>

      <div id="invUnbilledSection" style="display:none">
        <label class="m-field-label">RDV non facturés (7 derniers jours)</label>
        <div id="invUnbilledList" style="border:1px solid var(--border-light);border-radius:var(--radius-xs);overflow:hidden;max-height:200px;overflow-y:auto"></div>
      </div>

      <div class="m-row m-row-2">
        <div>
          <label class="m-field-label">Taux TVA (%)</label>
          <select class="m-input" id="invVat">
            <option value="21">21% (standard)</option>
            <option value="6">6% (réduit)</option>
            <option value="0">0% (exempté)</option>
          </select>
        </div>
        <div>
          <label class="m-field-label">${isQuote?'Validité (jours)':'Échéance (jours)'}</label>
          <input class="m-input" id="invDueDays" type="number" value="30" min="0">
        </div>
      </div>

      <div>
        <label class="m-field-label">TVA client (optionnel)</label>
        <input class="m-input" id="invClientBce" placeholder="BE0XXX.XXX.XXX">
      </div>

      <div>
        <label class="m-field-label">Lignes</label>
        <div id="invLines"></div>
        <button onclick="addInvoiceLine()" class="btn-outline btn-sm" style="margin-top:6px">+ Ajouter une ligne</button>
      </div>

      <div id="invTotals" style="text-align:right;padding:10px 0;border-top:1px solid var(--border)"></div>

      <div>
        <label class="m-field-label">Notes</label>
        <textarea class="m-input" id="invNotes" rows="2" placeholder="Conditions, remarques..." style="resize:vertical"></textarea>
      </div>
    </div>

    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('invModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="saveInvoice('${type}')">${isQuote?'Créer le devis':'Créer la facture'}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  guardModal(document.getElementById('invModal'), { noBackdropClose: true });
  addInvoiceLine();
  updateInvTotals();
  // Pre-select client if provided
  if(prefill.preselect_client_id){
    const sel=document.getElementById('invClient');
    if(sel){sel.value=prefill.preselect_client_id;}
    await invClientChanged();
    if(prefill.precheck_booking_id||prefill.precheck_group_id){
      setTimeout(()=>{
        _unbilledBookings.forEach((b,i)=>{
          const shouldCheck=(prefill.precheck_booking_id&&b.id===prefill.precheck_booking_id)
            ||(prefill.precheck_group_id&&b.group_id===prefill.precheck_group_id);
          if(shouldCheck){
            const cb=document.querySelector(`[data-unbilled-idx="${i}"]`);
            if(cb&&!cb.checked){cb.checked=true;invToggleUnbilled(i,true);}
          }
        });
      },100);
    }
  }
}

function addInvoiceLine(){
  const container=document.getElementById('invLines');
  if(!container)return;
  const row=document.createElement('div');
  row.style.cssText='display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px';
  row.innerHTML=`
    <input class="inv-desc" placeholder="Description prestation" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="1" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" placeholder="Prix \u20ac" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" aria-label="Retirer la ligne" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  container.appendChild(row);
}

function updateInvTotals(){
  const container=document.getElementById('invLines');
  const totalsDiv=document.getElementById('invTotals');
  if(!container||!totalsDiv)return;
  const vatRate=parseFloat(document.getElementById('invVat')?.value||21);
  let subtotal=0;
  container.querySelectorAll(':scope > div').forEach(row=>{
    const qty=parseFloat(row.querySelector('.inv-qty')?.value||1);
    const price=parseFloat(row.querySelector('.inv-price')?.value||0);
    subtotal+=qty*price*100;
  });
  // Prices are TTC (Belgian standard) — extract VAT from TTC, aligned with backend
  const vat=Math.round(subtotal*vatRate/(100+vatRate));
  const total=subtotal;
  const ht=subtotal-vat;
  totalsDiv.innerHTML=`
    <div style="font-size:.82rem;color:var(--text-3)">Sous-total HTVA : <strong>${fmtEur(ht)}</strong></div>
    <div style="font-size:.82rem;color:var(--text-3)">TVA (${vatRate}%) : <strong>${fmtEur(vat)}</strong></div>
    <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:4px">Total TTC : ${fmtEur(total)}</div>`;
}

async function saveInvoice(type){
  const clientId=document.getElementById('invClient')?.value;
  if(!clientId){GendaUI.toast('Sélectionnez un client','error');return;}

  const container=document.getElementById('invLines');
  const items=[];
  container.querySelectorAll(':scope > div').forEach(row=>{
    const desc=row.querySelector('.inv-desc')?.value?.trim();
    const qty=parseFloat(row.querySelector('.inv-qty')?.value||1);
    const price=parseFloat(row.querySelector('.inv-price')?.value||0);
    const bookingId=row.getAttribute('data-booking-id')||undefined;
    if(desc&&price!==0)items.push({description:desc,quantity:qty,unit_price_cents:Math.round(price*100),booking_id:bookingId});
  });
  if(items.length===0){GendaUI.toast('Ajoutez au moins une ligne','error');return;}

  try{
    const body={
      client_id:clientId,
      type:type||'invoice',
      items,
      vat_rate:parseFloat(document.getElementById('invVat')?.value||21),
      due_days:parseInt(document.getElementById('invDueDays')?.value||30),
      client_bce:document.getElementById('invClientBce')?.value?.trim()||undefined,
      notes:document.getElementById('invNotes')?.value?.trim()||undefined
    };
    const r=await api.post('/api/invoices',body);
    document.getElementById('invModal')._dirtyGuard?.markClean();
    closeModal('invModal');
    GendaUI.toast(type==='quote'?'Devis créé !':'Facture créée !','success');
    loadInvoices();
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function changeInvoiceStatus(id,status){
  const labels={sent:'Marquer comme envoyée ?',paid:'Marquer comme payée ?'};
  const confirmed = await showConfirmDialog('Changer le statut', labels[status]||`Changer le statut en "${status}" ?`, 'Confirmer');
  if(!confirmed)return;
  try{
    await api.patch(`/api/invoices/${id}/status`,{status});
    GendaUI.toast('Statut mis à jour','success');
    loadInvoices();
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function deleteInvoice(id){
  const confirmed = await showConfirmDialog('Supprimer le brouillon', 'Supprimer ce brouillon ?', 'Supprimer', 'danger');
  if(!confirmed)return;
  try{
    await api.delete(`/api/invoices/${id}`);
    GendaUI.toast('Brouillon supprimé','success');
    loadInvoices();
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

function downloadInvoicePDF(id){
  const token=localStorage.getItem('genda_token');
  window.open(`/api/invoices/${id}/pdf?token=${token}`,'_blank','noopener,noreferrer');
}

// ── Credit note (BE legal compliance AR n°1 art.14) ──
// POST /api/invoices/:id/credit-note creates a new invoice (type='credit_note') with
// NC-YYYY-XXXXXX number, referencing the original via related_invoice_id, items negated.
async function issueCreditNote(id,invNumber){
  const modal=document.createElement('div');
  modal.className='m-overlay open';modal.id='creditNoteModal';
  modal.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Note de crédit — ${esc(invNumber)}</h3>
      <button class="m-close" onclick="closeModal('creditNoteModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--gold-bg,#FEF9C3);border-left:3px solid var(--gold);border-radius:var(--radius-xs)">
        <div style="font-size:.85rem;color:var(--text-2);font-weight:600;margin-bottom:4px">Conformité légale BE (AR n°1 art.14)</div>
        <div style="font-size:.8rem;color:var(--text-3)">Une note de crédit sera émise (numérotation NC-${new Date().getFullYear()}-XXXXXX) avec tous les montants négatifs. Elle référencera la facture ${esc(invNumber)}.</div>
      </div>
      <label style="display:block;font-size:.8rem;color:var(--text-3);margin-bottom:4px">Motif (inclus dans la note)</label>
      <textarea id="cnReason" class="m-input" rows="3" maxlength="500" placeholder="Ex: Erreur de facturation, retour produit, geste commercial..." style="resize:vertical"></textarea>
      <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:.85rem;color:var(--text-2);cursor:pointer">
        <input type="checkbox" id="cnMarkCancelled">
        Marquer la facture originale comme annulée
      </label>
      <div style="font-size:.72rem;color:var(--text-4);margin-top:4px;padding-left:22px">Recommandé si la facture a été payée par erreur et que vous remboursez le client.</div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('creditNoteModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitCreditNote('${id}')">Émettre la note de crédit</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  guardModal(modal, { noBackdropClose: true });
  // M6 fix: trap focus in modal + ESC to close (accessibilité cohérente avec team.js)
  trapFocus(modal, () => closeModal('creditNoteModal'));
}

async function submitCreditNote(id){
  try{
    const reason=document.getElementById('cnReason')?.value?.trim()||null;
    const mark_original_cancelled=document.getElementById('cnMarkCancelled')?.checked||false;
    const r=await api.post(`/api/invoices/${id}/credit-note`,{reason,mark_original_cancelled});
    releaseFocus();
    closeModal('creditNoteModal');
    GendaUI.toast(`Note de crédit ${r.credit_note?.invoice_number||''} émise`,'success');
    loadInvoices();
  }catch(e){GendaUI.toast(e.message||'Erreur lors de l\'émission','error');}
}

async function createInvoiceFromBooking(bookingId){
  if(!(await showConfirmDialog('Créer une facture pour ce rendez-vous ?')))return;
  try{
    const r=await api.post('/api/invoices',{booking_id:bookingId,type:'invoice'});
    GendaUI.toast('Facture créée ! Retrouvez-la dans Facturation.','success');
    // Switch to invoices section
    document.querySelectorAll('.ni').forEach(n=>n.classList.remove('active'));
    document.querySelector('[data-section="invoices"]')?.classList.add('active');
    document.getElementById('pageTitle').textContent='Facturation';
    loadInvoices();
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function invClientChanged(){
  const clientId=document.getElementById('invClient')?.value;
  const section=document.getElementById('invUnbilledSection');
  const list=document.getElementById('invUnbilledList');
  if(!clientId||!section||!list){if(section)section.style.display='none';return;}
  try{
    const data=await api.get(`/api/invoices/unbilled?client_id=${clientId}`);
    _unbilledBookings=data.bookings||[];
  }catch(e){_unbilledBookings=[];}
  if(_unbilledBookings.length===0){section.style.display='none';return;}
  section.style.display='';
  list.innerHTML=_unbilledBookings.map((b,i)=>{
    const dt=new Date(b.start_at).toLocaleDateString('fr-BE',{timeZone:'Europe/Brussels'});
    const price=b.booked_price_cents??b.variant_price_cents??b.service_price_cents??0;
    const label=b.service_name+(b.variant_name?' \u2014 '+b.variant_name:'')+' ('+(b.practitioner_name||'?')+') \u2014 '+dt;
    const passBadge=b.pass_covered?' <span style="font-size:.68rem;color:var(--green);font-weight:600;padding:1px 6px;border-radius:4px;background:var(--green-bg)">Pass</span>':'';
    const promoTag=b.promotion_discount_cents>0?' <span style="font-size:.68rem;color:var(--green);font-weight:600">promo</span>':'';
    const priceLabel=b.pass_covered?'<span style="color:var(--green)">inclus</span>':fmtEur(price);
    return `<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid var(--border-light);background:${i%2===0?'var(--white)':'var(--surface)'}">
      <input type="checkbox" data-unbilled-idx="${i}" onchange="invToggleUnbilled(${i},this.checked)">
      <span style="flex:1">${esc(label)}${passBadge}</span>
      <span style="font-weight:600;color:var(--text-2)">${priceLabel}${promoTag}</span>
    </label>`;
  }).join('');
}

function invToggleUnbilled(idx,checked){
  const b=_unbilledBookings[idx];
  if(!b)return;
  const container=document.getElementById('invLines');
  if(!container)return;
  if(checked){
    const dt=new Date(b.start_at).toLocaleDateString('fr-BE',{timeZone:'Europe/Brussels'});
    const desc=b.service_name+(b.variant_name?' \u2014 '+b.variant_name:'')+' ('+(b.practitioner_name||'')+') \u2014 '+dt;
    const fullPrice=b.booked_price_cents??b.variant_price_cents??b.service_price_cents??0;

    if(b.pass_covered&&b.pass_info){
      // Pass-covered: service at 0€ + informational credit line
      _addInvoiceLineFromBooking(b.id,desc+' (inclus abonnement)',1,0);
      const pi=b.pass_info;
      const passDesc='1 cr\u00e9dit consomm\u00e9 \u2014 Pass '+pi.name+' ('+pi.sessions_remaining+'/'+pi.sessions_total+' restants)';
      const existing=[...container.querySelectorAll('.inv-desc')].some(el=>el.value===passDesc);
      if(!existing){
        _addInvoiceLineFromBooking(b.id,passDesc,1,0);
      }
    }else{
      _addInvoiceLineFromBooking(b.id,desc,1,fullPrice/100);
      // Promo discount line
      if(b.promotion_discount_cents>0&&b.promotion_label){
        const promoDesc='Réduction : '+b.promotion_label+(b.promotion_discount_pct?' (-'+b.promotion_discount_pct+'%)':'');
        _addInvoiceLineFromBooking(b.id,promoDesc,1,-(b.promotion_discount_cents/100));
      }
    }

    // Deposit deduction: handle split GC/Stripe payments
    if(b.deposit_status==='paid'&&b.deposit_amount_cents&&b.deposit_payment_intent_id){
      const gcCents=parseInt(b.gc_paid_cents)||0;
      const totalDep=parseInt(b.deposit_amount_cents)||0;

      if(b.deposit_payment_intent_id.startsWith('gc_')&&gcCents<=0){
        // Pure GC payment (legacy format)
        const gcCode=b.deposit_payment_intent_id.replace('gc_','');
        // Q6 fix: gc_absorbed (tiny remainder) — pas un vrai code, wording adapté
        const gcDesc=gcCode==='absorbed'?'Acompte pay\u00e9 (reste absorb\u00e9 par carte cadeau)':('Acompte pay\u00e9 (Carte cadeau '+gcCode+')');
        const existing=[...container.querySelectorAll('.inv-desc')].some(el=>el.value===gcDesc);
        if(!existing){
          _addInvoiceLineFromBooking(b.id,gcDesc,1,-(totalDep/100));
        }
      }else if(gcCents>0){
        // Split or full GC payment — show GC line
        const gcDesc='Acompte pay\u00e9 (Carte cadeau)';
        const existingGc=[...container.querySelectorAll('.inv-desc')].some(el=>el.value===gcDesc);
        if(!existingGc){
          _addInvoiceLineFromBooking(b.id,gcDesc,1,-(gcCents/100));
        }
        // Remaining via Stripe
        const stripeCents=totalDep-gcCents;
        if(stripeCents>0){
          const stripeDesc='Acompte pay\u00e9 (Stripe)';
          const existingSt=[...container.querySelectorAll('.inv-desc')].some(el=>el.value===stripeDesc);
          if(!existingSt){
            _addInvoiceLineFromBooking(b.id,stripeDesc,1,-(stripeCents/100));
          }
        }
      }else if(b.deposit_payment_intent_id.startsWith('pi_')||b.deposit_payment_intent_id.startsWith('cs_')){
        // Pure Stripe payment
        const depDesc='Acompte pay\u00e9 (Stripe)';
        const existing=[...container.querySelectorAll('.inv-desc')].some(el=>el.value===depDesc);
        if(!existing){
          _addInvoiceLineFromBooking(b.id,depDesc,1,-(totalDep/100));
        }
      }
    }
  }else{
    container.querySelectorAll(`[data-booking-id="${b.id}"]`).forEach(r=>r.remove());
  }
  updateInvTotals();
}

function _addInvoiceLineFromBooking(bookingId,desc,qty,priceEur){
  const container=document.getElementById('invLines');
  if(!container)return;
  const row=document.createElement('div');
  row.style.cssText='display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px';
  row.setAttribute('data-booking-id',bookingId);
  row.innerHTML=`
    <input class="inv-desc" value="${esc(desc)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="${qty}" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" value="${priceEur.toFixed(2)}" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" aria-label="Retirer la ligne" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
  container.appendChild(row);
}

// Expose invoiceFilter and invoiceType for inline onchange handlers
Object.defineProperty(window, 'invoiceFilter', { get(){return invoiceFilter;}, set(v){invoiceFilter=v;} });
Object.defineProperty(window, 'invoiceType', { get(){return invoiceType;}, set(v){invoiceType=v;} });

bridge({ loadInvoices, openInvoiceModal, addInvoiceLine, updateInvTotals, saveInvoice, changeInvoiceStatus, deleteInvoice, downloadInvoicePDF, createInvoiceFromBooking, invClientChanged, invToggleUnbilled, issueCreditNote, submitCreditNote });

export { loadInvoices, openInvoiceModal, addInvoiceLine, updateInvTotals, saveInvoice, changeInvoiceStatus, deleteInvoice, downloadInvoicePDF, createInvoiceFromBooking };
