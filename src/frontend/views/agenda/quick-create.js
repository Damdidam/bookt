/**
 * Quick Create - new booking creation modal with service stacking, freestyle mode,
 * and client autocomplete.
 */
import { api, calState, userRole, user, viewState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { fcIsMobile } from '../../utils/touch.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal } from './booking-detail.js';
import { cswHTML } from './color-swatches.js';
import { MODE_ICO } from '../../utils/format.js';

function fcOpenQuickCreate(startStr, endStr) {
  let d;
  if (startStr) { d = new Date(startStr); }
  else {
    d = new Date(fcIsMobile() ? calState.fcMobileDate : new Date());
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      d.setHours(now.getHours() + 1, 0, 0, 0);
    } else { d.setHours(9, 0, 0, 0); }
  }
  document.getElementById('qcDate').value = d.toISOString().split('T')[0];
  document.getElementById('qcTime').value = d.toTimeString().slice(0, 5);
  document.getElementById('qcClient').value = '';
  document.getElementById('qcClientId').value = '';
  document.getElementById('qcComment').value = '';
  document.getElementById('qcAcResults').style.display = 'none';
  // Reset freestyle mode
  document.getElementById('qcFreestyle').checked = false;
  document.getElementById('qcNormalMode').style.display = '';
  document.getElementById('qcFreestyleMode').style.display = 'none';
  document.getElementById('qcFreeLabel').value = '';
  document.getElementById('qcFreeBufBefore').value = '0';
  document.getElementById('qcFreeBufAfter').value = '0';
  document.getElementById('qcFreeColorWrap').innerHTML = cswHTML('qcFreeColor', '#0D7377', false);

  // Populate practitioners dropdown
  const prSel = document.getElementById('qcPrac');
  prSel.innerHTML = calState.fcPractitioners.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
  // Practitioners can only create for themselves
  if (userRole === 'practitioner' && user?.practitioner_id) {
    prSel.value = user.practitioner_id;
    prSel.disabled = true;
  } else {
    prSel.disabled = false;
  }

  // Init service list with one entry
  viewState.qcServiceCount = 0;
  document.getElementById('qcServiceList').innerHTML = '';
  qcAddService();

  document.getElementById('calCreateModal').classList.add('open');
}

