/**
 * Team (Équipe) view module — v2
 * Unified m-* modals, service assignments, leave balances, enriched cards
 */
import { api, SECTOR_LABELS, userSector, sectorLabels, categoryLabels, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { cswHTML } from './agenda/color-swatches.js';
import { guardModal, closeModal, showConfirmDialog } from '../utils/dirty-guard.js';
import { trapFocus, releaseFocus } from '../utils/focus-trap.js';
import { enableSwipeClose } from '../utils/swipe-close.js';
import { initTimeInputs } from '../utils/dom.js';
import { IC } from '../utils/icons.js';

let pPendingPhoto = null;
let teamCurrentTab = 'profile';
let teamLeaveYear = new Date().getFullYear();
let teamEditSchedule = {}; // mutable copy of schedule for editing (weekday -> [{start_time,end_time}])
let teamEditPracId = null; // practitioner id being edited
let teamEditServiceIds = new Set(); // service IDs assigned to this practitioner

let teamAllServices = []; // all active services fetched from API

const esc=s=>s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'):'';
function escH(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const ICONS = {
  close: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  edit: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  tasks: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  key: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  role: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  mail: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>',
  phone: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  calendar: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  star: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  sun: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  hourglass: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>',
  plus: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  trash: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  link: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  shield: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
};

const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const CONTRACT_LABELS = { cdi: 'CDI', cdd: 'CDD', independant: 'Indépendant', stagiaire: 'Stagiaire', interim: 'Intérim' };
const TYPE_LABELS = { conge: 'Congé', maladie: 'Maladie', formation: 'Formation', recuperation: 'Récup.' };

// ============================================================
// Helpers
// ============================================================

function computeRegime(workDays) {
  if (!workDays || workDays.length === 0) return { label: '—', detail: '' };
  const n = workDays.length;
  if (n === 7) return { label: '7/7', detail: '' };

  // Find which days are off (weekday labels based on avail format 0=Lun)
  const dayNames = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  const offDays = [];
  for (let i = 0; i < 7; i++) {
    if (!workDays.includes(i)) offDays.push(dayNames[i]);
  }

  if (n === 5 && !workDays.includes(5) && !workDays.includes(6)) {
    return { label: 'Temps plein', detail: '' };
  }
  const detail = offDays.length <= 3 ? offDays.join(', ') + ' off' : '';
  return { label: `${n}/7`, detail };
}

function computeAnciennete(hireDate) {
  if (!hireDate) return '—';
  const start = new Date(hireDate);
  const now = new Date();
  let years = now.getFullYear() - start.getFullYear();
  let months = now.getMonth() - start.getMonth();
  if (months < 0) { years--; months += 12; }
  if (years > 0) return `${years}a ${months}m`;
  if (months > 0) return `${months} mois`;
  return '< 1 mois';
}

function getLeaveBalance(lb) {
  if (!lb || !lb.conge) return null;
  const solde = (lb.conge.total || 0) - (lb.conge.used || 0);
  return { total: lb.conge.total || 0, used: lb.conge.used || 0, solde };
}

function soldeClass(solde) {
  if (solde <= 0) return 'danger';
  if (solde <= 5) return 'warn';
  return 'ok';
}

// ============================================================
// Load team
// ============================================================

async function loadTeam() {
  const c = document.getElementById('contentArea');
  c.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const [r, calR] = await Promise.all([
      fetch('/api/practitioners', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }),
      fetch('/api/calendar/connections', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }).catch(() => ({ ok: false }))
    ]);
    const d = await r.json();
    const calData = calR.ok ? await calR.json() : { connections: [] };
    const calConns = calData.connections || [];
    const practs = d.practitioners || [];
    const pracLabel = sectorLabels.practitioner.toLowerCase();

    let h = `<div class="tm-list-header">
      <h3>${practs.length} membre${practs.length > 1 ? 's' : ''} de l'équipe</h3>
      <button class="btn-primary btn-sm" onclick="openPractModal()">+ Ajouter</button>
    </div>`;

    if (practs.length === 0) {
      h += `<div class="card"><div class="empty">Aucun ${pracLabel}. Ajoutez votre premier membre !</div></div>`;
    } else {
      h += `<div class="team-grid2">`;
      practs.forEach(p => {
        const initials = p.display_name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
        const regime = computeRegime(p.work_days);
        const isInactive = !p.is_active;

        h += `<div class="tm-card${isInactive ? ' inactive' : ''}" onclick="openPractModal('${p.id}')">`;

        // Avatar
        if (p.photo_url) {
          h += `<div class="tm-avatar"><img src="${esc(p.photo_url)}" alt="${esc(p.display_name)}" loading="lazy"></div>`;
        } else {
          h += `<div class="tm-avatar" style="background:linear-gradient(135deg,${esc(p.color || '#0D7377')},${esc(p.color || '#0D7377')}CC)">${initials}</div>`;
        }

        // Info
        h += `<div class="tm-info">`;
        h += `<p class="tm-name">${esc(p.display_name)}${isInactive ? ' <span class="tm-badge-inactive">Inactif</span>' : ''}</p>`;
        h += `<p class="tm-title">${esc(p.title || '')}</p>`;
        if (regime.label !== '—') h += `<p class="tm-regime">${regime.label}${regime.detail ? ' · ' + regime.detail : ''}</p>`;

        // Summary line
        const parts = [];
        if (p.bookings_30d != null) parts.push(p.bookings_30d + ' RDV/mois');
        if (p.contract_type && CONTRACT_LABELS[p.contract_type]) parts.push(CONTRACT_LABELS[p.contract_type]);
        if (parts.length) h += `<p class="tm-summary">${parts.join(' · ')}</p>`;

        h += `</div>`;
        h += `</div>`;
      });

      // Add button card
      h += `<div class="tm-card tm-add" onclick="openPractModal()">
        <div class="tm-avatar tm-add-icon">${ICONS.plus}</div>
        <div class="tm-info"><p class="tm-name">Ajouter un ${esc(pracLabel)}</p></div>
      </div>`;

      h += `</div>`;
    }
    c.innerHTML = h;
  } catch (e) { c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`; }
}

// ============================================================
// Practitioner detail/edit modal
// ============================================================

function openPractModal(editId) {
  // Plan guard: free tier limited to 1 practitioner
  if (!editId && window._businessPlan === 'free') {
    const existingPracs = document.querySelectorAll('.tm-card:not(.tm-add)').length;
    if (existingPracs >= 1) {
      GendaUI.toast('Passez au Pro pour ajouter des praticiens', 'error');
      return;
    }
  }
  const hdrs = { 'Authorization': 'Bearer ' + api.getToken() };
  if (editId) {
    Promise.all([
      fetch('/api/practitioners', { headers: hdrs }).then(r => r.json()),
      fetch('/api/services', { headers: hdrs }).then(r => r.json())
    ]).then(([d, svcData]) => {
      teamAllServices = (svcData.services || []).filter(s => s.is_active !== false);
      renderPractModal(d.practitioners.find(p => p.id === editId));
    });
  } else {
    fetch('/api/services', { headers: hdrs }).then(r => r.json()).then(svcData => {
      teamAllServices = (svcData.services || []).filter(s => s.is_active !== false);
      renderPractModal(null);
    });
  }
}

function renderPractModal(p) {
  pPendingPhoto = null;
  teamCurrentTab = 'profile';
  teamLeaveYear = new Date().getFullYear();

  // Initialize assigned services
  teamEditServiceIds = new Set();
  if (p) {
    teamAllServices.forEach(s => {
      if (s.practitioner_ids && s.practitioner_ids.includes(p.id)) {
        teamEditServiceIds.add(s.id);
      }
    });
  }

  const isEdit = !!p;
  const pracLbl = sectorLabels.practitioner.toLowerCase();
  const accentColor = p?.color || '#0D7377';
  const initials = p?.display_name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
  const photoHtml = p?.photo_url
    ? `<img src="${esc(p.photo_url)}" alt="${esc(p.display_name)}" style="width:100%;height:100%;object-fit:cover">`
    : initials;
  const modalTitle = p ? esc(p.display_name) : 'Nouveau ' + sectorLabels.practitioner;

  let h = `<div id="teamModalOverlay" class="m-overlay open">
    <div class="m-dialog m-flex m-lg">
    <div class="m-drag-handle"></div>

    <!-- M-HEADER -->
    <div class="m-header">
      <div class="m-header-bg" id="tmHeaderBg" style="background:linear-gradient(135deg,${accentColor} 0%,${accentColor}AA 60%,${accentColor}55 100%)"></div>
      <button class="m-close" onclick="closeTeamModal()" aria-label="Fermer">
        <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
      <div class="m-header-content">
        <div class="m-client-hero" style="align-items:center">
          <div class="m-avatar" id="tmAvatar" style="background:linear-gradient(135deg,${accentColor},${accentColor}CC);cursor:pointer" onclick="document.getElementById('pPhotoInput').click()">
            ${photoHtml}
          </div>
          <div class="m-modal-title" id="tmModalTitle">${modalTitle}</div>
        </div>
      </div>
    </div>

    <!-- TABS -->
    <div class="m-tabs">
      <div class="m-tab active" data-tab="profile" onclick="teamSwitchTab('profile')">Profil</div>
      <div class="m-tab" data-tab="skills" onclick="teamSwitchTab('skills')">Compétences</div>
      <div class="m-tab" data-tab="schedule" onclick="teamSwitchTab('schedule')">Horaire</div>
      ${isEdit ? `<div class="m-tab" data-tab="leave" onclick="teamSwitchTab('leave')">Congés</div>` : ''}
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
            <div><div class="m-field-label">Nom complet *</div><input class="m-input" id="p_name" value="${esc(p?.display_name || '')}" placeholder="Ex: Sophie Laurent"></div>
            <div><div class="m-field-label">Titre / Spécialité</div><input class="m-input" id="p_title" value="${esc(p?.title || '')}" placeholder="Ex: Coiffeuse senior"></div>
          </div>
          <div class="m-row m-row-2">
            <div><div class="m-field-label">Années d'expérience</div><input class="m-input" type="number" id="p_years" value="${p?.years_experience || ''}" min="0"></div>
            <div><div class="m-field-label">Couleur agenda</div><div id="p_color_wrap"></div></div>
          </div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Contact</span><span class="m-sec-line"></span></div>
          <div class="m-row m-row-2">
            <div><div class="m-field-label">Email</div><input class="m-input" id="p_email" type="email" value="${esc(p?.email || '')}"></div>
            <div><div class="m-field-label">Téléphone</div><input class="m-input" id="p_phone" value="${esc(p?.phone || '')}"></div>
          </div>
          <div><div class="m-field-label">Bio</div><textarea class="m-input" id="p_bio" style="min-height:60px">${esc(p?.bio || '')}</textarea></div>
          <div style="margin-top:8px"><div class="m-field-label">LinkedIn</div><input class="m-input" id="p_linkedin" value="${esc(p?.linkedin_url || '')}" placeholder="https://linkedin.com/in/..."></div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Contrat</span><span class="m-sec-line"></span></div>
          <div class="m-row m-row-3">
            <div><div class="m-field-label">Type</div><select class="m-input" id="p_contract">
              ${['cdi', 'cdd', 'independant', 'stagiaire', 'interim'].map(v => `<option value="${v}"${(p?.contract_type || 'cdi') === v ? ' selected' : ''}>${CONTRACT_LABELS[v]}</option>`).join('')}
            </select></div>
            <div><div class="m-field-label">Date d'embauche</div><input class="m-input" type="date" id="p_hire" value="${p?.hire_date ? p.hire_date.slice(0, 10) : ''}"></div>
            <div><div class="m-field-label">Heures/sem.</div><input class="m-input" type="number" id="p_hours" value="${p?.weekly_hours_target || ''}" step="0.5" min="0" max="60" placeholder="38"></div>
          </div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Contact d'urgence</span><span class="m-sec-line"></span></div>
          <div class="m-row m-row-2">
            <div><div class="m-field-label">Nom</div><input class="m-input" id="p_emerg_name" value="${esc(p?.emergency_contact_name || '')}"></div>
            <div><div class="m-field-label">Téléphone</div><input class="m-input" id="p_emerg_phone" value="${esc(p?.emergency_contact_phone || '')}"></div>
          </div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Notes internes</span><span class="m-sec-line"></span></div>
          <textarea class="m-input" id="p_note" style="min-height:60px" placeholder="Notes privées (visibles par le propriétaire uniquement)...">${esc(p?.internal_note || '')}</textarea>
        </div>

        ${isEdit && p?.photo_url ? `<div style="text-align:center;margin-top:8px"><button onclick="pRemovePhoto('${p.id}')" style="font-size:.7rem;color:var(--red);background:none;border:none;cursor:pointer">Supprimer la photo</button></div>` : ''}
      </div>

      <!-- TAB: COMPÉTENCES -->
      <div class="m-panel" id="team-panel-skills">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Prestations assignées</span><span class="m-sec-line"></span></div>
          <div id="tm_services_list">${renderServicesList()}</div>
        </div>
      </div>

      <!-- TAB: HORAIRE -->
      <div class="m-panel" id="team-panel-schedule">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Disponibilités hebdomadaires</span><span class="m-sec-line"></span></div>
          <div id="tm_schedule_editor">${isEdit ? '<div style="font-size:.78rem;color:var(--text-4)">Chargement...</div>' : renderScheduleEditor()}</div>
        </div>
        ${p?.weekly_hours_target ? `<div style="margin-top:10px;font-size:.78rem;color:var(--text-3)">Heures/semaine cible : <strong>${p.weekly_hours_target}h</strong></div>` : ''}
      </div>

      <!-- TAB: CONGÉS -->
      ${isEdit ? `<div class="m-panel" id="team-panel-leave">
        <div class="m-sec">
          <div class="m-sec-head">
            <span class="m-sec-title">Solde congés</span><span class="m-sec-line"></span>
            <select class="m-input" id="tm_leave_year" style="width:auto;padding:4px 8px;font-size:.72rem" onchange="teamLoadLeave('${p.id}',this.value)">
              ${[teamLeaveYear - 1, teamLeaveYear, teamLeaveYear + 1].map(y => `<option value="${y}"${y === teamLeaveYear ? ' selected' : ''}>${y}</option>`).join('')}
            </select>
          </div>
          <div id="tm_leave_table">${renderLeaveTable(p.leave_balance)}</div>
        </div>
        <div class="m-sec" style="margin-top:16px">
          <div class="m-sec-head"><span class="m-sec-title">Absences récentes</span><span class="m-sec-line"></span></div>
          <div id="tm_recent_abs" style="font-size:.78rem;color:var(--text-4)">Chargement...</div>
        </div>
      </div>` : ''}

      <!-- TAB: PARAMÈTRES -->
      <div class="m-panel" id="team-panel-settings">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Agenda</span><span class="m-sec-line"></span></div>
          <div class="m-field-label">Capacité simultanée</div>
          <select class="m-input" id="p_max_concurrent">
            ${[1, 2, 3, 4, 5, 6, 8, 10].map(v => `<option value="${v}"${(p?.max_concurrent || 1) === v ? ' selected' : ''}>${v}${v === 1 ? ' (pas de chevauchement)' : ' simultanés'}</option>`).join('')}
          </select>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Réservation en ligne</span><span class="m-sec-line"></span></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer">
            <input type="checkbox" id="p_booking" ${p?.booking_enabled !== false ? 'checked' : ''}> Peut recevoir des réservations en ligne
          </label>
        </div>

        ${isEdit ? `<div class="m-sec" style="margin-top:16px">
          <div class="m-sec-head"><span class="m-sec-title"><svg class="gi" style="width:12px;height:12px" ${ICONS.calendar.slice(4)}> Synchronisation calendrier</span><span class="m-sec-line"></span></div>
          <div id="p_cal_area" style="font-size:.82rem;color:var(--text-4)">Chargement...</div>
        </div>` : ''}

        ${isEdit ? `<div class="m-sec" style="margin-top:16px">
          <div class="m-sec-head"><span class="m-sec-title"><svg class="gi" style="width:14px;height:14px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg> Accès dashboard</span><span class="m-sec-line"></span></div>
          ${p.user_id
            ? `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--surface);border-radius:8px">
                <div style="flex:1">
                  <div style="font-size:.82rem;font-weight:600;color:var(--text-1)">${esc(p.login_email || p.user_email || '')}</div>
                  <div style="font-size:.72rem;color:var(--text-4);margin-top:2px">Rôle : ${p.role === 'owner' || p.user_role === 'owner' ? 'Propriétaire' : sectorLabels.practitioner}${p.last_login_at ? ' · Dernière connexion : ' + new Date(p.last_login_at).toLocaleDateString('fr-BE', {day:'numeric',month:'short',timeZone:'Europe/Brussels'}) : ' · Jamais connecté'}</div>
                </div>
                <button class="m-btn m-btn-ghost" style="font-size:.72rem" onclick="closeTeamModal();openRoleModal('${p.id}','${esc(p.display_name)}','${p.role || p.user_role || 'practitioner'}')">Changer le rôle</button>
              </div>`
            : `<div style="padding:10px 14px;background:var(--surface);border-radius:8px;display:flex;align-items:center;justify-content:space-between">
                <span style="font-size:.82rem;color:var(--text-3)">Aucun accès au dashboard</span>
                <button class="m-btn m-btn-primary" style="font-size:.72rem" onclick="closeTeamModal();openInviteModal('${p.id}','${esc(p.display_name)}')">Créer un accès</button>
              </div>`
          }
        </div>` : ''}
      </div>

    </div>

    <!-- BOTTOM BAR -->
    <div class="m-bottom">
      ${isEdit ? `<div style="display:flex;gap:8px">
        <button class="m-btn m-btn-danger" onclick="confirmDeactivatePract('${p.id}','${esc(p.display_name)}')">Désactiver</button>
        <button class="m-btn m-btn-ghost" style="color:var(--red);font-size:.72rem" onclick="confirmDeletePract('${p.id}','${esc(p.display_name)}')">Supprimer</button>
      </div>` : ''}
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeTeamModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="savePract(${isEdit ? "'" + p.id + "'" : 'null'})">${isEdit ? 'Enregistrer' : 'Créer'}</button>
    </div>

  </div></div>`;

  document.body.insertAdjacentHTML('beforeend', h);
  const teamModal = document.getElementById('teamModalOverlay');
  guardModal(teamModal, { noBackdropClose: true });
  trapFocus(teamModal, () => closeTeamModal());
  enableSwipeClose(teamModal.querySelector('.m-dialog'), () => closeTeamModal());
  initTimeInputs(teamModal);
  document.getElementById('p_color_wrap').innerHTML = cswHTML('p_color', p?.color || '#1E3A8A', false);

  // Dynamic gradient update on color change
  const colorInput = document.getElementById('p_color');
  if (colorInput) {
    colorInput.addEventListener('change', () => {
      const c = colorInput.value || '#0D7377';
      const bg = document.getElementById('tmHeaderBg');
      const av = document.getElementById('tmAvatar');
      if (bg) bg.style.background = `linear-gradient(135deg,${c} 0%,${c}AA 60%,${c}55 100%)`;
      if (av) av.style.background = `linear-gradient(135deg,${c},${c}CC)`;
    });
  }

  // Initialize schedule editor
  teamEditPracId = p?.id || null;
  if (isEdit) {
    window.loadPracCalSync && window.loadPracCalSync(p.id);
    teamLoadLeave(p.id, teamLeaveYear);
    teamLoadSchedule(p.id);
  } else {
    // New practitioner: empty schedule
    teamEditSchedule = {};
    for (let d = 0; d < 7; d++) teamEditSchedule[d] = [];
  }
}

async function closeTeamModal() {
  releaseFocus();
  await closeModal('teamModalOverlay');
}

function teamSwitchTab(tab) {
  teamCurrentTab = tab;
  document.querySelectorAll('#teamModalOverlay .m-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('#teamModalOverlay .m-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('team-panel-' + tab)?.classList.add('active');
}

// ============================================================
// Service assignments (prestations assignées)
// ============================================================

function renderServicesList() {
  if (teamAllServices.length === 0) {
    return `<div style="font-size:.78rem;color:var(--text-4);padding:12px 0">Aucune prestation créée. <a href="#" onclick="event.preventDefault();window.loadSection&&window.loadSection('services')" style="color:var(--primary)">Créer des prestations</a></div>`;
  }

  // Group by category
  const cats = {};
  const catOrder = [];
  teamAllServices.forEach(s => {
    const cat = s.category || 'Sans catégorie';
    if (!cats[cat]) { cats[cat] = []; catOrder.push(cat); }
    cats[cat].push(s);
  });

  const total = teamAllServices.length;
  const assigned = teamEditServiceIds.size;

  let h = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
    <span style="font-size:.75rem;color:var(--text-3)">${assigned}/${total} prestation${total > 1 ? 's' : ''} assignée${assigned > 1 ? 's' : ''}</span>
    <button class="m-btn m-btn-ghost" style="font-size:.7rem;padding:4px 10px" onclick="teamToggleAllServices()">${assigned === total ? 'Tout désélectionner' : 'Tout sélectionner'}</button>
  </div>`;

  catOrder.forEach(cat => {
    const services = cats[cat];
    const catAssigned = services.filter(s => teamEditServiceIds.has(s.id)).length;
    const allChecked = catAssigned === services.length;
    const someChecked = catAssigned > 0 && !allChecked;

    h += `<div class="svc-assign-group">
      <label class="svc-assign-cat" onclick="event.preventDefault();teamToggleCatServices('${esc(cat)}')">
        <input type="checkbox" ${allChecked ? 'checked' : ''} tabindex="-1" style="accent-color:var(--primary)">
        <span class="svc-assign-cat-name">${escH(cat)}</span>
        <span class="svc-assign-cat-count">${catAssigned}/${services.length}</span>
      </label>`;

    services.forEach(s => {
      const checked = teamEditServiceIds.has(s.id);
      const priceLabel = s.price_cents ? (s.price_cents / 100).toFixed(2).replace('.00', '') + '€' : '';
      h += `<label class="svc-assign-item${checked ? ' checked' : ''}" onclick="event.preventDefault();teamToggleService('${s.id}')">
        <input type="checkbox" ${checked ? 'checked' : ''} tabindex="-1" style="accent-color:var(--primary)">
        <span class="svc-assign-name">${esc(s.name)}</span>
        <span class="svc-assign-meta">${s.duration_min ? s.duration_min + ' min' : ''}${priceLabel ? ' · ' + priceLabel : ''}</span>
      </label>`;
    });

    h += `</div>`;
  });

  return h;
}

