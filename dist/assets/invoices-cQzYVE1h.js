import{s as h,a as g,G as u,l as C,d as z}from"./dashboard-Ccwcsnfy.js";let p="all",v="all",b=[];function m(o){return String(o||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function y(o){return((o||0)/100).toFixed(2).replace(".",",")+" €"}async function f(){const o=document.getElementById("contentArea");o.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const t=new URLSearchParams;p!=="all"&&t.set("status",p),v!=="all"&&t.set("type",v);const e=await g.get(`/api/invoices?${t}`),i=e.invoices||[],s=e.stats||{};let r="";r+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="label">Brouillons</div><div class="val">${s.drafts||0}</div></div>
      <div class="stat-card"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${y(parseInt(s.total_pending||0))}</div><div class="sub">${parseInt(s.sent||0)+parseInt(s.overdue||0)} factures</div></div>
      <div class="stat-card"><div class="label">Payées</div><div class="val" style="color:var(--green)">${y(parseInt(s.total_paid||0))}</div><div class="sub">${s.paid||0} factures</div></div>
      <div class="stat-card"><div class="label">En retard</div><div class="val" style="color:var(--red)">${s.overdue||0}</div></div>
    </div>`,r+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
      <button onclick="openInvoiceModal()" class="btn-primary">+ Nouvelle facture</button>
      <button onclick="openInvoiceModal('quote')" class="btn-primary" style="background:var(--gold)">+ Devis</button>
      <div style="flex:1"></div>
      <select onchange="invoiceType=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${v==="all"?"selected":""}>Tous types</option>
        <option value="invoice" ${v==="invoice"?"selected":""}>Factures</option>
        <option value="quote" ${v==="quote"?"selected":""}>Devis</option>
        <option value="credit_note" ${v==="credit_note"?"selected":""}>Notes de crédit</option>
      </select>
      <select onchange="invoiceFilter=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${p==="all"?"selected":""}>Tous statuts</option>
        <option value="draft" ${p==="draft"?"selected":""}>Brouillons</option>
        <option value="sent" ${p==="sent"?"selected":""}>Envoyées</option>
        <option value="paid" ${p==="paid"?"selected":""}>Payées</option>
        <option value="overdue" ${p==="overdue"?"selected":""}>En retard</option>
        <option value="cancelled" ${p==="cancelled"?"selected":""}>Annulées</option>
      </select>
    </div>`,i.length===0?r+='<div class="card"><div class="empty">Aucune facture. Créez votre première facture ou devis !</div></div>':(r+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">N°</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Type</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant TTC</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
        </tr></thead><tbody>`,i.forEach(n=>{const l={draft:"var(--text-4)",sent:"var(--gold)",paid:"var(--green)",overdue:"var(--red)",cancelled:"var(--text-4)"},c={draft:"Brouillon",sent:"Envoyée",paid:"Payée",overdue:"En retard",cancelled:"Annulée"},d={invoice:"Facture",quote:"Devis",credit_note:"Note crédit"},k={invoice:"var(--primary)",quote:"var(--gold)",credit_note:"var(--text-3)"},$=l[n.status]||"var(--text-4)",B=new Date(n.issue_date).toLocaleDateString("fr-BE");r+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px;font-weight:600">${m(n.invoice_number)}</td>
          <td style="padding:10px"><span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${k[n.type]}15;color:${k[n.type]};font-weight:600">${d[n.type]||n.type}</span></td>
          <td style="padding:10px">${m(n.client_name)}</td>
          <td style="padding:10px;color:var(--text-3)">${B}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${y(n.total_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${$}12;color:${$};font-weight:600">${c[n.status]||n.status}</span></td>
          <td style="padding:10px;text-align:right">
            <button onclick="downloadInvoicePDF('${n.id}')" title="Télécharger PDF" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
            ${n.status==="draft"?`<button onclick="changeInvoiceStatus('${n.id}','sent')" title="Marquer envoyée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`:""}
            ${n.status==="sent"||n.status==="overdue"?`<button onclick="changeInvoiceStatus('${n.id}','paid')" title="Marquer payée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`:""}
            ${n.status==="draft"?`<button onclick="deleteInvoice('${n.id}')" title="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`:""}
          </td>
        </tr>`}),r+="</tbody></table></div>"),g.getBusiness()?.settings?.iban||(r+=`<div class="card" style="background:var(--gold-bg);border:1px solid #E0D4A8;margin-top:14px;padding:14px 18px">
        <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Ajoutez votre IBAN</strong> dans Paramètres → Infos salon pour l'afficher sur vos factures et générer la communication structurée belge.</p>
      </div>`),o.innerHTML=r}catch(t){o.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${m(t.message)}</div>`}}async function T(o="invoice",t={}){let e=[];try{const a=await g.get("/api/clients");e=a.clients||a||[]}catch(a){console.warn("Impossible de charger les clients pour la facture:",a.message)}const i=o==="quote",s=i?"Nouveau devis":"Nouvelle facture",r=document.createElement("div");if(r.className="m-overlay open",r.id="invModal",r.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${s}</h3>
      <button class="m-close" onclick="closeModal('invModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="m-body" style="display:grid;gap:12px">
      <div>
        <label class="m-field-label">Client</label>
        <select class="m-input" id="invClient" onchange="invClientChanged()">
          <option value="">— Sélectionner un client —</option>
          ${e.map(a=>`<option value="${a.id}">${m(a.full_name)}${a.email?" ("+m(a.email)+")":""}</option>`).join("")}
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
  </div>`,document.body.appendChild(r),C(document.getElementById("invModal"),{noBackdropClose:!0}),w(),_(),t.preselect_client_id){const a=document.getElementById("invClient");a&&(a.value=t.preselect_client_id),await I(),(t.precheck_booking_id||t.precheck_group_id)&&setTimeout(()=>{b.forEach((n,l)=>{if(t.precheck_booking_id&&n.id===t.precheck_booking_id||t.precheck_group_id&&n.group_id===t.precheck_group_id){const d=document.querySelector(`[data-unbilled-idx="${l}"]`);d&&!d.checked&&(d.checked=!0,E(l,!0))}})},100)}}function w(){const o=document.getElementById("invLines");if(!o)return;const t=document.createElement("div");t.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",t.innerHTML=`
    <input class="inv-desc" placeholder="Description prestation" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="1" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" placeholder="Prix €" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,o.appendChild(t)}function _(){const o=document.getElementById("invLines"),t=document.getElementById("invTotals");if(!o||!t)return;const e=parseFloat(document.getElementById("invVat")?.value||21);let i=0;o.querySelectorAll(":scope > div").forEach(n=>{const l=parseFloat(n.querySelector(".inv-qty")?.value||1),c=parseFloat(n.querySelector(".inv-price")?.value||0);i+=l*c*100});const s=Math.round(i*e/(100+e)),r=i,a=i-s;t.innerHTML=`
    <div style="font-size:.82rem;color:var(--text-3)">Sous-total HTVA : <strong>${y(a)}</strong></div>
    <div style="font-size:.82rem;color:var(--text-3)">TVA (${e}%) : <strong>${y(s)}</strong></div>
    <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:4px">Total TTC : ${y(r)}</div>`}async function S(o){const t=document.getElementById("invClient")?.value;if(!t){u.toast("Sélectionnez un client","error");return}const e=document.getElementById("invLines"),i=[];if(e.querySelectorAll(":scope > div").forEach(s=>{const r=s.querySelector(".inv-desc")?.value?.trim(),a=parseFloat(s.querySelector(".inv-qty")?.value||1),n=parseFloat(s.querySelector(".inv-price")?.value||0),l=s.getAttribute("data-booking-id")||void 0;r&&n!==0&&i.push({description:r,quantity:a,unit_price_cents:Math.round(n*100),booking_id:l})}),i.length===0){u.toast("Ajoutez au moins une ligne","error");return}try{const s={client_id:t,type:o||"invoice",items:i,vat_rate:parseFloat(document.getElementById("invVat")?.value||21),due_days:parseInt(document.getElementById("invDueDays")?.value||30),client_bce:document.getElementById("invClientBce")?.value?.trim()||void 0,notes:document.getElementById("invNotes")?.value?.trim()||void 0},r=await g.post("/api/invoices",s);document.getElementById("invModal")._dirtyGuard?.markClean(),closeModal("invModal"),u.toast(o==="quote"?"Devis créé !":"Facture créée !","success"),f()}catch(s){u.toast(s.message||"Erreur","error")}}async function q(o,t){if(await h("Changer le statut",{sent:"Marquer comme envoyée ?",paid:"Marquer comme payée ?"}[t]||`Changer le statut en "${t}" ?`,"Confirmer"))try{await g.patch(`/api/invoices/${o}/status`,{status:t}),u.toast("Statut mis à jour","success"),f()}catch(s){u.toast(s.message||"Erreur","error")}}async function M(o){if(await h("Supprimer le brouillon","Supprimer ce brouillon ?","Supprimer","danger"))try{await g.delete(`/api/invoices/${o}`),u.toast("Brouillon supprimé","success"),f()}catch(e){u.toast(e.message||"Erreur","error")}}function D(o){const t=localStorage.getItem("genda_token");window.open(`/api/invoices/${o}/pdf?token=${t}`,"_blank","noopener")}async function L(o){if(await h("Créer une facture pour ce rendez-vous ?"))try{const t=await g.post("/api/invoices",{booking_id:o,type:"invoice"});u.toast("Facture créée ! Retrouvez-la dans Facturation.","success"),document.querySelectorAll(".ni").forEach(e=>e.classList.remove("active")),document.querySelector('[data-section="invoices"]')?.classList.add("active"),document.getElementById("pageTitle").textContent="Facturation",f()}catch(t){u.toast(t.message||"Erreur","error")}}async function I(){const o=document.getElementById("invClient")?.value,t=document.getElementById("invUnbilledSection"),e=document.getElementById("invUnbilledList");if(!o||!t||!e){t&&(t.style.display="none");return}try{b=(await g.get(`/api/invoices/unbilled?client_id=${o}`)).bookings||[]}catch{b=[]}if(b.length===0){t.style.display="none";return}t.style.display="",e.innerHTML=b.map((i,s)=>{const r=new Date(i.start_at).toLocaleDateString("fr-BE"),a=i.booked_price_cents??i.variant_price_cents??i.service_price_cents??0,n=i.service_name+(i.variant_name?" — "+i.variant_name:"")+" ("+(i.practitioner_name||"?")+") — "+r,l=i.pass_covered?' <span style="font-size:.68rem;color:var(--green);font-weight:600;padding:1px 6px;border-radius:4px;background:var(--green-bg)">Pass</span>':"",c=i.promotion_discount_cents>0?' <span style="font-size:.68rem;color:var(--green);font-weight:600">promo</span>':"",d=i.pass_covered?'<span style="color:var(--green)">inclus</span>':y(a);return`<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid var(--border-light);background:${s%2===0?"var(--white)":"var(--surface)"}">
      <input type="checkbox" data-unbilled-idx="${s}" onchange="invToggleUnbilled(${s},this.checked)">
      <span style="flex:1">${m(n)}${l}</span>
      <span style="font-weight:600;color:var(--text-2)">${d}${c}</span>
    </label>`}).join("")}function E(o,t){const e=b[o];if(!e)return;const i=document.getElementById("invLines");if(i){if(t){const s=new Date(e.start_at).toLocaleDateString("fr-BE"),r=e.service_name+(e.variant_name?" — "+e.variant_name:"")+" ("+(e.practitioner_name||"")+") — "+s,a=e.booked_price_cents??e.variant_price_cents??e.service_price_cents??0;if(e.pass_covered&&e.pass_info){x(e.id,r+" (inclus abonnement)",1,0);const n=e.pass_info,l="1 crédit consommé — Pass "+n.name+" ("+n.sessions_remaining+"/"+n.sessions_total+" restants)";[...i.querySelectorAll(".inv-desc")].some(d=>d.value===l)||x(e.id,l,1,0)}else if(x(e.id,r,1,a/100),e.promotion_discount_cents>0&&e.promotion_label){const n="Réduction : "+e.promotion_label+(e.promotion_discount_pct?" (-"+e.promotion_discount_pct+"%)":"");x(e.id,n,1,-(e.promotion_discount_cents/100))}if(e.deposit_status==="paid"&&e.deposit_amount_cents&&e.deposit_payment_intent_id&&(e.deposit_payment_intent_id.startsWith("pi_")||e.deposit_payment_intent_id.startsWith("cs_"))){const n="Acompte payé (Stripe)";[...i.querySelectorAll(".inv-desc")].some(c=>c.value===n)||x(e.id,n,1,-(e.deposit_amount_cents/100))}if(e.deposit_status==="paid"&&e.deposit_amount_cents&&e.deposit_payment_intent_id&&e.deposit_payment_intent_id.startsWith("gc_")){const l="Acompte payé (Carte cadeau "+e.deposit_payment_intent_id.replace("gc_","")+")";[...i.querySelectorAll(".inv-desc")].some(d=>d.value===l)||x(e.id,l,1,-(e.deposit_amount_cents/100))}}else i.querySelectorAll(`[data-booking-id="${e.id}"]`).forEach(s=>s.remove());_()}}function x(o,t,e,i){const s=document.getElementById("invLines");if(!s)return;const r=document.createElement("div");r.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",r.setAttribute("data-booking-id",o),r.innerHTML=`
    <input class="inv-desc" value="${m(t)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="${e}" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" value="${i.toFixed(2)}" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,s.appendChild(r)}Object.defineProperty(window,"invoiceFilter",{get(){return p},set(o){p=o}});Object.defineProperty(window,"invoiceType",{get(){return v},set(o){v=o}});z({loadInvoices:f,openInvoiceModal:T,addInvoiceLine:w,updateInvTotals:_,saveInvoice:S,changeInvoiceStatus:q,deleteInvoice:M,downloadInvoicePDF:D,createInvoiceFromBooking:L,invClientChanged:I,invToggleUnbilled:E});export{w as addInvoiceLine,q as changeInvoiceStatus,L as createInvoiceFromBooking,M as deleteInvoice,D as downloadInvoicePDF,f as loadInvoices,T as openInvoiceModal,S as saveInvoice,_ as updateInvTotals};
