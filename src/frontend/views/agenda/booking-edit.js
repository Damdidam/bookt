/**
 * Booking Edit - duration chips, conflict detection, edit diff display.
 */
import { calState } from '../../state.js';
import { bridge } from '../../utils/window-bridge.js';

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
 * Live conflict detection in the booking detail modal.
 * Scans calendar events for the same practitioner on the same day.
 */
function calCheckConflict() {
  const warn = document.getElementById('calConflictWarn');
  if (!warn || !calState.fcCal || !calState.fcCurrentBooking) return;
  const nd = document.getElementById('calEditDate').value;
  const ns = document.getElementById('calEditStart').value;
  const ne = document.getElementById('calEditEnd').value;
  if (!nd || !ns || !ne) { warn.style.display = 'none'; return; }

  const newStart = new Date(nd + 'T' + ns);
  const newEnd = new Date(nd + 'T' + ne);
  const pracId = calState.fcCurrentBooking.practitioner_id;
  const myId = calState.fcCurrentEventId;
  const myGroup = calState.fcCurrentBooking.group_id;

  // Scan calendar events for this practitioner on this day
  const conflicts = [];
  for (const ev of calState.fcCal.getEvents()) {
    if (ev.id === myId) continue;
    // Skip group container that contains this booking
    if (myGroup && ev.extendedProps?._groupId === myGroup) continue;
    if (ev.extendedProps?.practitioner_id !== pracId) continue;
    const st = ev.extendedProps?.status;
    if (st === 'cancelled' || st === 'no_show') continue;
    if (newStart < ev.end && newEnd > ev.start) {
      const name = ev.extendedProps?.client_name || ev.title || 'RDV';
      const time = ev.start.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) + ' \u2013 ' + ev.end.toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' });
      conflicts.push(`<strong>${name}</strong> (${time})`);
    }
  }

  if (conflicts.length === 0) {
    warn.style.display = 'none';
  } else {
    const isInfo = calState.fcAllowOverlap;
    warn.style.display = 'block';
    warn.style.background = isInfo ? '#FFF3E0' : '#FFEBEE';
    warn.style.color = isInfo ? '#E65100' : '#C62828';
    warn.innerHTML = (isInfo
      ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Chevauchement avec '
      : '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Conflit avec '
    ) + conflicts.join(', ');
  }
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
bridge({ calSetDuration, calCheckConflict, fcUpdateEditDiff });

export { calSetDuration, calCheckConflict, fcUpdateEditDiff, fcTimeDiffMin };
