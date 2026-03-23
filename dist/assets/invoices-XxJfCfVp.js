import{a as c,G as l,o as w,d as I}from"./dashboard-QGYYtQAr.js";let s="all",d="all";function p(e){return String(e||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function u(e){return((e||0)/100).toFixed(2).replace(".",",")+" €"}async function g(){const e=document.getElementById("contentArea");e.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const t=new URLSearchParams;s!=="all"&&t.set("status",s),d!=="all"&&t.set("type",d);const r=await c.get(`/api/invoices?${t}`),a=r.invoices||[],i=r.stats||{};let o="";o+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="label">Brouillons</div><div class="val">${i.drafts||0}</div></div>
      <div class="stat-card"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${u(parseInt(i.total_pending||0))}</div><div class="sub">${parseInt(i.sent||0)+parseInt(i.overdue||0)} factures</div></div>
      <div class="stat-card"><div class="label">Payées</div><div class="val" style="color:var(--green)">${u(parseInt(i.total_paid||0))}</div><div class="sub">${i.paid||0} factures</div></div>
      <div class="stat-card"><div class="label">En retard</div><div class="val" style="color:var(--red)">${i.overdue||0}</div></div>
    </div>`,o+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
      <button onclick="openInvoiceModal()" class="btn-primary">+ Nouvelle facture</button>
      <button onclick="openInvoiceModal('quote')" class="btn-primary" style="background:var(--gold)">+ Devis</button>
      <div style="flex:1"></div>
      <select onchange="invoiceType=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${d==="all"?"selected":""}>Tous types</option>
        <option value="invoice" ${d==="invoice"?"selected":""}>Factures</option>
        <option value="quote" ${d==="quote"?"selected":""}>Devis</option>
        <option value="credit_note" ${d==="credit_note"?"selected":""}>Notes de crédit</option>
      </select>
      <select onchange="invoiceFilter=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${s==="all"?"selected":""}>Tous statuts</option>
        <option value="draft" ${s==="draft"?"selected":""}>Brouillons</option>
        <option value="sent" ${s==="sent"?"selected":""}>Envoyées</option>
        <option value="paid" ${s==="paid"?"selected":""}>Payées</option>
        <option value="overdue" ${s==="overdue"?"selected":""}>En retard</option>
        <option value="cancelled" ${s==="cancelled"?"selected":""}>Annulées</option>
      </select>
    </div>`,a.length===0?o+='<div class="card"><div class="empty">Aucune facture. Créez votre première facture ou devis !</div></div>':(o+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
        <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
          <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">N°</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Type</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
          <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Date</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Montant TTC</th>
          <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
          <th style="padding:10px;text-align:right;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
        </tr></thead><tbody>`,a.forEach(n=>{const m={draft:"var(--text-4)",sent:"var(--gold)",paid:"var(--green)",overdue:"var(--red)",cancelled:"var(--text-4)"},h={draft:"Brouillon",sent:"Envoyée",paid:"Payée",overdue:"En retard",cancelled:"Annulée"},k={invoice:"Facture",quote:"Devis",credit_note:"Note crédit"},y={invoice:"var(--primary)",quote:"var(--gold)",credit_note:"var(--text-3)"},x=m[n.status]||"var(--text-4)",$=new Date(n.issue_date).toLocaleDateString("fr-BE");o+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px;font-weight:600">${p(n.invoice_number)}</td>
          <td style="padding:10px"><span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${y[n.type]}15;color:${y[n.type]};font-weight:600">${k[n.type]||n.type}</span></td>
          <td style="padding:10px">${p(n.client_name)}</td>
          <td style="padding:10px;color:var(--text-3)">${$}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${u(n.total_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${x}12;color:${x};font-weight:600">${h[n.status]||n.status}</span></td>
          <td style="padding:10px;text-align:right">
            <button onclick="downloadInvoicePDF('${n.id}')" title="Télécharger PDF" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
            ${n.status==="draft"?`<button onclick="changeInvoiceStatus('${n.id}','sent')" title="Marquer envoyée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`:""}
            ${n.status==="sent"||n.status==="overdue"?`<button onclick="changeInvoiceStatus('${n.id}','paid')" title="Marquer payée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`:""}
            ${n.status==="draft"?`<button onclick="deleteInvoice('${n.id}')" title="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`:""}
          </td>
        </tr>`}),o+="</tbody></table></div>"),c.getBusiness()?.settings?.iban||(o+=`<div class="card" style="background:var(--gold-bg);border:1px solid #E0D4A8;margin-top:14px;padding:14px 18px">
        <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Ajoutez votre IBAN</strong> dans Paramètres → Infos salon pour l'afficher sur vos factures et générer la communication structurée belge.</p>
      </div>`),e.innerHTML=o}catch(t){e.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${p(t.message)}</div>`}}async function E(e="invoice"){let t=[];try{const o=await c.get("/api/clients");t=o.clients||o||[]}catch(o){console.warn("Impossible de charger les clients pour la facture:",o.message)}const r=e==="quote",a=r?"Nouveau devis":"Nouvelle facture",i=document.createElement("div");i.className="m-overlay open",i.id="invModal",i.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${a}</h3>
      <button class="m-close" onclick="closeModal('invModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="m-body" style="display:grid;gap:12px">
      <div>
        <label class="m-field-label">Client</label>
        <select class="m-input" id="invClient">
          <option value="">— Sélectionner un client —</option>
          ${t.map(o=>`<option value="${o.id}">${p(o.full_name)}${o.email?" ("+p(o.email)+")":""}</option>`).join("")}
        </select>
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
          <label class="m-field-label">${r?"Validité (jours)":"Échéance (jours)"}</label>
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
      <button class="m-btn m-btn-primary" onclick="saveInvoice('${e}')">${r?"Créer le devis":"Créer la facture"}</button>
    </div>
  </div>`,document.body.appendChild(i),w(document.getElementById("invModal")),b(),f()}function b(){const e=document.getElementById("invLines");if(!e)return;const t=document.createElement("div");t.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",t.innerHTML=`
    <input class="inv-desc" placeholder="Description prestation" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="1" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" placeholder="Prix €" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,e.appendChild(t)}function f(){const e=document.getElementById("invLines"),t=document.getElementById("invTotals");if(!e||!t)return;const r=parseFloat(document.getElementById("invVat")?.value||21);let a=0;e.querySelectorAll(":scope > div").forEach(v=>{const n=parseFloat(v.querySelector(".inv-qty")?.value||1),m=parseFloat(v.querySelector(".inv-price")?.value||0);a+=n*m*100});const i=Math.round(a*r/100),o=a+i;t.innerHTML=`
    <div style="font-size:.82rem;color:var(--text-3)">Sous-total HT : <strong>${u(a)}</strong></div>
    <div style="font-size:.82rem;color:var(--text-3)">TVA (${r}%) : <strong>${u(i)}</strong></div>
    <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:4px">Total TTC : ${u(o)}</div>`}async function z(e){const t=document.getElementById("invClient")?.value;if(!t){l.toast("Sélectionnez un client","error");return}const r=document.getElementById("invLines"),a=[];if(r.querySelectorAll(":scope > div").forEach(i=>{const o=i.querySelector(".inv-desc")?.value?.trim(),v=parseFloat(i.querySelector(".inv-qty")?.value||1),n=parseFloat(i.querySelector(".inv-price")?.value||0);o&&n>0&&a.push({description:o,quantity:v,unit_price_cents:Math.round(n*100)})}),a.length===0){l.toast("Ajoutez au moins une ligne","error");return}try{const i={client_id:t,type:e||"invoice",items:a,vat_rate:parseFloat(document.getElementById("invVat")?.value||21),due_days:parseInt(document.getElementById("invDueDays")?.value||30),client_bce:document.getElementById("invClientBce")?.value?.trim()||void 0,notes:document.getElementById("invNotes")?.value?.trim()||void 0},o=await c.post("/api/invoices",i);document.getElementById("invModal")._dirtyGuard?.markClean(),closeModal("invModal"),l.toast(e==="quote"?"Devis créé !":"Facture créée !","success"),g()}catch(i){l.toast(i.message||"Erreur","error")}}async function B(e,t){if(confirm({sent:"Marquer comme envoyée ?",paid:"Marquer comme payée ?"}[t]||`Changer le statut en "${t}" ?`))try{await c.patch(`/api/invoices/${e}/status`,{status:t}),l.toast("Statut mis à jour","success"),g()}catch(a){l.toast(a.message||"Erreur","error")}}async function M(e){if(confirm("Supprimer ce brouillon ?"))try{await c.delete(`/api/invoices/${e}`),l.toast("Brouillon supprimé","success"),g()}catch(t){l.toast(t.message||"Erreur","error")}}function T(e){const t=localStorage.getItem("genda_token");window.open(`/api/invoices/${e}/pdf?token=${t}`,"_blank")}async function q(e){if(confirm("Créer une facture pour ce rendez-vous ?"))try{const t=await c.post("/api/invoices",{booking_id:e,type:"invoice"});l.toast("Facture créée ! Retrouvez-la dans Facturation.","success"),document.querySelectorAll(".ni").forEach(r=>r.classList.remove("active")),document.querySelector('[data-section="invoices"]')?.classList.add("active"),document.getElementById("pageTitle").textContent="Facturation",g()}catch(t){l.toast(t.message||"Erreur","error")}}Object.defineProperty(window,"invoiceFilter",{get(){return s},set(e){s=e}});Object.defineProperty(window,"invoiceType",{get(){return d},set(e){d=e}});I({loadInvoices:g,openInvoiceModal:E,addInvoiceLine:b,updateInvTotals:f,saveInvoice:z,changeInvoiceStatus:B,deleteInvoice:M,downloadInvoicePDF:T,createInvoiceFromBooking:q});export{b as addInvoiceLine,B as changeInvoiceStatus,q as createInvoiceFromBooking,M as deleteInvoice,T as downloadInvoicePDF,g as loadInvoices,E as openInvoiceModal,z as saveInvoice,f as updateInvTotals};
