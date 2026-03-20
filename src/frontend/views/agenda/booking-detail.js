/**
 * Booking Detail - renders the booking detail modal (the largest agenda sub-module).
 */
import { api, calState, userRole, user } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRenderTodos } from './booking-todos.js';
import { fcRenderReminders } from './booking-reminders.js';
import { cswHTML, cswSelect } from './color-swatches.js';
import '../whiteboards.js'; // registers openWhiteboard on window
import '../clients.js'; // registers openClientDetail on window
import { calCheckConflict } from './booking-edit.js';
import { guardModal, showDirtyPrompt } from '../../utils/dirty-guard.js';
import { trapFocus, releaseFocus } from '../../utils/focus-trap.js';
import { enableSwipeClose } from '../../utils/swipe-close.js';
import { IC } from '../../utils/icons.js';

let _openingDetail = false;
async function fcOpenDetail(bookingId) {
  if (_openingDetail) return; // Prevent concurrent opens (e.g. double-click firing twice)
  _openingDetail = true;
  calState.fcCurrentEventId = bookingId;
  const modal = document.getElementById('calDetailModal');

  // Cleanup: remove any leftover deposit banners from previous opens
  document.querySelectorAll('.m-deposit-banner').forEach(el => el.remove());

  try {
    const r = await fetch(`/api/bookings/${bookingId}/detail`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (!r.ok) throw new Error('RDV introuvable');
    const d = await r.json();
    calState.fcDetailData = { todos: d.todos || [], reminders: d.reminders || [] };
    const b = d.booking;
    calState.fcCurrentBooking = b;
    const isFreestyle = !b.service_name;
    const s = new Date(b.start_at), e = new Date(b.end_at);

    // -- Color: same priority as calendar-events.js --
    // Detail endpoint returns b.* so field is "color", not "booking_color"
    const rawAccent = isFreestyle
      ? (b.color || b.practitioner_color || '#0D7377')
      : (b.color || b.service_color || b.practitioner_color || '#0D7377');
    const accentColor = /^#[0-9a-fA-F]{3,8}$/.test(rawAccent) ? rawAccent : '#0D7377';

    // -- Header gradient --
    const hdrBg = document.getElementById('mHeaderBg');
    hdrBg.style.background = `linear-gradient(135deg,${accentColor} 0%,${accentColor}AA 60%,${accentColor}55 100%)`;

    // -- Client hero --
    // Sanitize IDs for safe injection into onclick handlers
    const safeClientId = String(b.client_id).replace(/[^a-zA-Z0-9_-]/g, '');
    const safeBookingId = String(b.id).replace(/[^a-zA-Z0-9_-]/g, '');
    const initials = (b.client_name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const heroEl = document.getElementById('mClientHero');
    const freeTag = isFreestyle ? `<span class="m-free-tag" style="background:${accentColor}18;color:${accentColor}"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg> LIBRE</span>` : '';
    heroEl.innerHTML = `
      <div class="m-avatar" style="background:linear-gradient(135deg,${accentColor},${accentColor}CC)">${initials}</div>
      <div class="m-client-info">
        <div class="m-client-name" id="calDetailTitle">
          <a href="#" onclick="event.preventDefault();closeCalModal('calDetailModal');openClientDetail('${safeClientId}')">${esc(b.client_name || '\u2014')}</a>
          ${freeTag}
        </div>
        <div class="m-client-meta">
          ${b.client_phone ? `<a href="tel:${encodeURIComponent(b.client_phone)}">${esc(b.client_phone)}</a>` : ''}
          ${b.client_phone && b.client_email ? '<span>\u00b7</span>' : ''}
          ${b.client_email ? `<a href="mailto:${encodeURIComponent(b.client_email)}">${esc(b.client_email)}</a>` : ''}
        </div>
      </div>
      <div class="m-quick-actions">
        ${b.client_phone ? `<a class="m-qbtn" href="tel:${encodeURIComponent(b.client_phone)}" title="Appeler" aria-label="Appeler le client"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>` : ''}
        ${b.client_email ? `<a class="m-qbtn" href="mailto:${encodeURIComponent(b.client_email)}" title="Email" aria-label="Envoyer un email"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg></a>` : ''}
        <button class="m-qbtn" onclick="closeCalModal('calDetailModal');openClientDetail('${safeClientId}')" title="Fiche client" aria-label="Voir la fiche client"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>
        <button class="m-qbtn" onclick="openWhiteboard('${safeBookingId}','${safeClientId}')" title="Whiteboard" aria-label="Ouvrir le whiteboard" style="border-color:var(--primary);background:var(--primary-light)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0D7377" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="M15 5l4 4"/></svg></button>
      </div>`;

    // -- Status strip --
    const stMap = {
      pending: { bg: 'var(--gold-bg)', c: 'var(--gold)', l: 'En attente' },
      confirmed: { bg: 'var(--green-bg)', c: 'var(--green)', l: 'Confirm\u00e9' },
      modified_pending: { bg: '#FFF7ED', c: '#D97706', l: 'Modifi\u00e9' },
      completed: { bg: 'var(--surface)', c: 'var(--text-4)', l: 'Termin\u00e9' },
      cancelled: { bg: 'var(--red-bg)', c: 'var(--red)', l: 'Annul\u00e9' },
      no_show: { bg: 'var(--red-bg)', c: 'var(--red)', l: 'No-show' },
      pending_deposit: { bg: '#FEF3E2', c: '#B45309', l: 'Acompte requis' }
    };
    const st = stMap[b.status] || stMap.confirmed;
    const acts = [];
    if (b.status === 'pending') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'confirmed\')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Confirmer</button>');
    if (b.status === 'confirmed') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'completed\')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Termin\u00e9</button>');
    if (b.status === 'modified_pending') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'confirmed\')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Forcer confirmation</button>');
    if (!['cancelled', 'completed'].includes(b.status)) {
      acts.push('<button class="m-st-btn red" onclick="fcSetStatus(\'no_show\')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> No-show</button>');
      acts.push('<button class="m-st-btn red" onclick="fcSetStatus(\'cancelled\')">Annuler</button>');
    }
    if (b.status === 'pending_deposit') acts.push('<button class="m-st-btn green" onclick="fcMarkDepositPaid()"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg> Marquer pay\u00e9</button>');
    if (['completed', 'cancelled', 'no_show'].includes(b.status)) acts.push('<button class="m-st-btn" onclick="fcSetStatus(\'confirmed\')">↩ R\u00e9tablir</button>');
    document.getElementById('mStatusStrip').innerHTML = `
      <span class="m-st-current" style="background:${st.bg};color:${st.c}">
        <span class="m-st-dot" style="background:${st.c}"></span>
        ${st.l}
      </span>
      <div class="m-st-actions">${acts.join('')}</div>`;

    // -- Deposit banner --
    if (b.deposit_required) {
      const depAmt = ((b.deposit_amount_cents || 0) / 100).toFixed(2);
      const depDl = b.deposit_deadline ? new Date(b.deposit_deadline).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const depPaid = b.deposit_status === 'paid';
      const depRefunded = b.deposit_status === 'refunded';
      const depKept = b.deposit_status === 'cancelled';
      const isFuture = new Date(b.start_at) > new Date();

      let borderCol = '#F59E0B', bgCol = '#FEF3E2', textCol = '#B45309';
      let statusText = 'En attente';
      let extraHtml = '';

      if (depRefunded) {
        borderCol = '#60A5FA'; bgCol = '#EFF6FF'; textCol = '#1D4ED8';
        statusText = 'Remboursé';
      } else if (depKept) {
        borderCol = '#EF4444'; bgCol = '#FEF2F2'; textCol = '#DC2626';
        statusText = 'Conserv\u00e9 (annulation tardive)';
      } else if (depPaid) {
        borderCol = '#86EFAC'; bgCol = '#F0FDF4'; textCol = '#15803D';
        statusText = 'Payé';
        if (b.deposit_paid_at) extraHtml += `<div style="font-size:.72rem;color:#15803D;margin-top:4px">Pay\u00e9 le ${new Date(b.deposit_paid_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`;
        if (isFuture) {
          extraHtml += `<div style="margin-top:8px"><button class="m-st-btn" style="font-size:.72rem;padding:4px 12px;background:#FEF2F2;color:#DC2626;border:1px solid #FECACA;border-radius:6px;cursor:pointer;font-weight:600" onclick="fcRefundDeposit(${b.deposit_amount_cents})">Rembourser l'acompte</button></div>`;
        }
      } else {
        if (depDl) extraHtml += `<div style="font-size:.72rem;color:#92700C;margin-top:4px">Deadline : ${depDl}</div>`;
      }

      const depEl = document.createElement('div');
      depEl.className = 'm-deposit-banner';
      depEl.style.cssText = 'padding:12px 16px;margin:0 24px 12px;border-radius:10px;border:1.5px solid ' + borderCol + ';background:' + bgCol;
      depEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700;color:${textCol}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Acompte : ${depAmt} EUR \u2014 ${statusText}
      </div>${extraHtml}`;
      document.getElementById('mStatusStrip').insertAdjacentElement('afterend', depEl);
    }

    // -- Group siblings (fetched early for service card + horaire) --
    const siblings = d.group_siblings || [];
    const isGroup = siblings.length > 1;

    // -- Freestyle vs Normal cards --
    const freeCard = document.getElementById('mFreeCard');
    const svcCard = document.getElementById('mSvcCard');
    const bufSec = document.getElementById('mBufferSec');
    const canConvert = !isGroup && !['cancelled', 'no_show', 'completed'].includes(b.status) && userRole !== 'practitioner';
    document.getElementById('mConvertSvc').style.display = 'none';
    calState._convertAction = null;

    if (isFreestyle) {
      freeCard.style.display = 'block';
      svcCard.style.display = 'none';
      bufSec.style.display = '';
      document.getElementById('uFreeLabel').value = b.custom_label || '';
      document.getElementById('uBufBefore').value = 0;
      document.getElementById('uBufAfter').value = 0;
      // "Assign service" link
      const wrap = document.getElementById('mConvertToSvcWrap');
      if (wrap) wrap.innerHTML = canConvert ? '<button class="m-link-btn" onclick="fcStartConvert(\'to-service\')" style="font-size:.72rem;color:var(--primary)">Assigner une prestation</button>' : '';
    } else if (isGroup) {
      // Group booking: show all services summary
      freeCard.style.display = 'none';
      bufSec.style.display = 'none';
      svcCard.style.display = 'flex';
      svcCard.style.borderLeftColor = accentColor;
      const groupStart = new Date(siblings[0].start_at);
      const groupEnd = new Date(siblings[siblings.length - 1].end_at);
      const totalDur = Math.round((groupEnd - groupStart) / 60000);
      const totalPrice = siblings.reduce((sum, sib) => sum + (sib.variant_price_cents ?? sib.price_cents ?? 0), 0);
      const svcNames = siblings.map(sib => { const nm = sib.service_name || 'RDV libre'; return esc(sib.variant_name ? nm + ' \u2014 ' + sib.variant_name : nm); }).join(' + ');
      svcCard.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="m-svc-name">${svcNames}</div>
          <div class="m-svc-meta">${siblings.length} prestations \u00b7 ${totalDur} min</div>
        </div>
        ${totalPrice ? '<div class="m-svc-price">' + (totalPrice / 100).toFixed(2) + '\u20ac</div>' : ''}`;
    } else {
      freeCard.style.display = 'none';
      bufSec.style.display = 'none';
      svcCard.style.display = 'flex';
      svcCard.style.borderLeftColor = accentColor;
      const dur = b.variant_duration_min || b.duration_min || Math.round((e - s) / 60000);
      const displayPrice = b.variant_price_cents ?? b.price_cents;
      const svcDisplayName = b.variant_name ? b.service_name + ' \u2014 ' + b.variant_name : b.service_name;
      const canAddSvc = !['cancelled', 'no_show'].includes(b.status) && userRole !== 'practitioner' && b.service_id;
      const convertFreeBtn = canConvert ? '<button class="m-convert-free-btn" onclick="fcStartConvert(\'to-free\')" title="Convertir en RDV libre">&times;</button>' : '';
      svcCard.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="m-svc-name">${esc(svcDisplayName)}</div>
          <div class="m-svc-meta">${dur} min${b.buffer_after_min ? ' \u00b7 buffer ' + b.buffer_after_min + ' min apr\u00e8s' : ''}</div>
        </div>
        ${displayPrice ? '<div class="m-svc-price">' + (displayPrice / 100).toFixed(2) + '\u20ac</div>' : ''}
        ${convertFreeBtn}
        ${canAddSvc ? '<button class="g-add-btn" onclick="fcShowGroupAddPanel()" title="Ajouter une prestation" style="margin-left:6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' : ''}`;
    }

    // -- Save button color (custom or freestyle = accent color) --
    const saveBtn = document.getElementById('mBtnSave');
    if (b.color || isFreestyle) {
      saveBtn.style.background = accentColor;
      saveBtn.style.boxShadow = `0 2px 8px ${accentColor}40`;
    } else {
      saveBtn.style.background = '';
      saveBtn.style.boxShadow = '';
    }

    // -- Booking color swatch (all types) --
    const defaultColor = isFreestyle ? (b.practitioner_color || '#0D7377') : (b.service_color || b.practitioner_color || '#0D7377');
    const bookingColor = b.color || defaultColor;
    document.getElementById('uBookingColorWrap').innerHTML = cswHTML('uBookingColor', bookingColor, true);
    document.getElementById('mColorReset').style.display = b.color ? '' : 'none';
    calState._fcDefaultColor = defaultColor; // store for reset
    document.getElementById('uBookingColor').onchange = function () {
      const c = this.value;
      document.getElementById('mHeaderBg').style.background = `linear-gradient(135deg,${c} 0%,${c}AA 60%,${c}55 100%)`;
      document.querySelector('.m-avatar').style.background = `linear-gradient(135deg,${c},${c}CC)`;
      saveBtn.style.background = c; saveBtn.style.boxShadow = `0 2px 8px ${c}40`;
      if (svcCard.style.display !== 'none') svcCard.style.borderLeftColor = c;
      document.getElementById('mColorReset').style.display = '';
    };

    // -- Frozen status (used by group detach buttons and bottom bar) --
    const isFrozen = ['cancelled', 'no_show'].includes(b.status);

    // -- Group siblings (render list) --
    const groupEl = document.getElementById('mGroupSiblings');
    calState.fcGroupSiblings = siblings; // store for ungroup module
    if (isGroup) {
      const canDetach = !isFrozen && userRole !== 'practitioner';
      const addBtn = canDetach ? `<button class="g-add-btn" onclick="fcShowGroupAddPanel()" title="Ajouter une prestation"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>` : '';
      let gh = `<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Groupe (${siblings.length} prestations)</span>${addBtn}<span class="m-sec-line"></span></div><div style="display:flex;flex-direction:column;gap:3px">`;
      siblings.forEach((sib, sibIdx) => {
        const isCur = String(sib.id) === String(bookingId);
        const sT = new Date(sib.start_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
        const eT = new Date(sib.end_at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
        const safeSibColor = /^#[0-9a-fA-F]{3,6}$/.test(sib.service_color) ? sib.service_color : '#ccc';
        const sibFrozen = ['cancelled', 'no_show'].includes(sib.status);
        const canDrag = canDetach && !sibFrozen;
        const detachBtn = (canDetach && !sibFrozen) ? `<button class="g-detach-btn" onclick="fcShowUngroupPanel('${sib.id}')" title="Détacher du groupe"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><path d="m7 11 2 2 4-4"/><line x1="4" y1="4" x2="20" y2="20"/><line x1="4" y1="20" x2="20" y2="4"/></svg></button>` : '';
        const safeSibName = (sib.service_name || 'RDV libre').replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const deleteBtn = canDetach ? `<button class="g-delete-btn" onclick="fcRemoveFromGroup('${sib.id}','${safeSibName}')" title="Supprimer du groupe"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>` : '';
        gh += `<div class="m-group-item${isCur ? ' current' : ''}" data-sib-id="${sib.id}"${canDrag ? ' data-draggable="true"' : ''}>
          <span class="g-dot" style="background:${safeSibColor}"></span>
          <span style="font-weight:${isCur ? '700' : '400'};flex:1;min-width:0">${esc(sib.variant_name ? (sib.service_name||'RDV libre')+' \u2014 '+sib.variant_name : (sib.service_name || 'RDV libre'))}</span>
          <span class="g-time">${sT} \u2013 ${eT}</span>
          ${detachBtn}${deleteBtn}
        </div>`;
      });
      gh += '</div></div>';
      groupEl.innerHTML = gh;
      initGroupDnD(groupEl);
      groupEl.style.display = 'block';
    } else { groupEl.style.display = 'none'; }

    // -- Horaire (use full group range if grouped) --
    const groupEndDate = isGroup ? new Date(siblings[siblings.length - 1].end_at) : e;
    const ds = s.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const stm = s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
    const etm = groupEndDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
    document.getElementById('calEditDate').value = ds;
    document.getElementById('calEditStart').value = stm;
    document.getElementById('calEditEnd').value = etm;
    calState.fcEditOriginal = { date: ds, start: stm, end: etm, practitioner_id: b.practitioner_id, comment: b.comment_client || '', custom_label: b.custom_label || '', color: b.color || '', _swatchColor: bookingColor, client_phone: b.client_phone || '', client_email: b.client_email || '', locked: !!b.locked };
    const dm = Math.round((groupEndDate - s) / 60000);
    document.querySelectorAll('.m-chip').forEach(c => c.classList.toggle('active', parseInt(c.textContent) === dm || ({ '1h': 60, '1h30': 90, '2h': 120 }[c.textContent.trim()] === dm)));
    document.getElementById('calEditDiff').style.display = 'none';
    document.getElementById('calNotifyPanel').style.display = 'none';
    document.getElementById('calConflictWarn').style.display = 'none';
    calState.fcSelectedNotifyChannel = null;
    // Check conflicts with current time (in case it already overlaps)
    setTimeout(calCheckConflict, 50);

    // -- Praticien dropdown with color dot --
    const pracSel = document.getElementById('uPracSelect');
    pracSel.innerHTML = calState.fcPractitioners.map(p => `<option value="${p.id}"${String(p.id) === String(b.practitioner_id) ? ' selected' : ''}>${esc(p.display_name)}</option>`).join('');
    // Practitioners cannot reassign to others
    pracSel.disabled = (userRole === 'practitioner');
    const curPrac = calState.fcPractitioners.find(p => String(p.id) === String(b.practitioner_id));
    document.getElementById('mPracDot').style.background = curPrac?.color || 'var(--primary)';
    pracSel.onchange = function () {
      const sel = calState.fcPractitioners.find(p => String(p.id) === this.value);
      document.getElementById('mPracDot').style.background = sel?.color || 'var(--primary)';
      calCheckConflict(); // Re-check conflicts against the new practitioner
    };

    // -- Client contact fields --
    document.getElementById('uClientPhone').value = b.client_phone || '';
    document.getElementById('uClientEmail').value = b.client_email || '';

    // -- Comment --
    document.getElementById('uComment').value = b.comment_client || '';

    // -- Lock toggle --
    document.getElementById('calLocked').checked = !!b.locked;
    document.getElementById('mLockSec').style.display = isFrozen ? 'none' : '';

    // -- Render sub-tabs --
    fcRenderTodos(); fcRenderReminders();

    // -- Bottom bar: show/hide buttons based on status --
    document.getElementById('mBtnSave').style.display = isFrozen ? 'none' : '';
    document.getElementById('mBtnNotify').style.display = isFrozen ? 'none' : '';
    document.getElementById('mBtnCancel').style.display = isFrozen ? 'none' : '';
    // Only owners/managers can permanently delete
    document.getElementById('mBtnPurge').style.display = (isFrozen && userRole !== 'practitioner') ? '' : 'none';

    // -- Dirty guard (warn on close if unsaved changes) --
    guardModal(modal, { noBackdropClose: true });

    // -- Show modal --
    switchCalTab(document.querySelector('.m-tab[data-tab="rdv"]'), 'rdv');
    modal.classList.add('open');
    trapFocus(modal, () => closeCalModal('calDetailModal'));
    enableSwipeClose(modal.querySelector('.m-dialog'), () => closeCalModal('calDetailModal'));
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { _openingDetail = false; }
}

async function closeCalModal(id) {
  const modal = document.getElementById(id);
  // Check dirty guard before closing
  if (modal._dirtyGuard?.isDirty()) {
    const leave = await showDirtyPrompt(modal.querySelector('.m-dialog') || modal);
    if (!leave) return;
  }
  modal._dirtyGuard?.destroy();
  releaseFocus();
  modal.classList.remove('open');
}

function switchCalTab(el, tab) {
  document.querySelectorAll('#calDetailModal .m-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#calDetailModal .m-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const panelMap = { rdv: 'calPanelRdv', historique: 'calPanelHistorique' };
  document.getElementById(panelMap[tab])?.classList.add('active');
  // Lazy-load history when tab is first opened
  if (tab === 'historique') loadBookingHistory();
}

// ── History tab rendering ──
const ACTION_LABELS = {
  create: 'Cr\u00e9\u00e9', move: 'D\u00e9plac\u00e9', modify: 'Horaire modifi\u00e9',
  resize: 'Dur\u00e9e modifi\u00e9e', edit: 'Modifi\u00e9', status_change: 'Statut chang\u00e9',
  group_move: 'Groupe d\u00e9plac\u00e9', deposit_refund: 'Acompte rembours\u00e9',
  ungroup: 'D\u00e9tach\u00e9 du groupe',
  group_remove: 'Supprim\u00e9 du groupe',
  group_reorder: 'Groupe r\u00e9ordonn\u00e9',
  confirmation_expired: 'Confirmation expir\u00e9e'
};
const ACTION_ICONS = {
  create: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>',
  move: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><polyline points="15 19 12 22 9 19"/><polyline points="19 9 22 12 19 15"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="2" x2="12" y2="22"/></svg>',
  modify: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  resize: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15V6"/><path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></svg>',
  edit: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>',
  status_change: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  group_move: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  deposit_refund: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  ungroup: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="4" x2="20" y2="20"/><line x1="4" y1="20" x2="20" y2="4"/></svg>',
  group_remove: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  group_reorder: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>',
  confirmation_expired: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
};
const STATUS_MAP = {
  pending: 'En attente', confirmed: 'Confirm\u00e9', completed: 'Termin\u00e9',
  cancelled: 'Annul\u00e9', no_show: 'Absent', modified_pending: 'Modifi\u00e9', pending_deposit: 'Acompte requis'
};

function fmtHistoryTime(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

function fmtTimeOnly(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  return d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' +
    d.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
}

function fmtMoveRange(oldIso, newIso) {
  if (!oldIso || !newIso) return `${fmtTimeOnly(oldIso)} \u2192 ${fmtTimeOnly(newIso)}`;
  const od = new Date(oldIso), nd = new Date(newIso);
  const sameDay = od.toDateString() === nd.toDateString();
  if (sameDay) return `${fmtTimeOnly(oldIso)} \u2192 ${fmtTimeOnly(newIso)}`;
  return `${fmtDateTime(oldIso)} \u2192 ${fmtDateTime(newIso)}`;
}

function historyDetail(entry) {
  const { action, old_data, new_data } = entry;
  const od = old_data || {}, nd = new_data || {};
  switch (action) {
    case 'move':
    case 'modify':
    case 'group_move':
      return fmtMoveRange(od.start_at || od.original_start, nd.start_at || nd.new_start);
    case 'resize': {
      if (od.end_at && nd.end_at) {
        const oldDur = od.end_at && calState.fcCurrentBooking?.start_at
          ? Math.round((new Date(od.end_at) - new Date(calState.fcCurrentBooking.start_at)) / 60000) : '?';
        const newDur = nd.end_at && calState.fcCurrentBooking?.start_at
          ? Math.round((new Date(nd.end_at) - new Date(calState.fcCurrentBooking.start_at)) / 60000) : '?';
        return `${oldDur} min \u2192 ${newDur} min`;
      }
      return '';
    }
    case 'status_change':
      return `${STATUS_MAP[od.status] || od.status || '?'} \u2192 ${STATUS_MAP[nd.status] || nd.status || '?'}`;
    case 'edit': {
      const fields = [];
      if (nd.practitioner_id && nd.practitioner_id !== od.practitioner_id) fields.push('praticien');
      if (nd.comment !== undefined) fields.push('note');
      if (nd.custom_label !== undefined) fields.push('intitul\u00e9');
      if (nd.color !== undefined) fields.push('couleur');
      return fields.length > 0 ? fields.join(', ') : '';
    }
    case 'deposit_refund':
      return nd.amount_cents ? (nd.amount_cents / 100).toFixed(2) + '\u20ac' : '';
    case 'confirmation_expired':
      return 'Annul\u00e9 \u2014 non confirm\u00e9 par le client';
    default:
      return '';
  }
}

async function loadBookingHistory() {
  const el = document.getElementById('mHistoryTimeline');
  if (!el) return;
  el.innerHTML = '<div class="m-empty" style="padding:20px;opacity:.6">Chargement...</div>';
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/history`, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error('Erreur');
    const { history } = await r.json();
    if (!history || history.length === 0) {
      el.innerHTML = '<div class="m-empty"><div class="m-empty-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:24px;height:24px"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>Aucun historique</div>';
      return;
    }
    el.innerHTML = history.map(entry => {
      const icon = ACTION_ICONS[entry.action] || ACTION_ICONS.edit;
      const label = ACTION_LABELS[entry.action] || entry.action;
      const detail = historyDetail(entry);
      const actor = entry.actor_name || 'Syst\u00e8me';
      const time = fmtHistoryTime(entry.created_at);
      return `<div style="display:flex;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:0 0 28px;height:28px;border-radius:50%;background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--text-3);font-size:.7rem">${icon}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:.82rem;font-weight:600;color:var(--text)">${esc(label)}</div>
          ${detail ? `<div style="font-size:.75rem;color:var(--text-3);margin-top:2px">${esc(detail)}</div>` : ''}
          <div style="font-size:.7rem;color:var(--text-4);margin-top:3px">${esc(actor)} \u00b7 ${time}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    el.innerHTML = '<div class="m-empty" style="color:var(--red)">Erreur de chargement</div>';
  }
}

function fcResetBookingColor() {
  const c = calState._fcDefaultColor || '#0D7377';
  cswSelect('uBookingColor', c);
  document.getElementById('mHeaderBg').style.background = `linear-gradient(135deg,${c} 0%,${c}AA 60%,${c}55 100%)`;
  document.querySelector('.m-avatar').style.background = `linear-gradient(135deg,${c},${c}CC)`;
  const sb = document.getElementById('mBtnSave');
  const svc = document.getElementById('mSvcCard');
  if (svc && svc.style.display !== 'none') svc.style.borderLeftColor = c;
  sb.style.background = ''; sb.style.boxShadow = '';
  document.getElementById('mColorReset').style.display = 'none';
  // Mark as "no custom color" — save will send color: null
  document.getElementById('uBookingColor').value = '';
}

// Touch-friendly drag & drop reorder for group siblings
function initGroupDnD(container) {
  const list = container.querySelector('[style*="flex-direction:column"]');
  if (!list) return;
  let dragEl, clone, dropLine, timer, startY, offY, active = false;
  const getY = e => (e.touches ? e.touches[0] : e).clientY;

  const begin = () => {
    active = true;
    const r = dragEl.getBoundingClientRect();
    offY = startY - r.top;
    clone = dragEl.cloneNode(true);
    clone.className = 'g-drag-clone' + (dragEl.classList.contains('current') ? ' current' : '');
    clone.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;z-index:999;pointer-events:none`;
    document.body.appendChild(clone);
    dragEl.classList.add('g-dragging');
    dropLine = document.createElement('div');
    dropLine.className = 'g-drop-line';
    if (navigator.vibrate) navigator.vibrate(30);
  };

  const move = e => {
    if (!active) {
      if (timer && Math.abs(getY(e) - startY) > 15) { clearTimeout(timer); timer = null; }
      return;
    }
    e.preventDefault();
    const y = getY(e);
    clone.style.top = (y - offY) + 'px';
    const items = [...list.querySelectorAll('.m-group-item:not(.g-dragging)')];
    let ref = null;
    for (const it of items) {
      const box = it.getBoundingClientRect();
      if (y < box.top + box.height / 2) { ref = it; break; }
    }
    dropLine.remove();
    if (ref) ref.before(dropLine); else if (items.length) items[items.length - 1].after(dropLine);
  };

  const end = async () => {
    clearTimeout(timer); timer = null;
    if (!active) return;
    active = false;
    if (dropLine.parentNode) dropLine.before(dragEl);
    clone.remove(); dropLine.remove();
    dragEl.classList.remove('g-dragging');
    const newIds = [...list.querySelectorAll('.m-group-item')].map(el => el.dataset.sibId);
    const oldIds = calState.fcGroupSiblings.map(s => s.id);
    dragEl = null;
    if (newIds.join() === oldIds.join()) return;
    try {
      const r = await fetch(`/api/bookings/${newIds[0]}/reorder-group`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ ordered_ids: newIds })
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Erreur');
      gToast('Ordre mis \u00e0 jour', 'success');
      fcOpenDetail(calState.fcCurrentEventId);
      if (calState.fcCal) calState.fcCal.refetchEvents();
    } catch (err) { gToast(err.message, 'error'); fcOpenDetail(calState.fcCurrentEventId); }
  };

  const cancel = () => {
    clearTimeout(timer);
    if (active) { clone?.remove(); dropLine?.remove(); dragEl?.classList.remove('g-dragging'); active = false; }
  };

  list.querySelectorAll('.m-group-item[data-draggable]').forEach(item => {
    const down = e => {
      if (e.target.closest('button')) return;
      dragEl = item; startY = getY(e);
      timer = setTimeout(begin, 250);
    };
    item.addEventListener('touchstart', down, { passive: true });
    item.addEventListener('mousedown', down);
  });

  list.addEventListener('touchmove', move, { passive: false });
  list.addEventListener('mousemove', move);
  list.addEventListener('touchend', end);
  list.addEventListener('mouseup', end);
  list.addEventListener('touchcancel', cancel);
}

// ── Conversion freestyle ↔ service ──

function fcStartConvert(action) {
  calState._convertAction = action;
  const freeCard = document.getElementById('mFreeCard');
  const svcCard = document.getElementById('mSvcCard');
  const bufSec = document.getElementById('mBufferSec');
  const convertPanel = document.getElementById('mConvertSvc');

  if (action === 'to-service') {
    freeCard.style.display = 'none';
    bufSec.style.display = 'none';
    convertPanel.style.display = '';
    // Populate service dropdown filtered by current practitioner
    const pracId = document.getElementById('uPracSelect')?.value;
    const services = calState.fcServices.filter(s => {
      if (s.is_active === false) return false;
      if (pracId && s.practitioner_ids?.length > 0) return s.practitioner_ids.some(pid => String(pid) === String(pracId));
      return true;
    });
    const sel = document.getElementById('mConvertSvcSel');
    sel.innerHTML = '<option value="">\u2014 Choisir \u2014</option>' + services.map(s =>
      `<option value="${s.id}" data-dur="${s.duration_min}" data-buf-before="${s.buffer_before_min||0}" data-buf-after="${s.buffer_after_min||0}">${esc(s.name)} (${s.duration_min} min${s.price_cents ? ' \u00b7 '+(s.price_cents/100).toFixed(0)+'\u20ac' : ''})</option>`
    ).join('');
    document.getElementById('mConvertVarSel').style.display = 'none';
    // Store original end time for cancel
    calState._convertOrigEnd = document.getElementById('calEditEnd').value;
  } else {
    // to-free: swap service card for freestyle card
    svcCard.style.display = 'none';
    freeCard.style.display = 'block';
    bufSec.style.display = '';
    // Pre-fill label with service name
    const b = calState.fcCurrentBooking;
    const svcName = b?.variant_name ? b.service_name + ' \u2014 ' + b.variant_name : (b?.service_name || '');
    document.getElementById('uFreeLabel').value = svcName;
    document.getElementById('uBufBefore').value = 0;
    document.getElementById('uBufAfter').value = 0;
    // Hide the assign button in freeCard
    const wrap = document.getElementById('mConvertToSvcWrap');
    if (wrap) wrap.innerHTML = '';
  }
}

function fcConvertSvcChanged() {
  const sel = document.getElementById('mConvertSvcSel');
  const varSel = document.getElementById('mConvertVarSel');
  const svcId = sel.value;
  if (!svcId) { varSel.style.display = 'none'; return; }
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  const variants = svc?.variants || [];
  if (variants.length > 0) {
    varSel.innerHTML = '<option value="">\u2014 Variante \u2014</option>' + variants.map(v =>
      `<option value="${v.id}" data-dur="${v.duration_min}">${esc(v.name)} (${v.duration_min} min${v.price_cents ? ' \u00b7 '+(v.price_cents/100).toFixed(0)+'\u20ac' : ''})</option>`
    ).join('');
    varSel.style.display = '';
  } else {
    varSel.innerHTML = '';
    varSel.style.display = 'none';
  }
  // Recalculate end time from service duration
  fcConvertRecalcEnd();
}

function fcConvertVarChanged() {
  fcConvertRecalcEnd();
}

function fcConvertRecalcEnd() {
  const sel = document.getElementById('mConvertSvcSel');
  const varSel = document.getElementById('mConvertVarSel');
  const opt = sel.selectedOptions[0];
  if (!opt || !opt.value) return;
  const svc = calState.fcServices.find(s => String(s.id) === String(opt.value));
  let dur = parseInt(opt.dataset.dur) || 0;
  const bufBefore = parseInt(opt.dataset.bufBefore) || 0;
  const bufAfter = parseInt(opt.dataset.bufAfter) || 0;
  // Override with variant duration if selected
  if (varSel.value && varSel.selectedOptions[0]) {
    dur = parseInt(varSel.selectedOptions[0].dataset.dur) || dur;
  }
  const total = bufBefore + dur + bufAfter;
  const sv = document.getElementById('calEditStart').value;
  if (!sv || !total) return;
  const [h, m] = sv.split(':').map(Number);
  const endMin = h * 60 + m + total;
  document.getElementById('calEditEnd').value = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
}

function fcCancelConvert() {
  calState._convertAction = null;
  document.getElementById('mConvertSvc').style.display = 'none';
  const b = calState.fcCurrentBooking;
  const isFreestyle = !b?.service_name;
  if (isFreestyle) {
    document.getElementById('mFreeCard').style.display = 'block';
    document.getElementById('mBufferSec').style.display = '';
  } else {
    document.getElementById('mSvcCard').style.display = 'flex';
  }
  // Restore original end time
  if (calState._convertOrigEnd) {
    document.getElementById('calEditEnd').value = calState._convertOrigEnd;
    calState._convertOrigEnd = null;
  }
}

// Expose to global scope for onclick handlers
bridge({ fcOpenDetail, closeCalModal, switchCalTab, fcResetBookingColor,
         fcStartConvert, fcConvertSvcChanged, fcConvertVarChanged, fcCancelConvert });

export { fcOpenDetail, closeCalModal, switchCalTab };
