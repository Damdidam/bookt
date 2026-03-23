import{a as n,G as s,d as m}from"./dashboard-bQXl7Rhg.js";const o=s.toast.bind(s);function a(t){return String(t||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}async function u(){const t=document.getElementById("contentArea");t.innerHTML='<div class="loading"><div class="spinner"></div></div>';try{const e=await fetch("/api/practitioners/me",{headers:{Authorization:"Bearer "+n.getToken()}});if(!e.ok)throw new Error((await e.json()).error);const i=(await e.json()).practitioner,l=i.display_name?.split(" ").map(c=>c[0]).join("").toUpperCase().slice(0,2)||"??",d=i.photo_url?`<img src="${i.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`:`<span style="color:#fff;font-size:2.5rem;font-weight:700">${l}</span>`;let p=`<div class="card" style="max-width:560px;margin:0 auto">
      <div style="text-align:center;padding:20px 0 16px">
        <div style="width:96px;height:96px;border-radius:50%;margin:0 auto 12px;overflow:hidden;background:${i.color||"var(--primary)"};display:flex;align-items:center;justify-content:center">${d}</div>
        <h2 style="font-size:1.1rem;font-weight:700;margin:0">${i.display_name}</h2>
        <div style="font-size:.82rem;color:var(--text-4);margin-top:2px">${i.title||"—"}</div>
        <div style="font-size:.72rem;color:var(--text-4);margin-top:4px">${i.login_email||""}</div>
      </div>
      <div style="border-top:1px solid var(--border);padding:20px 0 0">
        <div class="field"><label>Nom complet</label><input id="prof_name" value="${a(i.display_name||"")}" class="m-input"></div>
        <div class="field"><label>Titre / Spécialité</label><input id="prof_title" value="${a(i.title||"")}" class="m-input"></div>
        <div class="field-row">
          <div class="field"><label>Email</label><input id="prof_email" type="email" value="${a(i.email||"")}" class="m-input"></div>
          <div class="field"><label>Téléphone</label><input id="prof_phone" value="${a(i.phone||"")}" class="m-input"></div>
        </div>
        <div class="field"><label>Bio</label><textarea id="prof_bio" class="m-input" rows="3">${a(i.bio||"")}</textarea></div>
        <div style="text-align:right;margin-top:12px">
          <button class="btn-primary" onclick="saveProfile()">Enregistrer</button>
        </div>
      </div>
    </div>
    <div class="card" style="max-width:560px;margin:16px auto 0">
      <h3 style="font-size:.9rem;font-weight:700;margin-bottom:12px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/></svg> Changer le mot de passe</h3>
      <div class="field"><label>Mot de passe actuel</label><input id="prof_cur_pwd" type="password" class="m-input"></div>
      <div class="field"><label>Nouveau mot de passe</label><input id="prof_new_pwd" type="password" class="m-input" placeholder="Min. 8 caractères"></div>
      <div style="text-align:right;margin-top:12px">
        <button class="btn-outline" onclick="saveProfilePwd()">Changer le mot de passe</button>
      </div>
    </div>`;t.innerHTML=p}catch(e){t.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${a(e.message)}</div>`}}async function v(){const t={display_name:document.getElementById("prof_name").value.trim(),title:document.getElementById("prof_title").value.trim(),email:document.getElementById("prof_email").value.trim(),phone:document.getElementById("prof_phone").value.trim(),bio:document.getElementById("prof_bio").value.trim()};try{const e=await fetch("/api/practitioners/me",{method:"PATCH",headers:{"Content-Type":"application/json",Authorization:"Bearer "+n.getToken()},body:JSON.stringify(t)});if(!e.ok)throw new Error((await e.json()).error);o("Profil mis à jour","success");const r=n.getUser();r&&(r.business_name=t.display_name,n.setUser(r),document.getElementById("userName").textContent=t.display_name)}catch(e){o("Erreur: "+e.message,"error")}}async function g(){const t=document.getElementById("prof_cur_pwd").value,e=document.getElementById("prof_new_pwd").value;if(!t||!e)return o("Remplissez les deux champs","error");if(e.length<8)return o("Min. 8 caractères","error");try{const r=await fetch("/api/auth/change-password",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+n.getToken()},body:JSON.stringify({current_password:t,new_password:e})});if(!r.ok)throw new Error((await r.json()).error);o("Mot de passe changé","success"),document.getElementById("prof_cur_pwd").value="",document.getElementById("prof_new_pwd").value=""}catch(r){o("Erreur: "+r.message,"error")}}m({loadProfile:u,saveProfile:v,saveProfilePwd:g});export{u as loadProfile,v as saveProfile,g as saveProfilePwd};
