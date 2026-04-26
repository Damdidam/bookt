import{m as w,s as S,o as b,a as u,G as d,S as I,n as M,f as O,p as G,d as ne}from"./dashboard-DyhTinxB.js";import{c as ie}from"./color-swatches-3iN17CSb.js";import{releaseFocus as j,trapFocus as A}from"./focus-trap-C-UMhpsq.js";import{e as se}from"./swipe-close-BqJgOGc2.js";import{I as h}from"./icons-C4WsiP-A.js";let z=null,k=new Date().getFullYear(),g={},f=new Set,x=[];const v=e=>e?String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"):"",B=e=>e==null?"":String(e).replace(/\\/g,"\\\\").replace(/'/g,"\\'").replace(/\n/g,"\\n").replace(/\r/g,"\\r").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");function _(e){return String(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}const E={close:h.x,edit:h.edit,tasks:h.clipboard,key:h.key,role:h.role,mail:h.mail,phone:h.phone,calendar:h.calendar,star:h.star,sun:h.sun,hourglass:h.hourglass,plus:h.plus,trash:h.trash,link:h.link,shield:h.shield},P={cdi:"CDI",cdd:"CDD",independant:"Indépendant",stagiaire:"Stagiaire",interim:"Intérim"},J={conge:"Congé",maladie:"Maladie",formation:"Formation",recuperation:"Récup."};function U(e){if(!e||e.length===0)return{label:"—",detail:""};const t=e.length;if(t===7)return{label:"7/7",detail:""};const a=["lun","mar","mer","jeu","ven","sam","dim"],n=[];for(let s=0;s<7;s++)e.includes(s)||n.push(a[s]);if(t===5&&!e.includes(5)&&!e.includes(6))return{label:"Temps plein",detail:""};const o=n.length<=3?n.join(", ")+" off":"";return{label:`${t}/7`,detail:o}}function oe(e){return e<=0?"danger":e<=5?"warn":"ok"}async function T(){const e=document.getElementById("contentArea");e.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const[t,a]=await Promise.all([fetch("/api/practitioners",{headers:{Authorization:"Bearer "+u.getToken()}}),fetch("/api/calendar/connections",{headers:{Authorization:"Bearer "+u.getToken()}}).catch(()=>({ok:!1}))]),n=await t.json(),s=(a.ok?await a.json():{connections:[]}).connections||[],l=n.practitioners||[],c=b.practitioner.toLowerCase();let r=`<div class="tm-list-header">
      <h3>${l.length} membre${l.length>1?"s":""} de l'équipe</h3>
      <button class="btn-primary btn-sm" onclick="openPractModal()">+ Ajouter</button>
    </div>`;l.length===0?r+=`<div class="card"><div class="empty">Aucun ${c}. Ajoutez votre premier membre !</div></div>`:(r+='<div class="team-grid2">',l.forEach(i=>{const m=i.display_name?.split(" ").map(ae=>ae[0]).join("").toUpperCase().slice(0,2)||"??",y=U(i.work_days),p=!i.is_active;r+=`<div class="tm-card${p?" inactive":""}" onclick="openPractModal('${i.id}')">`,i.photo_url?r+=`<div class="tm-avatar"><img src="${v(i.photo_url)}" alt="${v(i.display_name)}" loading="lazy"></div>`:r+=`<div class="tm-avatar" style="background:linear-gradient(135deg,${v(i.color||"#0D7377")},${v(i.color||"#0D7377")}CC)">${m}</div>`,r+='<div class="tm-info">',r+=`<p class="tm-name">${v(i.display_name)}${p?' <span class="tm-badge-inactive">Inactif</span>':""}</p>`,r+=`<p class="tm-title">${v(i.title||"")}</p>`,y.label!=="—"&&(r+=`<p class="tm-regime">${y.label}${y.detail?" · "+y.detail:""}</p>`);const $=[];i.bookings_30d!=null&&$.push(i.bookings_30d+" RDV/mois"),i.contract_type&&P[i.contract_type]&&$.push(P[i.contract_type]),$.length&&(r+=`<p class="tm-summary">${$.join(" · ")}</p>`),r+="</div>",r+="</div>"}),r+=`<div class="tm-card tm-add" onclick="openPractModal()">
        <div class="tm-avatar tm-add-icon">${E.plus}</div>
        <div class="tm-info"><p class="tm-name">Ajouter un ${v(c)}</p></div>
      </div>`,r+="</div>"),e.innerHTML=r}catch(t){e.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${v(t.message)}</div>`}}function re(e){if(!e&&window._businessPlan==="free"&&document.querySelectorAll(".tm-card:not(.tm-add)").length>=1){d.toast("Passez au Pro pour ajouter des praticiens","error");return}const t={Authorization:"Bearer "+u.getToken()};e?Promise.all([fetch("/api/practitioners",{headers:t}).then(a=>a.json()),fetch("/api/services",{headers:t}).then(a=>a.json())]).then(([a,n])=>{x=(n.services||[]).filter(o=>o.is_active!==!1),F(a.practitioners.find(o=>o.id===e))}):fetch("/api/services",{headers:t}).then(a=>a.json()).then(a=>{x=(a.services||[]).filter(n=>n.is_active!==!1),F(null)})}function F(e){z=null,k=new Date().getFullYear(),f=new Set,e&&x.forEach(i=>{i.practitioner_ids&&i.practitioner_ids.includes(e.id)&&f.add(i.id)});const t=!!e;b.practitioner.toLowerCase();const a=e?.color||"#0D7377",n=e?.display_name?.split(" ").map(i=>i[0]).join("").toUpperCase().slice(0,2)||"??",o=e?.photo_url?`<img src="${v(e.photo_url)}" alt="${v(e.display_name)}" style="width:100%;height:100%;object-fit:cover">`:n,s=e?v(e.display_name):"Nouveau "+b.practitioner;let l=`<div id="teamModalOverlay" class="m-overlay open">
    <div class="m-dialog m-flex m-lg">
    <div class="m-drag-handle"></div>

    <!-- M-HEADER -->
    <div class="m-header">
      <div class="m-header-bg" id="tmHeaderBg" style="background:linear-gradient(135deg,${a} 0%,${a}AA 60%,${a}55 100%)"></div>
      <button class="m-close" onclick="closeTeamModal()" aria-label="Fermer">
        <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="m-header-content">
        <div class="m-client-hero" style="align-items:center">
          <div class="m-avatar" id="tmAvatar" style="background:linear-gradient(135deg,${a},${a}CC);cursor:pointer" onclick="document.getElementById('pPhotoInput').click()">
            ${o}
          </div>
          <div class="m-modal-title" id="tmModalTitle">${s}</div>
        </div>
      </div>
    </div>

    <!-- TABS -->
    <div class="m-tabs">
      <div class="m-tab active" data-tab="profile" onclick="teamSwitchTab('profile')">Profil</div>
      <div class="m-tab" data-tab="skills" onclick="teamSwitchTab('skills')">Compétences</div>
      <div class="m-tab" data-tab="schedule" onclick="teamSwitchTab('schedule')">Horaire</div>
      ${t?`<div class="m-tab" data-tab="leave" onclick="teamSwitchTab('leave')">Congés</div>`:""}
      <div class="m-tab" data-tab="settings" onclick="teamSwitchTab('settings')">Paramètres</div>
    </div>

    <!-- BODY -->
    <div class="m-body">
      <input type="file" id="pPhotoInput" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="pPhotoPreview(this)">

      <!-- TAB: PROFIL -->
      <div class="m-panel active" id="team-panel-profile">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Identité</span><span class="m-sec-line"></span></div>
          <div class="m-row m-row-2">
            <div><div class="m-field-label">Nom complet *</div><input class="m-input" id="p_name" value="${v(e?.display_name||"")}" placeholder="Ex: Sophie Laurent"></div>
            <div><div class="m-field-label">Titre / Spécialité</div><input class="m-input" id="p_title" value="${v(e?.title||"")}" placeholder="Ex: Coiffeuse senior"></div>
          </div>
          <div class="m-row m-row-2">
            <div><div class="m-field-label">Années d'expérience</div><input class="m-input" type="number" id="p_years" value="${e?.years_experience||""}" min="0"></div>
            <div><div class="m-field-label">Couleur agenda</div><div id="p_color_wrap"></div></div>
          </div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Contact</span><span class="m-sec-line"></span></div>
          <div class="m-row m-row-2">
            <div><div class="m-field-label">Email</div><input class="m-input" id="p_email" type="email" value="${v(e?.email||"")}"></div>
            <div><div class="m-field-label">Téléphone</div><input class="m-input" id="p_phone" value="${v(e?.phone||"")}"></div>
          </div>
          <div><div class="m-field-label">Bio</div><textarea class="m-input" id="p_bio" style="min-height:60px">${v(e?.bio||"")}</textarea></div>
          <div style="margin-top:8px"><div class="m-field-label">LinkedIn</div><input class="m-input" id="p_linkedin" value="${v(e?.linkedin_url||"")}" placeholder="https://linkedin.com/in/..."></div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Contrat</span><span class="m-sec-line"></span></div>
          <div class="m-row m-row-3">
            <div><div class="m-field-label">Type</div><select class="m-input" id="p_contract">
              ${["cdi","cdd","independant","stagiaire","interim"].map(i=>`<option value="${i}"${(e?.contract_type||"cdi")===i?" selected":""}>${P[i]}</option>`).join("")}
            </select></div>
            <div><div class="m-field-label">Date d'embauche</div><input class="m-input" type="date" id="p_hire" value="${e?.hire_date?e.hire_date.slice(0,10):""}"></div>
            <div><div class="m-field-label">Heures/sem.</div><input class="m-input" type="number" id="p_hours" value="${e?.weekly_hours_target||""}" step="0.5" min="0" max="60" placeholder="38"></div>
          </div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Contact d'urgence</span><span class="m-sec-line"></span></div>
          <div class="m-row m-row-2">
            <div><div class="m-field-label">Nom</div><input class="m-input" id="p_emerg_name" value="${v(e?.emergency_contact_name||"")}"></div>
            <div><div class="m-field-label">Téléphone</div><input class="m-input" id="p_emerg_phone" value="${v(e?.emergency_contact_phone||"")}"></div>
          </div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Notes internes</span><span class="m-sec-line"></span></div>
          <textarea class="m-input" id="p_note" style="min-height:60px" placeholder="Notes privées (visibles par le propriétaire uniquement)...">${v(e?.internal_note||"")}</textarea>
        </div>

        ${t&&e?.photo_url?`<div style="text-align:center;margin-top:8px"><button onclick="pRemovePhoto('${e.id}')" style="font-size:.7rem;color:var(--red);background:none;border:none;cursor:pointer">Supprimer la photo</button></div>`:""}
      </div>

      <!-- TAB: COMPÉTENCES -->
      <div class="m-panel" id="team-panel-skills">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Prestations assignées</span><span class="m-sec-line"></span></div>
          <div id="tm_services_list">${D()}</div>
        </div>
      </div>

      <!-- TAB: HORAIRE -->
      <div class="m-panel" id="team-panel-schedule">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Disponibilités hebdomadaires</span><span class="m-sec-line"></span></div>
          <div id="tm_schedule_editor">${t?'<div style="font-size:.78rem;color:var(--text-4)">Chargement...</div>':L()}</div>
        </div>
        ${e?.weekly_hours_target?`<div style="margin-top:10px;font-size:.78rem;color:var(--text-3)">Heures/semaine cible : <strong>${e.weekly_hours_target}h</strong></div>`:""}
      </div>

      <!-- TAB: CONGÉS -->
      ${t?`<div class="m-panel" id="team-panel-leave">
        <div class="m-sec">
          <div class="m-sec-head">
            <span class="m-sec-title">Solde congés</span><span class="m-sec-line"></span>
            <select class="m-input" id="tm_leave_year" style="width:auto;padding:4px 8px;font-size:.72rem" onchange="teamLoadLeave('${e.id}',this.value)">
              ${[k-1,k,k+1].map(i=>`<option value="${i}"${i===k?" selected":""}>${i}</option>`).join("")}
            </select>
          </div>
          <div id="tm_leave_table">${Y(e.leave_balance)}</div>
        </div>
        <div class="m-sec" style="margin-top:16px">
          <div class="m-sec-head"><span class="m-sec-title">Absences récentes</span><span class="m-sec-line"></span></div>
          <div id="tm_recent_abs" style="font-size:.78rem;color:var(--text-4)">Chargement...</div>
        </div>
      </div>`:""}

      <!-- TAB: PARAMÈTRES -->
      <div class="m-panel" id="team-panel-settings">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Agenda</span><span class="m-sec-line"></span></div>
          <div class="m-field-label">Capacité simultanée</div>
          <select class="m-input" id="p_max_concurrent">
            ${[1,2,3,4,5,6,8,10].map(i=>`<option value="${i}"${(e?.max_concurrent||1)===i?" selected":""}>${i}${i===1?" (pas de chevauchement)":" simultanés"}</option>`).join("")}
          </select>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Réservation en ligne</span><span class="m-sec-line"></span></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer">
            <input type="checkbox" id="p_booking" ${e?.booking_enabled!==!1?"checked":""}> Peut recevoir des réservations en ligne
          </label>
        </div>

        ${t?`<div class="m-sec" style="margin-top:16px">
          <div class="m-sec-head"><span class="m-sec-title"><svg class="gi" style="width:12px;height:12px" ${E.calendar.slice(4)}> Synchronisation calendrier</span><span class="m-sec-line"></span></div>
          <div id="p_cal_area" style="font-size:.82rem;color:var(--text-4)">Chargement...</div>
        </div>`:""}

        ${t?`<div class="m-sec" style="margin-top:16px">
          <div class="m-sec-head"><span class="m-sec-title"><svg class="gi" style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Accès dashboard</span><span class="m-sec-line"></span></div>
          ${e.user_id?`<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface);border-radius:8px">
                <div style="flex:1">
                  <div style="font-size:.82rem;font-weight:600;color:var(--text-1)">${v(e.login_email||e.user_email||"")}</div>
                  <div style="font-size:.72rem;color:var(--text-4);margin-top:2px">Rôle : ${e.role==="owner"||e.user_role==="owner"?"Propriétaire":b.practitioner}${e.last_login_at?" · Dernière connexion : "+new Date(e.last_login_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short",timeZone:"Europe/Brussels"}):" · Jamais connecté"}</div>
                </div>
                <button class="m-btn m-btn-ghost" style="font-size:.72rem" onclick="closeTeamModal();openRoleModal('${e.id}','${B(e.display_name)}','${e.role||e.user_role||"practitioner"}')">Changer le rôle</button>
              </div>`:`<div style="padding:10px 14px;background:var(--surface);border-radius:8px;display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:.82rem;color:var(--text-3)">Aucun accès au dashboard</span>
                <button class="m-btn m-btn-primary" style="font-size:.72rem" onclick="closeTeamModal();openInviteModal('${e.id}','${B(e.display_name)}')">Créer un accès</button>
              </div>`}
        </div>`:""}
      </div>

    </div>

    <!-- BOTTOM BAR -->
    <div class="m-bottom">
      ${t?`<div style="display:flex;gap:8px">
        <button class="m-btn m-btn-danger" onclick="confirmDeactivatePract('${e.id}','${B(e.display_name)}')">Désactiver</button>
        <button class="m-btn m-btn-ghost" style="color:var(--red);font-size:.72rem" onclick="confirmDeletePract('${e.id}','${B(e.display_name)}')">Supprimer</button>
      </div>`:""}
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeTeamModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="savePract(${t?"'"+e.id+"'":"null"})">${t?"Enregistrer":"Créer"}</button>
    </div>

  </div></div>`;document.body.insertAdjacentHTML("beforeend",l);const c=document.getElementById("teamModalOverlay");M(c,{noBackdropClose:!0}),A(c,()=>C()),se(c.querySelector(".m-dialog"),()=>C()),O(c),document.getElementById("p_color_wrap").innerHTML=ie("p_color",e?.color||"#1E3A8A",!1);const r=document.getElementById("p_color");if(r&&r.addEventListener("change",()=>{const i=r.value||"#0D7377",m=document.getElementById("tmHeaderBg"),y=document.getElementById("tmAvatar");m&&(m.style.background=`linear-gradient(135deg,${i} 0%,${i}AA 60%,${i}55 100%)`),y&&(y.style.background=`linear-gradient(135deg,${i},${i}CC)`)}),e?.id,t)window.loadPracCalSync&&window.loadPracCalSync(e.id),K(e.id,k),Z(e.id);else{g={};for(let i=0;i<7;i++)g[i]=[]}}async function C(){j(),await w("teamModalOverlay")}function le(e){document.querySelectorAll("#teamModalOverlay .m-tab").forEach(t=>{t.classList.toggle("active",t.dataset.tab===e)}),document.querySelectorAll("#teamModalOverlay .m-panel").forEach(t=>t.classList.remove("active")),document.getElementById("team-panel-"+e)?.classList.add("active")}function D(){if(x.length===0)return`<div style="font-size:.78rem;color:var(--text-4);padding:12px 0">Aucune prestation créée. <a href="#" onclick="event.preventDefault();window.loadSection&&window.loadSection('services')" style="color:var(--primary)">Créer des prestations</a></div>`;const e={},t=[];x.forEach(s=>{const l=s.category||"Sans catégorie";e[l]||(e[l]=[],t.push(l)),e[l].push(s)});const a=x.length,n=f.size;let o=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <span style="font-size:.75rem;color:var(--text-3)">${n}/${a} prestation${a>1?"s":""} assignée${n>1?"s":""}</span>
    <button class="m-btn m-btn-ghost" style="font-size:.7rem;padding:4px 10px" onclick="teamToggleAllServices()">${n===a?"Tout désélectionner":"Tout sélectionner"}</button>
  </div>`;return t.forEach(s=>{const l=e[s],c=l.filter(i=>f.has(i.id)).length,r=c===l.length;o+=`<div class="svc-assign-group">
      <label class="svc-assign-cat" onclick="event.preventDefault();teamToggleCatServices('${B(s)}')">
        <input type="checkbox" ${r?"checked":""} tabindex="-1" style="accent-color:var(--primary)">
        <span class="svc-assign-cat-name">${_(s)}</span>
        <span class="svc-assign-cat-count">${c}/${l.length}</span>
      </label>`,l.forEach(i=>{const m=f.has(i.id),y=i.price_cents?(i.price_cents/100).toFixed(2).replace(".",",").replace(",00","")+"€":"";o+=`<label class="svc-assign-item${m?" checked":""}" onclick="event.preventDefault();teamToggleService('${i.id}')">
        <input type="checkbox" ${m?"checked":""} tabindex="-1" style="accent-color:var(--primary)">
        <span class="svc-assign-name">${v(i.name)}</span>
        <span class="svc-assign-meta">${i.duration_min?i.duration_min+" min":""}${y?" · "+y:""}</span>
      </label>`}),o+="</div>"}),o}function ce(e){f.has(e)?f.delete(e):f.add(e),document.getElementById("tm_services_list").innerHTML=D()}function de(e){const t=x.filter(n=>(n.category||"Sans catégorie")===e),a=t.every(n=>f.has(n.id));t.forEach(n=>{a?f.delete(n.id):f.add(n.id)}),document.getElementById("tm_services_list").innerHTML=D()}function me(){f.size===x.length?f.clear():x.forEach(t=>f.add(t.id)),document.getElementById("tm_services_list").innerHTML=D()}const R=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];async function Z(e){try{const o=((await(await fetch(`/api/availabilities?practitioner_id=${e}`,{headers:{Authorization:"Bearer "+u.getToken()}})).json()).availabilities||{})[e];g={};for(let s=0;s<7;s++)g[s]=(o?.schedule?.[s]||[]).map(l=>({start_time:l.start_time,end_time:l.end_time}));document.getElementById("tm_schedule_editor").innerHTML=L()}catch(t){document.getElementById("tm_schedule_editor").innerHTML=`<div style="color:var(--red);font-size:.82rem">Erreur: ${v(t.message)}</div>`}}function L(){const e=[];for(let n=0;n<7;n++)g[n]&&g[n].length>0&&e.push(n);const t=U(e);let a=`<div style="font-size:.82rem;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px">
    Régime : <span style="color:var(--primary)">${t.label}</span>
    ${t.detail?`<span style="color:var(--text-4);font-weight:400;font-size:.75rem">(${t.detail})</span>`:""}
  </div>`;for(let n=0;n<7;n++){const o=g[n]||[];a+=`<div class="day-row">
      <span class="day-name">${R[n]}</span>
      <div class="slots">`,o.length===0?a+='<span class="day-closed">Fermé</span>':o.forEach((s,l)=>{a+=`<span class="slot-chip"><span class="slot-chip-text" onclick="teamEditSlot(${n},${l})" title="Cliquer pour modifier">${(s.start_time||"").slice(0,5)} – ${(s.end_time||"").slice(0,5)}</span><button class="remove-slot" onclick="teamRemoveSlot(${n},${l})">${E.close}</button></span>`}),a+=`<button class="add-slot-btn" onclick="teamAddSlot(${n})">+ Ajouter</button>
      </div>
    </div>`}return a}function pe(e){const t=g[e]||[],a=t[t.length-1],n=a?a.end_time:"09:00:00",o=parseInt((n||"09:00").split(":")[0]),s=`${String(Math.min(o+4,20)).padStart(2,"0")}:00`;let l=`<div class="m-overlay open" id="teamSlotModal" style="z-index:350"><div class="m-dialog m-sm"><div class="m-header-simple"><h3>Créneau — ${R[e]}</h3><button class="m-close" onclick="closeModal('teamSlotModal')" aria-label="Fermer">${E.close}</button></div><div class="m-body">
    <div class="m-row m-row-2"><div><div class="m-field-label">Début</div><input type="text" class="m-input m-time" id="tm_slot_start" value="${(n||"09:00").slice(0,5)}"></div><div><div class="m-field-label">Fin</div><input type="text" class="m-input m-time" id="tm_slot_end" value="${s}"></div></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('teamSlotModal')">Annuler</button><button class="m-btn m-btn-primary" onclick="teamConfirmAddSlot(${e})">Ajouter</button></div></div></div>`;document.body.insertAdjacentHTML("beforeend",l),M(document.getElementById("teamSlotModal"),{noBackdropClose:!0}),A(document.getElementById("teamSlotModal"),()=>w("teamSlotModal")),O(document.getElementById("teamSlotModal"))}function ue(e){const t=document.getElementById("tm_slot_start").value,a=document.getElementById("tm_slot_end").value;if(!t||!a){d.toast("Heures requises","error");return}if(t>=a){d.toast("L'heure de fin doit être après le début","error");return}if((g[e]||[]).some(c=>t<(c.end_time||"").slice(0,5)&&a>(c.start_time||"").slice(0,5))){d.toast("Ce créneau chevauche un autre","error");return}const s=t+":00",l=a+":00";g[e]||(g[e]=[]),g[e].push({start_time:s,end_time:l}),g[e].sort((c,r)=>c.start_time.localeCompare(r.start_time)),w("teamSlotModal"),document.getElementById("tm_schedule_editor").innerHTML=L()}function ve(e,t){const a=g[e]?.[t];if(!a)return;const n=(a.start_time||"09:00:00").slice(0,5),o=(a.end_time||"18:00:00").slice(0,5);let s=`<div class="m-overlay open" id="teamSlotModal" style="z-index:350"><div class="m-dialog m-sm"><div class="m-header-simple"><h3>Modifier créneau — ${R[e]}</h3><button class="m-close" onclick="closeModal('teamSlotModal')" aria-label="Fermer">${E.close}</button></div><div class="m-body">
    <div class="m-row m-row-2"><div><div class="m-field-label">Début</div><input type="text" class="m-input m-time" id="tm_slot_start" value="${n}"></div><div><div class="m-field-label">Fin</div><input type="text" class="m-input m-time" id="tm_slot_end" value="${o}"></div></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('teamSlotModal')">Annuler</button><button class="m-btn m-btn-danger" onclick="teamRemoveSlot(${e},${t});closeModal('teamSlotModal')" style="margin-right:auto">Supprimer</button><button class="m-btn m-btn-primary" onclick="teamConfirmEditSlot(${e},${t})">Enregistrer</button></div></div></div>`;document.body.insertAdjacentHTML("beforeend",s),M(document.getElementById("teamSlotModal"),{noBackdropClose:!0}),A(document.getElementById("teamSlotModal"),()=>w("teamSlotModal")),O(document.getElementById("teamSlotModal"))}function ge(e,t){const a=document.getElementById("tm_slot_start").value,n=document.getElementById("tm_slot_end").value;if(!a||!n){d.toast("Heures requises","error");return}if(a>=n){d.toast("L'heure de fin doit être après le début","error");return}if((g[e]||[]).some((r,i)=>i===t?!1:a<(r.end_time||"").slice(0,5)&&n>(r.start_time||"").slice(0,5))){d.toast("Ce créneau chevauche un autre","error");return}const l=a+":00",c=n+":00";g[e]&&g[e][t]&&(g[e][t]={start_time:l,end_time:c},g[e].sort((r,i)=>r.start_time.localeCompare(i.start_time))),w("teamSlotModal"),document.getElementById("tm_schedule_editor").innerHTML=L()}function he(e,t){g[e].splice(t,1),document.getElementById("tm_schedule_editor").innerHTML=L()}function Y(e){const t=["conge","maladie","formation","recuperation"];let a=`<table class="leave-table">
    <thead><tr><th>Type</th><th>Quota</th><th>Pris</th><th>Solde</th></tr></thead><tbody>`;return t.forEach(n=>{const o=e?.[n]||{total:0,used:0},s=(o.total||0)-(o.used||0),l=oe(s);a+=`<tr>
      <td style="font-weight:600">${J[n]}</td>
      <td><input class="m-input" type="number" step="0.5" min="0" value="${o.total||0}" data-leave-type="${n}" style="width:60px;padding:4px 6px;text-align:center"></td>
      <td style="color:var(--text-4)">${o.used||0}j</td>
      <td><span class="leave-solde ${l}">${s>0?"+":""}${s}j</span></td>
    </tr>`}),a+="</tbody></table>",a}async function K(e,t){k=parseInt(t);try{const n=await(await fetch(`/api/practitioners/${e}/leave-balance?year=${t}`,{headers:{Authorization:"Bearer "+u.getToken()}})).json();document.getElementById("tm_leave_table").innerHTML=Y(n.balances);const o=document.getElementById("tm_recent_abs");n.recent_absences&&n.recent_absences.length>0?o.innerHTML=n.recent_absences.map(s=>{const l=new Date(s.date_from).toLocaleDateString("fr-BE",{day:"numeric",month:"short",timeZone:"Europe/Brussels"}),c=new Date(s.date_to).toLocaleDateString("fr-BE",{day:"numeric",month:"short",timeZone:"Europe/Brussels"});return`<div style="padding:6px 0;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">
          <span><span class="tm-badge" style="font-size:.6rem;margin-right:6px;background:var(--surface)">${J[s.type]||s.type}</span> ${l}${l!==c?" → "+c:""}</span>
          <span style="font-size:.68rem;color:var(--text-4)">${s.note?v(s.note):""}</span>
        </div>`}).join(""):o.innerHTML='<div style="padding:8px 0">Aucune absence enregistrée</div>'}catch(a){document.getElementById("tm_leave_table").innerHTML=`<div style="color:var(--red);font-size:.82rem">Erreur: ${v(a.message)}</div>`}}async function ye(e){const t=document.querySelector("#teamModalOverlay .m-bottom .m-btn-primary");t&&(t.disabled=!0,t.classList.add("is-loading"));const a={display_name:document.getElementById("p_name").value,title:document.getElementById("p_title").value||null,years_experience:parseInt(document.getElementById("p_years").value)||null,color:document.getElementById("p_color").value,email:document.getElementById("p_email").value||null,phone:document.getElementById("p_phone").value||null,bio:document.getElementById("p_bio").value||null,linkedin_url:document.getElementById("p_linkedin").value||null,contract_type:document.getElementById("p_contract").value,hire_date:document.getElementById("p_hire").value||null,weekly_hours_target:parseFloat(document.getElementById("p_hours").value)||null,emergency_contact_name:document.getElementById("p_emerg_name").value||null,emergency_contact_phone:document.getElementById("p_emerg_phone").value||null,internal_note:document.getElementById("p_note").value||null,booking_enabled:document.getElementById("p_booking").checked,max_concurrent:parseInt(document.getElementById("p_max_concurrent").value)||1};try{const n=e?`/api/practitioners/${e}`:"/api/practitioners",s=await fetch(n,{method:e?"PATCH":"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify(a)});if(!s.ok){const r=await s.json().catch(()=>({}));throw new Error(r.message||r.error||"Erreur")}const l=await s.json(),c=e||l.practitioner?.id;if(z&&c&&(await fetch(`/api/practitioners/${c}/photo`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({photo:z})}),z=null),c)try{await fetch(`/api/practitioners/${c}/services`,{method:"PUT",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({service_ids:[...f]})})}catch{}if(c&&g){const r={};for(let i=0;i<7;i++){const m=g[i]||[];m.length>0&&(r[i]=m.map(y=>({start_time:(y.start_time||"").slice(0,5),end_time:(y.end_time||"").slice(0,5)})))}try{await fetch("/api/availabilities",{method:"PUT",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({practitioner_id:c,schedule:r})})}catch{}}if(e){const r=document.querySelectorAll("#tm_leave_table input[data-leave-type]");if(r.length>0){const i={};r.forEach(m=>{i[m.dataset.leaveType]=parseFloat(m.value)||0});try{await fetch(`/api/practitioners/${e}/leave-balance`,{method:"PUT",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({year:k,balances:i})})}catch{}}}document.getElementById("teamModalOverlay")?._dirtyGuard?.markClean(),C(),d.toast(e?b.practitioner+" modifié":b.practitioner+" ajouté","success"),T()}catch(n){d.toast("Erreur: "+n.message,"error")}finally{t&&(t.classList.remove("is-loading"),t.disabled=!1)}}function fe(e){const t=e.files[0];if(!t)return;if(t.size>2*1024*1024){d.toast("Photo trop lourde (max 2 Mo)","error");return}const a=new FileReader;a.onload=function(n){z=n.target.result,document.getElementById("tmAvatar").innerHTML=`<img src="${n.target.result}" style="width:100%;height:100%;object-fit:cover">`},a.readAsDataURL(t)}async function be(e){if(await S("Supprimer la photo","Supprimer la photo de profil ?","Supprimer","danger"))try{await fetch(`/api/practitioners/${e}/photo`,{method:"DELETE",headers:{Authorization:"Bearer "+u.getToken()}}),d.toast("Photo supprimée","success"),C(),T()}catch{d.toast("Erreur","error")}}async function _e(e,t){await S("Désactiver "+b.practitioner,`Désactiver ${t} ? Ses RDV futurs pourront être annulés.`,"Désactiver","danger")&&(C(),Q(e))}async function Q(e){try{const t=await fetch(`/api/practitioners/${e}`,{method:"DELETE",headers:{Authorization:"Bearer "+u.getToken()}});if(t.status===409){const n=(await t.json()).future_bookings_count||0;if(!await S("Désactiver "+b.practitioner,`Ce ${b.practitioner.toLowerCase()} a ${n} RDV à venir. Voulez-vous quand même le désactiver ?`,"Désactiver","danger"))return;const l=await S("Annuler les RDV ?",`Souhaitez-vous annuler les ${n} RDV à venir ?`,"Annuler les RDV","danger")?"?cancel_bookings=true":"?keep_bookings=true",c=await fetch(`/api/practitioners/${e}${l}`,{method:"DELETE",headers:{Authorization:"Bearer "+u.getToken()}});if(!c.ok){const i=await c.json().catch(()=>({}));throw new Error(i.message||i.error||"Erreur")}const r=await c.json();r.cancelled_count>0?d.toast(`${b.practitioner} désactivé, ${r.cancelled_count} RDV annulés`,"success"):d.toast(b.practitioner+" désactivé (RDV conservés)","success")}else if(t.ok)d.toast(b.practitioner+" désactivé","success");else{const a=await t.json().catch(()=>({}));throw new Error(a.message||a.error||"Erreur")}T()}catch(t){d.toast("Erreur: "+t.message,"error")}}async function $e(e){try{const t=await fetch(`/api/practitioners/${e}`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({is_active:!0,booking_enabled:!0})});if(!t.ok){const a=await t.json().catch(()=>({}));throw new Error(a.message||a.error||"Erreur")}d.toast(b.practitioner+" réactivé","success"),T()}catch(t){d.toast("Erreur: "+t.message,"error")}}async function xe(e,t){await S("Supprimer définitivement","Supprimer définitivement "+t+" ? Cette action est irréversible. Toutes ses données (horaires, services assignés) seront perdues. Les RDV existants seront conservés mais non assignés.","Supprimer définitivement","danger")&&(C(),W(e))}async function W(e){try{const t=await fetch("/api/practitioners/"+e+"?permanent=true",{method:"DELETE",headers:{Authorization:"Bearer "+u.getToken()}});if(t.status===409){const a=await t.json();if(!await S("RDV à venir",a.error+" Voulez-vous les annuler ?","Annuler les RDV et supprimer","danger"))return;const o=await fetch("/api/practitioners/"+e+"?permanent=true&cancel_bookings=true",{method:"DELETE",headers:{Authorization:"Bearer "+u.getToken()}});if(!o.ok){const s=await o.json().catch(()=>({}));throw new Error(s.message||s.error||"Erreur")}}else if(!t.ok){const a=await t.json().catch(()=>({}));throw new Error(a.message||a.error||"Erreur")}d.toast(b.practitioner+" supprimé définitivement","success"),T()}catch(t){d.toast("Erreur: "+t.message,"error")}}async function X(e,t){try{const a=await fetch(`/api/practitioners/${e}/tasks`,{headers:{Authorization:"Bearer "+u.getToken()}});if(!a.ok)throw new Error("Erreur");const n=await a.json(),o=n.todos||[],s=n.reminders||[],l=o.filter(p=>!p.is_done),c=o.filter(p=>p.is_done),r=s.filter(p=>!p.is_sent),i=s.filter(p=>p.is_sent);let m=`<div class="m-overlay open" id="tasksModalOverlay"><div class="m-dialog m-flex m-md">
      <div class="m-header" style="flex-shrink:0">
        <div class="m-header-bg" style="background:linear-gradient(135deg,var(--primary) 0%,var(--primary) 60%,rgba(13,115,119,.3) 100%)"></div>
        <button class="m-close" onclick="closeTasksModal()" aria-label="Fermer">×</button>
        <div class="m-header-content">
          <div class="m-client-hero">
            <div class="m-avatar" style="background:var(--primary)"><svg class="gi" style="width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2" ${E.tasks.slice(4)}></div>
            <div class="m-client-info">
              <div class="m-client-name">${_(t)}</div>
              <div class="m-client-meta">Tâches & rappels</div>
            </div>
          </div>
        </div>
      </div>
      <div class="m-body" style="overflow-y:auto;flex:1">`;m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Tâches en cours (${l.length})</span><span class="m-sec-line"></span></div>`,l.length===0?m+='<div style="font-size:.8rem;color:var(--text-4)">Aucune tâche en cours</div>':l.forEach(p=>{const $=p.booking_start?new Date(p.booking_start).toLocaleDateString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Brussels"}):"";m+=`<div style="padding:8px 0;border-bottom:1px solid var(--border-light);display:flex;gap:10px;align-items:flex-start">
          <input type="checkbox" onchange="togglePracTodo('${p.id}','${p.booking_id}',this.checked,'${e}','${B(t)}')" style="margin-top:3px">
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem">${_(p.content)}</div>
            <div style="font-size:.7rem;color:var(--text-4)">${_(p.client_name||"")} ${p.service_name?"· "+_(p.service_name):""} ${$?"· "+$:""}</div>
          </div>
        </div>`}),m+="</div>",c.length>0&&(m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title" style="color:var(--text-4)">Terminées (${c.length})</span><span class="m-sec-line"></span></div>`,c.slice(0,10).forEach(p=>{m+=`<div style="padding:6px 0;border-bottom:1px solid var(--border-light);opacity:.5">
          <div style="font-size:.8rem;text-decoration:line-through">${_(p.content)}</div>
          <div style="font-size:.68rem;color:var(--text-4)">${_(p.client_name||"")} · ${p.done_at?new Date(p.done_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short",timeZone:"Europe/Brussels"}):""}</div>
        </div>`}),c.length>10&&(m+=`<div style="font-size:.72rem;color:var(--text-4);padding:4px 0">+ ${c.length-10} autres</div>`),m+="</div>"),m+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Rappels à venir (${r.length})</span><span class="m-sec-line"></span></div>`,r.length===0?m+='<div style="font-size:.8rem;color:var(--text-4)">Aucun rappel en attente</div>':r.forEach(p=>{const $=new Date(p.remind_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Brussels"});m+=`<div style="padding:8px 0;border-bottom:1px solid var(--border-light)">
          <div style="font-size:.82rem">${$}</div>
          <div style="font-size:.7rem;color:var(--text-4)">${_(p.client_name||"")} ${p.service_name?"· "+_(p.service_name):""} ${p.message?"· "+_(p.message):""}</div>
        </div>`}),i.length>0&&(m+=`<div style="font-size:.72rem;color:var(--text-4);margin-top:8px">${i.length} rappel${i.length>1?"s":""} déjà envoyé${i.length>1?"s":""}</div>`),m+="</div>",m+="</div></div></div>",document.body.insertAdjacentHTML("beforeend",m);const y=document.getElementById("tasksModalOverlay");M(y,{noBackdropClose:!0}),A(y,()=>H())}catch(a){d.toast("Erreur: "+a.message,"error")}}function H(){j(),w("tasksModalOverlay"),document.querySelector(".m-overlay.open")||document.body.classList.remove("has-modal")}async function ke(e,t,a,n,o){try{await fetch(`/api/bookings/${t}/todos/${e}`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({is_done:a})}),H(),X(n,o)}catch{d.toast("Erreur","error")}}function we(e,t){const a=_(t),n=I[G]||I.autre;let o=`<div class="m-overlay open" id="inviteModalOverlay"><div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Créer un accès — ${a}</h3>
      <button class="m-close" onclick="closeInviteModal()" aria-label="Fermer">${E.close}</button>
    </div>
    <div class="m-body">
      <p style="font-size:.85rem;color:var(--text-3);margin-bottom:14px">Créez un compte pour que <strong>${a}</strong> puisse se connecter au dashboard.</p>
      <div class="m-sec">
        <div class="m-field-label">Email *</div>
        <input class="m-input" id="inv_email" type="email" placeholder="email@exemple.com">
      </div>
      <div class="m-sec" style="margin-top:12px">
        <div class="m-field-label">Mot de passe temporaire *</div>
        <input class="m-input" id="inv_pwd" type="text" value="${ee()}" style="font-family:monospace">
        <div style="font-size:.68rem;color:var(--text-4);margin-top:4px">Communiquez ce mot de passe. Il pourra être changé plus tard.</div>
      </div>
      <div class="m-sec" style="margin-top:12px">
        <div class="m-field-label">Rôle *</div>
        <select class="m-input" id="inv_role">
          <option value="owner">Propriétaire / Manager — Accès complet au dashboard</option>
          <option value="practitioner">${n.practitioner} — Voit uniquement son propre agenda et ses clients</option>
        </select>
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeInviteModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="sendInvite('${e}')">Créer le compte</button>
    </div>
  </div></div>`;document.body.insertAdjacentHTML("beforeend",o);const s=document.getElementById("inviteModalOverlay");M(s,{noBackdropClose:!0}),A(s,()=>q())}async function q(){j(),await w("inviteModalOverlay")}function ee(){const e="ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789",t=window.crypto||window.msCrypto;let a="";if(t&&typeof t.getRandomValues=="function"){const n=new Uint8Array(10);t.getRandomValues(n);for(let o=0;o<10;o++)a+=e[n[o]%e.length]}else{console.warn("[TEAM] window.crypto unavailable — falling back to Math.random for temp pwd");for(let n=0;n<10;n++)a+=e[Math.floor(Math.random()*e.length)]}return a}async function Ee(e){const t=document.getElementById("inv_email").value,a=document.getElementById("inv_pwd").value,n=document.getElementById("inv_role").value;if(!t||!a)return d.toast("Email et mot de passe requis","error");try{const o=await fetch(`/api/practitioners/${e}/invite`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({email:t,password:a,role:n})});if(!o.ok){const s=await o.json().catch(()=>({}));throw new Error(s.message||s.error||"Erreur")}document.getElementById("inviteModalOverlay")?._dirtyGuard?.markClean(),q(),d.toast("Compte créé ! Communiquez les identifiants.","success"),T()}catch(o){d.toast("Erreur: "+o.message,"error")}}function Te(e,t,a){const n=_(t),o=I[G]||I.autre,s=[{value:"owner",label:"Propriétaire / Manager",desc:"Accès complet au dashboard"},{value:"practitioner",label:o.practitioner,desc:"Voit uniquement son propre agenda et ses clients"}];let l=`<div class="m-overlay open" id="roleModalOverlay"><div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Modifier le rôle — ${n}</h3>
      <button class="m-close" onclick="closeRoleModal()" aria-label="Fermer">${E.close}</button>
    </div>
    <div class="m-body">
      <div style="display:flex;flex-direction:column;gap:8px">`;s.forEach(r=>{const i=r.value===a?"checked":"",m=r.value===a?"var(--primary)":"var(--border-light)";l+=`<label style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1.5px solid ${m};border-radius:10px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='${r.value===a?"var(--primary)":"var(--border-light)"}'" onclick="this.parentElement.querySelectorAll('label').forEach(l=>l.style.borderColor='var(--border-light)');this.style.borderColor='var(--primary)'">
      <input type="radio" name="role_pick" value="${r.value}" ${i} style="margin-top:2px">
      <div><div style="font-size:.88rem;font-weight:600">${r.label}</div><div style="font-size:.75rem;color:var(--text-4);margin-top:2px">${r.desc}</div></div>
    </label>`}),l+=`</div></div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeRoleModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="saveRole('${e}')">Enregistrer</button>
    </div>
  </div></div>`,document.body.insertAdjacentHTML("beforeend",l);const c=document.getElementById("roleModalOverlay");M(c,{noBackdropClose:!0}),A(c,()=>V())}async function V(){j(),await w("roleModalOverlay")}async function Se(e){const t=document.querySelector('input[name="role_pick"]:checked');if(!t)return d.toast("Sélectionnez un rôle","error");try{const a=await fetch(`/api/practitioners/${e}/role`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({role:t.value})});if(!a.ok){const n=await a.json().catch(()=>({}));throw new Error(n.message||n.error||"Erreur")}document.getElementById("roleModalOverlay")?._dirtyGuard?.markClean(),V(),d.toast("Rôle modifié","success"),T()}catch(a){d.toast("Erreur: "+a.message,"error")}}const N=e=>e?String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"):"";async function te(e){const t=document.getElementById("p_cal_area");if(t)try{const a=await fetch(`/api/calendar/connections?practitioner_id=${e}`,{headers:{Authorization:"Bearer "+u.getToken()}}),o=(a.ok?await a.json():{connections:[]}).connections||[],s=o.find(i=>i.provider==="google"),l=o.find(i=>i.provider==="outlook"),c=o.find(i=>i.provider==="ical");let r='<div style="display:grid;gap:8px">';if(r+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Google Calendar</div>
          ${s?`<div style="font-size:.68rem;color:var(--green)">${h.check} ${N(s.email||"Connecté")}${s.last_sync_at?" · "+new Date(s.last_sync_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Brussels"}):""}</div>`:'<div style="font-size:.68rem;color:var(--text-4)">Non connecté</div>'}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        ${s?`
          <button onclick="syncCalendar('${s.id}')" class="btn-outline btn-sm" aria-label="Synchroniser le calendrier" title="Synchroniser" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          <button onclick="disconnectCalendar('${s.id}','google','${e}')" class="btn-outline btn-sm btn-danger" style="font-size:.72rem;padding:4px 10px">${h.x}</button>
        `:`<button onclick="connectCalendar('google','${e}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">Connecter</button>`}
      </div>
    </div>`,r+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem">${h.mail}</span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Outlook</div>
          ${l?`<div style="font-size:.68rem;color:var(--green)">${h.check} ${N(l.email||"Connecté")}${l.last_sync_at?" · "+new Date(l.last_sync_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit",timeZone:"Europe/Brussels"}):""}</div>`:'<div style="font-size:.68rem;color:var(--text-4)">Non connecté</div>'}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        ${l?`
          <button onclick="syncCalendar('${l.id}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          <button onclick="disconnectCalendar('${l.id}','outlook','${e}')" class="btn-outline btn-sm btn-danger" style="font-size:.72rem;padding:4px 10px">${h.x}</button>
        `:`<button onclick="connectCalendar('outlook','${e}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">Connecter</button>`}
      </div>
    </div>`,r+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Apple / iCal</div>
          <div style="font-size:.68rem;color:var(--text-4)">URL d'abonnement</div>
        </div>
      </div>
      <button onclick="generateIcalFeed('${e}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">${c?"Regénérer":"Générer"}</button>
    </div>`,r+="</div>",r+='<div id="p_ical_url" style="display:none;margin-top:8px"></div>',s||l){const i=(s||l).sync_direction||"both";r+=`<div style="margin-top:10px;display:flex;align-items:center;gap:8px;font-size:.78rem">
        <span style="color:var(--text-3)">Direction :</span>
        <select onchange="updateCalSyncDirection(this.value,'${e}')" style="padding:3px 8px;border:1px solid var(--border);border-radius:4px;font-size:.75rem">
          <option value="both"${i==="both"?" selected":""}> Bidirectionnelle</option>
          <option value="push"${i==="push"?" selected":""}>→ Push (Genda → Cal)</option>
          <option value="pull"${i==="pull"?" selected":""}>← Pull (Cal → Genda)</option>
        </select>
      </div>`}t.innerHTML=r}catch{t.innerHTML='<div style="font-size:.78rem;color:var(--text-4)">Impossible de charger les connexions calendrier.</div>'}}async function Ce(e,t){try{const a=await u.get(`/api/calendar/${e}/connect?practitioner_id=${t||""}`);a.url?window.location.href=a.url:d.toast("Erreur de connexion","error")}catch(a){d.toast(a.message||"Erreur","error")}}async function Be(e,t,a){const n=t==="google"?"Google Calendar":"Outlook";if(await S("Déconnecter "+n,"Déconnecter "+n+" ?","Déconnecter","danger"))try{await u.delete(`/api/calendar/connections/${e}`),d.toast("Calendrier déconnecté","success"),a&&te(a)}catch(s){d.toast(s.message||"Erreur","error")}}async function Me(e){try{d.toast("Synchronisation en cours...","info");const t=await u.post(`/api/calendar/connections/${e}/sync`);d.toast("Synchro terminée : "+(t.pushed||0)+" poussés, "+(t.pulled||0)+" récupérés","success")}catch(t){d.toast(t.message||"Erreur synchro","error")}}async function Ae(e,t){try{const a=await fetch(`/api/calendar/connections?practitioner_id=${t}`,{headers:{Authorization:"Bearer "+u.getToken()}}),n=a.ok?await a.json():{connections:[]};for(const o of n.connections||[])o.provider!=="ical"&&await u.patch("/api/calendar/connections/"+o.id,{sync_direction:e});d.toast("Direction de synchro mise à jour","success")}catch(a){d.toast(a.message||"Erreur","error")}}async function ze(e){try{const t=await fetch("/api/calendar/ical/generate",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({practitioner_id:e||null})}),a=await t.json();if(!t.ok)throw new Error(a.message||a.error||"Erreur");const n=document.getElementById("p_ical_url");if(!n)return;n.style.display="block",n.innerHTML=`
      <div style="padding:10px 12px;background:var(--white);border:1px solid var(--border-light);border-radius:6px">
        <div style="font-family:monospace;font-size:.68rem;word-break:break-all;user-select:all;cursor:text;color:var(--text-2);margin-bottom:6px">${a.ical_url}</div>
        <div style="display:flex;gap:6px">
          <button onclick="navigator.clipboard.writeText('${a.ical_url}');GendaUI.toast('URL copiée !','success')" class="btn-outline btn-sm" style="font-size:.7rem;padding:3px 10px">${h.clipboard} Copier</button>
          <a href="${a.webcal_url}" class="btn-outline btn-sm" style="font-size:.7rem;padding:3px 10px;text-decoration:none;color:var(--primary)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg> Ouvrir</a>
        </div>
      </div>`}catch(t){d.toast(t.message||"Erreur","error")}}(function(){const e=new URLSearchParams(location.search);if(e.get("cal_connected")){const t=e.get("cal_connected")==="google"?"Google Calendar":"Outlook";setTimeout(function(){d.toast(t+" connecté avec succès !","success")},500),history.replaceState(null,"","/dashboard"),setTimeout(function(){document.querySelectorAll(".ni").forEach(function(n){n.classList.remove("active")});var a=document.querySelector('[data-section="team"]');a&&a.classList.add("active"),document.getElementById("pageTitle").textContent="Équipe",window.loadTeam&&window.loadTeam()},600)}e.get("cal_error")&&(setTimeout(function(){d.toast("Erreur calendrier: "+e.get("cal_error"),"error")},500),history.replaceState(null,"","/dashboard"))})();ne({loadTeam:T,openPractModal:re,savePract:ye,deactivatePract:Q,reactivatePract:$e,confirmDeactivatePract:_e,confirmDeletePract:xe,deletePractPermanent:W,openPracTasks:X,togglePracTodo:ke,closeTasksModal:H,openInviteModal:we,generateTempPwd:ee,sendInvite:Ee,closeInviteModal:q,openRoleModal:Te,saveRole:Se,closeRoleModal:V,pPhotoPreview:fe,pRemovePhoto:be,closeTeamModal:C,teamSwitchTab:le,teamLoadLeave:K,teamLoadSchedule:Z,teamAddSlot:pe,teamConfirmAddSlot:ue,teamRemoveSlot:he,teamEditSlot:ve,teamConfirmEditSlot:ge,teamToggleService:ce,teamToggleCatServices:de,teamToggleAllServices:me,loadPracCalSync:te,connectCalendar:Ce,disconnectCalendar:Be,syncCalendar:Me,updateCalSyncDirection:Ae,generateIcalFeed:ze});export{q as closeInviteModal,V as closeRoleModal,H as closeTasksModal,C as closeTeamModal,_e as confirmDeactivatePract,xe as confirmDeletePract,Ce as connectCalendar,Q as deactivatePract,W as deletePractPermanent,Be as disconnectCalendar,ze as generateIcalFeed,te as loadPracCalSync,T as loadTeam,we as openInviteModal,X as openPracTasks,re as openPractModal,Te as openRoleModal,fe as pPhotoPreview,be as pRemovePhoto,$e as reactivatePract,ye as savePract,Se as saveRole,Ee as sendInvite,Me as syncCalendar,pe as teamAddSlot,ue as teamConfirmAddSlot,ge as teamConfirmEditSlot,ve as teamEditSlot,K as teamLoadLeave,Z as teamLoadSchedule,he as teamRemoveSlot,le as teamSwitchTab,me as teamToggleAllServices,de as teamToggleCatServices,ce as teamToggleService,ke as togglePracTodo,Ae as updateCalSyncDirection};
