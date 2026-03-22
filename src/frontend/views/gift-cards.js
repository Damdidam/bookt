/**
 * Gift Cards (Cartes cadeau) view module — staff dashboard management.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

let gcFilter='all',gcSearch='';
let _lastCards=[];

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function fmtEur(cents){return((cents||0)/100).toFixed(2).replace('.',',')+' \u20ac';}

async function loadGiftCards(){
  const c=document.getElementById('contentArea');
  c.innerHTML='<div class="loading"><div class="spinner"></div></div>';
  try{
    const params=new URLSearchParams();
    if(gcFilter!=='all')params.set('status',gcFilter);
    if(gcSearch.trim())params.set('search',gcSearch.trim());
    const data=await api.get(`/api/gift-cards?${params}`);
    const cards=data.gift_cards||[];
    _lastCards=cards;
    const st=data.stats||{};
    renderGiftCards(c,cards,st);
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;}
}

function renderGiftCards(c,cards,st){
  cards=cards||_lastCards;
  st=st||{};
  let h='';

  // ── KPI CARDS ──
  h+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat-card"><div class="label">Total vendu</div><div class="val" style="color:var(--primary)">${fmtEur(parseInt(st.total_sold_cents||0))}</div><div class="sub">${st.total_count||0} cartes</div></div>
    <div class="stat-card"><div class="label">Solde restant</div><div class="val" style="color:var(--gold)">${fmtEur(parseInt(st.remaining_balance_cents||0))}</div><div class="sub">non utilisé</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="gcFilter='active';loadGiftCards()"><div class="label">Cartes actives</div><div class="val" style="color:var(--green)">${st.active_count||0}</div><div class="sub">en circulation</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="gcFilter='used';loadGiftCards()"><div class="label">Cartes utilisées</div><div class="val" style="color:var(--text-3)">${st.used_count||0}</div><div class="sub">solde épuisé</div></div>
  </div>`;

  // ── FILTER BAR ──
  const filters=[
    {v:'all',l:'Toutes'},
    {v:'active',l:'Actives'},
    {v:'used',l:'Utilisées'},
    {v:'expired',l:'Expirées'},
    {v:'cancelled',l:'Annulées'}
  ];
  const filterBtns=filters.map(f=>{
    const active=gcFilter===f.v;
    return `<button onclick="gcFilter='${f.v}';loadGiftCards()" class="btn-sm${active?' active':''}">${f.l}</button>`;
  }).join('');

  h+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    ${filterBtns}
    <div style="flex:1"></div>
    <input type="text" placeholder="Rechercher par code ou nom..." value="${esc(gcSearch)}" onkeydown="if(event.key==='Enter'){gcSearch=this.value;loadGiftCards()}" onblur="gcSearch=this.value" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem;min-width:200px">
    <button onclick="openCreateGiftCardModal()" class="btn-primary"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Créer une carte</button>
  </div>`;

  // ── TABLE ──
  if(cards.length===0){
    h+=`<div class="card"><div class="empty">Aucune carte cadeau trouvée.</div></div>`;
  }else{
    h+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Code</th>
        <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant initial</th>
        <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Solde</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Destinataire</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Expiration</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`;

    const statusColors={active:'var(--green)',used:'var(--text-3)',expired:'var(--gold)',cancelled:'var(--red)'};
    const statusLabels={active:'Active',used:'Utilisée',expired:'Expirée',cancelled:'Annulée'};

    cards.forEach(gc=>{
      const sc=statusColors[gc.status]||'var(--text-4)';
      const createdDate=gc.created_at?new Date(gc.created_at).toLocaleDateString('fr-BE'):'—';
      const expiresDate=gc.expires_at?new Date(gc.expires_at).toLocaleDateString('fr-BE'):'—';
      const recipientName=gc.recipient_name||'—';
      const recipientEmail=gc.recipient_email||'';
      const isActive=gc.status==='active';
      const balanceCents=parseInt(gc.balance_cents||0);

      let actions='';
      if(isActive){
        actions+=`<button onclick="openDebitGiftCard('${gc.id}')" title="Débiter" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`;
        actions+=`<button onclick="refundGiftCard('${gc.id}')" title="Rembourser" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`;
        actions+=`<button onclick="cancelGiftCard('${gc.id}')" title="Annuler" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>`;
      }else{
        actions='<span style="color:var(--text-4)">—</span>';
      }

      h+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px"><span style="font-family:monospace;font-weight:600;font-size:.8rem;letter-spacing:.5px">${esc(gc.code)}</span></td>
        <td style="padding:10px;text-align:right;font-weight:600">${fmtEur(gc.amount_cents)}</td>
        <td style="padding:10px;text-align:right;font-weight:600;color:${balanceCents>0?'var(--green)':'var(--text-4)'}">${fmtEur(balanceCents)}</td>
        <td style="padding:10px"><div style="font-weight:500">${esc(recipientName)}</div>${recipientEmail?`<div style="font-size:.7rem;color:var(--text-4)">${esc(recipientEmail)}</div>`:''}</td>
        <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${sc}12;color:${sc};font-weight:600">${statusLabels[gc.status]||gc.status}</span></td>
        <td style="padding:10px;font-size:.78rem;color:var(--text-3)">${createdDate}</td>
        <td style="padding:10px;font-size:.78rem;color:var(--text-3)">${expiresDate}</td>
        <td style="padding:10px;text-align:center;white-space:nowrap">${actions}</td>
      </tr>`;
    });
    h+=`</tbody></table></div>`;
  }

  c.innerHTML=h;
}

// ── Create Gift Card Modal ──
function openCreateGiftCardModal(){
  const existing=document.getElementById('gcCreateModal');
  if(existing)existing.remove();

  const amountPills=[25,50,75,100,150,200];
  const pillsHtml=amountPills.map(a=>`<button type="button" onclick="selectGcAmount(${a*100})" class="gc-amount-pill" data-cents="${a*100}" style="padding:8px 16px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text-1);font-size:.85rem;font-weight:600;cursor:pointer">${a} \u20ac</button>`).join('');

  const modal=document.createElement('div');
  modal.className='m-overlay open';modal.id='gcCreateModal';
  modal.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>Créer une carte cadeau</h3>
      <button class="m-close" onclick="document.getElementById('gcCreateModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:16px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:8px">Montant</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${pillsHtml}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:.78rem;color:var(--text-3)">ou</span>
          <input type="number" id="gcCustomAmount" placeholder="Montant personnalisé" min="1" step="0.01" oninput="selectGcAmount(Math.round(this.value*100))" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;width:180px">
          <span style="font-size:.85rem;color:var(--text-3)">\u20ac</span>
        </div>
        <input type="hidden" id="gcSelectedAmount" value="">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Nom du destinataire</label>
        <input type="text" id="gcRecipientName" placeholder="Prénom Nom" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Email du destinataire <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="email" id="gcRecipientEmail" placeholder="email@exemple.com" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Message personnalisé <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <textarea id="gcMessage" rows="3" placeholder="Un petit mot pour le destinataire..." style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;resize:vertical;box-sizing:border-box"></textarea>
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('gcCreateModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitCreateGiftCard()">Créer la carte</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

function selectGcAmount(cents){
  document.getElementById('gcSelectedAmount').value=cents;
  // highlight selected pill
  document.querySelectorAll('.gc-amount-pill').forEach(btn=>{
    const pillCents=parseInt(btn.dataset.cents);
    if(pillCents===cents){
      btn.style.background='var(--primary)';btn.style.color='#fff';btn.style.borderColor='var(--primary)';
    }else{
      btn.style.background='var(--surface)';btn.style.color='var(--text-1)';btn.style.borderColor='var(--border)';
    }
  });
  // clear custom input if pill was clicked
  const customInput=document.getElementById('gcCustomAmount');
  if(customInput&&!customInput.matches(':focus')){customInput.value='';}
}

async function submitCreateGiftCard(){
  const amountCents=parseInt(document.getElementById('gcSelectedAmount').value);
  const recipientName=document.getElementById('gcRecipientName').value.trim();
  const recipientEmail=document.getElementById('gcRecipientEmail').value.trim();
  const message=document.getElementById('gcMessage').value.trim();

  if(!amountCents||amountCents<=0){GendaUI.toast('Veuillez sélectionner un montant','error');return;}
  if(!recipientName){GendaUI.toast('Veuillez saisir le nom du destinataire','error');return;}

  try{
    await api.post('/api/gift-cards',{
      amount_cents:amountCents,
      recipient_name:recipientName,
      recipient_email:recipientEmail||undefined,
      message:message||undefined
    });
    document.getElementById('gcCreateModal').remove();
    GendaUI.toast('Carte cadeau créée avec succès','success');
    loadGiftCards();
  }catch(e){GendaUI.toast(e.message||'Erreur lors de la création','error');}
}

// ── Debit Modal ──
function openDebitGiftCard(id){
  const gc=_lastCards.find(c=>c.id===id);
  if(!gc){GendaUI.toast('Carte introuvable','error');return;}

  const existing=document.getElementById('gcDebitModal');
  if(existing)existing.remove();

  const modal=document.createElement('div');
  modal.className='m-overlay open';modal.id='gcDebitModal';
  modal.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Débiter la carte ${esc(gc.code)}</h3>
      <button class="m-close" onclick="document.getElementById('gcDebitModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="font-size:.82rem;color:var(--text-3)">Solde disponible</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--green)">${fmtEur(gc.balance_cents)}</div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant à débiter</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="number" id="gcDebitAmount" min="0.01" max="${(parseInt(gc.balance_cents||0)/100).toFixed(2)}" step="0.01" placeholder="0,00" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.95rem;width:140px">
          <span style="font-size:.85rem;color:var(--text-3)">\u20ac</span>
          <button type="button" onclick="document.getElementById('gcDebitAmount').value='${(parseInt(gc.balance_cents||0)/100).toFixed(2)}'" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);font-size:.75rem;cursor:pointer;color:var(--text-3)">Tout</button>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Note <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="text" id="gcDebitNote" placeholder="Ex: Prestation coloration" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('gcDebitModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitDebitGiftCard('${gc.id}')">Débiter</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function submitDebitGiftCard(id){
  const amountVal=parseFloat(document.getElementById('gcDebitAmount').value);
  const note=document.getElementById('gcDebitNote').value.trim();
  if(!amountVal||amountVal<=0){GendaUI.toast('Veuillez saisir un montant valide','error');return;}

  try{
    await api.post(`/api/gift-cards/${id}/debit`,{
      amount_cents:Math.round(amountVal*100),
      note:note||undefined
    });
    document.getElementById('gcDebitModal').remove();
    GendaUI.toast('Carte débitée avec succès','success');
    loadGiftCards();
  }catch(e){GendaUI.toast(e.message||'Erreur lors du débit','error');}
}

// ── Refund ──
async function refundGiftCard(id){
  const gc=_lastCards.find(c=>c.id===id);
  if(!gc){GendaUI.toast('Carte introuvable','error');return;}

  const existing=document.getElementById('gcRefundModal');
  if(existing)existing.remove();

  const spent=parseInt(gc.amount_cents||0)-parseInt(gc.balance_cents||0);
  if(spent<=0){GendaUI.toast('Aucun montant à rembourser','error');return;}

  const modal=document.createElement('div');
  modal.className='m-overlay open';modal.id='gcRefundModal';
  modal.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Rembourser — ${esc(gc.code)}</h3>
      <button class="m-close" onclick="document.getElementById('gcRefundModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="display:flex;justify-content:space-between;font-size:.82rem">
          <span style="color:var(--text-3)">Montant initial</span><span style="font-weight:600">${fmtEur(gc.amount_cents)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Solde actuel</span><span style="font-weight:600;color:var(--green)">${fmtEur(gc.balance_cents)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Montant utilisé</span><span style="font-weight:600">${fmtEur(spent)}</span>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant à rembourser</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="number" id="gcRefundAmount" min="0.01" max="${(spent/100).toFixed(2)}" step="0.01" value="${(spent/100).toFixed(2)}" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.95rem;width:140px">
          <span style="font-size:.85rem;color:var(--text-3)">\u20ac</span>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Note <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="text" id="gcRefundNote" placeholder="Raison du remboursement" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('gcRefundModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitRefundGiftCard('${gc.id}')">Rembourser</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
}

async function submitRefundGiftCard(id){
  const amountVal=parseFloat(document.getElementById('gcRefundAmount').value);
  const note=document.getElementById('gcRefundNote').value.trim();
  if(!amountVal||amountVal<=0){GendaUI.toast('Veuillez saisir un montant valide','error');return;}

  try{
    await api.post(`/api/gift-cards/${id}/refund`,{
      amount_cents:Math.round(amountVal*100),
      note:note||undefined
    });
    document.getElementById('gcRefundModal').remove();
    GendaUI.toast('Remboursement effectué','success');
    loadGiftCards();
  }catch(e){GendaUI.toast(e.message||'Erreur lors du remboursement','error');}
}

// ── Cancel ──
async function cancelGiftCard(id){
  const gc=_lastCards.find(c=>c.id===id);
  if(!gc){GendaUI.toast('Carte introuvable','error');return;}
  if(!confirm(`Annuler la carte ${gc.code} ? Cette action est irréversible.`))return;

  try{
    await api.patch(`/api/gift-cards/${id}`,{status:'cancelled'});
    GendaUI.toast('Carte annulée','success');
    loadGiftCards();
  }catch(e){GendaUI.toast(e.message||'Erreur lors de l\'annulation','error');}
}

// Expose for inline handlers
Object.defineProperty(window,'gcFilter',{get(){return gcFilter;},set(v){gcFilter=v;},configurable:true});
Object.defineProperty(window,'gcSearch',{get(){return gcSearch;},set(v){gcSearch=v;},configurable:true});

bridge({loadGiftCards,openCreateGiftCardModal,selectGcAmount,submitCreateGiftCard,openDebitGiftCard,submitDebitGiftCard,refundGiftCard,submitRefundGiftCard,cancelGiftCard});

export {loadGiftCards,renderGiftCards};
