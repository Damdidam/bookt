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
  document.getElementById('qcDate').value = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  document.getElementById('qcTime').value = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
  document.getElementById('qcClient').value = '';
  document.getElementById('qcClientId').value = '';
  document.getElementById('qcComment').value = '';
  document.getElementById('qcLocked').checked = false;
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
    // Default to filtered practitioner if one is selected
    if (calState.fcCurrentFilter && calState.fcCurrentFilter !== 'all') {
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

  // Reset deposit toggle
  const depToggle = document.getElementById('qcDepositToggle');
  const depCheck = document.getElementById('qcDepositCheck');
  if (depToggle) depToggle.style.display = 'none';
  if (depCheck) { depCheck.checked = false; delete depCheck.dataset.userOverride; }

  // Dirty guard (warn on close if user started filling)
  const qcModal = document.getElementById('calCreateModal');
  guardModal(qcModal, { noBackdropClose: true });
  qcModal.classList.add('open');
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

  // Check if all services are already added
  const available = fcGetFilteredServices(pracId, '').filter(s => !taken.has(String(s.id)));
  if (available.length === 0) { gToast('Toutes les prestations sont d\u00e9j\u00e0 ajout\u00e9es', 'error'); return; }

  // Populate category dropdown
  const catSel = document.getElementById('qcAssignCatSel');
  const cats = fcGetServiceCategories(pracId);
  catSel.innerHTML = '<option value="">\u2014 Toutes \u2014</option>' + cats.map(c =>
    `<option value="${esc(c)}">${esc(c)}</option>`
  ).join('');

  // Populate service dropdown (all categories, excluding taken)
  qcAssignRebuildServices(pracId, '', taken);

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
  const services = fcGetFilteredServices(pracId, category).filter(s => !taken.has(String(s.id)));
  const sel = document.getElementById('qcAssignSvcSel');
  sel.innerHTML = '<option value="">\u2014 Choisir \u2014</option>' + services.map(s =>
    `<option value="${s.id}" data-dur="${s.duration_min}" data-buf-before="${s.buffer_before_min||0}" data-buf-after="${s.buffer_after_min||0}" data-color="${/^#[0-9a-fA-F]{3,8}$/.test(s.color)?s.color:'#0D7377'}">${esc(s.name)} (${svcDurPriceLabel(s)})</option>`
  ).join('');
}

/** Category changed in assign panel */
function qcAssignCatChanged() {
  const cat = document.getElementById('qcAssignCatSel')?.value || '';
  const pracId = document.getElementById('qcPrac')?.value;
  qcAssignRebuildServices(pracId, cat);
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
      `<option value="${v.id}" data-dur="${v.duration_min}" data-price="${v.price_cents||0}">${esc(v.name)} (${v.duration_min} min${v.price_cents ? ' \u00b7 '+(v.price_cents/100).toFixed(0)+'\u20ac' : ''})</option>`
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
    info.textContent = dur + ' min' + (price ? ' \u00b7 ' + (price / 100).toFixed(0) + '\u20ac' : '');
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
  const durPrice = dur + 'min' + (price ? ' \u00b7 ' + (price / 100).toFixed(0) + '\u20ac' : '');
  const modes = JSON.stringify(svc.mode_options || ['cabinet']);
  const html = `<div class="qc-svc-confirmed" data-service-id="${svcId}" data-variant-id="${varId}" data-dur="${dur}" data-buf="${(svc.buffer_before_min||0)+(svc.buffer_after_min||0)}" data-price="${price}" data-color="${color}" data-modes='${modes}'>
    <span class="qc-svc-color" style="background:${color}"></span>
    <span style="flex:1;font-weight:600">${esc(name)}</span>
    <span class="qc-svc-dur">${durPrice}</span>
    <button class="qc-svc-rm" onclick="qcRemoveConfirmed(this)" title="Retirer">\u2715</button>
  </div>`;
  document.getElementById('qcServiceList').insertAdjacentHTML('beforeend', html);
  document.getElementById('qcAssignSvc').style.display = 'none';
  document.getElementById('qcAddSvcBtn').style.display = '';
  qcUpdateTotal();
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
}

