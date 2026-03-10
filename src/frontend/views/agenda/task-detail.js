/**
 * Task Detail — open, edit, delete internal tasks.
 * v47: Multi-practitioner group support.
 * Creation is handled by the quick-create modal (qcSwitchMode).
 */
import { api, calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { closeCalModal } from './booking-detail.js';
import { fcRefresh } from './calendar-init.js';
import { cswHTML } from './color-swatches.js';
import { toBrusselsISO } from '../../utils/format.js';

let _currentTaskId = null;
let _isGroupTask = false;
let _currentGroupId = null;

// ── Open task detail/edit modal ──
async function fcOpenTaskDetail(taskId) {
  _currentTaskId = taskId;
  _isGroupTask = false;
  _currentGroupId = null;
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

    // Practitioner(s) — always show checkboxes so user can add more
    const pracField = document.getElementById('tdPracField');
    _currentGroupId = task.group_id || null;
    const assignedIds = task.group_members
      ? new Set(task.group_members.map(m => m.practitioner_id))
      : new Set([task.practitioner_id]);
    _isGroupTask = assignedIds.size > 1;
    const countLabel = assignedIds.size > 1 ? `Praticiens (${assignedIds.size})` : 'Praticien(s)';
    let pracHtml = `<label class="m-field-label">${countLabel}</label>`;
    pracHtml += '<div class="td-prac-checks" id="tdPracChecks">';
    (calState.fcPractitioners || []).forEach(p => {
      const checked = assignedIds.has(p.id) ? 'checked' : '';
      pracHtml += `<label class="td-prac-check"><input type="checkbox" value="${p.id}" ${checked}><span class="td-prac-dot" style="background:${p.color || 'var(--primary)'}"></span><span>${esc(p.display_name)}</span></label>`;
    });
    pracHtml += '</div>';
    pracField.innerHTML = pracHtml;

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
  if (!sel) return;
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
  const color = document.getElementById('tdColor')?.value || '';
  const note = document.getElementById('tdNote').value.trim();

  if (!title) { gToast('Titre requis', 'error'); return; }
  if (!date || !startTime || !endTime) { gToast('Date et heures requises', 'error'); return; }

  const start_at = toBrusselsISO(date, startTime);
  const end_at = toBrusselsISO(date, endTime);

  const body = { title, start_at, end_at, color: color || null, note: note || null };

  // Collect practitioner(s)
  const checksEl = document.getElementById('tdPracChecks');
  if (checksEl) {
    const checks = checksEl.querySelectorAll('input[type="checkbox"]:checked');
    const pracIds = [...checks].map(cb => cb.value);
    if (pracIds.length === 0) { gToast('Au moins un praticien requis', 'error'); return; }
    body.practitioner_ids = pracIds;
  } else {
    const sel = document.getElementById('tdPrac');
    if (sel) body.practitioner_id = sel.value;
  }

  try {
    const r = await fetch(`/api/tasks/${_currentTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    gToast('Tâche mise à jour', 'success');
    closeCalModal('calTaskModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

async function fcDeleteTask() {
  if (!_currentTaskId) return;
  const msg = _isGroupTask ? 'Supprimer cette tâche pour tous les praticiens ?' : 'Supprimer cette tâche ?';
  if (!confirm(msg)) return;
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

bridge({ fcOpenTaskDetail, fcSaveTask, fcDeleteTask, fcSetTaskStatus });

export { fcOpenTaskDetail };
