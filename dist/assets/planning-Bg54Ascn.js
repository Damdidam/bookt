import{a as T,e as y,o as fe,d as ye,m as j,G as S,n as ce,s as te,k as se}from"./dashboard-C9VkzWxo.js";import{trapFocus as de}from"./focus-trap-C-UMhpsq.js";import{s as ne}from"./safe-color-VJ6iuWB-.js";import{I as _}from"./icons-C4WsiP-A.js";const he=["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"],pe=["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"],K={conge:"C",maladie:"M",formation:"F",autre:"A"},N={conge:"Congé",maladie:"Maladie",formation:"Formation",autre:"Indispo"},F={full:"Journée",am:"Matin",pm:"Après-midi"},be='fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"',P=e=>`<svg class="gi" viewBox="0 0 24 24" ${be}>${e}</svg>`,c={sun:_.sun,calendar:_.calendar,plus:_.plus,close:_.x,alertTriangle:_.alertTriangle,checkCircle:_.checkCircle,trash:_.trash,mail:_.mail,clock:_.clock,download:_.download,send:_.send,thermometer:P('<path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/>'),graduationCap:P('<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c0 2 4 3 6 3s6-1 6-3v-5"/>'),pauseCircle:P('<circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/>'),sunrise:P('<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="2" x2="12" y2="9"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="8 6 12 2 16 6"/>'),sunset:P('<path d="M17 18a5 5 0 0 0-10 0"/><line x1="12" y1="9" x2="12" y2="2"/><line x1="4.22" y1="10.22" x2="5.64" y2="11.64"/><line x1="1" y1="18" x2="3" y2="18"/><line x1="21" y1="18" x2="23" y2="18"/><line x1="18.36" y1="11.64" x2="19.78" y2="10.22"/><line x1="23" y1="22" x2="1" y2="22"/><polyline points="16 6 12 10 8 6"/>'),activity:P('<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>'),flag:P('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>')},$e={conge:c.sun,maladie:c.thermometer,formation:c.graduationCap,autre:c.pauseCircle},ue={conge:{bg:"var(--blue-bg)",border:"var(--blue-light)",text:"var(--blue)",grad:"linear-gradient(135deg,var(--blue),#1D4ED8)"},maladie:{bg:"var(--red-bg)",border:"var(--red-bg)",text:"var(--red)",grad:"linear-gradient(135deg,var(--red),#B91C1C)"},formation:{bg:"var(--purple-bg)",border:"var(--purple-light)",text:"var(--purple)",grad:"linear-gradient(135deg,var(--purple),#6D28D9)"},autre:{bg:"var(--surface)",border:"var(--border)",text:"var(--text-2)",grad:"linear-gradient(135deg,var(--text-3),var(--text-2))"}};let x,b,M=[],W=[],L={},X={},me={},Q=[],ae=new Set;function Se(){const e=new Date;x=e.getFullYear(),b=e.getMonth()}function q(){return`${x}-${String(b+1).padStart(2,"0")}`}function Ee(e){return(e.getDay()+6)%7}function U(e,t){const n=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;if(ae.has(n))return!1;const a=me[e];return!a||a.length===0?!0:a.includes(Ee(t))}function oe(e){const t=`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`;return ae.has(t)?!1:M.some(n=>U(n.id,e))}function le(e){const t=Q.find(n=>n.date===e);return t?t.name:null}function xe(e,t){const n=(typeof e.date_from=="string"?e.date_from:new Date(e.date_from).toISOString()).slice(0,10),a=(typeof e.date_to=="string"?e.date_to:new Date(e.date_to).toISOString()).slice(0,10),i=`${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;return n===a||i===n?e.period||"full":i===a&&e.period_end||"full"}async function Ke(){Se();const e=document.getElementById("contentArea");e.innerHTML='<div class="loading"><div class="spinner"></div></div>',await z()}async function z(){const e=document.getElementById("contentArea");try{const[t,n,a]=await Promise.all([fetch("/api/practitioners",{headers:{Authorization:"Bearer "+T.getToken()}}),fetch("/api/planning/absences?month="+q(),{headers:{Authorization:"Bearer "+T.getToken()}}),fetch("/api/planning/stats?month="+q(),{headers:{Authorization:"Bearer "+T.getToken()}})]),i=await t.json(),o=await n.json(),d=await a.json();M=(i.practitioners||[]).filter(s=>s.is_active),W=o.absences||[],X=d,me=o.workingDays||{},Q=o.holidays||[],ae=new Set(Q.map(s=>s.date)),Ae(),e.innerHTML=ke()}catch(t){console.error("Planning load error:",t),e.innerHTML=`<div class="empty" style="color:var(--red)">Erreur de chargement: ${y(t.message)}</div>`}}function Ae(){L={},W.forEach(e=>{L[e.practitioner_id]||(L[e.practitioner_id]={});const t=new Date(e.date_from),n=new Date(e.date_to);for(let a=new Date(t);a<=n;a.setDate(a.getDate()+1))if(a.getFullYear()===x&&a.getMonth()===b){const i=a.getDate();L[e.practitioner_id][i]||(L[e.practitioner_id][i]=[]);const o=xe(e,a);L[e.practitioner_id][i].push({type:e.type,id:e.id,period:o,note:e.note})}})}function ke(){const e=new Date(x,b+1,0).getDate(),t=new Date,a=t.getFullYear()===x&&t.getMonth()===b?t.getDate():-1,i=fe.practitioner||"Praticien";if(M.length===0)return`<div class="empty" style="text-align:center;padding:60px 20px">
      <div style="margin-bottom:16px;opacity:.6">${c.calendar}</div>
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:8px">Aucun membre d'équipe</h3>
      <p style="color:var(--text-4);font-size:.85rem;margin-bottom:20px">Ajoutez des praticiens dans la section Équipe pour utiliser le planning.</p>
      <button class="btn-primary" onclick="document.querySelector('[data-section=team]').click()">Aller à l'équipe</button>
    </div>`;let o="";o+=`<div class="plan-top">
    <div style="display:flex;gap:8px;margin-left:auto">
      <button class="btn-outline btn-sm" onclick="planExportCSV()" style="display:flex;align-items:center;gap:4px">${c.download} Export</button>
      <button class="btn-outline btn-sm" onclick="planOpenSendModal()" style="display:flex;align-items:center;gap:4px">${c.send} Envoyer</button>
      <button class="btn-primary btn-sm" onclick="planOpenModal()">${c.plus} Nouvelle absence</button>
    </div>
  </div>`,o+=`<div class="plan-month-nav">
    <button class="plan-month-btn" onclick="planPrevMonth()">‹</button>
    <h2>${pe[b]} ${x}</h2>
    <button class="plan-month-btn" onclick="planNextMonth()">›</button>
    <button class="plan-today-btn" onclick="planGoToday()">Aujourd'hui</button>
  </div>`;const d=X.totals||{};o+=`<div class="plan-stats">
    <div class="plan-stat s-conge">${c.sun}<span>C</span><span class="ps-val">${C(d.conge||0)}</span></div>
    <div class="plan-stat s-maladie">${c.thermometer}<span>M</span><span class="ps-val">${C(d.maladie||0)}</span></div>
    <div class="plan-stat s-formation">${c.graduationCap}<span>F</span><span class="ps-val">${C(d.formation||0)}</span></div>
    <div class="plan-stat s-autre">${c.pauseCircle}<span>A</span><span class="ps-val">${C(d.autre||0)}</span></div>
    <div class="plan-stat s-total">${c.activity}<span>Total</span><span class="ps-val">${C(d.total||0)}</span></div>
  </div>`,o+='<div class="plan-grid-wrap"><div class="plan-grid"><table class="plan-table"><thead><tr>',o+=`<th class="plan-prac-col">${y(i)}</th>`;for(let l=1;l<=e;l++){const p=new Date(x,b,l),g=p.getDay(),u=oe(p),r=`${x}-${String(b+1).padStart(2,"0")}-${String(l).padStart(2,"0")}`,m=le(r),v=l===a;let h="";v?h="plan-today":m?h="plan-holiday":u||(h="plan-closed-day");const B=m?` title="${y(m)}"`:"";o+=`<th class="${h}"${B}>${he[g]}<br>${l}${m?'<span class="plan-holiday-dot"></span>':""}</th>`}o+="</tr></thead><tbody>";const s=X.stats||{};M.forEach(l=>{const p=(l.display_name||"??").split(" ").map(v=>v[0]).join("").toUpperCase().slice(0,2),g=l.color||"var(--blue)",u=L[l.id]||{},r=s[l.id];let m="";if(r){const v=[];r.conge>0&&v.push(`<span class="plan-prac-cnt c-conge">C${C(r.conge)}</span>`),r.maladie>0&&v.push(`<span class="plan-prac-cnt c-maladie">M${C(r.maladie)}</span>`),r.formation>0&&v.push(`<span class="plan-prac-cnt c-formation">F${C(r.formation)}</span>`),r.autre>0&&v.push(`<span class="plan-prac-cnt c-autre">A${C(r.autre)}</span>`),v.length&&(m=`<div class="plan-prac-counters">${v.join("")}</div>`)}o+=`<tr class="plan-prac-row"><td>
      <div class="plan-prac-cell">
        <div class="plan-prac-av" style="background:${ne(g)}">${p}</div>
        <div class="plan-prac-details">
          <div class="plan-prac-nm">${y(l.display_name)}</div>
          ${m}
        </div>
      </div>
    </td>`;for(let v=1;v<=e;v++){const h=new Date(x,b,v),B=v===a,A=`${x}-${String(b+1).padStart(2,"0")}-${String(v).padStart(2,"0")}`,I=le(A),Y=U(l.id,h);let O="plan-day-cell";B&&(O+=" plan-today"),I?O+=" plan-holiday":Y||(O+=" plan-off-day");let k="";const E=u[v]||[];if(I)k=`<span class="plan-holiday-marker" title="${y(I)}">${c.flag}</span>`;else if(!Y)k='<span class="plan-avail-marker">—</span>';else if(E.length===0)k="";else if(E.length===1&&E[0].period==="full"){const $=E[0],f=K[$.type]||"A";k=`<div class="plan-abs-block ${$.type}" title="${y(N[$.type])}${$.note?": "+y($.note):""}" onclick="planAbsClick(event,'${l.id}','${A}','${$.id}')">${f}</div>`}else{const $=E.find(D=>D.period==="am"||D.period==="full"),f=E.find(D=>D.period==="pm"||D.period==="full"&&D!==$);k='<div class="plan-split">',$?k+=`<div class="plan-split-am"><div class="plan-abs-block ${$.type}" style="margin:1px 2px;font-size:.55rem" title="Matin: ${y(N[$.type])}" onclick="planAbsClick(event,'${l.id}','${A}','${$.id}')">${K[$.type]}</div></div>`:k+='<div class="plan-split-am"></div>',f?k+=`<div class="plan-split-pm"><div class="plan-abs-block ${f.type}" style="margin:1px 2px;font-size:.55rem" title="Après-midi: ${y(N[f.type])}" onclick="planAbsClick(event,'${l.id}','${A}','${f.id}')">${K[f.type]}</div></div>`:k+='<div class="plan-split-pm"></div>',k+="</div>"}o+=`<td class="${O}" onclick="planOpenModal('${l.id}','${A}')">${k}</td>`}o+="</tr>"}),o+='<tr class="plan-summary-row"><td style="text-align:left;padding-left:16px;font-size:.72rem">Effectif</td>';for(let l=1;l<=e;l++){const p=new Date(x,b,l);if(!oe(p))o+="<td>—</td>";else{let u=0;M.forEach(v=>{if(!U(v.id,p))return;((L[v.id]||{})[l]||[]).some(A=>A.period==="full")||u++});const r=M.filter(v=>U(v.id,p)).length,m=u>=Math.ceil(r*.7)?"count-good":u>=Math.ceil(r*.4)?"count-warn":"count-bad";o+=`<td class="${m}">${u}</td>`}}return o+="</tr></tbody></table></div></div>",o}function C(e){return e===0?"0":Number.isInteger(e)?String(e):e.toFixed(1).replace(".0","")}function Te(){b--,b<0&&(b=11,x--),z()}function _e(){b++,b>11&&(b=0,x++),z()}function we(){const e=new Date;x=e.getFullYear(),b=e.getMonth(),z()}async function Me(){try{const e=await fetch("/api/planning/export?month="+q()+"&format=csv",{headers:{Authorization:"Bearer "+T.getToken()}});if(!e.ok)throw new Error("Erreur export");const t=await e.blob(),n=URL.createObjectURL(t),a=document.createElement("a");a.href=n,a.download=e.headers.get("Content-Disposition")?.match(/filename="?([^"]+)"?/)?.[1]||`planning-${q()}.csv`,document.body.appendChild(a),a.click(),a.remove(),URL.revokeObjectURL(n)}catch{S.toast("Erreur lors de l'export","error")}}function Be(){j("planSendOverlay");const e=M.map(n=>`<option value="${n.id}">${y(n.display_name)}${n.email?"":" (pas d'email)"}</option>`).join(""),t=document.createElement("div");t.id="planSendOverlay",t.className="m-overlay open",t.innerHTML=`
    <div class="m-dialog m-sm">
      <div class="m-header-simple">
        <h3>Envoyer le planning</h3>
        <button class="m-close" onclick="closeModal('planSendOverlay')" aria-label="Fermer">${c.close}</button>
      </div>
      <div class="m-body">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Praticien</span><span class="m-sec-line"></span></div>
          <select id="planSendPrac" class="m-input">${e}</select>
        </div>
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Mois</span><span class="m-sec-line"></span></div>
          <input type="month" id="planSendMonth" class="m-input" value="${q()}">
        </div>
      </div>
      <div class="m-bottom">
        <div style="flex:1"></div>
        <button class="m-btn m-btn-ghost" onclick="closeModal('planSendOverlay')">Annuler</button>
        <button class="m-btn m-btn-primary" id="planSendBtn" onclick="planDoSendPlanning()" style="display:flex;align-items:center;gap:4px">${c.send} Envoyer</button>
      </div>
    </div>`,document.body.appendChild(t),ce(t,{noBackdropClose:!0}),de(t,()=>j(t.id))}async function Ce(){const e=document.getElementById("planSendBtn");if(!e)return;e.disabled=!0,e.innerHTML=`${c.send} Envoi...`;const t=document.getElementById("planSendPrac")?.value,n=document.getElementById("planSendMonth")?.value;try{const a=await fetch("/api/planning/send-planning",{method:"POST",headers:{Authorization:"Bearer "+T.getToken(),"Content-Type":"application/json"},body:JSON.stringify({practitioner_id:t,month:n})}),i=await a.json();a.ok?(e.innerHTML=`${c.checkCircle} Envoyé`,setTimeout(()=>{j("planSendOverlay")},1500)):(S.toast(i.error||"Erreur d'envoi","error"),e.disabled=!1,e.innerHTML=`${c.send} Envoyer`)}catch(a){S.toast("Erreur: "+a.message,"error"),e.disabled=!1,e.innerHTML=`${c.send} Envoyer`}}let w=null;function ee(e,t,n){j("planAbsOverlay"),w=n||null;const a=!!n,i=new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Brussels"}),o=t||i,d=t||i;let s=null;a&&(s=W.find(f=>f.id===n));const l=s?.type||"conge",p=s?.period||"full",g=s?.period_end||"full",u=ue[l],r=s&&s.date_from?.slice?.(0,10)||o,m=s&&s.date_to?.slice?.(0,10)||d,v=r!==m;let h=M.map(f=>`<option value="${f.id}" ${s?.practitioner_id===f.id||f.id===e?"selected":""}>${y(f.display_name)}</option>`).join("");const B=s?.practitioner_id||e||M[0]?.id,A=M.find(f=>f.id===B),I=A?(A.display_name||"??").split(" ").map(f=>f[0]).join("").toUpperCase().slice(0,2):"?",Y=A?.color||"var(--blue)",O=p,k=v?g:p,E=document.createElement("div");E.id="planAbsOverlay",E.className="m-overlay open";const $=(f,D)=>["full","am","pm"].map(G=>`<div class="plan-seg-pill${D===G?" active":""}" data-seg="${G}" onclick="planPickSeg('${f}',this)">${F[G]}</div>`).join("");E.innerHTML=`
    <div class="m-dialog m-flex m-lg">

      <!-- Header -->
      <div class="m-header">
        <div class="m-header-bg" id="planModalHeaderBg" style="background:${u.grad}"></div>
        <button class="m-close" onclick="planCloseModal()" aria-label="Fermer">${c.close}</button>
        <div class="m-header-content">
          <div class="m-client-hero">
            <div class="m-avatar" style="background:${ne(Y)}">${I}</div>
            <div class="m-client-info">
              <div class="m-client-name" id="planModalTitle">${a?y(s?.practitioner_name||""):"Nouvelle absence"}</div>
              <div class="m-client-meta"><span id="planModalSubtitle">Planifiez une absence</span></div>
            </div>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="m-tabs">
        <div class="m-tab active" data-tab="details" onclick="planSwitchTab('details')">Détails</div>
        ${a?`<div class="m-tab" data-tab="log" onclick="planSwitchTab('log')">Historique</div>`:""}
      </div>

      <!-- Body -->
      <div class="m-body" style="padding:20px 24px;overflow-y:auto;flex:1;min-height:0">

        <div class="m-panel active" id="planPanelDetails">
          <div class="plan-abs-grid">

            <!-- LEFT column: Form -->
            <div class="plan-abs-form">

              <!-- Type -->
              <div class="m-sec">
                <div class="m-sec-head"><span class="m-sec-title">Type</span><span class="m-sec-line"></span></div>
                <div class="plan-type-pills" id="planTypePills">
                  ${["conge","maladie","formation","autre"].map(f=>`
                    <div class="plan-type-pill${l===f?" active-"+f:""}" data-type="${f}" onclick="planPickType(this)">
                      ${$e[f]} ${N[f]}
                    </div>`).join("")}
                </div>
              </div>

              <!-- Practitioner -->
              <div class="m-sec">
                <div class="m-sec-head"><span class="m-sec-title">Praticien</span><span class="m-sec-line"></span></div>
                <select id="planAbsPrac" class="m-input" ${a?"disabled":""} onchange="planUpdateHeader();planCheckImpact()">${h}</select>
              </div>

              <!-- Shortcuts -->
              <div class="m-sec">
                <div class="m-sec-head"><span class="m-sec-title">Raccourcis</span><span class="m-sec-line"></span></div>
                <div class="plan-shortcut-chips">
                  <button class="plan-shortcut-chip" onclick="planApplyShortcut('half')">½ journée</button>
                  <button class="plan-shortcut-chip" onclick="planApplyShortcut('full')">1 jour</button>
                  <button class="plan-shortcut-chip" onclick="planApplyShortcut('multi')">Plusieurs jours</button>
                </div>
              </div>

              <!-- Début -->
              <div class="plan-seg-block">
                <div class="m-field-label">Début</div>
                <input type="date" id="planAbsFrom" class="m-input" value="${r}" onchange="planOnDatesChange()">
                <div class="plan-seg-pills" id="planSegStart">${$("start",O)}</div>
              </div>

              <!-- Fin -->
              <div class="plan-seg-block" id="planEndBlock" style="${v?"":"display:none"}">
                <div class="m-field-label">Fin</div>
                <input type="date" id="planAbsTo" class="m-input" value="${m}" onchange="planOnDatesChange()">
                <div class="plan-seg-pills" id="planSegEnd">${$("end",k)}</div>
              </div>

              <!-- Hidden To sync for single day -->
              

              <!-- Date error -->
              <div class="plan-date-error" id="planDateError">La date de fin doit être après la date de début</div>

              <!-- Note -->
              <div class="m-sec" style="margin-top:4px">
                <div class="m-sec-head"><span class="m-sec-title">Note <span style="font-weight:400;color:var(--text-4)">(optionnel)</span></span><span class="m-sec-line"></span></div>
                <textarea id="planAbsNote" class="m-input" rows="2" placeholder="Vacances, formation coloration...">${y(s?.note||"")}</textarea>
              </div>
            </div>

            <!-- RIGHT column: Impact -->
            <div class="plan-abs-impact">
              <div class="plan-impact-card" id="planImpactZone">
                <h4>Impact</h4>
                <div style="text-align:center;padding:12px;color:var(--text-4);font-size:.75rem">
                  <div class="spinner" style="margin:0 auto 8px;width:18px;height:18px"></div>
                  Analyse en cours…
                </div>
              </div>
            </div>

          </div>
        </div>

        <!-- Log panel -->
        <div class="m-panel" id="planPanelLog">
          <div id="planLogContent" style="min-height:100px">
            <div class="loading" style="padding:20px"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Bottom bar -->
      <div class="m-bottom">
        ${a?`<button class="m-btn m-btn-danger" onclick="planDeleteAbsence('${n}')" style="display:flex;align-items:center;gap:4px">${c.trash} Supprimer</button>`:""}
        ${a&&s?.practitioner_email?`<button class="m-btn m-btn-ghost" onclick="planNotifyPractitioner('${n}')" style="display:flex;align-items:center;gap:4px">${c.mail} Notifier</button>`:""}
        <div style="flex:1"></div>
        <button class="m-btn m-btn-ghost" onclick="planCloseModal()">Annuler</button>
        <button class="m-btn m-btn-primary" id="planAbsSaveBtn" onclick="planSaveAbsence()">Enregistrer l'absence</button>
      </div>
    </div>`,document.body.appendChild(E),ce(E,{noBackdropClose:!0}),de(E,()=>j(E.id)),Z(),(e||s)&&setTimeout(R,100)}function ie(){j("planAbsOverlay"),w=null}function ve(){const e=document.getElementById("planAbsFrom")?.value,t=document.getElementById("planAbsTo")?.value,n=document.getElementById("planEndBlock"),a=document.getElementById("planDateError"),i=document.getElementById("planAbsSaveBtn"),o=e&&t&&e!==t;if(n&&(n.style.display=o?"":"none"),!o&&e){const d=document.getElementById("planAbsTo");d&&(d.value=e)}e&&t&&t<e?(a&&a.classList.add("show"),i&&(i.disabled=!0)):(a&&a.classList.remove("show"),i&&(i.disabled=!1)),Z(),R()}function De(e){document.querySelectorAll("#planAbsOverlay .m-tab").forEach(t=>t.classList.toggle("active",t.dataset.tab===e)),document.querySelectorAll("#planAbsOverlay .m-panel").forEach(t=>t.classList.remove("active")),document.getElementById(e==="details"?"planPanelDetails":"planPanelLog")?.classList.add("active"),e==="log"&&w&&ge(w)}function Le(e){document.querySelectorAll("#planTypePills .plan-type-pill").forEach(n=>n.className="plan-type-pill"),e.className="plan-type-pill active-"+e.dataset.type;const t=document.getElementById("planModalHeaderBg");t&&(t.style.background=ue[e.dataset.type].grad),Z()}function Ie(e,t){const n=document.getElementById(e==="start"?"planSegStart":"planSegEnd");if(!n)return;n.querySelectorAll(".plan-seg-pill").forEach(o=>o.classList.remove("active")),t.classList.add("active");const a=document.getElementById("planAbsFrom")?.value,i=document.getElementById("planAbsTo")?.value;if(e==="start"&&(!i||a===i)){const o=document.getElementById("planSegEnd");if(o){o.querySelectorAll(".plan-seg-pill").forEach(s=>s.classList.remove("active"));const d=o.querySelector(`.plan-seg-pill[data-seg="${t.dataset.seg}"]`);d&&d.classList.add("active")}}Z(),R()}function Pe(e){const t=new Date().toLocaleDateString("en-CA",{timeZone:"Europe/Brussels"}),n=new Date(Date.now()+864e5).toLocaleDateString("en-CA",{timeZone:"Europe/Brussels"}),a=document.getElementById("planAbsFrom"),i=document.getElementById("planAbsTo");!a||!i||(e==="half"?(a.value=t,i.value=t,H("planSegStart","am"),H("planSegEnd","am")):e==="full"?(a.value=t,i.value=t,H("planSegStart","full"),H("planSegEnd","full")):e==="multi"&&(a.value=t,i.value=n,H("planSegStart","full"),H("planSegEnd","full")),ve())}function H(e,t){const n=document.getElementById(e);if(!n)return;n.querySelectorAll(".plan-seg-pill").forEach(i=>i.classList.remove("active"));const a=n.querySelector(`.plan-seg-pill[data-seg="${t}"]`);a&&a.classList.add("active")}function Oe(){const e=document.getElementById("planAbsPrac")?.value,t=M.find(i=>i.id===e);if(!t||w)return;const n=document.getElementById("planModalTitle");n&&(n.textContent=t.display_name);const a=document.querySelector("#planAbsOverlay .m-avatar");a&&(a.style.background=t.color||"var(--blue)",a.textContent=(t.display_name||"??").split(" ").map(i=>i[0]).join("").toUpperCase().slice(0,2))}function Z(){const e=document.getElementById("planModalSubtitle");if(!e)return;const t=document.getElementById("planAbsFrom")?.value,n=document.getElementById("planAbsTo")?.value;if(!t){e.textContent="Planifiez une absence";return}const{period:a,period_end:i}=J(),o=l=>{const p=new Date(l+"T12:00:00");return`${p.getDate()} ${pe[p.getMonth()].toLowerCase()}`},d=!n||t===n,s=l=>l==="am"?"matin":l==="pm"?"après-midi":"journée";if(d){const l=a==="full"?"1 jour":"½ jour";e.textContent=`Le ${o(t)} · ${s(a)} · ${l}`}else{const l=new Date(t+"T12:00:00"),p=new Date(n+"T12:00:00");let g=0;const u=new Date(l);for(;u<=p;)u.getDay()!==0&&g++,u.setDate(u.getDate()+1);(a==="am"||a==="pm")&&(g-=.5),(i==="am"||i==="pm")&&(g-=.5);const r=g%1===0?`${g} jour${g>1?"s":""}`:`${g.toFixed(1).replace(".",",")} jours`,m=a!=="full"?` (${s(a)})`:"",v=i!=="full"?` (${s(i)})`:"";e.textContent=`Du ${o(t)}${m} → ${o(n)}${v} · ${r}`}}function He(){return document.querySelector('#planTypePills .plan-type-pill[class*="active-"]')?.dataset.type||"conge"}function J(){const e=document.querySelector("#planSegStart .plan-seg-pill.active"),t=document.querySelector("#planSegEnd .plan-seg-pill.active"),n=e?.dataset.seg||"full",a=t?.dataset.seg||"full",i=document.getElementById("planAbsFrom")?.value,o=document.getElementById("planAbsTo")?.value;return!o||i===o?{period:n,period_end:n}:{period:n,period_end:a}}function Ne(e,t,n,a){e.stopPropagation();const i=W.find(u=>String(u.id)===String(a));if(!i){ee(null,n,a);return}const o=(typeof i.date_from=="string"?i.date_from:new Date(i.date_from).toISOString()).slice(0,10),d=(typeof i.date_to=="string"?i.date_to:new Date(i.date_to).toISOString()).slice(0,10);if(o===d){ee(null,n,a);return}document.getElementById("planCtxMenu")?.remove();const s=document.createElement("div");s.id="planCtxMenu",s.className="plan-ctx-menu";let l=e.clientX,p=e.clientY;s.innerHTML=`
    <div class="plan-ctx-item" onclick="document.getElementById('planCtxMenu').remove();planOpenModal(null,'${n}','${a}')">
      ${c.calendar}<span>Modifier l'absence entière</span>
    </div>
    <div class="plan-ctx-item" onclick="document.getElementById('planCtxMenu').remove();planOpenModal('${t}','${n}')">
      ${c.plus}<span>Changer ce jour uniquement</span>
    </div>
  `,document.body.appendChild(s);const g=s.getBoundingClientRect();l+g.width>window.innerWidth&&(l=window.innerWidth-g.width-8),p+g.height>window.innerHeight&&(p=window.innerHeight-g.height-8),l<4&&(l=4),p<4&&(p=4),s.style.cssText=`position:fixed;left:${l}px;top:${p}px;z-index:99999`,setTimeout(()=>{const u=r=>{s.contains(r.target)||(s.remove(),document.removeEventListener("pointerdown",u,!0))};document.addEventListener("pointerdown",u,!0)},0)}let re=null,V=0;async function R(){clearTimeout(re),re=setTimeout(je,250)}async function je(){const e=document.getElementById("planImpactZone");if(!e)return;const t=document.getElementById("planAbsPrac")?.value,n=document.getElementById("planAbsFrom")?.value,a=document.getElementById("planAbsTo")?.value||n;if(!t||!n)return;const i=++V;e.innerHTML='<h4>Impact</h4><div style="text-align:center;padding:12px;color:var(--text-4);font-size:.75rem"><div class="spinner" style="margin:0 auto 8px;width:18px;height:18px"></div>Analyse…</div>';try{const{period:o,period_end:d}=J(),s=await fetch(`/api/planning/impact?practitioner_id=${t}&date_from=${n}&date_to=${a}&period=${o}&period_end=${d}`,{headers:{Authorization:"Bearer "+T.getToken()}});if(i!==V)return;const l=await s.json(),p=l.count||0,g=l.impacted_bookings||[],u=l.coverage||"ok",r=l.uncovered_services||[];let m="<h4>Impact</h4>";p>0?(m+=`<div class="plan-impact-row">
        <span class="plan-impact-count">${c.alertTriangle} ${p} RDV impacté${p>1?"s":""}</span>
        <button class="plan-impact-btn" onclick="planToggleImpactList()">Voir</button>
      </div>`,m+='<div class="plan-impact-list" id="planImpactList">',g.forEach(h=>{const B=new Date(h.start_at),A=B.toLocaleDateString("fr-BE",{day:"numeric",month:"short",timeZone:"Europe/Brussels"}),I=B.toLocaleTimeString("fr-BE",{timeZone:"Europe/Brussels",hour:"2-digit",minute:"2-digit"});m+=`<div class="plan-impact-item" data-bk="${y(h.id)}">
          <div><strong>${y(h.client_name||"Client")}</strong> · ${y(h.service_name||"")} · ${A} à ${I}</div>
          <div class="plan-alt-zone" id="planAlt_${h.id}" style="margin-top:4px"></div>
        </div>`}),m+="</div>",g.some(h=>h.client_email||h.client_phone)&&(m+=`<div style="margin-top:10px">
          <button class="plan-impact-btn" id="planNotifyClientsBtn" onclick="planNotifyClients()" style="width:100%;justify-content:center;gap:6px;padding:7px 12px">
            ${c.send} Prévenir les clients
          </button>
        </div>`)):m+=`<div class="plan-impact-row"><span>${c.checkCircle} Aucun RDV impacté</span></div>`,u==="ok"?m+=`<div style="margin-top:10px"><span class="plan-coverage-badge ok">${c.checkCircle} Couverture OK</span></div>`:(m+=`<div style="margin-top:10px"><span class="plan-coverage-badge at-risk">${c.alertTriangle} À risque</span></div>`,r.length&&(m+=`<div class="plan-coverage-detail">Plus de couverture pour : ${r.map(v=>y(v)).join(", ")}</div>`)),e.innerHTML=m,p>0&&ze(i,t,n,a,o,d)}catch{if(i!==V)return;e.innerHTML='<h4>Impact</h4><div style="padding:8px;font-size:.75rem;color:var(--text-4)">Impossible de charger</div>'}}async function ze(e,t,n,a,i,o){try{const d=await fetch(`/api/planning/impact?practitioner_id=${t}&date_from=${n}&date_to=${a}&period=${i}&period_end=${o}&with_alternatives=1`,{headers:{Authorization:"Bearer "+T.getToken()}});if(e!==V)return;const l=(await d.json()).impacted_bookings||[];for(const p of l){const g=document.getElementById(`planAlt_${p.id}`);if(!g)continue;const u=p.alternatives||[];u.length===0?g.innerHTML='<span style="font-size:.7rem;color:var(--text-4);font-style:italic">Aucun praticien disponible</span>':g.innerHTML='<span style="font-size:.7rem;color:var(--text-4)">Assigner à :</span> '+u.map(r=>`<button class="plan-alt-chip" style="--ac:${ne(r.color,"var(--text-3)")}" onclick="planReassign('${se(p.id)}','${se(r.practitioner_id)}')">${y(r.display_name)}</button>`).join(" ")}}catch(d){console.warn("[PLAN] Alternatives fetch error:",d.message)}}async function Fe(e,t){if(!await te("Réassigner ce RDV à ce praticien ? Le client sera notifié par email."))return;const n=document.getElementById(`planAlt_${e}`);n&&(n.querySelectorAll("button").forEach(a=>a.disabled=!0),n.insertAdjacentHTML("beforeend",' <span class="spinner" style="width:14px;height:14px;display:inline-block;vertical-align:middle"></span>'));try{const a=await fetch("/api/planning/reassign",{method:"POST",headers:{Authorization:"Bearer "+T.getToken(),"Content-Type":"application/json"},body:JSON.stringify({booking_id:e,new_practitioner_id:t})}),i=await a.json();if(a.ok&&i.reassigned)S.toast(`RDV réassigné à ${i.new_practitioner}`,"success"),R();else{S.toast(i.error||"Erreur de réassignation","error"),n&&n.querySelectorAll("button").forEach(d=>d.disabled=!1);const o=n?.querySelector(".spinner");o&&o.remove()}}catch(a){S.toast("Erreur: "+a.message,"error"),n&&n.querySelectorAll("button").forEach(o=>o.disabled=!1);const i=n?.querySelector(".spinner");i&&i.remove()}}function qe(){const e=document.getElementById("planImpactList");e&&e.classList.toggle("open")}async function Re(){const e=document.getElementById("planNotifyClientsBtn");if(!e||!await te("Envoyer un email/SMS aux clients impactés pour les prévenir ?"))return;e.disabled=!0,e.innerHTML=`${c.send} Envoi en cours...`;const t=document.getElementById("planAbsPrac")?.value,n=document.getElementById("planAbsFrom")?.value,a=document.getElementById("planAbsTo")?.value||n,{period:i,period_end:o}=J();try{const d=await fetch("/api/planning/notify-impacted",{method:"POST",headers:{Authorization:"Bearer "+T.getToken(),"Content-Type":"application/json"},body:JSON.stringify({practitioner_id:t,date_from:n,date_to:a,period:i,period_end:o})}),s=await d.json();if(d.ok){const l=[];s.sent_email>0&&l.push(`${s.sent_email} email${s.sent_email>1?"s":""}`),s.sent_sms>0&&l.push(`${s.sent_sms} SMS`);const p=l.length>0?l.join(" + ")+" envoyé"+(s.sent_email+s.sent_sms>1?"s":""):"Aucun contact trouvé";e.innerHTML=`${c.checkCircle} ${p}`,S.toast(p,"success"),setTimeout(()=>{e.innerHTML=`${c.send} Prévenir les clients`,e.disabled=!1},5e3)}else e.innerHTML=`${c.send} Prévenir les clients`,e.disabled=!1,S.toast(s.error||"Erreur d'envoi","error")}catch(d){e.innerHTML=`${c.send} Prévenir les clients`,e.disabled=!1,S.toast("Erreur: "+d.message,"error")}}async function Ye(){const e=document.getElementById("planAbsSaveBtn");if(!e)return;e.disabled=!0,e.textContent="Enregistrement...";const t=document.getElementById("planAbsPrac")?.value,n=document.getElementById("planAbsFrom")?.value,a=document.getElementById("planAbsTo")?.value||n,i=document.getElementById("planAbsNote")?.value,o=He(),{period:d,period_end:s}=J();if(!t||!n){e.disabled=!1,e.textContent="Enregistrer l'absence";return}if(a<n){e.disabled=!1,e.textContent="Enregistrer l'absence";return}try{const l=w?`/api/planning/absences/${w}`:"/api/planning/absences",p=w?"PATCH":"POST",g=w?{date_from:n,date_to:a,type:o,note:i,period:d,period_end:s}:{practitioner_id:t,date_from:n,date_to:a,type:o,note:i,period:d,period_end:s},u=await fetch(l,{method:p,headers:{Authorization:"Bearer "+T.getToken(),"Content-Type":"application/json"},body:JSON.stringify(g)}),r=await u.json();if(!u.ok){S.toast(r.error||"Erreur","error"),e.disabled=!1,e.textContent="Enregistrer l'absence";return}w=null,ie(),await z()}catch(l){S.toast("Erreur: "+l.message,"error"),e.disabled=!1,e.textContent="Enregistrer l'absence"}}async function Ue(e){if(await te("Supprimer cette absence ?"))try{const t=await fetch(`/api/planning/absences/${e}`,{method:"DELETE",headers:{Authorization:"Bearer "+T.getToken()}});if(!t.ok){const n=await t.json();S.toast(n.error||"Erreur","error");return}w=null,ie(),await z()}catch(t){S.toast("Erreur: "+t.message,"error")}}async function Ve(e){const t=document.querySelector('#planAbsOverlay .m-btn-ghost[onclick*="planNotifyPractitioner"]');t&&(t.disabled=!0,t.innerHTML=`${c.mail} Envoi...`);try{const n=await fetch(`/api/planning/absences/${e}/notify`,{method:"POST",headers:{Authorization:"Bearer "+T.getToken()}}),a=await n.json();n.ok?(t&&(t.innerHTML=`${c.checkCircle} Envoyé`),setTimeout(()=>{t&&(t.innerHTML=`${c.mail} Notifier`,t.disabled=!1)},3e3)):(S.toast(a.error||"Erreur d'envoi","error"),t&&(t.innerHTML=`${c.mail} Notifier`,t.disabled=!1))}catch(n){S.toast("Erreur: "+n.message,"error"),t&&(t.innerHTML=`${c.mail} Notifier`,t.disabled=!1)}}async function ge(e){const t=document.getElementById("planLogContent");if(t)try{const i=(await(await fetch(`/api/planning/absences/${e}/logs`,{headers:{Authorization:"Bearer "+T.getToken()}})).json()).logs||[];if(i.length===0){t.innerHTML=`<div style="text-align:center;padding:30px;color:var(--text-4)"><div style="margin-bottom:8px;opacity:.5">${c.clock}</div><p style="font-size:.82rem">Aucune activité enregistrée</p></div>`;return}const o={created:"Absence créée",modified:"Absence modifiée",cancelled:"Absence annulée",email_sent:"Notification envoyée"};let d="";i.forEach(s=>{const l=new Date(s.created_at),p=l.toLocaleDateString("fr-BE",{day:"numeric",month:"short",year:"numeric",timeZone:"Europe/Brussels"}),g=l.toLocaleTimeString("fr-BE",{timeZone:"Europe/Brussels",hour:"2-digit",minute:"2-digit"});let u="";if(s.action==="modified"&&s.details?.changes){const r=s.details.changes,m=[];r.type&&m.push(`Type: ${N[r.type.from]||r.type.from} → ${N[r.type.to]||r.type.to}`),r.period&&m.push(`Début: ${F[r.period.from]||r.period.from} → ${F[r.period.to]||r.period.to}`),r.period_end&&m.push(`Fin: ${F[r.period_end.from]||r.period_end.from} → ${F[r.period_end.to]||r.period_end.to}`),r.date_from&&m.push("Date début modifiée"),r.date_to&&m.push("Date fin modifiée"),r.note&&m.push("Note modifiée"),u=m.join(" · ")}else s.action==="email_sent"&&s.details?.to&&(u=`→ ${y(s.details.to)}`);d+=`<div class="plan-log-item"><div class="plan-log-dot ${s.action}"></div><div class="plan-log-info"><div class="plan-log-action">${o[s.action]||s.action}</div><div class="plan-log-meta">${p} à ${g}${s.actor_name?" · "+y(s.actor_name):""}</div>${u?`<div class="plan-log-detail">${u}</div>`:""}</div></div>`}),t.innerHTML=d}catch(n){t.innerHTML=`<div style="color:var(--red);font-size:.82rem;padding:20px">Erreur: ${y(n.message)}</div>`}}ye({planPrevMonth:Te,planNextMonth:_e,planGoToday:we,planOpenModal:ee,planCloseModal:ie,planAbsClick:Ne,planPickType:Le,planPickSeg:Ie,planApplyShortcut:Pe,planSwitchTab:De,planOnDatesChange:ve,planSaveAbsence:Ye,planDeleteAbsence:Ue,planNotifyPractitioner:Ve,planNotifyClients:Re,planReassign:Fe,planCheckImpact:R,planUpdateHeader:Oe,planLoadLogs:ge,planToggleImpactList:qe,planExportCSV:Me,planOpenSendModal:Be,planDoSendPlanning:Ce});export{Ke as loadPlanning};
