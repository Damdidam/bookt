import{a as c,d as P,s as w,G as n,n as y}from"./dashboard-CAdIVIet.js";let m="all",v="",b=[];function l(t){return String(t||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function C(t){return((t||0)/100).toFixed(2).replace(".",",")+" €"}async function x(){const t=document.getElementById("contentArea");t.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const e=new URLSearchParams;m!=="all"&&e.set("status",m),v.trim()&&e.set("search",v.trim());const o=await c.get(`/api/passes?${e}`),s=o.passes||[];b=s;const r=o.stats||{};I(t,s,r)}catch(e){t.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${l(e.message)}</div>`}}function I(t,e,o){e=e||b,o=o||{};let s="";s+=`<div class="stats" style="grid-template-columns:repeat(4,1fr)">
    <div class="stat-card"><div class="label">Total vendus</div><div class="val" style="color:var(--primary)">${o.total_sessions_sold||0} séances</div><div class="sub">${o.total_count||0} passes</div></div>
    <div class="stat-card"><div class="label">Séances restantes</div><div class="val" style="color:var(--gold)">${o.total_sessions_remaining||0}</div><div class="sub">non utilisées</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="passFilter='active';loadPasses()"><div class="label">Passes actifs</div><div class="val" style="color:var(--green)">${o.active_count||0}</div><div class="sub">en circulation</div></div>
    <div class="stat-card" style="cursor:pointer" onclick="passFilter='used';loadPasses()"><div class="label">Passes utilisés</div><div class="val" style="color:var(--text-3)">${o.used_count||0}</div><div class="sub">séances épuisées</div></div>
  </div>`;const i=[{v:"all",l:"Tous"},{v:"active",l:"Actifs"},{v:"used",l:"Utilisés"},{v:"expired",l:"Expirés"},{v:"cancelled",l:"Annulés"}].map(d=>{const p=m===d.v;return`<button onclick="passFilter='${d.v}';loadPasses()" class="btn-sm${p?" active":""}">${d.l}</button>`}).join("");if(s+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    ${i}
    <div style="flex:1"></div>
    <input type="text" placeholder="Rechercher par code ou nom..." value="${l(v)}" onkeydown="if(event.key==='Enter'){passSearch=this.value;loadPasses()}" onblur="passSearchInput(this.value)" style="padding:6px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.78rem;min-width:200px">
    <button onclick="openCreatePass()" class="btn-primary"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Créer un pass</button>
  </div>`,e.length===0)s+='<div class="card"><div class="empty">Aucun pass trouvé.</div></div>';else{s+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Code</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Client</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Prestation</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Séances</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Expiration</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`;const d={active:"var(--green)",used:"var(--text-3)",expired:"var(--gold)",cancelled:"var(--red)"},p={active:"Actif",used:"Utilisé",expired:"Expiré",cancelled:"Annulé"};e.forEach(a=>{const g=d[a.status]||"var(--text-4)",k=a.expires_at?new Date(a.expires_at).toLocaleDateString("fr-BE"):"—",z=a.buyer_name||"—",f=a.buyer_email||"",$=a.service_name||"—",E=a.status==="active",h=parseInt(a.sessions_remaining||0),B=parseInt(a.sessions_total||0);let u="";E?(u+=`<button onclick="openDebitPass('${a.id}')" title="Débiter 1 séance" style="background:none;border:none;cursor:pointer;color:var(--primary);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><line x1="5" y1="12" x2="19" y2="12"/></svg></button>`,u+=`<button onclick="refundPass('${a.id}')" title="Rembourser 1 séance" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`,u+=`<button onclick="cancelPass('${a.id}')" title="Annuler" style="background:none;border:none;cursor:pointer;color:var(--gold);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg></button>`):a.status==="used"&&(u+=`<button onclick="refundPass('${a.id}')" title="Rembourser 1 séance" style="background:none;border:none;cursor:pointer;color:var(--blue);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg></button>`),u+=`<button onclick="deletePass('${a.id}','${l(a.code)}')" title="Supprimer" style="background:none;border:none;cursor:pointer;color:var(--red);font-size:.78rem;padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`,s+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px"><span style="font-family:monospace;font-weight:600;font-size:.8rem;letter-spacing:.5px">${l(a.code)}</span></td>
        <td style="padding:10px"><div style="font-weight:500">${l(z)}</div>${f?`<div style="font-size:.7rem;color:var(--text-4)">${l(f)}</div>`:""}</td>
        <td style="padding:10px;color:var(--text-2)">${l($)}</td>
        <td style="padding:10px;text-align:center;font-weight:600"><span style="color:${h>0?"var(--green)":"var(--text-4)"}">${h}</span><span style="color:var(--text-4);font-weight:400">/${B}</span></td>
        <td style="padding:10px;font-size:.78rem;color:var(--text-3)">${k}</td>
        <td style="padding:10px;text-align:center"><span style="font-size:.72rem;padding:3px 10px;border-radius:10px;background:${g}12;color:${g};font-weight:600">${p[a.status]||a.status}</span></td>
        <td style="padding:10px;text-align:center;white-space:nowrap">${u}</td>
      </tr>`}),s+="</tbody></table></div>"}t.innerHTML=s}async function S(){const t=document.getElementById("passCreateModal");t&&t.remove();let e=[];try{const r=await c.get("/api/services");e=(r.services||r||[]).filter(i=>i.is_active!==!1)}catch(r){console.error("[passes] fetch services failed",r),n.toast("Impossible de charger les prestations: "+r.message,"error")}const o=e.map(r=>`<option value="${l(r.id)}">${l(r.name)}${r.price_cents!=null?" — "+C(r.price_cents):""}</option>`).join(""),s=document.createElement("div");s.className="m-overlay open",s.id="passCreateModal",s.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>Créer un pass</h3>
      <button class="m-close" onclick="document.getElementById('passCreateModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Prestation</label>
        <select id="passServiceSelect" onchange="passServiceChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">— Saisie manuelle —</option>
          ${o}
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
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('passCreateModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitCreatePass()">Créer le pass</button>
    </div>
  </div>`,document.body.appendChild(s),y(s,{noBackdropClose:!0})}function M(){const t=document.getElementById("passServiceSelect"),e=document.getElementById("passManualNameRow");t.value?e.style.display="none":e.style.display=""}async function _(){const t=document.getElementById("passServiceSelect").value.trim(),e=document.getElementById("passNameManual").value.trim(),o=parseInt(document.getElementById("passSessionsTotal").value),s=parseFloat(document.getElementById("passAmountEur").value),r=document.getElementById("passBuyerName").value.trim(),i=document.getElementById("passBuyerEmail").value.trim(),d=document.getElementById("passExpiresAt").value,p=document.getElementById("passServiceSelect"),a=t?p.options[p.selectedIndex].text.split(" — ")[0]:e;if(!a){n.toast("Veuillez choisir une prestation ou saisir un nom","error");return}if(!o||o<1){n.toast("Veuillez saisir un nombre de séances valide","error");return}if(!s||s<=0){n.toast("Veuillez saisir un prix valide","error");return}if(!r){n.toast("Veuillez saisir le nom du client","error");return}try{await c.post("/api/passes",{service_id:t||void 0,name:a,sessions_total:o,price_cents:Math.round(s*100),buyer_name:r,buyer_email:i||void 0,expires_at:d||void 0}),document.getElementById("passCreateModal").remove(),n.toast("Pass créé avec succès","success"),x()}catch(g){n.toast(g.message||"Erreur lors de la création","error")}}function A(t){const e=b.find(i=>i.id===t);if(!e){n.toast("Pass introuvable","error");return}const o=document.getElementById("passDebitModal");o&&o.remove();const s=parseInt(e.sessions_remaining||0),r=document.createElement("div");r.className="m-overlay open",r.id="passDebitModal",r.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Débiter — ${l(e.code)}</h3>
      <button class="m-close" onclick="document.getElementById('passDebitModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="font-size:.82rem;color:var(--text-3)">Séances restantes</div>
        <div style="font-size:1.2rem;font-weight:700;color:var(--green)">${s} / ${parseInt(e.sessions_total||0)}</div>
        <div style="font-size:.75rem;color:var(--text-3);margin-top:2px">${l(e.service_name||"—")}</div>
      </div>
      ${s<=0?'<div style="padding:10px;background:var(--red)12;border-radius:var(--radius-xs);color:var(--red);font-size:.82rem;text-align:center">Aucune séance disponible</div>':'<p style="font-size:.85rem;color:var(--text-2);margin:0">Cliquez sur "Débiter" pour déduire 1 séance de ce pass.</p>'}
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('passDebitModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="debitPass('${e.id}')" ${s<=0?"disabled":""}>Débiter 1 séance</button>
    </div>
  </div>`,document.body.appendChild(r),y(r,{noBackdropClose:!0})}async function R(t){try{await c.post(`/api/passes/${t}/debit`),document.getElementById("passDebitModal").remove(),n.toast("Séance débitée avec succès","success"),x()}catch(e){n.toast(e.message||"Erreur lors du débit","error")}}async function j(t){const e=b.find(d=>d.id===t);if(!e){n.toast("Pass introuvable","error");return}const o=document.getElementById("passRefundModal");o&&o.remove();const s=parseInt(e.sessions_remaining||0),r=parseInt(e.sessions_total||0),i=document.createElement("div");i.className="m-overlay open",i.id="passRefundModal",i.innerHTML=`<div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Rembourser — ${l(e.code)}</h3>
      <button class="m-close" onclick="document.getElementById('passRefundModal').remove()"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px;padding:12px;background:var(--surface);border-radius:var(--radius-xs)">
        <div style="display:flex;justify-content:space-between;font-size:.82rem">
          <span style="color:var(--text-3)">Séances totales</span><span style="font-weight:600">${r}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Séances restantes</span><span style="font-weight:600;color:var(--green)">${s}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:.82rem;margin-top:4px">
          <span style="color:var(--text-3)">Séances utilisées</span><span style="font-weight:600">${r-s}</span>
        </div>
      </div>
      <p style="font-size:.85rem;color:var(--text-2);margin:0">Cliquez sur "Rembourser" pour ajouter 1 séance à ce pass.</p>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('passRefundModal').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="submitRefundPass('${e.id}')">Rembourser 1 séance</button>
    </div>
  </div>`,document.body.appendChild(i),y(i,{noBackdropClose:!0})}async function N(t){try{await c.post(`/api/passes/${t}/refund`),document.getElementById("passRefundModal").remove(),n.toast("Séance remboursée avec succès","success"),x()}catch(e){n.toast(e.message||"Erreur lors du remboursement","error")}}async function D(t){const e=b.find(s=>s.id===t);if(!e){n.toast("Pass introuvable","error");return}if(await w("Annuler le pass",`Annuler le pass ${e.code} ? Cette action est irréversible.`,"Annuler le pass","danger"))try{await c.patch(`/api/passes/${t}`,{status:"cancelled"}),n.toast("Pass annulé","success"),x()}catch(s){n.toast(s.message||"Erreur lors de l'annulation","error")}}async function T(t,e){if(await w("Supprimer le pass",`Supprimer définitivement le pass ${e} ? Cette action est irréversible.`,"Supprimer","danger"))try{await c.delete(`/api/passes/${t}`),n.toast("Pass supprimé","success"),x()}catch(s){n.toast(s.message||"Erreur lors de la suppression","error")}}function L(t){m=t}function F(t){v=t}Object.defineProperty(window,"passFilter",{get(){return m},set(t){m=t},configurable:!0});Object.defineProperty(window,"passSearch",{get(){return v},set(t){v=t},configurable:!0});P({loadPasses:x,openCreatePass:S,submitCreatePass:_,passServiceChanged:M,openDebitPass:A,debitPass:R,refundPass:j,submitRefundPass:N,cancelPass:D,deletePass:T,setPassFilter:L,passSearchInput:F});export{x as loadPasses,I as renderPasses};