function qcToggleFreestyle() {
  const on = document.getElementById('qcFreestyle').checked;
  document.getElementById('qcNormalMode').style.display = on ? 'none' : '';
  document.getElementById('qcFreestyleMode').style.display = on ? '' : 'none';
  document.getElementById('qcModeRow').style.display = on ? 'none' : '';
  if (on) {
    // Auto-set end time = start + 1h
    const t = document.getElementById('qcTime').value;
    if (t) {
      const [h, m] = t.split(':').map(Number);
      const endH = Math.min(h + 1, 23);
      document.getElementById('qcFreeEnd').value = String(endH).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    qcUpdateFreeDuration();
  }
}

function qcUpdateFreeDuration() {
  const t = document.getElementById('qcTime').value;
  const e = document.getElementById('qcFreeEnd').value;
  if (!t || !e) return;
  const [sh, sm] = t.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  let dur = (eh * 60 + em) - (sh * 60 + sm);
  if (dur <= 0) dur += 24 * 60;
  const bb = parseInt(document.getElementById('qcFreeBufBefore').value) || 0;
  const ba = parseInt(document.getElementById('qcFreeBufAfter').value) || 0;
  const total = dur + bb + ba;
  const el = document.getElementById('qcFreeDuration');
  const h = Math.floor(dur / 60), m = dur % 60;
  el.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Dur\u00e9e : <strong>${h ? h + 'h' : ''}${m ? m + 'min' : ''}</strong>${(bb || ba) ? ' + buffers ' + (bb ? bb + 'min avant ' : ' ') + (ba ? ba + 'min apr\u00e8s' : '') : ''}`;
}

function qcAddService() {
  const idx = viewState.qcServiceCount++;
  const opts = calState.fcServices.filter(s => s.is_active !== false).map(s => `<option value="${s.id}" data-dur="${s.duration_min}" data-buf="${(s.buffer_before_min || 0) + (s.buffer_after_min || 0)}" data-color="${s.color || '#0D7377'}">${s.name} (${s.duration_min} min)</option>`).join('');
  const html = `<div class="qc-svc-item" id="qcSvc${idx}">
    <span class="qc-svc-handle"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg></span>
    <span class="qc-svc-color" id="qcSvcCol${idx}"></span>
    <select onchange="qcUpdateTotal()" id="qcSvcSel${idx}">${opts}</select>
    <span class="qc-svc-dur" id="qcSvcDur${idx}"></span>
    <button class="qc-svc-rm" onclick="qcRemoveService(${idx})" title="Retirer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`;
  document.getElementById('qcServiceList').insertAdjacentHTML('beforeend', html);
  qcUpdateTotal();
}

function qcRemoveService(idx) {
  const el = document.getElementById('qcSvc' + idx);
  if (el) el.remove();
  // Must keep at least one
  if (document.querySelectorAll('.qc-svc-item').length === 0) qcAddService();
  else qcUpdateTotal();
}

function qcUpdateTotal() {
  let total = 0;
  const svcItems = document.querySelectorAll('.qc-svc-item');
  // Collect mode_options intersection
  let availModes = null;
  svcItems.forEach(item => {
    const sel = item.querySelector('select');
    if (!sel) return;
    const opt = sel.options[sel.selectedIndex];
    const dur = parseInt(opt?.dataset.dur || 30);
    const buf = parseInt(opt?.dataset.buf || 0);
    const color = opt?.dataset.color || '#0D7377';
    total += dur + buf;
    const durEl = item.querySelector('.qc-svc-dur');
    if (durEl) durEl.textContent = dur + 'min';
    const colEl = item.querySelector('.qc-svc-color');
    if (colEl) colEl.style.background = color;
    // Get this service's mode_options
    const svcId = sel.value;
    const svc = calState.fcServices.find(s => s.id === svcId);
    const modes = svc?.mode_options || ['cabinet'];
    if (!availModes) availModes = new Set(modes);
    else availModes = new Set([...availModes].filter(m => modes.includes(m)));
  });
  // Update total display
  const el = document.getElementById('qcTotalDuration');
  if (svcItems.length > 1) {
    const h = Math.floor(total / 60), m = total % 60;
    el.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Dur\u00e9e totale : <strong>${h ? h + 'h' : ''}${m ? m + 'min' : ''}</strong> \u00b7 ${svcItems.length} prestations (groupe li\u00e9)`;
  } else {
    el.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${total} min`;
  }
  // Update mode selector
  const modeRow = document.getElementById('qcModeRow');
  const modeSel = document.getElementById('qcMode');
  const modes = availModes ? [...availModes] : ['cabinet'];
  if (modes.length <= 1 && modes[0] === 'cabinet') {
    modeRow.style.display = 'none';
    modeSel.value = 'cabinet';
  } else {
    modeRow.style.display = '';
    const curVal = modeSel.value;
    modeSel.innerHTML = modes.map(m => `<option value="${m}">${{ cabinet: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg> Cabinet', visio: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Visio', phone: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg> T\u00e9l\u00e9phone' }[m] || m}</option>`).join('');
    if (modes.includes(curVal)) modeSel.value = curVal;
  }
}

// Client autocomplete
function calSearchClients(q) {
  clearTimeout(calState.fcClientSearchTimer);
  const res = document.getElementById('qcAcResults');
  if (q.length < 2) { res.style.display = 'none'; return; }
  calState.fcClientSearchTimer = setTimeout(async () => {
    try {
      const r = await fetch(`/api/clients?search=${encodeURIComponent(q)}&limit=6`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
      const d = await r.json();
      const clients = d.clients || [];
      let h = clients.map(c => `<div class="ac-item" onclick="calPickClient('${c.id}','${esc(c.full_name)}')">`
        + `<div class="ac-name">${esc(c.full_name)}</div><div class="ac-meta">${c.phone || ''} ${c.email || ''}</div></div>`).join('');
      h += `<div class="ac-item ac-new" onclick="calNewClient()">+ Nouveau client : "${esc(q)}"</div>`;
      res.innerHTML = h; res.style.display = 'block';
    } catch (e) { res.style.display = 'none'; }
  }, 300);
}

function calPickClient(id, name) {
  document.getElementById('qcClient').value = name;
  document.getElementById('qcClientId').value = id;
  document.getElementById('qcAcResults').style.display = 'none';
}

function calNewClient() {
  document.getElementById('qcClientId').value = 'NEW';
  document.getElementById('qcAcResults').style.display = 'none';
}

async function calCreateBooking() {
  const clientName = document.getElementById('qcClient').value.trim();
  const clientId = document.getElementById('qcClientId').value;
  const pracId = document.getElementById('qcPrac').value;
  const date = document.getElementById('qcDate').value;
  const time = document.getElementById('qcTime').value;
  const mode = document.getElementById('qcMode').value;
  const comment = document.getElementById('qcComment').value.trim();
  const isFreestyle = document.getElementById('qcFreestyle').checked;

  if (!clientName) { gToast('Nom du client requis', 'error'); return; }
  if (!date || !time) { gToast('Date et heure requises', 'error'); return; }

  const start_at = new Date(date + 'T' + time).toISOString();

  try {
    let actualClientId = clientId;
    if (!clientId || clientId === 'NEW') {
      const cr = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ full_name: clientName })
      });
      if (!cr.ok) { const d = await cr.json(); throw new Error(d.error || 'Erreur cr\u00e9ation client'); }
      const cd = await cr.json();
      actualClientId = cd.client?.id;
    }

    let body;
    if (isFreestyle) {
      const endTime = document.getElementById('qcFreeEnd').value;
      if (!endTime) { gToast('Heure de fin requise', 'error'); return; }
      const end_at = new Date(date + 'T' + endTime).toISOString();
      body = {
        freestyle: true,
        practitioner_id: pracId,
        client_id: actualClientId,
        start_at,
        end_at,
        buffer_before_min: parseInt(document.getElementById('qcFreeBufBefore').value) || 0,
        buffer_after_min: parseInt(document.getElementById('qcFreeBufAfter').value) || 0,
        custom_label: document.getElementById('qcFreeLabel').value.trim() || null,
        color: document.getElementById('qcFreeColor').value,
        appointment_mode: 'cabinet',
        comment: comment || null
      };
    } else {
      // Collect all services
      const serviceItems = document.querySelectorAll('.qc-svc-item select');
      const services = [...serviceItems].map(sel => ({ service_id: sel.value }));
      if (services.length === 0) { gToast('Choisissez au moins une prestation', 'error'); return; }

      body = {
        practitioner_id: pracId,
        client_id: actualClientId,
        start_at,
        appointment_mode: mode,
        comment: comment || null
      };
      if (services.length === 1) {
        body.service_id = services[0].service_id;
      } else {
        body.services = services;
      }
    }

    const r = await fetch('/api/bookings/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    const result = await r.json();
    const count = result.bookings?.length || 1;
    gToast(isFreestyle ? `${clientName} \u2014 RDV libre cr\u00e9\u00e9 !` : count > 1 ? `${clientName} \u2014 ${count} prestations cr\u00e9\u00e9es !` : `${clientName} \u2014 RDV cr\u00e9\u00e9 !`, 'success');
    closeCalModal('calCreateModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

/**
 * Setup global event listeners for freestyle duration auto-update.
 * Called once from index.js.
 */
function setupQuickCreateListeners() {
  document.addEventListener('change', e => {
    if (['qcFreeEnd', 'qcFreeBufBefore', 'qcFreeBufAfter'].includes(e.target?.id)) qcUpdateFreeDuration();
  });
  document.addEventListener('input', e => {
    if (e.target?.id === 'qcTime' && document.getElementById('qcFreestyle')?.checked) qcUpdateFreeDuration();
  });
}

// Expose to global scope for onclick handlers
bridge({
  fcOpenQuickCreate, qcToggleFreestyle, qcUpdateFreeDuration,
  qcAddService, qcRemoveService, qcUpdateTotal,
  calSearchClients, calPickClient, calNewClient, calCreateBooking
});

export { fcOpenQuickCreate, calCreateBooking, setupQuickCreateListeners };
