import{a as s,G as u,d as b}from"./dashboard-CGbAiqXR.js";const r=u.toast.bind(u);function d(t){return String(t||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}const p={google:{label:"Google Calendar",color:"#4285F4",icon:"M21.35 11.1h-9.18v2.73h5.51c-.54 2.56-2.73 3.97-5.51 3.97a6.13 6.13 0 1 1 0-12.26c1.51 0 2.89.55 3.96 1.45l2.04-2.04A9.27 9.27 0 0 0 12.17 2 10 10 0 1 0 22 12.17c0-.57-.07-1.13-.18-1.66l-.47.59Z"},outlook:{label:"Outlook Calendar",color:"#0078D4",icon:"M21 5H3v14h18V5Zm-2 2v3h-3V7h3ZM5 7h3v3H5V7Zm0 5h3v3H5v-3Zm5 5v-3h4v3h-4Zm4-5h-4v-3h4v3Zm2 5v-3h3v3h-3Zm3-5h-3v-3h3v3Z"},ical:{label:"Lien iCal",color:"#6B6560",icon:"M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"}},w={push:"Genda → Calendrier",pull:"Calendrier → Genda",both:"Bidirectionnel"};async function h(){const t=document.getElementById("contentArea");t.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const[o,n]=await Promise.all([fetch("/api/calendar/connections",{headers:{Authorization:"Bearer "+s.getToken()}}),fetch("/api/practitioners",{headers:{Authorization:"Bearer "+s.getToken()}})]),l=(await o.json()).connections||[],a=(await n.json()).practitioners||[];let i='<div style="max-width:640px;margin:0 auto">';if(i+=`<div class="card" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div style="width:40px;height:40px;border-radius:10px;background:var(--primary-light);display:flex;align-items:center;justify-content:center">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M16 14l-4 4-4-4"/></svg>
        </div>
        <div>
          <h3 style="font-size:.95rem;font-weight:700">Synchronisation calendrier</h3>
          <p style="font-size:.78rem;color:var(--text-4)">Connectez Google Calendar, Outlook ou un flux iCal</p>
        </div>
      </div>`,i+=`<div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn-outline" style="display:flex;align-items:center;gap:8px" onclick="calSyncConnect('google')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#4285F4"><path d="${p.google.icon}"/></svg> Google
      </button>
      <button class="btn-outline" style="display:flex;align-items:center;gap:8px" onclick="calSyncConnect('outlook')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#0078D4"><path d="${p.outlook.icon}"/></svg> Outlook
      </button>
      <button class="btn-outline" style="display:flex;align-items:center;gap:8px" onclick="calSyncGenIcal()">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B6560" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${p.ical.icon}"/></svg> iCal
      </button>
    </div>`,a.length>1&&(i+=`<div style="margin-top:12px;font-size:.78rem;color:var(--text-3)">
        <label>Praticien : </label>
        <select id="calSyncPracId" style="font-size:.78rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border)">
          ${a.map(e=>`<option value="${e.id}">${d(e.display_name)}</option>`).join("")}
        </select>
      </div>`),i+="</div>",l.length===0)i+=`<div class="card" style="text-align:center;padding:32px">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/></svg>
        <h4 style="font-size:.88rem;font-weight:600;margin-top:12px;color:var(--text-3)">Aucun calendrier connecté</h4>
        <p style="font-size:.78rem;color:var(--text-4);margin-top:4px">Connectez un calendrier externe pour synchroniser vos rendez-vous.</p>
      </div>`;else{i+='<div class="card"><h3 style="font-size:.88rem;font-weight:700;margin-bottom:12px">Calendriers connectés</h3>';for(const e of l){const c=p[e.provider]||p.ical,g=a.find(f=>f.id===e.practitioner_id)?.display_name||"Tous",v=e.status==="active"?"var(--green)":"var(--red)",x=e.status==="active"?"Connecté":e.status,m=e.last_sync_at?new Date(e.last_sync_at).toLocaleString("fr-BE",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"}):"Jamais";i+=`<div style="padding:14px;border:1px solid var(--border-light);border-radius:12px;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <div style="width:32px;height:32px;border-radius:8px;background:${c.color}15;display:flex;align-items:center;justify-content:center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="${e.provider==="ical"?"none":c.color}" stroke="${e.provider==="ical"?c.color:"none"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${c.icon}"/></svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:.85rem;font-weight:600">${c.label}</div>
              <div style="font-size:.72rem;color:var(--text-4)">${d(e.email||g)}</div>
            </div>
            <span style="font-size:.68rem;font-weight:600;color:${v};background:${v}15;padding:2px 8px;border-radius:6px">${x}</span>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:.75rem">
            <span style="color:var(--text-4)">Praticien: <strong>${d(g)}</strong></span>
            <span style="color:var(--text-4)">Direction: <strong>${w[e.sync_direction]||e.sync_direction||"push"}</strong></span>
            <span style="color:var(--text-4)">Sync: <strong>${m}</strong></span>
          </div>`,e.error_message&&(i+=`<div style="margin-top:8px;padding:8px 10px;background:var(--red)08;border:1px solid var(--red-bg);border-radius:8px;font-size:.72rem;color:var(--red)">${d(e.error_message)}</div>`),e.provider==="ical"&&(i+=`<div style="margin-top:10px">
            <button class="btn-outline" style="font-size:.75rem;padding:6px 12px" onclick="calSyncGenIcal()">Régénérer le lien iCal</button>
          </div>`),i+=`<div style="display:flex;gap:8px;margin-top:10px;border-top:1px solid var(--border-light);padding-top:10px">
          <select style="font-size:.75rem;padding:4px 8px;border-radius:6px;border:1px solid var(--border)" onchange="calSyncUpdateDir('${e.id}',this.value)">
            <option value="push" ${e.sync_direction==="push"?"selected":""}>Genda → Calendrier</option>
            <option value="pull" ${e.sync_direction==="pull"?"selected":""}>Calendrier → Genda</option>
            <option value="both" ${e.sync_direction==="both"?"selected":""}>Bidirectionnel</option>
          </select>
          <button class="btn-outline" style="font-size:.75rem;padding:6px 12px" onclick="calSyncNow('${e.id}')">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg> Sync
          </button>
          <button class="btn-outline" style="font-size:.75rem;padding:6px 12px;color:var(--red);border-color:var(--red-bg)" onclick="calSyncDisconnect('${e.id}','${c.label}')">Déconnecter</button>
        </div></div>`}i+="</div>"}i+='<div id="icalUrlBox" style="display:none"></div>',i+="</div>",t.innerHTML=i}catch(o){t.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${d(o.message)}</div>`}}function y(){const t=document.getElementById("calSyncPracId");return t?t.value:null}async function k(t){try{const o=y(),n=`/api/calendar/${t}/connect`+(o?`?practitioner_id=${o}`:""),a=await(await fetch(n,{headers:{Authorization:"Bearer "+s.getToken()}})).json();if(a.error)throw new Error(a.error);a.url&&(window.location.href=a.url)}catch(o){r(o.message,"error")}}async function $(){try{const t=y(),o=await fetch("/api/calendar/ical/generate",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+s.getToken()},body:JSON.stringify({practitioner_id:t})}),n=await o.json();if(!o.ok)throw new Error(n.error);const l=document.getElementById("icalUrlBox");l.style.display="block",l.innerHTML=`<div class="card" style="margin-top:16px">
      <h4 style="font-size:.85rem;font-weight:700;margin-bottom:8px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        Flux iCal
      </h4>
      <p style="font-size:.75rem;color:var(--text-3);margin-bottom:8px">Copiez ce lien dans Apple Calendar, Thunderbird ou tout client CalDAV.</p>
      <div style="display:flex;gap:8px">
        <input type="text" value="${d(n.webcal_url)}" readonly style="flex:1;font-size:.72rem;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);font-family:monospace" id="icalUrlInput">
        <button class="btn-primary" style="font-size:.75rem;padding:8px 14px" onclick="navigator.clipboard.writeText(document.getElementById('icalUrlInput').value);GendaUI.toast('Copié !','success')">Copier</button>
      </div>
    </div>`,r("Lien iCal généré","success")}catch(t){r(t.message,"error")}}async function C(t,o){try{const n=await fetch(`/api/calendar/connections/${t}`,{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+s.getToken()},body:JSON.stringify({sync_direction:o})});if(!n.ok)throw new Error((await n.json()).error);r("Direction mise à jour","success")}catch(n){r(n.message,"error")}}async function z(t){try{r("Synchronisation...","info");const o=await fetch(`/api/calendar/connections/${t}/sync`,{method:"POST",headers:{Authorization:"Bearer "+s.getToken()}}),n=await o.json();if(!o.ok)throw new Error(n.error);r(`Sync OK — ${n.pulled||0} importé(s), ${n.pushed||0} exporté(s)`,"success"),h()}catch(o){r(o.message,"error")}}async function S(t,o){if(confirm(`Déconnecter ${o} ?`))try{const n=await fetch(`/api/calendar/connections/${t}`,{method:"DELETE",headers:{Authorization:"Bearer "+s.getToken()}});if(!n.ok)throw new Error((await n.json()).error);r("Calendrier déconnecté","success"),h()}catch(n){r(n.message,"error")}}b({loadCalSync:h,calSyncConnect:k,calSyncGenIcal:$,calSyncUpdateDir:C,calSyncNow:z,calSyncDisconnect:S});export{h as loadCalSync};
