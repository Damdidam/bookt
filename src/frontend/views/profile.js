/**
 * Profile (Mon profil) view module — practitioner self-service.
 */
import { api, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

const gToast = GendaUI.toast.bind(GendaUI);

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function loadProfile(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const r=await fetch('/api/practitioners/me',{headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    const d=await r.json();
    const p=d.practitioner;
    const initials=p.display_name?.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)||'??';
    const avatarContent=p.photo_url
      ?`<img src="${p.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
      :`<span style="color:#fff;font-size:2.5rem;font-weight:700">${initials}</span>`;

    let h=`<div class="card" style="max-width:560px;margin:0 auto">
      <div style="text-align:center;padding:20px 0 16px">
        <div style="width:96px;height:96px;border-radius:50%;margin:0 auto 12px;overflow:hidden;background:${p.color||'var(--primary)'};display:flex;align-items:center;justify-content:center">${avatarContent}</div>
        <h2 style="font-size:1.1rem;font-weight:700;margin:0">${p.display_name}</h2>
        <div style="font-size:.82rem;color:var(--text-4);margin-top:2px">${p.title||'—'}</div>
        <div style="font-size:.72rem;color:var(--text-4);margin-top:4px">${p.login_email||''}</div>
      </div>
      <div style="border-top:1px solid var(--border);padding:20px 0 0">
        <div class="field"><label>Nom complet</label><input id="prof_name" value="${esc(p.display_name||'')}" class="m-input"></div>
        <div class="field"><label>Titre / Spécialité</label><input id="prof_title" value="${esc(p.title||'')}" class="m-input"></div>
        <div class="field-row">
          <div class="field"><label>Email</label><input id="prof_email" type="email" value="${esc(p.email||'')}" class="m-input"></div>
          <div class="field"><label>Téléphone</label><input id="prof_phone" value="${esc(p.phone||'')}" class="m-input"></div>
        </div>
        <div class="field"><label>Bio</label><textarea id="prof_bio" class="m-input" rows="3">${esc(p.bio||'')}</textarea></div>
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
    </div>`;
    c.innerHTML=h;
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

async function saveProfile(){
  const payload={
    display_name:document.getElementById('prof_name').value.trim(),
    title:document.getElementById('prof_title').value.trim(),
    email:document.getElementById('prof_email').value.trim(),
    phone:document.getElementById('prof_phone').value.trim(),
    bio:document.getElementById('prof_bio').value.trim()
  };
  try{
    const r=await fetch('/api/practitioners/me',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(payload)});
    if(!r.ok)throw new Error((await r.json()).error);
    gToast('Profil mis à jour','success');
    // Update sidebar name
    const u=api.getUser();if(u){u.business_name=payload.display_name;api.setUser(u);document.getElementById('userName').textContent=payload.display_name;}
  }catch(e){gToast('Erreur: '+e.message,'error');}
}

async function saveProfilePwd(){
  const cur=document.getElementById('prof_cur_pwd').value;
  const nw=document.getElementById('prof_new_pwd').value;
  if(!cur||!nw)return gToast('Remplissez les deux champs','error');
  if(nw.length<8)return gToast('Min. 8 caractères','error');
  try{
    const r=await fetch('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({current_password:cur,new_password:nw})});
    if(!r.ok)throw new Error((await r.json()).error);
    gToast('Mot de passe changé','success');
    document.getElementById('prof_cur_pwd').value='';
    document.getElementById('prof_new_pwd').value='';
  }catch(e){gToast('Erreur: '+e.message,'error');}
}

bridge({ loadProfile, saveProfile, saveProfilePwd });

export { loadProfile, saveProfile, saveProfilePwd };
