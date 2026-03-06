/**
 * Team (Équipe) view module — v2
 * Premium cal-modal, skills, leave balances, enriched cards
 */
import { api, SECTOR_LABELS, userSector, sectorLabels, categoryLabels, GendaUI } from '../state.js';
import { bridge } from '../utils/window-bridge.js';
import { cswHTML } from './agenda/color-swatches.js';

let pPendingPhoto = null;
let teamCurrentTab = 'profile';
let teamEditSkills = []; // mutable copy for editing
let teamLeaveYear = new Date().getFullYear();
let teamEditSchedule = {}; // mutable copy of schedule for editing (weekday -> [{start_time,end_time}])
let teamEditPracId = null; // practitioner id being edited

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function escH(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const ICONS = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  tasks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  role: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  hourglass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
};

const DAY_LABELS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const CONTRACT_LABELS = { cdi: 'CDI', cdd: 'CDD', independant: 'Indépendant', stagiaire: 'Stagiaire', interim: 'Intérim' };
const LEVEL_LABELS = { 1: 'Junior', 2: 'Confirmé', 3: 'Expert' };
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

    let h = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3 style="font-size:.95rem;font-weight:700">${practs.length} membre${practs.length > 1 ? 's' : ''} de l'équipe</h3>
      <button class="btn-primary" onclick="openPractModal()">+ Ajouter</button>
    </div>`;

    if (practs.length === 0) {
      h += `<div class="card"><div class="empty">Aucun ${pracLabel}. Ajoutez votre premier membre !</div></div>`;
    } else {
      h += `<div class="team-grid2">`;
      practs.forEach(p => {
        const initials = p.display_name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '??';
        const hasLogin = !!p.user_email;
        const avatarContent = p.photo_url
          ? `<img src="${p.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`
          : initials;

        const regime = computeRegime(p.work_days);
        const leave = getLeaveBalance(p.leave_balance);
        const anciennete = computeAnciennete(p.hire_date);
        const today = new Date(new Date().toDateString());

        h += `<div class="team-member${p.is_active ? '' : ' inactive'}">
          <div class="tm-header">
            <div class="tm-avatar" style="background:${p.color || 'var(--primary)'}">${avatarContent}</div>
            <div class="tm-info">
              <h4>${p.display_name}</h4>
              <div class="tm-title">${p.title || '—'}${p.years_experience ? ' · ' + p.years_experience + ' ans' : ''}</div>
              ${p.user_email ? `<div class="tm-email"><svg class="gi" ${ICONS.key.slice(4)}> ${p.user_email}</div>` : `<div class="tm-email" style="color:var(--text-4)">Pas de compte</div>`}
            </div>
          </div>

          <!-- Work dots -->
          <div class="tm-work-dots" title="${regime.label}${regime.detail ? ' (' + regime.detail + ')' : ''}">
            ${DAY_LABELS.map((d, i) => `<div class="tm-work-dot-wrap"><span class="tm-work-dot ${p.work_days && p.work_days.includes(i) ? 'on' : 'off'}"></span><span class="tm-work-dot-label">${d}</span></div>`).join('')}
            <span class="tm-regime-label">${regime.label}</span>
          </div>

          <div class="tm-stats">
            <div class="tm-stat"><div class="v">${p.bookings_30d || 0}</div><div class="l">RDV / 30j</div></div>
            <div class="tm-stat"><div class="v">${leave ? leave.solde + 'j' : '—'}</div><div class="l">Solde congés</div></div>
            <div class="tm-stat"><div class="v">${anciennete}</div><div class="l">Ancienneté</div></div>
            <div class="tm-stat"><div class="v">${p.service_count || 0}</div><div class="l">${categoryLabels.services}</div></div>
          </div>

          <!-- Skills chips -->
          ${p.skills && p.skills.length > 0 ? `<div class="tm-skills">${p.skills.slice(0, 4).map(s =>
            `<span class="tm-skill-chip level-${s.level}">${esc(s.skill_name)}</span>`
          ).join('')}${p.skills.length > 4 ? `<span class="tm-skill-chip" style="background:var(--surface);color:var(--text-4)">+${p.skills.length - 4}</span>` : ''}</div>` : ''}

          <div class="tm-badges">
            <span class="tm-badge ${p.is_active ? 'active' : 'inactive'}">${p.is_active ? 'Actif' : 'Inactif'}</span>
            ${p.contract_type && p.contract_type !== 'cdi' ? `<span class="tm-badge" style="background:#F0F9FF;color:#0369A1">${CONTRACT_LABELS[p.contract_type] || p.contract_type}</span>` : ''}
            <span class="tm-badge ${p.booking_enabled ? 'booking' : 'no-booking'}">${p.booking_enabled ? 'Réservable' : 'Non réservable'}</span>
            ${p.waitlist_mode && p.waitlist_mode !== 'off' ? `<span class="tm-badge" style="background:${p.waitlist_mode === 'auto' ? '#DCFCE7;color:#15803D' : '#FEF3C7;color:#92400E'}"><svg class="gi" ${ICONS.hourglass.slice(4)}> ${p.waitlist_mode === 'auto' ? 'WL auto' : 'WL manuelle'}</span>` : ''}

            ${p.vacation_until && new Date(p.vacation_until) >= today ? `<span class="tm-badge" style="background:#FEF3C7;color:#92400E"><svg class="gi" ${ICONS.sun.slice(4)}> Vacances → ${new Date(p.vacation_until).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })}</span>` : ''}
            ${(() => {
              const pc = calConns.filter(c => c.practitioner_id === p.id);
              if (pc.length === 0) return '';
              const providers = pc.map(c => c.provider === 'google' ? 'Google' : c.provider === 'outlook' ? 'Outlook' : 'iCal').join(', ');
              return `<span class="tm-badge" style="background:#EFF9F8;color:#0D7377"><svg class="gi" ${ICONS.calendar.slice(4)}> ${providers}</span>`;
            })()}
            ${hasLogin ? `<span class="tm-badge has-login">${sectorLabels[p.user_role] || p.user_role || 'Compte lié'}</span>` : ''}
          </div>

          <div class="tm-actions">
            <button class="btn-outline btn-sm" onclick="openPracTasks('${p.id}','${esc(p.display_name)}')"><svg class="gi" ${ICONS.tasks.slice(4)}> Tâches</button>
            <button class="btn-outline btn-sm" onclick="openPractModal('${p.id}')"><svg class="gi" ${ICONS.edit.slice(4)}> Modifier</button>
            ${hasLogin ? `<button class="btn-outline btn-sm" onclick="openRoleModal('${p.id}','${esc(p.display_name)}','${p.user_role || 'practitioner'}')"><svg class="gi" ${ICONS.role.slice(4)}> Rôle</button>` : ''}
            ${!hasLogin ? `<button class="btn-outline btn-sm" onclick="openInviteModal('${p.id}','${esc(p.display_name)}')"><svg class="gi" ${ICONS.key.slice(4)}> Créer un accès</button>` : ''}
            ${p.is_active ? `<button class="btn-outline btn-sm btn-danger" onclick="if(confirm('Désactiver ${esc(p.display_name)} ?'))deactivatePract('${p.id}')">Désactiver</button>` : `<button class="btn-outline btn-sm" onclick="reactivatePract('${p.id}')">Réactiver</button>`}
          </div>
        </div>`;
      });
      h += `</div>`;
    }
    c.innerHTML = h;
  } catch (e) { c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur: ${e.message}</div>`; }
}

// ============================================================
// Premium cal-modal — Practitioner detail/edit
// ============================================================

function openPractModal(editId) {
  if (editId) {
    fetch('/api/practitioners', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }).then(r => r.json()).then(d => {
      renderPractModal(d.practitioners.find(p => p.id === editId));
    });
  } else { renderPractModal(null); }
}

function renderPractModal(p) {
  pPendingPhoto = null;
  teamCurrentTab = 'profile';
  teamEditSkills = p?.skills ? JSON.parse(JSON.stringify(p.skills)) : [];
  teamLeaveYear = new Date().getFullYear();

  const isEdit = !!p;
  const photoSrc = p?.photo_url || '';
  const initials = p?.display_name ? p.display_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : '';
  const pracLbl = sectorLabels.practitioner.toLowerCase();
  const accentColor = p?.color || '#0D7377';

  let h = `<div id="teamModalOverlay" class="cal-modal-overlay open">
    <div class="cal-modal" style="overflow:hidden;display:flex;flex-direction:column;height:85vh;max-width:580px">

    <!-- M-HEADER -->
    <div class="m-header">
      <div class="m-header-bg" style="background:linear-gradient(135deg,${accentColor} 0%,${accentColor}AA 60%,${accentColor}55 100%)"></div>
      <button class="m-close" onclick="closeTeamModal()">×</button>
      <div class="m-header-content">
        <div class="m-client-hero">
          <div class="m-avatar" id="tm_avatar" style="background:linear-gradient(135deg,${accentColor},${accentColor}CC);cursor:pointer" onclick="document.getElementById('p_photo_input').click()" title="Changer la photo">
            ${photoSrc ? `<img src="${photoSrc}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">` : `<span style="color:#fff;font-size:1.1rem;font-weight:700">${initials || '+'}</span>`}
          </div>
          <input type="file" id="p_photo_input" accept="image/jpeg,image/png,image/webp" style="display:none" onchange="pPhotoPreview(this)">
          <div class="m-client-info">
            <div class="m-client-name">${isEdit ? p.display_name : 'Nouveau ' + pracLbl}</div>
            <div class="m-client-meta">
              ${p?.title ? esc(p.title) : ''}
              ${p?.email ? ` · ${esc(p.email)}` : ''}
            </div>
          </div>
          ${isEdit ? `<div class="m-quick-actions">
            ${p.phone ? `<a class="m-qbtn" href="tel:${esc(p.phone)}" title="Appeler"><svg class="gi" style="width:14px;height:14px" ${ICONS.phone.slice(4)}></a>` : ''}
            ${p.email ? `<a class="m-qbtn" href="mailto:${esc(p.email)}" title="Email"><svg class="gi" style="width:14px;height:14px" ${ICONS.mail.slice(4)}></a>` : ''}
          </div>` : ''}
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
    <div class="cal-modal-body">

      <!-- TAB: PROFIL -->
      <div class="cal-panel active" id="team-panel-profile">
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
          <textarea class="m-input" id="p_note" style="min-height:60px" placeholder="Notes privées (visibles par le manager uniquement)...">${esc(p?.internal_note || '')}</textarea>
        </div>

        ${isEdit && photoSrc ? `<div style="text-align:center;margin-top:8px"><button onclick="pRemovePhoto('${p.id}')" style="font-size:.7rem;color:var(--red);background:none;border:none;cursor:pointer">Supprimer la photo</button></div>` : ''}
      </div>

      <!-- TAB: COMPÉTENCES -->
      <div class="cal-panel" id="team-panel-skills">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Compétences</span><span class="m-sec-line"></span></div>
          <div id="tm_skills_list">${renderSkillsList()}</div>
          <div style="margin-top:12px;display:flex;gap:8px;align-items:center">
            <input class="m-input" id="tm_new_skill" placeholder="Nouvelle compétence..." style="flex:1" onkeydown="if(event.key==='Enter'){event.preventDefault();teamAddSkill()}">
            <button class="m-btn m-btn-primary" style="padding:8px 14px;font-size:.75rem" onclick="teamAddSkill()"><svg class="gi" style="width:12px;height:12px" ${ICONS.plus.slice(4)}> Ajouter</button>
          </div>
        </div>
        ${isEdit ? `<div class="m-sec" style="margin-top:20px">
          <div class="m-sec-head"><span class="m-sec-title">Services liés (${p.service_count || 0})</span><span class="m-sec-line"></span></div>
          <div style="font-size:.78rem;color:var(--text-4)">Les services sont gérés dans la section <a href="#" onclick="event.preventDefault();window.loadSection&&window.loadSection('services')" style="color:var(--primary)">Prestations <svg class="gi" style="width:10px;height:10px" ${ICONS.link.slice(4)}></a></div>
        </div>` : ''}
      </div>

      <!-- TAB: HORAIRE -->
      <div class="cal-panel" id="team-panel-schedule">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Disponibilités hebdomadaires</span><span class="m-sec-line"></span></div>
          <div id="tm_schedule_editor">${isEdit ? '<div style="font-size:.78rem;color:var(--text-4)">Chargement...</div>' : renderScheduleEditor()}</div>
        </div>
        ${p?.weekly_hours_target ? `<div style="margin-top:10px;font-size:.78rem;color:var(--text-3)">Heures/semaine cible : <strong>${p.weekly_hours_target}h</strong></div>` : ''}
      </div>

      <!-- TAB: CONGÉS -->
      ${isEdit ? `<div class="cal-panel" id="team-panel-leave">
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
      <div class="cal-panel" id="team-panel-settings">
        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Agenda</span><span class="m-sec-line"></span></div>
          <div class="m-row m-row-2">
            <div><div class="m-field-label">Incrément agenda</div><select class="m-input" id="p_slot_inc">
              ${[5, 10, 15, 20, 30, 45, 60].map(v => `<option value="${v}"${(p?.slot_increment_min || 15) === v ? ' selected' : ''}>${v} min</option>`).join('')}
            </select></div>
            <div><div class="m-field-label">Capacité simultanée</div><select class="m-input" id="p_max_concurrent">
              ${[1, 2, 3, 4, 5, 6, 8, 10].map(v => `<option value="${v}"${(p?.max_concurrent || 1) === v ? ' selected' : ''}>${v}${v === 1 ? ' (pas de chevauchement)' : ' simultanés'}</option>`).join('')}
            </select></div>
          </div>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Réservation en ligne</span><span class="m-sec-line"></span></div>
          <label style="display:flex;align-items:center;gap:8px;font-size:.82rem;cursor:pointer">
            <input type="checkbox" id="p_booking" ${p?.booking_enabled !== false ? 'checked' : ''}> Peut recevoir des réservations en ligne
          </label>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Liste d'attente</span><span class="m-sec-line"></span></div>
          <select class="m-input" id="p_waitlist">
            <option value="off"${(p?.waitlist_mode || 'off') === 'off' ? ' selected' : ''}>Désactivée</option>
            <option value="manual"${p?.waitlist_mode === 'manual' ? ' selected' : ''}>Manuelle — je contacte le client moi-même</option>
            <option value="auto"${p?.waitlist_mode === 'auto' ? ' selected' : ''}>Automatique — offre envoyée au 1er en file</option>
          </select>
        </div>

        <div class="m-sec">
          <div class="m-sec-head"><span class="m-sec-title">Vacances</span><span class="m-sec-line"></span></div>
          <div class="m-field-label"><svg class="gi" style="width:12px;height:12px" ${ICONS.sun.slice(4)}> En vacances jusqu'au</div>
          <input class="m-input" type="date" id="p_vacation" value="${p?.vacation_until ? p.vacation_until.slice(0, 10) : ''}">
          <div style="font-size:.68rem;color:var(--text-4);margin-top:4px">Si renseigné, ce praticien ne sera plus réservable en ligne.</div>
        </div>

        ${isEdit ? `<div class="m-sec" style="margin-top:16px">
          <div class="m-sec-head"><span class="m-sec-title"><svg class="gi" style="width:12px;height:12px" ${ICONS.calendar.slice(4)}> Synchronisation calendrier</span><span class="m-sec-line"></span></div>
          <div id="p_cal_area" style="font-size:.82rem;color:var(--text-4)">Chargement...</div>
        </div>` : ''}
      </div>

    </div>

    <!-- BOTTOM BAR -->
    <div class="m-bottom">
      ${isEdit ? `<button class="m-btn m-btn-danger" onclick="if(confirm('Désactiver ${esc(p.display_name)} ?')){closeTeamModal();deactivatePract('${p.id}')}">Désactiver</button>` : ''}
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeTeamModal()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="savePract(${isEdit ? "'" + p.id + "'" : 'null'})">${isEdit ? 'Enregistrer' : 'Créer'}</button>
    </div>

  </div></div>`;

  document.body.insertAdjacentHTML('beforeend', h);
  document.getElementById('p_color_wrap').innerHTML = cswHTML('p_color', p?.color || '#1E3A8A', false);

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

function closeTeamModal() {
  document.getElementById('teamModalOverlay')?.remove();
}

function teamSwitchTab(tab) {
  teamCurrentTab = tab;
  document.querySelectorAll('#teamModalOverlay .m-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.querySelectorAll('#teamModalOverlay .cal-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('team-panel-' + tab)?.classList.add('active');
}

// ============================================================
// Skills management
// ============================================================

function renderSkillsList() {
  if (teamEditSkills.length === 0) {
    return `<div style="font-size:.78rem;color:var(--text-4);padding:12px 0">Aucune compétence ajoutée</div>`;
  }
  return teamEditSkills.map((s, i) => `
    <div class="skill-row">
      <span style="font-size:.72rem;color:var(--text-4);width:20px;text-align:center">${i + 1}</span>
      <input class="m-input" value="${esc(s.skill_name)}" style="flex:1" onchange="teamEditSkills[${i}].skill_name=this.value">
      <div class="skill-level-chips">
        ${[1, 2, 3].map(lv => `<span class="skill-level-chip${s.level === lv ? ' active' : ''}" onclick="teamSetSkillLevel(${i},${lv})">${LEVEL_LABELS[lv]}</span>`).join('')}
      </div>
      <button style="background:none;border:none;cursor:pointer;color:var(--text-4);padding:4px" onclick="teamRemoveSkill(${i})" title="Supprimer"><svg class="gi" style="width:14px;height:14px" ${ICONS.trash.slice(4)}></button>
    </div>
  `).join('');
}

function teamAddSkill() {
  const input = document.getElementById('tm_new_skill');
  const name = input.value.trim();
  if (!name) return;
  teamEditSkills.push({ skill_name: name, level: 2, sort_order: teamEditSkills.length });
  input.value = '';
  document.getElementById('tm_skills_list').innerHTML = renderSkillsList();
}

function teamRemoveSkill(idx) {
  teamEditSkills.splice(idx, 1);
  document.getElementById('tm_skills_list').innerHTML = renderSkillsList();
}

function teamSetSkillLevel(idx, level) {
  teamEditSkills[idx].level = level;
  document.getElementById('tm_skills_list').innerHTML = renderSkillsList();
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
      `<div style="color:var(--red);font-size:.82rem">Erreur: ${e.message}</div>`;
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
        h += `<span class="slot-chip">${(s.start_time || '').slice(0, 5)} – ${(s.end_time || '').slice(0, 5)}<button class="remove-slot" onclick="teamRemoveSlot(${d},${i})">${ICONS.close}</button></span>`;
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

  let m = `<div class="modal-overlay" style="z-index:350"><div class="modal" style="max-width:340px"><div class="modal-h"><h3>Créneau — ${DAYS_WEEK[day]}</h3><button class="close" onclick="this.closest('.modal-overlay').remove()">${ICONS.close}</button></div><div class="modal-body">
    <div class="field-row"><div class="field"><label>Début</label><input type="time" id="tm_slot_start" value="${(ds || '09:00').slice(0, 5)}"></div><div class="field"><label>Fin</label><input type="time" id="tm_slot_end" value="${de}"></div></div>
  </div><div class="modal-foot"><button class="btn-outline" onclick="this.closest('.modal-overlay').remove()">Annuler</button><button class="btn-primary" onclick="teamConfirmAddSlot(${day})">Ajouter</button></div></div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
}

function teamConfirmAddSlot(day) {
  const st = document.getElementById('tm_slot_start').value + ':00';
  const en = document.getElementById('tm_slot_end').value + ':00';
  if (!teamEditSchedule[day]) teamEditSchedule[day] = [];
  teamEditSchedule[day].push({ start_time: st, end_time: en });
  teamEditSchedule[day].sort((a, b) => a.start_time.localeCompare(b.start_time));
  document.querySelector('.modal-overlay[style*="z-index:350"]')?.remove();
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
        const from = new Date(a.date_from).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
        const to = new Date(a.date_to).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' });
        return `<div style="padding:6px 0;border-bottom:1px solid var(--border-light);display:flex;justify-content:space-between;align-items:center">
          <span><span class="tm-badge" style="font-size:.6rem;margin-right:6px;background:var(--surface)">${TYPE_LABELS[a.type] || a.type}</span> ${from}${from !== to ? ' → ' + to : ''}</span>
          <span style="font-size:.68rem;color:var(--text-4)">${a.note ? esc(a.note) : ''}</span>
        </div>`;
      }).join('');
    } else {
      absEl.innerHTML = '<div style="padding:8px 0">Aucune absence enregistrée</div>';
    }
  } catch (e) {
    document.getElementById('tm_leave_table').innerHTML = `<div style="color:var(--red);font-size:.82rem">Erreur: ${e.message}</div>`;
  }
}

// ============================================================
// Save practitioner
// ============================================================

async function savePract(id) {
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
    slot_increment_min: parseInt(document.getElementById('p_slot_inc').value) || 15,
    max_concurrent: parseInt(document.getElementById('p_max_concurrent').value) || 1,
    waitlist_mode: document.getElementById('p_waitlist').value,
    vacation_until: document.getElementById('p_vacation').value || null
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

    // Save skills if we have any (or if we cleared them)
    if (pracId) {
      try {
        await fetch(`/api/practitioners/${pracId}/skills`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ skills: teamEditSkills.map((s, i) => ({ skill_name: s.skill_name, level: s.level, sort_order: i })) })
        });
      } catch (e) { /* skills table might not exist yet */ }
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

    closeTeamModal();
    GendaUI.toast(id ? sectorLabels.practitioner + ' modifié' : sectorLabels.practitioner + ' ajouté', 'success');
    loadTeam();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
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
    document.getElementById('tm_avatar').innerHTML = `<img src="${e.target.result}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`;
  };
  reader.readAsDataURL(file);
}

async function pRemovePhoto(id) {
  if (!confirm('Supprimer la photo ?')) return;
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

async function deactivatePract(id) {
  try {
    const r = await fetch(`/api/practitioners/${id}`, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (!r.ok) throw new Error((await r.json()).error);
    GendaUI.toast(sectorLabels.practitioner + ' désactivé', 'success');
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

    let h = `<div class="cal-modal-overlay open" id="tasksModalOverlay"><div class="cal-modal" style="max-width:540px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column">
      <div class="m-header" style="flex-shrink:0">
        <div class="m-header-bg" style="background:linear-gradient(135deg,var(--primary) 0%,var(--primary) 60%,rgba(13,115,119,.3) 100%)"></div>
        <button class="m-close" onclick="document.getElementById('tasksModalOverlay').remove()">×</button>
        <div class="m-header-content">
          <div class="m-client-hero">
            <div class="m-avatar" style="background:var(--primary)"><svg style="width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2" ${ICONS.tasks.slice(4)}></div>
            <div class="m-client-info">
              <div class="m-client-name">${pracName}</div>
              <div class="m-client-meta">Tâches & rappels</div>
            </div>
          </div>
        </div>
      </div>
      <div class="cal-modal-body" style="overflow-y:auto;flex:1">`;

    h += `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Tâches en cours (${pendingTodos.length})</span><span class="m-sec-line"></span></div>`;
    if (pendingTodos.length === 0) { h += `<div style="font-size:.8rem;color:var(--text-4)">Aucune tâche en cours</div>`; }
    else {
      pendingTodos.forEach(t => {
        const dt = t.booking_start ? new Date(t.booking_start).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
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
          <div style="font-size:.68rem;color:var(--text-4)">${t.client_name || ''} · ${t.done_at ? new Date(t.done_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' }) : ''}</div>
        </div>`;
      });
      if (doneTodos.length > 10) h += `<div style="font-size:.72rem;color:var(--text-4);padding:4px 0">+ ${doneTodos.length - 10} autres</div>`;
      h += `</div>`;
    }

    h += `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title">Rappels à venir (${pendingReminders.length})</span><span class="m-sec-line"></span></div>`;
    if (pendingReminders.length === 0) { h += `<div style="font-size:.8rem;color:var(--text-4)">Aucun rappel en attente</div>`; }
    else {
      pendingReminders.forEach(r => {
        const dt = new Date(r.remind_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

async function togglePracTodo(todoId, bookingId, done, pracId, pracName) {
  try {
    await fetch(`/api/bookings/${bookingId}/todos/${todoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ is_done: done })
    });
    document.getElementById('tasksModalOverlay')?.remove();
    openPracTasks(pracId, pracName);
  } catch (e) { GendaUI.toast('Erreur', 'error'); }
}

// ============================================================
// Invite modal
// ============================================================

function openInviteModal(practId, name) {
  const sl = SECTOR_LABELS[userSector] || SECTOR_LABELS.autre;
  let m = `<div class="cal-modal-overlay open" id="inviteModalOverlay"><div class="cal-modal" style="max-width:460px">
    <div class="m-header" style="flex-shrink:0">
      <div class="m-header-bg" style="background:linear-gradient(135deg,var(--primary) 0%,var(--primary) 60%,rgba(13,115,119,.3) 100%)"></div>
      <button class="m-close" onclick="document.getElementById('inviteModalOverlay').remove()">×</button>
      <div class="m-header-content">
        <div class="m-client-hero">
          <div class="m-avatar" style="background:var(--primary)"><svg style="width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2" ${ICONS.key.slice(4)}></div>
          <div class="m-client-info">
            <div class="m-client-name">Créer un accès</div>
            <div class="m-client-meta">${name}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="cal-modal-body">
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
          <option value="practitioner">${sl.practitioner} — Voit uniquement son propre agenda et ses clients</option>
          <option value="receptionist">${sl.receptionist} — Voit l'agenda de tous, gère les RDV et clients</option>
          <option value="manager">${sl.manager} — Agenda de tous, clients, documents, statistiques</option>
        </select>
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('inviteModalOverlay').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="sendInvite('${practId}')">Créer le compte</button>
    </div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
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
    document.getElementById('inviteModalOverlay')?.remove();
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
    { value: 'practitioner', label: sl.practitioner, desc: 'Voit uniquement son propre agenda et ses clients' },
    { value: 'receptionist', label: sl.receptionist, desc: "Voit l'agenda de tous, gère les RDV et clients" },
    { value: 'manager', label: sl.manager, desc: 'Agenda de tous, clients, documents, statistiques' }
  ];
  let m = `<div class="cal-modal-overlay open" id="roleModalOverlay"><div class="cal-modal" style="max-width:460px">
    <div class="m-header" style="flex-shrink:0">
      <div class="m-header-bg" style="background:linear-gradient(135deg,var(--primary) 0%,var(--primary) 60%,rgba(13,115,119,.3) 100%)"></div>
      <button class="m-close" onclick="document.getElementById('roleModalOverlay').remove()">×</button>
      <div class="m-header-content">
        <div class="m-client-hero">
          <div class="m-avatar" style="background:var(--primary)"><svg style="width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2" ${ICONS.shield.slice(4)}></div>
          <div class="m-client-info">
            <div class="m-client-name">Modifier le rôle</div>
            <div class="m-client-meta">${name}</div>
          </div>
        </div>
      </div>
    </div>
    <div class="cal-modal-body">
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
      <button class="m-btn m-btn-ghost" onclick="document.getElementById('roleModalOverlay').remove()">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="saveRole('${practId}')">Enregistrer</button>
    </div>
  </div></div>`;
  document.body.insertAdjacentHTML('beforeend', m);
}

async function saveRole(practId) {
  const picked = document.querySelector('input[name="role_pick"]:checked');
  if (!picked) return GendaUI.toast('Sélectionnez un rôle', 'error');
  try {
    const r = await fetch(`/api/practitioners/${practId}/role`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() }, body: JSON.stringify({ role: picked.value }) });
    if (!r.ok) throw new Error((await r.json()).error);
    document.getElementById('roleModalOverlay')?.remove();
    GendaUI.toast('Rôle modifié', 'success');
    loadTeam();
  } catch (e) { GendaUI.toast('Erreur: ' + e.message, 'error'); }
}

// ============================================================
// Bridge all functions
// ============================================================

bridge({
  loadTeam, openPractModal, savePract, deactivatePract, reactivatePract,
  openPracTasks, togglePracTodo,
  openInviteModal, generateTempPwd, sendInvite,
  openRoleModal, saveRole,
  pPhotoPreview, pRemovePhoto, closeTeamModal,
  teamSwitchTab, teamAddSkill, teamRemoveSkill, teamSetSkillLevel, teamLoadLeave,
  teamLoadSchedule, teamAddSlot, teamConfirmAddSlot, teamRemoveSlot
});

export {
  loadTeam, openPractModal, savePract, deactivatePract, reactivatePract,
  openPracTasks, togglePracTodo,
  openInviteModal, sendInvite, openRoleModal, saveRole,
  pPhotoPreview, pRemovePhoto, closeTeamModal,
  teamSwitchTab, teamAddSkill, teamRemoveSkill, teamSetSkillLevel, teamLoadLeave,
  teamLoadSchedule, teamAddSlot, teamConfirmAddSlot, teamRemoveSlot
};
