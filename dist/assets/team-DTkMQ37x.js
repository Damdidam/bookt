import{s as T,q as f,a as u,G as d,S as M,o as A,i as D,n as N,d as ee}from"./dashboard-CHYuFKOq.js";import{c as te}from"./color-swatches-C86JQZ0N.js";import{r as z,t as L,e as ne}from"./swipe-close-Dnpxvj1C.js";import{I as w}from"./icons-DATqSsmT.js";let C=null,_=new Date().getFullYear(),g={},y=new Set,x=[];const v=e=>e?String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"):"";function S(e){return String(e||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}const k={close:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',edit:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',tasks:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',key:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',role:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',mail:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>',phone:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',calendar:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',star:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',sun:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',hourglass:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>',plus:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',trash:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',link:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',shield:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>'},I={cdi:"CDI",cdd:"CDD",independant:"Indépendant",stagiaire:"Stagiaire",interim:"Intérim"},F={conge:"Congé",maladie:"Maladie",formation:"Formation",recuperation:"Récup."};function G(e){if(!e||e.length===0)return{label:"—",detail:""};const t=e.length;if(t===7)return{label:"7/7",detail:""};const n=["lun","mar","mer","jeu","ven","sam","dim"],i=[];for(let o=0;o<7;o++)e.includes(o)||i.push(n[o]);if(t===5&&!e.includes(5)&&!e.includes(6))return{label:"Temps plein",detail:""};const s=i.length<=3?i.join(", ")+" off":"";return{label:`${t}/7`,detail:s}}function ie(e){return e<=0?"danger":e<=5?"warn":"ok"}async function $(){const e=document.getElementById("contentArea");e.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const[t,n]=await Promise.all([fetch("/api/practitioners",{headers:{Authorization:"Bearer "+u.getToken()}}),fetch("/api/calendar/connections",{headers:{Authorization:"Bearer "+u.getToken()}}).catch(()=>({ok:!1}))]),i=await t.json(),o=(n.ok?await n.json():{connections:[]}).connections||[],r=i.practitioners||[],c=f.practitioner.toLowerCase();let l=`<div class="tm-list-header">
      <h3>${r.length} membre${r.length>1?"s":""} de l'équipe</h3>
      <button class="btn-primary" onclick="openPractModal()">+ Ajouter</button>
    </div>`;r.length===0?l+=`<div class="card"><div class="empty">Aucun ${c}. Ajoutez votre premier membre !</div></div>`:(l+='<div class="team-grid2">',r.forEach(a=>{const p=a.display_name?.split(" ").map(X=>X[0]).join("").toUpperCase().slice(0,2)||"??",h=G(a.work_days),m=!a.is_active;l+=`<div class="tm-card${m?" inactive":""}" onclick="openPractModal('${a.id}')">`,a.photo_url?l+=`<div class="tm-avatar"><img src="${v(a.photo_url)}" alt="${v(a.display_name)}" loading="lazy"></div>`:l+=`<div class="tm-avatar" style="background:linear-gradient(135deg,${v(a.color||"#0D7377")},${v(a.color||"#0D7377")}CC)">${p}</div>`,l+='<div class="tm-info">',l+=`<p class="tm-name">${v(a.display_name)}${m?' <span class="tm-badge-inactive">Inactif</span>':""}</p>`,l+=`<p class="tm-title">${v(a.title||"")}</p>`,h.label!=="—"&&(l+=`<p class="tm-regime">${h.label}${h.detail?" · "+h.detail:""}</p>`);const b=[];a.bookings_30d!=null&&b.push(a.bookings_30d+" RDV/mois"),a.contract_type&&I[a.contract_type]&&b.push(I[a.contract_type]),b.length&&(l+=`<p class="tm-summary">${b.join(" · ")}</p>`),l+="</div>",l+="</div>"}),l+=`<div class="tm-card tm-add" onclick="openPractModal()">
        <div class="tm-avatar tm-add-icon">${k.plus}</div>
        <div class="tm-info"><p class="tm-name">Ajouter un ${v(c)}</p></div>
      </div>`,l+="</div>"),e.innerHTML=l}catch(t){e.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${v(t.message)}</div>`}}function ae(e){const t={Authorization:"Bearer "+u.getToken()};e?Promise.all([fetch("/api/practitioners",{headers:t}).then(n=>n.json()),fetch("/api/services",{headers:t}).then(n=>n.json())]).then(([n,i])=>{x=(i.services||[]).filter(s=>s.is_active!==!1),q(n.practitioners.find(s=>s.id===e))}):fetch("/api/services",{headers:t}).then(n=>n.json()).then(n=>{x=(n.services||[]).filter(i=>i.is_active!==!1),q(null)})}function q(e){C=null,_=new Date().getFullYear(),y=new Set,e&&x.forEach(a=>{a.practitioner_ids&&a.practitioner_ids.includes(e.id)&&y.add(a.id)});const t=!!e;f.practitioner.toLowerCase();const n=e?.color||"#0D7377",i=e?.display_name?.split(" ").map(a=>a[0]).join("").toUpperCase().slice(0,2)||"??",s=e?.photo_url?`<img src="${v(e.photo_url)}" alt="${v(e.display_name)}" style="width:100%;height:100%;object-fit:cover">`:i,o=e?v(e.display_name):"Nouveau "+f.practitioner;let r=`<div id="teamModalOverlay" class="m-overlay open">
    <div class="m-dialog m-flex m-lg">
    <div class="m-drag-handle"></div>

    <!-- M-HEADER -->
    <div class="m-header">
      <div class="m-header-bg" id="tmHeaderBg" style="background:linear-gradient(135deg,${n} 0%,${n}AA 60%,${n}55 100%)"></div>
      <button class="m-close" onclick="closeTeamModal()" aria-label="Fermer">
        <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="m-header-content">
        <div class="m-client-hero" style="align-items:center">
          <div class="m-avatar" id="tmAvatar" style="background:linear-gradient(135deg,${n},${n}CC);cursor:pointer" onclick="document.getElementById('pPhotoInput').click()">
            ${s}
          </div>
          <div class="m-modal-title" id="tmModalTitle">${o}</div>
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
              ${["cdi","cdd","independant","stagiaire","interim"].map(a=>`<option value="${a}"${(e?.contract_type||"cdi")===a?" selected":""}>${I[a]}</option>`).join("")}
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
          <textarea class="m-input" id="p_note" style="min-height:60px" placeholder="Notes privées (visibles par le manager uniquement)...">${v(e?.internal_note||"")}</textarea>
        </div>

        ${t&&e?.photo_url?`<div style="text-align:center;margin-top:8px"><button onclick="pRemovePhoto('${e.id}')" style="font-size:.7rem;color:var(--red);background:none;border:none;cursor:pointer">Supprimer la photo</button></div>`:""}
      </div>

      <!-- TAB: COMPÉTENCES -->
      <div class="m-panel" id="team-panel-skills">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Prestations assignées</span><span class="m-sec-line"></span></div>
          <div id="tm_services_list">${j()}</div>
        </div>
      </div>

      <!-- TAB: HORAIRE -->
      <div class="m-panel" id="team-panel-schedule">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Disponibilités hebdomadaires</span><span class="m-sec-line"></span></div>
          <div id="tm_schedule_editor">${t?'<div style="font-size:.78rem;color:var(--text-4)">Chargement...</div>':B()}</div>
        </div>
        ${e?.weekly_hours_target?`<div style="margin-top:10px;font-size:.78rem;color:var(--text-3)">Heures/semaine cible : <strong>${e.weekly_hours_target}h</strong></div>`:""}
      </div>

      <!-- TAB: CONGÉS -->
      ${t?`<div class="m-panel" id="team-panel-leave">
        <div class="m-sec">
          <div class="m-sec-head">
            <span class="m-sec-title">Solde congés</span><span class="m-sec-line"></span>
            <select class="m-input" id="tm_leave_year" style="width:auto;padding:4px 8px;font-size:.72rem" onchange="teamLoadLeave('${e.id}',this.value)">
              ${[_-1,_,_+1].map(a=>`<option value="${a}"${a===_?" selected":""}>${a}</option>`).join("")}
            </select>
          </div>
          <div id="tm_leave_table">${U(e.leave_balance)}</div>
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
            ${[1,2,3,4,5,6,8,10].map(a=>`<option value="${a}"${(e?.max_concurrent||1)===a?" selected":""}>${a}${a===1?" (pas de chevauchement)":" simultanés"}</option>`).join("")}
          </select>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Réservation en ligne</span><span class="m-sec-line"></span></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer">
            <input type="checkbox" id="p_booking" ${e?.booking_enabled!==!1?"checked":""}> Peut recevoir des réservations en ligne
          </label>
        </div>

        ${t?`<div class="m-sec" style="margin-top:16px">
          <div class="m-sec-head"><span class="m-sec-title"><svg class="gi" style="width:12px;height:12px" ${k.calendar.slice(4)}> Synchronisation calendrier</span><span class="m-sec-line"></span></div>
          <div id="p_cal_area" style="font-size:.82rem;color:var(--text-4)">Chargement...</div>
        </div>`:""}
      </div>

    </div>

    <!-- BOTTOM BAR -->
    <div class="m-bottom">
      ${t?`<button class="m-btn m-btn-danger" onclick="confirmDeactivatePract('${e.id}','${v(e.display_name)}')">Désactiver</button>`:""}
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeTeamModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="savePract(${t?"'"+e.id+"'":"null"})">${t?"Enregistrer":"Créer"}</button>
    </div>

  </div></div>`;document.body.insertAdjacentHTML("beforeend",r);const c=document.getElementById("teamModalOverlay");A(c,{noBackdropClose:!0}),L(c,()=>E()),ne(c.querySelector(".m-dialog"),()=>E()),D(c),document.getElementById("p_color_wrap").innerHTML=te("p_color",e?.color||"#1E3A8A",!1);const l=document.getElementById("p_color");if(l&&l.addEventListener("change",()=>{const a=l.value||"#0D7377",p=document.getElementById("tmHeaderBg"),h=document.getElementById("tmAvatar");p&&(p.style.background=`linear-gradient(135deg,${a} 0%,${a}AA 60%,${a}55 100%)`),h&&(h.style.background=`linear-gradient(135deg,${a},${a}CC)`)}),e?.id,t)window.loadPracCalSync&&window.loadPracCalSync(e.id),Y(e.id,_),J(e.id);else{g={};for(let a=0;a<7;a++)g[a]=[]}}async function E(){z(),await closeModal("teamModalOverlay")}function oe(e){document.querySelectorAll("#teamModalOverlay .m-tab").forEach(t=>{t.classList.toggle("active",t.dataset.tab===e)}),document.querySelectorAll("#teamModalOverlay .m-panel").forEach(t=>t.classList.remove("active")),document.getElementById("team-panel-"+e)?.classList.add("active")}function j(){if(x.length===0)return`<div style="font-size:.78rem;color:var(--text-4);padding:12px 0">Aucune prestation créée. <a href="#" onclick="event.preventDefault();window.loadSection&&window.loadSection('services')" style="color:var(--primary)">Créer des prestations</a></div>`;const e={},t=[];x.forEach(o=>{const r=o.category||"Sans catégorie";e[r]||(e[r]=[],t.push(r)),e[r].push(o)});const n=x.length,i=y.size;let s=`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <span style="font-size:.75rem;color:var(--text-3)">${i}/${n} prestation${n>1?"s":""} assignée${i>1?"s":""}</span>
    <button class="m-btn m-btn-ghost" style="font-size:.7rem;padding:4px 10px" onclick="teamToggleAllServices()">${i===n?"Tout désélectionner":"Tout sélectionner"}</button>
  </div>`;return t.forEach(o=>{const r=e[o],c=r.filter(a=>y.has(a.id)).length,l=c===r.length;s+=`<div class="svc-assign-group">
      <label class="svc-assign-cat" onclick="event.preventDefault();teamToggleCatServices('${v(o)}')">
        <input type="checkbox" ${l?"checked":""} tabindex="-1" style="accent-color:var(--primary)">
        <span class="svc-assign-cat-name">${S(o)}</span>
        <span class="svc-assign-cat-count">${c}/${r.length}</span>
      </label>`,r.forEach(a=>{const p=y.has(a.id),h=a.price_cents?(a.price_cents/100).toFixed(2).replace(".00","")+"€":"";s+=`<label class="svc-assign-item${p?" checked":""}" onclick="event.preventDefault();teamToggleService('${a.id}')">
        <input type="checkbox" ${p?"checked":""} tabindex="-1" style="accent-color:var(--primary)">
        <span class="svc-assign-name">${v(a.name)}</span>
        <span class="svc-assign-meta">${a.duration_min?a.duration_min+" min":""}${h?" · "+h:""}</span>
      </label>`}),s+="</div>"}),s}function se(e){y.has(e)?y.delete(e):y.add(e),document.getElementById("tm_services_list").innerHTML=j()}function re(e){const t=x.filter(i=>(i.category||"Sans catégorie")===e),n=t.every(i=>y.has(i.id));t.forEach(i=>{n?y.delete(i.id):y.add(i.id)}),document.getElementById("tm_services_list").innerHTML=j()}function le(){y.size===x.length?y.clear():x.forEach(t=>y.add(t.id)),document.getElementById("tm_services_list").innerHTML=j()}const P=["Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi","Dimanche"];async function J(e){try{const s=((await(await fetch(`/api/availabilities?practitioner_id=${e}`,{headers:{Authorization:"Bearer "+u.getToken()}})).json()).availabilities||{})[e];g={};for(let o=0;o<7;o++)g[o]=(s?.schedule?.[o]||[]).map(r=>({start_time:r.start_time,end_time:r.end_time}));document.getElementById("tm_schedule_editor").innerHTML=B()}catch(t){document.getElementById("tm_schedule_editor").innerHTML=`<div style="color:var(--red);font-size:.82rem">Erreur: ${v(t.message)}</div>`}}function B(){const e=[];for(let i=0;i<7;i++)g[i]&&g[i].length>0&&e.push(i);const t=G(e);let n=`<div style="font-size:.82rem;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px">
    Régime : <span style="color:var(--primary)">${t.label}</span>
    ${t.detail?`<span style="color:var(--text-4);font-weight:400;font-size:.75rem">(${t.detail})</span>`:""}
  </div>`;for(let i=0;i<7;i++){const s=g[i]||[];n+=`<div class="day-row">
      <span class="day-name">${P[i]}</span>
      <div class="slots">`,s.length===0?n+='<span class="day-closed">Fermé</span>':s.forEach((o,r)=>{n+=`<span class="slot-chip"><span class="slot-chip-text" onclick="teamEditSlot(${i},${r})" title="Cliquer pour modifier">${(o.start_time||"").slice(0,5)} – ${(o.end_time||"").slice(0,5)}</span><button class="remove-slot" onclick="teamRemoveSlot(${i},${r})">${k.close}</button></span>`}),n+=`<button class="add-slot-btn" onclick="teamAddSlot(${i})">+ Ajouter</button>
      </div>
    </div>`}return n}function ce(e){const t=g[e]||[],n=t[t.length-1],i=n?n.end_time:"09:00:00",s=parseInt((i||"09:00").split(":")[0]),o=`${String(Math.min(s+4,20)).padStart(2,"0")}:00`;let r=`<div class="m-overlay open" id="teamSlotModal" style="z-index:350"><div class="m-dialog m-sm"><div class="m-header-simple"><h3>Créneau — ${P[e]}</h3><button class="m-close" onclick="document.getElementById('teamSlotModal').remove()">${k.close}</button></div><div class="m-body">
    <div class="m-row m-row-2"><div><div class="m-field-label">Début</div><input type="text" class="m-input m-time" id="tm_slot_start" value="${(i||"09:00").slice(0,5)}"></div><div><div class="m-field-label">Fin</div><input type="text" class="m-input m-time" id="tm_slot_end" value="${o}"></div></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="document.getElementById('teamSlotModal').remove()">Annuler</button><button class="m-btn m-btn-primary" onclick="teamConfirmAddSlot(${e})">Ajouter</button></div></div></div>`;document.body.insertAdjacentHTML("beforeend",r),D(document.getElementById("teamSlotModal"))}function de(e){const t=document.getElementById("tm_slot_start").value,n=document.getElementById("tm_slot_end").value;if(!t||!n){d.toast("Heures requises","error");return}if(t>=n){d.toast("L'heure de fin doit être après le début","error");return}if((g[e]||[]).some(c=>t<(c.end_time||"").slice(0,5)&&n>(c.start_time||"").slice(0,5))){d.toast("Ce créneau chevauche un autre","error");return}const o=t+":00",r=n+":00";g[e]||(g[e]=[]),g[e].push({start_time:o,end_time:r}),g[e].sort((c,l)=>c.start_time.localeCompare(l.start_time)),document.getElementById("teamSlotModal")?.remove(),document.getElementById("tm_schedule_editor").innerHTML=B()}function me(e,t){const n=g[e]?.[t];if(!n)return;const i=(n.start_time||"09:00:00").slice(0,5),s=(n.end_time||"18:00:00").slice(0,5);let o=`<div class="m-overlay open" id="teamSlotModal" style="z-index:350"><div class="m-dialog m-sm"><div class="m-header-simple"><h3>Modifier créneau — ${P[e]}</h3><button class="m-close" onclick="document.getElementById('teamSlotModal').remove()">${k.close}</button></div><div class="m-body">
    <div class="m-row m-row-2"><div><div class="m-field-label">Début</div><input type="text" class="m-input m-time" id="tm_slot_start" value="${i}"></div><div><div class="m-field-label">Fin</div><input type="text" class="m-input m-time" id="tm_slot_end" value="${s}"></div></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="document.getElementById('teamSlotModal').remove()">Annuler</button><button class="m-btn m-btn-danger" onclick="teamRemoveSlot(${e},${t});document.getElementById('teamSlotModal').remove()" style="margin-right:auto">Supprimer</button><button class="m-btn m-btn-primary" onclick="teamConfirmEditSlot(${e},${t})">Enregistrer</button></div></div></div>`;document.body.insertAdjacentHTML("beforeend",o),D(document.getElementById("teamSlotModal"))}function pe(e,t){const n=document.getElementById("tm_slot_start").value,i=document.getElementById("tm_slot_end").value;if(!n||!i){d.toast("Heures requises","error");return}if(n>=i){d.toast("L'heure de fin doit être après le début","error");return}if((g[e]||[]).some((l,a)=>a===t?!1:n<(l.end_time||"").slice(0,5)&&i>(l.start_time||"").slice(0,5))){d.toast("Ce créneau chevauche un autre","error");return}const r=n+":00",c=i+":00";g[e]&&g[e][t]&&(g[e][t]={start_time:r,end_time:c},g[e].sort((l,a)=>l.start_time.localeCompare(a.start_time))),document.getElementById("teamSlotModal")?.remove(),document.getElementById("tm_schedule_editor").innerHTML=B()}function ve(e,t){g[e].splice(t,1),document.getElementById("tm_schedule_editor").innerHTML=B()}function U(e){const t=["conge","maladie","formation","recuperation"];let n=`<table class="leave-table">
    <thead><tr><th>Type</th><th>Quota</th><th>Pris</th><th>Solde</th></tr></thead><tbody>`;return t.forEach(i=>{const s=e?.[i]||{total:0,used:0},o=(s.total||0)-(s.used||0),r=ie(o);n+=`<tr>
      <td style="font-weight:600">${F[i]}</td>
      <td><input class="m-input" type="number" step="0.5" min="0" value="${s.total||0}" data-leave-type="${i}" style="width:60px;padding:4px 6px;text-align:center"></td>
      <td style="color:var(--text-4)">${s.used||0}j</td>
      <td><span class="leave-solde ${r}">${o>0?"+":""}${o}j</span></td>
    </tr>`}),n+="</tbody></table>",n}async function Y(e,t){_=parseInt(t);try{const i=await(await fetch(`/api/practitioners/${e}/leave-balance?year=${t}`,{headers:{Authorization:"Bearer "+u.getToken()}})).json();document.getElementById("tm_leave_table").innerHTML=U(i.balances);const s=document.getElementById("tm_recent_abs");i.recent_absences&&i.recent_absences.length>0?s.innerHTML=i.recent_absences.map(o=>{const r=new Date(o.date_from).toLocaleDateString("fr-BE",{day:"numeric",month:"short"}),c=new Date(o.date_to).toLocaleDateString("fr-BE",{day:"numeric",month:"short"});return`<div style="padding:6px 0;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">
          <span><span class="tm-badge" style="font-size:.6rem;margin-right:6px;background:var(--surface)">${F[o.type]||o.type}</span> ${r}${r!==c?" → "+c:""}</span>
          <span style="font-size:.68rem;color:var(--text-4)">${o.note?v(o.note):""}</span>
        </div>`}).join(""):s.innerHTML='<div style="padding:8px 0">Aucune absence enregistrée</div>'}catch(n){document.getElementById("tm_leave_table").innerHTML=`<div style="color:var(--red);font-size:.82rem">Erreur: ${v(n.message)}</div>`}}async function ue(e){const t=document.querySelector("#teamModalOverlay .m-bottom .m-btn-primary");t&&(t.disabled=!0,t.classList.add("is-loading"));const n={display_name:document.getElementById("p_name").value,title:document.getElementById("p_title").value||null,years_experience:parseInt(document.getElementById("p_years").value)||null,color:document.getElementById("p_color").value,email:document.getElementById("p_email").value||null,phone:document.getElementById("p_phone").value||null,bio:document.getElementById("p_bio").value||null,linkedin_url:document.getElementById("p_linkedin").value||null,contract_type:document.getElementById("p_contract").value,hire_date:document.getElementById("p_hire").value||null,weekly_hours_target:parseFloat(document.getElementById("p_hours").value)||null,emergency_contact_name:document.getElementById("p_emerg_name").value||null,emergency_contact_phone:document.getElementById("p_emerg_phone").value||null,internal_note:document.getElementById("p_note").value||null,booking_enabled:document.getElementById("p_booking").checked,max_concurrent:parseInt(document.getElementById("p_max_concurrent").value)||1};try{const i=e?`/api/practitioners/${e}`:"/api/practitioners",o=await fetch(i,{method:e?"PATCH":"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify(n)});if(!o.ok)throw new Error((await o.json()).error);const r=await o.json(),c=e||r.practitioner?.id;if(C&&c&&(await fetch(`/api/practitioners/${c}/photo`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({photo:C})}),C=null),c)try{await fetch(`/api/practitioners/${c}/services`,{method:"PUT",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({service_ids:[...y]})})}catch{}if(c&&g){const l={};for(let a=0;a<7;a++){const p=g[a]||[];p.length>0&&(l[a]=p.map(h=>({start_time:(h.start_time||"").slice(0,5),end_time:(h.end_time||"").slice(0,5)})))}try{await fetch("/api/availabilities",{method:"PUT",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({practitioner_id:c,schedule:l})})}catch{}}if(e){const l=document.querySelectorAll("#tm_leave_table input[data-leave-type]");if(l.length>0){const a={};l.forEach(p=>{a[p.dataset.leaveType]=parseFloat(p.value)||0});try{await fetch(`/api/practitioners/${e}/leave-balance`,{method:"PUT",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({year:_,balances:a})})}catch{}}}document.getElementById("teamModalOverlay")?._dirtyGuard?.markClean(),E(),d.toast(e?f.practitioner+" modifié":f.practitioner+" ajouté","success"),$()}catch(i){d.toast("Erreur: "+i.message,"error")}finally{t&&(t.classList.remove("is-loading"),t.disabled=!1)}}function ge(e){const t=e.files[0];if(!t)return;if(t.size>2*1024*1024){d.toast("Photo trop lourde (max 2 Mo)","error");return}const n=new FileReader;n.onload=function(i){C=i.target.result,document.getElementById("tmAvatar").innerHTML=`<img src="${i.target.result}" style="width:100%;height:100%;object-fit:cover">`},n.readAsDataURL(t)}async function he(e){if(await T("Supprimer la photo","Supprimer la photo de profil ?","Supprimer","danger"))try{await fetch(`/api/practitioners/${e}/photo`,{method:"DELETE",headers:{Authorization:"Bearer "+u.getToken()}}),d.toast("Photo supprimée","success"),E(),$()}catch{d.toast("Erreur","error")}}async function ye(e,t){await T("Désactiver "+f.practitioner,`Désactiver ${t} ? Ses RDV futurs pourront être annulés.`,"Désactiver","danger")&&(E(),Z(e))}async function Z(e){try{const t=await fetch(`/api/practitioners/${e}`,{method:"DELETE",headers:{Authorization:"Bearer "+u.getToken()}});if(t.status===409){const i=(await t.json()).future_bookings_count||0;if(!await T("Désactiver "+f.practitioner,`Ce ${f.practitioner.toLowerCase()} a ${i} RDV à venir. Voulez-vous quand même le désactiver ?`,"Désactiver","danger"))return;const r=await T("Annuler les RDV ?",`Souhaitez-vous annuler les ${i} RDV à venir ?`,"Annuler les RDV","danger")?"?cancel_bookings=true":"?keep_bookings=true",c=await fetch(`/api/practitioners/${e}${r}`,{method:"DELETE",headers:{Authorization:"Bearer "+u.getToken()}});if(!c.ok)throw new Error((await c.json()).error);const l=await c.json();l.cancelled_count>0?d.toast(`${f.practitioner} désactivé, ${l.cancelled_count} RDV annulés`,"success"):d.toast(f.practitioner+" désactivé (RDV conservés)","success")}else if(t.ok)d.toast(f.practitioner+" désactivé","success");else throw new Error((await t.json()).error);$()}catch(t){d.toast("Erreur: "+t.message,"error")}}async function fe(e){try{const t=await fetch(`/api/practitioners/${e}`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({is_active:!0,booking_enabled:!0})});if(!t.ok)throw new Error((await t.json()).error);d.toast(f.practitioner+" réactivé","success"),$()}catch(t){d.toast("Erreur: "+t.message,"error")}}async function K(e,t){try{const n=await fetch(`/api/practitioners/${e}/tasks`,{headers:{Authorization:"Bearer "+u.getToken()}});if(!n.ok)throw new Error("Erreur");const i=await n.json(),s=i.todos||[],o=i.reminders||[],r=s.filter(m=>!m.is_done),c=s.filter(m=>m.is_done),l=o.filter(m=>!m.is_sent),a=o.filter(m=>m.is_sent);let p=`<div class="m-overlay open" id="tasksModalOverlay"><div class="m-dialog m-flex m-md">
      <div class="m-header" style="flex-shrink:0">
        <div class="m-header-bg" style="background:linear-gradient(135deg,var(--primary) 0%,var(--primary) 60%,rgba(13,115,119,.3) 100%)"></div>
        <button class="m-close" onclick="closeTasksModal()">×</button>
        <div class="m-header-content">
          <div class="m-client-hero">
            <div class="m-avatar" style="background:var(--primary)"><svg style="width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2" ${k.tasks.slice(4)}></div>
            <div class="m-client-info">
              <div class="m-client-name">${t}</div>
              <div class="m-client-meta">Tâches & rappels</div>
            </div>
          </div>
        </div>
      </div>
      <div class="m-body" style="overflow-y:auto;flex:1">`;p+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Tâches en cours (${r.length})</span><span class="m-sec-line"></span></div>`,r.length===0?p+='<div style="font-size:.8rem;color:var(--text-4)">Aucune tâche en cours</div>':r.forEach(m=>{const b=m.booking_start?new Date(m.booking_start).toLocaleDateString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"";p+=`<div style="padding:8px 0;border-bottom:1px solid var(--border-light);display:flex;gap:10px;align-items:flex-start">
          <input type="checkbox" onchange="togglePracTodo('${m.id}','${m.booking_id}',this.checked,'${e}','${v(t)}')" style="margin-top:3px">
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem">${S(m.content)}</div>
            <div style="font-size:.7rem;color:var(--text-4)">${m.client_name||""} ${m.service_name?"· "+m.service_name:""} ${b?"· "+b:""}</div>
          </div>
        </div>`}),p+="</div>",c.length>0&&(p+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title" style="color:var(--text-4)">Terminées (${c.length})</span><span class="m-sec-line"></span></div>`,c.slice(0,10).forEach(m=>{p+=`<div style="padding:6px 0;border-bottom:1px solid var(--border-light);opacity:.5">
          <div style="font-size:.8rem;text-decoration:line-through">${S(m.content)}</div>
          <div style="font-size:.68rem;color:var(--text-4)">${m.client_name||""} · ${m.done_at?new Date(m.done_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short"}):""}</div>
        </div>`}),c.length>10&&(p+=`<div style="font-size:.72rem;color:var(--text-4);padding:4px 0">+ ${c.length-10} autres</div>`),p+="</div>"),p+=`<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Rappels à venir (${l.length})</span><span class="m-sec-line"></span></div>`,l.length===0?p+='<div style="font-size:.8rem;color:var(--text-4)">Aucun rappel en attente</div>':l.forEach(m=>{const b=new Date(m.remind_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"});p+=`<div style="padding:8px 0;border-bottom:1px solid var(--border-light)">
          <div style="font-size:.82rem">${b}</div>
          <div style="font-size:.7rem;color:var(--text-4)">${m.client_name||""} ${m.service_name?"· "+m.service_name:""} ${m.message?"· "+S(m.message):""}</div>
        </div>`}),a.length>0&&(p+=`<div style="font-size:.72rem;color:var(--text-4);margin-top:8px">${a.length} rappel${a.length>1?"s":""} déjà envoyé${a.length>1?"s":""}</div>`),p+="</div>",p+="</div></div></div>",document.body.insertAdjacentHTML("beforeend",p);const h=document.getElementById("tasksModalOverlay");A(h,{noBackdropClose:!0}),L(h,()=>O())}catch(n){d.toast("Erreur: "+n.message,"error")}}function O(){z(),document.getElementById("tasksModalOverlay")?.remove(),document.querySelector(".m-overlay.open")||document.body.classList.remove("has-modal")}async function be(e,t,n,i,s){try{await fetch(`/api/bookings/${t}/todos/${e}`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({is_done:n})}),O(),K(i,s)}catch{d.toast("Erreur","error")}}function xe(e,t){const n=M[N]||M.autre;let i=`<div class="m-overlay open" id="inviteModalOverlay"><div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Créer un accès — ${t}</h3>
      <button class="m-close" onclick="closeInviteModal()">${k.close}</button>
    </div>
    <div class="m-body">
      <p style="font-size:.85rem;color:var(--text-3);margin-bottom:14px">Créez un compte pour que <strong>${t}</strong> puisse se connecter au dashboard.</p>
      <div class="m-sec">
        <div class="m-field-label">Email *</div>
        <input class="m-input" id="inv_email" type="email" placeholder="email@exemple.com">
      </div>
      <div class="m-sec" style="margin-top:12px">
        <div class="m-field-label">Mot de passe temporaire *</div>
        <input class="m-input" id="inv_pwd" type="text" value="${Q()}" style="font-family:monospace">
        <div style="font-size:.68rem;color:var(--text-4);margin-top:4px">Communiquez ce mot de passe. Il pourra être changé plus tard.</div>
      </div>
      <div class="m-sec" style="margin-top:12px">
        <div class="m-field-label">Rôle *</div>
        <select class="m-input" id="inv_role">
          <option value="practitioner">${n.practitioner} — Voit uniquement son propre agenda et ses clients</option>
          <option value="receptionist">${n.receptionist} — Voit l'agenda de tous, gère les RDV et clients</option>
          <option value="manager">${n.manager} — Agenda de tous, clients, documents, statistiques</option>
        </select>
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeInviteModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="sendInvite('${e}')">Créer le compte</button>
    </div>
  </div></div>`;document.body.insertAdjacentHTML("beforeend",i);const s=document.getElementById("inviteModalOverlay");A(s,{noBackdropClose:!0}),L(s,()=>H())}async function H(){z(),await closeModal("inviteModalOverlay")}function Q(){const e="ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";let t="";for(let n=0;n<10;n++)t+=e[Math.floor(Math.random()*e.length)];return t}async function _e(e){const t=document.getElementById("inv_email").value,n=document.getElementById("inv_pwd").value,i=document.getElementById("inv_role").value;if(!t||!n)return d.toast("Email et mot de passe requis","error");try{const s=await fetch(`/api/practitioners/${e}/invite`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({email:t,password:n,role:i})});if(!s.ok)throw new Error((await s.json()).error);document.getElementById("inviteModalOverlay")?._dirtyGuard?.markClean(),H(),d.toast("Compte créé ! Communiquez les identifiants.","success"),$()}catch(s){d.toast("Erreur: "+s.message,"error")}}function ke(e,t,n){const i=M[N]||M.autre,s=[{value:"practitioner",label:i.practitioner,desc:"Voit uniquement son propre agenda et ses clients"},{value:"receptionist",label:i.receptionist,desc:"Voit l'agenda de tous, gère les RDV et clients"},{value:"manager",label:i.manager,desc:"Agenda de tous, clients, documents, statistiques"}];let o=`<div class="m-overlay open" id="roleModalOverlay"><div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Modifier le rôle — ${t}</h3>
      <button class="m-close" onclick="closeRoleModal()">${k.close}</button>
    </div>
    <div class="m-body">
      <div style="display:flex;flex-direction:column;gap:8px">`;s.forEach(c=>{const l=c.value===n?"checked":"",a=c.value===n?"var(--primary)":"var(--border-light)";o+=`<label style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1.5px solid ${a};border-radius:10px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='${c.value===n?"var(--primary)":"var(--border-light)"}'" onclick="this.parentElement.querySelectorAll('label').forEach(l=>l.style.borderColor='var(--border-light)');this.style.borderColor='var(--primary)'">
      <input type="radio" name="role_pick" value="${c.value}" ${l} style="margin-top:2px">
      <div><div style="font-size:.88rem;font-weight:600">${c.label}</div><div style="font-size:.75rem;color:var(--text-4);margin-top:2px">${c.desc}</div></div>
    </label>`}),o+=`</div></div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeRoleModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="saveRole('${e}')">Enregistrer</button>
    </div>
  </div></div>`,document.body.insertAdjacentHTML("beforeend",o);const r=document.getElementById("roleModalOverlay");A(r,{noBackdropClose:!0}),L(r,()=>R())}async function R(){z(),await closeModal("roleModalOverlay")}async function $e(e){const t=document.querySelector('input[name="role_pick"]:checked');if(!t)return d.toast("Sélectionnez un rôle","error");try{const n=await fetch(`/api/practitioners/${e}/role`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({role:t.value})});if(!n.ok)throw new Error((await n.json()).error);document.getElementById("roleModalOverlay")?._dirtyGuard?.markClean(),R(),d.toast("Rôle modifié","success"),$()}catch(n){d.toast("Erreur: "+n.message,"error")}}const V=e=>e?String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"):"";async function W(e){const t=document.getElementById("p_cal_area");if(t)try{const n=await fetch(`/api/calendar/connections?practitioner_id=${e}`,{headers:{Authorization:"Bearer "+u.getToken()}}),s=(n.ok?await n.json():{connections:[]}).connections||[],o=s.find(a=>a.provider==="google"),r=s.find(a=>a.provider==="outlook"),c=s.find(a=>a.provider==="ical");let l='<div style="display:grid;gap:8px">';if(l+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Google Calendar</div>
          ${o?`<div style="font-size:.68rem;color:var(--green)">${w.check} ${V(o.email||"Connecté")}${o.last_sync_at?" · "+new Date(o.last_sync_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):""}</div>`:'<div style="font-size:.68rem;color:var(--text-4)">Non connecté</div>'}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        ${o?`
          <button onclick="syncCalendar('${o.id}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          <button onclick="disconnectCalendar('${o.id}','google','${e}')" class="btn-outline btn-sm btn-danger" style="font-size:.72rem;padding:4px 10px">${w.x}</button>
        `:`<button onclick="connectCalendar('google','${e}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">Connecter</button>`}
      </div>
    </div>`,l+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem">${w.mail}</span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Outlook</div>
          ${r?`<div style="font-size:.68rem;color:var(--green)">${w.check} ${V(r.email||"Connecté")}${r.last_sync_at?" · "+new Date(r.last_sync_at).toLocaleDateString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):""}</div>`:'<div style="font-size:.68rem;color:var(--text-4)">Non connecté</div>'}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        ${r?`
          <button onclick="syncCalendar('${r.id}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          <button onclick="disconnectCalendar('${r.id}','outlook','${e}')" class="btn-outline btn-sm btn-danger" style="font-size:.72rem;padding:4px 10px">${w.x}</button>
        `:`<button onclick="connectCalendar('outlook','${e}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">Connecter</button>`}
      </div>
    </div>`,l+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Apple / iCal</div>
          <div style="font-size:.68rem;color:var(--text-4)">URL d'abonnement</div>
        </div>
      </div>
      <button onclick="generateIcalFeed('${e}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">${c?"Regénérer":"Générer"}</button>
    </div>`,l+="</div>",l+='<div id="p_ical_url" style="display:none;margin-top:8px"></div>',o||r){const a=(o||r).sync_direction||"both";l+=`<div style="margin-top:10px;display:flex;align-items:center;gap:8px;font-size:.78rem">
        <span style="color:var(--text-3)">Direction :</span>
        <select onchange="updateCalSyncDirection(this.value,'${e}')" style="padding:3px 8px;border:1px solid var(--border);border-radius:4px;font-size:.75rem">
          <option value="both"${a==="both"?" selected":""}> Bidirectionnelle</option>
          <option value="push"${a==="push"?" selected":""}>→ Push (Genda → Cal)</option>
          <option value="pull"${a==="pull"?" selected":""}>← Pull (Cal → Genda)</option>
        </select>
      </div>`}t.innerHTML=l}catch{t.innerHTML='<div style="font-size:.78rem;color:var(--text-4)">Impossible de charger les connexions calendrier.</div>'}}async function we(e,t){try{const n=await u.get(`/api/calendar/${e}/connect?practitioner_id=${t||""}`);n.url?window.location.href=n.url:d.toast("Erreur de connexion","error")}catch(n){d.toast(n.message||"Erreur","error")}}async function Ee(e,t,n){const i=t==="google"?"Google Calendar":"Outlook";if(await T("Déconnecter "+i,"Déconnecter "+i+" ?","Déconnecter","danger"))try{await u.delete(`/api/calendar/connections/${e}`),d.toast("Calendrier déconnecté","success"),n&&W(n)}catch(o){d.toast(o.message||"Erreur","error")}}async function Ce(e){try{d.toast("Synchronisation en cours...","info");const t=await u.post(`/api/calendar/connections/${e}/sync`);d.toast("Synchro terminée : "+(t.pushed||0)+" poussés, "+(t.pulled||0)+" récupérés","success")}catch(t){d.toast(t.message||"Erreur synchro","error")}}async function Te(e,t){try{const n=await fetch(`/api/calendar/connections?practitioner_id=${t}`,{headers:{Authorization:"Bearer "+u.getToken()}}),i=n.ok?await n.json():{connections:[]};for(const s of i.connections||[])s.provider!=="ical"&&await u.patch("/api/calendar/connections/"+s.id,{sync_direction:e});d.toast("Direction de synchro mise à jour","success")}catch(n){d.toast(n.message||"Erreur","error")}}async function Be(e){try{const t=await fetch("/api/calendar/ical/generate",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+u.getToken()},body:JSON.stringify({practitioner_id:e||null})}),n=await t.json();if(!t.ok)throw new Error(n.error||"Erreur");const i=document.getElementById("p_ical_url");if(!i)return;i.style.display="block",i.innerHTML=`
      <div style="padding:10px 12px;background:var(--white);border:1px solid var(--border-light);border-radius:6px">
        <div style="font-family:monospace;font-size:.68rem;word-break:break-all;user-select:all;cursor:text;color:var(--text-2);margin-bottom:6px">${n.ical_url}</div>
        <div style="display:flex;gap:6px">
          <button onclick="navigator.clipboard.writeText('${n.ical_url}');GendaUI.toast('URL copiée !','success')" class="btn-outline btn-sm" style="font-size:.7rem;padding:3px 10px">${w.clipboard} Copier</button>
          <a href="${n.webcal_url}" class="btn-outline btn-sm" style="font-size:.7rem;padding:3px 10px;text-decoration:none;color:var(--primary)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg> Ouvrir</a>
        </div>
      </div>`}catch(t){d.toast(t.message||"Erreur","error")}}(function(){const e=new URLSearchParams(location.search);if(e.get("cal_connected")){const t=e.get("cal_connected")==="google"?"Google Calendar":"Outlook";setTimeout(function(){d.toast(t+" connecté avec succès !","success")},500),history.replaceState(null,"","/dashboard"),setTimeout(function(){document.querySelectorAll(".ni").forEach(function(i){i.classList.remove("active")});var n=document.querySelector('[data-section="team"]');n&&n.classList.add("active"),document.getElementById("pageTitle").textContent="Équipe",window.loadTeam&&window.loadTeam()},600)}e.get("cal_error")&&(setTimeout(function(){d.toast("Erreur calendrier: "+e.get("cal_error"),"error")},500),history.replaceState(null,"","/dashboard"))})();ee({loadTeam:$,openPractModal:ae,savePract:ue,deactivatePract:Z,reactivatePract:fe,confirmDeactivatePract:ye,openPracTasks:K,togglePracTodo:be,closeTasksModal:O,openInviteModal:xe,generateTempPwd:Q,sendInvite:_e,closeInviteModal:H,openRoleModal:ke,saveRole:$e,closeRoleModal:R,pPhotoPreview:ge,pRemovePhoto:he,closeTeamModal:E,teamSwitchTab:oe,teamLoadLeave:Y,teamLoadSchedule:J,teamAddSlot:ce,teamConfirmAddSlot:de,teamRemoveSlot:ve,teamEditSlot:me,teamConfirmEditSlot:pe,teamToggleService:se,teamToggleCatServices:re,teamToggleAllServices:le,loadPracCalSync:W,connectCalendar:we,disconnectCalendar:Ee,syncCalendar:Ce,updateCalSyncDirection:Te,generateIcalFeed:Be});export{H as closeInviteModal,R as closeRoleModal,O as closeTasksModal,E as closeTeamModal,ye as confirmDeactivatePract,we as connectCalendar,Z as deactivatePract,Ee as disconnectCalendar,Be as generateIcalFeed,W as loadPracCalSync,$ as loadTeam,xe as openInviteModal,K as openPracTasks,ae as openPractModal,ke as openRoleModal,ge as pPhotoPreview,he as pRemovePhoto,fe as reactivatePract,ue as savePract,$e as saveRole,_e as sendInvite,Ce as syncCalendar,ce as teamAddSlot,de as teamConfirmAddSlot,pe as teamConfirmEditSlot,me as teamEditSlot,Y as teamLoadLeave,J as teamLoadSchedule,ve as teamRemoveSlot,oe as teamSwitchTab,le as teamToggleAllServices,re as teamToggleCatServices,se as teamToggleService,be as togglePracTodo,Te as updateCalSyncDirection};
