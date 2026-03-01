/**
 * Quick Create - new booking creation modal with service stacking, freestyle mode,
 * client autocomplete, and full tabs (Notes, Tâches, Rappels) matching Detail modal.
 */
import { api, calState, userRole, user, viewState, categoryLabels, sectorLabels } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { fcIsMobile } from '../../utils/touch.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal } from './booking-detail.js';
import { cswHTML } from './color-swatches.js';
import { MODE_ICO } from '../../utils/format.js';

// In-memory storage for notes/todos/reminders during creation
let qcNotes = [];
let qcTodos = [];
let qcReminders = [];

// Cache autocomplete results so we can access email/phone without re-fetch
let _qcSearchResults = [];

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
  document.getElementById('qcIntNote').value = '';
  document.getElementById('qcAcResults').style.display = 'none';

  // Reset freestyle mode
  document.getElementById('qcFreestyle').checked = false;
  document.getElementById('qcNormalMode').style.display = '';
  document.getElementById('qcFreestyleMode').style.display = 'none';
  document.getElementById('qcFreeLabel').value = '';
  document.getElementById('qcFreeBufBefore').value = '0';
  document.getElementById('qcFreeBufAfter').value = '0';
  document.getElementById('qcFreeColorWrap').innerHTML = cswHTML('qcFreeColor', '#0D7377', false);
  // Hide freestyle-only fields in Horaire section
  const endWrap = document.getElementById('qcEndTimeWrap');
  if (endWrap) endWrap.style.display = 'none';
  const bufRow = document.getElementById('qcBufferRow');
  if (bufRow) bufRow.style.display = 'none';
  const durEl = document.getElementById('qcFreeDuration');
  if (durEl) durEl.style.display = 'none';

  // Reset header gradient to default
  qcUpdateGradient('#0D7377');

  // Populate practitioners dropdown
  const prSel = document.getElementById('qcPrac');
  prSel.innerHTML = calState.fcPractitioners.map(p => `<option value="${p.id}">${p.display_name}</option>`).join('');
  if (userRole === 'practitioner' && user?.practitioner_id) {
    prSel.value = user.practitioner_id;
    prSel.disabled = true;
  } else {
    prSel.disabled = false;
  }
  // Practitioner color dot
  const curPrac = calState.fcPractitioners[0];
  const qcPracDot = document.getElementById('qcPracDot');
  if (qcPracDot && curPrac) qcPracDot.style.background = curPrac.color || 'var(--primary)';
  prSel.onchange = function () {
    const sel = calState.fcPractitioners.find(p => p.id === this.value);
    if (qcPracDot) qcPracDot.style.background = sel?.color || 'var(--primary)';
  };

  // Init service list with one entry
  viewState.qcServiceCount = 0;
  document.getElementById('qcServiceList').innerHTML = '';
  qcAddService();

  // Reset client email/phone fields
  const qcDetails = document.getElementById('qcClientDetails');
  if (qcDetails) qcDetails.style.display = 'none';
  const qcEmail = document.getElementById('qcClientEmail');
  if (qcEmail) qcEmail.value = '';
  const qcPhone = document.getElementById('qcClientPhone');
  if (qcPhone) qcPhone.value = '';
  _qcSearchResults = [];

  // Reset in-memory notes/todos/reminders
  qcNotes = [];
  qcTodos = [];
  qcReminders = [];
  qcRenderNotes();
  qcRenderTodos();
  qcRenderReminders();
  qcUpdateTabCounts();

  // Switch to RDV tab
  qcSwitchTab(document.querySelector('#calCreateModal .m-tab[data-tab="qc-rdv"]'), 'qc-rdv');

  document.getElementById('calCreateModal').classList.add('open');
}

// ── Gradient header ──
function qcUpdateGradient(color) {
  const hdr = document.getElementById('qcHeaderBg');
  const avatar = document.getElementById('qcAvatar');
  const btn = document.getElementById('qcBtnCreate');
  if (hdr) hdr.style.background = `linear-gradient(135deg,${color} 0%,${color}AA 60%,${color}55 100%)`;
  if (avatar) avatar.style.background = `linear-gradient(135deg,${color},${color}CC)`;
  if (btn) { btn.style.background = color; btn.style.boxShadow = `0 2px 8px ${color}40`; }
}

