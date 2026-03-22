/**
 * Settings (Paramètres) view module.
 */
import { api, sectorLabels, calState, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { guardModal } from '../utils/dirty-guard.js';
import { IC } from '../utils/icons.js';

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
    window._initialSector=b.sector;
    let h='';
    // Inject save button into the topbar (next to page title)
    const topbar=document.querySelector('.topbar');
    if(topbar){
      let tb=topbar.querySelector('#settingsSaveBtn');
      if(!tb){
        tb=document.createElement('button');
        tb.id='settingsSaveBtn';
        tb.className='btn-primary';
        tb.textContent='Enregistrer';
        tb.onclick=()=>saveAllSettings();
        topbar.appendChild(tb);
      }
    }

    // 1. Infos salon
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg> Informations du salon</h3></div><div class="sc-body">
      <div class="field-row"><div class="field"><label>Nom du salon *</label><input id="s_name" value="${esc(b.name||'')}"></div><div class="field"><label>URL personnalisée</label><div class="copy-input"><span style="padding:9px 0;font-size:.85rem;color:var(--text-4)">genda.be/</span><input id="s_slug" value="${esc(b.slug||'')}" style="flex:1"></div><div class="hint">Modifie l'URL de votre page publique</div></div></div>
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
    </div></div>`;

    // 1b. Secteur d'activité
    const sectorOptions=[['coiffeur','Coiffeur\u00b7se'],['esthetique','Esthétique'],['barbier','Barbier'],['bien_etre','Massage & Bien-être'],['kine','Kinésithérapie'],['medecin','Médecin'],['dentiste','Dentiste'],['osteopathe','Ostéopathe'],['veterinaire','Vétérinaire / Toilettage'],['photographe','Photographe'],['coaching','Coaching sportif'],['garage','Garage / Auto'],['autre','Autre']];
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg> Secteur d'activité</h3></div><div class="sc-body">
      <p style="font-size:.82rem;color:var(--text-3);margin-bottom:14px">Le secteur détermine les catégories de prestations et la terminologie de votre interface.</p>
      <div class="field"><label>Secteur</label><select id="s_sector" style="width:100%;padding:10px 13px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;background:var(--surface);color:var(--text);font-family:var(--sans)">${sectorOptions.map(([v,l])=>`<option value="${v}"${b.sector===v?' selected':''}>${l}</option>`).join('')}</select></div>
    </div></div>`;

    // 2. SEO
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> SEO & Référencement</h3></div><div class="sc-body">
      <div class="field"><label>Titre SEO</label><input id="s_seo_title" value="${esc(b.seo_title||'')}" placeholder="Titre affiché dans Google (max 60 car.)"><div class="hint">Par défaut : "[Nom] — [Tagline]"</div></div>
      <div class="field"><label>Meta description</label><textarea id="s_seo_desc" style="min-height:60px">${esc(b.seo_description||'')}</textarea><div class="hint">Description affichée dans Google (max 160 car.)</div></div>
    </div></div>`;

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
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);margin-top:10px">
        <div>
          <div style="font-size:.88rem;font-weight:600">Réservation multi-prestations</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Les clients peuvent réserver plusieurs prestations en un seul rendez-vous (ex: épilation + soin visage)</div>
        </div>
        <label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;margin-left:16px">
          <input type="checkbox" id="s_multi_service" ${!!(b.settings?.multi_service_enabled)?'checked':''} onchange="saveMultiServicePolicy()" style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;border-radius:100px;background:${!!(b.settings?.multi_service_enabled)?'var(--primary)':'var(--border)'};transition:all .2s;cursor:pointer"></span>
          <span style="position:absolute;left:${!!(b.settings?.multi_service_enabled)?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
        </label>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);margin-top:10px">
        <div>
          <div style="font-size:.88rem;font-weight:600">Vue par d\u00e9faut du calendrier</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Choisissez la vue affich\u00e9e \u00e0 l'ouverture de l'agenda</div>
        </div>
        <div style="display:flex;gap:4px;margin-left:16px" id="defaultViewBtns">
          <button class="btn-sm${(b.settings?.default_calendar_view||'week')==='day'?' active':''}" onclick="saveDefaultView('day')">Jour</button>
          <button class="btn-sm${(b.settings?.default_calendar_view||'week')==='week'?' active':''}" onclick="saveDefaultView('week')">Semaine</button>
          <button class="btn-sm${(b.settings?.default_calendar_view||'week')==='month'?' active':''}" onclick="saveDefaultView('month')">Mois</button>
        </div>
      </div>
    </div></div>`;

    // 3a-bis. Réservation en ligne
    const pracChoiceOn=!!(b.settings?.practitioner_choice_enabled);
    h+=`<div class="settings-card"><div class="sc-h"><h3>${IC.clipboard} Réservation en ligne</h3></div><div class="sc-body">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
        <div>
          <div style="font-size:.88rem;font-weight:600">Choix du praticien par le client</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Permet au client de choisir son praticien lors de la réservation en ligne. S'il ne choisit pas, le premier disponible sera assigné automatiquement.</div>
        </div>
        <label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;margin-left:16px">
          <input type="checkbox" id="s_practitioner_choice" ${pracChoiceOn?'checked':''} onchange="savePractitionerChoiceSetting()" style="opacity:0;width:0;height:0">
          <span style="position:absolute;inset:0;border-radius:100px;background:${pracChoiceOn?'var(--primary)':'var(--border)'};transition:all .2s;cursor:pointer"></span>
          <span style="position:absolute;left:${pracChoiceOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
        </label>
      </div>
    </div></div>`;

    // 3a. Calendrier — incrément + liste d'attente + couleur
    const slotInc = b.settings?.slot_increment_min || 15;
    const wlMode = b.settings?.waitlist_mode || 'off';
    const colorMode = b.settings?.calendar_color_mode || 'category';
    const autoOpt = b.settings?.slot_auto_optimize !== false;
    const gapOn = b.settings?.gap_analyzer_enabled === true;
    const fsOn = b.settings?.featured_slots_enabled === true;
    const lmOn = b.settings?.last_minute_enabled === true;
    const lmDeadline = b.settings?.last_minute_deadline || 'j-1';
    const lmDiscount = b.settings?.last_minute_discount_pct || 10;
    const lmMinPrice = b.settings?.last_minute_min_price_cents || 0;
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Calendrier</h3></div><div class="sc-body">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
        <div class="field"><label>Incrément agenda</label><select id="s_slot_inc" class="field-input">
          ${[5, 10, 15, 20, 30, 45, 60].map(v => `<option value="${v}"${slotInc === v ? ' selected' : ''}>${v} min</option>`).join('')}
        </select><div class="hint">Granularité des créneaux dans le calendrier</div></div>
        <div class="field"><label>Liste d'attente</label><select id="s_waitlist" class="field-input">
          <option value="off"${wlMode === 'off' ? ' selected' : ''}>Désactivée</option>
          <option value="manual"${wlMode === 'manual' ? ' selected' : ''}>Manuelle</option>
          <option value="auto"${wlMode === 'auto' ? ' selected' : ''}>Automatique</option>
        </select><div class="hint">Gestion des clients en attente lors d'annulations</div></div>
        <div class="field"><label>Couleurs agenda</label><select id="s_color_mode" class="field-input">
          <option value="category"${colorMode === 'category' ? ' selected' : ''}>Par catégorie</option>
          <option value="practitioner"${colorMode === 'practitioner' ? ' selected' : ''}>Par praticien</option>
        </select><div class="hint">Couleur des RDV sur l'agenda</div></div>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <span style="position:relative;display:inline-block;width:36px;height:20px">
            <input type="checkbox" id="s_slot_auto_optimize" style="opacity:0;width:0;height:0;position:absolute"${autoOpt?' checked':''}>
            <span style="position:absolute;inset:0;background:${autoOpt?'var(--primary)':'#ccc'};border-radius:20px;transition:background .2s" onclick="const c=document.getElementById('s_slot_auto_optimize');c.checked=!c.checked;this.style.background=c.checked?'var(--primary)':'#ccc';this.nextElementSibling.style.transform=c.checked?'translateX(16px)':'translateX(0)'"></span>
            <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;transform:${autoOpt?'translateX(16px)':'translateX(0)'};pointer-events:none"></span>
          </span>
          <span style="font-weight:600;font-size:.85rem">Optimisation auto des créneaux</span>
        </div>
        <div class="hint" style="margin-top:4px;margin-left:46px">Calcule automatiquement l'espacement optimal des créneaux à partir de vos prestations et priorise les horaires qui comblent les trous</div>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <span style="position:relative;display:inline-block;width:36px;height:20px">
            <input type="checkbox" id="s_gap_analyzer" style="opacity:0;width:0;height:0;position:absolute"${gapOn?' checked':''}>
            <span style="position:absolute;inset:0;background:${gapOn?'var(--primary)':'#ccc'};border-radius:20px;transition:background .2s" onclick="const c=document.getElementById('s_gap_analyzer');c.checked=!c.checked;this.style.background=c.checked?'var(--primary)':'#ccc';this.nextElementSibling.style.transform=c.checked?'translateX(16px)':'translateX(0)'"></span>
            <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;transform:${gapOn?'translateX(16px)':'translateX(0)'};pointer-events:none"></span>
          </span>
          <span style="font-weight:600;font-size:.85rem">Analyseur de gaps</span>
        </div>
        <div class="hint" style="margin-top:4px;margin-left:46px">Détecte automatiquement les créneaux libres entre les RDV et suggère des services compatibles</div>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <span style="position:relative;display:inline-block;width:36px;height:20px">
            <input type="checkbox" id="s_featured_slots" style="opacity:0;width:0;height:0;position:absolute"${fsOn?' checked':''}>
            <span style="position:absolute;inset:0;background:${fsOn?'var(--primary)':'#ccc'};border-radius:20px;transition:background .2s" onclick="const c=document.getElementById('s_featured_slots');c.checked=!c.checked;this.style.background=c.checked?'var(--primary)':'#ccc';this.nextElementSibling.style.transform=c.checked?'translateX(16px)':'translateX(0)'"></span>
            <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;transform:${fsOn?'translateX(16px)':'translateX(0)'};pointer-events:none"></span>
          </span>
          <span style="font-weight:600;font-size:.85rem">Mode vedette</span>
        </div>
        <div class="hint" style="margin-top:4px;margin-left:46px">Met en avant les créneaux prioritaires à remplir sur le calendrier</div>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer">
          <span style="position:relative;display:inline-block;width:36px;height:20px">
            <input type="checkbox" id="s_last_minute" style="opacity:0;width:0;height:0;position:absolute"${lmOn?' checked':''}>
            <span style="position:absolute;inset:0;background:${lmOn?'var(--amber)':'#ccc'};border-radius:20px;transition:background .2s" onclick="const c=document.getElementById('s_last_minute');c.checked=!c.checked;this.style.background=c.checked?'var(--amber)':'#ccc';this.nextElementSibling.style.transform=c.checked?'translateX(16px)':'translateX(0)';document.getElementById('lm_details').style.display=c.checked?'grid':'none'"></span>
            <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;transform:${lmOn?'translateX(16px)':'translateX(0)'};pointer-events:none"></span>
          </span>
          <span style="font-weight:600;font-size:.85rem">Promotions dernière minute</span>
        </div>
        <div class="hint" style="margin-top:4px;margin-left:46px">Propose les créneaux restants avec une réduction pour maximiser le remplissage</div>
        <div id="lm_details" style="display:${lmOn?'grid':'none'};grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:12px;margin-left:46px">
          <div class="field"><label>Fenêtre</label><select id="s_lm_deadline" class="field-input">
            <option value="j-2"${lmDeadline==='j-2'?' selected':''}>J-2 avant le RDV</option>
            <option value="j-1"${lmDeadline==='j-1'?' selected':''}>J-1 (veille)</option>
            <option value="same_day"${lmDeadline==='same_day'?' selected':''}>Jour même</option>
          </select><div class="hint">Quand les créneaux deviennent "dernière minute"</div></div>
          <div class="field"><label>Réduction</label><select id="s_lm_discount" class="field-input">
            ${[5,10,15,20,25].map(v=>`<option value="${v}"${lmDiscount===v?' selected':''}>${v}%</option>`).join('')}
          </select><div class="hint">Pourcentage de réduction affiché</div></div>
          <div class="field"><label>Prix min. service</label><input type="number" id="s_lm_min_price" class="field-input" value="${lmMinPrice}" min="0" step="100" placeholder="0">
          <div class="hint">En centimes. Services sous ce prix ne sont pas remisés (0 = pas de seuil)</div></div>
        </div>
      </div>
    </div></div>`;

    // 3a-bis. Paiements (Stripe Connect)
    // Fetch connect status async — render placeholder first
    h+=`<div class="settings-card" id="connectCard"><div class="sc-h"><h3>${IC.creditCard} Paiements</h3></div><div class="sc-body" id="connectBody"><div style="text-align:center;padding:20px;color:var(--text-4);font-size:.82rem">Chargement...</div></div></div>`;
    // Load connect status after render
    setTimeout(()=>loadConnectStatus(),100);

    // 3b. Rappels clients
    const plan=b.plan||'free';
    const re24=b.settings?.reminder_email_24h!==false;
    const rs24=b.settings?.reminder_sms_24h===true;
    const rs2=b.settings?.reminder_sms_2h===true;
    const re2=b.settings?.reminder_email_2h===true;
    const hasSms=plan==='pro'||plan==='premium';
    h+=`<div class="settings-card"><div class="sc-h"><h3>${IC.bell} Rappels clients</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Les rappels sont envoyés automatiquement aux clients avant leur rendez-vous. Réduisez les no-shows jusqu'à 50%.</p>`;

    h+=`<div style="display:flex;flex-direction:column;gap:10px">`;

    // Email 24h — all plans
    h+=buildReminderToggle('s_rem_email_24h', re24, IC.mail+' Email — 24h avant', 'Rappel par email la veille du RDV', true);

    // SMS 24h — Pro/Premium
    h+=buildReminderToggle('s_rem_sms_24h', rs24, '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS — 24h avant', hasSms?'SMS de rappel la veille du RDV':'<span style="color:var(--coral)">Disponible avec le plan Pro</span>', hasSms);

    // SMS 2h — Pro/Premium
    h+=buildReminderToggle('s_rem_sms_2h', rs2, '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS — 2h avant', hasSms?'Rappel de dernière minute le jour même':'<span style="color:var(--coral)">Disponible avec le plan Pro</span>', hasSms);

    // Email 2h — optional
    h+=buildReminderToggle('s_rem_email_2h', re2, IC.mail+' Email — 2h avant', 'Rappel email le jour même (optionnel)', true);

    h+=`</div>`;

    if(!hasSms){
      h+=`<div style="margin-top:14px;padding:12px 16px;background:var(--coral-lighter);border:1px solid var(--coral-border);border-radius:8px;font-size:.82rem;color:var(--coral-dark)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> Les rappels SMS sont disponibles à partir du plan <strong>Pro (39\u20ac/mois)</strong>. <a href="#" onclick="document.querySelector('[data-section=settings]').click();setTimeout(()=>document.querySelector('.plan-box:nth-child(2) .btn-primary')?.scrollIntoView({behavior:'smooth'}),100)" style="color:var(--coral-dark);font-weight:600">Voir les plans \u2192</a></div>`;
    }

    h+=`<div style="margin-top:14px;padding:12px 16px;background:var(--surface);border-radius:8px;font-size:.78rem;color:var(--text-4)">\u2139 Les SMS sont envoyés uniquement aux clients ayant donné leur consentement SMS. Les rappels ne sont pas envoyés pour les RDV annulés.</div>`;

    h+=`</div></div>`;

    // 3c. Politique d'acompte
    const depOn=b.settings?.deposit_enabled===true;
    const depThresh=b.settings?.deposit_noshow_threshold||2;
    const depPriceThresh=b.settings?.deposit_price_threshold_cents||0;
    const depDurThresh=b.settings?.deposit_duration_threshold_min||0;
    const depThreshMode=b.settings?.deposit_threshold_mode||'any';
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
    h+=`<div class="field"><label>Seuil de déclenchement (no-shows)</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Exiger un acompte après</span><input type="number" id="s_dep_threshold" value="${depThresh}" min="1" max="10" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">no-show(s)</span></div></div>`;

    // Price/duration auto-suggestion thresholds
    h+=`<div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:.82rem;font-weight:600;color:var(--text);margin-bottom:6px">Suggestion automatique (RDV staff)</div>
      <p style="font-size:.75rem;color:var(--text-4);margin-bottom:12px">Quand le staff crée un RDV dépassant ces seuils, un toggle « Demander un acompte » s'active automatiquement. Le staff peut l'ignorer.</p>
      <div class="field"><label>Seuil de prix</label><div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="s_dep_price_thresh" value="${depPriceThresh?depPriceThresh/100:''}" min="0" step="10" placeholder="Ex: 150" style="width:100px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;text-align:right">
        <span style="font-size:.85rem;color:var(--text-3)">EUR</span>
        <span style="font-size:.75rem;color:var(--text-4);margin-left:4px">(vide = pas de seuil prix)</span>
      </div></div>
      <div class="field"><label>Seuil de durée</label><div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="s_dep_dur_thresh" value="${depDurThresh||''}" min="0" step="15" placeholder="Ex: 120" style="width:100px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;text-align:right">
        <span style="font-size:.85rem;color:var(--text-3)">min</span>
        <span style="font-size:.75rem;color:var(--text-4);margin-left:4px">(vide = pas de seuil durée)</span>
      </div></div>
      <div class="field"><label>Mode</label><div style="display:flex;gap:8px">
        <button class="btn-sm ${depThreshMode==='any'?'active':''}" onclick="document.getElementById('s_dep_thresh_mode').value='any';this.classList.add('active');this.nextElementSibling.classList.remove('active')">L'un ou l'autre</button>
        <button class="btn-sm ${depThreshMode==='both'?'active':''}" onclick="document.getElementById('s_dep_thresh_mode').value='both';this.classList.add('active');this.previousElementSibling.classList.remove('active')">Les deux</button>
        <input type="hidden" id="s_dep_thresh_mode" value="${depThreshMode}">
      </div></div>
    </div>`;

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

    h+=`</div></div>`;

    // 3c-bis. Déplacement des rendez-vous
    const moveOn=!!(b.settings?.move_restriction_enabled);
    const moveDeadline=b.settings?.move_deadline_hours||48;
    const moveGrace=b.settings?.move_grace_hours||0;
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 12H3"/><path d="m7 8-4 4 4 4"/><path d="M21 12h-8"/><path d="m15 16 4-4-4-4"/></svg> Déplacement des rendez-vous</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Restreignez la possibilité de déplacer les rendez-vous sur le calendrier. Les RDV avec acompte sont toujours verrouillés.</p>`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:16px">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Restreindre le déplacement</div><div style="font-size:.75rem;color:var(--text-4)">Empêche le déplacement des RDV trop proches de l'échéance</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:pointer">
        <input type="checkbox" id="s_move_enabled" ${moveOn?'checked':''} onchange="document.getElementById('moveOptions').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${moveOn?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${moveOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    h+=`<div id="moveOptions" style="display:${moveOn?'block':'none'}">`;
    h+=`<div class="field"><label>Délai avant le RDV</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Ne plus déplacer si le RDV est dans moins de</span><input type="number" id="s_move_deadline" value="${moveDeadline}" min="1" max="720" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures</span></div></div>`;
    h+=`<div class="field"><label>Période de grâce après la prise de RDV</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Autoriser le déplacement dans les</span><input type="number" id="s_move_grace" value="${moveGrace}" min="0" max="168" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures suivant la prise de RDV</span></div><div class="hint">0 = pas de période de grâce</div></div>`;
    h+=`<div style="margin-top:10px;padding:10px 14px;background:var(--surface);border-radius:8px;font-size:.78rem;color:var(--text-4)">Les RDV avec acompte sont toujours verrouillés, indépendamment de ces paramètres.</div>`;
    h+=`</div>`;
    h+=`</div></div>`;

    // 3c-ter. Modification par le client (reschedule)
    const reschOn=!!(b.settings?.reschedule_enabled);
    const reschDeadline=b.settings?.reschedule_deadline_hours||24;
    const reschMax=b.settings?.reschedule_max_count||1;
    const reschWindow=b.settings?.reschedule_window_days||30;
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M14 14l2 2-2 2"/></svg> Modification par le client</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Permettez à vos clients de déplacer eux-mêmes leur rendez-vous via le lien dans l'email de confirmation.</p>`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:16px">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Autoriser la modification</div><div style="font-size:.75rem;color:var(--text-4)">Le client peut changer la date/heure de son RDV depuis son email</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:pointer">
        <input type="checkbox" id="s_reschedule_enabled" ${reschOn?'checked':''} onchange="document.getElementById('rescheduleOptions').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${reschOn?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${reschOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    h+=`<div id="rescheduleOptions" style="display:${reschOn?'block':'none'}">`;
    h+=`<div class="field"><label>Délai minimum avant le RDV</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Modification possible jusqu'à</span><input type="number" id="s_reschedule_deadline" value="${reschDeadline}" min="1" max="720" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures avant le RDV</span></div><div class="hint">Passé ce délai, le client ne pourra plus modifier</div></div>`;
    h+=`<div class="field"><label>Nombre max de modifications</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Le client peut modifier</span><input type="number" id="s_reschedule_max" value="${reschMax}" min="1" max="10" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">fois maximum</span></div></div>`;
    h+=`<div class="field"><label>Fenêtre de choix</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Le client peut choisir un créneau dans les</span><input type="number" id="s_reschedule_window" value="${reschWindow}" min="7" max="90" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">jours à venir</span></div></div>`;
    h+=`<div style="margin-top:10px;padding:10px 14px;background:var(--surface);border-radius:8px;font-size:.78rem;color:var(--text-4)">Les RDV verrouillés ne peuvent pas être modifiés par le client. Les acomptes restent attachés au RDV déplacé.</div>`;
    h+=`</div>`;
    h+=`</div></div>`;

    // 3a-bis. Gift cards
    const gcOn=!!b.settings?.giftcard_enabled;
    const gcAmounts=b.settings?.giftcard_amounts||[2500,5000,7500,10000];
    const gcCustom=b.settings?.giftcard_custom_amount!==false;
    const gcMin=(b.settings?.giftcard_min_amount_cents||1000)/100;
    const gcMax=(b.settings?.giftcard_max_amount_cents||50000)/100;
    const gcExpiry=b.settings?.giftcard_expiry_days||365;
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="12" rx="2"/><path d="M12 8v12"/><path d="M8 1l4 3.5L16 1"/></svg> Cartes cadeau</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Permettez à vos clients d'acheter des cartes cadeau en ligne depuis votre minisite.</p>`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:16px">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Activer les cartes cadeau</div><div style="font-size:.75rem;color:var(--text-4)">Un bouton "Carte cadeau" apparaîtra sur votre minisite</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:pointer">
        <input type="checkbox" id="s_gc_enabled" ${gcOn?'checked':''} onchange="document.getElementById('gcOptions').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${gcOn?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${gcOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    h+=`<div id="gcOptions" style="display:${gcOn?'block':'none'}">`;
    h+=`<div class="field"><label>Montants prédéfinis (€)</label><input type="text" id="s_gc_amounts" value="${gcAmounts.map(a=>(a/100)).join(', ')}" placeholder="25, 50, 75, 100" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;width:100%;font-family:var(--sans)"><div class="hint">Séparez les montants par des virgules</div></div>`;
    h+=`<div class="field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" id="s_gc_custom" ${gcCustom?'checked':''}> Autoriser un montant libre</label></div>`;
    h+=`<div class="field"><label>Montant min/max (€)</label><div style="display:flex;gap:10px"><input type="number" id="s_gc_min" value="${gcMin}" min="5" style="width:80px;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;text-align:center"><span style="align-self:center;color:var(--text-3)">à</span><input type="number" id="s_gc_max" value="${gcMax}" min="10" style="width:80px;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;text-align:center"></div></div>`;
    h+=`<div class="field"><label>Validité</label><div style="display:flex;align-items:center;gap:8px"><input type="number" id="s_gc_expiry" value="${gcExpiry}" min="30" max="730" style="width:70px;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;text-align:center"><span style="font-size:.82rem;color:var(--text-3)">jours</span></div></div>`;
    h+=`</div>`;
    h+=`</div></div>`;

    // 3b. Confirmation de réservation en ligne
    const confOn=!!b.settings?.booking_confirmation_required;
    const confTimeout=b.settings?.booking_confirmation_timeout_min||30;
    const confChannel=b.settings?.booking_confirmation_channel||'email';
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Confirmation de réservation</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-4);margin-bottom:14px">Exiger que le client confirme son RDV après la prise de rendez-vous en ligne. Sans confirmation dans le délai imparti, le créneau est automatiquement libéré.</p>`;

    // Toggle
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1.5px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
      <div><div style="font-size:.88rem;font-weight:600">Confirmation obligatoire</div><div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Le client doit confirmer par email/SMS pour valider son RDV</div></div>
      <label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;margin-left:16px;cursor:pointer">
        <input type="checkbox" id="s_booking_confirm_required" ${confOn?'checked':''} onchange="document.getElementById('bookingConfirmOptions').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${confOn?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${confOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;

    // Options (visible when toggle is ON)
    h+=`<div id="bookingConfirmOptions" style="display:${confOn?'block':'none'};margin-top:14px">`;
    h+=`<div class="field"><label>Délai de confirmation</label><div style="display:flex;align-items:center;gap:8px"><input type="number" id="s_booking_confirm_timeout" value="${confTimeout}" min="5" max="1440" style="width:70px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">minutes pour confirmer</span></div><div class="hint">Le créneau reste bloqué pendant ce délai. Ensuite il est automatiquement libéré.</div></div>`;
    h+=`<div class="field"><label>Canal de confirmation</label><select id="s_booking_confirm_channel" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;font-family:var(--sans)">
      <option value="email" ${confChannel==='email'?'selected':''}>Email uniquement</option>
      <option value="sms" ${confChannel==='sms'?'selected':''}>SMS uniquement</option>
      <option value="both" ${confChannel==='both'?'selected':''}>Email + SMS</option>
    </select><div class="hint">Le client reçoit un lien de confirmation par le canal choisi</div></div>`;
    h+=`</div>`;

    h+=`</div></div>`;

    // 4. Lien public & widget
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Lien public & Widget</h3></div><div class="sc-body">
      <div class="field"><label>URL de réservation</label><div class="copy-input"><input id="s_url" value="${lk.booking_url||''}" readonly><button class="btn-outline btn-sm" onclick="copyField('s_url')">${IC.clipboard} Copier</button></div></div>
      <div class="field"><label>Code widget embeddable</label><div class="copy-input"><input id="s_widget" value='${esc(lk.widget_code||'')}' readonly style="font-size:.72rem"><button class="btn-outline btn-sm" onclick="copyField('s_widget')">${IC.clipboard} Copier</button></div><div class="hint">Collez ce code sur votre site existant pour ajouter un bouton de réservation</div></div>
      <div class="field"><label>QR Code</label><div class="hint">Scannez pour accéder à votre page publique</div><div style="margin-top:8px;padding:16px;background:var(--surface);border-radius:8px;text-align:center"><canvas id="qrCanvas" width="160" height="160" style="width:160px;height:160px"></canvas><div style="margin-top:8px"><button class="btn-outline btn-sm" onclick="downloadQR()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Télécharger PNG</button></div></div></div>
    </div></div>`;

    // 4. Sécurité
    h+=`<div class="settings-card"><div class="sc-h"><h3>${IC.lock} Sécurité</h3></div><div class="sc-body">
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

    h+=`<div class="settings-card"><div class="sc-h"><h3>${IC.creditCard} Plan & Facturation</h3></div><div class="sc-body">`;

    // Trial banner
    if(subStatus.is_trialing){
      h+=`<div style="padding:14px 18px;background:var(--coral-lighter);border:1px solid var(--coral-border);border-radius:10px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div><span style="font-size:.88rem;font-weight:700;color:var(--coral-dark)">${IC.gift} Période d'essai en cours</span><br><span style="font-size:.78rem;color:var(--text-3)">${subStatus.trial_days_left} jour${subStatus.trial_days_left>1?'s':''} restants — Votre carte ne sera débitée qu'à la fin de l'essai</span></div>
      </div>`;
    }

    // Past due warning
    if(subStatus.subscription_status==='past_due'){
      h+=`<div style="padding:14px 18px;background:var(--red-bg);border:1px solid var(--red-border);border-radius:10px;margin-bottom:16px">
        <span style="font-size:.88rem;font-weight:700;color:var(--red)">${IC.alertTriangle} Paiement échoué</span><br>
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
    h+=`<div class="settings-card danger-zone"><div class="sc-h"><h3>${IC.alertTriangle} Zone danger</h3></div><div class="sc-body">
      <p style="font-size:.85rem;color:var(--text-2);margin-bottom:12px">Supprimer définitivement votre compte et toutes les données associées. Cette action est irréversible.</p>
      <button class="btn-outline btn-danger" onclick="confirmDeleteAccount()">Supprimer mon compte</button>
    </div></div>`;

    c.innerHTML=h;

    // Dirty guard — warns before navigating away with unsaved changes
    window._settingsGuard?.destroy();
    window._settingsGuard = guardModal(c);

    // Global toggle visual sync — updates track color + knob on any checkbox change
    c.addEventListener('change', e=>{
      const cb=e.target;
      if(cb.type!=='checkbox')return;
      const label=cb.closest('label');
      if(!label)return;
      const track=label.querySelector('span:nth-child(2)');
      const knob=label.querySelector('span:nth-child(3)');
      if(track&&knob){
        const on=cb.checked;
        track.style.background=on?'var(--primary)':'var(--border)';
        knob.style.left=on?'22px':'2px';
      }
    });

    // Draw QR code
    setTimeout(()=>drawQR(lk.qr_data||lk.booking_url||''),50);
  }catch(e){c.innerHTML=`<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;}
}

