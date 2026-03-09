/**
 * Task Detail — open, edit, create, delete internal tasks.
 * Combined create + detail in one module (modal reuse).
 */
import { api, calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { closeCalModal } from './booking-detail.js';
import { fcRefresh } from './calendar-init.js';
import { cswHTML, cswPick } from './color-swatches.js';
import { toBrusselsISO } from '../../utils/format.js';

let _currentTaskId = null;

// ── Open task create modal ──
function fcOpenTaskCreate(startStr) {
  _currentTaskId = null;
  const modal = document.getElementById('calTaskModal');
  if (!modal) return;

  document.getElementById('tdModalTitle').textContent = 'Nouvelle tâche';
  document.getElementById('tdTitle').value = '';
  document.getElementById('tdNote').value = '';

  // Default date/time
  let dt, st, et;
  if (startStr) {
    const d = new Date(startStr);
    dt = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    st = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
    const end = new Date(d.getTime() + 60 * 60000);
    et = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
  } else {
    const now = new Date();
    dt = now.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const nextHour = new Date(now); nextHour.setHours(nextHour.getHours() + 1, 0, 0, 0);
    st = nextHour.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
    const endH = new Date(nextHour.getTime() + 60 * 60000);
    et = endH.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
  }
  document.getElementById('tdDate').value = dt;
  document.getElementById('tdStart').value = st;
  document.getElementById('tdEnd').value = et;

  // Practitioner select
  _populatePracSelect();

  // Color swatch
  document.getElementById('tdColorWrap').innerHTML = cswHTML('tdColor', '#6B7280', false);

  // Status row hidden for create
  document.getElementById('tdStatusRow').style.display = 'none';
  document.getElementById('tdDeleteBtn').style.display = 'none';
  document.getElementById('tdSaveBtn').textContent = 'Créer';

  modal.classList.add('open');
}

// ── Open task detail/edit modal ──
async function fcOpenTaskDetail(taskId) {
  _currentTaskId = taskId;
  const modal = document.getElementById('calTaskModal');
  if (!modal) return;

  document.getElementById('tdModalTitle').textContent = 'Tâche interne';

  try {
    // Fetch task data (reuse from FC event cache or fetch fresh)
    const r = await fetch(`/api/tasks/${taskId}`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) { gToast('Erreur chargement tâche', 'error'); return; }
    const task = await r.json();

    document.getElementById('tdTitle').value = task.title || '';
    document.getElementById('tdNote').value = task.note || '';

    const start = new Date(task.start_at);
    const end = new Date(task.end_at);
    document.getElementById('tdDate').value = start.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    document.getElementById('tdStart').value = start.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
    document.getElementById('tdEnd').value = end.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });

    _populatePracSelect(task.practitioner_id);
    document.getElementById('tdColorWrap').innerHTML = cswHTML('tdColor', task.color || '#6B7280', false);

    // Status row
    document.getElementById('tdStatusRow').style.display = '';
    document.getElementById('tdDeleteBtn').style.display = '';
    document.getElementById('tdSaveBtn').textContent = 'Enregistrer';
    _renderStatusBtns(task.status || 'planned');

    modal.classList.add('open');
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

function _populatePracSelect(selectedId) {
  const sel = document.getElementById('tdPrac');
  sel.innerHTML = '';
  (calState.fcPractitioners || []).forEach(p => {
    sel.innerHTML += `<option value="${p.id}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${esc(p.display_name)}</option>`;
  });
}

function _renderStatusBtns(current) {
  const statuses = [
    { key: 'planned', label: 'Planifiée', color: 'var(--primary)' },
    { key: 'completed', label: 'Terminée', color: 'var(--green)' },
    { key: 'cancelled', label: 'Annulée', color: 'var(--red)' }
  ];
  const row = document.getElementById('tdStatusRow');
  row.innerHTML = '<div class="m-field-label">Statut</div><div class="td-status-btns">' +
    statuses.map(s => `<button class="td-st-btn ${s.key === current ? 'active' : ''}" style="--st-color:${s.color}" onclick="fcSetTaskStatus('${s.key}',this)">${s.label}</button>`).join('') +
    '</div>';
}

async function fcSetTaskStatus(status, el) {
  if (!_currentTaskId) return;
  try {
    const r = await fetch(`/api/tasks/${_currentTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ status })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    document.querySelectorAll('.td-st-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    gToast('Statut mis à jour', 'success');
    fcRefresh();
  } catch (e) { gToast(e.message, 'error'); }
}

async function fcSaveTask() {
  const title = document.getElementById('tdTitle').value.trim();
  const date = document.getElementById('tdDate').value;
  const startTime = document.getElementById('tdStart').value;
  const endTime = document.getElementById('tdEnd').value;
  const pracId = document.getElementById('tdPrac').value;
  const color = document.getElementById('tdColor')?.value || '';
  const note = document.getElementById('tdNote').value.trim();

  if (!title) { gToast('Titre requis', 'error'); return; }
  if (!date || !startTime || !endTime) { gToast('Date et heures requises', 'error'); return; }

  const start_at = toBrusselsISO(date, startTime);
  const end_at = toBrusselsISO(date, endTime);

  try {
    if (_currentTaskId) {
      // Edit existing
      const r = await fetch(`/api/tasks/${_currentTaskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ title, start_at, end_at, practitioner_id: pracId, color: color || null, note: note || null })
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      gToast('Tâche mise à jour', 'success');
    } else {
      // Create new
      const r = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ title, start_at, end_at, practitioner_id: pracId, color: color || null, note: note || null })
      });
      if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
      gToast('Tâche créée', 'success');
    }
    closeCalModal('calTaskModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

async function fcDeleteTask() {
  if (!_currentTaskId) return;
  if (!confirm('Supprimer cette tâche ?')) return;
  try {
    const r = await fetch(`/api/tasks/${_currentTaskId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    gToast('Tâche supprimée', 'success');
    closeCalModal('calTaskModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

bridge({ fcOpenTaskCreate, fcOpenTaskDetail, fcSaveTask, fcDeleteTask, fcSetTaskStatus });

export { fcOpenTaskCreate, fcOpenTaskDetail };