// ── Tab switching ──
function qcSwitchTab(el, tab) {
  document.querySelectorAll('#calCreateModal .m-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#calCreateModal .cal-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const panelMap = { 'qc-rdv': 'qcPanelRdv', 'qc-notes': 'qcPanelNotes', 'qc-todos': 'qcPanelTodos', 'qc-reminders': 'qcPanelReminders' };
  document.getElementById(panelMap[tab])?.classList.add('active');
}

function qcUpdateTabCounts() {
  const cn = document.getElementById('qcCountNotes');
  const ct = document.getElementById('qcCountTodos');
  const cr = document.getElementById('qcCountReminders');
  if (cn) { if (qcNotes.length > 0) { cn.textContent = qcNotes.length; cn.style.display = 'flex'; } else { cn.style.display = 'none'; } }
  if (ct) { if (qcTodos.length > 0) { ct.textContent = qcTodos.length; ct.style.display = 'flex'; } else { ct.style.display = 'none'; } }
  if (cr) { if (qcReminders.length > 0) { cr.textContent = qcReminders.length; cr.style.display = 'flex'; } else { cr.style.display = 'none'; } }
}

// ── Freestyle toggle ──
function qcToggleFreestyle() {
  const on = document.getElementById('qcFreestyle').checked;
  document.getElementById('qcNormalMode').style.display = on ? 'none' : '';
  document.getElementById('qcFreestyleMode').style.display = on ? '' : 'none';
  document.getElementById('qcModeRow').style.display = on ? 'none' : '';
  // Show/hide freestyle fields in Horaire section
  const endWrap = document.getElementById('qcEndTimeWrap');
  if (endWrap) endWrap.style.display = on ? '' : 'none';
  const bufRow = document.getElementById('qcBufferRow');
  if (bufRow) bufRow.style.display = on ? '' : 'none';
  const durEl = document.getElementById('qcFreeDuration');
  if (durEl) durEl.style.display = on ? '' : 'none';
  if (on) {
    const t = document.getElementById('qcTime').value;
    if (t) {
      const [h, m] = t.split(':').map(Number);
      const endH = Math.min(h + 1, 23);
      const endVal = String(endH).padStart(2, '0') + ':' + String(m).padStart(2, '0');
      document.getElementById('qcFreeEnd').value = endVal;
    }
    qcUpdateFreeDuration();
    qcUpdateGradient('#0D7377');
  } else {
    qcUpdateTotal();
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
  const el = document.getElementById('qcFreeDuration');
  const h = Math.floor(dur / 60), m = dur % 60;
  el.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Durée : <strong>${h ? h + 'h' : ''}${m ? m + 'min' : ''}</strong>${(bb || ba) ? ' + buffers ' + (bb ? bb + 'min avant ' : '') + (ba ? ba + 'min après' : '') : ''}`;
}

// ── Service management ──
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
  if (document.querySelectorAll('.qc-svc-item').length === 0) qcAddService();
  else qcUpdateTotal();
}

function qcUpdateTotal() {
  let total = 0;
  let firstColor = '#0D7377';
  const svcItems = document.querySelectorAll('.qc-svc-item');
  let availModes = null;
  svcItems.forEach((item, i) => {
    const sel = item.querySelector('select');
    if (!sel) return;
    const opt = sel.options[sel.selectedIndex];
    const dur = parseInt(opt?.dataset.dur || 30);
    const buf = parseInt(opt?.dataset.buf || 0);
    const color = opt?.dataset.color || '#0D7377';
    total += dur + buf;
    if (i === 0) firstColor = color;
    const durEl = item.querySelector('.qc-svc-dur');
    if (durEl) durEl.textContent = dur + 'min';
    const colEl = item.querySelector('.qc-svc-color');
    if (colEl) colEl.style.background = color;
    const svcId = sel.value;
    const svc = calState.fcServices.find(s => s.id === svcId);
    const modes = svc?.mode_options || ['cabinet'];
    if (!availModes) availModes = new Set(modes);
    else availModes = new Set([...availModes].filter(m => modes.includes(m)));
  });

  // Update gradient to first service color
  qcUpdateGradient(firstColor);

  // Update total display
  const el = document.getElementById('qcTotalDuration');
  if (svcItems.length > 1) {
    const h = Math.floor(total / 60), m = total % 60;
    el.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Durée totale : <strong>${h ? h + 'h' : ''}${m ? m + 'min' : ''}</strong> · ${svcItems.length} ${categoryLabels.services.toLowerCase()}`;
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
    modeSel.innerHTML = modes.map(m => `<option value="${m}">${MODE_ICO[m] || ''} ${({ cabinet: 'Cabinet', visio: 'Visio', phone: 'Téléphone' })[m] || m}</option>`).join('');
    if (modes.includes(curVal)) modeSel.value = curVal;
  }
}

// ── Client autocomplete ──
function calSearchClients(q) {
  clearTimeout(calState.fcClientSearchTimer);
  const res = document.getElementById('qcAcResults');
  if (q.length < 2) { res.style.display = 'none'; return; }
  calState.fcClientSearchTimer = setTimeout(async () => {
    try {
      const r = await fetch(`/api/clients?search=${encodeURIComponent(q)}&limit=6`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
      const d = await r.json();
      const clients = d.clients || [];
      _qcSearchResults = clients;
      let h = clients.map(c => {
        const nsTag = c.no_show_count > 0
          ? `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;background:#FDE68A;color:#B45309;margin-left:4px">⚠ ${c.no_show_count} no-show${c.no_show_count > 1 ? 's' : ''}</span>`
          : '';
        const blTag = c.is_blocked
          ? `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;background:#FECACA;color:#dc2626;margin-left:4px">Bloqué</span>`
          : '';
        return `<div class="ac-item" onclick="calPickClient('${c.id}','${esc(c.full_name)}')"><div class="ac-name">${esc(c.full_name)}${nsTag}${blTag}</div><div class="ac-meta">${c.phone || ''} ${c.email || ''}</div></div>`;
      }).join('');
      h += `<div class="ac-item ac-new" onclick="calNewClient()">+ ${categoryLabels.client} : "${esc(q)}"</div>`;
      res.innerHTML = h; res.style.display = 'block';
    } catch (e) { res.style.display = 'none'; }
  }, 300);
}

async function calPickClient(id, name) {
  document.getElementById('qcClient').value = name;
  document.getElementById('qcClientId').value = id;
  document.getElementById('qcAcResults').style.display = 'none';

  // Remove any previous deposit warning
  const prev = document.getElementById('qcDepositWarn');
  if (prev) prev.remove();

  // Populate email/phone from cached search results
  const cached = _qcSearchResults.find(c => c.id === id);
  const emailEl = document.getElementById('qcClientEmail');
  const phoneEl = document.getElementById('qcClientPhone');
  if (emailEl) emailEl.value = cached?.email || '';
  if (phoneEl) phoneEl.value = cached?.phone || '';
  const detailsEl = document.getElementById('qcClientDetails');
  if (detailsEl) detailsEl.style.display = '';

  // Use cached data for no_show warning if available, otherwise fetch
  const cl = cached || null;
  if (!cl) {
    try {
      const r = await fetch(`/api/clients?search=${encodeURIComponent(name)}&limit=1`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
      const d = await r.json();
      const fetched = (d.clients || []).find(c => c.id === id);
      if (fetched) {
        if (emailEl && !emailEl.value) emailEl.value = fetched.email || '';
        if (phoneEl && !phoneEl.value) phoneEl.value = fetched.phone || '';
        if (fetched.no_show_count > 0) _showDepositWarn(fetched.no_show_count);
      }
    } catch (e) { /* silent */ }
  } else if (cl.no_show_count > 0) {
    _showDepositWarn(cl.no_show_count);
  }
}

function _showDepositWarn(count) {
  const wrap = document.getElementById('qcClient').parentElement;
  const warn = document.createElement('div');
  warn.id = 'qcDepositWarn';
  warn.style.cssText = 'margin-top:6px;padding:6px 10px;border-radius:8px;background:#FEF3E2;color:#B45309;font-size:.78rem;font-weight:600;display:flex;align-items:center;gap:6px';
  warn.innerHTML = `<span>\u26a0\ufe0f</span><span>${count} no-show${count > 1 ? 's' : ''} \u2014 un acompte pourra \u00eatre exig\u00e9</span>`;
  wrap.appendChild(warn);
}

function calNewClient() {
  document.getElementById('qcClientId').value = 'NEW';
  document.getElementById('qcAcResults').style.display = 'none';
  // Show email/phone fields for new client
  const detailsEl = document.getElementById('qcClientDetails');
  if (detailsEl) detailsEl.style.display = '';
  const emailEl = document.getElementById('qcClientEmail');
  const phoneEl = document.getElementById('qcClientPhone');
  if (emailEl) { emailEl.value = ''; emailEl.focus(); }
  if (phoneEl) phoneEl.value = '';
}

// ── In-memory Notes ──
function qcAddNote() {
  const ta = document.getElementById('qcNewNote');
  const content = ta.value.trim();
  if (!content) return;
  const pinned = document.getElementById('qcNotePinned')?.checked || false;
  qcNotes.push({ content, is_pinned: pinned, created_at: new Date().toISOString() });
  ta.value = '';
  if (document.getElementById('qcNotePinned')) document.getElementById('qcNotePinned').checked = false;
  qcRenderNotes();
  qcUpdateTabCounts();
}

function qcDeleteNote(idx) {
  qcNotes.splice(idx, 1);
  qcRenderNotes();
  qcUpdateTabCounts();
}

function qcRenderNotes() {
  const el = document.getElementById('qcNoteList');
  if (!el) return;
  if (qcNotes.length === 0) {
    el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon">📝</div>Aucune note pour l\'instant</div>';
    return;
  }
  el.innerHTML = qcNotes.map((n, i) => `<div class="note-card${n.is_pinned ? ' pinned' : ''}">
    <div class="note-content">${esc(n.content)}</div>
    <div class="note-meta">${n.is_pinned ? '📌 Épinglée · ' : ''}À créer avec le RDV</div>
    <button class="note-delete" onclick="qcDeleteNote(${i})" title="Supprimer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`).join('');
}

// ── In-memory Todos ──
function qcAddTodo() {
  const inp = document.getElementById('qcNewTodo');
  const content = inp.value.trim();
  if (!content) return;
  qcTodos.push({ content });
  inp.value = '';
  qcRenderTodos();
  qcUpdateTabCounts();
}

function qcDeleteTodo(idx) {
  qcTodos.splice(idx, 1);
  qcRenderTodos();
  qcUpdateTabCounts();
}

function qcRenderTodos() {
  const el = document.getElementById('qcTodoList');
  if (!el) return;
  if (qcTodos.length === 0) {
    el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon">✅</div>Aucune tâche pour l\'instant</div>';
    return;
  }
  el.innerHTML = qcTodos.map((t, i) => `<div class="todo-item">
    <span class="todo-check" style="border-color:var(--border);opacity:.4"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px;opacity:0"><polyline points="20 6 9 17 4 12"/></svg></span>
    <span class="todo-text">${esc(t.content)}</span>
    <button class="todo-delete" onclick="qcDeleteTodo(${i})" title="Supprimer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`).join('');
}

// ── In-memory Reminders ──
function qcAddReminder() {
  const offset = document.getElementById('qcReminderOffset').value;
  const channel = document.getElementById('qcReminderChannel').value;
  const offsetLabels = { '15': '15 min avant', '30': '30 min avant', '60': '1h avant', '120': '2h avant', '1440': 'La veille' };
  const channelLabels = { browser: '🔔 Notif', email: '📧 Email', both: '🔔+📧' };
  qcReminders.push({ offset_minutes: parseInt(offset), channel, offsetLabel: offsetLabels[offset] || offset + ' min', channelLabel: channelLabels[channel] || channel });
  qcRenderReminders();
  qcUpdateTabCounts();
}

function qcDeleteReminder(idx) {
  qcReminders.splice(idx, 1);
  qcRenderReminders();
  qcUpdateTabCounts();
}

function qcRenderReminders() {
  const el = document.getElementById('qcReminderList');
  if (!el) return;
  if (qcReminders.length === 0) {
    el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon">⏰</div>Aucun rappel pour l\'instant</div>';
    return;
  }
  el.innerHTML = qcReminders.map((r, i) => `<div class="reminder-card">
    <span class="reminder-icon">⏰</span>
    <div><div class="ri-time">${esc(r.offsetLabel)}</div><div class="ri-channel">${esc(r.channelLabel)}</div></div>
    <button class="reminder-delete" onclick="qcDeleteReminder(${i})" title="Supprimer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`).join('');
}

// ── Create booking ──
async function calCreateBooking() {
  const clientName = document.getElementById('qcClient').value.trim();
  const clientId = document.getElementById('qcClientId').value;
  const pracId = document.getElementById('qcPrac').value;
  const date = document.getElementById('qcDate').value;
  const time = document.getElementById('qcTime').value;
  const mode = document.getElementById('qcMode').value;
  const comment = document.getElementById('qcComment').value.trim();
  const intNote = document.getElementById('qcIntNote').value.trim();
  const isFreestyle = document.getElementById('qcFreestyle').checked;

  if (!clientName) { gToast('Nom requis', 'error'); return; }
  if (!date || !time) { gToast('Date et heure requises', 'error'); return; }

  const start_at = new Date(date + 'T' + time).toISOString();

  try {
    const clientEmail = document.getElementById('qcClientEmail')?.value.trim() || '';
    const clientPhone = document.getElementById('qcClientPhone')?.value.trim() || '';

    let actualClientId = clientId;
    if (!clientId || clientId === 'NEW') {
      const clientBody = { full_name: clientName };
      if (clientEmail) clientBody.email = clientEmail;
      if (clientPhone) clientBody.phone = clientPhone;
      const cr = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify(clientBody)
      });
      if (!cr.ok) { const d = await cr.json(); throw new Error(d.error || 'Erreur création client'); }
      const cd = await cr.json();
      actualClientId = cd.client?.id;
    } else {
      // Update existing client if email/phone changed
      const cached = _qcSearchResults.find(c => c.id === clientId);
      const emailChanged = clientEmail && clientEmail !== (cached?.email || '');
      const phoneChanged = clientPhone && clientPhone !== (cached?.phone || '');
      if (emailChanged || phoneChanged) {
        const patchBody = {};
        if (emailChanged) patchBody.email = clientEmail;
        if (phoneChanged) patchBody.phone = clientPhone;
        await fetch(`/api/clients/${clientId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify(patchBody)
        }).catch(() => {});
      }
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
        color: document.getElementById('qcFreeColor')?.value || '#0D7377',
        appointment_mode: 'cabinet',
        comment: comment || null,
        client_email: clientEmail || undefined
      };
    } else {
      const serviceItems = document.querySelectorAll('.qc-svc-item select');
      const services = [...serviceItems].map(sel => ({ service_id: sel.value }));
      if (services.length === 0) { gToast('Choisissez au moins une '+categoryLabels.service.toLowerCase(), 'error'); return; }

      body = {
        practitioner_id: pracId,
        client_id: actualClientId,
        start_at,
        appointment_mode: mode,
        comment: comment || null,
        client_email: clientEmail || undefined
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
    const bookingId = result.booking?.id || result.bookings?.[0]?.id;

    // Save internal note if provided
    if (intNote && bookingId) {
      await fetch(`/api/bookings/${bookingId}/note`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ internal_note: intNote })
      }).catch(() => {});
    }

    // Save notes, todos, reminders in parallel
    if (bookingId) {
      const promises = [];
      for (const note of qcNotes) {
        promises.push(fetch(`/api/bookings/${bookingId}/notes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ content: note.content, is_pinned: note.is_pinned })
        }).catch(() => {}));
      }
      for (const todo of qcTodos) {
        promises.push(fetch(`/api/bookings/${bookingId}/todos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ content: todo.content })
        }).catch(() => {}));
      }
      for (const rem of qcReminders) {
        promises.push(fetch(`/api/bookings/${bookingId}/reminders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
          body: JSON.stringify({ offset_minutes: rem.offset_minutes, channel: rem.channel })
        }).catch(() => {}));
      }
      if (promises.length > 0) await Promise.all(promises);
    }

    const count = result.bookings?.length || 1;
    const extra = [];
    if (qcNotes.length) extra.push(`${qcNotes.length} note${qcNotes.length > 1 ? 's' : ''}`);
    if (qcTodos.length) extra.push(`${qcTodos.length} tâche${qcTodos.length > 1 ? 's' : ''}`);
    if (qcReminders.length) extra.push(`${qcReminders.length} rappel${qcReminders.length > 1 ? 's' : ''}`);
    const extraStr = extra.length ? ' + ' + extra.join(', ') : '';

    gToast(isFreestyle
      ? `${clientName} — RDV libre créé !${extraStr}`
      : count > 1
        ? `${clientName} — ${count} ${categoryLabels.services.toLowerCase()} créées !${extraStr}`
        : `${clientName} — RDV créé !${extraStr}`, 'success');

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
    // Update gradient on freestyle color change
    if (e.target?.id === 'qcFreeColor') {
      qcUpdateGradient(e.target.value);
    }
  });
  document.addEventListener('input', e => {
    if (e.target?.id === 'qcTime' && document.getElementById('qcFreestyle')?.checked) qcUpdateFreeDuration();
  });
}

// Expose to global scope for onclick handlers
bridge({
  fcOpenQuickCreate, qcToggleFreestyle, qcUpdateFreeDuration,
  qcAddService, qcRemoveService, qcUpdateTotal,
  calSearchClients, calPickClient, calNewClient, calCreateBooking,
  qcSwitchTab, qcAddNote, qcDeleteNote, qcAddTodo, qcDeleteTodo,
  qcAddReminder, qcDeleteReminder
});

export { fcOpenQuickCreate, calCreateBooking, setupQuickCreateListeners };
