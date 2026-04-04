/**
 * Booking Edit - duration chips, conflict detection, edit diff display.
 */
import { api, calState } from '../../state.js';
import { esc } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { toBrusselsISO } from '../../utils/format.js';
import { IC } from '../../utils/icons.js';

// ── Server slot check state ──
let _slotTimer = null;
let _slotAbort = null;
let _serverSlotUnavailable = false;

/**
 * Compute difference in minutes between two "HH:MM" time strings.
 */
function fcTimeDiffMin(s, e) {
  const [sh, sm] = s.split(':').map(Number);
  const [eh, em] = e.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function calSetDuration(min, el) {
  document.querySelectorAll('.m-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  const sv = document.getElementById('calEditStart').value;
  if (!sv) return;
  const [h, m] = sv.split(':').map(Number), em = h * 60 + m + min;
  document.getElementById('calEditEnd').value = String(Math.floor(em / 60)).padStart(2, '0') + ':' + String(em % 60).padStart(2, '0');
  fcUpdateEditDiff();
  calCheckConflict();
}

/**
 * Called when the user changes the start time.
 * Auto-adjusts end time to preserve the original duration.
 */
function calOnStartChange() {
  const ns = document.getElementById('calEditStart').value;
  const ne = document.getElementById('calEditEnd').value;
  if (!ns || !ne || !calState.fcEditOriginal) return;

  // Compute original duration (from the booking as it was when modal opened)
  const origDur = fcTimeDiffMin(calState.fcEditOriginal.start, calState.fcEditOriginal.end);
  if (origDur <= 0) return;

  // Auto-adjust end = new start + original duration
  const [h, m] = ns.split(':').map(Number);
  const endMin = h * 60 + m + origDur;
  const newEnd = String(Math.floor(endMin / 60)).padStart(2, '0') + ':' + String(endMin % 60).padStart(2, '0');
  document.getElementById('calEditEnd').value = newEnd;

  fcUpdateEditDiff();
  calCheckConflict();
}

/**
 * Live conflict detection in the booking detail modal.
 * Phase 1: instant client-side check (calendar events in memory).
 * Phase 2: debounced server-side check (authoritative, 500ms).
 */
function calCheckConflict() {
  const warn = document.getElementById('calConflictWarn');
  if (!warn || !calState.fcCal || !calState.fcCurrentBooking) return;
  const nd = document.getElementById('calEditDate').value;
  const ns = document.getElementById('calEditStart').value;
  const ne = document.getElementById('calEditEnd').value;
  if (!nd || !ns || !ne) { warn.style.display = 'none'; _setSlotAvailable(); return; }

  const newStart = new Date(nd + 'T' + ns);
  const newEnd = new Date(nd + 'T' + ne);
  // Use the practitioner currently selected in the dropdown, not the original
  const pracSel = document.getElementById('uPracSelect');
  const pracId = pracSel ? pracSel.value : calState.fcCurrentBooking.practitioner_id;
  const myId = calState.fcCurrentEventId;
  const myGroup = calState.fcCurrentBooking.group_id;

  // ── Phase 1: Client-side check (instant) ──
  const conflicts = [];
  const poseOptimized = [];
  const myPt = parseInt(calState.fcCurrentBooking.processing_time) || 0;
  const myPs = parseInt(calState.fcCurrentBooking.processing_start) || 0;
  const myBuf = parseInt(calState.fcCurrentBooking.buffer_before_min) || 0;
  for (const ev of calState.fcCal.getEvents()) {
    if (ev.id === myId) continue;
    if (myGroup && ev.extendedProps?._groupId === myGroup) continue;
    if (String(ev.extendedProps?.practitioner_id) !== String(pracId)) continue;
    const st = ev.extendedProps?.status;
    if (st === 'cancelled' || st === 'no_show') continue;
    if (newStart < ev.end && newEnd > ev.start) {
      // Forward: current booking fits inside existing event's pose
      const pt = parseInt(ev.extendedProps?.processing_time) || 0;
      if (pt > 0) {
        const ps = parseInt(ev.extendedProps?.processing_start) || 0;
        const buf = parseInt(ev.extendedProps?.buffer_before_min) || 0;
        const poseStart = new Date(ev.start.getTime() + (buf + ps) * 60000);
        const poseEnd = new Date(ev.start.getTime() + (buf + ps + pt) * 60000);
        if (newStart >= poseStart && newEnd <= poseEnd) continue;
      }
      const name = ev.extendedProps?.client_name || ev.title || 'RDV';
      const time = ev.start.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }) + ' \u2013 ' + ev.end.toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
      // Reverse: existing event fits inside current booking's pose
      if (myPt > 0) {
        const myPoseStart = new Date(newStart.getTime() + (myBuf + myPs) * 60000);
        const myPoseEnd = new Date(newStart.getTime() + (myBuf + myPs + myPt) * 60000);
        if (ev.start >= myPoseStart && ev.end <= myPoseEnd) {
          poseOptimized.push(`<strong>${esc(name)}</strong> (${time})`);
          continue;
        }
      }
      conflicts.push(`<strong>${esc(name)}</strong> (${time})`);
    }
  }

  if (conflicts.length === 0) {
    warn.style.display = 'none';
  } else {
    const isInfo = calState.fcAllowOverlap;
    warn.style.display = 'block';
    warn.style.background = isInfo ? 'var(--orange-bg)' : 'var(--red-bg)';
    warn.style.color = isInfo ? 'var(--orange)' : 'var(--red)';
    warn.innerHTML = (isInfo
      ? IC.alertTriangle + ' Chevauchement avec '
      : IC.alertTriangle + ' Conflit avec '
    ) + conflicts.join(', ');
  }

  // Pose optimization info
  const poseInfo = document.getElementById('calPoseInfo');
  if (poseOptimized.length > 0 && poseInfo) {
    const poseStartMs = newStart.getTime() + (myBuf + myPs) * 60000;
    const poseEndMs = poseStartMs + myPt * 60000;
    const fmt = d => new Date(d).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
    poseInfo.style.display = 'block';
    poseInfo.innerHTML = `\u23f3 Temps de pose (${fmt(poseStartMs)}\u2013${fmt(poseEndMs)}) optimis\u00e9 : ${poseOptimized.join(', ')}`;
  } else if (poseInfo) {
    poseInfo.style.display = 'none';
  }

  // ── Schedule restriction check (service available_schedule) ──
  const schedWarn = document.getElementById('calScheduleWarn');
  if (schedWarn) {
    const svcId = calState.fcCurrentBooking?.service_id;
    const svc = svcId && calState.fcServices?.find(s => String(s.id) === String(svcId));
    if (svc?.available_schedule?.type === 'restricted') {
      const jsDay = newStart.getDay(); // 0=Sun
      const weekday = jsDay === 0 ? 6 : jsDay - 1; // 0=Mon..6=Sun
      const svcWindows = (svc.available_schedule.windows || []).filter(w => w.day === weekday);
      const startMin = newStart.getHours() * 60 + newStart.getMinutes();
      const endMin = newEnd.getHours() * 60 + newEnd.getMinutes();
      const _tm = t => { const p = String(t).split(':'); return parseInt(p[0]) * 60 + parseInt(p[1]); };
      const fits = svcWindows.some(w => startMin >= _tm(w.from) && endMin <= _tm(w.to));
      if (!fits) {
        const windowsStr = svcWindows.length > 0
          ? svcWindows.map(w => w.from + '\u2013' + w.to).join(', ')
          : 'aucun cr\u00e9neau ce jour';
        schedWarn.style.display = 'block';
        schedWarn.innerHTML = '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Cette prestation est restreinte : ' + windowsStr;
      } else {
        schedWarn.style.display = 'none';
      }
    } else {
      schedWarn.style.display = 'none';
    }
  }

  // ── Phase 2: Debounced server-side check ──
  _scheduleServerCheck(nd, ns, ne, pracId);
}

