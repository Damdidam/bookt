import{a as d,d as C,s as k,G as o,k as m,l as f}from"./dashboard-CDXRWKCh.js";let u="all",v="",g=[];function n(s){return String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function S(s){return((s||0)/100).toFixed(2).replace(".",",")+" €"}async function x(){const s=document.getElementById("contentArea");s.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const t=new URLSearchParams;u!=="all"&&t.set("status",u),v.trim()&&t.set("search",v.trim());const a=await d.get(`/api/passes?${t}`),e=a.passes||[];g=e;const i=a.stats||{};B(s,e,i)}catch(t){s.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${n(t.message)}</div>`}}function B(s,t,a){t=t||g,a=a||{};let e="";e+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat-card"><div class="label">Total vendus</div><div class="val" style="color:var(--primary)">${a.total_sessions_sold||0} séances</div><div class="sub">${a.total_count||0} passes</div></div>
    <div class="stat-card"><div class="label">Séances restantes</div><div class="val" style="color:var(--gold)">${a.total_sessions_remaining||0}</div><div class="sub">non utilisées</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="passFilter='active';loadPasses()"><div class="label">Passes actifs</div><div class="val" style="color:var(--green)">${a.active_count||0}</div><div class="sub">en circulation</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="passFilter='used';loadPasses()"><div class="label">Passes utilisés</div><div class="val" style="color:var(--text-3)">${a.used_count||0}</div><div class="sub">séances épuisées</div></div>
  </div>`;const b=[{v:"all",l:"Tous"},{v:"active",l:"Actifs"},{v:"used",l:"Utilisés"},{v:"expired",l:"Expirés"},{v:"cancelled",l:"Annulés"}].map(l=>{const c=u===l.v;return`<button onclick="passFilter='${l.v}';loadPasses()" class="btn-sm${c?" active":""}">${l.l}</button>`}).join("");if(e+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    ${b}
    <div style="flex:1"></div>
    <input type="text" placeholder="Rechercher par code ou nom..." value="${n(v)}" onkeydown="if(event.key==='Enter'){passSearch=this.value;loadPasses()}" onblur="passSearchInput(this.value)" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem;min-width:200px">
    <button onclick="openCreatePass()" class="btn-primary"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Créer un pass</button>
  </div>`,t.length===0)e+='<div class="card"><div class="empty">Aucun pass trouvé.</div></div>';else{e+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Code</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Prestation</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Séances</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Expiration</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`;const l={active:"var(--green)",used:"var(--text-3)",expired:"var(--gold)",cancelled:"var(--red)"},c={active:"Actif",used:"Utilisé",expired:"Expiré",cancelled:"Annulé"};t.forEach(r=>{const y=l[r.status]||"var(--text-4)",z=r.expires_at?new Date(r.expires_at).toLocaleDateString("fr-BE"):"—",$=r.buyer_name||"—",h=r.buyer_email||"",P=r.service_name||"—",M=r.status==="active",w=parseInt(r.sessions_remaining||0),E=parseInt(r.sessions_total||0);let p="";M?(p+=`<button onclick="openDebitPass('${r.id}')" title="Débiter 1 séance" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`,p+=`<button onclick="refundPass('${r.id}')" title="Rembourser 1 séance" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`,p+=`<button onclick="cancelPass('${r.id}')" title="Annuler" style="background:none;border:none;cursor:pointer;color:var(--gold);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>`):r.status==="used"&&(p+=`<button onclick="refundPass('${r.id}')" title="Rembourser 1 séance" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`),p+=`<button onclick="deletePass('${r.id}','${n(r.code)}')" title="Supprimer" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`,e+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px"><span style="font-family:monospace;font-weight:600;font-size:.8rem;letter-spacing:.5px">${n(r.code)}</span></td>
        <td style="padding:10px"><div style="font-weight:500">${n($)}</div>${h?`<div style="font-size:.7rem;color:var(--text-4)">${n(h)}</div>`:""}</td>
        <td style="padding:10px;color:var(--text-2)">${n(P)}</td>
        <td style="padding:10px;text-align:center;font-weight:600"><span style="color:${w>0?"var(--green)":"var(--text-4)"}">${w}</span><span style="color:var(--text-4);font-weight:400">/${E}</span></td>
        <td style="padding:10px;font-size:.78rem;color:var(--text-3)">${z}</td>
        <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${y}12;color:${y};font-weight:600">${c[r.status]||r.status}</span></td>
        <td style="padding:10px;text-align:center;white-space:nowrap">${p}</td>
      </tr>`}),e+="</tbody></table></div>"}s.innerHTML=e}async function _(){m("passCreateModal");let s=[];try{const e=await d.get("/api/services");s=(e.services||e||[]).filter(i=>i.is_active!==!1)}catch(e){console.error("[passes] fetch services failed",e),o.toast("Impossible de charger les prestations: "+e.message,"error")}const t=s.map(e=>`<option value="${n(e.id)}">${n(e.name)}${e.price_cents!=null?" — "+S(e.price_cents):""}</option>`).join(""),a=document.createElement("div");a.className="m-overlay open",a.id="passCreateModal",a.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>Créer un pass</h3>
      <button class="m-close" onclick="closeModal('passCreateModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Prestation</label>
        <select id="passServiceSelect" onchange="passServiceChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">— Saisie manuelle —</option>
          ${t}
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
  </div>`,document.body.appendChild(a),f(a,{noBackdropClose:!0})}function I(){const s=document.getElementById("passServiceSelect"),t=document.getElementById("passManualNameRow");s.value?t.style.display="none":t.style.display=""}async function A(){const s=document.getElementById("passServiceSelect").value.trim(),t=document.getElementById("passNameManual").value.trim(),a=parseInt(document.getElementById("passSessionsTotal").value),e=parseFloat(document.getElementById("passAmountEur").value),i=document.getElementById("passBuyerName").value.trim(),b=document.getElementById("passBuyerEmail").value.trim(),l=document.getElementById("passExpiresAt").value,c=document.getElementById("passServiceSelect"),r=s?c.options[c.selectedIndex].text.split(" — ")[0]:t;if(!r){o.toast("Veuillez choisir une prestation ou saisir un nom","error");return}if(!a||a<1){o.toast("Veuillez saisir un nombre de séances valide","error");return}if(!e||e<=0){o.toast("Veuillez saisir un prix valide","error");return}if(!i){o.toast("Veuillez saisir le nom du client","error");return}try{await d.post("/api/passes",{service_id:s||void 0,name:r,sessions_total:a,price_cents:Math.round(e*100),buyer_name:i,buyer_email:b||void 0,expires_at:l||void 0}),m("passCreateModal"),o.toast("Pass créé avec succès","success"),x()}catch(y){o.toast(y.message||"Erreur lors de la création","error")}}function R(s){const t=g.find(i=>i.id===s);if(!t){o.toast("Pass introuvable","error");return}m("passDebitModal");const a=parseInt(t.sessions_remaining||0),e=document.createElement("div");e.className="m-overlay open",e.id="passDebitModal",e.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Débiter — ${n(t.code)}</h3>
      <button class="m-close" onclick="closeModal('passDebitModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="font-size:.82rem;color:var(--text-3)">Séances restantes</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--green)">${a} / ${parseInt(t.sessions_total||0)}</div>
        <div style="font-size:.75rem;color:var(--text-3);margin-top:2px">${n(t.service_name||"—")}</div>
      </div>
      ${a<=0?'<div style="padding:10px;background:var(--red)12;border-radius:var(--radius-xs);color:var(--red);font-size:.82rem;text-align:center">Aucune séance disponible</div>':'<p style="font-size:.85rem;color:var(--text-2);margin:0">Cliquez sur "Débiter" pour déduire 1 séance de ce pass.</p>'}
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('passDebitModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="debitPass('${t.id}')" ${a<=0?"disabled":""}>Débiter 1 séance</button>
    </div>
  </div>`,document.body.appendChild(e),f(e,{noBackdropClose:!0})}async function j(s){try{await d.post(`/api/passes/${s}/debit`),m("passDebitModal"),o.toast("Séance débitée avec succès","success"),x()}catch(t){o.toast(t.message||"Erreur lors du débit","error")}}async function N(s){const t=g.find(b=>b.id===s);if(!t){o.toast("Pass introuvable","error");return}m("passRefundModal");const a=parseInt(t.sessions_remaining||0),e=parseInt(t.sessions_total||0),i=document.createElement("div");i.className="m-overlay open",i.id="passRefundModal",i.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Rembourser — ${n(t.code)}</h3>
      <button class="m-close" onclick="closeModal('passRefundModal')"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="display:flex;justify-content:space-between;font-size:.82rem">
          <span style="color:var(--text-3)">Séances totales</span><span style="font-weight:600">${e}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Séances restantes</span><span style="font-weight:600;color:var(--green)">${a}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Séances utilisées</span><span style="font-weight:600">${e-a}</span>
        </div>
      </div>
      <p style="font-size:.85rem;color:var(--text-2);margin:0">Cliquez sur "Rembourser" pour ajouter 1 séance à ce pass.</p>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('passRefundModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitRefundPass('${t.id}')">Rembourser 1 séance</button>
    </div>
  </div>`,document.body.appendChild(i),f(i,{noBackdropClose:!0})}async function D(s){try{await d.post(`/api/passes/${s}/refund`),m("passRefundModal"),o.toast("Séance remboursée avec succès","success"),x()}catch(t){o.toast(t.message||"Erreur lors du remboursement","error")}}async function T(s){const t=g.find(e=>e.id===s);if(!t){o.toast("Pass introuvable","error");return}if(await k("Annuler le pass",`Annuler le pass ${t.code} ? Cette action est irréversible.`,"Annuler le pass","danger"))try{await d.patch(`/api/passes/${s}`,{status:"cancelled"}),o.toast("Pass annulé","success"),x()}catch(e){o.toast(e.message||"Erreur lors de l'annulation","error")}}async function L(s,t){if(await k("Supprimer le pass",`Supprimer définitivement le pass ${t} ? Cette action est irréversible.`,"Supprimer","danger"))try{await d.delete(`/api/passes/${s}`),o.toast("Pass supprimé","success"),x()}catch(e){o.toast(e.message||"Erreur lors de la suppression","error")}}function F(s){u=s}function H(s){v=s}Object.defineProperty(window,"passFilter",{get(){return u},set(s){u=s},configurable:!0});Object.defineProperty(window,"passSearch",{get(){return v},set(s){v=s},configurable:!0});C({loadPasses:x,openCreatePass:_,submitCreatePass:A,passServiceChanged:I,openDebitPass:R,debitPass:j,refundPass:N,submitRefundPass:D,cancelPass:T,deletePass:L,setPassFilter:F,passSearchInput:H});export{x as loadPasses,B as renderPasses};
