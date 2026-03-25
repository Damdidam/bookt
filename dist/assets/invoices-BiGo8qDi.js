import{a as g,G as p,o as B,d as T}from"./dashboard-Cck-jTYC.js";let u="all",v="all",m=[];function y(n){return String(n||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function x(n){return((n||0)/100).toFixed(2).replace(".",",")+" €"}async function f(){const n=document.getElementById("contentArea");n.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const e=new URLSearchParams;u!=="all"&&e.set("status",u),v!=="all"&&e.set("type",v);const t=await g.get(`/api/invoices?${e}`),o=t.invoices||[],a=t.stats||{};let r="";r+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="label">Brouillons</div><div class="val">${a.drafts||0}</div></div>
      <div class="stat-card"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${x(parseInt(a.total_pending||0))}</div><div class="sub">${parseInt(a.sent||0)+parseInt(a.overdue||0)} factures</div></div>
      <div class="stat-card"><div class="label">Payées</div><div class="val" style="color:var(--green)">${x(parseInt(a.total_paid||0))}</div><div class="sub">${a.paid||0} factures</div></div>
      <div class="stat-card"><div class="label">En retard</div><div class="val" style="color:var(--red)">${a.overdue||0}</div></div>
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
        <option value="all" ${u==="all"?"selected":""}>Tous statuts</option>
        <option value="draft" ${u==="draft"?"selected":""}>Brouillons</option>
        <option value="sent" ${u==="sent"?"selected":""}>Envoyées</option>
        <option value="paid" ${u==="paid"?"selected":""}>Payées</option>
        <option value="overdue" ${u==="overdue"?"selected":""}>En retard</option>
        <option value="cancelled" ${u==="cancelled"?"selected":""}>Annulées</option>
      </select>
    </div>`,o.length===0?r+='<div class="card"><div class="empty">Aucune facture. Créez votre première facture ou devis !</div></div>':(r+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">N°</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Type</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant TTC</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
        </tr></thead><tbody>`,o.forEach(i=>{const l={draft:"var(--text-4)",sent:"var(--gold)",paid:"var(--green)",overdue:"var(--red)",cancelled:"var(--text-4)"},c={draft:"Brouillon",sent:"Envoyée",paid:"Payée",overdue:"En retard",cancelled:"Annulée"},d={invoice:"Facture",quote:"Devis",credit_note:"Note crédit"},h={invoice:"var(--primary)",quote:"var(--gold)",credit_note:"var(--text-3)"},b=l[i.status]||"var(--text-4)",E=new Date(i.issue_date).toLocaleDateString("fr-BE");r+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px;font-weight:600">${y(i.invoice_number)}</td>
          <td style="padding:10px"><span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${h[i.type]}15;color:${h[i.type]};font-weight:600">${d[i.type]||i.type}</span></td>
          <td style="padding:10px">${y(i.client_name)}</td>
          <td style="padding:10px;color:var(--text-3)">${E}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${x(i.total_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${b}12;color:${b};font-weight:600">${c[i.status]||i.status}</span></td>
          <td style="padding:10px;text-align:right">
            <button onclick="downloadInvoicePDF('${i.id}')" title="Télécharger PDF" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
            ${i.status==="draft"?`<button onclick="changeInvoiceStatus('${i.id}','sent')" title="Marquer envoyée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`:""}
            ${i.status==="sent"||i.status==="overdue"?`<button onclick="changeInvoiceStatus('${i.id}','paid')" title="Marquer payée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`:""}
            ${i.status==="draft"?`<button onclick="deleteInvoice('${i.id}')" title="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`:""}
          </td>
        </tr>`}),r+="</tbody></table></div>"),g.getBusiness()?.settings?.iban||(r+=`<div class="card" style="background:var(--gold-bg);border:1px solid #E0D4A8;margin-top:14px;padding:14px 18px">
        <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Ajoutez votre IBAN</strong> dans Paramètres → Infos salon pour l'afficher sur vos factures et générer la communication structurée belge.</p>
      </div>`),n.innerHTML=r}catch(e){n.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${y(e.message)}</div>`}}async function z(n="invoice",e={}){let t=[];try{const s=await g.get("/api/clients");t=s.clients||s||[]}catch(s){console.warn("Impossible de charger les clients pour la facture:",s.message)}const o=n==="quote",a=o?"Nouveau devis":"Nouvelle facture",r=document.createElement("div");if(r.className="m-overlay open",r.id="invModal",r.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${a}</h3>
      <button class="m-close" onclick="closeModal('invModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="m-body" style="display:grid;gap:12px">
      <div>
        <label class="m-field-label">Client</label>
        <select class="m-input" id="invClient" onchange="invClientChanged()">
          <option value="">— Sélectionner un client —</option>
          ${t.map(s=>`<option value="${s.id}">${y(s.full_name)}${s.email?" ("+y(s.email)+")":""}</option>`).join("")}
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
  </div>`,document.body.appendChild(r),B(document.getElementById("invModal"),{noBackdropClose:!0}),$(),k(),e.preselect_client_id){const s=document.getElementById("invClient");s&&(s.value=e.preselect_client_id),await I(),(e.precheck_booking_id||e.precheck_group_id)&&setTimeout(()=>{m.forEach((i,l)=>{if(e.precheck_booking_id&&i.id===e.precheck_booking_id||e.precheck_group_id&&i.group_id===e.precheck_group_id){const d=document.querySelector(`[data-unbilled-idx="${l}"]`);d&&!d.checked&&(d.checked=!0,w(l,!0))}})},100)}}function $(){const n=document.getElementById("invLines");if(!n)return;const e=document.createElement("div");e.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",e.innerHTML=`
    <input class="inv-desc" placeholder="Description prestation" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="1" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" placeholder="Prix €" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,n.appendChild(e)}function k(){const n=document.getElementById("invLines"),e=document.getElementById("invTotals");if(!n||!e)return;const t=parseFloat(document.getElementById("invVat")?.value||21);let o=0;n.querySelectorAll(":scope > div").forEach(s=>{const i=parseFloat(s.querySelector(".inv-qty")?.value||1),l=parseFloat(s.querySelector(".inv-price")?.value||0);o+=i*l*100});const a=Math.round(o*t/100),r=o+a;e.innerHTML=`
    <div style="font-size:.82rem;color:var(--text-3)">Sous-total HT : <strong>${x(o)}</strong></div>
    <div style="font-size:.82rem;color:var(--text-3)">TVA (${t}%) : <strong>${x(a)}</strong></div>
    <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:4px">Total TTC : ${x(r)}</div>`}async function C(n){const e=document.getElementById("invClient")?.value;if(!e){p.toast("Sélectionnez un client","error");return}const t=document.getElementById("invLines"),o=[];if(t.querySelectorAll(":scope > div").forEach(a=>{const r=a.querySelector(".inv-desc")?.value?.trim(),s=parseFloat(a.querySelector(".inv-qty")?.value||1),i=parseFloat(a.querySelector(".inv-price")?.value||0),l=a.getAttribute("data-booking-id")||void 0;r&&i!==0&&o.push({description:r,quantity:s,unit_price_cents:Math.round(i*100),booking_id:l})}),o.length===0){p.toast("Ajoutez au moins une ligne","error");return}try{const a={client_id:e,type:n||"invoice",items:o,vat_rate:parseFloat(document.getElementById("invVat")?.value||21),due_days:parseInt(document.getElementById("invDueDays")?.value||30),client_bce:document.getElementById("invClientBce")?.value?.trim()||void 0,notes:document.getElementById("invNotes")?.value?.trim()||void 0},r=await g.post("/api/invoices",a);document.getElementById("invModal")._dirtyGuard?.markClean(),closeModal("invModal"),p.toast(n==="quote"?"Devis créé !":"Facture créée !","success"),f()}catch(a){p.toast(a.message||"Erreur","error")}}async function q(n,e){if(confirm({sent:"Marquer comme envoyée ?",paid:"Marquer comme payée ?"}[e]||`Changer le statut en "${e}" ?`))try{await g.patch(`/api/invoices/${n}/status`,{status:e}),p.toast("Statut mis à jour","success"),f()}catch(o){p.toast(o.message||"Erreur","error")}}async function M(n){if(confirm("Supprimer ce brouillon ?"))try{await g.delete(`/api/invoices/${n}`),p.toast("Brouillon supprimé","success"),f()}catch(e){p.toast(e.message||"Erreur","error")}}function S(n){const e=localStorage.getItem("genda_token");window.open(`/api/invoices/${n}/pdf?token=${e}`,"_blank")}async function L(n){if(confirm("Créer une facture pour ce rendez-vous ?"))try{const e=await g.post("/api/invoices",{booking_id:n,type:"invoice"});p.toast("Facture créée ! Retrouvez-la dans Facturation.","success"),document.querySelectorAll(".ni").forEach(t=>t.classList.remove("active")),document.querySelector('[data-section="invoices"]')?.classList.add("active"),document.getElementById("pageTitle").textContent="Facturation",f()}catch(e){p.toast(e.message||"Erreur","error")}}async function I(){const n=document.getElementById("invClient")?.value,e=document.getElementById("invUnbilledSection"),t=document.getElementById("invUnbilledList");if(!n||!e||!t){e&&(e.style.display="none");return}try{m=(await g.get(`/api/invoices/unbilled?client_id=${n}`)).bookings||[]}catch{m=[]}if(m.length===0){e.style.display="none";return}e.style.display="",t.innerHTML=m.map((o,a)=>{const r=new Date(o.start_at).toLocaleDateString("fr-BE"),s=o.variant_price_cents??o.service_price_cents??0,i=o.service_name+(o.variant_name?" — "+o.variant_name:"")+" ("+(o.practitioner_name||"?")+") — "+r;return`<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid var(--border-light);background:${a%2===0?"var(--white)":"var(--surface)"}">
      <input type="checkbox" data-unbilled-idx="${a}" onchange="invToggleUnbilled(${a},this.checked)">
      <span style="flex:1">${y(i)}</span>
      <span style="font-weight:600;color:var(--text-2)">${x(s)}</span>
    </label>`}).join("")}function w(n,e){const t=m[n];if(!t)return;const o=document.getElementById("invLines");if(o){if(e){const a=new Date(t.start_at).toLocaleDateString("fr-BE"),r=t.service_name+(t.variant_name?" — "+t.variant_name:"")+" ("+(t.practitioner_name||"")+") — "+a,s=t.variant_price_cents??t.service_price_cents??0;if(_(t.id,r,1,s/100),t.deposit_payment_intent_id&&t.deposit_payment_intent_id.startsWith("pass_")&&t.pass_info){const i=t.pass_info,l="1 crédit consommé — Pass "+i.name+" ("+i.sessions_remaining+"/"+i.sessions_total+" restants)";[...o.querySelectorAll(".inv-desc")].some(d=>d.value===l)||_(t.id,l,1,0)}if(t.deposit_status==="paid"&&t.deposit_amount_cents&&t.deposit_payment_intent_id&&(t.deposit_payment_intent_id.startsWith("pi_")||t.deposit_payment_intent_id.startsWith("cs_"))){const i="Acompte payé (Stripe)";if(![...o.querySelectorAll(".inv-desc")].some(c=>c.value===i)){let c=0;m.forEach((d,h)=>{const b=document.querySelector(`[data-unbilled-idx="${h}"]`);b&&b.checked&&d.deposit_payment_intent_id===t.deposit_payment_intent_id&&d.deposit_amount_cents&&(c+=d.deposit_amount_cents)}),c===0&&(c=t.deposit_amount_cents),_(t.id,i,1,-(c/100))}}}else o.querySelectorAll(`[data-booking-id="${t.id}"]`).forEach(a=>a.remove());k()}}function _(n,e,t,o){const a=document.getElementById("invLines");if(!a)return;const r=document.createElement("div");r.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",r.setAttribute("data-booking-id",n),r.innerHTML=`
    <input class="inv-desc" value="${y(e)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="${t}" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" value="${o.toFixed(2)}" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,a.appendChild(r)}Object.defineProperty(window,"invoiceFilter",{get(){return u},set(n){u=n}});Object.defineProperty(window,"invoiceType",{get(){return v},set(n){v=n}});T({loadInvoices:f,openInvoiceModal:z,addInvoiceLine:$,updateInvTotals:k,saveInvoice:C,changeInvoiceStatus:q,deleteInvoice:M,downloadInvoicePDF:S,createInvoiceFromBooking:L,invClientChanged:I,invToggleUnbilled:w});export{$ as addInvoiceLine,q as changeInvoiceStatus,L as createInvoiceFromBooking,M as deleteInvoice,S as downloadInvoicePDF,f as loadInvoices,z as openInvoiceModal,C as saveInvoice,k as updateInvTotals};