function teamToggleService(serviceId) {
  if (teamEditServiceIds.has(serviceId)) {
    teamEditServiceIds.delete(serviceId);
  } else {
    teamEditServiceIds.add(serviceId);
  }
  document.getElementById('tm_services_list').innerHTML = renderServicesList();
}

function teamToggleCatServices(cat) {
  const services = teamAllServices.filter(s => (s.category || 'Sans catégorie') === cat);
  const allChecked = services.every(s => teamEditServiceIds.has(s.id));
  services.forEach(s => {
    if (allChecked) teamEditServiceIds.delete(s.id);
    else teamEditServiceIds.add(s.id);
  });
  document.getElementById('tm_services_list').innerHTML = renderServicesList();
}

function teamToggleAllServices() {
  const allChecked = teamEditServiceIds.size === teamAllServices.length;
  if (allChecked) {
    teamEditServiceIds.clear();
  } else {
    teamAllServices.forEach(s => teamEditServiceIds.add(s.id));
  }
  document.getElementById('tm_services_list').innerHTML = renderServicesList();
}

// ============================================================
// Schedule grid (read-only)
// ============================================================

// ============================================================
// Schedule editor (editable availability)
// ============================================================

const DAYS_WEEK = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

async function teamLoadSchedule(pracId) {
  try {
    const r = await fetch(`/api/availabilities?practitioner_id=${pracId}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const data = await r.json();
    const avails = data.availabilities || {};
    const pracAvail = avails[pracId];

    teamEditSchedule = {};
    for (let d = 0; d < 7; d++) {
      teamEditSchedule[d] = (pracAvail?.schedule?.[d] || []).map(s => ({
        start_time: s.start_time, end_time: s.end_time
      }));
    }

    document.getElementById('tm_schedule_editor').innerHTML = renderScheduleEditor();
  } catch (e) {
    document.getElementById('tm_schedule_editor').innerHTML =
      `<div style="color:var(--red);font-size:.82rem">Erreur: ${esc(e.message)}</div>`;
  }
}

function renderScheduleEditor() {
  // Compute regime from current schedule
  const workDays = [];
  for (let d = 0; d < 7; d++) {
    if (teamEditSchedule[d] && teamEditSchedule[d].length > 0) workDays.push(d);
  }
  const regime = computeRegime(workDays);

  let h = `<div style="font-size:.82rem;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px">
    Régime : <span style="color:var(--primary)">${regime.label}</span>
    ${regime.detail ? `<span style="color:var(--text-4);font-weight:400;font-size:.75rem">(${regime.detail})</span>` : ''}
  </div>`;

  for (let d = 0; d < 7; d++) {
    const slots = teamEditSchedule[d] || [];
    h += `<div class="day-row">
      <span class="day-name">${DAYS_WEEK[d]}</span>
      <div class="slots">`;
    if (slots.length === 0) {
      h += `<span class="day-closed">Fermé</span>`;
    } else {
      slots.forEach((s, i) => {
        h += `<span class="slot-chip"><span class="slot-chip-text" onclick="teamEditSlot(${d},${i})" title="Cliquer pour modifier">${(s.start_time || '').slice(0, 5)} – ${(s.end_time || '').slice(0, 5)}</span><button class="remove-slot" onclick="teamRemoveSlot(${d},${i})">${ICONS.close}</button></span>`;
      });
    }
    h += `<button class="add-slot-btn" onclick="teamAddSlot(${d})">+ Ajouter</button>
      </div>
    </div>`;
  }

  return h;
}

function teamAddSlot(day) {
  const slots = teamEditSchedule[day] || [];
  const last = slots[slots.length - 1];
  const ds = last ? last.end_time : '09:00:00';
  const hr = parseInt((ds || '09:00').split(':')[0]);
  const de = `${String(Math.min(hr + 4, 20)).padStart(2, '0')}:00`;

  let m = `<div class="m-overlay open" id="teamSlotModal" style="z-index:350"><div class="m-dialog m-sm"><div class="m-header-simple"><h3>Créneau — ${DAYS_WEEK[day]}</h3><button class="m-close" onclick="closeModal('teamSlotModal')">${ICONS.close}</button></div><div class="m-body">
    <div class="m-row m-row-2"><div><div class="m-field-label">Début</div><input type="text" class="m-input m-time" id="tm_slot_start" value="${(ds || '09:00').slice(0, 5)}"></div><div><div class="m-field-label">Fin</div><input type="text" class="m-input m-time" id="tm_slot_end" value="${de}"></div></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('teamSlotModal')">Annuler</button><button class="m-btn m-btn-primary" onclick="teamConfirmAddSlot(${day})">Ajouter</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
  initTimeInputs(document.getElementById('teamSlotModal'));
}

function teamConfirmAddSlot(day) {
  const startVal = document.getElementById('tm_slot_start').value;
  const endVal = document.getElementById('tm_slot_end').value;
  if (!startVal || !endVal) { GendaUI.toast('Heures requises', 'error'); return; }
  if (startVal >= endVal) { GendaUI.toast("L'heure de fin doit être après le début", 'error'); return; }
  const existing = teamEditSchedule[day] || [];
  const hasOverlap = existing.some(s => startVal < (s.end_time || '').slice(0, 5) && endVal > (s.start_time || '').slice(0, 5));
  if (hasOverlap) { GendaUI.toast('Ce créneau chevauche un autre', 'error'); return; }
  const st = startVal + ':00';
  const en = endVal + ':00';
  if (!teamEditSchedule[day]) teamEditSchedule[day] = [];
  teamEditSchedule[day].push({ start_time: st, end_time: en });
  teamEditSchedule[day].sort((a, b) => a.start_time.localeCompare(b.start_time));
  closeModal('teamSlotModal');
  document.getElementById('tm_schedule_editor').innerHTML = renderScheduleEditor();
}

function teamEditSlot(day, idx) {
  const slot = teamEditSchedule[day]?.[idx];
  if (!slot) return;
  const st = (slot.start_time || '09:00:00').slice(0, 5);
  const en = (slot.end_time || '18:00:00').slice(0, 5);

  let m = `<div class="m-overlay open" id="teamSlotModal" style="z-index:350"><div class="m-dialog m-sm"><div class="m-header-simple"><h3>Modifier créneau — ${DAYS_WEEK[day]}</h3><button class="m-close" onclick="closeModal('teamSlotModal')">${ICONS.close}</button></div><div class="m-body">
    <div class="m-row m-row-2"><div><div class="m-field-label">Début</div><input type="text" class="m-input m-time" id="tm_slot_start" value="${st}"></div><div><div class="m-field-label">Fin</div><input type="text" class="m-input m-time" id="tm_slot_end" value="${en}"></div></div>
  </div><div class="m-bottom"><div style="flex:1"></div><button class="m-btn m-btn-ghost" onclick="closeModal('teamSlotModal')">Annuler</button><button class="m-btn m-btn-danger" onclick="teamRemoveSlot(${day},${idx});closeModal('teamSlotModal')" style="margin-right:auto">Supprimer</button><button class="m-btn m-btn-primary" onclick="teamConfirmEditSlot(${day},${idx})">Enregistrer</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
  initTimeInputs(document.getElementById('teamSlotModal'));
}

function teamConfirmEditSlot(day, idx) {
  const startVal = document.getElementById('tm_slot_start').value;
  const endVal = document.getElementById('tm_slot_end').value;
  if (!startVal || !endVal) { GendaUI.toast('Heures requises', 'error'); return; }
  if (startVal >= endVal) { GendaUI.toast("L'heure de fin doit être après le début", 'error'); return; }
  const existing = teamEditSchedule[day] || [];
  const hasOverlap = existing.some((s, i) => {
    if (i === idx) return false;
    return startVal < (s.end_time || '').slice(0, 5) && endVal > (s.start_time || '').slice(0, 5);
  });
  if (hasOverlap) { GendaUI.toast('Ce créneau chevauche un autre', 'error'); return; }
  const st = startVal + ':00';
  const en = endVal + ':00';
  if (teamEditSchedule[day] && teamEditSchedule[day][idx]) {
    teamEditSchedule[day][idx] = { start_time: st, end_time: en };
    teamEditSchedule[day].sort((a, b) => a.start_time.localeCompare(b.start_time));
  }
  closeModal('teamSlotModal');
  document.getElementById('tm_schedule_editor').innerHTML = renderScheduleEditor();
}

function teamRemoveSlot(day, idx) {
  teamEditSchedule[day].splice(idx, 1);
  document.getElementById('tm_schedule_editor').innerHTML = renderScheduleEditor();
}

// ============================================================
// Leave balance
// ============================================================

function renderLeaveTable(lb) {
  const types = ['conge', 'maladie', 'formation', 'recuperation'];
  let h = `<table class="leave-table">
    <thead><tr><th>Type</th><th>Quota</th><th>Pris</th><th>Solde</th></tr></thead><tbody>`;

  types.forEach(type => {
    const data = lb?.[type] || { total: 0, used: 0 };
    const solde = (data.total || 0) - (data.used || 0);
    const cls = soldeClass(solde);
    h += `<tr>
      <td style="font-weight:600">${TYPE_LABELS[type]}</td>
      <td><input class="m-input" type="number" step="0.5" min="0" value="${data.total || 0}" data-leave-type="${type}" style="width:60px;padding:4px 6px;text-align:center"></td>
      <td style="color:var(--text-4)">${data.used || 0}j</td>
      <td><span class="leave-solde ${cls}">${solde > 0 ? '+' : ''}${solde}j</span></td>
    </tr>`;
  });

  h += `</tbody></table>`;
  return h;
}

async function teamLoadLeave(pracId, year) {
  teamLeaveYear = parseInt(year);
  try {
    const r = await fetch(`/api/practitioners/${pracId}/leave-balance?year=${year}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const data = await r.json();
    document.getElementById('tm_leave_table').innerHTML = renderLeaveTable(data.balances);

    // Recent absences
    const absEl = document.getElementById('tm_recent_abs');
    if (data.recent_absences && data.recent_absences.length > 0) {
      absEl.innerHTML = data.recent_absences.map(a => {
        const from = new Date(a.date_from).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
        const to = new Date(a.date_to).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' });
        return `<div style="padding:6px 0;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">
          <span><span class="tm-badge" style="font-size:.6rem;margin-right:6px;background:var(--surface)">${TYPE_LABELS[a.type] || a.type}</span> ${from}${from !== to ? ' → ' + to : ''}</span>
          <span style="font-size:.68rem;color:var(--text-4)">${a.note ? esc(a.note) : ''}</span>
        </div>`;
      }).join('');
    } else {
      absEl.innerHTML = '<div style="padding:8px 0">Aucune absence enregistrée</div>';
    }
  } catch (e) {
    document.getElementById('tm_leave_table').innerHTML = `<div style="color:var(--red);font-size:.82rem">Erreur: ${esc(e.message)}</div>`;
  }
}

// ============================================================
// Save practitioner
// ============================================================

async function savePract(id) {
  const saveBtn = document.querySelector('#teamModalOverlay .m-bottom .m-btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.classList.add('is-loading'); }
  const body = {
    display_name: document.getElementById('p_name').value,
    title: document.getElementById('p_title').value || null,
    years_experience: parseInt(document.getElementById('p_years').value) || null,
    color: document.getElementById('p_color').value,
    email: document.getElementById('p_email').value || null,
    phone: document.getElementById('p_phone').value || null,
    bio: document.getElementById('p_bio').value || null,
    linkedin_url: document.getElementById('p_linkedin').value || null,
    contract_type: document.getElementById('p_contract').value,
    hire_date: document.getElementById('p_hire').value || null,
    weekly_hours_target: parseFloat(document.getElementById('p_hours').value) || null,
    emergency_contact_name: document.getElementById('p_emerg_name').value || null,
    emergency_contact_phone: document.getElementById('p_emerg_phone').value || null,
    internal_note: document.getElementById('p_note').value || null,
    booking_enabled: document.getElementById('p_booking').checked,
    max_concurrent: parseInt(document.getElementById('p_max_concurrent').value) || 1
  };

  try {
    const url = id ? `/api/practitioners/${id}` : '/api/practitioners';
    const method = id ? 'PATCH' : 'POST';
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error);
    const data = await r.json();
    const pracId = id || data.practitioner?.id;

    // Upload photo if one was selected
    if (pPendingPhoto && pracId) {
      await fetch(`/api/practitioners/${pracId}/photo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ photo: pPendingPhoto })
      });
      pPendingPhoto = null;
    }

    // Save service assignments (prestations)
    if (pracId) {
      try {
        await fetch(`/api/practitioners/${pracId}/services`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ service_ids: [...teamEditServiceIds] })
        });
      } catch (e) { /* ignore */ }
    }

    // Save schedule (availabilities)
    if (pracId && teamEditSchedule) {
      const schedule = {};
      for (let d = 0; d < 7; d++) {
        const sl = teamEditSchedule[d] || [];
        if (sl.length > 0) schedule[d] = sl.map(s => ({ start_time: (s.start_time || '').slice(0, 5), end_time: (s.end_time || '').slice(0, 5) }));
      }
      try {
        await fetch('/api/availabilities', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ practitioner_id: pracId, schedule })
        });
      } catch (e) { /* ignore */ }
    }

    // Save leave balances if editing
    if (id) {
      const leaveInputs = document.querySelectorAll('#tm_leave_table input[data-leave-type]');
      if (leaveInputs.length > 0) {
        const balances = {};
        leaveInputs.forEach(inp => {
          balances[inp.dataset.leaveType] = parseFloat(inp.value) || 0;
        });
        try {
          await fetch(`/api/practitioners/${id}/leave-balance`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
            body: JSON.stringify({ year: teamLeaveYear, balances })
          });
        } catch (e) { /* leave_balances table might not exist yet */ }
      }
    }

    document.getElementById('teamModalOverlay')?._dirtyGuard?.markClean(); closeTeamModal();
    GendaUI.toast(id ? sectorLabels.practitioner + ' modifié' : sectorLabels.practitioner + ' ajouté', 'success');
    loadTeam();
  } catch (e) {
    GendaUI.toast('Erreur: ' + e.message, 'error');
  } finally {
    if (saveBtn) { saveBtn.classList.remove('is-loading'); saveBtn.disabled = false; }
  }
}

// ============================================================
// Photo handling
// ============================================================

function pPhotoPreview(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { GendaUI.toast('Photo trop lourde (max 2 Mo)', 'error'); return; }
  const reader = new FileReader();
  reader.onload = function (e) {
    pPendingPhoto = e.target.result;
    document.getElementById('tmAvatar').innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover">`;
  };
  reader.readAsDataURL(file);
}

async function pRemovePhoto(id) {
  const confirmed = await showConfirmDialog(
    'Supprimer la photo',
    'Supprimer la photo de profil ?',
    'Supprimer',
    'danger'
  );
  if (!confirmed) return;
  try {
    await fetch(`/api/practitioners/${id}/photo`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    GendaUI.toast('Photo supprimée', 'success');
    closeTeamModal();
    loadTeam();
  } catch (e) { GendaUI.toast('Erreur', 'error'); }
}

// ============================================================
// Deactivate / Reactivate
// ============================================================

async function confirmDeactivatePract(id, name) {
  const confirmed = await showConfirmDialog(
    'Désactiver ' + sectorLabels.practitioner,
    `Désactiver ${name} ? Ses RDV futurs pourront être annulés.`,
    'Désactiver',
    'danger'
  );
  if (!confirmed) return;
  closeTeamModal();
  deactivatePract(id);
}

async function deactivatePract(id) {
  try {
    // First call: check for future bookings (no query params → 409 if bookings exist)
    const r = await fetch(`/api/practitioners/${id}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + api.getToken() } });

    if (r.status === 409) {
      const data = await r.json();
      const count = data.future_bookings_count || 0;

      // Step 1: Confirm deactivation
      const step1 = await showConfirmDialog(
        'Désactiver ' + sectorLabels.practitioner,
        `Ce ${sectorLabels.practitioner.toLowerCase()} a ${count} RDV à venir. Voulez-vous quand même le désactiver ?`,
        'Désactiver',
        'danger'
      );
      if (!step1) return;

      // Step 2: Ask about the bookings
      const cancelThem = await showConfirmDialog(
        'Annuler les RDV ?',
        `Souhaitez-vous annuler les ${count} RDV à venir ?`,
        'Annuler les RDV',
        'danger'
      );

      const qp = cancelThem ? '?cancel_bookings=true' : '?keep_bookings=true';
      const r2 = await fetch(`/api/practitioners/${id}${qp}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + api.getToken() } });
      if (!r2.ok) throw new Error((await r2.json()).error);
      const result = await r2.json();
      if (result.cancelled_count > 0) {
        GendaUI.toast(`${sectorLabels.practitioner} désactivé, ${result.cancelled_count} RDV annulés`, 'success');
      } else {
        GendaUI.toast(sectorLabels.practitioner + ' désactivé (RDV conservés)', 'success');
      }
    } else if (!r.ok) {
      throw new Error((await r.json()).error);
    } else {
      GendaUI.toast(sectorLabels.practitioner + ' désactivé', 'success');
    }
    loadTeam();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

async function reactivatePract(id) {
  try {
    const r = await fetch(`/api/practitioners/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() }, body: JSON.stringify({ is_active: true, booking_enabled: true }) });
    if (!r.ok) throw new Error((await r.json()).error);
    GendaUI.toast(sectorLabels.practitioner + ' réactivé', 'success');
    loadTeam();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

async function confirmDeletePract(id, name) {
  const confirmed = await showConfirmDialog(
    'Supprimer définitivement',
    'Supprimer définitivement ' + name + ' ? Cette action est irréversible. Toutes ses données (horaires, services assignés) seront perdues. Les RDV existants seront conservés mais non assignés.',
    'Supprimer définitivement',
    'danger'
  );
  if (!confirmed) return;
  closeTeamModal();
  deletePractPermanent(id);
}

async function deletePractPermanent(id) {
  try {
    const r = await fetch('/api/practitioners/' + id + '?permanent=true', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (r.status === 409) {
      const data = await r.json();
      const cancelThem = await showConfirmDialog(
        'RDV à venir',
        data.error + ' Voulez-vous les annuler ?',
        'Annuler les RDV et supprimer',
        'danger'
      );
      if (!cancelThem) return;
      const r2 = await fetch('/api/practitioners/' + id + '?permanent=true&cancel_bookings=true', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + api.getToken() } });
      if (!r2.ok) throw new Error((await r2.json()).error);
    } else if (!r.ok) {
      throw new Error((await r.json()).error);
    }
    GendaUI.toast(sectorLabels.practitioner + ' supprimé définitivement', 'success');
    loadTeam();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

// ============================================================
// Tasks modal (unchanged from v1)
// ============================================================

async function openPracTasks(pracId, pracName) {
  try {
    const r = await fetch(`/api/practitioners/${pracId}/tasks`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (!r.ok) throw new Error('Erreur');
    const data = await r.json();
    const todos = data.todos || [], reminders = data.reminders || [];
    const pendingTodos = todos.filter(t => !t.is_done), doneTodos = todos.filter(t => t.is_done);
    const pendingReminders = reminders.filter(r => !r.is_sent), sentReminders = reminders.filter(r => r.is_sent);

    let h = `<div class="m-overlay open" id="tasksModalOverlay"><div class="m-dialog m-flex m-md">
      <div class="m-header" style="flex-shrink:0">
        <div class="m-header-bg" style="background:linear-gradient(135deg,var(--primary) 0%,var(--primary) 60%,rgba(13,115,119,.3) 100%)"></div>
        <button class="m-close" onclick="closeTasksModal()">×</button>
        <div class="m-header-content">
          <div class="m-client-hero">
            <div class="m-avatar" style="background:var(--primary)"><svg class="gi" style="width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2" ${ICONS.tasks.slice(4)}></div>
            <div class="m-client-info">
              <div class="m-client-name">${pracName}</div>
              <div class="m-client-meta">Tâches & rappels</div>
            </div>
          </div>
        </div>
      </div>
      <div class="m-body" style="overflow-y:auto;flex:1">`;

    h += `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Tâches en cours (${pendingTodos.length})</span><span class="m-sec-line"></span></div>`;
    if (pendingTodos.length === 0) { h += `<div style="font-size:.8rem;color:var(--text-4)">Aucune tâche en cours</div>`; }
    else {
      pendingTodos.forEach(t => {
        const dt = t.booking_start ? new Date(t.booking_start).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' }) : '';
        h += `<div style="padding:8px 0;border-bottom:1px solid var(--border-light);display:flex;gap:10px;align-items:flex-start">
          <input type="checkbox" onchange="togglePracTodo('${t.id}','${t.booking_id}',this.checked,'${pracId}','${esc(pracName)}')" style="margin-top:3px">
          <div style="flex:1;min-width:0">
            <div style="font-size:.82rem">${escH(t.content)}</div>
            <div style="font-size:.7rem;color:var(--text-4)">${t.client_name || ''} ${t.service_name ? '· ' + t.service_name : ''} ${dt ? '· ' + dt : ''}</div>
          </div>
        </div>`;
      });
    }
    h += `</div>`;

    if (doneTodos.length > 0) {
      h += `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title" style="color:var(--text-4)">Terminées (${doneTodos.length})</span><span class="m-sec-line"></span></div>`;
      doneTodos.slice(0, 10).forEach(t => {
        h += `<div style="padding:6px 0;border-bottom:1px solid var(--border-light);opacity:.5">
          <div style="font-size:.8rem;text-decoration:line-through">${escH(t.content)}</div>
          <div style="font-size:.68rem;color:var(--text-4)">${t.client_name || ''} · ${t.done_at ? new Date(t.done_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' }) : ''}</div>
        </div>`;
      });
      if (doneTodos.length > 10) h += `<div style="font-size:.72rem;color:var(--text-4);padding:4px 0">+ ${doneTodos.length - 10} autres</div>`;
      h += `</div>`;
    }

    h += `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Rappels à venir (${pendingReminders.length})</span><span class="m-sec-line"></span></div>`;
    if (pendingReminders.length === 0) { h += `<div style="font-size:.8rem;color:var(--text-4)">Aucun rappel en attente</div>`; }
    else {
      pendingReminders.forEach(r => {
        const dt = new Date(r.remind_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' });
        h += `<div style="padding:8px 0;border-bottom:1px solid var(--border-light)">
          <div style="font-size:.82rem">${dt}</div>
          <div style="font-size:.7rem;color:var(--text-4)">${r.client_name || ''} ${r.service_name ? '· ' + r.service_name : ''} ${r.message ? '· ' + escH(r.message) : ''}</div>
        </div>`;
      });
    }
    if (sentReminders.length > 0) {
      h += `<div style="font-size:.72rem;color:var(--text-4);margin-top:8px">${sentReminders.length} rappel${sentReminders.length > 1 ? 's' : ''} déjà envoyé${sentReminders.length > 1 ? 's' : ''}</div>`;
    }
    h += `</div>`;

    h += `</div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', h);
    const tasksOv = document.getElementById('tasksModalOverlay');
    guardModal(tasksOv, { noBackdropClose: true });
    trapFocus(tasksOv, () => closeTasksModal());
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

function closeTasksModal() {
  releaseFocus();
  closeModal('tasksModalOverlay');
  if (!document.querySelector('.m-overlay.open')) document.body.classList.remove('has-modal');
}

async function togglePracTodo(todoId, bookingId, done, pracId, pracName) {
  try {
    await fetch(`/api/bookings/${bookingId}/todos/${todoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ is_done: done })
    });
    closeTasksModal();
    openPracTasks(pracId, pracName);
  } catch (e) { GendaUI.toast('Erreur', 'error'); }
}

// ============================================================
// Invite modal
// ============================================================

function openInviteModal(practId, name) {
  const sl = SECTOR_LABELS[userSector] || SECTOR_LABELS.autre;
  let m = `<div class="m-overlay open" id="inviteModalOverlay"><div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Créer un accès — ${name}</h3>
      <button class="m-close" onclick="closeInviteModal()">${ICONS.close}</button>
    </div>
    <div class="m-body">
      <p style="font-size:.85rem;color:var(--text-3);margin-bottom:14px">Créez un compte pour que <strong>${name}</strong> puisse se connecter au dashboard.</p>
      <div class="m-sec">
        <div class="m-field-label">Email *</div>
        <input class="m-input" id="inv_email" type="email" placeholder="email@exemple.com">
      </div>
      <div class="m-sec" style="margin-top:12px">
        <div class="m-field-label">Mot de passe temporaire *</div>
        <input class="m-input" id="inv_pwd" type="text" value="${generateTempPwd()}" style="font-family:monospace">
        <div style="font-size:.68rem;color:var(--text-4);margin-top:4px">Communiquez ce mot de passe. Il pourra être changé plus tard.</div>
      </div>
      <div class="m-sec" style="margin-top:12px">
        <div class="m-field-label">Rôle *</div>
        <select class="m-input" id="inv_role">
          <option value="owner">Propriétaire / Manager — Accès complet au dashboard</option>
          <option value="practitioner">${sl.practitioner} — Voit uniquement son propre agenda et ses clients</option>
        </select>
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeInviteModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="sendInvite('${practId}')">Créer le compte</button>
    </div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
  const invOv = document.getElementById('inviteModalOverlay');
  guardModal(invOv, { noBackdropClose: true });
  trapFocus(invOv, () => closeInviteModal());
}

async function closeInviteModal() {
  releaseFocus();
  await closeModal('inviteModalOverlay');
}

function generateTempPwd() { const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'; let pwd = ''; for (let i = 0; i < 10; i++) pwd += chars[Math.floor(Math.random() * chars.length)]; return pwd; }

async function sendInvite(practId) {
  const email = document.getElementById('inv_email').value;
  const password = document.getElementById('inv_pwd').value;
  const role = document.getElementById('inv_role').value;
  if (!email || !password) return GendaUI.toast('Email et mot de passe requis', 'error');
  try {
    const r = await fetch(`/api/practitioners/${practId}/invite`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() }, body: JSON.stringify({ email, password, role }) });
    if (!r.ok) throw new Error((await r.json()).error);
    document.getElementById('inviteModalOverlay')?._dirtyGuard?.markClean(); closeInviteModal();
    GendaUI.toast('Compte créé ! Communiquez les identifiants.', 'success');
    loadTeam();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

// ============================================================
// Role modal
// ============================================================

function openRoleModal(practId, name, currentRole) {
  const sl = SECTOR_LABELS[userSector] || SECTOR_LABELS.autre;
  const roles = [
    { value: 'owner', label: 'Propriétaire / Manager', desc: 'Accès complet au dashboard' },
    { value: 'practitioner', label: sl.practitioner, desc: 'Voit uniquement son propre agenda et ses clients' }
  ];
  let m = `<div class="m-overlay open" id="roleModalOverlay"><div class="m-dialog m-sm">
    <div class="m-header-simple">
      <h3>Modifier le rôle — ${name}</h3>
      <button class="m-close" onclick="closeRoleModal()">${ICONS.close}</button>
    </div>
    <div class="m-body">
      <div style="display:flex;flex-direction:column;gap:8px">`;
  roles.forEach(r => {
    const checked = r.value === currentRole ? 'checked' : '';
    const borderColor = r.value === currentRole ? 'var(--primary)' : 'var(--border-light)';
    m += `<label style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1.5px solid ${borderColor};border-radius:10px;cursor:pointer;transition:all .15s" onmouseover="this.style.borderColor='var(--primary)'" onmouseout="this.style.borderColor='${r.value === currentRole ? 'var(--primary)' : 'var(--border-light)'}'" onclick="this.parentElement.querySelectorAll('label').forEach(l=>l.style.borderColor='var(--border-light)');this.style.borderColor='var(--primary)'">
      <input type="radio" name="role_pick" value="${r.value}" ${checked} style="margin-top:2px">
      <div><div style="font-size:.88rem;font-weight:600">${r.label}</div><div style="font-size:.75rem;color:var(--text-4);margin-top:2px">${r.desc}</div></div>
    </label>`;
  });
  m += `</div></div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeRoleModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="saveRole('${practId}')">Enregistrer</button>
    </div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
  const roleOv = document.getElementById('roleModalOverlay');
  guardModal(roleOv, { noBackdropClose: true });
  trapFocus(roleOv, () => closeRoleModal());
}

async function closeRoleModal() {
  releaseFocus();
  await closeModal('roleModalOverlay');
}

async function saveRole(practId) {
  const picked = document.querySelector('input[name="role_pick"]:checked');
  if (!picked) return GendaUI.toast('Sélectionnez un rôle', 'error');
  try {
    const r = await fetch(`/api/practitioners/${practId}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() }, body: JSON.stringify({ role: picked.value }) });
    if (!r.ok) throw new Error((await r.json()).error);
    document.getElementById('roleModalOverlay')?._dirtyGuard?.markClean(); closeRoleModal();
    GendaUI.toast('Rôle modifié', 'success');
    loadTeam();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

// ============================================================
// Bridge all functions
// ============================================================
// CALENDAR SYNC (per practitioner) — moved from documents.js
// ============================================================

const _esc=s=>s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'):'';

async function loadPracCalSync(pracId){
  const area=document.getElementById('p_cal_area');
  if(!area)return;
  try{
    const r=await fetch(`/api/calendar/connections?practitioner_id=${pracId}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=r.ok?await r.json():{connections:[]};
    const conns=d.connections||[];
    const gConn=conns.find(c=>c.provider==='google');
    const oConn=conns.find(c=>c.provider==='outlook');
    const iConn=conns.find(c=>c.provider==='ical');
    let h=`<div style="display:grid;gap:8px">`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Google Calendar</div>
          ${gConn?`<div style="font-size:.68rem;color:var(--green)">${IC.check} ${_esc(gConn.email||'Connecté')}${gConn.last_sync_at?' \u00b7 '+new Date(gConn.last_sync_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'}):''}</div>`
          :`<div style="font-size:.68rem;color:var(--text-4)">Non connecté</div>`}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        ${gConn?`
          <button onclick="syncCalendar('${gConn.id}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          <button onclick="disconnectCalendar('${gConn.id}','google','${pracId}')" class="btn-outline btn-sm btn-danger" style="font-size:.72rem;padding:4px 10px">${IC.x}</button>
        `:`<button onclick="connectCalendar('google','${pracId}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">Connecter</button>`}
      </div>
    </div>`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem">${IC.mail}</span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Outlook</div>
          ${oConn?`<div style="font-size:.68rem;color:var(--green)">${IC.check} ${_esc(oConn.email||'Connecté')}${oConn.last_sync_at?' \u00b7 '+new Date(oConn.last_sync_at).toLocaleDateString('fr-BE',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Europe/Brussels'}):''}</div>`
          :`<div style="font-size:.68rem;color:var(--text-4)">Non connecté</div>`}
        </div>
      </div>
      <div style="display:flex;gap:4px">
        ${oConn?`
          <button onclick="syncCalendar('${oConn.id}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg></button>
          <button onclick="disconnectCalendar('${oConn.id}','outlook','${pracId}')" class="btn-outline btn-sm btn-danger" style="font-size:.72rem;padding:4px 10px">${IC.x}</button>
        `:`<button onclick="connectCalendar('outlook','${pracId}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">Connecter</button>`}
      </div>
    </div>`;
    h+=`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--white);border:1px solid var(--border-light);border-radius:8px">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.1rem"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg></span>
        <div>
          <div style="font-size:.82rem;font-weight:600">Apple / iCal</div>
          <div style="font-size:.68rem;color:var(--text-4)">URL d'abonnement</div>
        </div>
      </div>
      <button onclick="generateIcalFeed('${pracId}')" class="btn-outline btn-sm" style="font-size:.72rem;padding:4px 10px;color:var(--primary);border-color:var(--primary)">${iConn?'Regénérer':'Générer'}</button>
    </div>`;
    h+=`</div>`;
    h+=`<div id="p_ical_url" style="display:none;margin-top:8px"></div>`;
    if(gConn||oConn){
      const dir=(gConn||oConn).sync_direction||'both';
      h+=`<div style="margin-top:10px;display:flex;align-items:center;gap:8px;font-size:.78rem">
        <span style="color:var(--text-3)">Direction :</span>
        <select onchange="updateCalSyncDirection(this.value,'${pracId}')" style="padding:3px 8px;border:1px solid var(--border);border-radius:4px;font-size:.75rem">
          <option value="both"${dir==='both'?' selected':''}> Bidirectionnelle</option>
          <option value="push"${dir==='push'?' selected':''}>\u2192 Push (Genda \u2192 Cal)</option>
          <option value="pull"${dir==='pull'?' selected':''}>\u2190 Pull (Cal \u2192 Genda)</option>
        </select>
      </div>`;
    }
    area.innerHTML=h;
  }catch(e){
    area.innerHTML=`<div style="font-size:.78rem;color:var(--text-4)">Impossible de charger les connexions calendrier.</div>`;
  }
}

async function connectCalendar(provider,pracId){
  try{
    const r=await api.get(`/api/calendar/${provider}/connect?practitioner_id=${pracId||''}`);
    if(r.url)window.location.href=r.url;
    else GendaUI.toast('Erreur de connexion','error');
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function disconnectCalendar(connId,provider,pracId){
  const provLabel = provider==='google' ? 'Google Calendar' : 'Outlook';
  const confirmed = await showConfirmDialog(
    'Déconnecter ' + provLabel,
    'Déconnecter ' + provLabel + ' ?',
    'Déconnecter',
    'danger'
  );
  if(!confirmed)return;
  try{
    await api.delete(`/api/calendar/connections/${connId}`);
    GendaUI.toast('Calendrier déconnecté','success');
    if(pracId)loadPracCalSync(pracId);
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function syncCalendar(connId){
  try{
    GendaUI.toast('Synchronisation en cours...','info');
    const r=await api.post(`/api/calendar/connections/${connId}/sync`);
    GendaUI.toast('Synchro terminée : '+(r.pushed||0)+' poussés, '+(r.pulled||0)+' récupérés','success');
  }catch(e){GendaUI.toast(e.message||'Erreur synchro','error');}
}

async function updateCalSyncDirection(direction,pracId){
  try{
    const r=await fetch(`/api/calendar/connections?practitioner_id=${pracId}`,{headers:{'Authorization':'Bearer '+api.getToken()}});
    const d=r.ok?await r.json():{connections:[]};
    for(const c of (d.connections||[])){
      if(c.provider!=='ical')await api.patch('/api/calendar/connections/'+c.id,{sync_direction:direction});
    }
    GendaUI.toast('Direction de synchro mise à jour','success');
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

async function generateIcalFeed(pracId){
  try{
    const r=await fetch('/api/calendar/ical/generate',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+api.getToken()},body:JSON.stringify({practitioner_id:pracId||null})});
    const d=await r.json();
    if(!r.ok)throw new Error(d.error||'Erreur');
    const el=document.getElementById('p_ical_url');
    if(!el)return;
    el.style.display='block';
    el.innerHTML=`
      <div style="padding:10px 12px;background:var(--white);border:1px solid var(--border-light);border-radius:6px">
        <div style="font-family:monospace;font-size:.68rem;word-break:break-all;user-select:all;cursor:text;color:var(--text-2);margin-bottom:6px">${d.ical_url}</div>
        <div style="display:flex;gap:6px">
          <button onclick="navigator.clipboard.writeText('${d.ical_url}');GendaUI.toast('URL copiée !','success')" class="btn-outline btn-sm" style="font-size:.7rem;padding:3px 10px">${IC.clipboard} Copier</button>
          <a href="${d.webcal_url}" class="btn-outline btn-sm" style="font-size:.7rem;padding:3px 10px;text-decoration:none;color:var(--primary)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-1-1-3.5-1.5-5 0s-2 4 0 7c1.5 2.5 3.5 3 5 5 1.5-2 3.5-2.5 5-5 2-3 1.5-5.5 0-7s-4-1-5 0Z"/><path d="M12 3c0-1 .5-2 2-2"/></svg> Ouvrir</a>
        </div>
      </div>`;
  }catch(e){GendaUI.toast(e.message||'Erreur','error');}
}

// Handle OAuth callback params on page load
(function(){
  const p=new URLSearchParams(location.search);
  if(p.get('cal_connected')){
    const prov=p.get('cal_connected')==='google'?'Google Calendar':'Outlook';
    setTimeout(function(){GendaUI.toast(prov+' connecté avec succès !','success');},500);
    history.replaceState(null,'','/dashboard');
    setTimeout(function(){
      document.querySelectorAll('.ni').forEach(function(n){n.classList.remove('active');});
      var el=document.querySelector('[data-section="team"]');if(el)el.classList.add('active');
      document.getElementById('pageTitle').textContent='Équipe';
      if(window.loadTeam) window.loadTeam();
    },600);
  }
  if(p.get('cal_error')){
    setTimeout(function(){GendaUI.toast('Erreur calendrier: '+p.get('cal_error'),'error');},500);
    history.replaceState(null,'','/dashboard');
  }
})();

// ============================================================

bridge({
  loadTeam, openPractModal, savePract, deactivatePract, reactivatePract, confirmDeactivatePract, confirmDeletePract, deletePractPermanent,
  openPracTasks, togglePracTodo, closeTasksModal,
  openInviteModal, generateTempPwd, sendInvite, closeInviteModal,
  openRoleModal, saveRole, closeRoleModal,
  pPhotoPreview, pRemovePhoto, closeTeamModal,
  teamSwitchTab, teamLoadLeave,
  teamLoadSchedule, teamAddSlot, teamConfirmAddSlot, teamRemoveSlot,
  teamEditSlot, teamConfirmEditSlot,
  teamToggleService, teamToggleCatServices, teamToggleAllServices,
  loadPracCalSync, connectCalendar, disconnectCalendar, syncCalendar, updateCalSyncDirection, generateIcalFeed
});

export {
  loadTeam, openPractModal, savePract, deactivatePract, reactivatePract, confirmDeactivatePract, confirmDeletePract, deletePractPermanent,
  openPracTasks, togglePracTodo, closeTasksModal,
  openInviteModal, sendInvite, closeInviteModal, openRoleModal, saveRole, closeRoleModal,
  pPhotoPreview, pRemovePhoto, closeTeamModal,
  teamSwitchTab, teamLoadLeave,
  teamLoadSchedule, teamAddSlot, teamConfirmAddSlot, teamRemoveSlot,
  teamEditSlot, teamConfirmEditSlot,
  teamToggleService, teamToggleCatServices, teamToggleAllServices,
  loadPracCalSync, connectCalendar, disconnectCalendar, syncCalendar, updateCalSyncDirection, generateIcalFeed
};
