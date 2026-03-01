/**
 * Settings (Paramètres) view module.
 */
import { api, sectorLabels, calState, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

async function loadSettings(){
  const c=document.getElementById('contentArea');
  c.innerHTML=`<div class="loading"><div class="spinner"></div></div>`;
  try{
    const[br,ur,lr]=await Promise.all([
      fetch('/api/business',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/auth/me',{headers:{'Authorization':'Bearer '+api.getToken()}}),
      fetch('/api/business/public-link',{headers:{'Authorization':'Bearer '+api.getToken()}})
    ]);
    const bd=await br.json(),ud=await ur.json(),ld=await lr.json();
    const b=bd.business, u=ud.user, lk=ld;
    let h='';

    // 1. Infos cabinet
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg> Informations du cabinet</h3></div><div class="sc-body">
      <div class="field-row"><div class="field"><label>Nom du cabinet *</label><input id="s_name" value="${esc(b.name||'')}"></div><div class="field"><label>URL personnalisée</label><div class="copy-input"><span style="padding:9px 0;font-size:.85rem;color:var(--text-4)">genda.be/</span><input id="s_slug" value="${esc(b.slug||'')}" style="flex:1"></div><div class="hint">Modifie l'URL de votre page publique</div></div></div>
      <div class="field-row"><div class="field"><label>Email professionnel</label><input id="s_email" type="email" value="${esc(b.email||'')}"></div><div class="field"><label>Téléphone</label><input id="s_phone" value="${esc(b.phone||'')}"></div></div>
      <div class="field"><label>Adresse</label><input id="s_address" value="${esc(b.address||'')}" placeholder="Ex: Rue de la Loi 42, 1000 Bruxelles"></div>
      <div class="field-row"><div class="field"><label>N° BCE / TVA</label><input id="s_bce" value="${esc(b.bce_number||'')}" placeholder="BE 0xxx.xxx.xxx"></div><div class="field"><label>Accréditation</label><input id="s_accred" value="${esc(b.accreditation||'')}" placeholder="Ex: Barreau de Bruxelles"></div></div>
      <div class="field"><label>Tagline</label><input id="s_tagline" value="${esc(b.tagline||'')}" placeholder="Phrase d'accroche affichée sur votre page"></div>
      <div class="field"><label>Description</label><textarea id="s_desc">${esc(b.description||'')}</textarea></div>
      <div class="field-row"><div class="field"><label>Année de fondation</label><input id="s_year" type="number" value="${b.founded_year||''}"></div><div class="field"><label>Langues</label><input id="s_langs" value="${esc(b.languages_spoken||'')}" placeholder="FR, NL, EN"></div></div>
      <div class="field"><label>Info parking</label><input id="s_parking" value="${esc(b.parking_info||'')}" placeholder="Ex: Parking gratuit à 50m"></div>
      <div style="height:1px;background:var(--border);margin:10px 0"></div>
      <div style="font-size:.75rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:6px">Facturation</div>
      <div class="field-row"><div class="field"><label>IBAN</label><input id="s_iban" value="${esc(b.settings?.iban||'')}" placeholder="BE00 0000 0000 0000"></div><div class="field"><label>BIC</label><input id="s_bic" value="${esc(b.settings?.bic||'')}" placeholder="GEBABEBB"></div></div>
      <div class="field"><label>Pied de page facture</label><input id="s_inv_footer" value="${esc(b.settings?.invoice_footer||'')}" placeholder="Ex: Petit entrepreneur - TVA non applicable art. 56bis CTVA"></div>
    </div><div class="sc-foot"><button class="btn-primary" onclick="saveBusiness()">Enregistrer</button></div></div>`;

    // 2. SEO
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> SEO & Référencement</h3></div><div class="sc-body">
      <div class="field"><label>Titre SEO</label><input id="s_seo_title" value="${esc(b.seo_title||'')}" placeholder="Titre affiché dans Google (max 60 car.)"><div class="hint">Par défaut : "[Nom] — [Tagline]"</div></div>
      <div class="field"><label>Meta description</label><textarea id="s_seo_desc" style="min-height:60px">${esc(b.seo_description||'')}</textarea><div class="hint">Description affichée dans Google (max 160 car.)</div></div>
    </div><div class="sc-foot"><button class="btn-primary" onclick="saveSEO()">Enregistrer</button></div></div>`;

    // 3. Politique agenda
    const overlapOn=!!(b.settings?.allow_overlap);
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> Politique agenda</h3></div><div class="sc-body">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
        <div>
          <div style="font-size:.88rem;font-weight:600">Autoriser les chevauchements</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Permet de placer plusieurs RDV en même temps pour le même praticien (ex: coloration + soin en parallèle)</div>
        </div>
        <label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;margin-left:16px">
          <input type="checkbox" id="s_overlap" ${overlapOn?'checked':''} onchange="saveOverlapPolicy()" style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;border-radius:100px;background:${overlapOn?'var(--primary)':'var(--border)'};transition:all .2s;cursor:pointer"></span>
          <span style="position:absolute;left:${overlapOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
        </label>
      </div>
    </div></div>`;

    // 3b. Rappels patients
    const plan=b.plan||'free';
    const re24=b.settings?.reminder_email_24h!==false;
    const rs24=b.settings?.reminder_sms_24h===true;
    const rs2=b.settings?.reminder_sms_2h===true;
    const re2=b.settings?.reminder_email_2h===true;
    const hasSms=plan==='pro'||plan==='premium';
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> Rappels patients</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Les rappels sont envoyés automatiquement aux patients avant leur rendez-vous. Réduisez les no-shows jusqu'à 50%.</p>`;

    h+=`<div style="display:flex;flex-direction:column;gap:10px">`;

    // Email 24h — all plans
    h+=buildReminderToggle('s_rem_email_24h', re24, '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg> Email — 24h avant', 'Rappel par email la veille du RDV', true);

    // SMS 24h — Pro/Premium
    h+=buildReminderToggle('s_rem_sms_24h', rs24, '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS — 24h avant', hasSms?'SMS de rappel la veille du RDV':'<span style="color:var(--coral)">Disponible avec le plan Pro</span>', hasSms);

    // SMS 2h — Pro/Premium
    h+=buildReminderToggle('s_rem_sms_2h', rs2, '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS — 2h avant', hasSms?'Rappel de dernière minute le jour même':'<span style="color:var(--coral)">Disponible avec le plan Pro</span>', hasSms);

    // Email 2h — optional
    h+=buildReminderToggle('s_rem_email_2h', re2, '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg> Email — 2h avant', 'Rappel email le jour même (optionnel)', true);

    h+=`</div>`;

    if(!hasSms){
      h+=`<div style="margin-top:14px;padding:12px 16px;background:var(--coral-lighter);border:1px solid var(--coral-border);border-radius:8px;font-size:.82rem;color:var(--coral-dark)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> Les rappels SMS sont disponibles à partir du plan <strong>Pro (39\u20ac/mois)</strong>. <a href="#" onclick="document.querySelector('[data-section=settings]').click();setTimeout(()=>document.querySelector('.plan-box:nth-child(2) .btn-primary')?.scrollIntoView({behavior:'smooth'}),100)" style="color:var(--coral-dark);font-weight:600">Voir les plans \u2192</a></div>`;
    }

    h+=`<div style="margin-top:14px;padding:12px 16px;background:var(--surface);border-radius:8px;font-size:.78rem;color:var(--text-4)">\u2139 Les SMS sont envoyés uniquement aux patients ayant donné leur consentement SMS. Les rappels ne sont pas envoyés pour les RDV annulés.</div>`;

    h+=`</div><div class="sc-foot"><button class="btn-primary" onclick="saveReminderSettings()">Enregistrer les rappels</button></div></div>`;

    // 3c. Politique d'acompte
    const depOn=b.settings?.deposit_enabled===true;
    const depThresh=b.settings?.deposit_noshow_threshold||2;
    const depType=b.settings?.deposit_type||'percent';
    const depPct=b.settings?.deposit_percent||50;
    const depFixed=b.settings?.deposit_fixed_cents||2500;
    const depDeadline=b.settings?.deposit_deadline_hours||48;
    const depMsg=b.settings?.deposit_message||'';
    const depDeduct=b.settings?.deposit_deduct!==false;
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Politique d'acompte</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Exigez un acompte des clients ayant un historique de no-shows. L'acompte sécurise le rendez-vous et réduit les pertes.</p>`;

    // Master toggle
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:16px">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Activer les acomptes</div><div style="font-size:.75rem;color:var(--text-4)">Demander un acompte aux clients récidivistes</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:pointer">
        <input type="checkbox" id="s_dep_enabled" ${depOn?'checked':''} onchange="document.getElementById('depositOptions').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${depOn?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${depOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;

    // Conditional options
    h+=`<div id="depositOptions" style="display:${depOn?'block':'none'}">`;

    // Threshold
    h+=`<div class="field"><label>Seuil de déclenchement</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Exiger un acompte après</span><input type="number" id="s_dep_threshold" value="${depThresh}" min="1" max="10" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">no-show(s)</span></div></div>`;

    // Type selector
    h+=`<div class="field"><label>Type de montant</label><div style="display:flex;gap:8px">
      <button class="btn-sm ${depType==='percent'?'active':''}" onclick="document.getElementById('s_dep_type').value='percent';document.getElementById('depPctRow').style.display='flex';document.getElementById('depFixedRow').style.display='none';this.classList.add('active');this.nextElementSibling.classList.remove('active')">% du prix</button>
      <button class="btn-sm ${depType==='fixed'?'active':''}" onclick="document.getElementById('s_dep_type').value='fixed';document.getElementById('depPctRow').style.display='none';document.getElementById('depFixedRow').style.display='flex';this.classList.add('active');this.previousElementSibling.classList.remove('active')">Montant fixe</button>
      <input type="hidden" id="s_dep_type" value="${depType}">
    </div></div>`;

    // Percent options
    h+=`<div id="depPctRow" class="field" style="display:${depType==='percent'?'flex':'none'};gap:8px">
      <button class="btn-sm ${depPct===25?'active':''}" onclick="document.getElementById('s_dep_percent').value='25';this.parentElement.querySelectorAll('.btn-sm').forEach(b=>b.classList.remove('active'));this.classList.add('active')">25%</button>
      <button class="btn-sm ${depPct===50?'active':''}" onclick="document.getElementById('s_dep_percent').value='50';this.parentElement.querySelectorAll('.btn-sm').forEach(b=>b.classList.remove('active'));this.classList.add('active')">50%</button>
      <button class="btn-sm ${depPct===100?'active':''}" onclick="document.getElementById('s_dep_percent').value='100';this.parentElement.querySelectorAll('.btn-sm').forEach(b=>b.classList.remove('active'));this.classList.add('active')">100%</button>
      <input type="hidden" id="s_dep_percent" value="${depPct}">
    </div>`;

    // Fixed amount
    h+=`<div id="depFixedRow" class="field" style="display:${depType==='fixed'?'flex':'none'};align-items:center;gap:8px">
      <input type="number" id="s_dep_fixed" value="${(depFixed/100).toFixed(0)}" min="1" step="5" style="width:100px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;text-align:right">
      <span style="font-size:.85rem;font-weight:600;color:var(--text-3)">EUR</span>
    </div>`;

    // Deadline
    h+=`<div class="field"><label>Délai de paiement</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Le client doit payer au moins</span><input type="number" id="s_dep_deadline" value="${depDeadline}" min="2" max="168" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures avant le RDV</span></div></div>`;

    // Deduct toggle
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--surface);border-radius:8px;margin-bottom:14px">
      <div><div style="font-size:.82rem;font-weight:600;color:var(--text)">Déduire de la facture</div><div style="font-size:.72rem;color:var(--text-4)">L'acompte sera soustrait du prix final si le client vient</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:pointer">
        <input type="checkbox" id="s_dep_deduct" ${depDeduct?'checked':''} style="display:none">
        <span style="position:absolute;inset:0;background:${depDeduct?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${depDeduct?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;

    // Custom message
    h+=`<div class="field"><label>Message personnalisé (optionnel)</label><textarea id="s_dep_message" placeholder="Ex: Un acompte est demandé suite à des absences répétées..." style="width:100%;padding:10px 13px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--sans);font-size:.82rem;resize:vertical;min-height:60px">${esc(depMsg)}</textarea><div class="hint">Inclus dans l'email de demande d'acompte envoyé au client</div></div>`;

    // ── Cancellation policy sub-section ──
    const canDl=b.settings?.cancel_deadline_hours||48;
    const canGrace=b.settings?.cancel_grace_minutes||240;
    const canPolicy=b.settings?.cancel_policy_text||'';
    h+=`<div style="height:1px;background:var(--border);margin:18px 0 14px"></div>`;
    h+=`<div style="font-size:.78rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:10px">Politique d'annulation</div>`;
    h+=`<p style="font-size:.78rem;color:var(--text-4);margin-bottom:12px">Définissez les conditions de remboursement de l'acompte en cas d'annulation.</p>`;

    h+=`<div class="field"><label>Délai d'annulation gratuite</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Remboursé si annulé plus de</span><input type="number" id="s_cancel_deadline" value="${canDl}" min="1" max="168" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures avant le RDV</span></div><div class="hint">En-dessous de ce délai, l'acompte est conservé</div></div>`;

    h+=`<div class="field"><label>Période de grâce post-réservation</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Annulation gratuite dans les</span><input type="number" id="s_cancel_grace" value="${Math.round(canGrace/60)}" min="0" max="48" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures après la réservation</span></div><div class="hint">Le client peut annuler sans frais juste après avoir réservé, même si le RDV est proche</div></div>`;

    h+=`<div class="field"><label>Texte de politique d'annulation (optionnel)</label><textarea id="s_cancel_policy" placeholder="Ex: Toute annulation moins de 48h avant le RDV entraîne la perte de l'acompte..." style="width:100%;padding:10px 13px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--sans);font-size:.82rem;resize:vertical;min-height:50px">${esc(canPolicy)}</textarea><div class="hint">Affiché dans les emails et sur la page de réservation</div></div>`;

    h+=`</div>`; // close depositOptions

    h+=`</div><div class="sc-foot"><button class="btn-primary" onclick="saveDepositSettings()">Enregistrer la politique d'acompte</button></div></div>`;

    // 4. Lien public & widget
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Lien public & Widget</h3></div><div class="sc-body">
      <div class="field"><label>URL de réservation</label><div class="copy-input"><input id="s_url" value="${lk.booking_url||''}" readonly><button class="btn-outline btn-sm" onclick="copyField('s_url')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Copier</button></div></div>
      <div class="field"><label>Code widget embeddable</label><div class="copy-input"><input id="s_widget" value='${esc(lk.widget_code||'')}' readonly style="font-size:.72rem"><button class="btn-outline btn-sm" onclick="copyField('s_widget')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg> Copier</button></div><div class="hint">Collez ce code sur votre site existant pour ajouter un bouton de réservation</div></div>
      <div class="field"><label>QR Code</label><div class="hint">Scannez pour accéder à votre page publique</div><div style="margin-top:8px;padding:16px;background:var(--surface);border-radius:8px;text-align:center"><canvas id="qrCanvas" width="160" height="160" style="width:160px;height:160px"></canvas><div style="margin-top:8px"><button class="btn-outline btn-sm" onclick="downloadQR()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Télécharger PNG</button></div></div></div>
    </div></div>`;

    // 4. Sécurité
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Sécurité</h3></div><div class="sc-body">
      <p style="font-size:.85rem;color:var(--text-3);margin-bottom:14px">Connecté en tant que <strong>${u.email}</strong> · Rôle : ${sectorLabels[u.role]||u.role}${u.last_login_at?' · Dernière connexion : '+new Date(u.last_login_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}):''}</p>
      <div class="field"><label>Mot de passe actuel</label><input id="s_pwd_current" type="password"></div>
      <div class="field-row"><div class="field"><label>Nouveau mot de passe</label><input id="s_pwd_new" type="password" placeholder="Min. 8 caractères"></div><div class="field"><label>Confirmer</label><input id="s_pwd_confirm" type="password"></div></div>
    </div><div class="sc-foot"><button class="btn-primary" onclick="changePassword()">Changer le mot de passe</button></div></div>`;

    // 5. Plan & facturation

    // Fetch subscription status
    let subStatus={};
    try{
      const sr=await fetch('/api/stripe/status',{headers:{'Authorization':'Bearer '+api.getToken()}});
      if(sr.ok) subStatus=await sr.json();
    }catch(e){}

    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Plan & Facturation</h3></div><div class="sc-body">`;

    // Trial banner
    if(subStatus.is_trialing){
      h+=`<div style="padding:14px 18px;background:var(--coral-lighter);border:1px solid var(--coral-border);border-radius:10px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div><span style="font-size:.88rem;font-weight:700;color:var(--coral-dark)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg> Période d'essai en cours</span><br><span style="font-size:.78rem;color:var(--text-3)">${subStatus.trial_days_left} jour${subStatus.trial_days_left>1?'s':''} restants — Votre carte ne sera débitée qu'à la fin de l'essai</span></div>
      </div>`;
    }

    // Past due warning
    if(subStatus.subscription_status==='past_due'){
      h+=`<div style="padding:14px 18px;background:var(--red-bg);border:1px solid var(--red-border);border-radius:10px;margin-bottom:16px">
        <span style="font-size:.88rem;font-weight:700;color:var(--red)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Paiement échoué</span><br>
        <span style="font-size:.78rem;color:var(--text-3)">Votre dernier paiement a échoué. Mettez à jour votre moyen de paiement pour éviter la suspension.</span>
        <button class="btn-primary" style="margin-top:8px;font-size:.82rem" onclick="openStripePortal()">Mettre à jour le paiement \u2192</button>
      </div>`;
    }

    h+=`<div class="plan-card">
        <div class="plan-box${plan==='free'?' current':''}">
          ${plan==='free'?'<span class="current-badge">Actuel</span>':''}
          <div class="plan-name">Gratuit</div>
          <div class="plan-price">0 \u20ac<span>/mois</span></div>
          <ul><li>Mini-site public</li><li>1 thème (Classique)</li><li>Booking en ligne</li><li>Agenda basique</li><li>5 clients max</li></ul>
        </div>
        <div class="plan-box${plan==='pro'?' current':''}">
          ${plan==='pro'?'<span class="current-badge">Actuel</span>':''}
          <div class="plan-name">Pro</div>
          <div class="plan-price">39 \u20ac<span>/mois</span></div>
          <ul><li>Tout du Gratuit +</li><li>6 thèmes + couleur custom</li><li>Clients illimités</li><li>Filtre d'appels (100 unités)</li><li>Rappels email + SMS</li><li>Statistiques avancées</li></ul>
          ${plan==='free'?'<button class="btn-primary" style="width:100%;margin-top:8px" onclick="startCheckout(\'pro\')">Essai gratuit 14 jours \u2192</button>':''}
          ${plan==='pro'&&subStatus.has_subscription?'<button class="btn-outline" style="width:100%;margin-top:8px" onclick="openStripePortal()">Gérer l\'abonnement</button>':''}
        </div>
        <div class="plan-box${plan==='premium'?' current':''}">
          ${plan==='premium'?'<span class="current-badge">Actuel</span>':''}
          <div class="plan-name">Premium</div>
          <div class="plan-price">79 \u20ac<span>/mois</span></div>
          <ul><li>Tout du Pro +</li><li>300 unités appels/SMS</li><li>Messagerie vocale</li><li>Domaine personnalisé</li><li>Support prioritaire</li></ul>
          ${plan!=='premium'?'<button class="'+(plan==='free'?'btn-outline':'btn-primary')+'" style="width:100%;margin-top:8px" onclick="startCheckout(\'premium\')">'+(plan==='pro'?'Passer au Premium \u2192':'Essai gratuit 14 jours \u2192')+'</button>':''}
          ${plan==='premium'&&subStatus.has_subscription?'<button class="btn-outline" style="width:100%;margin-top:8px" onclick="openStripePortal()">Gérer l\'abonnement</button>':''}
        </div>
      </div>`;

    // Manage subscription link
    if(subStatus.has_subscription){
      h+=`<div style="margin-top:14px;text-align:center"><button class="btn-outline btn-sm" onclick="openStripePortal()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Gérer mon abonnement · Factures · Moyen de paiement</button></div>`;
    }

    h+=`</div></div>`;

    // 7. Danger zone
    h+=`<div class="settings-card danger-zone"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Zone danger</h3></div><div class="sc-body">
      <p style="font-size:.85rem;color:var(--text-2);margin-bottom:12px">Supprimer définitivement votre compte et toutes les données associées. Cette action est irréversible.</p>
      <button class="btn-outline btn-danger" onclick="confirmDeleteAccount()">Supprimer mon compte</button>
    </div></div>`;

    c.innerHTML=h;

    // Draw QR code
    setTimeout(()=>drawQR(lk.qr_data||lk.booking_url||''),50);
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`;}
}

async function saveOverlapPolicy(){
  const on=document.getElementById('s_overlap').checked;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({settings_allow_overlap:on})});
    if(!r.ok)throw new Error((await r.json()).error);
    calState.fcAllowOverlap=on;
    GendaUI.toast(on?'Chevauchements autorisés':'Chevauchements bloqués','success');
    // Update toggle visual
    const span=document.getElementById('s_overlap').parentElement;
    span.querySelector('span:nth-child(2)').style.background=on?'var(--primary)':'var(--border)';
    span.querySelector('span:nth-child(3)').style.left=on?'22px':'2px';
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function buildReminderToggle(id, isOn, title, desc, enabled){
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);${!enabled?'opacity:.6':''}">
    <div>
      <div style="font-size:.88rem;font-weight:600">${title}</div>
      <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">${desc}</div>
    </div>
    <label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;margin-left:16px">
      <input type="checkbox" id="${id}" ${isOn?'checked':''} ${!enabled?'disabled':''} style="opacity:0;width:0;height:0">
      <span style="position:absolute;inset:0;border-radius:100px;background:${isOn&&enabled?'var(--primary)':'var(--border)'};transition:all .2s;cursor:${enabled?'pointer':'not-allowed'}"></span>
      <span style="position:absolute;left:${isOn&&enabled?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
    </label>
  </div>`;
}

async function saveReminderSettings(){
  try{
    const data={
      settings_reminder_email_24h:document.getElementById('s_rem_email_24h').checked,
      settings_reminder_sms_24h:document.getElementById('s_rem_sms_24h')?.checked||false,
      settings_reminder_sms_2h:document.getElementById('s_rem_sms_2h')?.checked||false,
      settings_reminder_email_2h:document.getElementById('s_rem_email_2h').checked
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast('Rappels configurés <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveDepositSettings(){
  try{
    const data={
      settings_deposit_enabled:document.getElementById('s_dep_enabled').checked,
      settings_deposit_noshow_threshold:document.getElementById('s_dep_threshold')?.value||2,
      settings_deposit_type:document.getElementById('s_dep_type')?.value||'percent',
      settings_deposit_percent:parseInt(document.getElementById('s_dep_percent')?.value)||50,
      settings_deposit_fixed_cents:Math.round((parseFloat(document.getElementById('s_dep_fixed')?.value)||25)*100),
      settings_deposit_deadline_hours:parseInt(document.getElementById('s_dep_deadline')?.value)||48,
      settings_deposit_message:document.getElementById('s_dep_message')?.value||'',
      settings_deposit_deduct:document.getElementById('s_dep_deduct')?.checked??true,
      settings_cancel_deadline_hours:parseInt(document.getElementById('s_cancel_deadline')?.value)||48,
      settings_cancel_grace_minutes:(parseInt(document.getElementById('s_cancel_grace')?.value)||4)*60,
      settings_cancel_policy_text:document.getElementById('s_cancel_policy')?.value||''
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast('Politique d\'acompte enregistrée','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function startCheckout(plan){
  try{
    GendaUI.toast('Redirection vers le paiement...','info');
    const r=await fetch('/api/stripe/checkout',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},
      body:JSON.stringify({plan})
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error);
    window.location.href=d.url;
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function openStripePortal(){
  try{
    GendaUI.toast('Ouverture du portail...','info');
    const r=await fetch('/api/stripe/portal',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()}
    });
    const d=await r.json();
    if(!r.ok)throw new Error(d.error);
    window.location.href=d.url;
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveBusiness(){
  const body={name:document.getElementById('s_name').value,slug:document.getElementById('s_slug').value,email:document.getElementById('s_email').value,phone:document.getElementById('s_phone').value,address:document.getElementById('s_address').value,bce_number:document.getElementById('s_bce').value,accreditation:document.getElementById('s_accred').value,tagline:document.getElementById('s_tagline').value,description:document.getElementById('s_desc').value,founded_year:document.getElementById('s_year').value||null,languages_spoken:document.getElementById('s_langs').value,parking_info:document.getElementById('s_parking').value,settings_iban:document.getElementById('s_iban').value,settings_bic:document.getElementById('s_bic').value,settings_invoice_footer:document.getElementById('s_inv_footer').value};
  try{const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast('Informations enregistrées','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveSEO(){
  const body={seo_title:document.getElementById('s_seo_title').value,seo_description:document.getElementById('s_seo_desc').value};
  try{const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast('SEO enregistré','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function changePassword(){
  const cur=document.getElementById('s_pwd_current').value;
  const nw=document.getElementById('s_pwd_new').value;
  const cnf=document.getElementById('s_pwd_confirm').value;
  if(!cur||!nw)return GendaUI.toast('Remplissez tous les champs','error');
  if(nw!==cnf)return GendaUI.toast('Les mots de passe ne correspondent pas','error');
  if(nw.length<8)return GendaUI.toast('Minimum 8 caractères','error');
  try{const r=await fetch('/api/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({current_password:cur,new_password:nw})});
    if(!r.ok)throw new Error((await r.json()).error);
    document.getElementById('s_pwd_current').value='';document.getElementById('s_pwd_new').value='';document.getElementById('s_pwd_confirm').value='';
    GendaUI.toast('Mot de passe modifié','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

function copyField(id){
  const el=document.getElementById(id);el.select();navigator.clipboard.writeText(el.value);
  GendaUI.toast('Copié !','success');
}

function confirmDeleteAccount(){
  const name=prompt('Tapez le nom de votre cabinet pour confirmer la suppression :');
  if(!name)return;
  GendaUI.toast('Suppression de compte — contactez support@genda.be','info');
}

// ===== QR Code (simple canvas) =====
function drawQR(data){
  const canvas=document.getElementById('qrCanvas');if(!canvas||!data)return;
  const ctx=canvas.getContext('2d');
  const s=160;canvas.width=s;canvas.height=s;
  ctx.fillStyle='#FFF';ctx.fillRect(0,0,s,s);
  // Border
  ctx.strokeStyle='#1A1816';ctx.lineWidth=4;ctx.strokeRect(8,8,s-16,s-16);
  // Corner squares
  [12,s-36].forEach(x=>{[12,s-36].forEach(y=>{
    if(x===s-36&&y===s-36)return;
    ctx.fillStyle='#1A1816';ctx.fillRect(x,y,24,24);
    ctx.fillStyle='#FFF';ctx.fillRect(x+4,y+4,16,16);
    ctx.fillStyle='#1A1816';ctx.fillRect(x+8,y+8,8,8);
  });});
  // Simple pattern from data hash
  let hash=0;for(let i=0;i<data.length;i++)hash=((hash<<5)-hash)+data.charCodeAt(i);
  for(let i=0;i<8;i++)for(let j=0;j<8;j++){
    if((hash>>(i*8+j))&1){ctx.fillStyle='#1A1816';ctx.fillRect(40+i*10,40+j*10,8,8);}
  }
  // Center logo
  ctx.fillStyle='var(--primary)';ctx.fillRect(s/2-14,s/2-14,28,28);
  ctx.fillStyle='#FFF';ctx.font='bold 14px sans-serif';ctx.textAlign='center';ctx.fillText('B',s/2,s/2+5);
}

function downloadQR(){
  const canvas=document.getElementById('qrCanvas');if(!canvas)return;
  const link=document.createElement('a');link.download='genda-qr.png';link.href=canvas.toDataURL();link.click();
  GendaUI.toast('QR téléchargé','success');
}

function doLogout(){api.logout();}

bridge({ loadSettings, saveOverlapPolicy, saveReminderSettings, saveDepositSettings, startCheckout, openStripePortal, saveBusiness, saveSEO, changePassword, copyField, confirmDeleteAccount, downloadQR, doLogout });

export { loadSettings, saveOverlapPolicy, saveReminderSettings, startCheckout, openStripePortal, saveBusiness, saveSEO, changePassword, copyField, confirmDeleteAccount, downloadQR, doLogout };
