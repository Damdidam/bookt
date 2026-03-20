/**
 * SCHEDULE HELPERS — shared utilities for slot-engine and gap-engine.
 *
 * Extracted from slot-engine.js to avoid duplication.
 * Contains timezone, time math, and availability window logic.
 */

/** "09:30" → 570 */
function timeToMinutes(timeStr) {
  const parts = String(timeStr).split(':');
  return parseInt(parts[0]) * 60 + parseInt(parts[1]);
}

/** 570 → "09:30" */
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Intersect two sets of time windows.
 * Each window: { start: "HH:MM", end: "HH:MM" }
 * Returns the overlapping segments.
 */
function intersectWindows(windowsA, windowsB) {
  const result = [];
  for (const a of windowsA) {
    const aStart = timeToMinutes(a.start), aEnd = timeToMinutes(a.end);
    for (const b of windowsB) {
      const bStart = timeToMinutes(b.start), bEnd = timeToMinutes(b.end);
      const start = Math.max(aStart, bStart), end = Math.min(aEnd, bEnd);
      if (start < end) {
        result.push({ start: minutesToTime(start), end: minutesToTime(end) });
      }
    }
  }
  return result;
}

/**
 * Determine if a practitioner is absent on a given date, and what period.
 * Returns null (not absent), 'full', 'am', or 'pm'.
 */
function getAbsencePeriod(absences, dateStr) {
  if (!absences) return null;
  for (const abs of absences) {
    if (dateStr >= abs.from && dateStr <= abs.to) {
      if (abs.from === abs.to) return abs.period;
      if (dateStr === abs.from) return abs.period;
      if (dateStr === abs.to) return abs.periodEnd;
      return 'full'; // middle day → fully absent
    }
  }
  return null;
}

/**
 * Restrict time windows for half-day absence.
 * 'am' absence blocks before 13:00, 'pm' blocks from 13:00 onward.
 */
function restrictWindowsForAbsence(windows, period) {
  const noon = 780; // 13:00 in minutes
  return windows.map(w => {
    const ws = timeToMinutes(w.start), we = timeToMinutes(w.end);
    if (period === 'am') {
      if (we <= noon) return null;
      return { start: ws < noon ? '13:00' : w.start, end: w.end };
    } else { // pm
      if (ws >= noon) return null;
      return { start: w.start, end: we > noon ? '13:00' : w.end };
    }
  }).filter(Boolean);
}

/** DST-safe: compute correct UTC offset for a given date in Europe/Brussels */
function brusselsOffset(dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const bxl = new Date(d.toLocaleString('en-US', { timeZone: 'Europe/Brussels' }));
  const hours = Math.round((bxl - utc) / 3600000);
  return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

/** DST-safe date iteration using string arithmetic */
function nextDateStr(ds) {
  const [y, m, d] = ds.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().split('T')[0];
}

/**
 * Convert a date string to the ISO weekday (0=Mon..6=Sun)
 * used by the DB availabilities table.
 */
function dateToWeekday(dateStr) {
  const dayDate = new Date(dateStr + 'T12:00:00Z');
  const jsDay = dayDate.getUTCDay(); // 0=Sun, 1=Mon, ...
  return jsDay === 0 ? 6 : jsDay - 1; // 0=Mon, 6=Sun
}

module.exports = {
  timeToMinutes,
  minutesToTime,
  intersectWindows,
  getAbsencePeriod,
  restrictWindowsForAbsence,
  brusselsOffset,
  nextDateStr,
  dateToWeekday
};
