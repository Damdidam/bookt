import{a as u,e as s,d as h,s as _,G as d,k as v,l as w}from"./dashboard-lFL52qqi.js";import{I as b}from"./icons-DATqSsmT.js";let x=[],c=null;const $={min_amount:t=>`Panier min ${t||"?"} €`,specific_service:t=>`Service : ${t||"?"}`,first_visit:()=>"Nouveau client",date_range:(t,e)=>`Du ${t||"?"} au ${e||"?"}`,none:()=>"Sans condition"},E={free_service:t=>`Service offert : ${t||"?"}`,discount_pct:t=>`Réduction ${t||"?"}%`,discount_fixed:t=>`Réduction ${t||"?"} €`,info_only:()=>"Info seulement"};function k(t){const e=$[t.condition_type];return e?t.condition_type==="min_amount"?e((t.condition_min_cents/100).toFixed(2).replace(".",",")):t.condition_type==="specific_service"?e(t.condition_service_name||"?"):t.condition_type==="date_range"?e(t.condition_start_date,t.condition_end_date):e():t.condition_type||"—"}function z(t){const e=E[t.reward_type];return e?t.reward_type==="free_service"?e(t.reward_service_name||"?"):t.reward_type==="discount_fixed"?e((t.reward_value/100).toFixed(2).replace(".",",")):e(t.reward_value):t.reward_type||"—"}async function m(){const t=document.getElementById("contentArea");t.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const e=await u.get("/api/promotions"),i=e.promotions||e||[];x=i,C(t,i)}catch(e){t.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${s(e.message)}</div>`}}function C(t,e){const i=e.length,a=e.filter(n=>n.is_active).length;let o="";o+=`<div class="stats" style="grid-template-columns:repeat(2,1fr)">
    <div class="stat-card"><div class="label">Total promotions</div><div class="val" style="color:var(--primary)">${i}</div><div class="sub">créées</div></div>
    <div class="stat-card"><div class="label">Promotions actives</div><div class="val" style="color:var(--green)">${a}</div><div class="sub">en cours</div></div>
  </div>`,o+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    <div style="flex:1"></div>
    <span style="font-size:.78rem;color:var(--text-3)">${a}/${i} actives</span>
    <button onclick="openPromoModal()" class="btn-primary"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Nouvelle promotion</button>
  </div>`,e.length===0?o+='<div class="card"><div class="empty">Aucune promotion créée.</div></div>':(o+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Titre</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Condition</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Récompense</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`,e.forEach(n=>{const r=!!n.is_active;o+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px;font-weight:500">${s(n.title)}</td>
        <td style="padding:10px;color:var(--text-2);font-size:.78rem">${s(k(n))}</td>
        <td style="padding:10px;color:var(--text-2);font-size:.78rem">${s(z(n))}</td>
        <td style="padding:10px;text-align:center">
          <label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer">
            <input type="checkbox" ${r?"checked":""} onchange="togglePromo('${n.id}',this.checked)" style="opacity:0;width:0;height:0">
            <span style="position:absolute;inset:0;background:${r?"var(--green)":"var(--border)"};border-radius:10px;transition:background .2s"></span>
            <span style="position:absolute;top:2px;left:${r?"18px":"2px"};width:16px;height:16px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
          </label>
        </td>
        <td style="padding:10px;text-align:center;white-space:nowrap">
          <button onclick="openPromoModal('${n.id}')" title="Modifier" style="background:none;border:none;cursor:pointer;color:var(--primary);padding:4px 6px">${b.edit}</button>
          <button onclick="deletePromo('${n.id}','${s(n.title)}')" title="Supprimer" style="background:none;border:none;cursor:pointer;color:var(--red);padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`}),o+="</tbody></table></div>"),t.innerHTML=o}async function M(){if(c)return c;try{const t=await u.get("/api/services");c=(t.services||t||[]).filter(e=>e.is_active!==!1)}catch(t){console.error("[promotions] fetch services failed",t),c=[]}return c}async function B(t){v("promoModal");let e=null;if(t&&(e=x.find(p=>p.id===t),!e)){d.toast("Promotion introuvable","error");return}const a=(await M()).map(p=>`<option value="${s(p.id)}">${s(p.name)}</option>`).join(""),o=e?.condition_type||"none",n=e?.reward_type||"info_only",r=e?.display_style||"banner",l=document.createElement("div");l.className="m-overlay open",l.id="promoModal",l.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${e?"Modifier la promotion":"Nouvelle promotion"}</h3>
      <button class="m-close" onclick="closeModal('promoModal')">${b.x}</button>
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
        ${y(o,e,a)}
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Type de récompense</label>
        <select id="promoRewardType" onchange="promoRewardChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="info_only" ${n==="info_only"?"selected":""}>Info seulement</option>
          <option value="free_service" ${n==="free_service"?"selected":""}>Service offert</option>
          <option value="discount_pct" ${n==="discount_pct"?"selected":""}>Réduction en %</option>
          <option value="discount_fixed" ${n==="discount_fixed"?"selected":""}>Réduction en €</option>
        </select>
      </div>

      <div id="promoRewardFields" style="margin-bottom:14px">
        ${g(n,e,a)}
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
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('promoModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="savePromo('${t||""}')">${e?"Enregistrer":"Créer"}</button>
    </div>
  </div>`,document.body.appendChild(l),w(document.getElementById("promoModal"),{noBackdropClose:!0})}function y(t,e,i){switch(t){case"min_amount":var a=e?.condition_min_cents?(e.condition_min_cents/100).toFixed(2):"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant minimum (€)</label>
        <input type="number" id="promoConditionValue" min="0" step="1" value="${s(a)}" placeholder="50" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;case"specific_service":var o=e?.condition_service_id||"",n=i.replace('value="'+o+'"','value="'+o+'" selected');return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Service concerné</label>
        <select id="promoConditionValue" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">-- Choisir --</option>${n}
        </select>`;case"date_range":var r=e?.condition_start_date?e.condition_start_date.substring(0,10):"",l=e?.condition_end_date?e.condition_end_date.substring(0,10):"";return`<div style="display:flex;gap:12px">
        <div style="flex:1"><label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date de début</label>
          <input type="date" id="promoConditionDateStart" value="${s(r)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box"></div>
        <div style="flex:1"><label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date de fin</label>
          <input type="date" id="promoConditionDateEnd" value="${s(l)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box"></div>
      </div>`;default:return""}}function g(t,e,i){switch(t){case"free_service":var a=e?.reward_service_id||"",o=i.replace('value="'+a+'"','value="'+a+'" selected');return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Service offert</label>
        <select id="promoRewardValue" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">-- Choisir --</option>${o}
        </select>`;case"discount_pct":var n=e?.reward_value||"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Pourcentage de réduction</label>
        <input type="number" id="promoRewardValue" min="1" max="100" value="${s(n)}" placeholder="20" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;case"discount_fixed":var r=e?.reward_value?(e.reward_value/100).toFixed(2):"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant de réduction (€)</label>
        <input type="number" id="promoRewardValue" min="0" step="1" value="${s(r)}" placeholder="10" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;default:return""}}function I(){const t=document.getElementById("promoConditionType").value,e=document.getElementById("promoConditionFields"),a=(c||[]).map(o=>`<option value="${s(o.id)}">${s(o.name)}</option>`).join("");e.innerHTML=y(t,null,a)}function P(){const t=document.getElementById("promoRewardType").value,e=document.getElementById("promoRewardFields"),a=(c||[]).map(o=>`<option value="${s(o.id)}">${s(o.name)}</option>`).join("");e.innerHTML=g(t,null,a)}function T(){document.querySelectorAll('input[name="promoDisplay"]').forEach(e=>{const i=e.closest("label");e.checked?(i.style.borderColor="var(--primary)",i.style.background="var(--primary-light)"):(i.style.borderColor="var(--border)",i.style.background="var(--surface)")})}async function D(t){const e=document.getElementById("promoTitle").value.trim();if(!e){d.toast("Le titre est requis","error");return}const i=document.getElementById("promoDescription").value.trim(),a=document.getElementById("promoConditionType").value,o=document.getElementById("promoRewardType").value,n=document.querySelector('input[name="promoDisplay"]:checked')?.value||"banner",r={title:e,description:i,condition_type:a,reward_type:o,display_style:n};if(a==="min_amount"){var l=parseFloat(document.getElementById("promoConditionValue")?.value||0);r.condition_min_cents=Math.round(l*100)}else a==="specific_service"?r.condition_service_id=document.getElementById("promoConditionValue")?.value||null:a==="date_range"&&(r.condition_start_date=document.getElementById("promoConditionDateStart")?.value||null,r.condition_end_date=document.getElementById("promoConditionDateEnd")?.value||null);if(o==="free_service")r.reward_service_id=document.getElementById("promoRewardValue")?.value||null;else if(o==="discount_pct")r.reward_value=parseInt(document.getElementById("promoRewardValue")?.value||0);else if(o==="discount_fixed"){var p=parseFloat(document.getElementById("promoRewardValue")?.value||0);r.reward_value=Math.round(p*100)}try{t?(await u.patch(`/api/promotions/${t}`,r),d.toast("Promotion mise à jour","success")):(await u.post("/api/promotions",r),d.toast("Promotion créée","success")),v("promoModal"),m()}catch(f){d.toast(f.message||"Erreur lors de l'enregistrement","error")}}async function S(t,e){try{await u.patch(`/api/promotions/${t}`,{is_active:e}),d.toast(e?"Promotion activée":"Promotion désactivée","success"),m()}catch(i){d.toast(i.message||"Erreur","error")}}async function R(t,e){if(await _(`Supprimer définitivement la promotion "${e}" ? Cette action est irréversible.`))try{await u.delete(`/api/promotions/${t}`),d.toast("Promotion supprimée","success"),m()}catch(i){d.toast(i.message||"Erreur lors de la suppression","error")}}h({loadPromotions:m,openPromoModal:B,savePromo:D,togglePromo:S,deletePromo:R,promoConditionChanged:I,promoRewardChanged:P,promoDisplayChanged:T});export{m as loadPromotions};
