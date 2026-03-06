/**
 * Planning (Staff Absences) view module — PRO feature.
 * Monthly grid showing practitioner absences & booking counts.
 */
import { api, sectorLabels } from '../state.js';
import { bridge } from '../utils/window-bridge.js';

function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

const DAY_NAMES = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const TYPE_LABELS = { conge: 'Congé', maladie: 'Maladie', formation: 'Form.', autre: 'Absent' };
const TYPE_EMOJIS = { conge: '🏖', maladie: '🤒', formation: '📚', autre: '⏸' };

let currentYear, currentMonth; // 0-indexed month
let practitioners = [];
let absences = [];    // raw from API
let absenceMap = {};  // { pracId: { dayNum: type } }

function initMonth() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
}

function monthKey() {
  return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
}

// ── Load planning view ──
async function loadPlanning() {
  initMonth();
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  await renderPlanning();
}

async function renderPlanning() {
  const c = document.getElementById('contentArea');
  try {
    // Fetch practitioners + absences in parallel
    const [pracR, absR] = await Promise.all([
      fetch('/api/practitioners', { headers: { 'Authorization': 'Bearer ' + api.getToken() } }),
      fetch('/api/planning/absences?month=' + monthKey(), { headers: { 'Authorization': 'Bearer ' + api.getToken() } })
    ]);
    const pracData = await pracR.json();
    const absData = await absR.json();
    practitioners = (pracData.practitioners || []).filter(p => p.is_active);
    absences = absData.absences || [];

    // Build absence map: { pracId: { dayNum: type } }
    buildAbsenceMap();

    // Render
    c.innerHTML = buildHTML();
  } catch (err) {
    console.error('Planning load error:', err);
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur de chargement: ${err.message}</div>`;
  }
}

function buildAbsenceMap() {
  absenceMap = {};
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  absences.forEach(a => {
    if (!absenceMap[a.practitioner_id]) absenceMap[a.practitioner_id] = {};
    const from = new Date(a.date_from);
    const to = new Date(a.date_to);
    // Walk each day of the absence that falls within current month
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
        absenceMap[a.practitioner_id][d.getDate()] = { type: a.type, id: a.id, note: a.note };
      }
    }
  });
}

function buildHTML() {
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const todayDate = new Date();
  const isCurrentMonth = todayDate.getFullYear() === currentYear && todayDate.getMonth() === currentMonth;
  const todayDay = isCurrentMonth ? todayDate.getDate() : -1;
  const pracLabel = sectorLabels.practitioner || 'Praticien';

  let h = '';

  // Top bar
  h += `<div class="plan-top">
    <div class="plan-top-left">
      <span class="plan-title">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/></svg>
        Planning du personnel
        <span class="plan-pro-badge">PRO</span>
      </span>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn-primary" onclick="planOpenAbsModal()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Nouvelle absence
      </button>
    </div>
  </div>`;

  // Month nav
  h += `<div class="plan-month-nav">
    <button class="plan-month-btn" onclick="planPrevMonth()">‹</button>
    <h2>${MONTH_NAMES[currentMonth]} ${currentYear}</h2>
    <button class="plan-month-btn" onclick="planNextMonth()">›</button>
    <button class="plan-today-btn" onclick="planGoToday()">Aujourd'hui</button>
  </div>`;

  // Legend
  h += `<div class="plan-legend">
    <div class="plan-legend-item"><div class="plan-legend-dot" style="background:#DBEAFE;border:1px solid #93C5FD"></div> Congé</div>
    <div class="plan-legend-item"><div class="plan-legend-dot" style="background:#FEE2E2;border:1px solid #FECACA"></div> Maladie</div>
    <div class="plan-legend-item"><div class="plan-legend-dot" style="background:#EDE9FE;border:1px solid #C4B5FD"></div> Formation</div>
    <div class="plan-legend-item"><div class="plan-legend-dot" style="background:#F3F4F6;border:1px solid #D1D5DB"></div> Autre</div>
    <div class="plan-legend-item" style="margin-left:auto"><div class="plan-legend-dot" style="background:var(--primary);opacity:.15;border:1px solid rgba(13,115,119,.3)"></div> Aujourd'hui</div>
  </div>`;

  // Grid
  h += `<div class="plan-grid-wrap"><div class="plan-grid"><table class="plan-table"><thead><tr>`;
  h += `<th class="plan-prac-col">${esc(pracLabel)}</th>`;

  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(currentYear, currentMonth, d).getDay();
    const isWeekend = dow === 0 || dow === 6;
    const isToday = d === todayDay;
    const cls = isToday ? 'plan-today' : (isWeekend ? 'plan-weekend' : '');
    h += `<th class="${cls}">${DAY_NAMES[dow]}<br>${d}</th>`;
  }
  h += `</tr></thead><tbody>`;

  // Practitioner rows
  practitioners.forEach(p => {
    const initials = (p.display_name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const color = p.color || '#1E3A8A';
    const pAbsMap = absenceMap[p.id] || {};

    h += `<tr class="plan-prac-row"><td>
      <div class="plan-prac-cell">
        <div class="plan-prac-av" style="background:${esc(color)}">${initials}</div>
        <div class="plan-prac-details">
          <div class="plan-prac-nm">${esc(p.display_name)}</div>
          <div class="plan-prac-role">${esc(p.title || '')}</div>
        </div>
      </div>
    </td>`;

    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(currentYear, currentMonth, d).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isToday = d === todayDay;
      let cls = 'plan-day-cell' + (isWeekend ? ' plan-weekend' : '') + (isToday ? ' plan-today' : '');

      let inner = '';
      if (pAbsMap[d]) {
        const absInfo = pAbsMap[d];
        const label = TYPE_LABELS[absInfo.type] || 'Absent';
        inner = `<div class="plan-abs-block ${absInfo.type}" title="${esc(absInfo.note || label)}" onclick="event.stopPropagation();planEditAbsence('${absInfo.id}')">${label}</div>`;
      } else if (isWeekend && dow === 0) {
        inner = `<span class="plan-avail-marker" style="opacity:.3">—</span>`;
      }

      const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      h += `<td class="${cls}" onclick="planOpenAbsModal('${p.id}','${dateStr}')">${inner}</td>`;
    }
    h += `</tr>`;
  });

  // Summary row
  h += `<tr class="plan-summary-row">`;
  h += `<td style="text-align:left;padding-left:16px;font-size:.72rem">Effectif présent</td>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(currentYear, currentMonth, d).getDay();
    if (dow === 0) {
      h += `<td>—</td>`;
    } else {
      let present = 0;
      practitioners.forEach(p => {
        const pAbsMap = absenceMap[p.id] || {};
        if (!pAbsMap[d]) present++;
      });
      const total = practitioners.length;
      const cls = present >= Math.ceil(total * 0.7) ? 'count-good' : (present >= Math.ceil(total * 0.4) ? 'count-warn' : 'count-bad');
      h += `<td class="${cls}">${present}</td>`;
    }
  }
  h += `</tr>`;

  h += `</tbody></table></div></div>`;

  // Empty state
  if (practitioners.length === 0) {
    h = `<div class="empty" style="text-align:center;padding:60px 20px">
      <div style="font-size:2.5rem;margin-bottom:12px">📅</div>
      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:8px">Aucun membre d'équipe</h3>
      <p style="color:var(--text-4);font-size:.85rem;margin-bottom:20px">Ajoutez des praticiens dans la section Équipe pour utiliser le planning.</p>
      <button class="btn-primary" onclick="document.querySelector('[data-section=team]').click()">Aller à l'équipe</button>
    </div>`;
  }

  return h;
}

