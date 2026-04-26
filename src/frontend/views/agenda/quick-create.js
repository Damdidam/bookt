/**
 * Quick Create - new booking creation modal with service stacking, freestyle mode,
 * client autocomplete, and full tabs (Notes, Tâches, Rappels) matching Detail modal.
 */
import { api, calState, userRole, user, viewState, categoryLabels, sectorLabels } from '../../state.js';
import { esc, safeId, gToast } from '../../utils/dom.js';
import { fcIsMobile } from '../../utils/touch.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { closeCalModal } from './booking-detail.js';
import { guardModal } from '../../utils/dirty-guard.js';
import { trapFocus } from '../../utils/focus-trap.js';
import { enableSwipeClose } from '../../utils/swipe-close.js';
import { cswHTML } from './color-swatches.js';
import { MODE_ICO, toBrusselsISO } from '../../utils/format.js';
import { IC } from '../../utils/icons.js';

// Escape string for use inside JS single-quoted onclick handlers
function escJs(s) { return (s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029'); }

// In-memory storage for todos/reminders during creation
let qcTodos = [];
let qcReminders = [];

// Cache autocomplete results so we can access email/phone without re-fetch
let _qcSearchResults = [];

function fcOpenQuickCreate(startStr, endStr, resourceId) {
  let d;
  if (startStr) { d = new Date(startStr); }
  else {
    d = new Date(fcIsMobile() ? calState.fcMobileDate : new Date());
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      d.setHours(now.getHours() + 1, 0, 0, 0);
    } else { d.setHours(9, 0, 0, 0); }
  }
  document.getElementById('qcDate').value = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  document.getElementById('qcTime').value = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
  document.getElementById('qcClient').value = '';
  document.getElementById('qcClientId').value = '';
  document.getElementById('qcComment').value = '';
  document.getElementById('qcLocked').checked = false;
  document.getElementById('qcSkipConfirm').checked = false;
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
  prSel.innerHTML = calState.fcPractitioners.map(p => `<option value="${p.id}">${esc(p.display_name)}</option>`).join('');
  if (userRole === 'practitioner' && user?.practitioner_id) {
    prSel.value = user.practitioner_id;
    prSel.disabled = true;
  } else {
    // Default to clicked resource column, or filtered practitioner
    if (resourceId) {
      prSel.value = resourceId;
    } else if (calState.fcCurrentFilter && calState.fcCurrentFilter !== 'all') {
      prSel.value = calState.fcCurrentFilter;
    }
    prSel.disabled = false;
  }
  // Practitioner color dot — use selected value, not first
  const curPrac = calState.fcPractitioners.find(p => String(p.id) === prSel.value) || calState.fcPractitioners[0];
  const qcPracDot = document.getElementById('qcPracDot');
  if (qcPracDot && curPrac) qcPracDot.style.background = curPrac.color || 'var(--primary)';
  prSel.onchange = function () {
    const sel = calState.fcPractitioners.find(p => String(p.id) === this.value);
    if (qcPracDot) qcPracDot.style.background = sel?.color || 'var(--primary)';
    // Refresh service dropdowns for the new practitioner
    qcRefreshServiceDropdowns();
    qcCheckConflict();
  };

  // Init service list — clear cards + open assign panel
  viewState.qcServiceCount = 0;
  document.getElementById('qcServiceList').innerHTML = '';
  document.getElementById('qcAssignSvc').style.display = 'none';
  document.getElementById('qcAddSvcBtn').style.display = '';
  qcShowAssignPanel();

  // Reset client email/phone fields
  const qcDetails = document.getElementById('qcClientDetails');
  if (qcDetails) qcDetails.style.display = 'none';
  const qcEmail = document.getElementById('qcClientEmail');
  if (qcEmail) qcEmail.value = '';
  const qcPhone = document.getElementById('qcClientPhone');
  if (qcPhone) qcPhone.value = '';
  _qcSearchResults = [];

  // Reset in-memory todos/reminders
  qcTodos = [];
  qcReminders = [];
  qcRenderTodos();
  qcRenderReminders();

  // Reset mode toggle to RDV
  _qcSetMode('rdv');

  // Reset task fields
  const ttl = document.getElementById('qcTaskTitle'); if (ttl) ttl.value = '';
  const tn = document.getElementById('qcTaskNote'); if (tn) tn.value = '';

  // Reset deposit toggle + channels
  const depToggle = document.getElementById('qcDepositToggle');
  const depCheck = document.getElementById('qcDepositCheck');
  if (depToggle) depToggle.style.display = 'none';
  if (depCheck) { depCheck.checked = false; delete depCheck.dataset.userOverride; }
  const depAmtRow = document.getElementById('qcDepositAmountRow');
  if (depAmtRow) depAmtRow.style.display = 'none';
  const depAmtInp = document.getElementById('qcDepositAmount');
  if (depAmtInp) depAmtInp.value = '';
  const depChannels = document.getElementById('qcDepositChannels');
  if (depChannels) depChannels.style.display = 'none';
  const depEmailCb = document.getElementById('qcDepEmail');
  const depSmsCb = document.getElementById('qcDepSms');
  if (depEmailCb) depEmailCb.checked = true;
  if (depSmsCb) depSmsCb.checked = false;

  // Dirty guard (warn on close if user started filling)
  const qcModal = document.getElementById('calCreateModal');
  guardModal(qcModal, { noBackdropClose: true });
  qcModal.classList.add('open');
  trapFocus(qcModal, () => closeCalModal('calCreateModal'));
  enableSwipeClose(qcModal.querySelector('.m-dialog'), () => closeCalModal('calCreateModal'));
}

// ── Gradient header ──
function qcUpdateGradient(color) {
  const safe = /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : '#0D7377';
  const hdr = document.getElementById('qcHeaderBg');
  const avatar = document.getElementById('qcAvatar');
  const btn = document.getElementById('qcBtnCreate');
  if (hdr) hdr.style.background = `linear-gradient(135deg,${safe} 0%,${safe}AA 60%,${safe}55 100%)`;
  if (avatar) avatar.style.background = `linear-gradient(135deg,${safe},${safe}CC)`;
  if (btn) { btn.style.background = safe; btn.style.boxShadow = `0 2px 8px ${safe}40`; }
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
    qcCheckDepositSuggestion(); // Show deposit toggle in freestyle mode
  } else {
    qcUpdateTotal(); // calls qcCheckDepositSuggestion() internally
  }
  _qcUpdateDepositAmountRow();
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

// ── Service management (assign panel pattern — matches detail modal) ──

/** Get service IDs already confirmed */
function qcGetSelectedServiceIds() {
  const ids = new Set();
  document.querySelectorAll('.qc-svc-confirmed').forEach(card => {
    if (card.dataset.serviceId) ids.add(String(card.dataset.serviceId));
  });
  // Also include the current picker selection if open
  const assignSel = document.getElementById('qcAssignSvcSel');
  if (assignSel?.value && document.getElementById('qcAssignSvc')?.style.display !== 'none') {
    ids.add(String(assignSel.value));
  }
  return ids;
}

/** Show the assign panel — reuses same pattern as mConvertSvc in detail modal */
function qcShowAssignPanel() {
  const panel = document.getElementById('qcAssignSvc');
  const pracId = document.getElementById('qcPrac')?.value;
  const taken = qcGetSelectedServiceIds();

  // Check if all services are already added (show ALL services, not filtered by practitioner)
  const available = fcGetFilteredServices(null, '').filter(s => !taken.has(String(s.id)));
  if (available.length === 0) { gToast('Toutes les prestations sont d\u00e9j\u00e0 ajout\u00e9es', 'error'); return; }

  // Populate category dropdown (all categories)
  const catSel = document.getElementById('qcAssignCatSel');
  const cats = fcGetServiceCategories(null);
  catSel.innerHTML = '<option value="">\u2014 Toutes \u2014</option>' + cats.map(c =>
    `<option value="${esc(c)}">${esc(c)}</option>`
  ).join('');

  // Populate service dropdown (all categories, excluding taken — no practitioner filter)
  qcAssignRebuildServices(null, '', taken);

  // Reset variant + info + button
  document.getElementById('qcAssignVarWrap').style.display = 'none';
  document.getElementById('qcAssignVarSel').innerHTML = '';
  document.getElementById('qcAssignInfo').textContent = '';
  const addBtn = document.getElementById('qcAssignAddBtn');
  if (addBtn) { addBtn.disabled = true; addBtn.textContent = '+ Ajouter'; }

  // Hide the add button, show the panel
  document.getElementById('qcAddSvcBtn').style.display = 'none';
  panel.style.display = '';
}

/** Rebuild service dropdown for the assign panel */
function qcAssignRebuildServices(pracId, category, taken) {
  if (!taken) taken = qcGetSelectedServiceIds();
  // Show ALL active services (no practitioner filter) — backend auto-assigns practitioners
  const services = fcGetFilteredServices(null, category).filter(s => !taken.has(String(s.id)));
  const sel = document.getElementById('qcAssignSvcSel');
  sel.innerHTML = '<option value="">\u2014 Choisir \u2014</option>' + services.map(s =>
    `<option value="${s.id}" data-dur="${s.duration_min}" data-buf-before="${s.buffer_before_min||0}" data-buf-after="${s.buffer_after_min||0}" data-color="${/^#[0-9a-fA-F]{3,8}$/.test(s.color)?s.color:'#0D7377'}">${esc(s.name)} (${svcDurPriceLabel(s)})</option>`
  ).join('');
}

/** Category changed in assign panel */
function qcAssignCatChanged() {
  const cat = document.getElementById('qcAssignCatSel')?.value || '';
  qcAssignRebuildServices(null, cat);
  document.getElementById('qcAssignVarWrap').style.display = 'none';
  document.getElementById('qcAssignVarSel').innerHTML = '';
  document.getElementById('qcAssignInfo').textContent = '';
  qcAssignUpdateAddBtn();
}

/** Service changed in assign panel — populate variant dropdown if needed */
function qcAssignSvcChanged() {
  const sel = document.getElementById('qcAssignSvcSel');
  const varWrap = document.getElementById('qcAssignVarWrap');
  const varSel = document.getElementById('qcAssignVarSel');
  const svcId = sel.value;
  if (!svcId) { varWrap.style.display = 'none'; document.getElementById('qcAssignInfo').textContent = ''; qcAssignUpdateAddBtn(); return; }
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  const variants = svc?.variants || [];
  if (variants.length > 0) {
    varSel.innerHTML = '<option value="">\u2014 Variante \u2014</option>' + variants.map(v =>
      `<option value="${v.id}" data-dur="${v.duration_min}" data-price="${v.price_cents||0}">${esc(v.name)} (${v.duration_min} min${v.price_cents ? ' \u00b7 '+(v.price_cents/100).toFixed(2).replace('.',',')+'\u20ac' : ''})</option>`
    ).join('');
    varWrap.style.display = 'block';
  } else {
    varSel.innerHTML = '';
    varWrap.style.display = 'none';
  }
  qcAssignUpdateInfo();
  qcAssignUpdateAddBtn();
}

/** Variant changed in assign panel */
function qcAssignVarChanged() {
  qcAssignUpdateInfo();
  qcAssignUpdateAddBtn();
}

/** Update info line with duration + price (variant-aware) */
function qcAssignUpdateInfo() {
  const sel = document.getElementById('qcAssignSvcSel');
  const varSel = document.getElementById('qcAssignVarSel');
  const info = document.getElementById('qcAssignInfo');
  const svcId = sel?.value;
  if (!svcId) { info.textContent = ''; return; }
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  const varOpt = varSel?.selectedOptions?.[0];
  const varId = varOpt?.value;
  if (varId) {
    const variant = svc?.variants?.find(v => String(v.id) === String(varId));
    const dur = variant?.duration_min || parseInt(varOpt.dataset.dur) || 0;
    const price = variant?.price_cents ?? parseInt(varOpt.dataset.price) ?? 0;
    info.textContent = dur + ' min' + (price ? ' \u00b7 ' + (price / 100).toFixed(2).replace('.',',') + '\u20ac' : '');
  } else {
    info.textContent = svcDurPriceLabel(svc);
  }
}

/** Enable/disable + Ajouter button based on selection state */
function qcAssignUpdateAddBtn() {
  const btn = document.getElementById('qcAssignAddBtn');
  if (!btn) return;
  const svcId = document.getElementById('qcAssignSvcSel')?.value;
  if (!svcId) { btn.disabled = true; return; }
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  const hasVariants = (svc?.variants || []).length > 0;
  const varSelected = !!document.getElementById('qcAssignVarSel')?.value;
  btn.disabled = hasVariants && !varSelected;
}

/** Confirm selection: create confirmed card + hide panel */
function qcAssignConfirm() {
  const sel = document.getElementById('qcAssignSvcSel');
  const varSel = document.getElementById('qcAssignVarSel');
  const svcId = sel?.value;
  if (!svcId) return;
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  if (!svc) return;
  const varId = varSel?.value || '';
  const variant = varId ? svc.variants?.find(v => String(v.id) === String(varId)) : null;
  const color = /^#[0-9a-fA-F]{3,8}$/.test(svc.color) ? svc.color : '#0D7377';
  const name = variant ? svc.name + ' \u2014 ' + variant.name : svc.name;
  const dur = variant?.duration_min || svc.duration_min || 0;
  const price = variant?.price_cents || svc.price_cents || 0;
  const durPrice = dur + 'min' + (price ? ' \u00b7 ' + (price / 100).toFixed(2).replace('.',',') + '\u20ac' : '');
  const modes = JSON.stringify(svc.mode_options || ['cabinet']);
  const pt = variant?.processing_time || svc.processing_time || 0;
  const ps = variant?.processing_start || svc.processing_start || 0;
  const html = `<div class="qc-svc-confirmed" data-service-id="${svcId}" data-variant-id="${varId}" data-dur="${dur}" data-buf="${(svc.buffer_before_min||0)+(svc.buffer_after_min||0)}" data-price="${price}" data-color="${color}" data-modes='${modes}' data-pt="${pt}" data-ps="${ps}">
    <span class="qc-svc-color" style="background:${color}"></span>
    <span style="flex:1;font-weight:600">${esc(name)}</span>
    <span class="qc-svc-dur">${durPrice}</span>
    <button class="qc-svc-rm" onclick="qcRemoveConfirmed(this)" title="Retirer">\u2715</button>
  </div>`;
  document.getElementById('qcServiceList').insertAdjacentHTML('beforeend', html);
  document.getElementById('qcAssignSvc').style.display = 'none';
  document.getElementById('qcAddSvcBtn').style.display = '';
  qcUpdateTotal();
  qcCheckConflict();
}

/** Cancel assign panel without adding */
function qcAssignCancel() {
  document.getElementById('qcAssignSvc').style.display = 'none';
  document.getElementById('qcAddSvcBtn').style.display = '';
}

/** Remove a confirmed service card */
function qcRemoveConfirmed(btn) {
  const card = btn.closest('.qc-svc-confirmed');
  if (card) card.remove();
  qcUpdateTotal();
  qcCheckConflict();
}

/** When practitioner changes: services are no longer filtered by practitioner,
 *  so we just close the assign panel if open. Backend auto-assigns practitioners. */
function qcRefreshServiceDropdowns() {
  // Close assign panel if open
  document.getElementById('qcAssignSvc').style.display = 'none';
  document.getElementById('qcAddSvcBtn').style.display = '';
  qcUpdateTotal();
}

function qcUpdateTotal() {
  let total = 0;
  let firstColor = '#0D7377';
  const cards = document.querySelectorAll('.qc-svc-confirmed');
  let availModes = null;
  cards.forEach((card, i) => {
    const dur = parseInt(card.dataset.dur || 0);
    const buf = parseInt(card.dataset.buf || 0);
    const color = card.dataset.color || '#0D7377';
    total += dur + buf;
    if (i === 0) firstColor = color;
    try {
      const modes = JSON.parse(card.dataset.modes || '["cabinet"]');
      if (!availModes) availModes = new Set(modes);
      else availModes = new Set([...availModes].filter(m => modes.includes(m)));
    } catch (_) { /* ignore */ }
  });

  // Update gradient to first service color
  qcUpdateGradient(firstColor);

  // Update total display
  const el = document.getElementById('qcTotalDuration');
  if (cards.length > 1) {
    const h = Math.floor(total / 60), m = total % 60;
    el.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Dur\u00e9e totale : <strong>${h ? h + 'h' : ''}${m ? m + 'min' : ''}</strong> \u00b7 ${cards.length} ${categoryLabels.services.toLowerCase()}`;
  } else if (cards.length === 1) {
    el.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ${total} min`;
  } else {
    el.innerHTML = '';
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
    modeSel.innerHTML = modes.map(m => `<option value="${m}">${MODE_ICO[m] || ''} ${({ cabinet: 'Au salon', visio: 'Visio', phone: 'T\u00e9l\u00e9phone' })[m] || esc(m)}</option>`).join('');
    if (modes.includes(curVal)) modeSel.value = curVal;
  }

  // ── Multi-practitioner split info ──
  document.getElementById('qcSplitInfo')?.remove();
  if (cards.length > 1) {
    const pracId = document.getElementById('qcPrac')?.value;
    const assignments = [];
    let needsSplit = false;
    cards.forEach(card => {
      const svcId = card.dataset.serviceId;
      const svc = calState.fcServices?.find(s => String(s.id) === String(svcId));
      const svcName = svc?.name || '?';
      // Check if the selected practitioner covers this service
      const selPrac = calState.fcPractitioners.find(p => String(p.id) === String(pracId));
      if (selPrac && !selPrac.service_ids?.includes(svcId)) {
        // Find which practitioner(s) cover this service
        const covering = calState.fcPractitioners.filter(p => p.service_ids?.includes(svcId));
        const assignedName = covering.length > 0 ? covering[0].display_name : '?';
        assignments.push(`<span style="font-weight:600">${esc(svcName)}</span> \u2192 ${esc(assignedName)}`);
        needsSplit = true;
      } else if (selPrac) {
        assignments.push(`<span style="font-weight:600">${esc(svcName)}</span> \u2192 ${esc(selPrac.display_name)}`);
      }
    });
    if (needsSplit && el) {
      const splitHtml = `<div id="qcSplitInfo" style="margin-top:8px;padding:8px 12px;border-radius:8px;font-size:.78rem;line-height:1.6;background:var(--bg-2);border:1px solid var(--border)"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;width:14px;height:14px;margin-right:4px"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Multi-praticien : ${assignments.join(' <span style="color:var(--text-4)">\u00b7</span> ')}</div>`;
      el.insertAdjacentHTML('afterend', splitHtml);
    }
  }

  // Pose info
  let poseHtml = '';
  const timeVal = document.getElementById('qcTime')?.value;
  if (timeVal && cards.length) {
    const [hh, mm] = timeVal.split(':').map(Number);
    let offsetMin = 0;
    cards.forEach(card => {
      const dur = parseInt(card.dataset.dur || 0);
      const buf = parseInt(card.dataset.buf || 0);
      const pt = parseInt(card.dataset.pt || 0);
      const ps = parseInt(card.dataset.ps || 0);
      if (pt > 0) {
        const poseStartMin = hh * 60 + mm + offsetMin + ps;
        const poseEndMin = poseStartMin + pt;
        const fmt = m => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
        poseHtml += `<div>\u23f3 Pose ${fmt(poseStartMin)} \u2013 ${fmt(poseEndMin)} (${pt}min)</div>`;
      }
      offsetMin += dur + buf;
    });
  }
  document.getElementById('qcPoseInfo')?.remove();
  if (poseHtml && el) el.insertAdjacentHTML('afterend', `<div id="qcPoseInfo" style="font-size:.75rem;color:var(--text-4);margin-top:4px">${poseHtml}</div>`);

  // ── Schedule restriction warning ──
  document.getElementById('qcScheduleWarn')?.remove();
  const dateVal = document.getElementById('qcDate')?.value;
  if (timeVal && dateVal && cards.length) {
    const [hh2, mm2] = timeVal.split(':').map(Number);
    let offMin = 0;
    const warns = [];
    cards.forEach(card => {
      const svcId = card.dataset.serviceId;
      const dur2 = parseInt(card.dataset.dur || 0);
      const buf2 = parseInt(card.dataset.buf || 0);
      const svc2 = calState.fcServices?.find(s => String(s.id) === String(svcId));
      if (svc2?.available_schedule?.type === 'restricted') {
        const sStart = new Date(dateVal + 'T00:00:00');
        const jsDay = sStart.getDay();
        const weekday = jsDay === 0 ? 6 : jsDay - 1;
        const svcWindows = (svc2.available_schedule.windows || []).filter(w => w.day === weekday);
        const sMin = hh2 * 60 + mm2 + offMin;
        const eMin = sMin + dur2;
        const _tm = t => { const p = String(t).split(':'); return parseInt(p[0]) * 60 + parseInt(p[1]); };
        const fits = svcWindows.some(w => sMin >= _tm(w.from) && eMin <= _tm(w.to));
        if (!fits) {
          const windowsStr = svcWindows.length > 0
            ? svcWindows.map(w => w.from + '\u2013' + w.to).join(', ')
            : 'non disponible ce jour';
          warns.push(`<strong>${esc(svc2.name)}</strong> : ${windowsStr}`);
        }
      }
      offMin += dur2 + buf2;
    });
    if (warns.length > 0) {
      const warnHtml = `<div id="qcScheduleWarn" style="margin-top:8px;padding:8px 12px;border-radius:8px;font-size:.78rem;line-height:1.4;background:#FFF3E0;color:#E65100"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Restriction horaire : ${warns.join(' \u00b7 ')}</div>`;
      el.insertAdjacentHTML('afterend', warnHtml);
    }
  }

  // Check deposit suggestion whenever services change
  qcCheckDepositSuggestion();
}

// ── Deposit auto-suggestion ──
function qcCheckDepositSuggestion() {
  const s = calState.fcBusinessSettings || {};
  if (!s.deposit_enabled) return;
  // DEP-01 UI gate : skip toggle deposit si pas Pro ou Stripe Connect inactif
  // (endpoint refuserait l'envoi → booking bloque sans feedback utilisateur).
  // Fallback window._* car quick-create peut etre invoque avant fcBusinessPlan set.
  const _qcPlan = calState.fcBusinessPlan || window._businessPlan || 'free';
  const _qcConnectId = calState.fcStripeConnectId || window._stripeConnectId || null;
  const _qcConnectStatus = calState.fcStripeConnectStatus || window._stripeConnectStatus || 'none';
  if (_qcPlan === 'free') return;
  if (!_qcConnectId || _qcConnectStatus !== 'active') return;

  const toggle = document.getElementById('qcDepositToggle');
  const check = document.getElementById('qcDepositCheck');
  const hint = document.getElementById('qcDepositHint');
  const track = document.getElementById('qcDepositTrack');
  const thumb = document.getElementById('qcDepositThumb');
  if (!toggle || !check) return;

  const isFreestyle = document.getElementById('qcFreestyle')?.checked;

  // Compute total price + duration from selected services
  let totalPrice = 0, totalDur = 0;
  if (isFreestyle) {
    // Freestyle: compute duration from start/end, no price
    const st = document.getElementById('qcTime')?.value;
    const et = document.getElementById('qcFreeEnd')?.value;
    if (st && et) {
      const [sh, sm] = st.split(':').map(Number);
      const [eh, em] = et.split(':').map(Number);
      totalDur = (eh * 60 + em) - (sh * 60 + sm);
      if (totalDur < 0) totalDur = 0;
    }
  } else {
    document.querySelectorAll('.qc-svc-confirmed').forEach(card => {
      totalPrice += parseInt(card.dataset.price || 0);
      totalDur += parseInt(card.dataset.dur || 0);
    });
  }

  const priceThresh = s.deposit_price_threshold_cents || 0;
  const durThresh = s.deposit_duration_threshold_min || 0;
  const mode = s.deposit_threshold_mode || 'any';

  // Always show toggle when deposit is enabled
  toggle.style.display = '';

  // Auto-suggest logic
  const priceHit = priceThresh > 0 && totalPrice >= priceThresh;
  const durHit = durThresh > 0 && totalDur >= durThresh;
  const suggest = (priceThresh > 0 || durThresh > 0) && (mode === 'both' ? (priceHit && durHit) : (priceHit || durHit));

  if (suggest && !check.checked && !check.dataset.userOverride) {
    check.checked = true;
    _qcUpdateDepositVisual(true);
    _qcUpdateDepositAmountRow();
    _qcUpdateDepositChannels(true);
    const reasons = [];
    if (priceHit) reasons.push((totalPrice / 100).toFixed(2).replace('.',',') + '€');
    if (durHit) reasons.push(totalDur + ' min');
    hint.textContent = 'Suggéré — ' + reasons.join(' · ');
  } else if (!suggest && hint) {
    hint.textContent = '';
  }
}

function qcDepositUserToggle(el) {
  el.dataset.userOverride = 'true';
  _qcUpdateDepositVisual(el.checked);
  _qcUpdateDepositAmountRow();
  _qcUpdateDepositChannels(el.checked);
}

function _qcUpdateDepositVisual(on) {
  const track = document.getElementById('qcDepositTrack');
  const thumb = document.getElementById('qcDepositThumb');
  if (track) track.style.background = on ? 'var(--amber)' : 'var(--border)';
  if (thumb) thumb.style.left = on ? '20px' : '2px';
}

function _qcUpdateDepositChannels(on) {
  const row = document.getElementById('qcDepositChannels');
  if (!row) return;
  row.style.display = on ? 'flex' : 'none';
  // Pre-check based on available client contact
  const emailInput = document.getElementById('qcClient');
  const phoneField = document.querySelector('#qcPhone input, #qcPhone');
  // Default: email checked, SMS unchecked
  const emailCb = document.getElementById('qcDepEmail');
  const smsCb = document.getElementById('qcDepSms');
  if (emailCb) emailCb.checked = true;
  if (smsCb) smsCb.checked = false;
}

/** Show/hide the deposit amount input — only visible in freestyle mode + deposit ON */
function _qcUpdateDepositAmountRow() {
  const row = document.getElementById('qcDepositAmountRow');
  if (!row) return;
  const isFreestyle = document.getElementById('qcFreestyle')?.checked;
  const isChecked = document.getElementById('qcDepositCheck')?.checked;
  const show = isFreestyle && isChecked;
  row.style.display = show ? '' : 'none';
  if (show) {
    const inp = document.getElementById('qcDepositAmount');
    if (inp && !inp.value) {
      const s = calState.fcBusinessSettings || {};
      const defaultEuros = s.deposit_type === 'fixed'
        ? ((s.deposit_fixed_cents || 2500) / 100)
        : 25;
      inp.value = defaultEuros.toFixed(2);
    }
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
      if (!r.ok) throw new Error('Search failed');
      const d = await r.json();
      const clients = d.clients || [];
      _qcSearchResults = clients;
      let h = clients.map(c => {
        const vipTag = c.is_vip
          ? `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;background:var(--amber-bg);color:var(--gold);margin-left:4px">${IC.star} VIP</span>`
          : '';
        const nsTag = c.no_show_count > 0
          ? `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;background:var(--amber-bg);color:var(--amber-dark);margin-left:4px">${IC.alertTriangle} ${c.no_show_count} no-show${c.no_show_count > 1 ? 's' : ''}</span>`
          : '';
        const blTag = c.is_blocked
          ? `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;background:var(--red-bg);color:var(--red);margin-left:4px">Bloqué</span>`
          : '';
        return `<div class="ac-item" onclick="calPickClient('${safeId(c.id)}','${escJs(c.full_name)}')"><div class="ac-name">${esc(c.full_name)}${vipTag}${nsTag}${blTag}</div><div class="ac-meta">${esc(c.phone || '')} ${esc(c.email || '')}</div></div>`;
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
  const cached = _qcSearchResults.find(c => String(c.id) === String(id));
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
      if (!r.ok) throw new Error('Client fetch failed');
      const d = await r.json();
      const fetched = (d.clients || []).find(c => String(c.id) === String(id));
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
  warn.style.cssText = 'margin-top:6px;padding:6px 10px;border-radius:8px;background:var(--amber-bg);color:var(--amber-dark);font-size:.78rem;font-weight:600;display:flex;align-items:center;gap:6px';
  warn.innerHTML = `<span>${IC.alertTriangle}</span><span>${count} no-show${count > 1 ? 's' : ''} \u2014 un acompte pourra \u00eatre exig\u00e9</span>`;
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

// ── In-memory Todos ──
function qcAddTodo() {
  const inp = document.getElementById('qcNewTodo');
  const content = inp.value.trim();
  if (!content) return;
  qcTodos.push({ content });
  inp.value = '';
  qcRenderTodos();
}

function qcDeleteTodo(idx) {
  qcTodos.splice(idx, 1);
  qcRenderTodos();
}

function qcRenderTodos() {
  const el = document.getElementById('qcTodoList');
  if (!el) return;
  if (qcTodos.length === 0) {
    el.innerHTML = `<div class="m-empty"><div class="m-empty-icon">${IC.checkSquare}</div>Aucune tâche pour l'instant</div>`;
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
  const channelLabels = { browser: IC.bell + ' Notif', email: IC.mail + ' Email', both: IC.bell + '+' + IC.mail };
  qcReminders.push({ offset_minutes: parseInt(offset), channel, offsetLabel: offsetLabels[offset] || offset + ' min', channelLabel: channelLabels[channel] || channel });
  qcRenderReminders();
}

function qcDeleteReminder(idx) {
  qcReminders.splice(idx, 1);
  qcRenderReminders();
}

function qcRenderReminders() {
  const el = document.getElementById('qcReminderList');
  if (!el) return;
  if (qcReminders.length === 0) {
    el.innerHTML = `<div class="m-empty"><div class="m-empty-icon">${IC.alarmClock}</div>Aucun rappel pour l'instant</div>`;
    return;
  }
  el.innerHTML = qcReminders.map((r, i) => `<div class="reminder-card">
    <span class="reminder-icon">${IC.alarmClock}</span>
    <div><div class="ri-time">${esc(r.offsetLabel)}</div><div class="ri-channel">${esc(r.channelLabel)}</div></div>
    <button class="reminder-delete" onclick="qcDeleteReminder(${i})" title="Supprimer"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
  </div>`).join('');
}

// ── Create booking ──
async function calCreateBooking() {
  if (calCreateBooking._busy) return;
  calCreateBooking._busy = true;
  const _qcBtn = document.getElementById('qcBtnCreate');
  if (_qcBtn) { _qcBtn.disabled = true; _qcBtn.classList.add('is-loading'); }
  try {
    const clientName = document.getElementById('qcClient').value.trim();
    const clientId = document.getElementById('qcClientId').value;
    const pracId = document.getElementById('qcPrac').value;
    const date = document.getElementById('qcDate').value;
    const time = document.getElementById('qcTime').value;
    const mode = document.getElementById('qcMode').value;
    const comment = document.getElementById('qcComment').value.trim();
    const isFreestyle = document.getElementById('qcFreestyle').checked;

    if (!clientName) { gToast('Nom requis', 'error'); return; }
    if (clientName.length > 200) { gToast('Nom trop long (max 200 caractères)', 'error'); return; }
    if (!date || !time) { gToast('Date et heure requises', 'error'); return; }

    const start_at = toBrusselsISO(date, time);

    // Reject bookings too far in the past (>2h tolerance)
    if (new Date(start_at).getTime() < Date.now() - 2 * 3600000) {
      gToast('Impossible de créer un RDV aussi loin dans le passé', 'error'); return;
    }

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
      if (!cr.ok) { const d = await cr.json(); throw new Error(d.message || d.error || 'Erreur création client'); }
      const cd = await cr.json();
      actualClientId = cd.client?.id;
    } else {
      // Update existing client if email/phone changed
      const cached = _qcSearchResults.find(c => String(c.id) === String(clientId));
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

    const isLocked = document.getElementById('qcLocked')?.checked || false;
    const skipConfirm = document.getElementById('qcSkipConfirm')?.checked || false;

    let body;
    if (isFreestyle) {
      const endTime = document.getElementById('qcFreeEnd').value;
      if (!endTime) { gToast('Heure de fin requise', 'error'); return; }
      const [sh, sm] = time.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      if ((eh * 60 + em) <= (sh * 60 + sm)) {
        gToast("L'heure de fin doit être après l'heure de début", 'error');
        return;
      }
      const end_at = toBrusselsISO(date, endTime);
      const customLabel = document.getElementById('qcFreeLabel').value.trim() || null;
      if (customLabel && customLabel.length > 200) { gToast('Intitulé trop long (max 200 caractères)', 'error'); return; }
      body = {
        freestyle: true,
        practitioner_id: pracId,
        client_id: actualClientId,
        start_at,
        end_at,
        buffer_before_min: parseInt(document.getElementById('qcFreeBufBefore').value) || 0,
        buffer_after_min: parseInt(document.getElementById('qcFreeBufAfter').value) || 0,
        custom_label: customLabel,
        color: document.getElementById('qcFreeColor')?.value || '#0D7377',
        appointment_mode: 'cabinet',
        comment: comment || null,
        client_email: clientEmail || undefined,
        locked: isLocked,
        skip_confirmation: skipConfirm
      };
    } else {
      // Check if assign panel is open with pending selection
      if (document.getElementById('qcAssignSvc')?.style.display !== 'none') {
        gToast('Confirmez ou annulez la prestation en cours', 'error'); return;
      }
      const cards = document.querySelectorAll('.qc-svc-confirmed');
      const services = [...cards].map(c => {
        const obj = { service_id: c.dataset.serviceId };
        if (c.dataset.variantId) obj.variant_id = c.dataset.variantId;
        return obj;
      }).filter(s => s.service_id);
      if (services.length === 0) { gToast('Choisissez au moins une '+categoryLabels.service.toLowerCase(), 'error'); return; }

      body = {
        practitioner_id: pracId,
        client_id: actualClientId,
        start_at,
        appointment_mode: mode,
        comment: comment || null,
        client_email: clientEmail || undefined,
        locked: isLocked,
        skip_confirmation: skipConfirm
      };
      if (services.length === 1) {
        body.service_id = services[0].service_id;
        if (services[0].variant_id) body.variant_id = services[0].variant_id;
      } else {
        body.services = services;
      }
    }

    // Deposit toggle: force deposit if staff checked the toggle
    const depCheck = document.getElementById('qcDepositCheck');
    if (depCheck?.checked) {
      body.force_deposit = true;
      // Freestyle: send explicit deposit amount from the input
      const depAmtRow = document.getElementById('qcDepositAmountRow');
      if (depAmtRow && depAmtRow.style.display !== 'none') {
        const raw = parseFloat(document.getElementById('qcDepositAmount')?.value);
        if (!raw || raw <= 0) { gToast('Montant de l\'acompte requis', 'error'); return; }
        if (raw > 10000) { gToast('Montant de l\'acompte trop élevé (max 10 000€)', 'error'); return; }
        body.deposit_amount_cents = Math.round(raw * 100);
      }
    }

    const r = await fetch('/api/bookings/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.message || d.error || 'Erreur'); }
    const result = await r.json();
    const bookingId = result.booking?.id || result.bookings?.[0]?.id;

    // Save todos, reminders in parallel
    if (bookingId) {
      const promises = [];
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
    if (qcTodos.length) extra.push(`${qcTodos.length} t\u00e2che${qcTodos.length > 1 ? 's' : ''}`);
    if (qcReminders.length) extra.push(`${qcReminders.length} rappel${qcReminders.length > 1 ? 's' : ''}`);
    const extraStr = extra.length ? ' + ' + extra.join(', ') : '';

    const toastMsg = isFreestyle
      ? `${clientName} \u2014 RDV libre cr\u00e9\u00e9 !${extraStr}`
      : count > 1
        ? `${clientName} \u2014 ${count} ${categoryLabels.services.toLowerCase()} cr\u00e9\u00e9es !${extraStr}`
        : `${clientName} \u2014 RDV cr\u00e9\u00e9 !${extraStr}`;

    // Signal to Quick Booking that a booking was created (not just modal closed)
    const mainBooking = result.booking || result.bookings?.[0];
    document.getElementById('calCreateModal')._soBooked = true;

    gToast(toastMsg, 'success');
    document.getElementById('calCreateModal')._dirtyGuard?.markClean();
    closeCalModal('calCreateModal');
    fcRefresh();

    // Auto-send deposit request in background using selected channels (single API call)
    if (mainBooking?.status === 'pending_deposit' && mainBooking.deposit_required) {
      const wantEmail = document.getElementById('qcDepEmail')?.checked;
      const wantSms = document.getElementById('qcDepSms')?.checked;
      const channels = [];
      if (wantEmail && clientEmail) channels.push('email');
      if (wantSms && clientPhone) channels.push('sms');
      // Fallback: if nothing selected but contact exists, send email
      if (!channels.length && clientEmail) channels.push('email');
      if (channels.length > 0) {
        try {
          const dr = await fetch(`/api/bookings/${mainBooking.id}/send-deposit-request`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
            body: JSON.stringify({ channels })
          });
          if (dr.ok) {
            const data = await dr.json();
            gToast(`Demande d\u2019acompte envoy\u00e9e par ${data.label || channels.join(' + ')}`, 'success');
          }
        } catch (_) { /* silent — booking already created */ }
      }
    }
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally {
    calCreateBooking._busy = false;
    if (_qcBtn) { _qcBtn.classList.remove('is-loading'); _qcBtn.disabled = false; }
  }
}

/**
 * Setup global event listeners for freestyle duration auto-update.
 * Called once from index.js.
 * B1-fix : guard contre attachement multiple (navigation Agenda↔Clients↔Agenda
 * ajoutait 1 handler par visite → keystroke déclenchait N handlers).
 */
let _qcListenersWired = false;
function setupQuickCreateListeners() {
  if (_qcListenersWired) return;
  _qcListenersWired = true;
  document.addEventListener('change', e => {
    if (['qcFreeEnd', 'qcFreeBufBefore', 'qcFreeBufAfter'].includes(e.target?.id)) qcUpdateFreeDuration();
    // Update gradient on freestyle color change
    if (e.target?.id === 'qcFreeColor') {
      qcUpdateGradient(e.target.value);
    }
  });
  document.addEventListener('input', e => {
    if (e.target?.id === 'qcTime' || e.target?.id === 'qcDate') {
      if (document.getElementById('qcFreestyle')?.checked) qcUpdateFreeDuration();
      else qcUpdateTotal();
      qcCheckConflict();
    }
    if (e.target?.id === 'qcFreeEnd') qcCheckConflict();
  });
}

// ── Mode toggle RDV / Tâche ──
let _qcCurrentMode = 'rdv';

function _qcSetMode(mode) {
  _qcCurrentMode = mode;
  const modal = document.getElementById('calCreateModal');
  if (!modal) return;

  // Toggle buttons — always highlight RDV since task now redirects
  modal.querySelectorAll('.qc-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  const panelRdv = document.getElementById('qcPanelRdv');
  const headerTitle = modal.querySelector('.m-client-name');
  const btn = document.getElementById('qcBtnCreate');

  // Only RDV mode is handled inline now (task redirects to Task Detail modal)
  if (panelRdv) { panelRdv.style.display = ''; panelRdv.classList.add('active'); }
  if (headerTitle) headerTitle.textContent = 'Nouveau rendez-vous';
  if (btn) btn.textContent = 'Créer le RDV';
  qcUpdateTotal();
}

function qcSwitchMode(mode) {
  if (mode === 'task') {
    // Gather current date/time/practitioner from RDV form
    const date = document.getElementById('qcDate')?.value || '';
    const startTime = document.getElementById('qcTime')?.value || '';
    // Default end = start + 1h
    let endTime = '';
    if (startTime) {
      const [h, m] = startTime.split(':').map(Number);
      const eh = (h + 1) % 24;
      endTime = String(eh).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    const pracId = document.getElementById('qcPrac')?.value || '';

    // Close Quick Create and open Task Detail in creation mode
    document.getElementById('calCreateModal')._dirtyGuard?.markClean();
    closeCalModal('calCreateModal');
    // Use setTimeout to let the close animation complete before opening the new modal
    setTimeout(() => { window.fcNewTask?.(date, startTime, endTime, pracId); }, 50);
    return;
  }
  if (mode === _qcCurrentMode) return;
  _qcSetMode(mode);
}

async function qcCreateTask() {
  if (qcCreateTask._busy) return;
  qcCreateTask._busy = true;
  try {
    const title = document.getElementById('qcTaskTitle').value.trim();
    const date = document.getElementById('qcTaskDate').value;
    const startTime = document.getElementById('qcTaskStart').value;
    const endTime = document.getElementById('qcTaskEnd').value;
    const color = document.getElementById('qcTaskColor')?.value || '';
    const note = document.getElementById('qcTaskNote').value.trim();

    // Collect selected practitioner IDs from checkboxes
    const checks = document.querySelectorAll('#qcTaskPracChecks input[type="checkbox"]:checked');
    const pracIds = [...checks].map(cb => cb.value);

    if (!title) { gToast('Titre requis', 'error'); return; }
    if (pracIds.length === 0) { gToast('Sélectionnez au moins un praticien', 'error'); return; }
    if (!date || !startTime || !endTime) { gToast('Date et heures requises', 'error'); return; }

    const start_at = toBrusselsISO(date, startTime);
    const end_at = toBrusselsISO(date, endTime);

    const body = { title, start_at, end_at, color: color || null, note: note || null };
    if (pracIds.length === 1) body.practitioner_id = pracIds[0];
    else body.practitioner_ids = pracIds;

    const r = await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.message || d.error || 'Erreur'); }
    const countMsg = pracIds.length > 1 ? ` (${pracIds.length} praticiens)` : '';
    gToast('Tâche créée' + countMsg, 'success');
    document.getElementById('calCreateModal')._soBooked = true;
    document.getElementById('calCreateModal')._dirtyGuard?.markClean();
    closeCalModal('calCreateModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { qcCreateTask._busy = false; }
}

// ── Deposit request panel (shown after creating a pending_deposit booking) ──

function _showDepositRequestPanel(booking, clientName, clientEmail, clientPhone) {
  const modalBody = document.querySelector('#calCreateModal .m-body');
  const modalBottom = document.querySelector('#calCreateModal .m-bottom');

  qcUpdateGradient('var(--amber)');
  const headerTitle = document.querySelector('#calCreateModal .m-client-name');
  if (headerTitle) headerTitle.textContent = 'Demande d\u2019acompte';

  const amtStr = ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');
  const hasEmail = !!clientEmail;
  const hasPhone = !!clientPhone;
  const safeId = String(booking.id).replace(/[^a-zA-Z0-9_-]/g, '');

  let channelBtns = '';
  if (hasEmail) {
    channelBtns += `<button class="m-btn" style="flex:1;padding:12px;border-radius:10px;border:1.5px solid var(--amber);background:var(--amber-bg);color:var(--amber-dark);font-weight:700;font-size:.88rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px" onclick="qcSendDepositRequest('${safeId}','email')">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>
      Par email</button>`;
  }
  if (hasPhone) {
    channelBtns += `<button class="m-btn" style="flex:1;padding:12px;border-radius:10px;border:1.5px solid ${hasEmail ? 'var(--border)' : 'var(--amber)'};background:${hasEmail ? 'var(--white)' : 'var(--amber-bg)'};color:${hasEmail ? 'var(--text-3)' : 'var(--amber-dark)'};font-weight:700;font-size:.88rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px" onclick="qcSendDepositRequest('${safeId}','sms')">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
      Par SMS</button>`;
  }

  modalBody.innerHTML = `
    <div style="padding:24px;text-align:center">
      <div style="width:56px;height:56px;border-radius:16px;background:var(--amber-bg);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <svg class="gi" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
      </div>
      <h3 style="font-size:1.1rem;font-weight:700;margin:0 0 4px;font-family:var(--sans)">Envoyer une demande d\u2019acompte ?</h3>
      <p style="font-size:.88rem;color:var(--text-3);margin:0 0 20px">
        <strong>${esc(clientName)}</strong> \u2014 ${amtStr} \u20ac
      </p>
      ${(!hasEmail && !hasPhone) ? '<p style="font-size:.82rem;color:var(--red);margin:0 0 16px">Aucun contact disponible (ni email, ni t\u00e9l\u00e9phone)</p>' : ''}
      <div style="display:flex;gap:10px;margin-bottom:12px">
        ${channelBtns}
      </div>
      <div id="qcDepositSendStatus" style="display:none;margin-top:12px"></div>
    </div>`;

  modalBottom.innerHTML = `
    <button class="m-btn" style="padding:10px 24px;border-radius:10px;border:1.5px solid var(--border);background:var(--white);color:var(--text-3);font-weight:600;font-size:.85rem;cursor:pointer" onclick="qcSkipDepositRequest()">Plus tard</button>`;
}

async function qcSendDepositRequest(bookingId, channel) {
  const statusEl = document.getElementById('qcDepositSendStatus');
  if (statusEl) {
    statusEl.style.display = 'block';
    statusEl.innerHTML = '<div style="font-size:.82rem;color:var(--text-3)">Envoi en cours\u2026</div>';
  }
  // Disable buttons
  document.querySelectorAll('#calCreateModal .m-body .m-btn').forEach(b => { b.disabled = true; b.style.opacity = '.5'; });

  try {
    const r = await fetch(`/api/bookings/${bookingId}/send-deposit-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ channels: [channel] })
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.message || d.error || 'Erreur d\u2019envoi');
    }
    const data = await r.json();
    if (statusEl) {
      statusEl.innerHTML = `<div style="font-size:.88rem;color:var(--green);font-weight:700">\u2713 Demande envoy\u00e9e par ${data.label || channel}</div>`;
    }
    setTimeout(() => {
      document.getElementById('calCreateModal')._dirtyGuard?.markClean();
      closeCalModal('calCreateModal');
    }, 1500);
  } catch (e) {
    if (statusEl) {
      statusEl.innerHTML = `<div style="font-size:.82rem;color:var(--red)">${esc(e.message)}</div>`;
    }
    // Re-enable buttons
    document.querySelectorAll('#calCreateModal .m-body .m-btn').forEach(b => { b.disabled = false; b.style.opacity = ''; });
  }
}

function qcSkipDepositRequest() {
  document.getElementById('calCreateModal')._dirtyGuard?.markClean();
  closeCalModal('calCreateModal');
}

// ── Conflict check (client-side, visual feedback only) ──
let _qcConflict = false;

function qcCheckConflict() {
  // Remove previous warning
  const prev = document.getElementById('qcConflictWarn');
  if (prev) prev.remove();

  const btn = document.getElementById('qcBtnCreate');
  const cal = calState.fcCal;
  if (!cal) { _qcConflict = false; return; }

  const date = document.getElementById('qcDate')?.value;
  const time = document.getElementById('qcTime')?.value;
  const pracId = document.getElementById('qcPrac')?.value;
  if (!date || !time || !pracId) { _qcConflict = false; if (btn) btn.disabled = false; return; }

  const isFreestyle = document.getElementById('qcFreestyle')?.checked;
  let totalMin = 0;
  if (isFreestyle) {
    const endTime = document.getElementById('qcFreeEnd')?.value;
    if (endTime) {
      const [sh, sm] = time.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      totalMin = (eh * 60 + em) - (sh * 60 + sm);
      if (totalMin <= 0) totalMin += 24 * 60;
    }
  } else {
    document.querySelectorAll('.qc-svc-confirmed').forEach(card => {
      totalMin += parseInt(card.dataset.dur || 0) + parseInt(card.dataset.buf || 0);
    });
  }
  if (totalMin <= 0) { _qcConflict = false; if (btn) btn.disabled = false; return; }

  // EDG3-13 batch 45 : guard DST_SPRING_GAP throw (audit batch 44).
  let startISO;
  try { startISO = toBrusselsISO(date, time); }
  catch (e) {
    _qcConflict = true;
    if (btn) btn.disabled = true;
    gToast(e.message, 'error');
    return;
  }
  const newStart = new Date(startISO);
  const newEnd = new Date(newStart.getTime() + totalMin * 60000);

  const prac = calState.fcPractitioners?.find(p => String(p.id) === String(pracId));
  const maxC = prac?.max_concurrent || 1;
  const toMin = t => Math.round(t / 60000);

  let overlapCount = 0;
  try {
    const allEvents = cal.getEvents();
    for (const ev of allEvents) {
      if (String(ev.extendedProps?.practitioner_id) !== String(pracId)) continue;
      const st = ev.extendedProps?.status;
      if (st === 'cancelled' || st === 'no_show' || st === 'completed') continue;
      if (ev.extendedProps?._isTask) continue;
      const evEnd = ev.end || ev.start;
      if (ev.start < newEnd && evEnd > newStart) {
        // Skip if new booking fits within this event's processing window
        const pt = parseInt(ev.extendedProps?.processing_time) || 0;
        if (pt > 0) {
          const ps = parseInt(ev.extendedProps?.processing_start) || 0;
          const buf = parseInt(ev.extendedProps?.buffer_before_min) || 0;
          const poseStartMs = ev.start.getTime() + (buf + ps) * 60000;
          const poseEndMs = ev.start.getTime() + (buf + ps + pt) * 60000;
          if (toMin(newStart.getTime()) >= toMin(poseStartMs) && toMin(newEnd.getTime()) <= toMin(poseEndMs)) continue;
        }
        overlapCount++;
      }
    }
  } catch (_) {
    // If FC getEvents fails, don't block — server will validate
    _qcConflict = false;
    if (btn) btn.disabled = false;
    return;
  }

  if (overlapCount >= maxC) {
    _qcConflict = true;
    if (btn) btn.disabled = true;
    // Insert warning after the time row
    const totalEl = document.getElementById('qcTotalDuration');
    const anchor = totalEl || document.getElementById('qcServiceList');
    if (anchor) {
      const warnHtml = `<div id="qcConflictWarn" style="margin-top:8px;padding:8px 12px;border-radius:8px;font-size:.78rem;line-height:1.4;background:var(--red-bg,#FEE2E2);color:var(--red,#DC2626);border:1px solid var(--red,#DC2626);display:flex;align-items:center;gap:6px">
        <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>Cr\u00e9neau occup\u00e9 \u2014 un autre RDV existe d\u00e9j\u00e0 sur ce créneau</span>
      </div>`;
      anchor.insertAdjacentHTML('afterend', warnHtml);
    }
  } else {
    _qcConflict = false;
    if (btn) btn.disabled = false;
  }
}

// Expose to global scope for onclick handlers
bridge({
  fcOpenQuickCreate, qcToggleFreestyle, qcUpdateFreeDuration,
  qcShowAssignPanel, qcAssignCatChanged, qcAssignSvcChanged, qcAssignVarChanged,
  qcAssignConfirm, qcAssignCancel, qcRemoveConfirmed,
  qcUpdateTotal, qcRefreshServiceDropdowns,
  calSearchClients, calPickClient, calNewClient, calCreateBooking,
  qcAddTodo, qcDeleteTodo,
  qcAddReminder, qcDeleteReminder,
  qcSwitchMode,
  qcSendDepositRequest, qcSkipDepositRequest,
  qcDepositUserToggle, qcCheckDepositSuggestion
});

export { fcOpenQuickCreate, calCreateBooking, setupQuickCreateListeners };
