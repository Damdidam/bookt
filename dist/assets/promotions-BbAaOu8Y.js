import{a as u,e as s,d as _,s as w,G as l,m as v,n as $}from"./dashboard-n_QN53JL.js";import{trapFocus as E}from"./focus-trap-C-UMhpsq.js";import{i as k}from"./plan-gate-Badg7tzn.js";import{I as x}from"./icons-C4WsiP-A.js";let b=[],c=null;const z={min_amount:t=>`Panier min ${t||"?"} €`,specific_service:t=>`Service : ${t||"?"}`,first_visit:()=>"Nouveau client",date_range:(t,e)=>`Du ${t||"?"} au ${e||"?"}`,none:()=>"Sans condition"},C={free_service:t=>`Service offert : ${t||"?"}`,discount_pct:t=>`Réduction ${t||"?"}%`,discount_fixed:t=>`Réduction ${t||"?"} €`,info_only:()=>"Info seulement"};function M(t){const e=z[t.condition_type];return e?t.condition_type==="min_amount"?e((t.condition_min_cents/100).toFixed(2).replace(".",",")):t.condition_type==="specific_service"?e(t.condition_service_name||"?"):t.condition_type==="date_range"?e(t.condition_start_date,t.condition_end_date):e():t.condition_type||"—"}function I(t){const e=C[t.reward_type];return e?t.reward_type==="free_service"?e(t.reward_service_name||"?"):t.reward_type==="discount_fixed"?e((t.reward_value/100).toFixed(2).replace(".",",")):e(t.reward_value):t.reward_type||"—"}async function m(){const t=document.getElementById("contentArea");t.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const e=await u.get("/api/promotions"),n=e.promotions||e||[];b=n,B(t,n)}catch(e){t.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${s(e.message)}</div>`}}function B(t,e){const n=e.length,i=e.filter(r=>r.is_active).length;let o="";o+=`<div class="stats" style="grid-template-columns:repeat(2,1fr)">
    <div class="stat-card"><div class="label">Total promotions</div><div class="val" style="color:var(--primary)">${n}</div><div class="sub">créées</div></div>
    <div class="stat-card"><div class="label">Promotions actives</div><div class="val" style="color:var(--green)">${i}</div><div class="sub">en cours</div></div>
  </div>`;const d=k()||i<1;o+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    <div style="flex:1"></div>
    <span style="font-size:.78rem;color:var(--text-3)">${i}/${n} actives</span>
    ${d?'<button onclick="openPromoModal()" class="btn-primary btn-sm"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Nouvelle promotion</button>':'<button disabled style="opacity:.5;cursor:not-allowed" title="Le plan gratuit est limité à 1 promotion active" class="btn-primary btn-sm"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Nouvelle promotion</button>'}
  </div>`,e.length===0?o+='<div class="card"><div class="empty">Aucune promotion créée.</div></div>':(o+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Titre</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Condition</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Récompense</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`,e.forEach(r=>{const a=!!r.is_active;o+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px;font-weight:500">${s(r.title)}</td>
        <td style="padding:10px;color:var(--text-2);font-size:.78rem">${s(M(r))}${r.max_uses?`<div style="font-size:.7rem;color:var(--text-4);margin-top:2px">${r.current_uses||0}/${r.max_uses} utilisées</div>`:""}</td>
        <td style="padding:10px;color:var(--text-2);font-size:.78rem">${s(I(r))}</td>
        <td style="padding:10px;text-align:center">
          <label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer">
            <input type="checkbox" ${a?"checked":""} onchange="togglePromo('${r.id}',this.checked)" style="opacity:0;width:0;height:0">
            <span style="position:absolute;inset:0;background:${a?"var(--green)":"var(--border)"};border-radius:10px;transition:background .2s"></span>
            <span style="position:absolute;top:2px;left:${a?"18px":"2px"};width:16px;height:16px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
          </label>
        </td>
        <td style="padding:10px;text-align:center;white-space:nowrap">
          <button onclick="openPromoModal('${r.id}')" title="Modifier" aria-label="Modifier la promotion" style="background:none;border:none;cursor:pointer;color:var(--primary);padding:4px 6px">${x.edit}</button>
          <button onclick="deletePromo('${r.id}')" title="Supprimer" aria-label="Supprimer la promotion" style="background:none;border:none;cursor:pointer;color:var(--red);padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`}),o+="</tbody></table></div>"),t.innerHTML=o}async function P(){if(c)return c;try{const t=await u.get("/api/services");c=(t.services||t||[]).filter(e=>e.is_active!==!1)}catch(t){console.error("[promotions] fetch services failed",t),c=[]}return c}async function S(t){v("promoModal");let e=null;if(t&&(e=b.find(p=>p.id===t),!e)){l.toast("Promotion introuvable","error");return}const i=(await P()).map(p=>`<option value="${s(p.id)}">${s(p.name)}</option>`).join(""),o=e?.condition_type||"none",d=e?.reward_type||"info_only",r=e?.display_style||"banner",a=document.createElement("div");a.className="m-overlay open",a.id="promoModal",a.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${e?"Modifier la promotion":"Nouvelle promotion"}</h3>
      <button class="m-close" onclick="closeModal('promoModal')" aria-label="Fermer">${x.x}</button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Titre <span style="color:var(--red)">*</span></label>
        <input type="text" id="promoTitle" value="${s(e?.title||"")}" placeholder="Ex: -20% première visite" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Description <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <textarea id="promoDescription" rows="3" placeholder="Détails de la promotion..." style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;resize:vertical">${s(e?.description||"")}</textarea>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Type de condition</label>
        <select id="promoConditionType" onchange="promoConditionChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="none" ${o==="none"?"selected":""}>Sans condition</option>
          <option value="min_amount" ${o==="min_amount"?"selected":""}>Panier minimum</option>
          <option value="specific_service" ${o==="specific_service"?"selected":""}>Service spécifique</option>
          <option value="first_visit" ${o==="first_visit"?"selected":""}>Nouveau client</option>
          <option value="date_range" ${o==="date_range"?"selected":""}>Plage de dates</option>
        </select>
      </div>

      <div id="promoConditionFields" style="margin-bottom:14px">
        ${y(o,e,i)}
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Type de récompense</label>
        <select id="promoRewardType" onchange="promoRewardChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="info_only" ${d==="info_only"?"selected":""}>Info seulement</option>
          <option value="free_service" ${d==="free_service"?"selected":""}>Service offert</option>
          <option value="discount_pct" ${d==="discount_pct"?"selected":""}>Réduction en %</option>
          <option value="discount_fixed" ${d==="discount_fixed"?"selected":""}>Réduction en €</option>
        </select>
      </div>

      <div id="promoRewardFields" style="margin-bottom:14px">
        ${g(d,e,i)}
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Style d'affichage</label>
        <div style="display:flex;gap:10px">
          <label style="flex:1;cursor:pointer;padding:10px;border:2px solid ${r==="cards"?"var(--primary)":"var(--border)"};border-radius:var(--radius-xs);text-align:center;font-size:.82rem;background:${r==="cards"?"var(--primary-light)":"var(--surface)"}">
            <input type="radio" name="promoDisplay" value="cards" ${r==="cards"?"checked":""} style="display:none" onchange="promoDisplayChanged()"> Carte
          </label>
          <label style="flex:1;cursor:pointer;padding:10px;border:2px solid ${r==="banner"?"var(--primary)":"var(--border)"};border-radius:var(--radius-xs);text-align:center;font-size:.82rem;background:${r==="banner"?"var(--primary-light)":"var(--surface)"}">
            <input type="radio" name="promoDisplay" value="banner" ${r==="banner"?"checked":""} style="display:none" onchange="promoDisplayChanged()"> Bannière
          </label>
        </div>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Limite d'utilisation <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <input type="number" id="promoMaxUses" min="1" value="${e?.max_uses||""}" placeholder="Illimité" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
        ${e?.current_uses?'<div style="font-size:.72rem;color:var(--text-4);margin-top:4px">'+e.current_uses+" utilisation(s) enregistrée(s)</div>":""}
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('promoModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="savePromo('${t||""}')">${e?"Enregistrer":"Créer"}</button>
    </div>
  </div>`,document.body.appendChild(a),$(document.getElementById("promoModal"),{noBackdropClose:!0}),E(document.getElementById("promoModal"),()=>v("promoModal"))}function y(t,e,n){switch(t){case"min_amount":var i=e?.condition_min_cents?(e.condition_min_cents/100).toFixed(2):"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant minimum (€)</label>
        <input type="number" id="promoConditionValue" min="0" step="1" value="${s(i)}" placeholder="50" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;case"specific_service":var o=e?.condition_service_id||"",d=n.replace('value="'+o+'"','value="'+o+'" selected');return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Service concerné</label>
        <select id="promoConditionValue" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">-- Choisir --</option>${d}
        </select>`;case"date_range":var r=e?.condition_start_date?e.condition_start_date.substring(0,10):"",a=e?.condition_end_date?e.condition_end_date.substring(0,10):"";return`<div style="display:flex;gap:12px">
        <div style="flex:1"><label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date de début</label>
          <input type="date" id="promoConditionDateStart" value="${s(r)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box"></div>
        <div style="flex:1"><label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date de fin</label>
          <input type="date" id="promoConditionDateEnd" value="${s(a)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box"></div>
      </div>`;default:return""}}function g(t,e,n){switch(t){case"free_service":var i=e?.reward_service_id||"",o=n.replace('value="'+i+'"','value="'+i+'" selected');return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Service offert</label>
        <select id="promoRewardValue" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">-- Choisir --</option>${o}
        </select>`;case"discount_pct":var d=e?.reward_value||"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Pourcentage de réduction</label>
        <input type="number" id="promoRewardValue" min="1" max="100" value="${s(d)}" placeholder="20" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;case"discount_fixed":var r=e?.reward_value?(e.reward_value/100).toFixed(2):"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant de réduction (€)</label>
        <input type="number" id="promoRewardValue" min="0" step="1" value="${s(r)}" placeholder="10" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;default:return""}}function T(){const t=document.getElementById("promoConditionType").value,e=document.getElementById("promoConditionFields"),i=(c||[]).map(o=>`<option value="${s(o.id)}">${s(o.name)}</option>`).join("");e.innerHTML=y(t,null,i)}function D(){const t=document.getElementById("promoRewardType").value,e=document.getElementById("promoRewardFields"),i=(c||[]).map(o=>`<option value="${s(o.id)}">${s(o.name)}</option>`).join("");e.innerHTML=g(t,null,i)}function R(){document.querySelectorAll('input[name="promoDisplay"]').forEach(e=>{const n=e.closest("label");e.checked?(n.style.borderColor="var(--primary)",n.style.background="var(--primary-light)"):(n.style.borderColor="var(--border)",n.style.background="var(--surface)")})}async function A(t){const e=document.getElementById("promoTitle").value.trim();if(!e){l.toast("Le titre est requis","error");return}const n=document.getElementById("promoDescription").value.trim(),i=document.getElementById("promoConditionType").value,o=document.getElementById("promoRewardType").value,d=document.querySelector('input[name="promoDisplay"]:checked')?.value||"banner",r=document.getElementById("promoMaxUses")?.value,a={title:e,description:n,condition_type:i,reward_type:o,display_style:d,max_uses:r?parseInt(r):null};if(i==="min_amount"){var p=parseFloat(document.getElementById("promoConditionValue")?.value||0);a.condition_min_cents=Math.round(p*100)}else i==="specific_service"?a.condition_service_id=document.getElementById("promoConditionValue")?.value||null:i==="date_range"&&(a.condition_start_date=document.getElementById("promoConditionDateStart")?.value||null,a.condition_end_date=document.getElementById("promoConditionDateEnd")?.value||null);if(o==="free_service")a.reward_service_id=document.getElementById("promoRewardValue")?.value||null;else if(o==="discount_pct")a.reward_value=parseInt(document.getElementById("promoRewardValue")?.value||0);else if(o==="discount_fixed"){var f=parseFloat(document.getElementById("promoRewardValue")?.value||0);a.reward_value=Math.round(f*100)}try{t?(await u.patch(`/api/promotions/${t}`,a),l.toast("Promotion mise à jour","success")):(await u.post("/api/promotions",a),l.toast("Promotion créée","success")),document.getElementById("promoModal")?._dirtyGuard?.markClean(),v("promoModal"),m()}catch(h){l.toast(h.message||"Erreur lors de l'enregistrement","error")}}async function F(t,e){try{await u.patch(`/api/promotions/${t}`,{is_active:e}),l.toast(e?"Promotion activée":"Promotion désactivée","success"),m()}catch(n){l.toast(n.message||"Erreur","error")}}async function L(t){const n=b.find(i=>i.id===t)?.title||"cette promotion";if(await w(`Supprimer définitivement la promotion "${n}" ? Cette action est irréversible.`))try{await u.delete(`/api/promotions/${t}`),l.toast("Promotion supprimée","success"),m()}catch(i){l.toast(i.message||"Erreur lors de la suppression","error")}}_({loadPromotions:m,openPromoModal:S,savePromo:A,togglePromo:F,deletePromo:L,promoConditionChanged:T,promoRewardChanged:D,promoDisplayChanged:R});export{m as loadPromotions};