/** Clear all confirmed cards + reset panel (used when practitioner changes) */
function qcRefreshServiceDropdowns() {
  document.getElementById('qcServiceList').innerHTML = '';
  document.getElementById('qcAssignSvc').style.display = 'none';
  document.getElementById('qcAddSvcBtn').style.display = '';
  qcShowAssignPanel();
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
    modeSel.innerHTML = modes.map(m => `<option value="${m}">${MODE_ICO[m] || ''} ${({ cabinet: 'Cabinet', visio: 'Visio', phone: 'T\u00e9l\u00e9phone' })[m] || esc(m)}</option>`).join('');
    if (modes.includes(curVal)) modeSel.value = curVal;
  }

  // Check deposit suggestion whenever services change
  qcCheckDepositSuggestion();
}

// ── Deposit auto-suggestion ──
function qcCheckDepositSuggestion() {
  const s = calState.fcBusinessSettings || {};
  if (!s.deposit_enabled) return;

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
    const reasons = [];
    if (priceHit) reasons.push((totalPrice / 100).toFixed(0) + '€');
    if (durHit) reasons.push(totalDur + ' min');
    hint.textContent = 'Suggéré — ' + reasons.join(' · ');
  } else if (!suggest && hint) {
    hint.textContent = '';
  }
}

function qcDepositUserToggle(el) {
  el.dataset.userOverride = 'true';
  _qcUpdateDepositVisual(el.checked);
}

