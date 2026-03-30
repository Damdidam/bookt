import{a as m,e as a,d as f,G as l,n as h}from"./dashboard-n81oMnD0.js";import{I as b}from"./icons-DATqSsmT.js";let x=[],c=null;const _={min_amount:e=>`Panier min ${e||"?"} €`,specific_service:e=>`Service : ${e||"?"}`,first_visit:()=>"Nouveau client",date_range:(e,t)=>`Du ${e||"?"} au ${t||"?"}`,none:()=>"Sans condition"},w={free_service:e=>`Service offert : ${e||"?"}`,discount_pct:e=>`Réduction ${e||"?"}%`,discount_fixed:e=>`Réduction ${e||"?"} €`,info_only:()=>"Info seulement"};function $(e){const t=_[e.condition_type];return t?e.condition_type==="min_amount"?t((e.condition_min_cents/100).toFixed(2).replace(".",",")):e.condition_type==="specific_service"?t(e.condition_service_name||"?"):e.condition_type==="date_range"?t(e.condition_start_date,e.condition_end_date):t():e.condition_type||"—"}function E(e){const t=w[e.reward_type];return t?e.reward_type==="free_service"?t(e.reward_service_name||"?"):e.reward_type==="discount_fixed"?t((e.reward_value/100).toFixed(2).replace(".",",")):t(e.reward_value):e.reward_type||"—"}async function v(){const e=document.getElementById("contentArea");e.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const t=await m.get("/api/promotions"),o=t.promotions||t||[];x=o,k(e,o)}catch(t){e.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${a(t.message)}</div>`}}function k(e,t){const o=t.length,d=t.filter(i=>i.is_active).length;let r="";r+=`<div class="stats" style="grid-template-columns:repeat(2,1fr)">
    <div class="stat-card"><div class="label">Total promotions</div><div class="val" style="color:var(--primary)">${o}</div><div class="sub">créées</div></div>
    <div class="stat-card"><div class="label">Promotions actives</div><div class="val" style="color:var(--green)">${d}</div><div class="sub">en cours</div></div>
  </div>`,r+=`<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    <div style="flex:1"></div>
    <span style="font-size:.78rem;color:var(--text-3)">${d}/${o} actives</span>
    <button onclick="openPromoModal()" class="btn-primary"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Nouvelle promotion</button>
  </div>`,t.length===0?r+='<div class="card"><div class="empty">Aucune promotion créée.</div></div>':(r+=`<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Titre</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Condition</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Récompense</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`,t.forEach(i=>{const n=!!i.is_active;r+=`<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px;font-weight:500">${a(i.title)}</td>
        <td style="padding:10px;color:var(--text-2);font-size:.78rem">${a($(i))}</td>
        <td style="padding:10px;color:var(--text-2);font-size:.78rem">${a(E(i))}</td>
        <td style="padding:10px;text-align:center">
          <label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer">
            <input type="checkbox" ${n?"checked":""} onchange="togglePromo('${i.id}',this.checked)" style="opacity:0;width:0;height:0">
            <span style="position:absolute;inset:0;background:${n?"var(--green)":"var(--border)"};border-radius:10px;transition:background .2s"></span>
            <span style="position:absolute;top:2px;left:${n?"18px":"2px"};width:16px;height:16px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
          </label>
        </td>
        <td style="padding:10px;text-align:center;white-space:nowrap">
          <button onclick="openPromoModal('${i.id}')" title="Modifier" style="background:none;border:none;cursor:pointer;color:var(--primary);padding:4px 6px">${b.edit}</button>
          <button onclick="deletePromo('${i.id}','${a(i.title)}')" title="Supprimer" style="background:none;border:none;cursor:pointer;color:var(--red);padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`}),r+="</tbody></table></div>"),e.innerHTML=r}async function z(){if(c)return c;try{const e=await m.get("/api/services");c=(e.services||e||[]).filter(t=>t.is_active!==!1)}catch(e){console.error("[promotions] fetch services failed",e),c=[]}return c}async function C(e){const t=document.getElementById("promoModal");t&&t.remove();let o=null;if(e&&(o=x.find(u=>u.id===e),!o)){l.toast("Promotion introuvable","error");return}const r=(await z()).map(u=>`<option value="${a(u.id)}">${a(u.name)}</option>`).join(""),i=o?.condition_type||"none",n=o?.reward_type||"info_only",s=o?.display_style||"banner",p=document.createElement("div");p.className="m-overlay open",p.id="promoModal",p.innerHTML=`<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${o?"Modifier la promotion":"Nouvelle promotion"}</h3>
      <button class="m-close" onclick="closeModal('promoModal')">${b.x}</button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Titre <span style="color:var(--red)">*</span></label>
        <input type="text" id="promoTitle" value="${a(o?.title||"")}" placeholder="Ex: -20% première visite" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Description <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <textarea id="promoDescription" rows="3" placeholder="Détails de la promotion..." style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;resize:vertical">${a(o?.description||"")}</textarea>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Type de condition</label>
        <select id="promoConditionType" onchange="promoConditionChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="none" ${i==="none"?"selected":""}>Sans condition</option>
          <option value="min_amount" ${i==="min_amount"?"selected":""}>Panier minimum</option>
          <option value="specific_service" ${i==="specific_service"?"selected":""}>Service spécifique</option>
          <option value="first_visit" ${i==="first_visit"?"selected":""}>Nouveau client</option>
          <option value="date_range" ${i==="date_range"?"selected":""}>Plage de dates</option>
        </select>
      </div>

      <div id="promoConditionFields" style="margin-bottom:14px">
        ${y(i,o,r)}
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
        ${g(n,o,r)}
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Style d'affichage</label>
        <div style="display:flex;gap:10px">
          <label style="flex:1;cursor:pointer;padding:10px;border:2px solid ${s==="cards"?"var(--primary)":"var(--border)"};border-radius:var(--radius-xs);text-align:center;font-size:.82rem;background:${s==="cards"?"var(--primary-light)":"var(--surface)"}">
            <input type="radio" name="promoDisplay" value="cards" ${s==="cards"?"checked":""} style="display:none" onchange="promoDisplayChanged()"> Carte
          </label>
          <label style="flex:1;cursor:pointer;padding:10px;border:2px solid ${s==="banner"?"var(--primary)":"var(--border)"};border-radius:var(--radius-xs);text-align:center;font-size:.82rem;background:${s==="banner"?"var(--primary-light)":"var(--surface)"}">
            <input type="radio" name="promoDisplay" value="banner" ${s==="banner"?"checked":""} style="display:none" onchange="promoDisplayChanged()"> Bannière
          </label>
        </div>
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('promoModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="savePromo('${e||""}')">${o?"Enregistrer":"Créer"}</button>
    </div>
  </div>`,document.body.appendChild(p),h(document.getElementById("promoModal"),{noBackdropClose:!0})}function y(e,t,o){switch(e){case"min_amount":var d=t?.condition_min_cents?(t.condition_min_cents/100).toFixed(0):"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant minimum (€)</label>
        <input type="number" id="promoConditionValue" min="0" step="1" value="${a(d)}" placeholder="50" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;case"specific_service":var r=t?.condition_service_id||"",i=o.replace('value="'+r+'"','value="'+r+'" selected');return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Service concerné</label>
        <select id="promoConditionValue" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">-- Choisir --</option>${i}
        </select>`;case"date_range":var n=t?.condition_start_date?t.condition_start_date.substring(0,10):"",s=t?.condition_end_date?t.condition_end_date.substring(0,10):"";return`<div style="display:flex;gap:12px">
        <div style="flex:1"><label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date de début</label>
          <input type="date" id="promoConditionDateStart" value="${a(n)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box"></div>
        <div style="flex:1"><label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date de fin</label>
          <input type="date" id="promoConditionDateEnd" value="${a(s)}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box"></div>
      </div>`;default:return""}}function g(e,t,o){switch(e){case"free_service":var d=t?.reward_service_id||"",r=o.replace('value="'+d+'"','value="'+d+'" selected');return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Service offert</label>
        <select id="promoRewardValue" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">-- Choisir --</option>${r}
        </select>`;case"discount_pct":var i=t?.reward_value||"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Pourcentage de réduction</label>
        <input type="number" id="promoRewardValue" min="1" max="100" value="${a(i)}" placeholder="20" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;case"discount_fixed":var n=t?.reward_value?(t.reward_value/100).toFixed(0):"";return`<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant de réduction (€)</label>
        <input type="number" id="promoRewardValue" min="0" step="1" value="${a(n)}" placeholder="10" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;default:return""}}function B(){const e=document.getElementById("promoConditionType").value,t=document.getElementById("promoConditionFields"),d=(c||[]).map(r=>`<option value="${a(r.id)}">${a(r.name)}</option>`).join("");t.innerHTML=y(e,null,d)}function I(){const e=document.getElementById("promoRewardType").value,t=document.getElementById("promoRewardFields"),d=(c||[]).map(r=>`<option value="${a(r.id)}">${a(r.name)}</option>`).join("");t.innerHTML=g(e,null,d)}function M(){document.querySelectorAll('input[name="promoDisplay"]').forEach(t=>{const o=t.closest("label");t.checked?(o.style.borderColor="var(--primary)",o.style.background="var(--primary-light)"):(o.style.borderColor="var(--border)",o.style.background="var(--surface)")})}async function P(e){const t=document.getElementById("promoTitle").value.trim();if(!t){l.toast("Le titre est requis","error");return}const o=document.getElementById("promoDescription").value.trim(),d=document.getElementById("promoConditionType").value,r=document.getElementById("promoRewardType").value,i=document.querySelector('input[name="promoDisplay"]:checked')?.value||"banner",n={title:t,description:o,condition_type:d,reward_type:r,display_style:i};if(d==="min_amount"){var s=parseFloat(document.getElementById("promoConditionValue")?.value||0);n.condition_min_cents=Math.round(s*100)}else d==="specific_service"?n.condition_service_id=document.getElementById("promoConditionValue")?.value||null:d==="date_range"&&(n.condition_start_date=document.getElementById("promoConditionDateStart")?.value||null,n.condition_end_date=document.getElementById("promoConditionDateEnd")?.value||null);if(r==="free_service")n.reward_service_id=document.getElementById("promoRewardValue")?.value||null;else if(r==="discount_pct")n.reward_value=parseInt(document.getElementById("promoRewardValue")?.value||0);else if(r==="discount_fixed"){var p=parseFloat(document.getElementById("promoRewardValue")?.value||0);n.reward_value=Math.round(p*100)}try{e?(await m.patch(`/api/promotions/${e}`,n),l.toast("Promotion mise à jour","success")):(await m.post("/api/promotions",n),l.toast("Promotion créée","success")),document.getElementById("promoModal").remove(),v()}catch(u){l.toast(u.message||"Erreur lors de l'enregistrement","error")}}async function T(e,t){try{await m.patch(`/api/promotions/${e}`,{is_active:t}),l.toast(t?"Promotion activée":"Promotion désactivée","success"),v()}catch(o){l.toast(o.message||"Erreur","error")}}async function S(e,t){if(confirm(`Supprimer définitivement la promotion "${t}" ? Cette action est irréversible.`))try{await m.delete(`/api/promotions/${e}`),l.toast("Promotion supprimée","success"),v()}catch(o){l.toast(o.message||"Erreur lors de la suppression","error")}}f({loadPromotions:v,openPromoModal:C,savePromo:P,togglePromo:T,deletePromo:S,promoConditionChanged:B,promoRewardChanged:I,promoDisplayChanged:M});export{v as loadPromotions};