async function saveAllSettings(){
  const btn=document.getElementById('settingsSaveBtn');
  if(!btn)return;
  btn.disabled=true;btn.textContent='Enregistrement...';

  try{
    // Collect ALL fields into one PATCH body
    const body={};

    // Business info
    const el=id=>document.getElementById(id);
    if(el('s_name'))Object.assign(body,{
      name:el('s_name').value,slug:el('s_slug').value,email:el('s_email').value,
      phone:el('s_phone').value,address:el('s_address').value,
      bce_number:el('s_bce').value,accreditation:el('s_accred').value,
      tagline:el('s_tagline').value,description:el('s_desc').value,
      founded_year:el('s_year').value||null,languages_spoken:el('s_langs').value,
      parking_info:el('s_parking').value,
      settings_iban:el('s_iban').value,settings_bic:el('s_bic').value,
      settings_invoice_footer:el('s_inv_footer').value
    });

    // Sector
    if(el('s_sector'))body.sector=el('s_sector').value;

    // SEO
    if(el('s_seo_title'))Object.assign(body,{
      seo_title:el('s_seo_title').value,seo_description:el('s_seo_desc').value
    });

    // Calendar settings
    if(el('s_slot_inc')){
      const cm=el('s_color_mode').value||'category';
      Object.assign(body,{
        settings_slot_increment_min:parseInt(el('s_slot_inc').value)||15,
        settings_waitlist_mode:el('s_waitlist').value||'off',
        settings_calendar_color_mode:cm,
        settings_slot_auto_optimize:el('s_slot_auto_optimize')?.checked??true,
        settings_gap_analyzer_enabled:el('s_gap_analyzer')?.checked||false,
        settings_featured_slots_enabled:el('s_featured_slots')?.checked||false,
        settings_last_minute_enabled:el('s_last_minute')?.checked||false,
        settings_last_minute_deadline:el('s_lm_deadline')?.value||'j-1',
        settings_last_minute_discount_pct:parseInt(el('s_lm_discount')?.value)||10,
        settings_last_minute_min_price_cents:parseInt(el('s_lm_min_price')?.value)||0
      });
    }

    // Reminder settings
    if(el('s_rem_email_24h'))Object.assign(body,{
      settings_reminder_email_24h:el('s_rem_email_24h').checked,
      settings_reminder_sms_24h:el('s_rem_sms_24h')?.checked||false,
      settings_reminder_sms_2h:el('s_rem_sms_2h')?.checked||false,
      settings_reminder_email_2h:el('s_rem_email_2h').checked
    });

    // Deposit / cancel settings
    if(el('s_dep_enabled'))Object.assign(body,{
      settings_deposit_enabled:el('s_dep_enabled').checked,
      settings_deposit_noshow_threshold:el('s_dep_threshold')?.value||2,
      settings_deposit_type:el('s_dep_type')?.value||'percent',
      settings_deposit_percent:parseInt(el('s_dep_percent')?.value)||50,
      settings_deposit_fixed_cents:Math.round((parseFloat(el('s_dep_fixed')?.value)||25)*100),
      settings_deposit_deadline_hours:parseInt(el('s_dep_deadline')?.value)||48,
      settings_deposit_message:el('s_dep_message')?.value||'',
      settings_deposit_deduct:el('s_dep_deduct')?.checked??true,
      settings_deposit_price_threshold_cents:Math.round((parseFloat(el('s_dep_price_thresh')?.value)||0)*100),
      settings_deposit_duration_threshold_min:parseInt(el('s_dep_dur_thresh')?.value)||0,
      settings_deposit_threshold_mode:el('s_dep_thresh_mode')?.value||'any',
      settings_cancel_deadline_hours:parseInt(el('s_cancel_deadline')?.value)||48,
      settings_cancel_grace_minutes:(parseInt(el('s_cancel_grace')?.value)||4)*60,
      settings_cancel_policy_text:el('s_cancel_policy')?.value||''
    });

    // Move settings
    if(el('s_move_enabled'))Object.assign(body,{
      settings_move_restriction_enabled:el('s_move_enabled').checked,
      settings_move_deadline_hours:parseInt(el('s_move_deadline')?.value)||48,
      settings_move_grace_hours:parseInt(el('s_move_grace')?.value)||0
    });

    // Gift card settings
    if(el('s_gc_enabled')){
      const amountsStr=el('s_gc_amounts')?.value||'';
      const amounts=amountsStr.split(',').map(s=>Math.round(parseFloat(s.trim())*100)).filter(n=>n>0&&!isNaN(n));
      Object.assign(body,{
        settings_giftcard_enabled:el('s_gc_enabled').checked,
        settings_giftcard_amounts:amounts.length?amounts:[2500,5000,7500,10000],
        settings_giftcard_custom_amount:el('s_gc_custom').checked,
        settings_giftcard_min_amount_cents:Math.round((parseFloat(el('s_gc_min')?.value)||10)*100),
        settings_giftcard_max_amount_cents:Math.round((parseFloat(el('s_gc_max')?.value)||500)*100),
        settings_giftcard_expiry_days:parseInt(el('s_gc_expiry')?.value)||365
      });
    }

    // Reschedule settings
    if(el('s_reschedule_enabled'))Object.assign(body,{
      settings_reschedule_enabled:el('s_reschedule_enabled').checked,
      settings_reschedule_deadline_hours:parseInt(el('s_reschedule_deadline')?.value)||24,
      settings_reschedule_max_count:parseInt(el('s_reschedule_max')?.value)||1,
      settings_reschedule_window_days:parseInt(el('s_reschedule_window')?.value)||30
    });

    // Booking confirmation settings
    if(el('s_booking_confirm_required'))Object.assign(body,{
      settings_booking_confirmation_required:el('s_booking_confirm_required').checked,
      settings_booking_confirmation_timeout:parseInt(el('s_booking_confirm_timeout')?.value)||30,
      settings_booking_confirmation_channel:el('s_booking_confirm_channel')?.value||'email'
    });

    // Send ONE PATCH
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);

    // Update local cache
    const freshBiz=api.getBusiness()||{};
    if(!freshBiz.settings)freshBiz.settings={};
    if(body.settings_calendar_color_mode){
      freshBiz.settings.calendar_color_mode=body.settings_calendar_color_mode;
      freshBiz.settings.slot_increment_min=body.settings_slot_increment_min;
      freshBiz.settings.slot_auto_optimize=body.settings_slot_auto_optimize;
      freshBiz.settings.gap_analyzer_enabled=body.settings_gap_analyzer_enabled;
      freshBiz.settings.featured_slots_enabled=body.settings_featured_slots_enabled;
      freshBiz.settings.last_minute_enabled=body.settings_last_minute_enabled;
      freshBiz.settings.last_minute_deadline=body.settings_last_minute_deadline;
      freshBiz.settings.last_minute_discount_pct=body.settings_last_minute_discount_pct;
      freshBiz.settings.last_minute_min_price_cents=body.settings_last_minute_min_price_cents;
      calState.fcColorMode=body.settings_calendar_color_mode;
      if(window.fcRefresh)window.fcRefresh();
    }
    if(body.settings_move_restriction_enabled!==undefined){
      freshBiz.settings.move_restriction_enabled=body.settings_move_restriction_enabled;
      freshBiz.settings.move_deadline_hours=body.settings_move_deadline_hours;
      freshBiz.settings.move_grace_hours=body.settings_move_grace_hours;
      if(calState.fcBusinessSettings){
        calState.fcBusinessSettings.move_restriction_enabled=body.settings_move_restriction_enabled;
        calState.fcBusinessSettings.move_deadline_hours=body.settings_move_deadline_hours;
        calState.fcBusinessSettings.move_grace_hours=body.settings_move_grace_hours;
      }
    }
    if(body.settings_giftcard_enabled!==undefined){
      freshBiz.settings.giftcard_enabled=body.settings_giftcard_enabled;
      freshBiz.settings.giftcard_amounts=body.settings_giftcard_amounts;
      freshBiz.settings.giftcard_custom_amount=body.settings_giftcard_custom_amount;
      freshBiz.settings.giftcard_min_amount_cents=body.settings_giftcard_min_amount_cents;
      freshBiz.settings.giftcard_max_amount_cents=body.settings_giftcard_max_amount_cents;
      freshBiz.settings.giftcard_expiry_days=body.settings_giftcard_expiry_days;
    }
    if(body.settings_reschedule_enabled!==undefined){
      freshBiz.settings.reschedule_enabled=body.settings_reschedule_enabled;
      freshBiz.settings.reschedule_deadline_hours=body.settings_reschedule_deadline_hours;
      freshBiz.settings.reschedule_max_count=body.settings_reschedule_max_count;
      freshBiz.settings.reschedule_window_days=body.settings_reschedule_window_days;
    }
    api.setBusiness(freshBiz);

    window._settingsGuard?.markClean();
    GendaUI.toast('Paramètres enregistrés','success');
    btn.disabled=false;btn.textContent='Enregistrer';

    // If sector changed, reload
    if(body.sector && body.sector!==window._initialSector){
      GendaUI.toast('Secteur modifié — rechargement...','success');
      setTimeout(()=>location.reload(),1200);
    }
  }catch(e){
    GendaUI.toast('Erreur: '+e.message,'error');
    btn.disabled=false;btn.textContent='Enregistrer';
  }
}

