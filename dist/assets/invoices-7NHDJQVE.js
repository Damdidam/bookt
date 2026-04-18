import{s as k,a as g,G as u,l as E,k as $,d as T}from"./dashboard-C6h3ptQ3.js";import{i as S,s as q}from"./plan-gate-Badg7tzn.js";import{r as A,t as D}from"./focus-trap-Vw_KJRtZ.js";let p="all",x="all",h=[];function v(o){return String(o||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function f(o){return((o||0)/100).toFixed(2).replace(".",",")+" €"}async function _(){if(!S()){q(document.getElementById("contentArea"),"Facturation");return}const o=document.getElementById("contentArea");o.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const t=new URLSearchParams;p!=="all"&&t.set("status",p),x!=="all"&&t.set("type",x);const e=await g.get(`/api/invoices?${t}`),i=e.invoices||[],r=e.stats||{};let s="";s+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="label">Brouillons</div><div class="val">${r.drafts||0}</div></div>
      <div class="stat-card"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${f(parseInt(r.total_pending||0))}</div><div class="sub">${parseInt(r.sent||0)+parseInt(r.overdue||0)} factures</div></div>
      <div class="stat-card"><div class="label">Payées</div><div class="val" style="color:var(--green)">${f(parseInt(r.total_paid||0))}</div><div class="sub">${r.paid||0} factures</div></div>
      <div class="stat-card"><div class="label">En retard</div><div class="val" style="color:var(--red)">${r.overdue||0}</div></div>
    </div>`,s+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
      <button onclick="openInvoiceModal()" class="btn-primary btn-sm">+ Nouvelle facture</button>
      <button onclick="openInvoiceModal('quote')" class="btn-primary btn-sm" style="background:var(--gold)">+ Devis</button>
      <div style="flex:1"></div>
      <select onchange="invoiceType=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${x==="all"?"selected":""}>Tous types</option>
        <option value="invoice" ${x==="invoice"?"selected":""}>Factures</option>
        <option value="quote" ${x==="quote"?"selected":""}>Devis</option>
        <option value="credit_note" ${x==="credit_note"?"selected":""}>Notes de crédit</option>
      </select>
      <select onchange="invoiceFilter=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${p==="all"?"selected":""}>Tous statuts</option>
        <option value="draft" ${p==="draft"?"selected":""}>Brouillons</option>
        <option value="sent" ${p==="sent"?"selected":""}>Envoyées</option>
        <option value="paid" ${p==="paid"?"selected":""}>Payées</option>
        <option value="overdue" ${p==="overdue"?"selected":""}>En retard</option>
        <option value="cancelled" ${p==="cancelled"?"selected":""}>Annulées</option>
      </select>
    </div>`,i.length===0?s+='<div class="card"><div class="empty">Aucune facture. Créez votre première facture ou devis !</div></div>':(s+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">N°</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Type</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant TTC</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
        </tr></thead><tbody>`,i.forEach(n=>{const l={draft:"var(--text-4)",sent:"var(--gold)",paid:"var(--green)",overdue:"var(--red)",cancelled:"var(--text-4)"},c={draft:"Brouillon",sent:"Envoyée",paid:"Payée",overdue:"En retard",cancelled:"Annulée"},d={invoice:"Facture",quote:"Devis",credit_note:"Note crédit"},y={invoice:"var(--primary)",quote:"var(--gold)",credit_note:"var(--text-3)"},m=l[n.status]||"var(--text-4)",I=new Date(n.issue_date).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"});s+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px;font-weight:600">${v(n.invoice_number)}</td>
          <td style="padding:10px"><span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${y[n.type]}15;color:${y[n.type]};font-weight:600">${d[n.type]||n.type}</span></td>
          <td style="padding:10px">${v(n.client_name)}</td>
          <td style="padding:10px;color:var(--text-3)">${I}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${f(n.total_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${m}12;color:${m};font-weight:600">${c[n.status]||n.status}</span></td>
          <td style="padding:10px;text-align:right">
            <button onclick="downloadInvoicePDF('${n.id}')" title="Télécharger PDF" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
            ${n.status==="draft"?`<button onclick="changeInvoiceStatus('${n.id}','sent')" title="Marquer envoyée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`:""}
            ${n.status==="sent"||n.status==="overdue"?`<button onclick="changeInvoiceStatus('${n.id}','paid')" title="Marquer payée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`:""}
            ${n.type==="invoice"&&["sent","paid","overdue"].includes(n.status)?`<button onclick="issueCreditNote('${n.id}','${v(n.invoice_number||"")}')" title="Émettre une note de crédit (conformité BE)" style="background:none;border:none;cursor:pointer;font-size:1rem;color:var(--gold)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg></button>`:""}
            ${n.status==="draft"?`<button onclick="deleteInvoice('${n.id}')" title="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`:""}
          </td>
        </tr>`}),s+="</tbody></table></div>"),g.getBusiness()?.settings?.iban||(s+=`<div class="card" style="background:var(--gold-bg);border:1px solid #E0D4A8;margin-top:14px;padding:14px 18px">
        <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Ajoutez votre IBAN</strong> dans Paramètres → Infos salon pour l'afficher sur vos factures et générer la communication structurée belge.</p>
      </div>`),o.innerHTML=s}catch(t){o.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${v(t.message)}</div>`}}async function L(o="invoice",t={}){let e=[];try{const a=await g.get("/api/clients");e=a.clients||a||[]}catch(a){console.warn("Impossible de charger les clients pour la facture:",a.message)}const i=o==="quote",r=i?"Nouveau devis":"Nouvelle facture",s=document.createElement("div");if(s.className="m-overlay open",s.id="invModal",s.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${r}</h3>
      <button class="m-close" onclick="closeModal('invModal')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="m-body" style="display:grid;gap:12px">
      <div>
        <label class="m-field-label">Client</label>
        <select class="m-input" id="invClient" onchange="invClientChanged()">
          <option value="">— Sélectionner un client —</option>
          ${e.map(a=>`<option value="${a.id}">${v(a.full_name)}${a.email?" ("+v(a.email)+")":""}</option>`).join("")}
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
          <label class="m-field-label">${i?"Validité (jours)":"Échéance (jours)"}</label>
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
      <button class="m-btn m-btn-primary" onclick="saveInvoice('${o}')">${i?"Créer le devis":"Créer la facture"}</button>
    </div>
  </div>`,document.body.appendChild(s),E(document.getElementById("invModal"),{noBackdropClose:!0}),C(),w(),t.preselect_client_id){const a=document.getElementById("invClient");a&&(a.value=t.preselect_client_id),await B(),(t.precheck_booking_id||t.precheck_group_id)&&setTimeout(()=>{h.forEach((n,l)=>{if(t.precheck_booking_id&&n.id===t.precheck_booking_id||t.precheck_group_id&&n.group_id===t.precheck_group_id){const d=document.querySelector(`[data-unbilled-idx="${l}"]`);d&&!d.checked&&(d.checked=!0,z(l,!0))}})},100)}}function C(){const o=document.getElementById("invLines");if(!o)return;const t=document.createElement("div");t.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",t.innerHTML=`
    <input class="inv-desc" placeholder="Description prestation" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="1" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" placeholder="Prix €" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,o.appendChild(t)}function w(){const o=document.getElementById("invLines"),t=document.getElementById("invTotals");if(!o||!t)return;const e=parseFloat(document.getElementById("invVat")?.value||21);let i=0;o.querySelectorAll(":scope > div").forEach(n=>{const l=parseFloat(n.querySelector(".inv-qty")?.value||1),c=parseFloat(n.querySelector(".inv-price")?.value||0);i+=l*c*100});const r=Math.round(i*e/(100+e)),s=i,a=i-r;t.innerHTML=`
    <div style="font-size:.82rem;color:var(--text-3)">Sous-total HTVA : <strong>${f(a)}</strong></div>
    <div style="font-size:.82rem;color:var(--text-3)">TVA (${e}%) : <strong>${f(r)}</strong></div>
    <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:4px">Total TTC : ${f(s)}</div>`}async function F(o){const t=document.getElementById("invClient")?.value;if(!t){u.toast("Sélectionnez un client","error");return}const e=document.getElementById("invLines"),i=[];if(e.querySelectorAll(":scope > div").forEach(r=>{const s=r.querySelector(".inv-desc")?.value?.trim(),a=parseFloat(r.querySelector(".inv-qty")?.value||1),n=parseFloat(r.querySelector(".inv-price")?.value||0),l=r.getAttribute("data-booking-id")||void 0;s&&n!==0&&i.push({description:s,quantity:a,unit_price_cents:Math.round(n*100),booking_id:l})}),i.length===0){u.toast("Ajoutez au moins une ligne","error");return}try{const r={client_id:t,type:o||"invoice",items:i,vat_rate:parseFloat(document.getElementById("invVat")?.value||21),due_days:parseInt(document.getElementById("invDueDays")?.value||30),client_bce:document.getElementById("invClientBce")?.value?.trim()||void 0,notes:document.getElementById("invNotes")?.value?.trim()||void 0},s=await g.post("/api/invoices",r);document.getElementById("invModal")._dirtyGuard?.markClean(),$("invModal"),u.toast(o==="quote"?"Devis créé !":"Facture créée !","success"),_()}catch(r){u.toast(r.message||"Erreur","error")}}async function N(o,t){if(await k("Changer le statut",{sent:"Marquer comme envoyée ?",paid:"Marquer comme payée ?"}[t]||`Changer le statut en "${t}" ?`,"Confirmer"))try{await g.patch(`/api/invoices/${o}/status`,{status:t}),u.toast("Statut mis à jour","success"),_()}catch(r){u.toast(r.message||"Erreur","error")}}async function j(o){if(await k("Supprimer le brouillon","Supprimer ce brouillon ?","Supprimer","danger"))try{await g.delete(`/api/invoices/${o}`),u.toast("Brouillon supprimé","success"),_()}catch(e){u.toast(e.message||"Erreur","error")}}function P(o){const t=localStorage.getItem("genda_token");window.open(`/api/invoices/${o}/pdf?token=${t}`,"_blank","noopener,noreferrer")}async function X(o,t){const e=document.createElement("div");e.className="m-overlay open",e.id="creditNoteModal",e.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Note de crédit — ${v(t)}</h3>
      <button class="m-close" onclick="closeModal('creditNoteModal')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--gold-bg,#FEF9C3);border-left:3px solid var(--gold);border-radius:var(--radius-xs)">
        <div style="font-size:.85rem;color:var(--text-2);font-weight:600;margin-bottom:4px">Conformité légale BE (AR n°1 art.14)</div>
        <div style="font-size:.8rem;color:var(--text-3)">Une note de crédit sera émise (numérotation NC-${new Date().getFullYear()}-XXXXXX) avec tous les montants négatifs. Elle référencera la facture ${v(t)}.</div>
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
      <button class="m-btn m-btn-primary" onclick="submitCreditNote('${o}')">Émettre la note de crédit</button>
    </div>
  </div>`,document.body.appendChild(e),E(e,{noBackdropClose:!0}),D(e,()=>$("creditNoteModal"))}async function V(o){try{const t=document.getElementById("cnReason")?.value?.trim()||null,e=document.getElementById("cnMarkCancelled")?.checked||!1,i=await g.post(`/api/invoices/${o}/credit-note`,{reason:t,mark_original_cancelled:e});A(),$("creditNoteModal"),u.toast(`Note de crédit ${i.credit_note?.invoice_number||""} émise`,"success"),_()}catch(t){u.toast(t.message||"Erreur lors de l'émission","error")}}async function H(o){if(await k("Créer une facture pour ce rendez-vous ?"))try{const t=await g.post("/api/invoices",{booking_id:o,type:"invoice"});u.toast("Facture créée ! Retrouvez-la dans Facturation.","success"),document.querySelectorAll(".ni").forEach(e=>e.classList.remove("active")),document.querySelector('[data-section="invoices"]')?.classList.add("active"),document.getElementById("pageTitle").textContent="Facturation",_()}catch(t){u.toast(t.message||"Erreur","error")}}async function B(){const o=document.getElementById("invClient")?.value,t=document.getElementById("invUnbilledSection"),e=document.getElementById("invUnbilledList");if(!o||!t||!e){t&&(t.style.display="none");return}try{h=(await g.get(`/api/invoices/unbilled?client_id=${o}`)).bookings||[]}catch{h=[]}if(h.length===0){t.style.display="none";return}t.style.display="",e.innerHTML=h.map((i,r)=>{const s=new Date(i.start_at).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"}),a=i.booked_price_cents??i.variant_price_cents??i.service_price_cents??0,n=i.service_name+(i.variant_name?" — "+i.variant_name:"")+" ("+(i.practitioner_name||"?")+") — "+s,l=i.pass_covered?' <span style="font-size:.68rem;color:var(--green);font-weight:600;padding:1px 6px;border-radius:4px;background:var(--green-bg)">Pass</span>':"",c=i.promotion_discount_cents>0?' <span style="font-size:.68rem;color:var(--green);font-weight:600">promo</span>':"",d=i.pass_covered?'<span style="color:var(--green)">inclus</span>':f(a);return`<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid var(--border-light);background:${r%2===0?"var(--white)":"var(--surface)"}">
      <input type="checkbox" data-unbilled-idx="${r}" onchange="invToggleUnbilled(${r},this.checked)">
      <span style="flex:1">${v(n)}${l}</span>
      <span style="font-weight:600;color:var(--text-2)">${d}${c}</span>
    </label>`}).join("")}function z(o,t){const e=h[o];if(!e)return;const i=document.getElementById("invLines");if(i){if(t){const r=new Date(e.start_at).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"}),s=e.service_name+(e.variant_name?" — "+e.variant_name:"")+" ("+(e.practitioner_name||"")+") — "+r,a=e.booked_price_cents??e.variant_price_cents??e.service_price_cents??0;if(e.pass_covered&&e.pass_info){b(e.id,s+" (inclus abonnement)",1,0);const n=e.pass_info,l="1 crédit consommé — Pass "+n.name+" ("+n.sessions_remaining+"/"+n.sessions_total+" restants)";[...i.querySelectorAll(".inv-desc")].some(d=>d.value===l)||b(e.id,l,1,0)}else if(b(e.id,s,1,a/100),e.promotion_discount_cents>0&&e.promotion_label){const n="Réduction : "+e.promotion_label+(e.promotion_discount_pct?" (-"+e.promotion_discount_pct+"%)":"");b(e.id,n,1,-(e.promotion_discount_cents/100))}if(e.deposit_status==="paid"&&e.deposit_amount_cents&&e.deposit_payment_intent_id){const n=parseInt(e.gc_paid_cents)||0,l=parseInt(e.deposit_amount_cents)||0;if(e.deposit_payment_intent_id.startsWith("gc_")&&n<=0){const c=e.deposit_payment_intent_id.replace("gc_",""),d=c==="absorbed"?"Acompte payé (reste absorbé par carte cadeau)":"Acompte payé (Carte cadeau "+c+")";[...i.querySelectorAll(".inv-desc")].some(m=>m.value===d)||b(e.id,d,1,-(l/100))}else if(n>0){const c="Acompte payé (Carte cadeau)";[...i.querySelectorAll(".inv-desc")].some(m=>m.value===c)||b(e.id,c,1,-(n/100));const y=l-n;if(y>0){const m="Acompte payé (Stripe)";[...i.querySelectorAll(".inv-desc")].some(M=>M.value===m)||b(e.id,m,1,-(y/100))}}else if(e.deposit_payment_intent_id.startsWith("pi_")||e.deposit_payment_intent_id.startsWith("cs_")){const c="Acompte payé (Stripe)";[...i.querySelectorAll(".inv-desc")].some(y=>y.value===c)||b(e.id,c,1,-(l/100))}}}else i.querySelectorAll(`[data-booking-id="${e.id}"]`).forEach(r=>r.remove());w()}}function b(o,t,e,i){const r=document.getElementById("invLines");if(!r)return;const s=document.createElement("div");s.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",s.setAttribute("data-booking-id",o),s.innerHTML=`
    <input class="inv-desc" value="${v(t)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="${e}" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" value="${i.toFixed(2)}" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,r.appendChild(s)}Object.defineProperty(window,"invoiceFilter",{get(){return p},set(o){p=o}});Object.defineProperty(window,"invoiceType",{get(){return x},set(o){x=o}});T({loadInvoices:_,openInvoiceModal:L,addInvoiceLine:C,updateInvTotals:w,saveInvoice:F,changeInvoiceStatus:N,deleteInvoice:j,downloadInvoicePDF:P,createInvoiceFromBooking:H,invClientChanged:B,invToggleUnbilled:z,issueCreditNote:X,submitCreditNote:V});export{C as addInvoiceLine,N as changeInvoiceStatus,H as createInvoiceFromBooking,j as deleteInvoice,P as downloadInvoicePDF,_ as loadInvoices,L as openInvoiceModal,F as saveInvoice,w as updateInvTotals};
