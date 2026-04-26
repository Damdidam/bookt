import{a as g,d as S,G as a,s as F,m as c,n as z}from"./dashboard-ClLD_fLX.js";import{trapFocus as $}from"./focus-trap-C-UMhpsq.js";import{i as T,s as P}from"./plan-gate-Badg7tzn.js";import{f as u}from"./format-DoZVPAsZ.js";import{r as j}from"./pagination-DxEIci4p.js";let m="all",v="",x=0;const w=50;let h={total_count:0,limit:w,offset:0},y=[],A=null,B=0,C={};function l(o){return String(o||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}let k=!0;async function f(){if(!T()){P(document.getElementById("contentArea"),"Cartes cadeau");return}const o=document.getElementById("contentArea");o.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const e=new URLSearchParams;m!=="all"&&e.set("status",m),v.trim()&&e.set("search",v.trim()),e.set("limit",String(w)),e.set("offset",String(x));const t=await g.get(`/api/gift-cards?${e}`),r=t.gift_cards||[];y=r,k=t.feature_enabled!==!1,h=t.pagination||{total_count:r.length,limit:w,offset:x};const i=t.stats||{};L(o,r,i)}catch(e){o.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${l(e.message)}</div>`}}function L(o,e,t){e=e||y,t=t||{};let r="";k||(r+=`<div class="card" style="padding:14px 18px;margin-bottom:14px;background:#FFF8E1;border-left:4px solid #F9A825">
      <div style="font-size:.85rem;font-weight:600;color:#5D4037">Les cartes cadeau sont désactivées</div>
      <div style="font-size:.78rem;color:#6D5344;margin-top:4px">Vous ne pouvez pas en créer de nouvelles tant que la fonctionnalité est désactivée. Les cartes existantes restent gérables (remboursement, débit). Pour activer : <a href="#" onclick="document.querySelector('[data-section=settings]')?.click();return false" style="color:#F9A825;font-weight:600;text-decoration:underline">Paramètres &rsaquo; Cartes cadeau</a>.</div>
    </div>`),r+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat-card"><div class="label">Total vendu</div><div class="val" style="color:var(--primary)">${u(parseInt(t.total_sold_cents||0))}</div><div class="sub">${t.total||0} cartes</div></div>
    <div class="stat-card"><div class="label">Solde restant</div><div class="val" style="color:var(--gold)">${u(parseInt(t.total_balance_cents||0))}</div><div class="sub">non utilisé</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="gcFilter='active';loadGiftCards()"><div class="label">Cartes actives</div><div class="val" style="color:var(--green)">${t.active_count||0}</div><div class="sub">en circulation</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="gcFilter='used';loadGiftCards()"><div class="label">Cartes utilisées</div><div class="val" style="color:var(--text-3)">${t.used_count||0}</div><div class="sub">solde épuisé</div></div>
  </div>`;const d=[{v:"all",l:"Toutes"},{v:"active",l:"Actives"},{v:"used",l:"Utilisées"},{v:"expired",l:"Expirées"},{v:"cancelled",l:"Annulées"}].map(s=>{const b=m===s.v;return`<button onclick="gcFilter='${s.v}';loadGiftCards()" class="btn-sm${b?" active":""}">${s.l}</button>`}).join("");if(r+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    ${d}
    <div style="flex:1"></div>
    <input type="text" placeholder="Rechercher par code ou nom..." value="${l(v)}" onkeydown="if(event.key==='Enter'){gcSearch=this.value;loadGiftCards()}" onblur="gcSearch=this.value;loadGiftCards()" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem;min-width:200px">
    ${k?'<button onclick="openCreateGiftCardModal()" class="btn-primary btn-sm"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Créer une carte</button>':'<button disabled title="Activez la fonctionnalité dans les Paramètres" aria-label="Activez la fonctionnalité dans les Paramètres" class="btn-primary btn-sm" style="opacity:.5;cursor:not-allowed"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Créer une carte</button>'}
  </div>`,e.length===0)r+='<div class="card"><div class="empty">Aucune carte cadeau trouvée.</div></div>';else{r+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Code</th>
        <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant initial</th>
        <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Solde</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Destinataire</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Expiration</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`;const s={active:"var(--green)",used:"var(--text-3)",expired:"var(--gold)",cancelled:"var(--red)"},b={active:"Active",used:"Utilisée",expired:"Expirée",cancelled:"Annulée"};e.forEach(n=>{const E=s[n.status]||"var(--text-4)",D=n.created_at?new Date(n.created_at).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"}):"—",I=n.expires_at?new Date(n.expires_at).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"}):"—",G=n.recipient_name||"—",M=n.recipient_email||"",R=n.status==="active",_=parseInt(n.balance_cents||0);let p="";R?(p+=`<button onclick="openDebitGiftCard('${n.id}')" title="Débiter" aria-label="Débiter" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`,p+=`<button onclick="refundGiftCard('${n.id}')" title="Rembourser" aria-label="Rembourser" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`,p+=`<button onclick="cancelGiftCard('${n.id}')" title="Annuler" aria-label="Annuler" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>`):n.status==="used"?p+=`<button onclick="refundGiftCard('${n.id}')" title="Rembourser" aria-label="Rembourser" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`:p='<span style="color:var(--text-4)">—</span>',r+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px"><span style="font-family:monospace;font-weight:600;font-size:.8rem;letter-spacing:.5px">${l(n.code)}</span></td>
        <td style="padding:10px;text-align:right;font-weight:600">${u(n.amount_cents)}</td>
        <td style="padding:10px;text-align:right;font-weight:600;color:${_>0?"var(--green)":"var(--text-4)"}">${u(_)}</td>
        <td style="padding:10px"><div style="font-weight:500">${l(G)}</div>${M?`<div style="font-size:.7rem;color:var(--text-4)">${l(M)}</div>`:""}</td>
        <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${E}12;color:${E};font-weight:600">${l(b[n.status]||n.status)}</span></td>
        <td style="padding:10px;font-size:.78rem;color:var(--text-3)">${D}</td>
        <td style="padding:10px;font-size:.78rem;color:var(--text-3)">${I}</td>
        <td style="padding:10px;text-align:center;white-space:nowrap">${p}</td>
      </tr>`}),r+="</tbody></table></div>",r+=j({total:h.total_count,limit:h.limit,offset:h.offset,onPage:"gcGoToPage",label:"cartes"})}o.innerHTML=r}function N(){c("gcCreateModal");const e=[25,50,75,100,150,200].map(r=>`<button type="button" onclick="selectGcAmount(${r*100})" class="gc-amount-pill" data-cents="${r*100}" style="padding:8px 16px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);color:var(--text-1);font-size:.85rem;font-weight:600;cursor:pointer">${r} €</button>`).join(""),t=document.createElement("div");t.className="m-overlay open",t.id="gcCreateModal",t.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>Créer une carte cadeau</h3>
      <button class="m-close" onclick="closeModal('gcCreateModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:16px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:8px">Montant</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">${e}</div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:.78rem;color:var(--text-3)">ou</span>
          <input type="number" id="gcCustomAmount" placeholder="Montant personnalisé" min="1" step="0.01" oninput="selectGcAmount(Math.round(this.value*100))" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;width:180px">
          <span style="font-size:.85rem;color:var(--text-3)">€</span>
        </div>
        <input type="hidden" id="gcSelectedAmount" value="">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Nom du destinataire</label>
        <div style="position:relative">
          <input type="text" id="gcRecipientName" placeholder="Tapez 3+ lettres pour chercher un client existant" oninput="gcClientLiveSearch(this.value)" onfocus="if(this.value.length>=3)gcClientLiveSearch(this.value)" onblur="setTimeout(()=>{const d=document.getElementById('gcClientAcDrop');if(d)d.style.display='none'},200)" autocomplete="off" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
          <div id="gcClientAcDrop" class="ac-results" style="display:none"></div>
        </div>
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
      <button class="m-btn m-btn-ghost" onclick="closeModal('gcCreateModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitCreateGiftCard()">Créer la carte</button>
    </div>
  </div>`,document.body.appendChild(t),z(t,{noBackdropClose:!0}),$(t,()=>c(t.id))}function q(o){document.getElementById("gcSelectedAmount").value=o,document.querySelectorAll(".gc-amount-pill").forEach(t=>{parseInt(t.dataset.cents)===o?(t.style.background="var(--primary)",t.style.color="#fff",t.style.borderColor="var(--primary)"):(t.style.background="var(--surface)",t.style.color="var(--text-1)",t.style.borderColor="var(--border)")});const e=document.getElementById("gcCustomAmount");e&&!e.matches(":focus")&&(e.value="")}function H(o){clearTimeout(A);const e=document.getElementById("gcClientAcDrop");if(e){if(o.length<3){e.style.display="none";return}A=setTimeout(async()=>{const t=++B;try{const r=await fetch(`/api/clients?search=${encodeURIComponent(o)}&limit=8`,{headers:{Authorization:"Bearer "+g.getToken()}});if(t!==B)return;const d=(await r.json()).clients||[];if(d.length===0){e.innerHTML=`<div style="padding:12px;text-align:center;font-size:.8rem;color:var(--text-4)">Aucun client trouvé pour "${l(o)}" — laissez le champ tel quel pour un nouveau destinataire</div>`,e.style.display="block";return}C={},d.forEach(s=>{C[s.id]=s}),e.innerHTML=d.map(s=>{const b=[s.phone,s.email].filter(Boolean).join(" · ");return`<div class="ac-item" onmousedown="event.preventDefault();gcPickClient('${s.id}')"><div class="ac-name">${l(s.full_name)}</div><div class="ac-meta">${l(b)||"—"}</div></div>`}).join(""),e.style.display="block"}catch{e.style.display="none"}},250)}}function V(o){const e=C[o];if(!e)return;const t=document.getElementById("gcRecipientName"),r=document.getElementById("gcRecipientEmail");t&&(t.value=e.full_name||""),r&&(r.value=e.email||"");const i=document.getElementById("gcClientAcDrop");i&&(i.style.display="none")}async function U(){const o=parseInt(document.getElementById("gcSelectedAmount").value),e=document.getElementById("gcRecipientName").value.trim(),t=document.getElementById("gcRecipientEmail").value.trim(),r=document.getElementById("gcMessage").value.trim();if(!o||o<=0){a.toast("Veuillez sélectionner un montant","error");return}if(!e){a.toast("Veuillez saisir le nom du destinataire","error");return}try{await g.post("/api/gift-cards",{amount_cents:o,recipient_name:e,recipient_email:t||void 0,message:r||void 0}),c("gcCreateModal"),a.toast("Carte cadeau créée avec succès","success"),f()}catch(i){a.toast(i.message||"Erreur lors de la création","error")}}function O(o){const e=y.find(r=>r.id===o);if(!e){a.toast("Carte introuvable","error");return}c("gcDebitModal");const t=document.createElement("div");t.className="m-overlay open",t.id="gcDebitModal",t.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Débiter la carte ${l(e.code)}</h3>
      <button class="m-close" onclick="closeModal('gcDebitModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="font-size:.82rem;color:var(--text-3)">Solde disponible</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--green)">${u(e.balance_cents)}</div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant à débiter</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="number" id="gcDebitAmount" min="0.01" max="${(parseInt(e.balance_cents||0)/100).toFixed(2)}" step="0.01" placeholder="0,00" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.95rem;width:140px">
          <span style="font-size:.85rem;color:var(--text-3)">€</span>
          <button type="button" onclick="document.getElementById('gcDebitAmount').value='${(parseInt(e.balance_cents||0)/100).toFixed(2)}'" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);background:var(--surface);font-size:.75rem;cursor:pointer;color:var(--text-3)">Tout</button>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Note <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="text" id="gcDebitNote" placeholder="Ex: Prestation coloration" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('gcDebitModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitDebitGiftCard('${e.id}')">Débiter</button>
    </div>
  </div>`,document.body.appendChild(t),z(t,{noBackdropClose:!0}),$(t,()=>c(t.id))}async function Z(o){const e=document.querySelector("#gcDebitModal .m-btn-primary");if(e?.disabled)return;const t=parseFloat(document.getElementById("gcDebitAmount").value),r=document.getElementById("gcDebitNote").value.trim();if(!t||t<=0){a.toast("Veuillez saisir un montant valide","error");return}e&&(e.disabled=!0,e.textContent="Traitement...");try{await g.post(`/api/gift-cards/${o}/debit`,{amount_cents:Math.round(t*100),note:r||void 0}),c("gcDebitModal"),a.toast("Carte débitée avec succès","success"),f()}catch(i){e&&(e.disabled=!1,e.textContent="Débiter"),a.toast(i.message||"Erreur lors du débit","error")}}async function J(o){const e=y.find(d=>d.id===o);if(!e){a.toast("Carte introuvable","error");return}c("gcRefundModal");const t=parseInt(e.amount_cents||0)-parseInt(e.balance_cents||0);if(t<=0){a.toast("Aucun montant à rembourser","error");return}const r=document.createElement("div");r.className="m-overlay open",r.id="gcRefundModal";const i=e.status==="used";r.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Rembourser — ${l(e.code)}</h3>
      <button class="m-close" onclick="closeModal('gcRefundModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      ${i?'<div style="background:#FEF3E2;border-left:3px solid #F59E0B;padding:10px 12px;margin-bottom:12px;border-radius:6px;font-size:.82rem;color:#92700C"><strong>Attention :</strong> cette carte a été entièrement utilisée. Vérifiez que le remboursement est légitime avant de continuer.</div>':""}
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="display:flex;justify-content:space-between;font-size:.82rem">
          <span style="color:var(--text-3)">Montant initial</span><span style="font-weight:600">${u(e.amount_cents)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Solde actuel</span><span style="font-weight:600;color:var(--green)">${u(e.balance_cents)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Montant utilisé</span><span style="font-weight:600">${u(t)}</span>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant à rembourser</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="number" id="gcRefundAmount" min="0.01" max="${(t/100).toFixed(2)}" step="0.01" value="${(t/100).toFixed(2)}" style="padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.95rem;width:140px">
          <span style="font-size:.85rem;color:var(--text-3)">€</span>
        </div>
      </div>
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Note <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="text" id="gcRefundNote" placeholder="Raison du remboursement" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('gcRefundModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitRefundGiftCard('${e.id}')">Rembourser</button>
    </div>
  </div>`,document.body.appendChild(r),z(r,{noBackdropClose:!0}),$(r,()=>c(r.id))}async function K(o){const e=document.querySelector("#gcRefundModal .m-btn-primary");if(e?.disabled)return;const t=parseFloat(document.getElementById("gcRefundAmount").value),r=document.getElementById("gcRefundNote").value.trim();if(!t||t<=0){a.toast("Veuillez saisir un montant valide","error");return}e&&(e.disabled=!0,e.textContent="Traitement...");try{const i=await g.post(`/api/gift-cards/${o}/refund`,{amount_cents:Math.round(t*100),note:r||void 0});if(c("gcRefundModal"),i&&i.stripe_refund_cents!=null){const d=(i.stripe_refund_cents/100).toFixed(2).replace(".",",")+" €";a.toast(`Remboursement effectué (${d} Stripe${i.stripe_fees_cents>0?" — frais "+(i.stripe_fees_cents/100).toFixed(2).replace(".",",")+" €":""})`,"success")}else a.toast("Remboursement effectué","success");f()}catch(i){e&&(e.disabled=!1,e.textContent="Rembourser"),a.toast(i.message||"Erreur lors du remboursement","error")}}async function Q(o){const e=y.find(r=>r.id===o);if(!e){a.toast("Carte introuvable","error");return}if(await F("Annuler la carte",`Annuler la carte ${e.code} ? Cette action est irréversible.`,"Annuler la carte","danger"))try{await g.patch(`/api/gift-cards/${o}`,{status:"cancelled"}),a.toast("Carte annulée","success"),f()}catch(r){a.toast(r.message||"Erreur lors de l'annulation","error")}}Object.defineProperty(window,"gcFilter",{get(){return m},set(o){m!==o&&(x=0),m=o},configurable:!0});Object.defineProperty(window,"gcSearch",{get(){return v},set(o){v!==o&&(x=0),v=o},configurable:!0});function W(o){x=Math.max(0,parseInt(o)||0),f()}S({loadGiftCards:f,openCreateGiftCardModal:N,selectGcAmount:q,submitCreateGiftCard:U,openDebitGiftCard:O,submitDebitGiftCard:Z,refundGiftCard:J,submitRefundGiftCard:K,cancelGiftCard:Q,gcClientLiveSearch:H,gcPickClient:V,gcGoToPage:W});export{f as loadGiftCards,L as renderGiftCards};