// ── Server-side slot check (debounced) ──
function _scheduleServerCheck(nd, ns, ne, pracId) {
  if (_slotTimer) clearTimeout(_slotTimer);
  if (_slotAbort) _slotAbort.abort();

  _slotTimer = setTimeout(async () => {
    const warn = document.getElementById('calConflictWarn');
    const bookingId = calState.fcCurrentEventId;
    if (!bookingId || !warn) return;

    // Show checking indicator
    if (warn.style.display === 'none') {
      warn.style.display = 'block';
      warn.style.background = '#F5F5F5';
      warn.style.color = 'var(--text-3)';
      warn.innerHTML = '<span class="slot-checking"><span class="ga-spinner" style="display:inline-block;vertical-align:middle;margin-right:6px;width:12px;height:12px"></span>V\u00e9rification...</span>';
    } else if (!warn.querySelector('.slot-checking')) {
      warn.innerHTML += '<br><span class="slot-checking"><span class="ga-spinner" style="display:inline-block;vertical-align:middle;margin-right:6px;width:12px;height:12px"></span>V\u00e9rification...</span>';
    }

    const controller = new AbortController();
    _slotAbort = controller;

    try {
      const start_at = toBrusselsISO(nd, ns);
      const end_at = toBrusselsISO(nd, ne);
      const params = new URLSearchParams({ start_at, end_at, practitioner_id: pracId });

      const r = await fetch(`/api/bookings/${bookingId}/check-slot?${params}`, {
        headers: { 'Authorization': 'Bearer ' + api.getToken() },
        signal: controller.signal
      });
      if (!r.ok) throw new Error('Erreur serveur');
      const data = await r.json();

      // Remove checking indicator
      const checkEl = warn.querySelector('.slot-checking');
      if (checkEl) checkEl.remove();
      warn.innerHTML = warn.innerHTML.replace(/<br>\s*$/, '');

      if (!data.available) {
        _setSlotUnavailable();
        const conflictNames = (data.conflicts || []).map(c => {
          const s = new Date(c.start_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
          const e = new Date(c.end_at).toLocaleTimeString('fr-BE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' });
          return `<strong>${c.service_name || 'RDV'}</strong> (${s} \u2013 ${e})`;
        }).join(', ');
        warn.style.display = 'block';
        warn.style.background = 'var(--red-bg)';
        warn.style.color = 'var(--red)';
        warn.innerHTML = IC.alertTriangle + ' Cr\u00e9neau indisponible \u2014 conflit avec ' + conflictNames;
      } else {
        _setSlotAvailable();
        if (!warn.innerHTML.trim()) warn.style.display = 'none';
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      // Network error: graceful degradation — don't block save
      const checkEl = warn.querySelector('.slot-checking');
      if (checkEl) checkEl.remove();
      warn.innerHTML = warn.innerHTML.replace(/<br>\s*$/, '');
      if (!warn.innerHTML.trim()) warn.style.display = 'none';
      _setSlotAvailable();
    }
  }, 500);
}

// ── Save button state ──
function _setSlotUnavailable() {
  _serverSlotUnavailable = true;
  const btn = document.getElementById('mBtnSave');
  if (btn) { btn.disabled = true; btn.title = 'Cr\u00e9neau indisponible'; }
}

function _setSlotAvailable() {
  _serverSlotUnavailable = false;
  const btn = document.getElementById('mBtnSave');
  if (btn) { btn.disabled = false; btn.title = ''; }
}

function calResetSlotCheck() {
  if (_slotTimer) clearTimeout(_slotTimer);
  if (_slotAbort) _slotAbort.abort();
  _setSlotAvailable();
}

function fcUpdateEditDiff() {
  const nd = document.getElementById('calEditDate').value;
  const ns = document.getElementById('calEditStart').value;
  const ne = document.getElementById('calEditEnd').value;
  const d = document.getElementById('calEditDiff');
  const ch = nd !== calState.fcEditOriginal.date || ns !== calState.fcEditOriginal.start || ne !== calState.fcEditOriginal.end;
  if (!ch) { d.style.display = 'none'; return; }
  let p = [];
  if (nd !== calState.fcEditOriginal.date) p.push(`Date: ${calState.fcEditOriginal.date} \u2192 ${nd}`);
  if (ns !== calState.fcEditOriginal.start || ne !== calState.fcEditOriginal.end) p.push(`Horaire: ${calState.fcEditOriginal.start}\u2013${calState.fcEditOriginal.end} \u2192 ${ns}\u2013${ne}`);
  const od = fcTimeDiffMin(calState.fcEditOriginal.start, calState.fcEditOriginal.end), nw = fcTimeDiffMin(ns, ne);
  if (od !== nw) p.push(`Dur\u00e9e: ${od} min \u2192 ${nw} min`);
  d.innerHTML = p.map(x => {
    const [l, v] = x.split(': '), vs = v.split(' \u2192 ');
    return `<div style="margin-bottom:4px"><span style="font-size:.72rem;font-weight:600;color:var(--text-3)">${l}:</span> <span class="diff diff-old">${vs[0]}</span> <span class="diff-arrow">\u2192</span> <span class="diff diff-new">${vs[1]}</span></div>`;
  }).join('');
  d.style.display = 'block';
}

// Expose to global scope for onclick handlers
bridge({ calSetDuration, calCheckConflict, fcUpdateEditDiff, calOnStartChange });

export { calSetDuration, calCheckConflict, fcUpdateEditDiff, fcTimeDiffMin, _serverSlotUnavailable, calResetSlotCheck };
