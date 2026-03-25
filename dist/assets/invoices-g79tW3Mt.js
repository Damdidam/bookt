import{a as p,G as d,o as B,d as T}from"./dashboard-hV-h-VBp.js";let l="all",u="all",m=[];function v(t){return String(t||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function g(t){return((t||0)/100).toFixed(2).replace(".",",")+" €"}async function x(){const t=document.getElementById("contentArea");t.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const e=new URLSearchParams;l!=="all"&&e.set("status",l),u!=="all"&&e.set("type",u);const n=await p.get(`/api/invoices?${e}`),o=n.invoices||[],i=n.stats||{};let a="";a+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
      <div class="stat-card"><div class="label">Brouillons</div><div class="val">${i.drafts||0}</div></div>
      <div class="stat-card"><div class="label">En attente</div><div class="val" style="color:var(--gold)">${g(parseInt(i.total_pending||0))}</div><div class="sub">${parseInt(i.sent||0)+parseInt(i.overdue||0)} factures</div></div>
      <div class="stat-card"><div class="label">Payées</div><div class="val" style="color:var(--green)">${g(parseInt(i.total_paid||0))}</div><div class="sub">${i.paid||0} factures</div></div>
      <div class="stat-card"><div class="label">En retard</div><div class="val" style="color:var(--red)">${i.overdue||0}</div></div>
    </div>`,a+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
      <button onclick="openInvoiceModal()" class="btn-primary">+ Nouvelle facture</button>
      <button onclick="openInvoiceModal('quote')" class="btn-primary" style="background:var(--gold)">+ Devis</button>
      <div style="flex:1"></div>
      <select onchange="invoiceType=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${u==="all"?"selected":""}>Tous types</option>
        <option value="invoice" ${u==="invoice"?"selected":""}>Factures</option>
        <option value="quote" ${u==="quote"?"selected":""}>Devis</option>
        <option value="credit_note" ${u==="credit_note"?"selected":""}>Notes de crédit</option>
      </select>
      <select onchange="invoiceFilter=this.value;loadInvoices()" style="padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem">
        <option value="all" ${l==="all"?"selected":""}>Tous statuts</option>
        <option value="draft" ${l==="draft"?"selected":""}>Brouillons</option>
        <option value="sent" ${l==="sent"?"selected":""}>Envoyées</option>
        <option value="paid" ${l==="paid"?"selected":""}>Payées</option>
        <option value="overdue" ${l==="overdue"?"selected":""}>En retard</option>
        <option value="cancelled" ${l==="cancelled"?"selected":""}>Annulées</option>
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
        </tr></thead><tbody>`,o.forEach(r=>{const c={draft:"var(--text-4)",sent:"var(--gold)",paid:"var(--green)",overdue:"var(--red)",cancelled:"var(--text-4)"},f={draft:"Brouillon",sent:"Envoyée",paid:"Payée",overdue:"En retard",cancelled:"Annulée"},y={invoice:"Facture",quote:"Devis",credit_note:"Note crédit"},h={invoice:"var(--primary)",quote:"var(--gold)",credit_note:"var(--text-3)"},k=c[r.status]||"var(--text-4)",E=new Date(r.issue_date).toLocaleDateString("fr-BE");a+=`<tr style="border-bottom:1px solid var(--border-light)">
          <td style="padding:10px 14px;font-weight:600">${v(r.invoice_number)}</td>
          <td style="padding:10px"><span style="font-size:.7rem;padding:2px 8px;border-radius:10px;background:${h[r.type]}15;color:${h[r.type]};font-weight:600">${y[r.type]||r.type}</span></td>
          <td style="padding:10px">${v(r.client_name)}</td>
          <td style="padding:10px;color:var(--text-3)">${E}</td>
          <td style="padding:10px;text-align:right;font-weight:600">${g(r.total_cents)}</td>
          <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${k}12;color:${k};font-weight:600">${f[r.status]||r.status}</span></td>
          <td style="padding:10px;text-align:right">
            <button onclick="downloadInvoicePDF('${r.id}')" title="Télécharger PDF" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg></button>
            ${r.status==="draft"?`<button onclick="changeInvoiceStatus('${r.id}','sent')" title="Marquer envoyée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>`:""}
            ${r.status==="sent"||r.status==="overdue"?`<button onclick="changeInvoiceStatus('${r.id}','paid')" title="Marquer payée" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg></button>`:""}
            ${r.status==="draft"?`<button onclick="deleteInvoice('${r.id}')" title="Supprimer" style="background:none;border:none;cursor:pointer;font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg></button>`:""}
          </td>
        </tr>`}),a+="</tbody></table></div>"),p.getBusiness()?.settings?.iban||(a+=`<div class="card" style="background:var(--gold-bg);border:1px solid #E0D4A8;margin-top:14px;padding:14px 18px">
        <p style="font-size:.82rem;color:var(--text-2);margin:0"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> <strong>Ajoutez votre IBAN</strong> dans Paramètres → Infos salon pour l'afficher sur vos factures et générer la communication structurée belge.</p>
      </div>`),t.innerHTML=a}catch(e){t.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${v(e.message)}</div>`}}async function z(t="invoice",e={}){let n=[];try{const s=await p.get("/api/clients");n=s.clients||s||[]}catch(s){console.warn("Impossible de charger les clients pour la facture:",s.message)}const o=t==="quote",i=o?"Nouveau devis":"Nouvelle facture",a=document.createElement("div");if(a.className="m-overlay open",a.id="invModal",a.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${i}</h3>
      <button class="m-close" onclick="closeModal('invModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>

    <div class="m-body" style="display:grid;gap:12px">
      <div>
        <label class="m-field-label">Client</label>
        <select class="m-input" id="invClient" onchange="invClientChanged()">
          <option value="">— Sélectionner un client —</option>
          ${n.map(s=>`<option value="${s.id}">${v(s.full_name)}${s.email?" ("+v(s.email)+")":""}</option>`).join("")}
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
      <button class="m-btn m-btn-primary" onclick="saveInvoice('${t}')">${o?"Créer le devis":"Créer la facture"}</button>
    </div>
  </div>`,document.body.appendChild(a),B(document.getElementById("invModal"),{noBackdropClose:!0}),$(),b(),e.preselect_client_id){const s=document.getElementById("invClient");s&&(s.value=e.preselect_client_id),await I(),(e.precheck_booking_id||e.precheck_group_id)&&setTimeout(()=>{m.forEach((r,c)=>{if(e.precheck_booking_id&&r.id===e.precheck_booking_id||e.precheck_group_id&&r.group_id===e.precheck_group_id){const y=document.querySelector(`[data-unbilled-idx="${c}"]`);y&&!y.checked&&(y.checked=!0,w(c,!0))}})},100)}}function $(){const t=document.getElementById("invLines");if(!t)return;const e=document.createElement("div");e.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",e.innerHTML=`
    <input class="inv-desc" placeholder="Description prestation" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="1" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" placeholder="Prix €" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,t.appendChild(e)}function b(){const t=document.getElementById("invLines"),e=document.getElementById("invTotals");if(!t||!e)return;const n=parseFloat(document.getElementById("invVat")?.value||21);let o=0;t.querySelectorAll(":scope > div").forEach(s=>{const r=parseFloat(s.querySelector(".inv-qty")?.value||1),c=parseFloat(s.querySelector(".inv-price")?.value||0);o+=r*c*100});const i=Math.round(o*n/100),a=o+i;e.innerHTML=`
    <div style="font-size:.82rem;color:var(--text-3)">Sous-total HT : <strong>${g(o)}</strong></div>
    <div style="font-size:.82rem;color:var(--text-3)">TVA (${n}%) : <strong>${g(i)}</strong></div>
    <div style="font-size:1rem;font-weight:700;color:var(--text);margin-top:4px">Total TTC : ${g(a)}</div>`}async function C(t){const e=document.getElementById("invClient")?.value;if(!e){d.toast("Sélectionnez un client","error");return}const n=document.getElementById("invLines"),o=[];if(n.querySelectorAll(":scope > div").forEach(i=>{const a=i.querySelector(".inv-desc")?.value?.trim(),s=parseFloat(i.querySelector(".inv-qty")?.value||1),r=parseFloat(i.querySelector(".inv-price")?.value||0),c=i.getAttribute("data-booking-id")||void 0;a&&r!==0&&o.push({description:a,quantity:s,unit_price_cents:Math.round(r*100),booking_id:c})}),o.length===0){d.toast("Ajoutez au moins une ligne","error");return}try{const i={client_id:e,type:t||"invoice",items:o,vat_rate:parseFloat(document.getElementById("invVat")?.value||21),due_days:parseInt(document.getElementById("invDueDays")?.value||30),client_bce:document.getElementById("invClientBce")?.value?.trim()||void 0,notes:document.getElementById("invNotes")?.value?.trim()||void 0},a=await p.post("/api/invoices",i);document.getElementById("invModal")._dirtyGuard?.markClean(),closeModal("invModal"),d.toast(t==="quote"?"Devis créé !":"Facture créée !","success"),x()}catch(i){d.toast(i.message||"Erreur","error")}}async function M(t,e){if(confirm({sent:"Marquer comme envoyée ?",paid:"Marquer comme payée ?"}[e]||`Changer le statut en "${e}" ?`))try{await p.patch(`/api/invoices/${t}/status`,{status:e}),d.toast("Statut mis à jour","success"),x()}catch(o){d.toast(o.message||"Erreur","error")}}async function q(t){if(confirm("Supprimer ce brouillon ?"))try{await p.delete(`/api/invoices/${t}`),d.toast("Brouillon supprimé","success"),x()}catch(e){d.toast(e.message||"Erreur","error")}}function S(t){const e=localStorage.getItem("genda_token");window.open(`/api/invoices/${t}/pdf?token=${e}`,"_blank")}async function L(t){if(confirm("Créer une facture pour ce rendez-vous ?"))try{const e=await p.post("/api/invoices",{booking_id:t,type:"invoice"});d.toast("Facture créée ! Retrouvez-la dans Facturation.","success"),document.querySelectorAll(".ni").forEach(n=>n.classList.remove("active")),document.querySelector('[data-section="invoices"]')?.classList.add("active"),document.getElementById("pageTitle").textContent="Facturation",x()}catch(e){d.toast(e.message||"Erreur","error")}}async function I(){const t=document.getElementById("invClient")?.value,e=document.getElementById("invUnbilledSection"),n=document.getElementById("invUnbilledList");if(!t||!e||!n){e&&(e.style.display="none");return}try{m=(await p.get(`/api/invoices/unbilled?client_id=${t}`)).bookings||[]}catch{m=[]}if(m.length===0){e.style.display="none";return}e.style.display="",n.innerHTML=m.map((o,i)=>{const a=new Date(o.start_at).toLocaleDateString("fr-BE"),s=o.variant_price_cents??o.service_price_cents??0,r=o.service_name+(o.variant_name?" — "+o.variant_name:"")+" ("+(o.practitioner_name||"?")+") — "+a;return`<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:.82rem;cursor:pointer;border-bottom:1px solid var(--border-light);background:${i%2===0?"var(--white)":"var(--surface)"}">
      <input type="checkbox" data-unbilled-idx="${i}" onchange="invToggleUnbilled(${i},this.checked)">
      <span style="flex:1">${v(r)}</span>
      <span style="font-weight:600;color:var(--text-2)">${g(s)}</span>
    </label>`}).join("")}function w(t,e){const n=m[t];if(!n)return;const o=document.getElementById("invLines");if(o){if(e){const i=new Date(n.start_at).toLocaleDateString("fr-BE"),a=n.service_name+(n.variant_name?" — "+n.variant_name:"")+" ("+(n.practitioner_name||"")+") — "+i,s=n.variant_price_cents??n.service_price_cents??0;if(_(n.id,a,1,s/100),n.deposit_payment_intent_id&&n.deposit_payment_intent_id.startsWith("pass_")&&n.deposit_amount_cents){const r=n.deposit_payment_intent_id.replace("pass_","");_(n.id,"Pass "+r+" (déduction)",1,-(n.deposit_amount_cents/100))}}else o.querySelectorAll(`[data-booking-id="${n.id}"]`).forEach(i=>i.remove());b()}}function _(t,e,n,o){const i=document.getElementById("invLines");if(!i)return;const a=document.createElement("div");a.style.cssText="display:grid;grid-template-columns:1fr 60px 100px 30px;gap:8px;align-items:center;margin-bottom:6px",a.setAttribute("data-booking-id",t),a.innerHTML=`
    <input class="inv-desc" value="${v(e)}" style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem">
    <input class="inv-qty" type="number" value="${n}" min="1" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:center">
    <input class="inv-price" type="number" step="0.01" value="${o.toFixed(2)}" onchange="updateInvTotals()" style="padding:8px 6px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.82rem;text-align:right">
    <button onclick="this.parentElement.remove();updateInvTotals()" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`,i.appendChild(a)}Object.defineProperty(window,"invoiceFilter",{get(){return l},set(t){l=t}});Object.defineProperty(window,"invoiceType",{get(){return u},set(t){u=t}});T({loadInvoices:x,openInvoiceModal:z,addInvoiceLine:$,updateInvTotals:b,saveInvoice:C,changeInvoiceStatus:M,deleteInvoice:q,downloadInvoicePDF:S,createInvoiceFromBooking:L,invClientChanged:I,invToggleUnbilled:w});export{$ as addInvoiceLine,M as changeInvoiceStatus,L as createInvoiceFromBooking,q as deleteInvoice,S as downloadInvoicePDF,x as loadInvoices,z as openInvoiceModal,C as saveInvoice,b as updateInvTotals};