// ── Month navigation ──
function planPrevMonth() {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderPlanning();
}

function planNextMonth() {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderPlanning();
}

function planGoToday() {
  const now = new Date();
  currentYear = now.getFullYear();
  currentMonth = now.getMonth();
  renderPlanning();
}

// ── Absence modal ──
function planOpenAbsModal(pracId, dateStr) {
  // Remove existing modal
  const old = document.getElementById('planAbsModal');
  if (old) old.remove();

  const today = new Date().toISOString().slice(0, 10);
  const fromDate = dateStr || today;
  const toDate = dateStr || today;

  // Build practitioner options
  let pracOptions = practitioners.map(p =>
    `<option value="${p.id}" ${p.id === pracId ? 'selected' : ''}>${esc(p.display_name)}</option>`
  ).join('');

  const modal = document.createElement('div');
  modal.id = 'planAbsModal';
  modal.className = 'modal-overlay';
  modal.style.display = 'flex';
  modal.innerHTML = `
    <div class="modal" style="max-width:400px">
      <div class="modal-h">
        <h3 id="planAbsModalTitle">Nouvelle absence</h3>
        <button class="close" onclick="planCloseAbsModal()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="modal-body" style="padding:18px 22px">
        <div class="field">
          <label>${esc(sectorLabels.practitioner || 'Praticien')}</label>
          <select id="planAbsPrac">${pracOptions}</select>
        </div>
        <div class="field">
          <label>Type</label>
          <div class="plan-type-pills" id="planTypePills">
            <div class="plan-type-pill active-conge" data-type="conge" onclick="planPickType(this)">${TYPE_EMOJIS.conge} Congé</div>
            <div class="plan-type-pill" data-type="maladie" onclick="planPickType(this)">${TYPE_EMOJIS.maladie} Maladie</div>
            <div class="plan-type-pill" data-type="formation" onclick="planPickType(this)">${TYPE_EMOJIS.formation} Formation</div>
            <div class="plan-type-pill" data-type="autre" onclick="planPickType(this)">${TYPE_EMOJIS.autre} Autre</div>
          </div>
        </div>
        <div style="display:flex;gap:10px">
          <div class="field" style="flex:1"><label>Du</label><input type="date" id="planAbsFrom" value="${fromDate}" onchange="planCheckImpact()"></div>
          <div class="field" style="flex:1"><label>Au</label><input type="date" id="planAbsTo" value="${toDate}" onchange="planCheckImpact()"></div>
        </div>
        <div class="field">
          <label>Note <span style="font-weight:400;color:var(--text-4)">(optionnel)</span></label>
          <input id="planAbsNote" placeholder="Vacances, formation coloration...">
        </div>
        <div id="planImpactZone"></div>
      </div>
      <div class="modal-foot" style="padding:14px 22px;border-top:1px solid var(--border-light);display:flex;justify-content:space-between;gap:8px">
        <div id="planAbsDeleteWrap"></div>
        <div style="display:flex;gap:8px">
          <button class="btn" onclick="planCloseAbsModal()">Annuler</button>
          <button class="btn-primary" id="planAbsSaveBtn" onclick="planSaveAbsence()">Confirmer</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // Auto-check impact if practitioner preset
  if (pracId) planCheckImpact();
}

function planCloseAbsModal() {
  const m = document.getElementById('planAbsModal');
  if (m) m.remove();
}

function planPickType(pill) {
  document.querySelectorAll('#planTypePills .plan-type-pill').forEach(p => {
    p.className = 'plan-type-pill';
  });
  pill.className = 'plan-type-pill active-' + pill.dataset.type;
}

function planGetSelectedType() {
  const active = document.querySelector('#planTypePills .plan-type-pill[class*="active-"]');
  if (!active) return 'conge';
  return active.dataset.type;
}

// ── Impact preview ──
async function planCheckImpact() {
  const zone = document.getElementById('planImpactZone');
  if (!zone) return;
  const pracId = document.getElementById('planAbsPrac')?.value;
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value;
  if (!pracId || !from || !to) return;

  try {
    const r = await fetch(`/api/planning/impact?practitioner_id=${pracId}&date_from=${from}&date_to=${to}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    const data = await r.json();
    const count = data.count || 0;

    if (count > 0) {
      zone.innerHTML = `<div class="plan-impact warn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <div><strong>${count} RDV impacté${count > 1 ? 's' : ''}</strong> sur cette période</div>
      </div>`;
    } else {
      zone.innerHTML = `<div class="plan-impact ok">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        <div>Aucun RDV impacté</div>
      </div>`;
    }
  } catch (e) {
    zone.innerHTML = '';
  }
}