async function savePractitionerChoiceSetting(){
  const on=document.getElementById('s_practitioner_choice').checked;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({settings_practitioner_choice_enabled:on})});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast(on?'Choix du praticien activé':'Choix du praticien désactivé','success');window._settingsGuard?.markClean();
    const span=document.getElementById('s_practitioner_choice').parentElement;
    span.querySelector('span:nth-child(2)').style.background=on?'var(--primary)':'var(--border)';
    span.querySelector('span:nth-child(3)').style.left=on?'22px':'2px';
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveCalendarSettings(){
  try{
    const cm=document.getElementById('s_color_mode').value||'category';
    const data={
      settings_slot_increment_min:parseInt(document.getElementById('s_slot_inc').value)||15,
      settings_waitlist_mode:document.getElementById('s_waitlist').value||'off',
      settings_calendar_color_mode:cm,
      settings_slot_auto_optimize:document.getElementById('s_slot_auto_optimize')?.checked??true,
      settings_gap_analyzer_enabled:document.getElementById('s_gap_analyzer')?.checked||false,
      settings_featured_slots_enabled:document.getElementById('s_featured_slots')?.checked||false,
      settings_last_minute_enabled:document.getElementById('s_last_minute')?.checked||false,
      settings_last_minute_deadline:document.getElementById('s_lm_deadline')?.value||'j-1',
      settings_last_minute_discount_pct:parseInt(document.getElementById('s_lm_discount')?.value)||10,
      settings_last_minute_min_price_cents:parseInt(document.getElementById('s_lm_min_price')?.value)||0
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    // Update local biz cache so other modules see new settings immediately
    const freshBiz=api.getBusiness()||{};
    if(!freshBiz.settings)freshBiz.settings={};
    freshBiz.settings.slot_increment_min=data.settings_slot_increment_min;
    freshBiz.settings.waitlist_mode=data.settings_waitlist_mode;
    freshBiz.settings.calendar_color_mode=data.settings_calendar_color_mode;
    freshBiz.settings.slot_auto_optimize=data.settings_slot_auto_optimize;
    freshBiz.settings.gap_analyzer_enabled=data.settings_gap_analyzer_enabled;
    freshBiz.settings.featured_slots_enabled=data.settings_featured_slots_enabled;
    freshBiz.settings.last_minute_enabled=data.settings_last_minute_enabled;
    freshBiz.settings.last_minute_deadline=data.settings_last_minute_deadline;
    freshBiz.settings.last_minute_discount_pct=data.settings_last_minute_discount_pct;
    freshBiz.settings.last_minute_min_price_cents=data.settings_last_minute_min_price_cents;
    api.setBusiness(freshBiz);
    calState.fcColorMode=cm;
    if(window.fcRefresh)window.fcRefresh();
    GendaUI.toast('Paramètres calendrier enregistrés','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveMultiServicePolicy(){
  const on=document.getElementById('s_multi_service').checked;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({settings_multi_service_enabled:on})});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast(on?'Multi-prestations activé':'Multi-prestations désactivé','success');window._settingsGuard?.markClean();
    const span=document.getElementById('s_multi_service').parentElement;
    span.querySelector('span:nth-child(2)').style.background=on?'var(--primary)':'var(--border)';
    span.querySelector('span:nth-child(3)').style.left=on?'22px':'2px';
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

// ===== Stripe Connect =====
async function loadConnectStatus(){
  const el=document.getElementById('connectBody');
  if(!el)return;
  try{
    const r=await fetch('/api/stripe/connect/status',{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    const st=d.connect_status||'none';
    let html='';
    if(st==='none'){
      html=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
        <div>
          <div style="font-size:.88rem;font-weight:600">Recevoir les paiements</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Connectez votre compte Stripe pour encaisser les acomptes de vos clients</div>
        </div>
        <button class="btn-primary" onclick="connectStripe()" style="flex-shrink:0;margin-left:16px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></svg> Connecter Stripe</button>
      </div>`;
    }else if(st==='onboarding'){
      html=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--gold-border,var(--border));border-radius:var(--radius-sm);background:var(--gold-bg,var(--amber-bg))">
        <div>
          <div style="font-size:.88rem;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--gold,var(--amber));margin-right:6px"></span>Configuration en cours</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Finalisez votre inscription Stripe pour activer les paiements</div>
        </div>
        <button class="btn-primary" onclick="connectStripe()" style="flex-shrink:0;margin-left:16px">Reprendre</button>
      </div>`;
    }else if(st==='active'){
      html=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--green-border,#BBF7D0);border-radius:var(--radius-sm);background:var(--green-bg,#F0FDF4)">
        <div>
          <div style="font-size:.88rem;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--green);margin-right:6px"></span>Paiements actifs</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Votre compte Stripe est connect\u00e9. Les acomptes sont encaiss\u00e9s directement sur votre compte.</div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;margin-left:16px">
          <button class="btn-outline btn-sm" onclick="openStripeDashboard()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg> Dashboard Stripe</button>
          <button class="btn-outline btn-sm" onclick="disconnectStripe()" style="color:var(--red,#EF4444)">D\u00e9connecter</button>
        </div>
      </div>`;
    }else if(st==='restricted'){
      html=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--coral-border,var(--border));border-radius:var(--radius-sm);background:var(--coral-lighter,#FFF1F2)">
        <div>
          <div style="font-size:.88rem;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--coral,#F97316);margin-right:6px"></span>Action requise</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Stripe n\u00e9cessite des informations suppl\u00e9mentaires pour activer les paiements</div>
        </div>
        <button class="btn-primary" onclick="connectStripe()" style="flex-shrink:0;margin-left:16px">Compl\u00e9ter</button>
      </div>`;
    }else{
      html=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1px solid var(--red-border,var(--border));border-radius:var(--radius-sm);background:var(--red-bg)">
        <div>
          <div style="font-size:.88rem;font-weight:600"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red,#EF4444);margin-right:6px"></span>Compte d\u00e9sactiv\u00e9</div>
          <div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Votre compte Stripe a \u00e9t\u00e9 d\u00e9sactiv\u00e9. Contactez le support Stripe.</div>
        </div>
        <button class="btn-outline btn-sm" onclick="connectStripe()">R\u00e9activer</button>
      </div>`;
    }
    // Payment methods accepted on-site
    html+=buildPaymentMethodsUI();
    el.innerHTML=html;
  }catch(e){
    el.innerHTML=`<div style="font-size:.82rem;color:var(--text-4);padding:10px">Impossible de charger le statut Stripe</div>`;
  }
}

const PAYMENT_METHODS=[
  {id:'cash',label:'Espèces',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M2 10h2m16 0h2M2 14h2m16 0h2"/></svg>'},
  {id:'card',label:'Carte bancaire',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>'},
  {id:'bancontact',label:'Bancontact',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/><path d="M6 15h4"/></svg>'},
  {id:'apple_pay',label:'Apple Pay',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-1.5 4.5c0 2 1 3.5 2.5 4.5-1 1.5-2 3-3.5 3-1.5 0-2-.8-3.5-.8s-2.2.8-3.5.8C1 14 0 11 0 8.5 0 4.5 3 2 5.5 2c1.5 0 2.8.8 3.5.8S11 2 12 2z"/><path d="M12 2c0-1 1-2 2.5-2"/></svg>'},
  {id:'google_pay',label:'Google Pay',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 0-3.3 6.5"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>'},
  {id:'payconiq',label:'Payconiq',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><path d="M21 14h-1v3h-3v1h3v3h1v-3h3v-1h-3z"/></svg>'},
  {id:'instant_transfer',label:'Virement instantané',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'},
  {id:'bank_transfer',label:'Virement bancaire',icon:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M12 3l9 7H3z"/><path d="M5 10v8m4-8v8m6-8v8m4-8v8"/></svg>'}
];

function buildPaymentMethodsUI(){
  const b=api.getBusiness();
  const methods=(b&&b.settings&&b.settings.payment_methods)||[];
  let h='<div style="border-top:1px solid var(--border);margin-top:18px;padding-top:18px">';
  h+='<div style="font-size:.88rem;font-weight:600;margin-bottom:4px">Moyens de paiement acceptés sur place</div>';
  h+='<div style="font-size:.75rem;color:var(--text-4);margin-bottom:14px">Affiché sur la page de réservation pour informer vos clients.</div>';
  h+='<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="payMethodsGrid">';
  PAYMENT_METHODS.forEach(pm=>{
    const checked=methods.includes(pm.id);
    h+=`<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid ${checked?'var(--primary)':'var(--border)'};border-radius:var(--radius-sm);cursor:pointer;transition:all .15s;background:${checked?'var(--primary-lightest,#F0FDFA)':'var(--surface)'}" data-pm="${pm.id}">
      <input type="checkbox" value="${pm.id}" ${checked?'checked':''} style="accent-color:var(--primary);width:16px;height:16px;flex-shrink:0" onchange="savePaymentMethods()">
      <span style="display:flex;align-items:center;gap:6px;font-size:.82rem;font-weight:500;color:var(--text)">${pm.icon.replace('<svg ','<svg class="gi" style="width:16px;height:16px;flex-shrink:0" ')}${pm.label}</span>
    </label>`;
  });
  h+='</div></div>';
  return h;
}

async function savePaymentMethods(){
  const grid=document.getElementById('payMethodsGrid');
  if(!grid)return;
  const checked=[...grid.querySelectorAll('input[type="checkbox"]:checked')].map(cb=>cb.value);
  // Update label styling
  grid.querySelectorAll('label[data-pm]').forEach(lbl=>{
    const isOn=checked.includes(lbl.dataset.pm);
    lbl.style.borderColor=isOn?'var(--primary)':'var(--border)';
    lbl.style.background=isOn?'var(--primary-lightest,#F0FDFA)':'var(--surface)';
  });
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({settings_payment_methods:checked})});
    if(!r.ok)throw new Error((await r.json()).error);
    const d=await r.json();
    api.setBusiness(d.business);
    GendaUI.toast('Moyens de paiement enregistrés','success');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function connectStripe(){
  try{
    GendaUI.toast('Redirection vers Stripe...','info');
    const r=await fetch('/api/stripe/connect/onboard',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error);
    window.location.href=d.url;
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function openStripeDashboard(){
  try{
    GendaUI.toast('Ouverture du dashboard...','info');
    const r=await fetch('/api/stripe/connect/dashboard',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error);
    window.location.href=d.url;
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function disconnectStripe(){
  if(!confirm('D\u00e9connecter votre compte Stripe ? Les paiements d\'acomptes ne seront plus possibles.'))return;
  try{
    const r=await fetch('/api/stripe/connect',{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast('Compte Stripe d\u00e9connect\u00e9','success');
    loadConnectStatus();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveDefaultView(view){
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({settings_default_calendar_view:view})});
    if(!r.ok)throw new Error((await r.json()).error);
    const labels={day:'Jour',week:'Semaine',month:'Mois'};
    GendaUI.toast('Vue par d\u00e9faut : '+labels[view],'success');
    document.querySelectorAll('#defaultViewBtns .btn-sm').forEach(b=>b.classList.remove('active'));
    document.querySelector(`#defaultViewBtns .btn-sm[onclick="saveDefaultView('${view}')"]`)?.classList.add('active');
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveOverlapPolicy(){
  const on=document.getElementById('s_overlap').checked;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({settings_allow_overlap:on})});
    if(!r.ok)throw new Error((await r.json()).error);
    calState.fcAllowOverlap=on;
    GendaUI.toast(on?'Chevauchements autorisés':'Chevauchements bloqués','success');window._settingsGuard?.markClean();
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
    GendaUI.toast('Rappels configurés '+IC.check,'success');window._settingsGuard?.markClean();
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
      settings_deposit_price_threshold_cents:Math.round((parseFloat(document.getElementById('s_dep_price_thresh')?.value)||0)*100),
      settings_deposit_duration_threshold_min:parseInt(document.getElementById('s_dep_dur_thresh')?.value)||0,
      settings_deposit_threshold_mode:document.getElementById('s_dep_thresh_mode')?.value||'any',
      settings_cancel_deadline_hours:parseInt(document.getElementById('s_cancel_deadline')?.value)||48,
      settings_cancel_grace_minutes:(parseInt(document.getElementById('s_cancel_grace')?.value)||4)*60,
      settings_cancel_policy_text:document.getElementById('s_cancel_policy')?.value||''
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast('Politique d\'acompte enregistrée','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveMoveSettings(){
  try{
    const data={
      settings_move_restriction_enabled:document.getElementById('s_move_enabled').checked,
      settings_move_deadline_hours:parseInt(document.getElementById('s_move_deadline')?.value)||48,
      settings_move_grace_hours:parseInt(document.getElementById('s_move_grace')?.value)||0
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    const freshBiz=api.getBusiness()||{};
    if(!freshBiz.settings)freshBiz.settings={};
    freshBiz.settings.move_restriction_enabled=data.settings_move_restriction_enabled;
    freshBiz.settings.move_deadline_hours=data.settings_move_deadline_hours;
    freshBiz.settings.move_grace_hours=data.settings_move_grace_hours;
    api.setBusiness(freshBiz);
    if(calState.fcBusinessSettings){
      calState.fcBusinessSettings.move_restriction_enabled=data.settings_move_restriction_enabled;
      calState.fcBusinessSettings.move_deadline_hours=data.settings_move_deadline_hours;
      calState.fcBusinessSettings.move_grace_hours=data.settings_move_grace_hours;
    }
    GendaUI.toast('Paramètres de déplacement enregistrés','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveGiftCardSettings(){
  try{
    const amountsStr=document.getElementById('s_gc_amounts')?.value||'';
    const amounts=amountsStr.split(',').map(s=>Math.round(parseFloat(s.trim())*100)).filter(n=>n>0&&!isNaN(n));
    const data={
      settings_giftcard_enabled:document.getElementById('s_gc_enabled').checked,
      settings_giftcard_amounts:amounts.length?amounts:[2500,5000,7500,10000],
      settings_giftcard_custom_amount:document.getElementById('s_gc_custom').checked,
      settings_giftcard_min_amount_cents:Math.round((parseFloat(document.getElementById('s_gc_min')?.value)||10)*100),
      settings_giftcard_max_amount_cents:Math.round((parseFloat(document.getElementById('s_gc_max')?.value)||500)*100),
      settings_giftcard_expiry_days:parseInt(document.getElementById('s_gc_expiry')?.value)||365
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    const freshBiz=api.getBusiness()||{};
    if(!freshBiz.settings)freshBiz.settings={};
    freshBiz.settings.giftcard_enabled=data.settings_giftcard_enabled;
    freshBiz.settings.giftcard_amounts=data.settings_giftcard_amounts;
    freshBiz.settings.giftcard_custom_amount=data.settings_giftcard_custom_amount;
    freshBiz.settings.giftcard_min_amount_cents=data.settings_giftcard_min_amount_cents;
    freshBiz.settings.giftcard_max_amount_cents=data.settings_giftcard_max_amount_cents;
    freshBiz.settings.giftcard_expiry_days=data.settings_giftcard_expiry_days;
    api.setBusiness(freshBiz);
    GendaUI.toast('Paramètres cartes cadeau enregistrés','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveRescheduleSettings(){
  try{
    const data={
      settings_reschedule_enabled:document.getElementById('s_reschedule_enabled').checked,
      settings_reschedule_deadline_hours:parseInt(document.getElementById('s_reschedule_deadline')?.value)||24,
      settings_reschedule_max_count:parseInt(document.getElementById('s_reschedule_max')?.value)||1,
      settings_reschedule_window_days:parseInt(document.getElementById('s_reschedule_window')?.value)||30
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    const freshBiz=api.getBusiness()||{};
    if(!freshBiz.settings)freshBiz.settings={};
    freshBiz.settings.reschedule_enabled=data.settings_reschedule_enabled;
    freshBiz.settings.reschedule_deadline_hours=data.settings_reschedule_deadline_hours;
    freshBiz.settings.reschedule_max_count=data.settings_reschedule_max_count;
    freshBiz.settings.reschedule_window_days=data.settings_reschedule_window_days;
    api.setBusiness(freshBiz);
    GendaUI.toast('Paramètres de modification client enregistrés','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveBookingConfirmSettings(){
  try{
    const data={
      settings_booking_confirmation_required:document.getElementById('s_booking_confirm_required').checked,
      settings_booking_confirmation_timeout:parseInt(document.getElementById('s_booking_confirm_timeout')?.value)||30,
      settings_booking_confirmation_channel:document.getElementById('s_booking_confirm_channel')?.value||'email'
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast(data.settings_booking_confirmation_required?'Confirmation obligatoire activée':'Confirmation obligatoire désactivée','success');window._settingsGuard?.markClean();
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
    if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast('Informations enregistrées','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveSEO(){
  const body={seo_title:document.getElementById('s_seo_title').value,seo_description:document.getElementById('s_seo_desc').value};
  try{const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok)throw new Error((await r.json()).error);GendaUI.toast('SEO enregistré','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveSector(){
  const sector=document.getElementById('s_sector').value;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({sector})});
    if(!r.ok)throw new Error((await r.json()).error);
    GendaUI.toast('Secteur mis à jour. La page va se recharger...','success');
    setTimeout(()=>location.reload(),1200);
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
  const name=prompt('Tapez le nom de votre salon pour confirmer la suppression :');
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

bridge({ loadSettings, loadConnectStatus, connectStripe, openStripeDashboard, disconnectStripe, saveAllSettings, saveCalendarSettings, savePractitionerChoiceSetting, saveMultiServicePolicy, saveDefaultView, saveOverlapPolicy, saveReminderSettings, saveDepositSettings, saveMoveSettings, saveRescheduleSettings, saveGiftCardSettings, saveBookingConfirmSettings, startCheckout, openStripePortal, saveBusiness, saveSEO, saveSector, changePassword, copyField, confirmDeleteAccount, downloadQR, doLogout, savePaymentMethods });

export { loadSettings, loadConnectStatus, connectStripe, openStripeDashboard, disconnectStripe, saveAllSettings, saveCalendarSettings, savePractitionerChoiceSetting, saveMultiServicePolicy, saveDefaultView, saveOverlapPolicy, saveReminderSettings, saveMoveSettings, saveRescheduleSettings, saveGiftCardSettings, startCheckout, openStripePortal, saveBusiness, saveSEO, saveSector, changePassword, copyField, confirmDeleteAccount, downloadQR, doLogout, savePaymentMethods };
