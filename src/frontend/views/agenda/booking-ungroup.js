/**
 * Booking Ungroup — inline panel to detach a sibling from its group,
 * optionally reassigning practitioner and/or replacing service.
 */
import { api, calState, userRole } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal } from './booking-detail.js';

/** Get services filtered by a specific practitioner ID */
function ugGetPracServices(pracId) {
  return calState.fcServices.filter(s => {
    if (s.is_active === false) return false;
    if (pracId && s.practitioner_ids && s.practitioner_ids.length > 0) {
      return s.practitioner_ids.some(pid => String(pid) === String(pracId));
    }
    return true;
  });
}

/** Build service <option> HTML for a given practitioner */
function ugServiceOptions(pracId, currentSvcId) {
  const svcs = ugGetPracServices(pracId);
  return svcs.map(s => {
    const sel = String(s.id) === String(currentSvcId) ? ' selected' : '';
    return `<option value="${s.id}"${sel}>${esc(s.name)} (${s.duration_min} min)</option>`;
  }).join('');
}

/**
 * Show the inline ungroup panel below the clicked sibling row.
 * @param {string} siblingId — the booking ID of the sibling to detach
 */
function fcShowUngroupPanel(siblingId) {
  // Remove any existing panel first
  fcHideUngroupPanel();

  const siblings = calState.fcGroupSiblings || [];
  const sib = siblings.find(s => String(s.id) === String(siblingId));
  if (!sib) return;

  // Find the sibling row in the DOM
  const rows = document.querySelectorAll('.m-group-item');
  let targetRow = null;
  rows.forEach(row => {
    if (row.dataset.sibId === String(siblingId)) targetRow = row;
  });
  if (!targetRow) return;

  const currentPracId = sib.practitioner_id;
  const currentSvcId = sib.service_id;

  const panel = document.createElement('div');
  panel.className = 'm-ungroup-panel';
  panel.innerHTML = `
    <div class="ug-header">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M7.5 4.21l-.71-.71A3 3 0 0 0 4.67 2.5a3 3 0 0 0 0 6h3.66M16.5 4.21l.71-.71a3 3 0 0 1 2.12-.88 3 3 0 0 1 0 6h-3.66M8 21h8M12 17v4M12 3v14"/></svg>
      <span>Détacher du groupe</span>
    </div>
    <div class="ug-row">
      <label class="ug-label">Praticien</label>
      <select id="ugPracSelect" class="m-input ug-select" onchange="fcUngroupPracChange()">
        ${calState.fcPractitioners.map(p => `<option value="${p.id}"${String(p.id) === String(currentPracId) ? ' selected' : ''}>${esc(p.display_name)}</option>`).join('')}
      </select>
    </div>
    <div class="ug-row">
      <label class="ug-label">Prestation</label>
      <select id="ugSvcSelect" class="m-input ug-select">
        ${ugServiceOptions(currentPracId, currentSvcId)}
      </select>
    </div>
    <div class="ug-actions">
      <button class="ug-btn ug-btn-cancel" onclick="fcHideUngroupPanel()">Annuler</button>
      <button class="ug-btn ug-btn-confirm" onclick="fcConfirmUngroup('${siblingId}')">
        <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><path d="m7 11 2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>
        Détacher
      </button>
    </div>`;

  targetRow.insertAdjacentElement('afterend', panel);
}

/** When practitioner changes in ungroup panel, re-filter services */
function fcUngroupPracChange() {
  const pracId = document.getElementById('ugPracSelect')?.value;
  const svcSel = document.getElementById('ugSvcSelect');
  if (!pracId || !svcSel) return;

  const curVal = svcSel.value;
  svcSel.innerHTML = ugServiceOptions(pracId, curVal);

  // If current service isn't in the filtered list, select first option
  const svcs = ugGetPracServices(pracId);
  const stillValid = svcs.some(s => String(s.id) === String(curVal));
  if (!stillValid && svcs.length > 0) svcSel.value = svcs[0].id;
}

