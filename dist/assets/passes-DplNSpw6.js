import{a as m,k as A,d as F,s as S,G as o,m as d,n as w}from"./dashboard-1J911296.js";import{i as I,s as j}from"./plan-gate-Badg7tzn.js";import{releaseFocus as D,trapFocus as k}from"./focus-trap-C-UMhpsq.js";import{f as T}from"./format-BId5UBOs.js";import{r as N}from"./pagination-DxEIci4p.js";let p="all",u="",x=0;const z=50;let h={total_count:0,limit:z,offset:0},g=[];function l(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}let $=!0;async function v(){if(!I()){j(document.getElementById("contentArea"),"Abonnements");return}const s=document.getElementById("contentArea");s.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const e=new URLSearchParams;p!=="all"&&e.set("status",p),u.trim()&&e.set("search",u.trim()),e.set("limit",String(z)),e.set("offset",String(x));const a=await m.get(`/api/passes?${e}`),t=a.passes||[];g=t,$=a.feature_enabled!==!1,h=a.pagination||{total_count:t.length,limit:z,offset:x};const n=a.stats||{};L(s,t,n)}catch(e){s.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${l(e.message)}</div>`}}function L(s,e,a){e=e||g,a=a||{};let t="";$||(t+=`<div class="card" style="padding:14px 18px;margin-bottom:14px;background:#FFF8E1;border-left:4px solid #F9A825">
      <div style="font-size:.85rem;font-weight:600;color:#5D4037">Les abonnements sont désactivés</div>
      <div style="font-size:.78rem;color:#6D5344;margin-top:4px">Vous ne pouvez pas en créer de nouveaux tant que la fonctionnalité est désactivée. Les pass existants restent gérables (débit, remboursement). Pour activer : <a href="#" onclick="document.querySelector('[data-section=settings]')?.click();return false" style="color:#F9A825;font-weight:600;text-decoration:underline">Paramètres &rsaquo; Abonnements</a>.</div>
    </div>`),t+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat-card"><div class="label">Total vendus</div><div class="val" style="color:var(--primary)">${a.total_sessions_sold||0} séances</div><div class="sub">${a.total_count||0} passes</div></div>
    <div class="stat-card"><div class="label">Séances restantes</div><div class="val" style="color:var(--gold)">${a.total_sessions_remaining||0}</div><div class="sub">non utilisées</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="passFilter='active';loadPasses()"><div class="label">Passes actifs</div><div class="val" style="color:var(--green)">${a.active_count||0}</div><div class="sub">en circulation</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="passFilter='used';loadPasses()"><div class="label">Passes utilisés</div><div class="val" style="color:var(--text-3)">${a.used_count||0}</div><div class="sub">séances épuisées</div></div>
  </div>`;const f=[{v:"all",l:"Tous"},{v:"active",l:"Actifs"},{v:"used",l:"Utilisés"},{v:"expired",l:"Expirés"},{v:"cancelled",l:"Annulés"}].map(c=>{const i=p===c.v;return`<button onclick="passFilter='${c.v}';loadPasses()" class="btn-sm${i?" active":""}">${c.l}</button>`}).join("");if(t+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    ${f}
    <div style="flex:1"></div>
    <input type="text" placeholder="Rechercher par code ou nom..." value="${l(u)}" onkeydown="if(event.key==='Enter'){passSearch=this.value;loadPasses()}" onblur="passSearchInput(this.value)" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem;min-width:200px">
    ${$?'<button onclick="openCreatePass()" class="btn-primary btn-sm"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Créer un pass</button>':'<button disabled title="Activez la fonctionnalité dans les Paramètres" aria-label="Activez la fonctionnalité dans les Paramètres" class="btn-primary btn-sm" style="opacity:.5;cursor:not-allowed"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Créer un pass</button>'}
  </div>`,e.length===0)t+='<div class="card"><div class="empty">Aucun pass trouvé.</div></div>';else{t+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Code</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Prestation</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Séances</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Expiration</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`;const c={active:"var(--green)",used:"var(--text-3)",expired:"var(--gold)",cancelled:"var(--red)"},i={active:"Actif",used:"Utilisé",expired:"Expiré",cancelled:"Annulé"};e.forEach(r=>{const y=c[r.status]||"var(--text-4)",C=r.expires_at?new Date(r.expires_at).toLocaleDateString("fr-BE",{timeZone:"Europe/Brussels"}):"—",_=r.buyer_name||"—",P=r.buyer_email||"",E=r.service_name||"—",R=r.status==="active",M=parseInt(r.sessions_remaining||0),B=parseInt(r.sessions_total||0);let b="";R?(b+=`<button onclick="openDebitPass('${r.id}')" title="Débiter 1 séance" aria-label="Débiter 1 séance" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`,b+=`<button onclick="refundPass('${r.id}')" title="Rembourser 1 séance" aria-label="Rembourser 1 séance" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`,r.stripe_payment_intent_id&&(b+=`<button onclick="fullRefundPass('${r.id}')" title="Remboursement total (Stripe + annulation)" aria-label="Remboursement total (Stripe + annulation)" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></svg></button>`),b+=`<button onclick="cancelPass('${r.id}')" title="Annuler" aria-label="Annuler" style="background:none;border:none;cursor:pointer;color:var(--gold);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>`):r.status==="used"&&(b+=`<button onclick="refundPass('${r.id}')" title="Rembourser 1 séance" aria-label="Rembourser 1 séance" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`),b+=`<button onclick="deletePass('${r.id}','${A(r.code)}')" title="Supprimer" aria-label="Supprimer" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`,t+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px"><span style="font-family:monospace;font-weight:600;font-size:.8rem;letter-spacing:.5px">${l(r.code)}</span></td>
        <td style="padding:10px"><div style="font-weight:500">${l(_)}</div>${P?`<div style="font-size:.7rem;color:var(--text-4)">${l(P)}</div>`:""}</td>
        <td style="padding:10px;color:var(--text-2)">${l(E)}</td>
        <td style="padding:10px;text-align:center;font-weight:600"><span style="color:${M>0?"var(--green)":"var(--text-4)"}">${M}</span><span style="color:var(--text-4);font-weight:400">/${B}</span></td>
        <td style="padding:10px;font-size:.78rem;color:var(--text-3)">${C}</td>
        <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${y}12;color:${y};font-weight:600">${l(i[r.status]||r.status)}</span></td>
        <td style="padding:10px;text-align:center;white-space:nowrap">${b}</td>
      </tr>`}),t+="</tbody></table></div>",t+=N({total:h.total_count,limit:h.limit,offset:h.offset,onPage:"passesGoToPage",label:"pass"})}s.innerHTML=t}async function q(){d("passCreateModal");let s=[];try{const t=await m.get("/api/services");s=(t.services||t||[]).filter(n=>n.is_active!==!1)}catch(t){console.error("[passes] fetch services failed",t),o.toast("Impossible de charger les prestations: "+t.message,"error")}const e=s.map(t=>`<option value="${l(t.id)}">${l(t.name)}${t.price_cents!=null?" — "+T(t.price_cents):""}</option>`).join(""),a=document.createElement("div");a.className="m-overlay open",a.id="passCreateModal",a.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>Créer un pass</h3>
      <button class="m-close" onclick="closeModal('passCreateModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Prestation</label>
        <select id="passServiceSelect" onchange="passServiceChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">— Saisie manuelle —</option>
          ${e}
        </select>
      </div>

      <div id="passManualNameRow" style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Nom du pass <span style="color:var(--text-4);font-weight:400">(saisie manuelle)</span></label>
        <input type="text" id="passNameManual" placeholder="Ex: Pack 10 Massages" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px;display:flex;gap:12px">
        <div style="flex:1">
          <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Nombre de séances</label>
          <input type="number" id="passSessionsTotal" min="1" step="1" placeholder="10" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
        </div>
        <div style="flex:1">
          <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Prix total (€)</label>
          <input type="number" id="passAmountEur" min="0" step="0.01" placeholder="0,00" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
        </div>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Nom du client</label>
        <input type="text" id="passBuyerName" placeholder="Prénom Nom" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Email du client <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="email" id="passBuyerEmail" placeholder="email@exemple.com" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date d'expiration <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="date" id="passExpiresAt" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('passCreateModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitCreatePass()">Créer le pass</button>
    </div>
  </div>`,document.body.appendChild(a),w(a,{noBackdropClose:!0}),k(a,()=>d(a.id))}function H(){const s=document.getElementById("passServiceSelect"),e=document.getElementById("passManualNameRow");s.value?e.style.display="none":e.style.display=""}async function V(){const s=document.getElementById("passServiceSelect").value.trim(),e=document.getElementById("passNameManual").value.trim(),a=parseInt(document.getElementById("passSessionsTotal").value),t=parseFloat(document.getElementById("passAmountEur").value),n=document.getElementById("passBuyerName").value.trim(),f=document.getElementById("passBuyerEmail").value.trim(),c=document.getElementById("passExpiresAt").value,i=document.getElementById("passServiceSelect"),r=s?i.options[i.selectedIndex].text.split(" — ")[0]:e;if(!r){o.toast("Veuillez choisir une prestation ou saisir un nom","error");return}if(!a||a<1){o.toast("Veuillez saisir un nombre de séances valide","error");return}if(!t||t<=0){o.toast("Veuillez saisir un prix valide","error");return}if(!n){o.toast("Veuillez saisir le nom du client","error");return}try{await m.post("/api/passes",{service_id:s||void 0,name:r,sessions_total:a,price_cents:Math.round(t*100),buyer_name:n,buyer_email:f||void 0,expires_at:c||void 0}),d("passCreateModal"),o.toast("Pass créé avec succès","success"),v()}catch(y){o.toast(y.message||"Erreur lors de la création","error")}}function G(s){const e=g.find(n=>n.id===s);if(!e){o.toast("Pass introuvable","error");return}d("passDebitModal");const a=parseInt(e.sessions_remaining||0),t=document.createElement("div");t.className="m-overlay open",t.id="passDebitModal",t.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Débiter — ${l(e.code)}</h3>
      <button class="m-close" onclick="closeModal('passDebitModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="font-size:.82rem;color:var(--text-3)">Séances restantes</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--green)">${a} / ${parseInt(e.sessions_total||0)}</div>
        <div style="font-size:.75rem;color:var(--text-3);margin-top:2px">${l(e.service_name||"—")}</div>
      </div>
      ${a<=0?'<div style="padding:10px;background:var(--red)12;border-radius:var(--radius-xs);color:var(--red);font-size:.82rem;text-align:center">Aucune séance disponible</div>':'<p style="font-size:.85rem;color:var(--text-2);margin:0">Cliquez sur "Débiter" pour déduire 1 séance de ce pass.</p>'}
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('passDebitModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="debitPass('${e.id}')" ${a<=0?"disabled":""}>Débiter 1 séance</button>
    </div>
  </div>`,document.body.appendChild(t),w(t,{noBackdropClose:!0}),k(t,()=>d(t.id))}async function O(s){const e=document.querySelector("#passDebitModal .m-btn-primary");if(!e?.disabled){e&&(e.disabled=!0,e.textContent="Traitement...");try{await m.post(`/api/passes/${s}/debit`),d("passDebitModal"),o.toast("Séance débitée avec succès","success"),v()}catch(a){e&&(e.disabled=!1,e.textContent="Débiter 1 séance"),o.toast(a.message||"Erreur lors du débit","error")}}}async function U(s){const e=g.find(f=>f.id===s);if(!e){o.toast("Pass introuvable","error");return}d("passRefundModal");const a=parseInt(e.sessions_remaining||0),t=parseInt(e.sessions_total||0),n=document.createElement("div");n.className="m-overlay open",n.id="passRefundModal",n.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Rembourser — ${l(e.code)}</h3>
      <button class="m-close" onclick="closeModal('passRefundModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="display:flex;justify-content:space-between;font-size:.82rem">
          <span style="color:var(--text-3)">Séances totales</span><span style="font-weight:600">${t}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Séances restantes</span><span style="font-weight:600;color:var(--green)">${a}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Séances utilisées</span><span style="font-weight:600">${t-a}</span>
        </div>
      </div>
      <p style="font-size:.85rem;color:var(--text-2);margin:0">Cliquez sur "Rembourser" pour ajouter 1 séance à ce pass.</p>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('passRefundModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitRefundPass('${e.id}')">Rembourser 1 séance</button>
    </div>
  </div>`,document.body.appendChild(n),w(n,{noBackdropClose:!0}),k(n,()=>d(n.id))}async function Z(s){const e=document.querySelector("#passRefundModal .m-btn-primary");if(!e?.disabled){e&&(e.disabled=!0,e.textContent="Traitement...");try{await m.post(`/api/passes/${s}/refund`),d("passRefundModal"),o.toast("Séance remboursée avec succès","success"),v()}catch(a){e&&(e.disabled=!1,e.textContent="Rembourser 1 séance"),o.toast(a.message||"Erreur lors du remboursement","error")}}}async function J(s){const e=g.find(r=>r.id===s);if(!e){o.toast("Pass introuvable","error");return}const a=parseInt(e.sessions_remaining||0),t=parseInt(e.sessions_total||0),n=t>0?Math.round((e.price_cents||0)/t):0,c=(a*n/100).toFixed(2).replace(".",",")+" €",i=document.createElement("div");i.className="m-overlay open",i.id="passFullRefundModal",i.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Remboursement total — ${l(e.code)}</h3>
      <button class="m-close" onclick="closeModal('passFullRefundModal')" aria-label="Fermer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--red-bg,#FEF2F2);border-left:3px solid var(--red);border-radius:var(--radius-xs)">
        <div style="font-size:.85rem;color:var(--text-2);font-weight:600;margin-bottom:4px">Action irréversible</div>
        <div style="font-size:.8rem;color:var(--text-3)">Le pass sera annulé et le client sera remboursé via Stripe. Les séances déjà utilisées (${t-a}) ne sont pas remboursées.</div>
      </div>
      <div style="padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="display:flex;justify-content:space-between;font-size:.82rem">
          <span style="color:var(--text-3)">Séances restantes</span><span style="font-weight:600;color:var(--green)">${a}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Remboursement estimé (brut)</span><span style="font-weight:600">${c}</span>
        </div>
        <div style="font-size:.72rem;color:var(--text-4);margin-top:6px">Si votre politique est "net", les frais Stripe (~1.5% + 25c) seront déduits. Le montant réel apparaît dans les logs après traitement.</div>
      </div>
      <label style="display:block;margin-top:12px;font-size:.8rem;color:var(--text-3)">Raison (optionnel)</label>
      <input id="fullRefundReason" class="m-input" type="text" maxlength="200" placeholder="Ex: Client insatisfait" style="margin-top:4px">
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('passFullRefundModal')">Annuler</button>
      <button class="m-btn m-btn-danger" onclick="submitFullRefundPass('${e.id}')">Rembourser et annuler</button>
    </div>
  </div>`,document.body.appendChild(i),w(i,{noBackdropClose:!0}),k(i,()=>d("passFullRefundModal"))}async function K(s){const e=document.querySelector("#passFullRefundModal .m-btn-danger");if(!e?.disabled){e&&(e.disabled=!0,e.textContent="Traitement...");try{const a=document.getElementById("fullRefundReason")?.value?.trim()||null,t=await m.post(`/api/passes/${s}/refund-full`,{reason:a});if(D(),d("passFullRefundModal"),t.stripe_refund_cents!=null){const n=(t.stripe_refund_cents/100).toFixed(2).replace(".",",")+" €";o.toast(`Pass remboursé (${n} Stripe${t.stripe_fees_cents>0?" — frais "+(t.stripe_fees_cents/100).toFixed(2).replace(".",",")+" €":""})`,"success")}else o.toast("Pass annulé (pas de paiement Stripe à rembourser)","success");v()}catch(a){e&&(e.disabled=!1,e.textContent="Rembourser et annuler"),o.toast(a.message||"Erreur lors du remboursement total","error")}}}async function Q(s){const e=g.find(t=>t.id===s);if(!e){o.toast("Pass introuvable","error");return}if(await S("Annuler le pass",`Annuler le pass ${e.code} ? Cette action est irréversible.`,"Annuler le pass","danger"))try{await m.patch(`/api/passes/${s}`,{status:"cancelled"}),o.toast("Pass annulé","success"),v()}catch(t){o.toast(t.message||"Erreur lors de l'annulation","error")}}async function W(s,e){if(await S("Supprimer le pass",`Supprimer définitivement le pass ${e} ? Cette action est irréversible.`,"Supprimer","danger"))try{await m.delete(`/api/passes/${s}`),o.toast("Pass supprimé","success"),v()}catch(t){o.toast(t.message||"Erreur lors de la suppression","error")}}function X(s){p!==s&&(x=0),p=s}function Y(s){u!==s&&(x=0),u=s}Object.defineProperty(window,"passFilter",{get(){return p},set(s){p!==s&&(x=0),p=s},configurable:!0});Object.defineProperty(window,"passSearch",{get(){return u},set(s){u!==s&&(x=0),u=s},configurable:!0});function ee(s){x=Math.max(0,parseInt(s)||0),v()}F({loadPasses:v,openCreatePass:q,submitCreatePass:V,passServiceChanged:H,openDebitPass:G,debitPass:O,refundPass:U,submitRefundPass:Z,fullRefundPass:J,submitFullRefundPass:K,cancelPass:Q,deletePass:W,setPassFilter:X,passSearchInput:Y,passesGoToPage:ee});export{v as loadPasses,L as renderPasses};
