/**
 * Booking Detail - renders the booking detail modal (the largest agenda sub-module).
 */
import { api, calState, userRole, user } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRenderTodos } from './booking-todos.js';
import { fcRenderReminders } from './booking-reminders.js';
import { fcRenderNotes } from './booking-notes.js';
import { fcRenderSession } from './booking-session.js';
import '../clients.js'; // registers openClientDetail on window
import { calCheckConflict, calResetSlotCheck } from './booking-edit.js';
import { fmtSvcLabel } from './calendar-render.js';
import { fcRefresh } from './calendar-init.js';
import { guardModal, showDirtyPrompt } from '../../utils/dirty-guard.js';
import { trapFocus, releaseFocus } from '../../utils/focus-trap.js';
import { enableSwipeClose } from '../../utils/swipe-close.js';
import { IC } from '../../utils/icons.js';
import { fcIsMobile, fcIsTouch } from '../../utils/touch.js';

let _openingDetail = false;
let _countdownTimer = null;

function fmtCountdown(ms) {
  if (ms <= 0) return 'Expiré';
  const min = Math.floor(ms / 60000);
  if (min < 60) return min + 'min';
  const h = Math.floor(min / 60);
  const rm = min % 60;
  if (h < 24) return h + 'h ' + (rm > 0 ? rm + 'min' : '');
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return d + 'j ' + (rh > 0 ? rh + 'h' : '');
}
async function fcOpenDetail(bookingId) {
  if (_openingDetail) return; // Prevent concurrent opens (e.g. double-click firing twice)
  if (!bookingId || bookingId === 'undefined') return; // Guard against undefined ID
  _openingDetail = true;
  calState.fcCurrentEventId = bookingId;
  const modal = document.getElementById('calDetailModal');

  // Cleanup: clear countdown timer + remove leftover deposit banners
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
  document.querySelectorAll('.m-deposit-banner').forEach(el => el.remove());

  try {
    const r = await fetch(`/api/bookings/${bookingId}/detail`, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (!r.ok) throw new Error('RDV introuvable');
    const d = await r.json();
    calState.fcDetailData = { todos: d.todos || [], reminders: d.reminders || [], notes: d.notes || [], group_siblings: d.group_siblings || [], client_email: d.booking?.client_email };
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
    const vipTag = b.is_vip ? `<span style="font-size:.55rem;font-family:var(--sans);font-weight:800;padding:2px 7px;border-radius:5px;letter-spacing:.5px;background:var(--amber-bg);color:var(--gold);border:1px solid #F5E6A3">${IC.star} VIP</span>` : '';
    heroEl.innerHTML = `
      <div class="m-avatar" style="background:linear-gradient(135deg,${accentColor},${accentColor}CC)">${initials}</div>
      <div class="m-client-info">
        <div class="m-client-name" id="calDetailTitle">
          <a href="#" onclick="event.preventDefault();closeCalModal('calDetailModal');openClientDetail('${safeClientId}')">${esc(b.client_name || '\u2014')}</a>
          ${vipTag}
          ${freeTag}
        </div>
        <div class="m-client-meta">
          <span class="m-inline-edit" onclick="fcInlineEdit(this,'phone')">${b.client_phone ? esc(b.client_phone) : '<em style="opacity:.4">+ Tél</em>'}<svg class="gi m-edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>
          <span>\u00b7</span>
          <span class="m-inline-edit" onclick="fcInlineEdit(this,'email')">${b.client_email ? esc(b.client_email) : '<em style="opacity:.4">+ Email</em>'}<svg class="gi m-edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></span>
        </div>
      </div>
      <div class="m-quick-actions">
        ${b.client_phone ? `<a class="m-qbtn" href="tel:${encodeURIComponent(b.client_phone)}" title="Appeler" aria-label="Appeler le client"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg></a>` : ''}
        ${b.client_email ? `<a class="m-qbtn" href="mailto:${encodeURIComponent(b.client_email)}" title="Email" aria-label="Envoyer un email"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22 6 12 13 2 6"/></svg></a>` : ''}
        <button class="m-qbtn" onclick="closeCalModal('calDetailModal');openClientDetail('${safeClientId}')" title="Fiche client" aria-label="Voir la fiche client"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></button>
        ${!['cancelled','no_show','completed'].includes(b.status) && (b.client_phone || b.client_email) ? `<button class="m-qbtn" onclick="fcSendManualReminder('${safeBookingId}')" title="Envoyer un rappel" aria-label="Envoyer un rappel" id="btnManualReminder">${IC.bell}</button>` : ''}
      </div>`;

    // -- Status strip --
    const stMap = {
      pending: { bg: 'var(--gold-bg)', c: 'var(--gold)', l: 'En attente' },
      confirmed: { bg: 'var(--green-bg)', c: 'var(--green)', l: 'Confirm\u00e9' },
      modified_pending: { bg: '#FFF7ED', c: 'var(--amber)', l: 'Modifi\u00e9' },
      completed: { bg: 'var(--surface)', c: 'var(--text-4)', l: 'Termin\u00e9' },
      cancelled: { bg: 'var(--red-bg)', c: 'var(--red)', l: 'Annul\u00e9' },
      no_show: { bg: 'var(--red-bg)', c: 'var(--red)', l: 'No-show' },
      pending_deposit: { bg: 'var(--amber-bg)', c: 'var(--amber-dark)', l: 'Acompte requis' }
    };
    const st = stMap[b.status] || stMap.confirmed;
    const acts = [];
    if (b.status === 'pending') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'confirmed\')">' + IC.check + ' Confirmer</button>');
    if (b.status === 'confirmed') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'completed\')">' + IC.check + ' Termin\u00e9</button>');
    if (b.status === 'modified_pending') acts.push('<button class="m-st-btn green" onclick="fcSetStatus(\'confirmed\')">' + IC.check + ' Forcer confirmation</button>');
    if (!['cancelled', 'completed', 'modified_pending', 'pending_deposit'].includes(b.status)) {
      acts.push('<button class="m-st-btn red" onclick="fcSetStatus(\'no_show\')">' + IC.x + ' No-show</button>');
    }
    if (!['cancelled', 'completed'].includes(b.status)) {
      acts.push('<button class="m-st-btn red" onclick="fcSetStatus(\'cancelled\')">Annuler</button>');
    }
    // "Confirmer sans acompte" is in the deposit banner, no need for a status strip button
    if (['completed', 'cancelled', 'no_show'].includes(b.status)) acts.push('<button class="m-st-btn" onclick="fcSetStatus(\'confirmed\')">↩ R\u00e9tablir</button>');
    if (!fcIsMobile() && !['cancelled', 'no_show', 'completed'].includes(b.status)) {
      acts.push('<button class="m-st-btn m-st-move" onclick="fcScrollToHoraire()">\u2195 D\u00e9placer</button>');
    }
    if (!['cancelled', 'no_show'].includes(b.status)) {
      // For grouped bookings, check lock on ANY sibling (calendar shows lock if any member is locked)
      const siblings = d.group_siblings || [];
      const isLocked = !!b.locked || siblings.some(s => s.locked);
      acts.push(`<button class="m-st-btn m-st-lock${isLocked ? ' active' : ''}" onclick="fcToggleLockFromStrip()" id="mStripLockBtn" title="${isLocked ? 'Déverrouiller' : 'Verrouiller'}"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></button>`);
    }
    document.getElementById('mStatusStrip').innerHTML = `
      <span class="m-st-current" style="color:${st.c}">
        <span class="m-st-dot" style="background:${st.c}"></span>
        ${st.l}
      </span>
      <div class="m-st-actions">${acts.join('')}</div>`;

    // -- Countdown for pending confirmation --
    if (b.status === 'pending' && b.confirmation_expires_at) {
      const dlDate = new Date(b.confirmation_expires_at);
      const cdEl = document.createElement('span');
      cdEl.style.cssText = 'font-size:.72rem;font-weight:500;margin-left:8px;opacity:.8';
      const update = () => {
        const diff = dlDate - Date.now();
        cdEl.textContent = '· ' + fmtCountdown(diff);
        if (diff <= 0 && _countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
      };
      update();
      _countdownTimer = setInterval(update, 30000);
      document.querySelector('.m-st-current')?.appendChild(cdEl);
    }

    // -- Countdown for deposit deadline --
    if (b.status === 'pending_deposit' && b.deposit_deadline) {
      const dlDate = new Date(b.deposit_deadline);
      const cdEl = document.createElement('span');
      cdEl.style.cssText = 'font-size:.72rem;font-weight:500;margin-left:8px;opacity:.8';
      const update = () => {
        const diff = dlDate - Date.now();
        cdEl.textContent = '· ' + fmtCountdown(diff);
        if (diff <= 0 && _countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
      };
      update();
      _countdownTimer = setInterval(update, 30000);
      document.querySelector('.m-st-current')?.appendChild(cdEl);
    }

    // -- Pass/abonnement banner --
    if (b.deposit_payment_intent_id && b.deposit_payment_intent_id.startsWith('pass_')) {
      const passCode = b.deposit_payment_intent_id.replace('pass_', '');
      const passEl = document.createElement('div');
      passEl.className = 'm-deposit-banner';
      passEl.style.cssText = 'padding:12px 16px;margin:0 24px 12px;border-radius:10px;border:1.5px solid #86EFAC;background:var(--green-bg)';
      passEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700;color:var(--green)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Couvert par abonnement (${passCode})
      </div>`;
      document.getElementById('mStatusStrip').insertAdjacentElement('afterend', passEl);
    }

    // -- Gift card banner --
    if (b.deposit_payment_intent_id && b.deposit_payment_intent_id.startsWith('gc_')) {
      const gcCode = b.deposit_payment_intent_id.replace('gc_', '');
      const gcCents = parseInt(b.gc_paid_cents) || 0;
      const gcEl = document.createElement('div');
      gcEl.className = 'm-deposit-banner';
      gcEl.style.cssText = 'padding:12px 16px;margin:0 24px 12px;border-radius:10px;border:1.5px solid #C4B5FD;background:#F5F3FF';
      gcEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700;color:#7C3AED">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8V21"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>
        Pay\u00e9 par carte cadeau (${esc(gcCode)})${gcCents > 0 ? ' \u00b7 ' + (gcCents / 100).toFixed(2).replace('.', ',') + ' \u20ac' : ''}
      </div>`;
      document.getElementById('mStatusStrip').insertAdjacentElement('afterend', gcEl);
    } else if (!b.deposit_payment_intent_id && parseInt(b.gc_paid_cents) > 0) {
      // GC partial payment (not full coverage)
      const gcCents = parseInt(b.gc_paid_cents);
      const gcEl = document.createElement('div');
      gcEl.className = 'm-deposit-banner';
      gcEl.style.cssText = 'padding:12px 16px;margin:0 24px 12px;border-radius:10px;border:1.5px solid #C4B5FD;background:#F5F3FF';
      gcEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700;color:#7C3AED">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8V21"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>
        Carte cadeau : ${(gcCents / 100).toFixed(2).replace('.', ',')} \u20ac d\u00e9duit
      </div>`;
      document.getElementById('mStatusStrip').insertAdjacentElement('afterend', gcEl);
    }

    // -- Deposit banner --
    if (b.deposit_required) {
      const depAmt = ((b.deposit_amount_cents || 0) / 100).toFixed(2).replace(".",",");
      const depDl = b.deposit_deadline ? new Date(b.deposit_deadline).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const depPaid = b.deposit_status === 'paid';
      const depRefunded = b.deposit_status === 'refunded';
      const depKept = b.deposit_status === 'cancelled' && !!b.deposit_paid_at;
      const depWaived = b.deposit_status === 'waived';
      const isFuture = new Date(b.start_at) > new Date();
      const bizSettings = calState.fcBusinessSettings || {};
      const cancelDeadlineH = bizSettings.cancel_deadline_hours ?? 48;
      const hoursUntilRdv = (new Date(b.start_at).getTime() - Date.now()) / 3600000;
      const tooCloseForDeposit = hoursUntilRdv < cancelDeadlineH;
      const reqCount = b.deposit_request_count || 0;
      const maxResends = 3;

      let borderCol = 'var(--amber)', bgCol = 'var(--amber-bg)', textCol = 'var(--amber-dark)';
      let statusText = 'En attente';
      let extraHtml = '';

      if (depRefunded) {
        borderCol = '#60A5FA'; bgCol = '#EFF6FF'; textCol = '#1D4ED8';
        statusText = 'Remboursé';
        if (isFuture && ['confirmed', 'pending', 'modified_pending'].includes(b.status) && userRole !== 'practitioner') {
          const svcPrice = b.variant_price_cents ?? b.price_cents ?? 0;
          let defCents = bizSettings.deposit_type === 'fixed' ? (bizSettings.deposit_fixed_cents || 2500) : Math.round(svcPrice * (bizSettings.deposit_percent || 50) / 100);
          if (defCents <= 0) defCents = b.deposit_amount_cents || 2500;
          const defDlH = bizSettings.deposit_deadline_hours ?? 48;
          if (!tooCloseForDeposit) {
            extraHtml += `<div style="margin-top:8px"><button class="m-st-btn" id="mReReqDepBtn" style="font-size:.72rem;padding:4px 12px;background:#EFF6FF;color:#1D4ED8;border:1px solid #93C5FD;border-radius:6px;cursor:pointer;font-weight:600" onclick="document.getElementById('mReReqDepPanel').style.display='';this.style.display='none'">Redemander l'acompte</button></div>
              <div id="mReReqDepPanel" style="display:none;margin-top:8px;padding:10px 14px;border-radius:8px;border:1.5px solid var(--amber);background:var(--amber-bg)">
                <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
                  <div><label style="font-size:.7rem;font-weight:600;color:#92700C;display:block;margin-bottom:2px">Montant (\u20ac)</label><input type="number" id="mReqDepAmount" min="1" step="0.01" value="${(defCents / 100).toFixed(2)}" class="m-input" style="width:90px;padding:5px 8px;font-size:.8rem"></div>
                  <div><label style="font-size:.7rem;font-weight:600;color:#92700C;display:block;margin-bottom:2px">D\u00e9lai (h avant RDV)</label><input type="number" id="mReqDepDeadline" min="1" value="${defDlH}" class="m-input" style="width:70px;padding:5px 8px;font-size:.8rem"></div>
                  <div style="display:flex;gap:6px"><button class="m-st-btn green" onclick="fcRequireDeposit()">Confirmer</button><button class="m-st-btn" onclick="document.getElementById('mReReqDepPanel').style.display='none';document.getElementById('mReReqDepBtn').style.display=''">Annuler</button></div>
                </div>
              </div>`;
          } else {
            extraHtml += `<div style="margin-top:6px;font-size:.72rem;color:var(--text-3);font-style:italic">\u26a0\ufe0f Trop proche du RDV pour redemander (< ${cancelDeadlineH}h)</div>`;
          }
        }
      } else if (depWaived) {
        borderCol = '#A8A29E'; bgCol = '#F5F5F4'; textCol = '#78716C';
        statusText = 'Dispens\u00e9';
        extraHtml += `<div style="font-size:.72rem;color:#78716C;margin-top:4px">RDV confirm\u00e9 sans acompte</div>`;
      } else if (depKept) {
        borderCol = '#EF4444'; bgCol = 'var(--red-bg)'; textCol = 'var(--red)';
        statusText = 'Conserv\u00e9 (annulation tardive)';
      } else if (depPaid) {
        borderCol = '#86EFAC'; bgCol = 'var(--green-bg)'; textCol = 'var(--green)';
        statusText = 'Payé';
        if (b.deposit_paid_at) extraHtml += `<div style="font-size:.72rem;color:var(--green);margin-top:4px">Pay\u00e9 le ${new Date(b.deposit_paid_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`;
        if (isFuture) {
          extraHtml += `<div style="margin-top:8px"><button class="m-st-btn" style="font-size:.72rem;padding:4px 12px;background:var(--red-bg);color:var(--red);border:1px solid var(--red-bg);border-radius:6px;cursor:pointer;font-weight:600" onclick="fcRefundDeposit(${b.deposit_amount_cents})">Rembourser l'acompte</button></div>`;
        }
      } else {
        // -- Pending deposit: show sent status + resend controls --
        const neverSent = !b.deposit_requested_at && reqCount === 0;

        if (b.deposit_requested_at) {
          const sentDate = new Date(b.deposit_requested_at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
          extraHtml += `<div style="font-size:.72rem;color:#92700C;margin-top:4px;display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="m22 2-7 20-4-9-9-4z"/></svg>Demande envoy\u00e9e le ${sentDate}${reqCount > 1 ? ' (' + reqCount + ' envoi' + (reqCount > 1 ? 's' : '') + ')' : ''}</div>`;
        } else if (neverSent) {
          extraHtml += `<div style="font-size:.72rem;color:var(--red);margin-top:4px;display:flex;align-items:center;gap:4px">${IC.info}Demande non envoy\u00e9e</div>`;
        }
        if (depDl) extraHtml += `<div style="font-size:.72rem;color:#92700C;margin-top:2px">Deadline : ${depDl}</div>`;
        // Auto-reminder info
        if (b.deposit_reminder_sent) {
          extraHtml += `<div style="font-size:.72rem;color:#92700C;margin-top:2px;display:flex;align-items:center;gap:4px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>Relance automatique envoy\u00e9e</div>`;
        } else if (b.deposit_deadline && !neverSent) {
          const reminderDate = new Date(new Date(b.deposit_deadline).getTime() - 48 * 3600000);
          if (reminderDate > new Date()) {
            const reminderStr = reminderDate.toLocaleDateString('fr-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            extraHtml += `<div style="font-size:.72rem;color:var(--text-3);margin-top:2px;font-style:italic">Relance auto pr\u00e9vue le ${reminderStr}</div>`;
          }
        }

        // Time guard warning
        if (tooCloseForDeposit) {
          extraHtml += `<div style="margin-top:6px;font-size:.72rem;color:var(--red);background:var(--red-bg);padding:6px 10px;border-radius:6px;border:1px solid var(--red-bg)">\u26a0\ufe0f Trop proche du RDV pour envoyer une demande (moins de ${cancelDeadlineH}h avant)</div>`;
        } else if (reqCount >= maxResends) {
          extraHtml += `<div style="margin-top:6px;font-size:.72rem;color:var(--red);background:var(--red-bg);padding:6px 10px;border-radius:6px;border:1px solid var(--red-bg)">Maximum de ${maxResends} envois atteint. Contactez le client directement.</div>`;
        } else {
          extraHtml += '<div style="margin-top:8px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">';
          if (neverSent) {
            // Primary send button (first time — never sent)
            extraHtml += `<button style="display:inline-flex;align-items:center;gap:5px;font-size:.72rem;padding:5px 14px;background:var(--amber);color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-family:inherit" onclick="fcSendDepositRequest('email')"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>Envoyer la demande</button>`;
          } else {
            // Resend button (secondary — already sent at least once)
            extraHtml += `<button style="display:inline-flex;align-items:center;gap:5px;font-size:.72rem;padding:5px 12px;background:#fff;color:#92700C;border:1px solid #D6D3D1;border-radius:6px;cursor:pointer;font-weight:500;font-family:inherit" onclick="fcSendDepositRequest('email')" title="Renvoyer la demande par email"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>Renvoyer la demande</button>`;
            extraHtml += `<span style="font-size:.68rem;color:#A8A29E">${reqCount}/${maxResends}</span>`;
          }
          extraHtml += '</div>';
        }
        extraHtml += '<div id="mDepositSendStatus" style="display:none;margin-top:6px;font-size:.75rem;padding:6px 10px;border-radius:6px"></div>';
        // Waive deposit: confirm without payment
        extraHtml += `<div style="margin-top:6px;border-top:1px solid #E7E5E4;padding-top:6px"><button style="font-size:.7rem;padding:3px 10px;background:transparent;color:#78716C;border:none;cursor:pointer;font-weight:500;font-family:inherit;text-decoration:underline" onclick="fcWaiveDeposit()">Confirmer sans acompte</button></div>`;
      }

      const depEl = document.createElement('div');
      depEl.className = 'm-deposit-banner';
      depEl.style.cssText = 'padding:12px 16px;margin:0 24px 12px;border-radius:10px;border:1.5px solid ' + borderCol + ';background:' + bgCol;
      depEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700;color:${textCol}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
        Acompte : ${depAmt} \u20ac \u2014 ${statusText}
      </div>${extraHtml}`;
      document.getElementById('mStatusStrip').insertAdjacentElement('afterend', depEl);
    }

    // -- "Exiger un acompte" button for confirmed bookings without deposit --
    document.querySelectorAll('.m-require-deposit-wrap').forEach(el => el.remove());
    if (!b.deposit_required && ['pending', 'confirmed', 'modified_pending'].includes(b.status) && new Date(b.start_at) > new Date() && userRole !== 'practitioner') {
      const s = calState.fcBusinessSettings || {};
      const rdvCancelDlH = s.cancel_deadline_hours ?? 48;
      const rdvHoursLeft = (new Date(b.start_at).getTime() - Date.now()) / 3600000;
      // Only show "Exiger un acompte" if RDV is far enough away
      if (rdvHoursLeft >= rdvCancelDlH) {
        const svcPrice = b.variant_price_cents ?? b.price_cents ?? 0;
        let defaultCents = s.deposit_type === 'fixed'
          ? (s.deposit_fixed_cents || 2500)
          : Math.round(svcPrice * (s.deposit_percent || 50) / 100);
        if (defaultCents <= 0) defaultCents = 2500;
        const defaultDlHours = s.deposit_deadline_hours ?? 48;

        const wrap = document.createElement('div');
        wrap.className = 'm-require-deposit-wrap';
        wrap.style.cssText = 'padding:0 24px 8px';
        wrap.innerHTML = `<button class="m-st-btn orange" id="mReqDepBtn" onclick="document.getElementById('mReqDepPanel').style.display='';this.style.display='none'"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Exiger un acompte</button>
          <div id="mReqDepPanel" style="display:none;margin-top:8px;padding:12px 16px;border-radius:10px;border:1.5px solid var(--amber);background:var(--amber-bg)">
            <div style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
              <div><label style="font-size:.7rem;font-weight:600;color:#92700C;display:block;margin-bottom:2px">Montant (\u20ac)</label><input type="number" id="mReqDepAmount" min="1" step="0.01" value="${(defaultCents / 100).toFixed(2)}" class="m-input" style="width:90px;padding:5px 8px;font-size:.8rem"></div>
              <div><label style="font-size:.7rem;font-weight:600;color:#92700C;display:block;margin-bottom:2px">D\u00e9lai (h avant RDV)</label><input type="number" id="mReqDepDeadline" min="1" value="${defaultDlHours}" class="m-input" style="width:70px;padding:5px 8px;font-size:.8rem"></div>
              <div style="display:flex;gap:6px"><button class="m-st-btn green" onclick="fcRequireDeposit()">Confirmer</button><button class="m-st-btn" onclick="document.getElementById('mReqDepPanel').style.display='none';document.getElementById('mReqDepBtn').style.display=''">Annuler</button></div>
            </div>
          </div>`;
        document.getElementById('mStatusStrip').insertAdjacentElement('afterend', wrap);
      }
    }

    // -- Promo banner (last-minute discount) --
    document.querySelectorAll('.m-promo-banner').forEach(el => el.remove());
    if (b.discount_pct) {
      const origPrice = b.variant_price_cents ?? b.price_cents ?? 0;
      const discPrice = origPrice > 0 ? Math.round(origPrice * (100 - b.discount_pct) / 100) : 0;
      const priceHtml = origPrice > 0
        ? ' <s style="opacity:.5">' + (origPrice / 100).toFixed(2).replace(".",",") + ' €</s> → <strong>' + (discPrice / 100).toFixed(2).replace(".",",") + ' €</strong>'
        : '';
      const promoEl = document.createElement('div');
      promoEl.className = 'm-promo-banner';
      promoEl.style.cssText = 'padding:10px 16px;margin:0 24px 12px;border-radius:10px;border:1.5px solid var(--amber);background:var(--amber-bg)';
      promoEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;font-size:.85rem;font-weight:700;color:var(--amber-dark)">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2H2v10l9.29 9.29c.94.94 2.48.94 3.42 0l6.58-6.58c.94-.94.94-2.48 0-3.42L12 2Z"/><path d="M7 7h.01"/></svg>
        Dernière minute : -${b.discount_pct}%${priceHtml}
      </div>`;
      const depBanner = document.querySelector('.m-deposit-banner');
      if (depBanner) depBanner.insertAdjacentElement('afterend', promoEl);
      else document.getElementById('mStatusStrip').insertAdjacentElement('afterend', promoEl);
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
      freeCard.style.display = 'flex';
      svcCard.style.display = 'none';
      bufSec.style.display = '';
      document.getElementById('uFreeLabel').value = b.custom_label || '';
      document.getElementById('uBufBefore').value = 0;
      document.getElementById('uBufAfter').value = 0;
      // Color dot for freestyle
      let freeDot = freeCard.querySelector('.m-color-dot');
      if (!freeDot) { freeDot = document.createElement('span'); freeDot.className = 'm-color-dot'; freeDot.onclick = function(){ fcShowColorPopover(this); }; freeDot.title = 'Couleur'; freeCard.appendChild(freeDot); }
      freeDot.style.background = accentColor;
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
      const promoSib = siblings.find(sib => sib.promotion_discount_cents > 0);
      const totalPromoDisc = promoSib ? (promoSib.promotion_discount_cents || 0) : 0;
      const svcNames = siblings.map(sib => esc(fmtSvcLabel(sib.service_category, sib.service_name, sib.variant_name))).join(' + ');
      let grpPriceHtml = '';
      if (totalPrice) {
        if (totalPromoDisc > 0) {
          const discounted = totalPrice - totalPromoDisc;
          grpPriceHtml = '<div class="m-svc-price"><s style="font-size:.7rem;opacity:.5">' + (totalPrice / 100).toFixed(2).replace(".",",") + ' \u20ac</s> <span style="color:var(--green)">' + (discounted / 100).toFixed(2).replace(".",",") + ' \u20ac</span></div>';
        } else {
          grpPriceHtml = '<div class="m-svc-price">' + (totalPrice / 100).toFixed(2).replace(".",",") + ' \u20ac</div>';
        }
      }
      svcCard.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="m-svc-name">${svcNames}</div>
          <div class="m-svc-meta">${siblings.length} prestations \u00b7 ${totalDur} min</div>
        </div>
        ${grpPriceHtml}
        <span class="m-color-dot" style="background:${accentColor}" onclick="fcShowColorPopover(this)" title="Couleur"></span>`;
    } else {
      freeCard.style.display = 'none';
      bufSec.style.display = 'none';
      svcCard.style.display = 'flex';
      svcCard.style.borderLeftColor = accentColor;
      const dur = b.variant_duration_min || b.duration_min || Math.round((e - s) / 60000);
      const displayPrice = b.variant_price_cents ?? b.price_cents;
      const svcDisplayName = fmtSvcLabel(b.service_category, b.service_name, b.variant_name);
      let priceHtml = '';
      if (displayPrice) {
        if (b.discount_pct) {
          const disc = Math.round(displayPrice * (100 - b.discount_pct) / 100);
          priceHtml = '<div class="m-svc-price"><s style="font-size:.7rem;opacity:.5">' + (displayPrice / 100).toFixed(2).replace(".",",") + ' \u20ac</s> ' + (disc / 100).toFixed(2).replace(".",",") + ' \u20ac</div>';
        } else {
          priceHtml = '<div class="m-svc-price">' + (displayPrice / 100).toFixed(2).replace(".",",") + ' \u20ac</div>';
        }
      }
      const canAddSvc = !['cancelled', 'no_show'].includes(b.status) && userRole !== 'practitioner' && b.service_id;
      const convertFreeBtn = canConvert ? '<button class="m-convert-free-btn" onclick="fcStartConvert(\'to-free\')" title="Convertir en RDV libre">&times;</button>' : '';
      svcCard.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="m-svc-name">${esc(svcDisplayName)}</div>
          <div class="m-svc-meta">${dur} min${b.buffer_after_min ? ' \u00b7 buffer ' + b.buffer_after_min + ' min apr\u00e8s' : ''}</div>
        </div>
        ${priceHtml}
        <span class="m-color-dot" style="background:${accentColor}" onclick="fcShowColorPopover(this)" title="Couleur"></span>
        ${convertFreeBtn}
        ${canAddSvc ? '<button class="g-add-btn" onclick="fcStartConvert(&#39;group-add&#39;)" title="Ajouter une prestation" style="margin-left:6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>' : ''}`;
    }

    // -- Promo banner --
    const promoBanner = document.getElementById('mPromoBanner');
    if (promoBanner) {
      const promoSibs = isGroup ? (siblings || []) : [b];
      const promoSource = isGroup ? promoSibs.find(s => s.promotion_discount_cents > 0) || b : b;
      if (promoSource.promotion_discount_cents > 0 && promoSource.promotion_label) {
        // Promo takes priority — hide last-minute discount banner if present
        document.querySelectorAll('.m-promo-banner').forEach(el => el.remove());
        const origPrice = isGroup
          ? promoSibs.reduce((sum, sib) => sum + (sib.variant_price_cents ?? sib.price_cents ?? 0), 0)
          : (b.variant_price_cents ?? b.price_cents ?? 0);
        const discCents = promoSource.promotion_discount_cents;
        const reducedPrice = origPrice - discCents;
        promoBanner.style.display = '';
        promoBanner.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;border:1.5px solid var(--green);background:var(--green-bg);margin-top:8px">
            <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="var(--green)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;flex-shrink:0">
              <path d="m21.44 11.05-9.19 9.19a2 2 0 0 1-2.83 0l-6.36-6.36a2 2 0 0 1 0-2.83l9.19-9.19a2 2 0 0 1 1.42-.59H19a2 2 0 0 1 2 2v5.31a2 2 0 0 1-.59 1.42z"/>
              <line x1="7" y1="17" x2="7.01" y2="17"/>
            </svg>
            <div style="flex:1;min-width:0">
              <div style="font-size:.78rem;font-weight:600;color:var(--green)">${esc(promoSource.promotion_label)}</div>
              <div style="font-size:.72rem;color:var(--text-3)">
                ${promoSource.promotion_discount_pct ? '-' + promoSource.promotion_discount_pct + '%' : ''} &mdash;
                <s style="opacity:.5">${(origPrice / 100).toFixed(2).replace(".",",")} \u20ac</s>
                <span style="font-weight:600;color:var(--green)">${(reducedPrice / 100).toFixed(2).replace(".",",")} \u20ac</span>
                <span style="opacity:.6">(-${(discCents / 100).toFixed(2).replace(".",",")} \u20ac)</span>
              </div>
            </div>
          </div>`;
      } else {
        promoBanner.style.display = 'none';
        promoBanner.innerHTML = '';
      }
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

    // -- Booking color (hidden input for save) --
    const defaultColor = isFreestyle ? (b.practitioner_color || '#0D7377') : (b.service_color || b.practitioner_color || '#0D7377');
    const bookingColor = b.color || defaultColor;
    document.getElementById('uBookingColor').value = b.color || '';
    calState._fcDefaultColor = defaultColor;

    // -- Frozen status (used by group detach buttons and bottom bar) --
    const isFrozen = ['cancelled', 'no_show'].includes(b.status);

    // -- Group siblings (render list) --
    const groupEl = document.getElementById('mGroupSiblings');
    calState.fcGroupSiblings = siblings; // store for ungroup module
    if (isGroup) {
      const canDetach = !isFrozen && userRole !== 'practitioner';
      const addBtn = canDetach ? `<button class="g-add-btn" onclick="fcStartConvert('group-add')" title="Ajouter une prestation"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:13px;height:13px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></button>` : '';
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
          <span style="font-weight:${isCur ? '700' : '400'};flex:1;min-width:0">${esc(fmtSvcLabel(sib.service_category, sib.service_name, sib.variant_name))}</span>
          <span class="g-time">${sT} \u2013 ${eT}</span>
          ${detachBtn}${deleteBtn}
        </div>`;
      });
      gh += '</div></div>';
      groupEl.innerHTML = gh;
      initGroupDnD(groupEl);
      groupEl.style.display = 'block';
    } else { groupEl.style.display = 'none'; }

    // -- Billing section --
    const billingEl = document.getElementById('mBillingSection');
    if (billingEl && !isFreestyle) {
      const billSvcs = isGroup ? siblings : [b];
      const billTotal = billSvcs.reduce((sum, sib) => sum + (sib.variant_price_cents ?? sib.price_cents ?? 0), 0);
      const billPromoSource = isGroup ? billSvcs.find(sib => sib.promotion_discount_cents > 0) : b;
      const billPromoDisc = billPromoSource?.promotion_discount_cents || 0;
      const billPromoLabel = billPromoSource?.promotion_label || '';
      const billPromoPct = billPromoSource?.promotion_discount_pct || null;
      const billNet = billTotal - billPromoDisc;
      const billDepPaid = (b.deposit_status === 'paid' || b.deposit_status === 'waived') ? (b.deposit_amount_cents || 0) : 0;
      const billDepPending = b.deposit_status === 'pending' ? (b.deposit_amount_cents || 0) : 0;
      const billDue = billNet - billDepPaid;
      const fmtP = c => (c / 100).toFixed(2).replace('.', ',') + ' \u20ac';

      let bh = '<div class="m-sec"><div class="m-sec-head"><span class="m-sec-title"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg> Facturation</span><span class="m-sec-line"></span></div>';
      bh += '<div style="font-size:.78rem;line-height:1.8">';
      // Service lines
      billSvcs.forEach(sib => {
        const svcName = esc(fmtSvcLabel(sib.service_category, sib.service_name, sib.variant_name));
        const svcPrice = sib.variant_price_cents ?? sib.price_cents ?? 0;
        if (svcPrice > 0) {
          bh += '<div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">' + svcName + '</span><span>' + fmtP(svcPrice) + '</span></div>';
        }
      });
      // Subtotal if multiple services
      if (billSvcs.length > 1 && billTotal > 0) {
        bh += '<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-light);padding-top:4px;margin-top:2px"><span style="font-weight:600">Sous-total</span><span style="font-weight:600">' + fmtP(billTotal) + '</span></div>';
      }
      // Promo
      if (billPromoDisc > 0 && billPromoLabel) {
        bh += '<div style="display:flex;justify-content:space-between;color:var(--green)"><span>' + esc(billPromoLabel) + (billPromoPct ? ' (-' + billPromoPct + '%)' : '') + '</span><span>-' + fmtP(billPromoDisc) + '</span></div>';
      }
      // Total
      if (billTotal > 0) {
        bh += '<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-light);padding-top:4px;margin-top:2px;font-weight:700"><span>Total</span><span>' + fmtP(billNet) + '</span></div>';
      }
      // Deposit
      if (billDepPaid > 0) {
        bh += '<div style="display:flex;justify-content:space-between;color:var(--green)"><span>Acompte pay\u00e9</span><span>-' + fmtP(billDepPaid) + '</span></div>';
      }
      if (billDepPending > 0) {
        bh += '<div style="display:flex;justify-content:space-between;color:var(--amber)"><span>Acompte en attente</span><span>' + fmtP(billDepPending) + '</span></div>';
      }
      // Balance due
      if (billTotal > 0 && billDepPaid > 0) {
        const isDue = billDue > 0;
        const isSolde = billDue <= 0;
        bh += '<div style="display:flex;justify-content:space-between;border-top:1px solid var(--border-light);padding-top:4px;margin-top:2px;font-weight:700;color:' + (isSolde ? 'var(--green)' : 'var(--text)') + '"><span>' + (isSolde ? 'Sold\u00e9' : 'Reste d\u00fb') + '</span><span>' + (isSolde ? '0,00 \u20ac' : fmtP(billDue)) + '</span></div>';
      }
      bh += '</div>';
      // Create invoice button
      if (billTotal > 0 && !['cancelled', 'no_show'].includes(b.status) && userRole !== 'practitioner') {
        const invBookingId = isGroup ? (billSvcs.find(sib => sib.group_order === 0) || billSvcs[0]).id : b.id;
        bh += '<button class="m-st-btn" style="margin-top:8px;font-size:.72rem;padding:5px 14px;width:100%;justify-content:center;background:var(--surface);border:1px solid var(--border);border-radius:6px;cursor:pointer;font-weight:600;font-family:inherit" onclick="fcBillingCreateInvoice(\'' + invBookingId + '\')">' + IC.fileText + ' Cr\u00e9er la facture</button>';
      }
      bh += '</div>';
      billingEl.innerHTML = bh;
    } else if (billingEl) {
      billingEl.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-4);font-size:.82rem">Aucune prestation factur\u00e9e</div>';
    }

    // -- Horaire (use full group range if grouped) --
    const groupEndDate = isGroup ? new Date(siblings[siblings.length - 1].end_at) : e;
    const ds = s.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const stm = s.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
    const etm = groupEndDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels', hour12: false });
    document.getElementById('calEditDate').value = ds;
    document.getElementById('calEditStart').value = stm;
    document.getElementById('calEditEnd').value = etm;
    const _grpSibs = calState.fcDetailData?.group_siblings || [];
    const _effectiveLocked = !!b.locked || _grpSibs.some(s => s.locked);
    calState.fcEditOriginal = { date: ds, start: stm, end: etm, practitioner_id: b.practitioner_id, comment: b.comment_client || '', custom_label: b.custom_label || '', color: b.color || '', _swatchColor: bookingColor, client_phone: b.client_phone || '', client_email: b.client_email || '', locked: _effectiveLocked };
    const dm = Math.round((groupEndDate - s) / 60000);
    document.querySelectorAll('.m-chip').forEach(c => c.classList.toggle('active', parseInt(c.textContent) === dm || ({ '1h': 60, '1h30': 90, '2h': 120 }[c.textContent.trim()] === dm)));
    document.getElementById('calEditDiff').style.display = 'none';
    document.getElementById('calNotifyPanel').style.display = 'none';
    document.getElementById('calConflictWarn').style.display = 'none';
    const schedWarnEl = document.getElementById('calScheduleWarn');
    if (schedWarnEl) schedWarnEl.style.display = 'none';
    const poseInfoEl = document.getElementById('calPoseInfo');
    if (poseInfoEl) { poseInfoEl.style.display = 'none'; }
    // Show pose window if booking has processing_time
    const bPt = parseInt(b.processing_time) || 0;
    if (bPt > 0 && poseInfoEl) {
      const bPs = parseInt(b.processing_start) || 0;
      const bBuf = parseInt(b.buffer_before_min) || 0;
      const poseStartMs = s.getTime() + (bBuf + bPs) * 60000;
      const poseEndMs = poseStartMs + bPt * 60000;
      const fmt = d => new Date(d).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
      poseInfoEl.style.display = 'block';
      poseInfoEl.innerHTML = `\u23f3 Temps de pose : ${fmt(poseStartMs)} \u2013 ${fmt(poseEndMs)} (${bPt}min)`;
    }
    calState.fcSelectedNotifyChannel = null;
    calResetSlotCheck();
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

    // -- Client contact fields (visible inputs + hidden for inline edit) --
    document.getElementById('uClientPhone').value = b.client_phone || '';
    document.getElementById('uClientEmail').value = b.client_email || '';
    document.getElementById('uClientPhoneHidden').value = b.client_phone || '';
    document.getElementById('uClientEmailHidden').value = b.client_email || '';

    // -- Comment --
    document.getElementById('uComment').value = b.comment_client || '';

    // -- Lock toggle (hidden input + bottom bar button) --
    // For groups: locked if ANY sibling is locked (matches calendar badge logic)
    const groupSiblings = calState.fcDetailData?.group_siblings || d.group_siblings || [];
    const effectiveLocked = !!b.locked || groupSiblings.some(s => s.locked);
    document.getElementById('calLocked').value = effectiveLocked ? 'true' : 'false';
    const lockBtn = document.getElementById('mBtnLock');
    if (lockBtn) {
      lockBtn.classList.toggle('active', effectiveLocked);
      lockBtn.title = effectiveLocked ? 'Déverrouiller' : 'Verrouiller';
      lockBtn.style.display = isFrozen ? 'none' : '';
    }

    // -- Render sub-tabs --
    fcRenderTodos(); fcRenderReminders(); fcRenderNotes(); fcRenderSession(b);

    // -- Accordion state: open if content, show badges --
    const comment = b.comment_client || '';
    const todoCount = (calState.fcDetailData.todos || []).length;
    const reminderCount = (calState.fcDetailData.reminders || []).length;
    const accNote = document.getElementById('accNote');
    const accTodos = document.getElementById('accTodos');
    const accReminders = document.getElementById('accReminders');
    if (comment) accNote?.classList.add('open'); else accNote?.classList.remove('open');
    if (todoCount > 0) accTodos?.classList.add('open'); else accTodos?.classList.remove('open');
    if (reminderCount > 0) accReminders?.classList.add('open'); else accReminders?.classList.remove('open');
    const noteBadge = document.getElementById('accNoteBadge');
    if (noteBadge) { noteBadge.style.display = comment ? '' : 'none'; }
    const todosBadge = document.getElementById('accTodosBadge');
    if (todosBadge) { todosBadge.textContent = todoCount; todosBadge.style.display = todoCount > 0 ? '' : 'none'; }
    const remindersBadge = document.getElementById('accRemindersBadge');
    if (remindersBadge) { remindersBadge.textContent = reminderCount; remindersBadge.style.display = reminderCount > 0 ? '' : 'none'; }

    // -- Bottom bar: show/hide buttons based on status --
    document.getElementById('mBtnSave').style.display = isFrozen ? 'none' : '';
    document.getElementById('mBtnNotify').style.display = isFrozen ? 'none' : '';
    document.getElementById('mBtnCancel').style.display = isFrozen ? 'none' : '';
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
  if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
  modal.classList.remove('open');
}

function switchCalTab(el, tab) {
  document.querySelectorAll('#calDetailModal .m-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#calDetailModal .m-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  const panelMap = { rdv: 'calPanelRdv', billing: 'calPanelBilling', notes: 'calPanelNotes', session: 'calPanelSession', historique: 'calPanelHistorique' };
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
  confirmation_expired: 'Confirmation expir\u00e9e',
  client_cancel: 'Annul\u00e9 par le client'
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
  confirmation_expired: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
  client_cancel: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="17" y1="11" x2="22" y2="16"/><line x1="22" y1="11" x2="17" y2="16"/></svg>'
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
      return nd.amount_cents ? (nd.amount_cents / 100).toFixed(2).replace(".",",") + ' \u20ac' : '';
    case 'confirmation_expired':
      return 'Annul\u00e9 \u2014 non confirm\u00e9 par le client';
    case 'client_cancel':
      return nd.cancel_reason || '';
    default:
      return '';
  }
}

async function loadBookingHistory() {
  const el = document.getElementById('mHistoryTimeline');
  if (!el) return;
  if (!calState.fcCurrentEventId || calState.fcCurrentEventId === 'undefined') return;
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
  document.getElementById('uBookingColor').value = '';
  document.getElementById('mHeaderBg').style.background = `linear-gradient(135deg,${c} 0%,${c}AA 60%,${c}55 100%)`;
  document.querySelector('.m-avatar').style.background = `linear-gradient(135deg,${c},${c}CC)`;
  const sb = document.getElementById('mBtnSave');
  const svc = document.getElementById('mSvcCard');
  if (svc && svc.style.display !== 'none') svc.style.borderLeftColor = c;
  sb.style.background = ''; sb.style.boxShadow = '';
  document.querySelectorAll('.m-color-dot').forEach(d => d.style.background = c);
  document.querySelector('.m-color-popover')?.remove();
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

// ── Service picker helpers (shared by convert + group-add) ──

/** Return unique category names from services available to a practitioner */
function fcGetServiceCategories(pracId) {
  const svcs = calState.fcServices.filter(s => {
    if (s.is_active === false) return false;
    if (pracId && s.practitioner_ids?.length > 0)
      return s.practitioner_ids.some(pid => String(pid) === String(pracId));
    return true;
  });
  return [...new Set(svcs.map(s => s.category || ''))].filter(Boolean).sort();
}

/** Return services filtered by practitioner + optional category */
function fcGetFilteredServices(pracId, category) {
  return calState.fcServices.filter(s => {
    if (s.is_active === false) return false;
    if (pracId && s.practitioner_ids?.length > 0)
      if (!s.practitioner_ids.some(pid => String(pid) === String(pracId))) return false;
    if (category && (s.category || '') !== category) return false;
    return true;
  });
}

// ── Conversion freestyle ↔ service ──

function fcStartConvert(action) {
  calState._convertAction = action;
  const freeCard = document.getElementById('mFreeCard');
  const svcCard = document.getElementById('mSvcCard');
  const bufSec = document.getElementById('mBufferSec');
  const convertPanel = document.getElementById('mConvertSvc');

  if (action === 'to-service' || action === 'group-add') {
    if (freeCard) freeCard.style.display = 'none';
    if (svcCard && action === 'to-service') svcCard.style.display = 'none';
    if (bufSec) bufSec.style.display = 'none';
    convertPanel.style.display = '';
    const pracId = document.getElementById('uPracSelect')?.value;
    // Populate category dropdown
    const catSel = document.getElementById('mConvertCatSel');
    const cats = fcGetServiceCategories(pracId);
    catSel.innerHTML = '<option value="">\u2014 Toutes \u2014</option>' + cats.map(c =>
      `<option value="${esc(c)}">${esc(c)}</option>`
    ).join('');
    // Populate service dropdown (all categories)
    fcConvertRebuildServices(pracId, '');
    // Reset variant + info + conflict banner + button
    document.getElementById('mConvertVarWrap').style.display = 'none';
    document.getElementById('mConvertInfo').textContent = '';
    const conflictBanner = document.getElementById('mConvertConflict');
    if (conflictBanner) conflictBanner.style.display = 'none';
    const addBtn = document.getElementById('mConvertAddBtn');
    if (addBtn) { addBtn.disabled = true; addBtn.textContent = '+ Ajouter'; }
    // Store original end time for cancel
    calState._convertOrigEnd = document.getElementById('calEditEnd').value;
  } else {
    // to-free: swap service card for freestyle card
    if (svcCard) svcCard.style.display = 'none';
    if (freeCard) freeCard.style.display = 'flex';
    if (bufSec) bufSec.style.display = '';
    const b = calState.fcCurrentBooking;
    const svcName = fmtSvcLabel(b?.service_category, b?.service_name, b?.variant_name);
    document.getElementById('uFreeLabel').value = svcName;
    document.getElementById('uBufBefore').value = 0;
    document.getElementById('uBufAfter').value = 0;
    const wrap = document.getElementById('mConvertToSvcWrap');
    if (wrap) wrap.innerHTML = '<button class="m-link-btn" onclick="fcStartConvert(\'to-service\')" style="font-size:.72rem;color:var(--primary)">Assigner une prestation</button>';
  }
}

/** Build "duration · price" label — variant-range-aware */
function svcDurPriceLabel(svc) {
  const vars = svc?.variants || [];
  const vDurs = vars.map(v => v.duration_min).filter(d => d > 0);
  const vPrices = vars.map(v => v.price_cents).filter(p => p > 0);
  let dur, price = '';
  if (vDurs.length > 0) {
    const mn = Math.min(...vDurs), mx = Math.max(...vDurs);
    dur = mn === mx ? mn + ' min' : mn + '\u2013' + mx + ' min';
  } else {
    dur = (svc?.duration_min || 0) + ' min';
  }
  if (vPrices.length > 0) {
    const mn = Math.min(...vPrices) / 100, mx = Math.max(...vPrices) / 100;
    price = mn === mx ? mn + '\u20ac' : mn + '\u2013' + mx + '\u20ac';
  } else if (svc?.price_cents) {
    price = (svc.price_cents / 100).toFixed(2).replace('.',',') + '\u20ac';
  }
  return dur + (price ? ' \u00b7 ' + price : '');
}

/** Rebuild service dropdown for convert panel */
function fcConvertRebuildServices(pracId, category) {
  const services = fcGetFilteredServices(pracId, category);
  const sel = document.getElementById('mConvertSvcSel');
  sel.innerHTML = '<option value="">\u2014 Choisir \u2014</option>' + services.map(s =>
    `<option value="${s.id}" data-dur="${s.duration_min}" data-buf-before="${s.buffer_before_min||0}" data-buf-after="${s.buffer_after_min||0}">${esc(s.name)} (${svcDurPriceLabel(s)})</option>`
  ).join('');
}

/** Category changed → rebuild service dropdown */
function fcConvertCatChanged() {
  const cat = document.getElementById('mConvertCatSel')?.value || '';
  const pracId = document.getElementById('uPracSelect')?.value;
  fcConvertRebuildServices(pracId, cat);
  // Reset variant + info + button
  document.getElementById('mConvertVarWrap').style.display = 'none';
  document.getElementById('mConvertVarSel').innerHTML = '';
  document.getElementById('mConvertInfo').textContent = '';
  fcConvertUpdateAddBtn();
}

function fcConvertSvcChanged() {
  const sel = document.getElementById('mConvertSvcSel');
  const varWrap = document.getElementById('mConvertVarWrap');
  const varSel = document.getElementById('mConvertVarSel');
  const info = document.getElementById('mConvertInfo');
  const svcId = sel.value;
  if (!svcId) { varWrap.style.display = 'none'; info.textContent = ''; return; }
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
  // Show info line (duration + price) — service-level values (variant overrides in fcConvertUpdateInfo)
  fcConvertUpdateInfo();
  fcConvertUpdateAddBtn();
  // Recalculate end time from service duration
  fcConvertRecalcEnd();
}

/** Update the info line with the correct duration + price (variant-aware) */
function fcConvertUpdateInfo() {
  const sel = document.getElementById('mConvertSvcSel');
  const varSel = document.getElementById('mConvertVarSel');
  const info = document.getElementById('mConvertInfo');
  const svcId = sel?.value;
  if (!svcId) { info.textContent = ''; return; }
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  // If a variant is selected, use variant's duration + price
  const varOpt = varSel?.selectedOptions?.[0];
  const varId = varOpt?.value;
  if (varId) {
    const variant = svc?.variants?.find(v => String(v.id) === String(varId));
    const dur = variant?.duration_min || parseInt(varOpt.dataset.dur) || 0;
    const price = variant?.price_cents ?? parseInt(varOpt.dataset.price) ?? 0;
    info.textContent = dur + ' min' + (price ? ' \u00b7 ' + (price / 100).toFixed(2).replace('.',',') + '\u20ac' : '');
  } else {
    // No variant selected — show range if service has variants, else service-level values
    info.textContent = svcDurPriceLabel(svc);
  }
}

/** Enable/disable the Ajouter button based on selection state */
function fcConvertUpdateAddBtn() {
  const btn = document.getElementById('mConvertAddBtn');
  if (!btn) return;
  const svcId = document.getElementById('mConvertSvcSel')?.value;
  if (!svcId) { btn.disabled = true; return; }
  const svc = calState.fcServices.find(s => String(s.id) === String(svcId));
  const hasVariants = (svc?.variants || []).length > 0;
  const varSelected = !!document.getElementById('mConvertVarSel')?.value;
  btn.disabled = hasVariants && !varSelected;
}

function fcConvertVarChanged() {
  fcConvertUpdateInfo();
  fcConvertUpdateAddBtn();
  fcConvertRecalcEnd();
}

function fcConvertRecalcEnd() {
  // In group-add mode, the new service chains after the last sibling — don't modify calEditEnd
  if (calState._convertAction === 'group-add') return;
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
  const conflictBanner = document.getElementById('mConvertConflict');
  if (conflictBanner) conflictBanner.style.display = 'none';
  const b = calState.fcCurrentBooking;
  const isFreestyle = !b?.service_name;
  if (isFreestyle) {
    document.getElementById('mFreeCard').style.display = 'flex';
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

// ── Direct add: send to server immediately ──

/** Send the selected service/variant directly to the server */
async function fcConvertDirectAdd(force) {
  const btn = document.getElementById('mConvertAddBtn');
  const svcId = document.getElementById('mConvertSvcSel')?.value;
  const varId = document.getElementById('mConvertVarSel')?.value || null;
  if (!svcId) return;

  // Disable + spinner
  if (btn) { btn.disabled = true; btn.textContent = 'En cours\u2026'; }
  const conflictEl = document.getElementById('mConvertConflict');
  if (conflictEl) conflictEl.style.display = 'none';

  const bookingId = calState.fcCurrentEventId;
  try {
    if (calState._convertAction === 'to-service') {
      // Freestyle → service conversion via PATCH /edit
      const r = await fetch(`/api/bookings/${bookingId}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ service_id: svcId, service_variant_id: varId })
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Erreur conversion'); }
    } else {
      // group-add: POST /group-add
      const body = { service_id: svcId, variant_id: varId };
      if (force) body.force = true;
      const r = await fetch(`/api/bookings/${bookingId}/group-add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify(body)
      });

      if (r.status === 409) {
        // Conflict → show alert banner with force option
        const d = await r.json().catch(() => ({}));
        if (conflictEl) {
          conflictEl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:16px;height:16px;flex-shrink:0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
            + '<span style="flex:1">' + esc(d.error || 'Conflit horaire d\u00e9tect\u00e9') + '</span>'
            + '<button class="m-convert-conflict-force" onclick="fcConvertDirectAdd(true)">Ajouter quand m\u00eame</button>';
          conflictEl.style.display = 'flex';
        }
        if (btn) { btn.disabled = false; btn.textContent = '+ Ajouter'; }
        return; // Wait for user decision
      }
      if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Erreur ajout'); }
    }

    // Success → toast, close panel, refresh modal without closing
    gToast('Prestation ajout\u00e9e', 'success');
    calState._convertAction = null;
    document.getElementById('mConvertSvc').style.display = 'none';
    // Restore card visibility
    const b = calState.fcCurrentBooking;
    if (!b?.service_name) {
      document.getElementById('mFreeCard').style.display = 'flex';
      document.getElementById('mBufferSec').style.display = '';
    } else {
      document.getElementById('mSvcCard').style.display = 'flex';
    }
    fcRefresh();
    await fcOpenDetail(bookingId);
  } catch (e) {
    gToast('Erreur : ' + e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '+ Ajouter'; }
  }
}

// ── Mobile reschedule: scroll to time picker ──
function fcScrollToHoraire() {
  const sec = document.getElementById('calEditStart')?.closest('.m-sec');
  if (!sec) return;
  sec.scrollIntoView({ behavior: 'smooth', block: 'center' });
  sec.classList.add('m-sec-highlight');
  setTimeout(() => sec.classList.remove('m-sec-highlight'), 1500);
  setTimeout(() => {
    document.getElementById('calEditStart')?.focus();
    document.getElementById('calEditStart')?.click();
  }, 400);
}

async function fcToggleLockFromStrip() {
  const locked = await _toggleLockAndSave();
  if (locked === null) return;
  const btn = document.getElementById('mStripLockBtn');
  if (btn) {
    btn.classList.toggle('active', locked);
    btn.title = locked ? 'Déverrouiller' : 'Verrouiller';
    btn.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 ${locked ? '10 0v4' : '9.9 0 1 1 2.1 1.4'}"/></svg>`;
  }
  const bottomBtn = document.getElementById('mBtnLock');
  if (bottomBtn) { bottomBtn.classList.toggle('active', locked); bottomBtn.title = locked ? 'Déverrouiller' : 'Verrouiller'; }
}

// ── Accordion toggle ──
function fcToggleAccordion(id) {
  const acc = document.getElementById(id);
  if (acc) acc.classList.toggle('open');
}

// ── Lock toggle from bottom bar ──
async function fcToggleLockFromBottom() {
  const locked = await _toggleLockAndSave();
  if (locked === null) return;
  const btn = document.getElementById('mBtnLock');
  if (btn) { btn.classList.toggle('active', locked); btn.title = locked ? 'Déverrouiller' : 'Verrouiller'; }
  const stripBtn = document.getElementById('mStripLockBtn');
  if (stripBtn) {
    stripBtn.classList.toggle('active', locked);
    stripBtn.title = locked ? 'Déverrouiller' : 'Verrouiller';
    stripBtn.innerHTML = `<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 ${locked ? '10 0v4' : '9.9 0 1 1 2.1 1.4'}"/></svg>`;
  }
}

/**
 * Shared lock toggle: PATCH to API immediately + refresh calendar.
 * Returns the new locked state, or null on error.
 */
async function _toggleLockAndSave() {
  const hidden = document.getElementById('calLocked');
  const wasLocked = hidden?.value === 'true';
  const locked = !wasLocked;
  const bookingId = calState.fcCurrentEventId;
  if (!bookingId) return null;
  try {
    // Lock/unlock this booking
    const r = await fetch(`/api/bookings/${bookingId}/edit`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ locked })
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Erreur'); }
    // For grouped bookings, lock/unlock ALL siblings too
    const siblings = calState.fcDetailData?.group_siblings || [];
    for (const sib of siblings) {
      if (sib.id === bookingId) continue;
      await fetch(`/api/bookings/${sib.id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
        body: JSON.stringify({ locked })
      }).catch(() => {});
    }
    if (hidden) hidden.value = locked ? 'true' : 'false';
    if (calState.fcEditOriginal) calState.fcEditOriginal.locked = locked;
    if (calState.fcCurrentBooking) calState.fcCurrentBooking.locked = locked;
    gToast(locked ? 'RDV verrouillé' : 'RDV déverrouillé', 'success');
    fcRefresh();
    return locked;
  } catch (e) {
    gToast('Erreur: ' + e.message, 'error');
    return null;
  }
}

// ── Color popover ──
const CSW_COLORS = ['#1E3A8A','#B91C1C','#059669','#EA580C','#7C3AED','#DB2777','#0EA5A4','#374151'];

function fcShowColorPopover(dotEl) {
  const existing = document.querySelector('.m-color-popover');
  if (existing) { existing.remove(); return; }
  const pop = document.createElement('div');
  pop.className = 'm-color-popover open';
  const cur = document.getElementById('uBookingColor')?.value || '';
  pop.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">${CSW_COLORS.map(c => `<span style="width:28px;height:28px;border-radius:50%;background:${c};cursor:pointer;border:2.5px solid ${c === cur ? 'var(--text)' : 'transparent'};transition:all .15s;display:inline-block" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform=''" onclick="fcPickColor('${c}')"></span>`).join('')}</div><button class="m-color-reset" onclick="fcResetBookingColor()">R\u00e9initialiser</button>`;
  const card = dotEl.closest('.m-svc-card,.m-free-card');
  if (card) { card.style.position = 'relative'; card.appendChild(pop); }
  setTimeout(() => {
    const closer = e => { if (!pop.contains(e.target) && e.target !== dotEl) { pop.remove(); document.removeEventListener('click', closer); } };
    document.addEventListener('click', closer);
  }, 10);
}

function fcPickColor(color) {
  document.getElementById('uBookingColor').value = color;
  document.getElementById('mHeaderBg').style.background = `linear-gradient(135deg,${color} 0%,${color}AA 60%,${color}55 100%)`;
  document.querySelector('.m-avatar').style.background = `linear-gradient(135deg,${color},${color}CC)`;
  const sb = document.getElementById('mBtnSave');
  sb.style.background = color; sb.style.boxShadow = `0 2px 8px ${color}40`;
  const svc = document.getElementById('mSvcCard');
  if (svc && svc.style.display !== 'none') svc.style.borderLeftColor = color;
  document.querySelectorAll('.m-color-dot').forEach(d => d.style.background = color);
  document.querySelector('.m-color-popover')?.remove();
}

// ── Inline edit (phone/email in header) ──
function fcInlineEdit(span, field) {
  const inputId = field === 'phone' ? 'uClientPhoneHidden' : 'uClientEmailHidden';
  const hidden = document.getElementById(inputId);
  const currentVal = hidden?.value || '';
  const input = document.createElement('input');
  input.className = 'm-inline-input';
  input.type = field === 'email' ? 'email' : 'tel';
  input.value = currentVal;
  input.placeholder = field === 'phone' ? '+32 / +33 ...' : 'email@exemple.com';
  const origHTML = span.innerHTML;
  span.innerHTML = '';
  span.appendChild(input);
  span.onclick = null;
  input.focus();
  input.select();
  const editIcon = '<svg class="gi m-edit-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>';
  const commit = () => {
    const v = input.value.trim();
    if (hidden) hidden.value = v;
    span.innerHTML = v ? esc(v) + editIcon : '<em style="opacity:.4">+ ' + (field === 'phone' ? 'T\u00e9l' : 'Email') + '</em>' + editIcon;
    span.onclick = function() { fcInlineEdit(this, field); };
  };
  let committed = false;
  input.addEventListener('blur', () => { if (!committed) { committed = true; commit(); } });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); committed = true; commit(); }
    if (e.key === 'Escape') { if (hidden) hidden.value = currentVal; span.innerHTML = origHTML; span.onclick = function() { fcInlineEdit(this, field); }; committed = true; }
  });
}

async function fcSendManualReminder(bookingId) {
  const btn = document.getElementById('btnManualReminder');
  if (btn) { btn.disabled = true; btn.style.opacity = '.5'; }
  try {
    const r = await fetch(`/api/bookings/${bookingId}/send-reminder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ channel: 'both' })
    });
    if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'Erreur'); }
    const d = await r.json();
    const parts = [];
    if (d.sms === 'sent') parts.push('SMS');
    if (d.email === 'sent') parts.push('Email');
    gToast(parts.length ? `Rappel envoyé (${parts.join(' + ')})` : 'Rappel envoyé', 'success');
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { if (btn) { btn.disabled = false; btn.style.opacity = ''; } }
}

async function fcBillingCreateInvoice(bookingId) {
  closeCalModal('calDetailModal');
  try {
    const mod = await import('../invoices.js');
    mod.createInvoiceFromBooking(bookingId);
  } catch (e) {
    // Fallback: if module already loaded via bridge
    if (typeof window.createInvoiceFromBooking === 'function') {
      window.createInvoiceFromBooking(bookingId);
    } else {
      const { gToast } = await import('../../utils/dom.js');
      gToast('Erreur lors de la cr\u00e9ation de la facture', 'error');
    }
  }
}

// Expose to global scope for onclick handlers
bridge({ fcOpenDetail, closeCalModal, switchCalTab, fcResetBookingColor, fcBillingCreateInvoice,
         fcStartConvert, fcConvertCatChanged, fcConvertSvcChanged, fcConvertVarChanged, fcCancelConvert,
         fcConvertDirectAdd, fcSendManualReminder,
         fcGetServiceCategories, fcGetFilteredServices, svcDurPriceLabel,
         fcScrollToHoraire, fcToggleLockFromStrip, fcToggleAccordion,
         fcToggleLockFromBottom, fcShowColorPopover, fcPickColor, fcInlineEdit });

export { fcOpenDetail, closeCalModal, switchCalTab };