function _qcUpdateDepositVisual(on) {
  const track = document.getElementById('qcDepositTrack');
  const thumb = document.getElementById('qcDepositThumb');
  if (track) track.style.background = on ? '#D97706' : 'var(--border)';
  if (thumb) thumb.style.left = on ? '20px' : '2px';
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
          ? `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;background:#FEF9E7;color:#D4A017;margin-left:4px">★ VIP</span>`
          : '';
        const nsTag = c.no_show_count > 0
          ? `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;background:#FDE68A;color:#B45309;margin-left:4px">${IC.alertTriangle} ${c.no_show_count} no-show${c.no_show_count > 1 ? 's' : ''}</span>`
          : '';
        const blTag = c.is_blocked
          ? `<span style="font-size:.6rem;font-weight:700;padding:1px 5px;border-radius:6px;background:#FECACA;color:#dc2626;margin-left:4px">Bloqué</span>`
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
  warn.style.cssText = 'margin-top:6px;padding:6px 10px;border-radius:8px;background:#FEF3E2;color:#B45309;font-size:.78rem;font-weight:600;display:flex;align-items:center;gap:6px';
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
  // If in task mode, delegate to task creation
  if (_qcCurrentMode === 'task') return qcCreateTask();

  if (calCreateBooking._busy) return;
  calCreateBooking._busy = true;
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
        locked: isLocked
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
        locked: isLocked
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
    if (depCheck?.checked) body.force_deposit = true;

    const r = await fetch('/api/bookings/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify(body)
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
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

    // Check if deposit is required — show deposit notification panel
    const mainBooking = result.booking || result.bookings?.[0];
    if (mainBooking?.status === 'pending_deposit' && mainBooking.deposit_required) {
      gToast(toastMsg, 'success');
      fcRefresh();
      _showDepositRequestPanel(mainBooking, clientName, clientEmail, clientPhone);
      return;
    }

    gToast(toastMsg, 'success');
    document.getElementById('calCreateModal')._dirtyGuard?.markClean();
    closeCalModal('calCreateModal');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { calCreateBooking._busy = false; }
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

// ── Mode toggle RDV / Tâche ──
let _qcCurrentMode = 'rdv';

function _qcSetMode(mode) {
  _qcCurrentMode = mode;
  const modal = document.getElementById('calCreateModal');
  if (!modal) return;

  // Toggle buttons
  modal.querySelectorAll('.qc-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

  const panelRdv = document.getElementById('qcPanelRdv');
  const panelTask = document.getElementById('qcPanelTask');
  const headerTitle = modal.querySelector('.m-client-name');
  const btn = document.getElementById('qcBtnCreate');

  if (mode === 'task') {
    if (panelRdv) { panelRdv.style.display = 'none'; panelRdv.classList.remove('active'); }
    if (panelTask) { panelTask.style.display = ''; panelTask.classList.add('active'); }
    if (headerTitle) headerTitle.textContent = 'Nouvelle tâche';
    if (btn) btn.textContent = 'Créer la tâche';

    // Sync date/time from RDV fields
    const qcDate = document.getElementById('qcDate')?.value;
    const qcTime = document.getElementById('qcTime')?.value;
    if (qcDate) document.getElementById('qcTaskDate').value = qcDate;
    if (qcTime) {
      document.getElementById('qcTaskStart').value = qcTime;
      // Default end = +1h
      const [h, m] = qcTime.split(':').map(Number);
      const eh = (h + 1) % 24;
      document.getElementById('qcTaskEnd').value = String(eh).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    // Populate practitioner checkboxes (multi-select)
    const pracWrap = document.getElementById('qcTaskPracWrap');
    const currentPrac = document.getElementById('qcPrac')?.value;
    let pracHtml = '<div class="td-prac-checks" id="qcTaskPracChecks">';
    (calState.fcPractitioners || []).forEach(p => {
      const checked = String(p.id) === String(currentPrac) ? 'checked' : '';
      pracHtml += `<label class="td-prac-check"><input type="checkbox" value="${p.id}" ${checked}><span class="td-prac-dot" style="background:${p.color || 'var(--primary)'}"></span><span>${esc(p.display_name)}</span></label>`;
    });
    pracHtml += '</div>';
    if (pracWrap) pracWrap.innerHTML = pracHtml;

    // Color swatch
    const wrap = document.getElementById('qcTaskColorWrap');
    if (wrap) wrap.innerHTML = cswHTML('qcTaskColor', '#6B7280', false);

    // Header gradient → gray for tasks
    qcUpdateGradient('#6B7280');
  } else {
    if (panelRdv) { panelRdv.style.display = ''; panelRdv.classList.add('active'); }
    if (panelTask) { panelTask.style.display = 'none'; panelTask.classList.remove('active'); }
    if (headerTitle) headerTitle.textContent = 'Nouveau rendez-vous';
    if (btn) btn.textContent = 'Créer le RDV';

    // Restore header gradient from service color
    qcUpdateTotal();
  }
}

function qcSwitchMode(mode) {
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
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    const countMsg = pracIds.length > 1 ? ` (${pracIds.length} praticiens)` : '';
    gToast('Tâche créée' + countMsg, 'success');
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

  qcUpdateGradient('#F59E0B');
  const headerTitle = document.querySelector('#calCreateModal .m-client-name');
  if (headerTitle) headerTitle.textContent = 'Demande d\u2019acompte';

  const amtStr = ((booking.deposit_amount_cents || 0) / 100).toFixed(2).replace('.', ',');
  const hasEmail = !!clientEmail;
  const hasPhone = !!clientPhone;
  const safeId = String(booking.id).replace(/[^a-zA-Z0-9_-]/g, '');

  let channelBtns = '';
  if (hasEmail) {
    channelBtns += `<button class="m-btn" style="flex:1;padding:12px;border-radius:10px;border:1.5px solid #F59E0B;background:#FEF3E2;color:#B45309;font-weight:700;font-size:.88rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px" onclick="qcSendDepositRequest('${safeId}','email')">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg>
      Par email</button>`;
  }
  if (hasPhone) {
    channelBtns += `<button class="m-btn" style="flex:1;padding:12px;border-radius:10px;border:1.5px solid ${hasEmail ? 'var(--border)' : '#F59E0B'};background:${hasEmail ? 'var(--white)' : '#FEF3E2'};color:${hasEmail ? 'var(--text-3)' : '#B45309'};font-weight:700;font-size:.88rem;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px" onclick="qcSendDepositRequest('${safeId}','sms')">
      <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px"><rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
      Par SMS</button>`;
  }

  modalBody.innerHTML = `
    <div style="padding:24px;text-align:center">
      <div style="width:56px;height:56px;border-radius:16px;background:#FEF3E2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
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
      body: JSON.stringify({ channel })
    });
    if (!r.ok) {
      const d = await r.json();
      throw new Error(d.error || 'Erreur d\u2019envoi');
    }
    const channelLabel = channel === 'sms' ? 'SMS' : 'email';
    if (statusEl) {
      statusEl.innerHTML = `<div style="font-size:.88rem;color:var(--green);font-weight:700">\u2713 Demande envoy\u00e9e par ${channelLabel}</div>`;
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
