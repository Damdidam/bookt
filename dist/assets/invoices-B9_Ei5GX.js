import{s as E,a as y,G as u,m as M,l as $,d as A}from"./dashboard-Bl8HquO3.js";import{i as D,s as F}from"./plan-gate-Badg7tzn.js";import{trapFocus as z,releaseFocus as L}from"./focus-trap-C-UMhpsq.js";import{f}from"./format-DoZVPAsZ.js";import{r as N}from"./pagination-DxEIci4p.js";let p="all",g="all",k=0;const B=50;let _=[];function v(n){return String(n||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}async function h(){if(!D()){F(document.getElementById("contentArea"),"Facturation");return}const n=document.getElementById("contentArea");n.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const t=new URLSearchParams;p!=="all"&&t.set("status",p),g!=="all"&&t.set("type",g),t.set("limit",String(B)),t.set("offset",String(k));const e=await y.get(`/api/invoices?${t}`),o=e.invoices||[],r=e.stats||{},s=e.pagination||{total_count:o.length,limit:B,offset:k};let a="";a+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="label">Brouillons</div><div class="val">${r.drafts||0}</div></div>
      <div class="stat-card"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${f(parseInt(r.total_pending||0))}</div><div class="sub">${parseInt(r.sent||0)+parseInt(r.overdue||0)} factures</div></div>
      <div class="stat-card"><div class="label">Payées</div><div class="val" style="color:var(--green)">${f(parseInt(r.total_paid||0))}</div><div class="sub">${r.paid||0} factures</div></div>
      <div class="stat-card"><div class="label">En retard</div><div class="val" style="color:var(--red)">${r.overdue||0}</div></div>
    </div>`,a+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
      <button onclick="openInvoiceModal()" class="btn-primary btn-sm">+ Nouvelle facture</button>
      <button onclick="openInvoiceModal('quote')" class="btn-primary btn-sm" style="background:var(--gold)">+ Devis</button>
      <div style="flex:1"></div>
      <select onchange="invoiceType=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${g==="all"?"selected":""}>Tous types</option>
        <option value="invoice" ${g==="invoice"?"selected":""}>Factures</option>
        <option value="quote" ${g==="quote"?"selected":""}>Devis</option>
        <option value="credit_note" ${g==="credit_note"?"selected":""}>Notes de crédit</option>
      </select>
      <select onchange="invoiceFilter=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${p==="all"?"selected":""}>Tous statuts</option>
        <option value="draft" ${p==="draft"?"selected":""}>Brouillons</option>
        <option value="sent" ${p==="sent"?"selected":""}>Envoyées</option>
        <option value="paid" ${p==="paid"?"selected":""}>Payées</option>
        <option value="overdue" ${p==="overdue"?"selected":""}>En retard</option>
        <option value="cancelled" ${p==="cancelled"?"selected":""}>Annulées</option>
      </select>
    </div>`,o.length===0?a+='<div class="card"><div class="empty">Aucune facture. Créez votre première facture ou devis !</div></div>':(a+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">N°</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Type</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant TTC</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
        </tr></thead><tbody>`,o.forEach(i=>{const c={draft:"var(--text-4)",sent:"var(--gold)",paid:"var(--green)",overdue:"var(--red)",cancelled:"var(--text-4)"},d={draft:"Brouillon",sent:"Envoyée",paid:"Payée",overdue:"En retard",cancelled:"Annulée"},x={invoice:"Facture",quote:"Devis",credit_note:"Note crédit"},m={invoice:"var(--primary)",quote:"var(--gold)",credit_note:"var(--text-3)"},w=c[i.status]||"var(--text-4)",I=new Date(i.issue_date).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"});a+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px;font-weight:600">${v(i.invoice_number)}</td>
          <td style="padding:10px"><span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${m[i.type]}15;color:${m[i.type]};font-weight:600">${x[i.type]||i.type}</span></td>
          <td style="padding:10px">${v(i.client_name)}</td>
          <td style="padding:10px;color:var(--text-3)">${I}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${f(i.total_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${w}12;color:${w};font-weight:600">${d[i.status]||i.status}</span></td>
          <td style="padding:10px;text-align:right">
            <button onclick="downloadInvoicePDF('${i.id}')" title="Télécharger PDF" aria-label="Télécharger PDF" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
            ${i.status==="draft"?`<button onclick="changeInvoiceStatus('${i.id}','sent')" title="Marquer envoyée" aria-label="Marquer envoyée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`:""}
            ${i.status==="sent"||i.status==="overdue"?`<button onclick="changeInvoiceStatus('${i.id}','paid')" title="Marquer payée" aria-label="Marquer payée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`:""}
            ${i.type==="invoice"&&["sent","paid","overdue"].includes(i.status)?`<button onclick="issueCreditNote('${i.id}','${v(i.invoice_number||"")}')" title="Émettre une note de crédit (conformité BE)" aria-label="Émettre une note de crédit (conformité BE)" style="background:none;border:none;cursor:pointer;font-size:1rem;color:var(--gold)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="15" x2="15" y2="15"/></svg></button>`:""}
            ${i.status==="draft"?`<button onclick="deleteInvoice('${i.id}')" title="Supprimer" aria-label="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`:""}
          </td>
        </tr>`}),a+="</tbody></table></div>",a+=N({total:s.total_count,limit:s.limit,offset:s.offset,onPage:"invoicesGoToPage",label:"factures"})),y.getBusiness()?.settings?.iban||(a+=`<div class="card" style="background:var(--gold-bg);border:1px solid #E0D4A8;margin-top:14px;padding:14px 18px">
        <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Ajoutez votre IBAN</strong> dans Paramètres → Infos salon pour l'afficher sur vos factures et générer la communication structurée belge.</p>
      </div>`),n.innerHTML=a}catch(t){n.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${v(t.message)}</div>`}}async function P(n="invoice",t={}){let e=[];try{const a=await y.get("/api/clients");e=a.clients||a||[]}catch(a){console.warn("Impossible de charger les clients pour la facture:",a.message)}const o=n==="quote",r=o?"Nouveau devis":"Nouvelle facture",s=document.createElement("div");if(s.className="m-overlay open",s.id="invModal",s.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${r}</h3>
      <button class="m-close" onclick="closeModal('invModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
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
          <label class="m-field-label">${o?"Validité (jours)":"Échéance (jours)"}</label>
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
      <button class="m-btn m-btn-primary" onclick="saveInvoice('${n}')">${o?"Créer le devis":"Créer la facture"}</button>
    </div>
  </div>`,document.body.appendChild(s),M(document.getElementById("invModal"),{noBackdropClose:!0}),z(document.getElementById("invModal"),()=>$("invModal")),T(),C(),t.preselect_client_id){const a=document.getElementById("invClient");a&&(a.value=t.preselect_client_id),await S(),(t.precheck_booking_id||t.precheck_group_id)&&setTimeout(()=>{_.forEach((l,i)=>{if(t.precheck_booking_id&&l.id===t.precheck_booking_id||t.precheck_group_id&&l.group_id===t.precheck_group_id){const d=document.querySelector(`[data-unbilled-idx="${i}"]`);d&&!d.checked&&(d.checked=!0,q(i,!0))}})},100)}}function T(){const n=document.getElementById("invLines");if(!n)return;const t=document.createElement("div");t.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",t.innerHTML=`
    <input class="inv-desc" placeholder="Description prestation" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="1" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" placeholder="Prix €" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" aria-label="Retirer la ligne" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,n.appendChild(t)}function C(){const n=document.getElementById("invLines"),t=document.getElementById("invTotals");if(!n||!t)return;const e=parseFloat(document.getElementById("invVat")?.value||21);let o=0;n.querySelectorAll(":scope > div").forEach(l=>{const i=parseFloat(l.querySelector(".inv-qty")?.value||1),c=parseFloat(l.querySelector(".inv-price")?.value||0);o+=i*c*100});const r=Math.round(o*e/(100+e)),s=o,a=o-r;t.innerHTML=`
    <div style="font-size:.82rem;color:var(--text-3)">Sous-total HTVA : <strong>${f(a)}</strong></div>
    <div style="font-size:.82rem;color:var(--text-3)">TVA (${e}%) : <strong>${f(r)}</strong></div>
    <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:4px">Total TTC : ${f(s)}</div>`}async function j(n){const t=document.getElementById("invClient")?.value;if(!t){u.toast("Sélectionnez un client","error");return}const e=document.getElementById("invLines"),o=[];if(e.querySelectorAll(":scope > div").forEach(r=>{const s=r.querySelector(".inv-desc")?.value?.trim(),a=parseFloat(r.querySelector(".inv-qty")?.value||1),l=parseFloat(r.querySelector(".inv-price")?.value||0),i=r.getAttribute("data-booking-id")||void 0;s&&l!==0&&o.push({description:s,quantity:a,unit_price_cents:Math.round(l*100),booking_id:i})}),o.length===0){u.toast("Ajoutez au moins une ligne","error");return}try{const r={client_id:t,type:n||"invoice",items:o,vat_rate:parseFloat(document.getElementById("invVat")?.value||21),due_days:parseInt(document.getElementById("invDueDays")?.value||30),client_bce:document.getElementById("invClientBce")?.value?.trim()||void 0,notes:document.getElementById("invNotes")?.value?.trim()||void 0},s=await y.post("/api/invoices",r);document.getElementById("invModal")._dirtyGuard?.markClean(),$("invModal"),u.toast(n==="quote"?"Devis créé !":"Facture créée !","success"),h()}catch(r){u.toast(r.message||"Erreur","error")}}async function V(n,t){if(await E("Changer le statut",{sent:"Marquer comme envoyée ?",paid:"Marquer comme payée ?"}[t]||`Changer le statut en "${t}" ?`,"Confirmer"))try{await y.patch(`/api/invoices/${n}/status`,{status:t}),u.toast("Statut mis à jour","success"),h()}catch(r){u.toast(r.message||"Erreur","error")}}async function X(n){if(await E("Supprimer le brouillon","Supprimer ce brouillon ?","Supprimer","danger"))try{await y.delete(`/api/invoices/${n}`),u.toast("Brouillon supprimé","success"),h()}catch(e){u.toast(e.message||"Erreur","error")}}function H(n){const t=localStorage.getItem("genda_token");window.open(`/api/invoices/${n}/pdf?token=${t}`,"_blank","noopener,noreferrer")}async function R(n,t){const e=document.createElement("div");e.className="m-overlay open",e.id="creditNoteModal",e.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Note de crédit — ${v(t)}</h3>
      <button class="m-close" onclick="closeModal('creditNoteModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
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
      <button class="m-btn m-btn-primary" onclick="submitCreditNote('${n}')">Émettre la note de crédit</button>
    </div>
  </div>`,document.body.appendChild(e),M(e,{noBackdropClose:!0}),z(e,()=>$("creditNoteModal"))}async function G(n){try{const t=document.getElementById("cnReason")?.value?.trim()||null,e=document.getElementById("cnMarkCancelled")?.checked||!1,o=await y.post(`/api/invoices/${n}/credit-note`,{reason:t,mark_original_cancelled:e});L(),$("creditNoteModal"),u.toast(`Note de crédit ${o.credit_note?.invoice_number||""} émise`,"success"),h()}catch(t){u.toast(t.message||"Erreur lors de l'émission","error")}}async function U(n){if(await E("Créer une facture pour ce rendez-vous ?"))try{const t=await y.post("/api/invoices",{booking_id:n,type:"invoice"});u.toast("Facture créée ! Retrouvez-la dans Facturation.","success"),document.querySelectorAll(".ni").forEach(e=>e.classList.remove("active")),document.querySelector('[data-section="invoices"]')?.classList.add("active"),document.getElementById("pageTitle").textContent="Facturation",h()}catch(t){u.toast(t.message||"Erreur","error")}}async function S(){const n=document.getElementById("invClient")?.value,t=document.getElementById("invUnbilledSection"),e=document.getElementById("invUnbilledList");if(!n||!t||!e){t&&(t.style.display="none");return}try{_=(await y.get(`/api/invoices/unbilled?client_id=${n}`)).bookings||[]}catch{_=[]}if(_.length===0){t.style.display="none";return}t.style.display="",e.innerHTML=_.map((o,r)=>{const s=new Date(o.start_at).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"}),a=o.booked_price_cents??o.variant_price_cents??o.service_price_cents??0,l=o.service_name+(o.variant_name?" — "+o.variant_name:"")+" ("+(o.practitioner_name||"?")+") — "+s,i=o.pass_covered?' <span style="font-size:.68rem;color:var(--green);font-weight:600;padding:1px 6px;border-radius:4px;background:var(--green-bg)">Pass</span>':"",c=o.promotion_discount_cents>0?' <span style="font-size:.68rem;color:var(--green);font-weight:600">promo</span>':"",d=o.pass_covered?'<span style="color:var(--green)">inclus</span>':f(a);return`<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid var(--border-light);background:${r%2===0?"var(--white)":"var(--surface)"}">
      <input type="checkbox" data-unbilled-idx="${r}" onchange="invToggleUnbilled(${r},this.checked)">
      <span style="flex:1">${v(l)}${i}</span>
      <span style="font-weight:600;color:var(--text-2)">${d}${c}</span>
    </label>`}).join("")}function q(n,t){const e=_[n];if(!e)return;const o=document.getElementById("invLines");if(o){if(t){const r=new Date(e.start_at).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"}),s=e.service_name+(e.variant_name?" — "+e.variant_name:"")+" ("+(e.practitioner_name||"")+") — "+r,a=e.booked_price_cents??e.variant_price_cents??e.service_price_cents??0;if(e.pass_covered&&e.pass_info){b(e.id,s+" (inclus abonnement)",1,0);const l=e.pass_info,i="1 crédit consommé — Pass "+l.name+" ("+l.sessions_remaining+"/"+l.sessions_total+" restants)";[...o.querySelectorAll(".inv-desc")].some(d=>d.value===i)||b(e.id,i,1,0)}else if(b(e.id,s,1,a/100),e.promotion_discount_cents>0&&e.promotion_label){const l="Réduction : "+e.promotion_label+(e.promotion_discount_pct?" (-"+e.promotion_discount_pct+"%)":"");b(e.id,l,1,-(e.promotion_discount_cents/100))}if(e.deposit_status==="paid"&&e.deposit_amount_cents&&e.deposit_payment_intent_id){const l=parseInt(e.gc_paid_cents)||0,i=parseInt(e.deposit_amount_cents)||0;if(e.deposit_payment_intent_id.startsWith("gc_")&&l<=0){const c=e.deposit_payment_intent_id.replace("gc_",""),d=c==="absorbed"?"Acompte payé (reste absorbé par carte cadeau)":"Acompte payé (Carte cadeau "+c+")";[...o.querySelectorAll(".inv-desc")].some(m=>m.value===d)||b(e.id,d,1,-(i/100))}else if(l>0){const c="Acompte payé (Carte cadeau)";[...o.querySelectorAll(".inv-desc")].some(m=>m.value===c)||b(e.id,c,1,-(l/100));const x=i-l;if(x>0){const m="Acompte payé (Stripe)";[...o.querySelectorAll(".inv-desc")].some(I=>I.value===m)||b(e.id,m,1,-(x/100))}}else if(e.deposit_payment_intent_id.startsWith("pi_")||e.deposit_payment_intent_id.startsWith("cs_")){const c="Acompte payé (Stripe)";[...o.querySelectorAll(".inv-desc")].some(x=>x.value===c)||b(e.id,c,1,-(i/100))}}}else o.querySelectorAll(`[data-booking-id="${e.id}"]`).forEach(r=>r.remove());C()}}function b(n,t,e,o){const r=document.getElementById("invLines");if(!r)return;const s=document.createElement("div");s.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",s.setAttribute("data-booking-id",n),s.innerHTML=`
    <input class="inv-desc" value="${v(t)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="${e}" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" value="${o.toFixed(2)}" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" aria-label="Retirer la ligne" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,r.appendChild(s)}Object.defineProperty(window,"invoiceFilter",{get(){return p},set(n){p!==n&&(k=0),p=n}});Object.defineProperty(window,"invoiceType",{get(){return g},set(n){g!==n&&(k=0),g=n}});function O(n){k=Math.max(0,parseInt(n)||0),h()}A({loadInvoices:h,openInvoiceModal:P,addInvoiceLine:T,updateInvTotals:C,saveInvoice:j,changeInvoiceStatus:V,deleteInvoice:X,downloadInvoicePDF:H,createInvoiceFromBooking:U,invClientChanged:S,invToggleUnbilled:q,issueCreditNote:R,submitCreditNote:G,invoicesGoToPage:O});export{T as addInvoiceLine,V as changeInvoiceStatus,U as createInvoiceFromBooking,X as deleteInvoice,H as downloadInvoicePDF,h as loadInvoices,P as openInvoiceModal,j as saveInvoice,C as updateInvTotals};
