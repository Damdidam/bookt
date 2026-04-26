/**
 * Settings (Paramètres) view module.
 */
import { api, sectorLabels, calState, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { guardModal, showConfirmDialog } from '../utils/dirty-guard.js';
import { IC } from '../utils/icons.js';

// P1 hotfix (audit scan 2) : ajout apostrophe escape. Avant ce fix, une valeur
// contenant ' pouvait casser un attribut HTML délimité par ' → XSS attribute-break.
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

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
    api.setBusiness(b);
    window._initialSector=b.sector;
    // DEP-01 UI gate : refresh window globals for Home/Clients fallback
    window._businessPlan=b.plan||'free';
    window._stripeConnectId=b.stripe_connect_id||null;
    window._stripeConnectStatus=b.stripe_connect_status||'none';
    const plan=b.plan||'free';
    const stripeConnectActive=!!b.stripe_connect_id && b.stripe_connect_status==='active';
    const depositGated=plan==='free' || !stripeConnectActive;
    const depositGateLabel = plan==='free' ? 'Plan Pro requis' : 'Stripe Connect requis';
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
      <div class="field-row"><div class="field"><label>N° BCE / TVA</label><input id="s_bce" value="${esc(b.bce_number||'')}" placeholder="BE 0xxx.xxx.xxx"></div><div class="field"><label>Année de fondation</label><input id="s_year" type="number" value="${b.founded_year||''}"></div></div>
      <div class="field"><label>Tagline</label><input id="s_tagline" value="${esc(b.tagline||'')}" placeholder="Phrase d'accroche affichée sur votre page"></div>
      <div class="field"><label>Info parking</label><input id="s_parking" value="${esc(b.parking_info||'')}" placeholder="Ex: Parking gratuit à 50m"></div>
      <div style="height:1px;background:var(--border);margin:10px 0"></div>
      <div style="font-size:.75rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:6px">Facturation</div>
      <div class="field-row"><div class="field"><label>IBAN</label><input id="s_iban" value="${esc(b.settings?.iban||'')}" placeholder="BE00 0000 0000 0000"></div><div class="field"><label>BIC</label><input id="s_bic" value="${esc(b.settings?.bic||'')}" placeholder="GEBABEBB"></div></div>
      <div class="field"><label>Pied de page facture</label><input id="s_inv_footer" value="${esc(b.settings?.invoice_footer||'')}" placeholder="Ex: Petit entrepreneur - TVA non applicable art. 56bis CTVA"></div>
    </div></div>`;

    // 1b. Secteur d'activité
    const sectorOptions=[['coiffeur','Coiffeur\u00b7se'],['esthetique','Esthétique'],['barbier','Barbier'],['tatouage','Tatouage'],['onglerie','Onglerie'],['massage','Massage'],['bien_etre','Bien-être'],['bienetre','Bien-être (alt)'],['kine','Kinésithérapie'],['medecin','Médecin'],['dentiste','Dentiste'],['osteopathe','Ostéopathe'],['veterinaire','Vétérinaire / Toilettage'],['photographe','Photographe'],['coaching','Coaching sportif'],['garage','Garage / Auto'],['autre','Autre']];
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
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer${plan==='free'?';opacity:.5;pointer-events:none':''}">
          <span style="position:relative;display:inline-block;width:36px;height:20px">
            <input type="checkbox" id="s_gap_analyzer" style="opacity:0;width:0;height:0;position:absolute"${gapOn&&plan!=='free'?' checked':''} ${plan==='free'?'disabled':''}>
            <span style="position:absolute;inset:0;background:${gapOn&&plan!=='free'?'var(--primary)':'#ccc'};border-radius:20px;transition:background .2s" onclick="const c=document.getElementById('s_gap_analyzer');if(c.disabled)return;c.checked=!c.checked;this.style.background=c.checked?'var(--primary)':'#ccc';this.nextElementSibling.style.transform=c.checked?'translateX(16px)':'translateX(0)'"></span>
            <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;transform:${gapOn&&plan!=='free'?'translateX(16px)':'translateX(0)'};pointer-events:none"></span>
          </span>
          <span style="font-weight:600;font-size:.85rem">Analyseur de gaps${plan==='free'?' <span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">Plan Pro requis</span>':''}</span>
        </div>
        <div class="hint" style="margin-top:4px;margin-left:46px">Détecte automatiquement les créneaux libres entre les RDV et suggère des services compatibles</div>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer${plan==='free'?';opacity:.5;pointer-events:none':''}">
          <span style="position:relative;display:inline-block;width:36px;height:20px">
            <input type="checkbox" id="s_featured_slots" style="opacity:0;width:0;height:0;position:absolute"${fsOn&&plan!=='free'?' checked':''} ${plan==='free'?'disabled':''}>
            <span style="position:absolute;inset:0;background:${fsOn&&plan!=='free'?'var(--primary)':'#ccc'};border-radius:20px;transition:background .2s" onclick="const c=document.getElementById('s_featured_slots');if(c.disabled)return;c.checked=!c.checked;this.style.background=c.checked?'var(--primary)':'#ccc';this.nextElementSibling.style.transform=c.checked?'translateX(16px)':'translateX(0)'"></span>
            <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;transform:${fsOn&&plan!=='free'?'translateX(16px)':'translateX(0)'};pointer-events:none"></span>
          </span>
          <span style="font-weight:600;font-size:.85rem">Mode vedette${plan==='free'?' <span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">Plan Pro requis</span>':''}</span>
        </div>
        <div class="hint" style="margin-top:4px;margin-left:46px">Met en avant les créneaux prioritaires à remplir sur le calendrier</div>
      </div>
      <div style="margin-top:16px;padding-top:16px;border-top:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px;cursor:pointer${plan==='free'?';opacity:.5;pointer-events:none':''}">
          <span style="position:relative;display:inline-block;width:36px;height:20px">
            <input type="checkbox" id="s_last_minute" style="opacity:0;width:0;height:0;position:absolute"${lmOn&&plan!=='free'?' checked':''} ${plan==='free'?'disabled':''}>
            <span style="position:absolute;inset:0;background:${lmOn&&plan!=='free'?'var(--amber)':'#ccc'};border-radius:20px;transition:background .2s" onclick="const c=document.getElementById('s_last_minute');c.checked=!c.checked;this.style.background=c.checked?'var(--amber)':'#ccc';this.nextElementSibling.style.transform=c.checked?'translateX(16px)':'translateX(0)';document.getElementById('lm_details').style.display=c.checked?'grid':'none'"></span>
            <span style="position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;transform:${lmOn&&plan!=='free'?'translateX(16px)':'translateX(0)'};pointer-events:none"></span>
          </span>
          <span style="font-weight:600;font-size:.85rem">Promotions dernière minute</span>
          ${plan==='free'?'<span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">Plan Pro requis</span>':''}
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

    // 3a-ter. Annulation & remboursement (standalone, applies to all deposit refunds — auto or manual)
    const canDl=b.settings?.cancel_deadline_hours||24;
    const canGrace=b.settings?.cancel_grace_minutes||240;
    const canPolicy=b.settings?.cancel_policy_text||'';
    const refundPolicy=b.settings?.refund_policy||'full';
    const _crPro=plan!=='free';
    h+=`<div class="settings-card"${_crPro?'':' style="opacity:.6"'}><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Annulation & remboursement${_crPro?'':' <span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">Plan Pro requis</span>'}</h3></div><div class="sc-body"${_crPro?'':' style="pointer-events:none"'}>`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Règles d'annulation et politique de remboursement. S'appliquent à toute annulation d'un acompte (demande automatique ou manuelle).</p>`;
    // Cancellation policy
    h+=`<div style="font-size:.78rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:10px">Politique d'annulation</div>`;
    h+=`<p style="font-size:.78rem;color:var(--text-4);margin-bottom:12px">Définissez les conditions de remboursement de l'acompte en cas d'annulation.</p>`;
    h+=`<div class="field"><label>Délai d'annulation gratuite</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Remboursé si annulé plus de</span><input type="number" id="s_cancel_deadline" value="${canDl}" min="1" max="168" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures avant le RDV</span></div><div class="hint">En-dessous de ce délai, l'acompte est conservé</div></div>`;
    h+=`<div class="field"><label>Période de grâce post-réservation</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Annulation gratuite dans les</span><input type="number" id="s_cancel_grace" value="${Math.round(canGrace/60)}" min="0" max="48" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">heures après la réservation</span></div><div class="hint">Le client peut annuler sans frais juste après avoir réservé, même si le RDV est proche</div></div>`;
    h+=`<div class="field"><label>Texte de politique d'annulation (optionnel)</label><textarea id="s_cancel_policy" placeholder="Ex: Toute annulation moins de 48h avant le RDV entraîne la perte de l'acompte..." style="width:100%;padding:10px 13px;border:1.5px solid var(--border);border-radius:8px;font-family:var(--sans);font-size:.82rem;resize:vertical;min-height:50px">${esc(canPolicy)}</textarea><div class="hint">Affiché dans les emails et sur la page de réservation</div></div>`;
    // Separator
    h+=`<div style="height:1px;background:var(--border);margin:18px 0 14px"></div>`;
    // Refund policy
    h+=`<div style="font-size:.78rem;font-weight:700;color:var(--text-3);text-transform:uppercase;margin-bottom:10px">Politique de remboursement Stripe</div>`;
    h+=`<p style="font-size:.78rem;color:var(--text-4);margin-bottom:12px">Choisissez comment les acomptes sont remboursés en cas d'annulation dans le délai autorisé.</p>`;
    h+=`<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">`;
    h+=`<label style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:10px;border:1.5px solid ${refundPolicy==='full'?'var(--primary)':'var(--border)'};background:${refundPolicy==='full'?'var(--primary-light)':'var(--surface)'};cursor:pointer;transition:all .15s" onclick="document.getElementById('s_refund_full').checked=true;document.querySelectorAll('.refund-opt').forEach(e=>e.style.borderColor='var(--border)');this.style.borderColor='var(--primary)';this.style.background='var(--primary-light)';document.querySelectorAll('.refund-opt').forEach(e=>{if(e!==this){e.style.background='var(--surface)'}});" class="refund-opt">
      <input type="radio" name="refund_policy" id="s_refund_full" value="full" ${refundPolicy==='full'?'checked':''} style="accent-color:var(--primary)">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Remboursement int\u00e9gral</div><div style="font-size:.75rem;color:var(--text-4)">Le client est rembours\u00e9 \u00e0 100%. Les frais Stripe (~1,5% + 0,25\u20ac) sont \u00e0 votre charge.</div></div>
    </label>`;
    h+=`<label style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:10px;border:1.5px solid ${refundPolicy==='net'?'var(--primary)':'var(--border)'};background:${refundPolicy==='net'?'var(--primary-light)':'var(--surface)'};cursor:pointer;transition:all .15s" onclick="document.getElementById('s_refund_net').checked=true;document.querySelectorAll('.refund-opt').forEach(e=>e.style.borderColor='var(--border)');this.style.borderColor='var(--primary)';this.style.background='var(--primary-light)';document.querySelectorAll('.refund-opt').forEach(e=>{if(e!==this){e.style.background='var(--surface)'}});" class="refund-opt">
      <input type="radio" name="refund_policy" id="s_refund_net" value="net" ${refundPolicy==='net'?'checked':''} style="accent-color:var(--primary)">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Remboursement partiel (frais Stripe d\u00e9duits)</div><div style="font-size:.75rem;color:var(--text-4)">Le client est rembours\u00e9 moins les frais Stripe. Vous ne perdez rien sur les annulations.</div><div style="font-size:.7rem;color:#92700C;margin-top:6px;padding:6px 8px;background:#FEF3E2;border-radius:6px;line-height:1.4">\u26a0\ufe0f Minimum Stripe : 50\u202fcents. Si l'acompte est inf\u00e9rieur \u00e0 ~76\u00a0c (ou si les frais d\u00e9passent), le remboursement est techniquement impossible et l'acompte sera retenu automatiquement (le client sera inform\u00e9 par email).</div></div>
    </label>`;
    h+=`</div>`;
    h+=`</div></div>`;

    // 3b. Rappels clients
    const re24=b.settings?.reminder_email_24h!==false;
    const rs24=b.settings?.reminder_sms_24h===true;
    const rs2=b.settings?.reminder_sms_2h===true;
    const re2=b.settings?.reminder_email_2h===true;
    const hasSms=plan!=='free';
    h+=`<div class="settings-card"><div class="sc-h"><h3>${IC.bell} Rappels clients</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Les rappels sont envoyés automatiquement aux clients avant leur rendez-vous. Réduisez les no-shows jusqu'à 50%.</p>`;

    h+=`<div style="display:flex;flex-direction:column;gap:10px">`;

    // Email 24h — all plans
    h+=buildReminderToggle('s_rem_email_24h', re24, IC.mail+' Email — 24h avant', 'Rappel par email la veille du RDV', true);

    // SMS 24h — Pro
    h+=buildReminderToggle('s_rem_sms_24h', rs24, '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS — 24h avant', hasSms?'SMS de rappel la veille du RDV':'<span style="color:var(--coral)">Disponible avec le plan Pro</span>', hasSms);

    // SMS 2h — Pro
    h+=buildReminderToggle('s_rem_sms_2h', rs2, '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg> SMS — 2h avant', hasSms?'Rappel de dernière minute le jour même':'<span style="color:var(--coral)">Disponible avec le plan Pro</span>', hasSms);

    // Email 2h — optional
    h+=buildReminderToggle('s_rem_email_2h', re2, IC.mail+' Email — 2h avant', 'Rappel email le jour même (optionnel)', true);

    h+=`</div>`;

    if(!hasSms){
      h+=`<div style="margin-top:14px;padding:12px 16px;background:var(--coral-lighter);border:1px solid var(--coral-border);border-radius:8px;font-size:.82rem;color:var(--coral-dark)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg> Les rappels SMS sont disponibles avec le plan <strong>Pro (60\u20ac/mois)</strong>. <a href="#" onclick="document.querySelector('[data-section=settings]').click();setTimeout(()=>document.querySelector('.plan-box:nth-child(2) .btn-primary')?.scrollIntoView({behavior:'smooth'}),100)" style="color:var(--coral-dark);font-weight:600">Voir les plans \u2192</a></div>`;
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

    // Master toggle (DEP-01 gate : disabled si pas Pro OU pas Stripe Connect actif)
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:16px${depositGated?';opacity:.5':''}">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Activer les acomptes${depositGated?` <span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">${depositGateLabel}</span>`:''}</div><div style="font-size:.75rem;color:var(--text-4)">Demander un acompte aux clients récidivistes</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:${depositGated?'not-allowed':'pointer'}">
        <input type="checkbox" id="s_dep_enabled" ${depOn&&!depositGated?'checked':''} ${depositGated?'disabled':''} onchange="document.getElementById('depositOptions').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${depOn&&!depositGated?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${depOn&&!depositGated?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;

    // Conditional options
    h+=`<div id="depositOptions" style="display:${depOn&&!depositGated?'block':'none'}">`;

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
      <input type="number" id="s_dep_fixed" value="${(depFixed/100).toFixed(2)}" min="1" step="0.5" style="width:100px;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;text-align:right">
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

    h+=`</div>`; // close depositOptions

    h+=`</div></div>`;

    // ── Cancellation abuse limit (H14 fix: indépendant des acomptes — carte propre) ──
    const cancelLimitOn=!!(b.settings?.cancel_abuse_enabled);
    const cancelLimitMax=b.settings?.cancel_abuse_max||5;
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Protection anti-abus</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Bloquez automatiquement les clients qui annulent de mani\u00e8re r\u00e9p\u00e9titive.</p>`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:12px">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Limiter les annulations r\u00e9p\u00e9t\u00e9es</div><div style="font-size:.75rem;color:var(--text-4)">Bloque le client apr\u00e8s trop d'annulations cons\u00e9cutives</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:pointer">
        <input type="checkbox" id="s_cancel_abuse_on" ${cancelLimitOn?'checked':''} onchange="document.getElementById('cancelAbuseOpts').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${cancelLimitOn?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${cancelLimitOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    h+=`<div id="cancelAbuseOpts" style="display:${cancelLimitOn?'block':'none'}">`;
    h+=`<div class="field"><label>Seuil d'annulations</label><div style="display:flex;align-items:center;gap:8px"><span style="font-size:.82rem;color:var(--text-3)">Bloquer apr\u00e8s</span><input type="number" id="s_cancel_abuse_max" value="${cancelLimitMax}" min="2" max="20" style="width:60px;text-align:center;padding:8px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem"><span style="font-size:.82rem;color:var(--text-3)">annulations cons\u00e9cutives</span></div><div class="hint">Le client sera bloqu\u00e9 et ne pourra plus r\u00e9server en ligne. D\u00e9blocage manuel depuis la fiche client.</div></div>`;
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
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:16px${depositGated?';opacity:.5':''}">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Activer les cartes cadeau${depositGated?` <span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">${depositGateLabel}</span>`:''}</div><div style="font-size:.75rem;color:var(--text-4)">Un bouton "Carte cadeau" apparaîtra sur votre minisite</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:${depositGated?'not-allowed':'pointer'}">
        <input type="checkbox" id="s_gc_enabled" ${gcOn&&!depositGated?'checked':''} ${depositGated?'disabled':''} onchange="document.getElementById('gcOptions').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${gcOn&&!depositGated?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${gcOn&&!depositGated?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    h+=`<div id="gcOptions" style="display:${gcOn?'block':'none'}">`;
    h+=`<div class="field"><label>Montants prédéfinis (€)</label><input type="text" id="s_gc_amounts" value="${gcAmounts.map(a=>(a/100)).join(', ')}" placeholder="25, 50, 75, 100" style="padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:.85rem;width:100%;font-family:var(--sans)"><div class="hint">Séparez les montants par des virgules</div></div>`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:var(--radius-sm);margin-bottom:14px">
      <div><div style="font-size:.85rem;font-weight:600">Autoriser un montant libre</div><div style="font-size:.75rem;color:var(--text-4)">Le client peut saisir le montant de son choix</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:pointer;flex-shrink:0">
        <input type="checkbox" id="s_gc_custom" ${gcCustom?'checked':''} style="display:none">
        <span style="position:absolute;inset:0;background:${gcCustom?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${gcCustom?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    h+=`<div style="display:flex;gap:24px;margin-bottom:14px"><div class="field" style="flex:1"><label>Montant min/max (€)</label><div style="display:flex;align-items:center;gap:8px"><input type="number" id="s_gc_min" value="${gcMin}" min="5" style="width:80px;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;text-align:center"><span style="color:var(--text-3)">à</span><input type="number" id="s_gc_max" value="${gcMax}" min="10" style="width:80px;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;text-align:center"></div></div><div class="field"><label>Validité</label><div style="display:flex;align-items:center;gap:8px"><input type="number" id="s_gc_expiry" value="${gcExpiry}" min="30" max="730" style="width:70px;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;text-align:center"><span style="font-size:.82rem;color:var(--text-3)">jours</span></div></div></div>`;
    h+=`</div>`;
    h+=`</div></div>`;

    // 3a-ter. Passes / Abonnements
    const passOn=!!b.settings?.passes_enabled;
    const passExpiry=b.settings?.pass_validity_days||365;
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/></svg> Abonnements</h3></div><div class="sc-body">`;
    h+=`<p style="font-size:.82rem;color:var(--text-3);margin-bottom:16px">Proposez des packs de séances à vos clients. Les formules se configurent dans la fiche de chaque prestation.</p>`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:var(--surface);border-radius:10px;margin-bottom:16px${depositGated?';opacity:.5':''}">
      <div><div style="font-size:.85rem;font-weight:600;color:var(--text)">Activer les abonnements${depositGated?` <span style="font-size:.72rem;color:var(--primary);font-weight:500;margin-left:8px">${depositGateLabel}</span>`:''}</div><div style="font-size:.75rem;color:var(--text-4)">Une page "Abonnements" apparaîtra sur votre minisite</div></div>
      <label style="position:relative;width:44px;height:24px;cursor:${depositGated?'not-allowed':'pointer'};flex-shrink:0">
        <input type="checkbox" id="s_passes_enabled" ${passOn&&!depositGated?'checked':''} ${depositGated?'disabled':''} onchange="document.getElementById('passOptions').style.display=this.checked?'block':'none'" style="display:none">
        <span style="position:absolute;inset:0;background:${passOn&&!depositGated?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${passOn&&!depositGated?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    h+=`<div id="passOptions" style="display:${passOn?'block':'none'}">`;
    h+=`<div class="field"><label>Validité par défaut</label><div style="display:flex;align-items:center;gap:8px"><input type="number" id="s_pass_expiry" value="${passExpiry}" min="30" max="730" style="width:70px;padding:8px 12px;border:1.5px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;text-align:center"><span style="font-size:.82rem;color:var(--text-3)">jours</span></div></div>`;
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

    // 3c. Notifications commerçant
    const notifProOn=b.settings?.notify_new_booking_pro!==false;
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg> Notifications</h3></div><div class="sc-body">`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border:1.5px solid var(--border);border-radius:var(--radius-sm);background:var(--surface)">
      <div><div style="font-size:.88rem;font-weight:600">Email à chaque nouveau RDV</div><div style="font-size:.75rem;color:var(--text-4);margin-top:2px">Recevoir un email lorsqu'un client prend rendez-vous en ligne</div></div>
      <label style="position:relative;display:inline-flex;width:44px;height:24px;flex-shrink:0;margin-left:16px;cursor:pointer">
        <input type="checkbox" id="s_notify_new_booking_pro" ${notifProOn?'checked':''} style="display:none">
        <span style="position:absolute;inset:0;background:${notifProOn?'var(--primary)':'var(--border)'};border-radius:12px;transition:all .2s"></span>
        <span style="position:absolute;left:${notifProOn?'22px':'2px'};top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:all .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)"></span>
      </label>
    </div>`;
    h+=`</div></div>`;

    // 4. Lien public & widget
    h+=`<div class="settings-card"><div class="sc-h"><h3><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Lien public & Widget</h3></div><div class="sc-body">
      <div class="field"><label>URL de réservation</label><div class="copy-input"><input id="s_url" value="${esc(lk.booking_url||'')}" readonly><button class="btn-outline btn-sm" onclick="copyField('s_url')">${IC.clipboard} Copier</button></div></div>
      <div class="field"><label>Code widget embeddable</label><div class="copy-input"><input id="s_widget" value="${esc(lk.widget_code||'')}" readonly style="font-size:.72rem"><button class="btn-outline btn-sm" onclick="copyField('s_widget')">${IC.clipboard} Copier</button></div><div class="hint">Collez ce code sur votre site existant pour ajouter un bouton de réservation</div></div>
      <div class="field"><label>QR Code</label><div class="hint">Scannez pour accéder à votre page publique</div><div style="margin-top:8px;padding:16px;background:var(--surface);border-radius:8px;text-align:center">${lk.qr_image?`<img id="qrImage" src="${esc(lk.qr_image)}" alt="QR Code" style="width:160px;height:160px">`:'<div style="color:var(--text-4);font-size:.82rem">QR code non disponible</div>'}<div style="margin-top:8px">${lk.qr_image?`<button class="btn-outline btn-sm" onclick="downloadQR()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Télécharger PNG</button>`:''}</div></div></div>
    </div></div>`;

    // 4. Sécurité
    h+=`<div class="settings-card"><div class="sc-h"><h3>${IC.lock} Sécurité</h3></div><div class="sc-body">
      <p style="font-size:.85rem;color:var(--text-3);margin-bottom:14px">Connecté en tant que <strong>${esc(u.email)}</strong> · Rôle : ${sectorLabels[u.role]||u.role}${u.last_login_at?' · Dernière connexion : '+new Date(u.last_login_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'}):''}</p>
      <div class="field"><label>Mot de passe actuel</label><input id="s_pwd_current" type="password" autocomplete="current-password"></div>
      <div class="field-row"><div class="field"><label>Nouveau mot de passe</label><input id="s_pwd_new" type="password" placeholder="Min. 8 caractères" autocomplete="new-password"></div><div class="field"><label>Confirmer</label><input id="s_pwd_confirm" type="password" autocomplete="new-password"></div></div>
    </div><div class="sc-foot"><button class="btn-primary" onclick="changePassword()">Changer le mot de passe</button></div></div>`;

    // 5. Plan & facturation

    // Fetch subscription status
    let subStatus={};
    try{
      const sr=await fetch('/api/stripe/status',{headers:{'Authorization':'Bearer '+api.getToken()}});
      if(sr.ok) subStatus=await sr.json();
    }catch(e){console.error('Stripe status error:',e);}

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

    h+=`<div class="plan-card" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:640px">
    <div class="plan-box${plan==='free'?' current':''}">
      ${plan==='free'?'<span class="current-badge">Actuel</span>':''}
      <div class="plan-name">Gratuit</div>
      <div class="plan-price">0 \u20ac<span>/mois</span></div>
      <ul><li>1 praticien</li><li>25 RDV/semaine en ligne</li><li>Minisite sur genda.be</li><li>Rappels email (24h + 2h)</li><li>Gestion clients illimit\u00e9s</li><li>1 promotion</li><li>Cr\u00e9neaux vedettes</li></ul>
    </div>
    <div class="plan-box${plan==='pro'?' current':''}" style="border-color:var(--primary)">
      ${plan==='pro'?'<span class="current-badge">Actuel</span>':'<span style="position:absolute;top:-10px;right:12px;background:var(--primary);color:#fff;font-size:.68rem;padding:2px 8px;border-radius:10px;font-weight:700">RECOMMAND\u00c9</span>'}
      <div class="plan-name">Pro</div>
      <div class="plan-price">60 \u20ac<span>/mois</span></div>
      <ul><li>Praticiens + RDV illimit\u00e9s</li><li>Rappels SMS (24h + 2h)</li><li>Acomptes Stripe</li><li>Cartes cadeau + abonnements</li><li>Promos illimit\u00e9es + last-minute</li><li>Analytics + heatmap</li><li>Liste d'attente</li><li>Facturation PDF</li><li>Sync Google/Outlook</li><li>Domaine personnalis\u00e9</li></ul>
      ${plan==='free'?'<button class="btn-primary" style="width:100%;margin-top:8px" onclick="startCheckout(\'pro\')">Passer au Pro \u2192</button>':''}
      ${plan==='pro'&&subStatus.has_subscription?'<button class="btn-outline" style="width:100%;margin-top:8px" onclick="openStripePortal()">G\u00e9rer l\'abonnement</button>':''}
    </div>
  </div>`;

    // Manage subscription link
    if(subStatus.has_subscription){
      h+=`<div style="margin-top:14px;text-align:center"><button class="btn-outline btn-sm" onclick="openStripePortal()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg> Gérer mon abonnement · Factures · Moyen de paiement</button></div>`;
    }

    h+=`</div></div>`;

    // 7. Danger zone
    h+=`<div class="settings-card danger-zone"><div class="sc-h"><h3>${IC.alertTriangle} Zone danger</h3></div><div class="sc-body">
      <div style="margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid var(--border)">
        <div style="font-size:.85rem;font-weight:600;color:var(--text);margin-bottom:4px">Exporter mes données</div>
        <p style="font-size:.8rem;color:var(--text-3);margin-bottom:10px">Téléchargez vos données clients et factures au format CSV (Excel, Google Sheets).</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn-outline btn-sm" onclick="exportData('clients')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> Exporter clients</button>
          <button class="btn-outline btn-sm" onclick="exportData('invoices')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> Exporter factures</button>
        </div>
      </div>
      <p style="font-size:.85rem;color:var(--text-2);margin-bottom:4px">Fermer votre compte et désactiver votre salon. Vos clients impactés seront notifiés.</p>
      <p style="font-size:.78rem;color:var(--text-4);margin-bottom:12px">Pensez à exporter vos données avant de fermer votre compte.</p>
      <button class="btn-outline btn-danger" onclick="confirmDeleteAccount()">Fermer mon compte</button>
    </div></div>`;

    c.innerHTML=h;

    // Dirty guard — warns before navigating away with unsaved changes
    window._settingsGuard?.destroy();
    window._settingsGuard = guardModal(c, { noBackdropClose: true });

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
      bce_number:el('s_bce').value,
      tagline:el('s_tagline').value,
      founded_year:el('s_year').value||null,
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
        // Skip toggles disabled (plan=free) pour eviter flip silencieux true→false (parite deposit/sms).
        ...(el('s_gap_analyzer') && !el('s_gap_analyzer').disabled ? { settings_gap_analyzer_enabled:el('s_gap_analyzer').checked||false } : {}),
        ...(el('s_featured_slots') && !el('s_featured_slots').disabled ? { settings_featured_slots_enabled:el('s_featured_slots').checked||false } : {}),
        // Skip s_last_minute + sub-fields si toggle disabled (plan=free) pour eviter
        // flip silencieux des 4 fields (audit batch 17 P1 — parite saveCalendarSettings).
        ...(el('s_last_minute') && !el('s_last_minute').disabled ? {
          settings_last_minute_enabled:el('s_last_minute').checked||false,
          settings_last_minute_deadline:el('s_lm_deadline')?.value||'j-1',
          settings_last_minute_discount_pct:parseInt(el('s_lm_discount')?.value)||10,
          settings_last_minute_min_price_cents:parseInt(el('s_lm_min_price')?.value)||0
        } : {})
      });
    }

    // Reminder settings — guard SMS toggles disabled (plan=free) pour eviter flip silencieux.
    if(el('s_rem_email_24h'))Object.assign(body,{
      settings_reminder_email_24h:el('s_rem_email_24h').checked,
      ...(el('s_rem_sms_24h') && !el('s_rem_sms_24h').disabled ? { settings_reminder_sms_24h:el('s_rem_sms_24h').checked } : {}),
      ...(el('s_rem_sms_2h') && !el('s_rem_sms_2h').disabled ? { settings_reminder_sms_2h:el('s_rem_sms_2h').checked } : {}),
      settings_reminder_email_2h:el('s_rem_email_2h').checked
    });

    // Deposit settings — skip si toggle disabled (Plan free OU Stripe Connect inactif)
    // pour eviter un flip silencieux deposit_enabled=true→false au save quand le pro
    // perd ses prerequis Stripe (audit batch 15 P1).
    if(el('s_dep_enabled') && !el('s_dep_enabled').disabled)Object.assign(body,{
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
      settings_deposit_threshold_mode:el('s_dep_thresh_mode')?.value||'any'
    });

    // R6 fix: Cancel/refund settings (carte standalone post-b7fa02c) — save séparé pour que
    // si la carte deposit n'est pas rendue, ces settings soient quand même sauvegardés.
    if(el('s_cancel_deadline'))Object.assign(body,{
      settings_cancel_deadline_hours:parseInt(el('s_cancel_deadline')?.value)||24,
      settings_cancel_grace_minutes:(Number.isFinite(parseInt(el('s_cancel_grace')?.value))?parseInt(el('s_cancel_grace')?.value):4)*60,
      settings_cancel_policy_text:el('s_cancel_policy')?.value||'',
      settings_refund_policy:document.querySelector('input[name="refund_policy"]:checked')?.value||'full'
    });

    // H14 fix: cancel_abuse est une carte indépendante — save gardé séparé
    if(el('s_cancel_abuse_on'))Object.assign(body,{
      settings_cancel_abuse_enabled:el('s_cancel_abuse_on').checked,
      settings_cancel_abuse_max:parseInt(el('s_cancel_abuse_max')?.value)||5
    });

    // Gift card settings
    if(el('s_gc_enabled') && !el('s_gc_enabled').disabled){
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
    // Pass settings
    if(el('s_passes_enabled') && !el('s_passes_enabled').disabled){
      Object.assign(body,{
        settings_passes_enabled:el('s_passes_enabled').checked,
        settings_pass_validity_days:parseInt(el('s_pass_expiry')?.value)||365
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
      settings_booking_confirmation_channel:el('s_booking_confirm_channel')?.value||'email',
      settings_notify_new_booking_pro:el('s_notify_new_booking_pro')?.checked??true
    });

    // Send ONE PATCH
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}

    // Update local cache
    const freshBiz=api.getBusiness()||{};
    if(!freshBiz.settings)freshBiz.settings={};
    if(body.settings_calendar_color_mode){
      freshBiz.settings.calendar_color_mode=body.settings_calendar_color_mode;
      freshBiz.settings.slot_increment_min=body.settings_slot_increment_min;
      freshBiz.settings.slot_auto_optimize=body.settings_slot_auto_optimize;
      if (body.settings_gap_analyzer_enabled !== undefined) freshBiz.settings.gap_analyzer_enabled=body.settings_gap_analyzer_enabled;
      if (body.settings_featured_slots_enabled !== undefined) freshBiz.settings.featured_slots_enabled=body.settings_featured_slots_enabled;
      // Cache last_minute uniquement si payload contenait les keys (parite saveCalendarSettings batch 17).
      if (body.settings_last_minute_enabled !== undefined) {
        freshBiz.settings.last_minute_enabled=body.settings_last_minute_enabled;
        freshBiz.settings.last_minute_deadline=body.settings_last_minute_deadline;
        freshBiz.settings.last_minute_discount_pct=body.settings_last_minute_discount_pct;
        freshBiz.settings.last_minute_min_price_cents=body.settings_last_minute_min_price_cents;
      }
      calState.fcColorMode=body.settings_calendar_color_mode;
      if(window.fcRefresh)window.fcRefresh();
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
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
    GendaUI.toast(on?'Choix du praticien activé':'Choix du praticien désactivé','success');window._settingsGuard?.markClean();
    const span=document.getElementById('s_practitioner_choice').parentElement;
    span.querySelector('span:nth-child(2)').style.background=on?'var(--primary)':'var(--border)';
    span.querySelector('span:nth-child(3)').style.left=on?'22px':'2px';
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveCalendarSettings(){
  try{
    const cm=document.getElementById('s_color_mode').value||'category';
    const lmEl=document.getElementById('s_last_minute');
    const data={
      settings_slot_increment_min:parseInt(document.getElementById('s_slot_inc').value)||15,
      settings_waitlist_mode:document.getElementById('s_waitlist').value||'off',
      settings_calendar_color_mode:cm,
      settings_slot_auto_optimize:document.getElementById('s_slot_auto_optimize')?.checked??true,
      // Skip toggles disabled (plan=free) pour eviter flip silencieux true→false.
      ...((()=>{const g=document.getElementById('s_gap_analyzer');return g && !g.disabled ? { settings_gap_analyzer_enabled:g.checked||false } : {};})()),
      ...((()=>{const f=document.getElementById('s_featured_slots');return f && !f.disabled ? { settings_featured_slots_enabled:f.checked||false } : {};})()),
      // Skip s_last_minute si toggle disabled (plan=free) pour eviter flip silencieux
      // (parite saveAllSettings batch 16).
      ...(lmEl && !lmEl.disabled ? {
        settings_last_minute_enabled:lmEl.checked||false,
        settings_last_minute_deadline:document.getElementById('s_lm_deadline')?.value||'j-1',
        settings_last_minute_discount_pct:parseInt(document.getElementById('s_lm_discount')?.value)||10,
        settings_last_minute_min_price_cents:parseInt(document.getElementById('s_lm_min_price')?.value)||0
      } : {})
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
    // Update local biz cache so other modules see new settings immediately
    const freshBiz=api.getBusiness()||{};
    if(!freshBiz.settings)freshBiz.settings={};
    freshBiz.settings.slot_increment_min=data.settings_slot_increment_min;
    freshBiz.settings.waitlist_mode=data.settings_waitlist_mode;
    freshBiz.settings.calendar_color_mode=data.settings_calendar_color_mode;
    freshBiz.settings.slot_auto_optimize=data.settings_slot_auto_optimize;
    if (data.settings_gap_analyzer_enabled !== undefined) freshBiz.settings.gap_analyzer_enabled=data.settings_gap_analyzer_enabled;
    if (data.settings_featured_slots_enabled !== undefined) freshBiz.settings.featured_slots_enabled=data.settings_featured_slots_enabled;
    // Cache update : seulement si data contient les keys (skip si toggle disabled).
    if (data.settings_last_minute_enabled !== undefined) {
      freshBiz.settings.last_minute_enabled=data.settings_last_minute_enabled;
      freshBiz.settings.last_minute_deadline=data.settings_last_minute_deadline;
      freshBiz.settings.last_minute_discount_pct=data.settings_last_minute_discount_pct;
      freshBiz.settings.last_minute_min_price_cents=data.settings_last_minute_min_price_cents;
    }
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
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
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
  {id:'cash',label:'Espèces',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M2 10h2m16 0h2M2 14h2m16 0h2"/></svg>'},
  {id:'card',label:'Carte bancaire',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>'},
  {id:'bancontact',label:'Bancontact',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/><path d="M6 15h4"/></svg>'},
  {id:'apple_pay',label:'Apple Pay',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 0-1.5 4.5c0 2 1 3.5 2.5 4.5-1 1.5-2 3-3.5 3-1.5 0-2-.8-3.5-.8s-2.2.8-3.5.8C1 14 0 11 0 8.5 0 4.5 3 2 5.5 2c1.5 0 2.8.8 3.5.8S11 2 12 2z"/><path d="M12 2c0-1 1-2 2.5-2"/></svg>'},
  {id:'google_pay',label:'Google Pay',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 0-3.3 6.5"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>'},
  {id:'payconiq',label:'Payconiq',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="3" height="3"/><path d="M21 14h-1v3h-3v1h3v3h1v-3h3v-1h-3z"/></svg>'},
  {id:'instant_transfer',label:'Virement instantané',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>'},
  {id:'bank_transfer',label:'Virement bancaire',icon:'<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M3 10h18"/><path d="M12 3l9 7H3z"/><path d="M5 10v8m4-8v8m6-8v8m4-8v8"/></svg>'}
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
      <span style="display:flex;align-items:center;gap:6px;font-size:.82rem;font-weight:500;color:var(--text)">${pm.icon.replace('<svg class="gi" ','<svg class="gi" style="width:16px;height:16px;flex-shrink:0" ')}${pm.label}</span>
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
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
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
    if(!r.ok)throw new Error(d.message||d.error);
    window.location.href=d.url;
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function openStripeDashboard(){
  try{
    GendaUI.toast('Ouverture du dashboard...','info');
    const r=await fetch('/api/stripe/connect/dashboard',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()}});
    const d=await r.json();
    if(!r.ok)throw new Error(d.message||d.error);
    window.location.href=d.url;
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function disconnectStripe(){
  if(!(await showConfirmDialog('Déconnecter votre compte Stripe ? Les paiements d\'acomptes ne seront plus possibles.')))return;
  try{
    const r=await fetch('/api/stripe/connect',{method:'DELETE',headers:{'Authorization':'Bearer '+api.getToken()}});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
    GendaUI.toast('Compte Stripe d\u00e9connect\u00e9','success');
    loadConnectStatus();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveDefaultView(view){
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({settings_default_calendar_view:view})});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
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
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
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
    const sms24=document.getElementById('s_rem_sms_24h');
    const sms2=document.getElementById('s_rem_sms_2h');
    const data={
      settings_reminder_email_24h:document.getElementById('s_rem_email_24h').checked,
      // Skip SMS toggles si disabled (plan free) pour eviter flip silencieux true→false (parite saveAllSettings batch 17).
      ...(sms24 && !sms24.disabled ? { settings_reminder_sms_24h:sms24.checked } : {}),
      ...(sms2 && !sms2.disabled ? { settings_reminder_sms_2h:sms2.checked } : {}),
      settings_reminder_email_2h:document.getElementById('s_rem_email_2h').checked
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
    GendaUI.toast('Rappels configurés '+IC.check,'success');window._settingsGuard?.markClean();
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
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
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
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
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
      settings_booking_confirmation_channel:document.getElementById('s_booking_confirm_channel')?.value||'email',
      settings_notify_new_booking_pro:document.getElementById('s_notify_new_booking_pro').checked
    };
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(data)});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
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
    if(!r.ok)throw new Error(d.message||d.error);
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
    if(!r.ok)throw new Error(d.message||d.error);
    window.location.href=d.url;
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveBusiness(){
  const body={name:document.getElementById('s_name').value,slug:document.getElementById('s_slug').value,email:document.getElementById('s_email').value,phone:document.getElementById('s_phone').value,address:document.getElementById('s_address').value,bce_number:document.getElementById('s_bce').value,tagline:document.getElementById('s_tagline').value,description:document.getElementById('s_desc').value,founded_year:document.getElementById('s_year').value||null,parking_info:document.getElementById('s_parking').value,settings_iban:document.getElementById('s_iban').value,settings_bic:document.getElementById('s_bic').value,settings_invoice_footer:document.getElementById('s_inv_footer').value};
  try{const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}GendaUI.toast('Informations enregistrées','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveSEO(){
  const body={seo_title:document.getElementById('s_seo_title').value,seo_description:document.getElementById('s_seo_desc').value};
  try{const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify(body)});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}GendaUI.toast('SEO enregistré','success');window._settingsGuard?.markClean();
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function saveSector(){
  const sector=document.getElementById('s_sector').value;
  try{
    const r=await fetch('/api/business',{method:'PATCH',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({sector})});
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
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
    if(!r.ok){const _d=await r.json().catch(()=>({}));throw new Error(_d.message||_d.error||'Erreur');}
    document.getElementById('s_pwd_current').value='';document.getElementById('s_pwd_new').value='';document.getElementById('s_pwd_confirm').value='';
    GendaUI.toast('Mot de passe modifié. Reconnexion nécessaire...','success');
    // Le serveur bump token_version → le JWT courant est maintenant caduc.
    // Forcer logout + redirect /login sinon toute requête suivante renvoie 401.
    setTimeout(()=>api.logout(),1500);
  }catch(e){GendaUI.toast('Erreur: '+e.message,'error');}
}

async function exportData(type) {
  const label = type === 'clients' ? 'clients' : 'factures';
  GendaUI.toast(`Export ${label} en cours…`, 'info');
  try {
    // B4-fix : token JWT dans query param = leak access logs + history + Referer.
    // Fetch via Authorization header + blob download.
    const url = type === 'clients' ? '/api/clients/export' : '/api/invoices/export';
    const token = api.getToken();
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) throw new Error('Erreur export');
    const blob = await r.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${type}-${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(blobUrl); }, 100);
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}
window.exportData = exportData;

function copyField(id){
  const el=document.getElementById(id);el.select();navigator.clipboard.writeText(el.value);
  GendaUI.toast('Copié !','success');
}

async function confirmDeleteAccount(){
  const name = await new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'dg-overlay';
    el.innerHTML = `<div class="dg-card">
      <p class="dg-msg" style="font-weight:600;margin-bottom:6px;color:#DC2626">Fermer votre compte ?</p>
      <p class="dg-msg" style="font-size:.85rem;color:var(--text-2)">Votre compte sera désactivé. Vos clients avec des rendez-vous futurs, acomptes, cartes cadeaux ou abonnements seront notifiés par email. Vous recevrez un export CSV de vos données par email.</p>
      <p class="dg-msg" style="font-size:.85rem;margin-top:8px">Tapez le nom de votre salon pour confirmer :</p>
      <input id="_delName" type="text" placeholder="Nom du salon" style="width:100%;padding:8px 10px;border:1px solid var(--border-light);border-radius:6px;font-size:.85rem;margin:8px 0;box-sizing:border-box">
      <div class="dg-actions">
        <button class="dg-btn dg-cancel" style="background:var(--bg);color:var(--text)">Annuler</button>
        <button class="dg-btn dg-confirm" style="background:#DC2626;color:#fff">Fermer mon compte</button>
      </div>
    </div>`;
    el.querySelector('.dg-cancel').onclick = () => { el.remove(); resolve(null); };
    el.querySelector('.dg-confirm').onclick = () => { const v = el.querySelector('#_delName').value; el.remove(); resolve(v); };
    document.body.appendChild(el);
    el.querySelector('#_delName').focus();
  });
  if(!name)return;
  try {
    const r = await fetch('/api/business/close', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ confirm_name: name })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message||d.error);
    GendaUI.toast(`Compte fermé. ${d.clients_notified} client(s) notifié(s).`, 'success');
    setTimeout(() => { localStorage.clear(); window.location.href = '/login.html'; }, 3000);
  } catch (e) {
    GendaUI.toast('Erreur : ' + e.message, 'error');
  }
}

// ===== QR Code =====

function downloadQR(){
  const img=document.getElementById('qrImage');if(!img)return;
  const link=document.createElement('a');link.download='genda-qr.png';link.href=img.src;link.click();
  GendaUI.toast('QR téléchargé','success');
}

function doLogout(){api.logout();}

bridge({ loadSettings, loadConnectStatus, connectStripe, openStripeDashboard, disconnectStripe, saveAllSettings, saveCalendarSettings, savePractitionerChoiceSetting, saveMultiServicePolicy, saveDefaultView, saveOverlapPolicy, saveReminderSettings, saveRescheduleSettings, saveGiftCardSettings, saveBookingConfirmSettings, startCheckout, openStripePortal, saveBusiness, saveSEO, saveSector, changePassword, copyField, confirmDeleteAccount, downloadQR, doLogout, savePaymentMethods });

export { loadSettings, loadConnectStatus, connectStripe, openStripeDashboard, disconnectStripe, saveAllSettings, saveCalendarSettings, savePractitionerChoiceSetting, saveMultiServicePolicy, saveDefaultView, saveOverlapPolicy, saveReminderSettings, saveRescheduleSettings, saveGiftCardSettings, startCheckout, openStripePortal, saveBusiness, saveSEO, saveSector, changePassword, copyField, confirmDeleteAccount, downloadQR, doLogout, savePaymentMethods };