// ── Save absence ──
let _editingAbsenceId = null;

async function planSaveAbsence() {
  const btn = document.getElementById('planAbsSaveBtn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Enregistrement...';

  const pracId = document.getElementById('planAbsPrac')?.value;
  const from = document.getElementById('planAbsFrom')?.value;
  const to = document.getElementById('planAbsTo')?.value;
  const note = document.getElementById('planAbsNote')?.value;
  const type = planGetSelectedType();

  if (!pracId || !from || !to) {
    btn.disabled = false;
    btn.textContent = 'Confirmer';
    return;
  }

  try {
    const url = _editingAbsenceId ? `/api/planning/absences/${_editingAbsenceId}` : '/api/planning/absences';
    const method = _editingAbsenceId ? 'PATCH' : 'POST';
    const body = _editingAbsenceId
      ? { date_from: from, date_to: to, type, note }
      : { practitioner_id: pracId, date_from: from, date_to: to, type, note };

    const r = await fetch(url, {
      method,
      headers: {
        'Authorization': 'Bearer ' + api.getToken(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const data = await r.json();

    if (!r.ok) {
      alert(data.error || 'Erreur');
      btn.disabled = false;
      btn.textContent = 'Confirmer';
      return;
    }

    _editingAbsenceId = null;
    planCloseAbsModal();
    await renderPlanning();
  } catch (e) {
    alert('Erreur: ' + e.message);
    btn.disabled = false;
    btn.textContent = 'Confirmer';
  }
}

// ── Edit absence (click on block) ──
async function planEditAbsence(absId) {
  const abs = absences.find(a => a.id === absId);
  if (!abs) return;

  // Open modal pre-filled
  planOpenAbsModal(abs.practitioner_id, null);

  // Wait for DOM
  await new Promise(r => setTimeout(r, 50));

  _editingAbsenceId = absId;

  // Fill values
  const titleEl = document.getElementById('planAbsModalTitle');
  if (titleEl) titleEl.textContent = 'Modifier l\'absence';

  const fromEl = document.getElementById('planAbsFrom');
  const toEl = document.getElementById('planAbsTo');
  const noteEl = document.getElementById('planAbsNote');
  const pracEl = document.getElementById('planAbsPrac');

  if (fromEl) fromEl.value = abs.date_from?.slice(0, 10);
  if (toEl) toEl.value = abs.date_to?.slice(0, 10);
  if (noteEl) noteEl.value = abs.note || '';
  if (pracEl) { pracEl.value = abs.practitioner_id; pracEl.disabled = true; }

  // Set type pill
  document.querySelectorAll('#planTypePills .plan-type-pill').forEach(p => {
    p.className = 'plan-type-pill';
    if (p.dataset.type === abs.type) p.className = 'plan-type-pill active-' + abs.type;
  });

  // Save button text
  const saveBtn = document.getElementById('planAbsSaveBtn');
  if (saveBtn) saveBtn.textContent = 'Enregistrer';

  // Delete button
  const delWrap = document.getElementById('planAbsDeleteWrap');
  if (delWrap) {
    delWrap.innerHTML = `<button class="btn" style="color:var(--red);border-color:var(--red-bg)" onclick="planDeleteAbsence('${absId}')">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      Supprimer
    </button>`;
  }

  planCheckImpact();
}

// ── Delete absence ──
async function planDeleteAbsence(absId) {
  if (!confirm('Supprimer cette absence ?')) return;

  try {
    const r = await fetch(`/api/planning/absences/${absId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) {
      const data = await r.json();
      alert(data.error || 'Erreur');
      return;
    }
    _editingAbsenceId = null;
    planCloseAbsModal();
    await renderPlanning();
  } catch (e) {
    alert('Erreur: ' + e.message);
  }
}

// ── Bridge ──
bridge({
  planPrevMonth,
  planNextMonth,
  planGoToday,
  planOpenAbsModal,
  planCloseAbsModal,
  planPickType,
  planSaveAbsence,
  planEditAbsence,
  planDeleteAbsence,
  planCheckImpact
});

export { loadPlanning };
