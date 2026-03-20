/**
 * Task Detail — open, create, edit, delete internal tasks.
 * Creation mode is triggered by the Tâche toggle in Quick Create.
 */
import { api, calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { showConfirmDialog } from '../../utils/dirty-guard.js';
import { closeCalModal } from './booking-detail.js';
import { trapFocus } from '../../utils/focus-trap.js';
import { fcRefresh } from './calendar-init.js';
import { cswHTML } from './color-swatches.js';
import { toBrusselsISO } from '../../utils/format.js';

let _currentTaskId = null;

// ── Gradient header ──
function tdUpdateGradient(color) {
  const safe = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#6B7280';
  const hdr = document.getElementById('tdHeaderBg');
  const avatar = document.getElementById('tdAvatar');
  if (hdr) hdr.style.background = `linear-gradient(135deg,${safe} 0%,${safe}AA 60%,${safe}55 100%)`;
  if (avatar) avatar.style.background = `linear-gradient(135deg,${safe},${safe}CC)`;
}

// Listen for color swatch changes to update gradient live
document.addEventListener('change', e => {
  if (e.target?.id === 'tdColor') {
    tdUpdateGradient(e.target.value);
  }
});

// ── Open task detail in CREATION mode ──
function fcNewTask(date, startTime, endTime, pracId) {
  _currentTaskId = null; // null = creation mode
  const modal = document.getElementById('calTaskModal');
  if (!modal) return;

  document.getElementById('tdModalTitle').textContent = 'Nouvelle tâche';
  document.getElementById('tdTitle').value = '';
  document.getElementById('tdNote').value = '';
  document.getElementById('tdDate').value = date || '';
  document.getElementById('tdStart').value = startTime || '';
  document.getElementById('tdEnd').value = endTime || '';

  _populatePracSelect(pracId || '');
  document.getElementById('tdColorWrap').innerHTML = cswHTML('tdColor', '#6B7280', false);
  tdUpdateGradient('#6B7280');

  // Hide status row and delete button (creation only)
  document.getElementById('tdStatusRow').style.display = 'none';
  document.getElementById('tdDeleteBtn').style.display = 'none';
  document.getElementById('tdSaveBtn').textContent = 'Créer';

  modal.classList.add('open');
  trapFocus(modal, () => closeCalModal('calTaskModal'));
}

// ── Open task detail/edit modal ──
async function fcOpenTaskDetail(taskId) {
  _currentTaskId = taskId;
  const modal = document.getElementById('calTaskModal');
  if (!modal) return;

  document.getElementById('tdModalTitle').textContent = 'Tâche interne';

  try {
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
    tdUpdateGradient(task.color || '#6B7280');

    // Status row
    document.getElementById('tdStatusRow').style.display = '';
    document.getElementById('tdDeleteBtn').style.display = '';
    document.getElementById('tdSaveBtn').textContent = 'Enregistrer';
    _renderStatusBtns(task.status || 'planned');

    modal.classList.add('open');
    trapFocus(modal, () => closeCalModal('calTaskModal'));
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

  const _sBtn = document.getElementById('tdSaveBtn');
  if (_sBtn) { _sBtn.disabled = true; _sBtn.classList.add('is-loading'); }
  try {
    const isCreation = !_currentTaskId;
    const url = isCreation ? '/api/tasks' : `/api/tasks/${_currentTaskId}`;
    const method = isCreation ? 'POST' : 'PATCH';

    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ title, start_at, end_at, practitioner_id: pracId, color: color || null, note: note || null })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    gToast(isCreation ? 'Tâche créée' : 'Tâche mise à jour', 'success');
    closeCalModal('calTaskModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally {
    if (_sBtn) { _sBtn.classList.remove('is-loading'); _sBtn.disabled = false; }
  }
}

async function fcDeleteTask() {
  if (!_currentTaskId) return;
  if (!(await showConfirmDialog('Supprimer la tâche', 'Supprimer cette tâche ?', 'Supprimer', 'danger'))) return;
  const _dBtn = document.getElementById('tdDeleteBtn');
  if (_dBtn) { _dBtn.disabled = true; _dBtn.classList.add('is-loading'); }
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
  finally {
    if (_dBtn) { _dBtn.classList.remove('is-loading'); _dBtn.disabled = false; }
  }
}

bridge({ fcNewTask, fcOpenTaskDetail, fcSaveTask, fcDeleteTask, fcSetTaskStatus, tdUpdateGradient });

export { fcNewTask, fcOpenTaskDetail };
