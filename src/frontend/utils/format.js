/**
 * Formatting utilities for dates, prices, phone numbers, and labels.
 */

export const MODE_ICO = {
  cabinet: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/></svg>',
  visio: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  phone: '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>'
};

export const ST_LABELS = {
  pending: 'En attente',
  confirmed: 'Confirmé',
  completed: 'Terminé',
  cancelled: 'Annulé',
  no_show: 'No-show',
  modified_pending: 'Modifié · en attente',
  pending_deposit: 'Acompte requis'
};

export const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
export const MONTH_NAMES = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** Format phone number for display */
export function formatPhoneDisplay(phone) {
  if (!phone) return '';
  const p = String(phone).replace(/\s/g, '');
  if (p.startsWith('+32') && p.length === 12) {
    return '+32 ' + p.slice(3, 6) + ' ' + p.slice(6, 8) + ' ' + p.slice(8, 10) + ' ' + p.slice(10);
  }
  if (p.startsWith('+33') && p.length === 12) {
    return '+33 ' + p.slice(3, 4) + ' ' + p.slice(4, 6) + ' ' + p.slice(6, 8) + ' ' + p.slice(8, 10) + ' ' + p.slice(10);
  }
  if (p.startsWith('+352') && p.length >= 10 && p.length <= 13) {
    return '+352 ' + p.slice(4);
  }
  return phone;
}

/** Calculate difference in minutes between two time strings */
export function timeDiffMin(startStr, endStr) {
  const [sh, sm] = startStr.split(':').map(Number);
  const [eh, em] = endStr.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

/**
 * Build an ISO 8601 string that represents a Brussels-local date+time,
 * preserving the intended wall-clock time instead of shifting to UTC.
 * @param {string} date  "YYYY-MM-DD"
 * @param {string} time  "HH:MM"
 * @returns {string} e.g. "2026-03-03T14:30:00+01:00"
 */
export function toBrusselsISO(date, time) {
  const dt = new Date(date + 'T' + time + ':00');
  const bruFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit'
  });
  const parts = {};
  bruFmt.formatToParts(dt).forEach(p => { parts[p.type] = p.value; });
  const bruDate = new Date(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
  const offsetMs = bruDate.getTime() - dt.getTime();
  const offsetMin = Math.round(offsetMs / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const absOff = Math.abs(offsetMin);
  const offH = String(Math.floor(absOff / 60)).padStart(2, '0');
  const offM = String(absOff % 60).padStart(2, '0');
  return `${date}T${time}:00${sign}${offH}:${offM}`;
}