/** Confirm the ungroup: call API + close modal + refresh calendar */
async function fcConfirmUngroup(siblingId) {
  const pracId = document.getElementById('ugPracSelect')?.value;
  const svcId = document.getElementById('ugSvcSelect')?.value;

  // Find the original sibling data
  const siblings = calState.fcGroupSiblings || [];
  const sib = siblings.find(s => String(s.id) === String(siblingId));
  if (!sib) return;

  // Build body — only send changed fields
  const body = {};
  if (pracId && String(pracId) !== String(sib.practitioner_id)) body.practitioner_id = pracId;
  if (svcId && String(svcId) !== String(sib.service_id)) body.service_id = svcId;

  // Disable button to prevent double-click
  const btn = document.querySelector('.ug-btn-confirm');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

  try {
    const r = await fetch(`/api/bookings/${siblingId}/ungroup`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error || 'Erreur');
    }
    const data = await r.json();
    gToast('Prestation détachée du groupe', 'success');
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) {
    gToast('Erreur : ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

/**
 * Remove a member from the group entirely (permanent delete).
 * Shows a confirmation dialog before proceeding.
 * @param {string} siblingId — the booking ID to remove
 * @param {string} serviceName — display name for confirmation message
 */
async function fcRemoveFromGroup(siblingId, serviceName) {
  if (!confirm(`Supprimer « ${serviceName} » du groupe ?\n\nCette action est irréversible.`)) return;

  try {
    const r = await fetch(`/api/bookings/${siblingId}/group-remove`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error || 'Erreur');
    }
    gToast('Prestation supprimée du groupe', 'success');
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) {
    gToast('Erreur : ' + e.message, 'error');
  }
}

/** Remove the ungroup panel from the DOM */
function fcHideUngroupPanel() {
  document.querySelectorAll('.m-ungroup-panel').forEach(el => el.remove());
}

// ── Group Add: inline panel to add a service to the group ──

/** Show the inline add-service panel at the bottom of the group list */
function fcShowGroupAddPanel() {
  // Remove any existing panels first
  fcHideUngroupPanel();
  fcHideGroupAddPanel();

  const currentPracId = calState.fcCurrentBooking?.practitioner_id;
  const svcs = ugGetPracServices(currentPracId);
  if (svcs.length === 0) { gToast('Aucune prestation disponible pour ce praticien', 'error'); return; }

  // Get already-selected service IDs from current group
  const siblings = calState.fcGroupSiblings || [];
  const selectedIds = new Set(siblings.map(s => s.service_id));

  const svcOpts = svcs.map(s => {
    const dis = selectedIds.has(s.id) ? ' disabled' : '';
    return `<option value="${s.id}"${dis}>${esc(s.name)} (${s.duration_min} min)</option>`;
  }).join('');

  // Select first non-disabled option
  const firstAvail = svcs.find(s => !selectedIds.has(s.id));

  const panel = document.createElement('div');
  panel.className = 'm-ungroup-panel';
  panel.id = 'groupAddPanel';
  panel.innerHTML = `
    <div class="ug-header" style="color:var(--primary)">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
      <span>Ajouter une prestation</span>
    </div>
    <div class="ug-row">
      <label class="ug-label">Prestation</label>
      <select id="gaServiceSelect" class="m-input ug-select">
        ${svcOpts}
      </select>
    </div>
    <div class="ug-actions">
      <button class="ug-btn ug-btn-cancel" onclick="fcHideGroupAddPanel()">Annuler</button>
      <button class="ug-btn ug-btn-confirm" id="gaConfirmBtn" onclick="fcConfirmGroupAdd()">
        <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Ajouter
      </button>
    </div>`;

  // Insert at the end of the group list, or after the service card for single bookings
  const groupEl = document.getElementById('mGroupSiblings');
  const listContainer = groupEl?.querySelector('div[style*="flex-direction:column"]');
  if (listContainer) {
    listContainer.appendChild(panel);
  } else if (groupEl && groupEl.style.display !== 'none') {
    groupEl.appendChild(panel);
  } else {
    // Single booking — show panel after the service card
    const svcCard = document.getElementById('mSvcCard');
    if (svcCard) {
      svcCard.insertAdjacentElement('afterend', panel);
    } else {
      groupEl?.appendChild(panel);
    }
  }

  // Select first available service
  if (firstAvail) document.getElementById('gaServiceSelect').value = firstAvail.id;
}

/** Confirm adding a service to the group */
async function fcConfirmGroupAdd() {
  const svcId = document.getElementById('gaServiceSelect')?.value;
  if (!svcId) { gToast('Choisissez une prestation', 'error'); return; }

  const bookingId = calState.fcCurrentEventId;
  const btn = document.getElementById('gaConfirmBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

  try {
    const r = await fetch(`/api/bookings/${bookingId}/group-add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ service_id: svcId })
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error || 'Erreur');
    }
    gToast('Prestation ajoutée au groupe', 'success');
    document.getElementById('calDetailModal')._dirtyGuard?.markClean();
    closeCalModal('calDetailModal');
    fcRefresh();
  } catch (e) {
    gToast('Erreur : ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

/** Remove the group-add panel from the DOM */
function fcHideGroupAddPanel() {
  document.getElementById('groupAddPanel')?.remove();
}

bridge({ fcShowUngroupPanel, fcUngroupPracChange, fcConfirmUngroup, fcHideUngroupPanel, fcRemoveFromGroup, fcShowGroupAddPanel, fcConfirmGroupAdd, fcHideGroupAddPanel });
