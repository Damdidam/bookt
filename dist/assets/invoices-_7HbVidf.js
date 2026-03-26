import{a as g,G as c,o as B,d as C}from"./dashboard-DfC7cirG.js";let d="all",v="all",x=[];function m(n){return String(n||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function y(n){return((n||0)/100).toFixed(2).replace(".",",")+" €"}async function f(){const n=document.getElementById("contentArea");n.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const t=new URLSearchParams;d!=="all"&&t.set("status",d),v!=="all"&&t.set("type",v);const e=await g.get(`/api/invoices?${t}`),o=e.invoices||[],s=e.stats||{};let a="";a+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="label">Brouillons</div><div class="val">${s.drafts||0}</div></div>
      <div class="stat-card"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${y(parseInt(s.total_pending||0))}</div><div class="sub">${parseInt(s.sent||0)+parseInt(s.overdue||0)} factures</div></div>
      <div class="stat-card"><div class="label">Payées</div><div class="val" style="color:var(--green)">${y(parseInt(s.total_paid||0))}</div><div class="sub">${s.paid||0} factures</div></div>
      <div class="stat-card"><div class="label">En retard</div><div class="val" style="color:var(--red)">${s.overdue||0}</div></div>
    </div>`,a+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
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
        <option value="all" ${d==="all"?"selected":""}>Tous statuts</option>
        <option value="draft" ${d==="draft"?"selected":""}>Brouillons</option>
        <option value="sent" ${d==="sent"?"selected":""}>Envoyées</option>
        <option value="paid" ${d==="paid"?"selected":""}>Payées</option>
        <option value="overdue" ${d==="overdue"?"selected":""}>En retard</option>
        <option value="cancelled" ${d==="cancelled"?"selected":""}>Annulées</option>
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
        </tr></thead><tbody>`,o.forEach(i=>{const l={draft:"var(--text-4)",sent:"var(--gold)",paid:"var(--green)",overdue:"var(--red)",cancelled:"var(--text-4)"},u={draft:"Brouillon",sent:"Envoyée",paid:"Payée",overdue:"En retard",cancelled:"Annulée"},p={invoice:"Facture",quote:"Devis",credit_note:"Note crédit"},_={invoice:"var(--primary)",quote:"var(--gold)",credit_note:"var(--text-3)"},k=l[i.status]||"var(--text-4)",E=new Date(i.issue_date).toLocaleDateString("fr-BE");a+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px;font-weight:600">${m(i.invoice_number)}</td>
          <td style="padding:10px"><span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${_[i.type]}15;color:${_[i.type]};font-weight:600">${p[i.type]||i.type}</span></td>
          <td style="padding:10px">${m(i.client_name)}</td>
          <td style="padding:10px;color:var(--text-3)">${E}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${y(i.total_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${k}12;color:${k};font-weight:600">${u[i.status]||i.status}</span></td>
          <td style="padding:10px;text-align:right">
            <button onclick="downloadInvoicePDF('${i.id}')" title="Télécharger PDF" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
            ${i.status==="draft"?`<button onclick="changeInvoiceStatus('${i.id}','sent')" title="Marquer envoyée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`:""}
            ${i.status==="sent"||i.status==="overdue"?`<button onclick="changeInvoiceStatus('${i.id}','paid')" title="Marquer payée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`:""}
            ${i.status==="draft"?`<button onclick="deleteInvoice('${i.id}')" title="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`:""}
          </td>
        </tr>`}),a+="</tbody></table></div>"),g.getBusiness()?.settings?.iban||(a+=`<div class="card" style="background:var(--gold-bg);border:1px solid #E0D4A8;margin-top:14px;padding:14px 18px">
        <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Ajoutez votre IBAN</strong> dans Paramètres → Infos salon pour l'afficher sur vos factures et générer la communication structurée belge.</p>
      </div>`),n.innerHTML=a}catch(t){n.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${m(t.message)}</div>`}}async function z(n="invoice",t={}){let e=[];try{const r=await g.get("/api/clients");e=r.clients||r||[]}catch(r){console.warn("Impossible de charger les clients pour la facture:",r.message)}const o=n==="quote",s=o?"Nouveau devis":"Nouvelle facture",a=document.createElement("div");if(a.className="m-overlay open",a.id="invModal",a.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${s}</h3>
      <button class="m-close" onclick="closeModal('invModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="m-body" style="display:grid;gap:12px">
      <div>
        <label class="m-field-label">Client</label>
        <select class="m-input" id="invClient" onchange="invClientChanged()">
          <option value="">— Sélectionner un client —</option>
          ${e.map(r=>`<option value="${r.id}">${m(r.full_name)}${r.email?" ("+m(r.email)+")":""}</option>`).join("")}
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
  </div>`,document.body.appendChild(a),B(document.getElementById("invModal"),{noBackdropClose:!0}),$(),h(),t.preselect_client_id){const r=document.getElementById("invClient");r&&(r.value=t.preselect_client_id),await w(),(t.precheck_booking_id||t.precheck_group_id)&&setTimeout(()=>{x.forEach((i,l)=>{if(t.precheck_booking_id&&i.id===t.precheck_booking_id||t.precheck_group_id&&i.group_id===t.precheck_group_id){const p=document.querySelector(`[data-unbilled-idx="${l}"]`);p&&!p.checked&&(p.checked=!0,I(l,!0))}})},100)}}function $(){const n=document.getElementById("invLines");if(!n)return;const t=document.createElement("div");t.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",t.innerHTML=`
    <input class="inv-desc" placeholder="Description prestation" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="1" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" placeholder="Prix €" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,n.appendChild(t)}function h(){const n=document.getElementById("invLines"),t=document.getElementById("invTotals");if(!n||!t)return;const e=parseFloat(document.getElementById("invVat")?.value||21);let o=0;n.querySelectorAll(":scope > div").forEach(r=>{const i=parseFloat(r.querySelector(".inv-qty")?.value||1),l=parseFloat(r.querySelector(".inv-price")?.value||0);o+=i*l*100});const s=Math.round(o*e/100),a=o+s;t.innerHTML=`
    <div style="font-size:.82rem;color:var(--text-3)">Sous-total HT : <strong>${y(o)}</strong></div>
    <div style="font-size:.82rem;color:var(--text-3)">TVA (${e}%) : <strong>${y(s)}</strong></div>
    <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:4px">Total TTC : ${y(a)}</div>`}async function T(n){const t=document.getElementById("invClient")?.value;if(!t){c.toast("Sélectionnez un client","error");return}const e=document.getElementById("invLines"),o=[];if(e.querySelectorAll(":scope > div").forEach(s=>{const a=s.querySelector(".inv-desc")?.value?.trim(),r=parseFloat(s.querySelector(".inv-qty")?.value||1),i=parseFloat(s.querySelector(".inv-price")?.value||0),l=s.getAttribute("data-booking-id")||void 0;a&&i!==0&&o.push({description:a,quantity:r,unit_price_cents:Math.round(i*100),booking_id:l})}),o.length===0){c.toast("Ajoutez au moins une ligne","error");return}try{const s={client_id:t,type:n||"invoice",items:o,vat_rate:parseFloat(document.getElementById("invVat")?.value||21),due_days:parseInt(document.getElementById("invDueDays")?.value||30),client_bce:document.getElementById("invClientBce")?.value?.trim()||void 0,notes:document.getElementById("invNotes")?.value?.trim()||void 0},a=await g.post("/api/invoices",s);document.getElementById("invModal")._dirtyGuard?.markClean(),closeModal("invModal"),c.toast(n==="quote"?"Devis créé !":"Facture créée !","success"),f()}catch(s){c.toast(s.message||"Erreur","error")}}async function q(n,t){if(confirm({sent:"Marquer comme envoyée ?",paid:"Marquer comme payée ?"}[t]||`Changer le statut en "${t}" ?`))try{await g.patch(`/api/invoices/${n}/status`,{status:t}),c.toast("Statut mis à jour","success"),f()}catch(o){c.toast(o.message||"Erreur","error")}}async function M(n){if(confirm("Supprimer ce brouillon ?"))try{await g.delete(`/api/invoices/${n}`),c.toast("Brouillon supprimé","success"),f()}catch(t){c.toast(t.message||"Erreur","error")}}function S(n){const t=localStorage.getItem("genda_token");window.open(`/api/invoices/${n}/pdf?token=${t}`,"_blank")}async function L(n){if(confirm("Créer une facture pour ce rendez-vous ?"))try{const t=await g.post("/api/invoices",{booking_id:n,type:"invoice"});c.toast("Facture créée ! Retrouvez-la dans Facturation.","success"),document.querySelectorAll(".ni").forEach(e=>e.classList.remove("active")),document.querySelector('[data-section="invoices"]')?.classList.add("active"),document.getElementById("pageTitle").textContent="Facturation",f()}catch(t){c.toast(t.message||"Erreur","error")}}async function w(){const n=document.getElementById("invClient")?.value,t=document.getElementById("invUnbilledSection"),e=document.getElementById("invUnbilledList");if(!n||!t||!e){t&&(t.style.display="none");return}try{x=(await g.get(`/api/invoices/unbilled?client_id=${n}`)).bookings||[]}catch{x=[]}if(x.length===0){t.style.display="none";return}t.style.display="",e.innerHTML=x.map((o,s)=>{const a=new Date(o.start_at).toLocaleDateString("fr-BE"),r=o.variant_price_cents??o.service_price_cents??0,i=o.service_name+(o.variant_name?" — "+o.variant_name:"")+" ("+(o.practitioner_name||"?")+") — "+a,l=o.pass_covered?' <span style="font-size:.68rem;color:var(--green);font-weight:600;padding:1px 6px;border-radius:4px;background:var(--green-bg)">Pass</span>':"",u=o.pass_covered?'<span style="color:var(--green)">inclus</span>':y(r);return`<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid var(--border-light);background:${s%2===0?"var(--white)":"var(--surface)"}">
      <input type="checkbox" data-unbilled-idx="${s}" onchange="invToggleUnbilled(${s},this.checked)">
      <span style="flex:1">${m(i)}${l}</span>
      <span style="font-weight:600;color:var(--text-2)">${u}</span>
    </label>`}).join("")}function I(n,t){const e=x[n];if(!e)return;const o=document.getElementById("invLines");if(o){if(t){const s=new Date(e.start_at).toLocaleDateString("fr-BE"),a=e.service_name+(e.variant_name?" — "+e.variant_name:"")+" ("+(e.practitioner_name||"")+") — "+s,r=e.variant_price_cents??e.service_price_cents??0;if(e.pass_covered&&e.pass_info){b(e.id,a+" (inclus abonnement)",1,0);const i=e.pass_info,l="1 crédit consommé — Pass "+i.name+" ("+i.sessions_remaining+"/"+i.sessions_total+" restants)";[...o.querySelectorAll(".inv-desc")].some(p=>p.value===l)||b(e.id,l,1,0)}else b(e.id,a,1,r/100);if(e.deposit_status==="paid"&&e.deposit_amount_cents&&e.deposit_payment_intent_id&&(e.deposit_payment_intent_id.startsWith("pi_")||e.deposit_payment_intent_id.startsWith("cs_"))){const i="Acompte payé (Stripe)";[...o.querySelectorAll(".inv-desc")].some(u=>u.value===i)||b(e.id,i,1,-(e.deposit_amount_cents/100))}if(e.deposit_status==="paid"&&e.deposit_amount_cents&&e.deposit_payment_intent_id&&e.deposit_payment_intent_id.startsWith("gc_")){const l="Acompte payé (Carte cadeau "+e.deposit_payment_intent_id.replace("gc_","")+")";[...o.querySelectorAll(".inv-desc")].some(p=>p.value===l)||b(e.id,l,1,-(e.deposit_amount_cents/100))}}else o.querySelectorAll(`[data-booking-id="${e.id}"]`).forEach(s=>s.remove());h()}}function b(n,t,e,o){const s=document.getElementById("invLines");if(!s)return;const a=document.createElement("div");a.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",a.setAttribute("data-booking-id",n),a.innerHTML=`
    <input class="inv-desc" value="${m(t)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="${e}" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" value="${o.toFixed(2)}" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,s.appendChild(a)}Object.defineProperty(window,"invoiceFilter",{get(){return d},set(n){d=n}});Object.defineProperty(window,"invoiceType",{get(){return v},set(n){v=n}});C({loadInvoices:f,openInvoiceModal:z,addInvoiceLine:$,updateInvTotals:h,saveInvoice:T,changeInvoiceStatus:q,deleteInvoice:M,downloadInvoicePDF:S,createInvoiceFromBooking:L,invClientChanged:w,invToggleUnbilled:I});export{$ as addInvoiceLine,q as changeInvoiceStatus,L as createInvoiceFromBooking,M as deleteInvoice,S as downloadInvoicePDF,f as loadInvoices,z as openInvoiceModal,T as saveInvoice,h as updateInvTotals};
