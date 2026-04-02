/**
 * Calendar Mobile - list view for mobile, day shifting.
 */
import { api, calState } from '../../state.js';
import { esc, safeId } from '../../utils/dom.js';
import { ST_LABELS, MODE_ICO, DAY_NAMES, MONTH_NAMES, toBrusselsISO } from '../../utils/format.js';
import { bridge } from '../../utils/window-bridge.js';
import { IC } from '../../utils/icons.js';

async function fcLoadMobileList() {
  if (fcLoadMobileList._busy) return;
  fcLoadMobileList._busy = true;
  try {
  const el = document.getElementById('fcMobList');
  if (!el) return;
  const ds = calState.fcMobileDate.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const from = toBrusselsISO(ds, '00:00'), to = toBrusselsISO(ds, '23:59');
  try {
    const params = new URLSearchParams({ from, to });
    if (calState.fcCurrentFilter !== 'all') params.set('practitioner_id', calState.fcCurrentFilter);
    const r = await fetch('/api/bookings?' + params.toString(), { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (!r.ok) throw new Error('Request failed');
    const d = await r.json();
    calState.fcAllBookings = d.bookings || [];
  } catch (e) { calState.fcAllBookings = []; }

  // Apply status + category visibility filters
  // For grouped bookings, keep if ANY sibling in the group matches a visible category
  const groupVisible = {};
  if (calState.fcHiddenCategories && calState.fcHiddenCategories.size > 0) {
    calState.fcAllBookings.forEach(b => {
      if (!b.group_id) return;
      const svc = calState.fcServices?.find(s => s.id === b.service_id);
      const cat = svc?.category || '';
      if (!calState.fcHiddenCategories.has(cat)) groupVisible[b.group_id] = true;
    });
  }
  const now = new Date();
  calState.fcAllBookings = calState.fcAllBookings.filter(b => {
    if (b.status === 'cancelled' && !calState.fcShowCancelled) return false;
    if (b.status === 'no_show' && !calState.fcShowNoShow) return false;
    if (b.status === 'completed' && !calState.fcShowCompleted) return false;
    if ((b.status === 'pending' || b.status === 'pending_deposit' || b.status === 'modified_pending') && !calState.fcShowPending) return false;
    // Hide expired pending bookings (start_at already passed)
    if (b.status === 'pending' && b.start_at && new Date(b.start_at) <= now) return false;
    // Hide expired pending_deposit bookings (deposit_deadline passed)
    if (b.status === 'pending_deposit' && b.deposit_deadline && new Date(b.deposit_deadline) < now) return false;
    if (calState.fcHiddenCategories && calState.fcHiddenCategories.size > 0) {
      if (b.group_id) {
        if (!groupVisible[b.group_id]) return false;
      } else {
        const svc = calState.fcServices?.find(s => s.id === b.service_id);
        const cat = svc?.category || '';
        if (calState.fcHiddenCategories.has(cat)) return false;
      }
    }
    // Search filter
    const sq = calState.calSearchQuery;
    if (sq) {
      if (!(b.client_name || '').toLowerCase().includes(sq) && !(b.client_phone || '').includes(sq) && !(b.client_email || '').toLowerCase().includes(sq)) return false;
    }
    return true;
  });

  const isToday = ds === new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
  const dayLabel = isToday ? "Aujourd'hui" : `${DAY_NAMES[calState.fcMobileDate.getDay()]} ${calState.fcMobileDate.getDate()} ${MONTH_NAMES[calState.fcMobileDate.getMonth()]}`;

  let h = `<div class="mob-list-header"><span class="mob-list-date">${dayLabel}</span><span class="mob-list-count">${calState.fcAllBookings.length} RDV</span></div>`;

  if (!calState.fcAllBookings.length) {
    h += `<div class="mob-empty"><div class="mob-empty-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg></div><div class="mob-empty-text">Aucun rendez-vous</div><div class="mob-empty-sub">${dayLabel}</div></div>`;
  } else {
    const sorted = [...calState.fcAllBookings].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    sorted.forEach(b => {
      const s = new Date(b.start_at), e = new Date(b.end_at);
      const t1 = s.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
      const dur = Math.round((e - s) / 60000);
      const prac = calState.fcPractitioners.find(p => String(p.id) === String(b.practitioner_id));
      const stLabel = esc(ST_LABELS[b.status] || b.status);
      const stClass = 'st-' + safeId(b.status);
      const badges = [
        (b.client_is_vip ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6z"/><path d="M5 16h14v4H5z"/></svg>' : ''),
        (b.internal_note ? IC.fileText : ''),
        (b.status === 'modified_pending' ? IC.alertTriangle : ''),
        (b.deposit_required && b.deposit_status !== 'paid' ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>' : ''),
        ((b.promotion_discount_cents > 0 || b.discount_pct > 0 || b.promotion_id) ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>' : ''),
        (b.locked ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>' : ''),
        (b.group_id ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>' : '')
      ].filter(Boolean);
      h += `<div class="mob-bk ${stClass}" onclick="fcOpenDetail('${safeId(b.id)}')">
        ${badges.length ? '<div class="mob-bk-badges">' + badges.map(x => '<span>' + x + '</span>').join('') + '</div>' : ''}
        <div class="mob-bk-time"><div class="t">${t1}</div><div class="dur">${dur}min</div></div>
        <div class="mob-bk-info"><div class="name">${esc(b.client_name)}</div><div class="svc">${esc(b.service_name || b.custom_label || 'RDV libre')}${b.appointment_mode && b.appointment_mode !== 'cabinet' ? ' \u00b7 ' + (MODE_ICO[b.appointment_mode] || '') : ''}</div><div class="prac"><span class="pdot" style="background:${/^#[0-9a-fA-F]{3,8}$/.test(prac?.color) ? prac.color : 'var(--primary)'}"></span>${esc(prac?.display_name || b.practitioner_name || '')}</div></div>
        <div class="mob-bk-status status-badge ${stClass}">${stLabel}</div>
      </div>`;
    });
  }
  el.innerHTML = h;
  } finally { fcLoadMobileList._busy = false; }
}

function fcMobShift(dir) {
  calState.fcMobileDate.setDate(calState.fcMobileDate.getDate() + dir);
  // Skip hidden days (e.g. weekends when calendar hides them)
  let guard = 0;
  while (calState.fcHiddenDays && calState.fcHiddenDays.includes(calState.fcMobileDate.getDay()) && guard < 7) {
    calState.fcMobileDate.setDate(calState.fcMobileDate.getDate() + dir);
    guard++;
  }
  fcLoadMobileList();
  // Sync calendar too
  calState.fcCal.gotoDate(calState.fcMobileDate);
}

function fcMobToday() {
  calState.fcMobileDate = new Date();
  let guard = 0;
  while (calState.fcHiddenDays && calState.fcHiddenDays.includes(calState.fcMobileDate.getDay()) && guard < 7) {
    calState.fcMobileDate.setDate(calState.fcMobileDate.getDate() + 1);
    guard++;
  }
  fcLoadMobileList();
  calState.fcCal.gotoDate(calState.fcMobileDate);
}

// Expose to global scope for onclick handlers
bridge({ fcMobShift, fcMobToday });

export { fcLoadMobileList, fcMobShift, fcMobToday };
