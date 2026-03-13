/**
 * Gap Analyzer — floating panel showing exploitable gaps for the current day.
 * Toggle button in toolbar, background events on calendar, click-to-fill with quick-create.
 * Pattern follows calendar-featured.js (prefix ga instead of fs).
 */
import { api, calState, biz } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';
import { fcOpenQuickCreate } from './quick-create.js';
import { fcIsMobile } from '../../utils/touch.js';

// ── State ──
let gaActive = false;
let gaData = null;
let gaCurrentDate = null;
let gaCurrentFilter = null;
let gaLoading = false;

function gaIsActive() { return gaActive; }

// ── Helpers ──
function localDate(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
}

function fmtMin(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? h + 'h' + (m > 0 ? String(m).padStart(2, '0') : '') : m + 'min';
}

function fmtEur(cents) { return ((cents || 0) / 100).toFixed(0) + '\u202f\u20ac'; }

// ── Toggle ──
async function gaToggleMode() {
  if (gaActive) { gaDeactivate(); return; }

  if (fcIsMobile()) { gToast('Analyseur non disponible sur mobile', 'info'); return; }

  const viewType = calState.fcCal?.view?.type;
  if (!viewType || (!viewType.includes('Day') && viewType !== 'timeGridDay')) {
    gToast('Passez en vue jour pour utiliser l\u2019analyseur de gaps', 'info');
    return;
  }

  const freshBiz = api.getBusiness();
  if (!freshBiz?.settings?.gap_analyzer_enabled) {
    gToast('Activez l\u2019analyseur dans Param\u00e8tres > Calendrier', 'info');
    return;
  }

  gaActivate();
}

// ── Activate / Deactivate ──
async function gaActivate() {
  // Mutual exclusivity with featured mode
  if (document.getElementById('fsActionBar')) {
    if (typeof window.fsCancelMode === 'function') window.fsCancelMode();
  }

  gaActive = true;
  gaData = null;
  document.getElementById('fcCalendar')?.classList.add('ga-mode-active');
  document.getElementById('gaToggleBtn')?.classList.add('active');

  gaShowPanel();
  await gaLoadData();
}

function gaDeactivate() {
  gaActive = false;
  gaData = null;
  gaCurrentDate = null;
  gaCurrentFilter = null;
  document.getElementById('fcCalendar')?.classList.remove('ga-mode-active');
  document.getElementById('gaToggleBtn')?.classList.remove('active');
  document.getElementById('gaPanel')?.remove();
  fcRefresh();
}

// ── Data loading ──
async function gaLoadData() {
  const cal = calState.fcCal;
  if (!cal) return;

  const date = localDate(cal.view.currentStart);
  const filter = calState.fcCurrentFilter || 'all';

  // Cache: don't refetch if same date + filter
  if (date === gaCurrentDate && filter === gaCurrentFilter && gaData) return;

  gaCurrentDate = date;
  gaCurrentFilter = filter;
  gaLoading = true;
  gaRenderLoading();

  try {
    let url = `/api/bookings/gaps?date=${date}`;
    if (filter !== 'all') url += `&practitioner_id=${filter}`;

    const r = await fetch(url, {
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(d.error || 'Erreur');
    }
    gaData = await r.json();
  } catch (e) {
    gaData = null;
    gToast('Erreur analyseur: ' + e.message, 'error');
  }

  gaLoading = false;
  gaRenderPanel();
  fcRefresh();
}

// ── Auto scan (badge + morning toast) ──
async function gaAutoScan() {
  const freshBiz = api.getBusiness();
  if (!freshBiz?.settings?.gap_analyzer_enabled) return;
  if (!api.getToken()) return;

  const cal = calState.fcCal;
  if (!cal) return;
  const date = localDate(cal.getDate());

  try {
    let url = `/api/bookings/gaps?date=${date}`;
    if (calState.fcCurrentFilter && calState.fcCurrentFilter !== 'all')
      url += `&practitioner_id=${calState.fcCurrentFilter}`;
    const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + api.getToken() } });
    if (!r.ok) return;
    const data = await r.json();

    let totalGaps = 0, totalMin = 0;
    (data.practitioners || []).forEach(p => {
      totalGaps += p.gaps.length;
      totalMin += p.stats?.gap_min || 0;
    });

    // A — Update badge
    const badge = document.getElementById('gaBadge');
    if (badge) {
      if (totalGaps > 0) { badge.textContent = totalGaps; badge.style.display = 'flex'; }
      else { badge.style.display = 'none'; }
    }

    // B — Morning toast (once per session per day)
    const toastKey = `ga_toast_${date}`;
    if (totalGaps > 0 && !sessionStorage.getItem(toastKey)) {
      gToast(
        `${totalGaps} créneau${totalGaps > 1 ? 'x' : ''} libre${totalGaps > 1 ? 's' : ''} (${fmtMin(totalMin)}) — Analyseur prêt`,
        'info',
        { label: 'Voir →', fn: 'gaToggleMode()' }
      );
      sessionStorage.setItem(toastKey, '1');
    }
  } catch (e) { /* silent */ }
}

// ── Event hooks ──
function gaOnDatesSet() {
  // Always refresh badge (even when panel is closed)
  gaAutoScan();

  if (!gaActive) return;
  const viewType = calState.fcCal?.view?.type;
  if (!viewType || (!viewType.includes('Day') && viewType !== 'timeGridDay')) {
    gaDeactivate();
    return;
  }
  // Force reload on date change
  const newDate = localDate(calState.fcCal.view.currentStart);
  if (newDate !== gaCurrentDate) {
    gaCurrentDate = null; // bust cache
    gaLoadData();
  }
}

function gaOnFilterChanged() {
  if (!gaActive) return;
  gaCurrentFilter = null; // bust cache
  gaLoadData();
}

// ── Panel DOM ──
function gaShowPanel() {
  document.getElementById('gaPanel')?.remove();

  const panel = document.createElement('div');
  panel.id = 'gaPanel';
  panel.className = 'ga-panel';
  panel.innerHTML = `<div class="ga-panel-header">
    <div class="ga-panel-title">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span>Analyseur de gaps</span>
      <span class="ga-panel-count" id="gaPanelCount"></span>
    </div>
    <button class="ga-panel-close" onclick="gaDeactivate()" title="Fermer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  </div>
  <div class="ga-panel-body" id="gaPanelBody">
    <div class="ga-loading"><div class="ga-spinner"></div> Analyse en cours\u2026</div>
  </div>`;

  document.querySelector('.main')?.appendChild(panel);
}

function gaRenderLoading() {
  const body = document.getElementById('gaPanelBody');
  if (body) body.innerHTML = '<div class="ga-loading"><div class="ga-spinner"></div> Analyse en cours\u2026</div>';
  const count = document.getElementById('gaPanelCount');
  if (count) count.textContent = '';
}

function gaRenderPanel() {
  const body = document.getElementById('gaPanelBody');
  const countEl = document.getElementById('gaPanelCount');
  if (!body) return;

  if (!gaData || !gaData.practitioners || gaData.practitioners.length === 0) {
    if (gaData?.closed || gaData?.holiday || gaData?.closed_weekday) {
      body.innerHTML = '<div class="ga-empty"><span class="ga-empty-icon">\ud83d\udeab</span> Ferm\u00e9 ce jour</div>';
    } else {
      body.innerHTML = '<div class="ga-empty"><span class="ga-empty-icon">\u2728</span> Aucun gap d\u00e9tect\u00e9 \u2014 journ\u00e9e bien remplie !</div>';
    }
    if (countEl) countEl.textContent = '';
    return;
  }

  // Aggregate stats
  let totalGaps = 0, totalGapMin = 0;
  gaData.practitioners.forEach(p => {
    totalGaps += p.gaps.length;
    totalGapMin += p.stats.gap_min + p.stats.processing_unused_min;
  });

  if (countEl) {
    countEl.textContent = totalGaps === 0
      ? 'Aucun gap'
      : totalGaps + ' gap' + (totalGaps > 1 ? 's' : '') + ' \u00b7 ' + fmtMin(totalGapMin) + ' dispo';
  }

  if (totalGaps === 0) {
    body.innerHTML = '<div class="ga-empty"><span class="ga-empty-icon">\u2728</span> Aucun gap d\u00e9tect\u00e9 \u2014 journ\u00e9e bien remplie !</div>';
    return;
  }

  let html = '<div class="ga-stats">';

  // Per-practitioner stat cards
  gaData.practitioners.forEach(prac => {
    const color = calState.fcPractitioners?.find(p => String(p.id) === String(prac.practitioner_id))?.color || 'var(--primary)';
    const pct = Math.round(prac.stats.occupation_pct);
    const bookedH = fmtMin(prac.stats.booked_min);
    const totalH = fmtMin(prac.stats.total_work_min);
    const gapCount = prac.gaps.length;

    html += `<div class="ga-prac-stat">
      <div class="ga-donut" style="--pct:${pct};--color:${color}">
        <span class="ga-donut-val">${pct}%</span>
      </div>
      <div class="ga-prac-info">
        <span class="ga-prac-name">${esc(prac.practitioner_name)}</span>
        <span class="ga-prac-meta">${bookedH} / ${totalH}</span>
        <span class="ga-prac-meta">${gapCount} gap${gapCount > 1 ? 's' : ''}</span>
      </div>
    </div>`;
  });

  html += '</div><div class="ga-gaps">';

  // All gaps sorted by time across all practitioners
  const allGaps = [];
  gaData.practitioners.forEach(prac => {
    prac.gaps.forEach(gap => {
      allGaps.push({ ...gap, practitioner_id: prac.practitioner_id, practitioner_name: prac.practitioner_name });
    });
  });
  allGaps.sort((a, b) => a.start.localeCompare(b.start));

  allGaps.forEach(gap => {
    const isProc = gap.type === 'processing';
    const typeLabel = isProc ? 'Pose' : 'Gap';
    const typeClass = isProc ? 'ga-gap-type--processing' : 'ga-gap-type--gap';
    const firstSvc = gap.compatible_services?.[0];

    html += `<div class="ga-gap-card" onclick="gaFillGap('${gap.practitioner_id}','${gap.start}'${firstSvc ? ",'" + firstSvc.id + "'" : ',null'})">`;
    html += `<div class="ga-gap-header">
      <span class="ga-gap-time">${gap.start} \u2013 ${gap.end}</span>
      <span class="ga-gap-dur">${gap.duration_min}min</span>
      <span class="ga-gap-type ${typeClass}">${typeLabel}</span>
    </div>`;

    if (isProc && gap.parent_service) {
      html += `<div style="font-size:.64rem;color:var(--text-4);margin-top:-2px">Pendant : ${esc(gap.parent_service)}</div>`;
    }

    // Multi-practitioner: show name if filter = all
    if (gaCurrentFilter === 'all' && gaData.practitioners.length > 1) {
      html += `<div style="font-size:.64rem;color:var(--text-3);font-weight:600">${esc(gap.practitioner_name)}</div>`;
    }

    // Compatible services
    if (gap.compatible_services?.length > 0) {
      html += '<div class="ga-gap-services">';
      gap.compatible_services.slice(0, 4).forEach(svc => {
        html += `<span class="ga-svc-chip" onclick="event.stopPropagation();gaFillGap('${gap.practitioner_id}','${gap.start}','${svc.id}')">${esc(svc.name)} (${svc.duration_min}min)${svc.price_cents ? ' \u00b7 ' + fmtEur(svc.price_cents) : ''}</span>`;
      });
      if (gap.compatible_services.length > 4) {
        html += `<span class="ga-svc-chip" style="opacity:.6">+${gap.compatible_services.length - 4}</span>`;
      }
      html += '</div>';
    } else {
      html += '<div style="font-size:.64rem;color:var(--text-4);font-style:italic">Aucun service compatible</div>';
    }

    // Waitlist matches
    if (gap.waitlist_matches?.length > 0) {
      html += '<div class="ga-gap-waitlist">';
      gap.waitlist_matches.forEach(wl => {
        const timeLabel = wl.preferred_time === 'morning' ? 'matin' : wl.preferred_time === 'afternoon' ? 'apr\u00e8s-midi' : '';
        html += `<span class="ga-wl-badge">\u23f3 ${esc(wl.client_name)} \u2014 ${esc(wl.service_name)}${timeLabel ? ' (' + timeLabel + ')' : ''}</span>`;
      });
      html += '</div>';
    }

    html += '</div>';
  });

  html += '</div>';
  body.innerHTML = html;
}

// ── Fill gap → open quick-create ──
function gaFillGap(pracId, startTime, serviceId) {
  if (!gaCurrentDate) return;
  const startStr = gaCurrentDate + 'T' + startTime + ':00';
  fcOpenQuickCreate(startStr);

  requestAnimationFrame(() => {
    const qcPrac = document.getElementById('qcPrac');
    if (qcPrac && pracId) {
      qcPrac.value = pracId;
      // Trigger practitioner change to refresh service dropdowns
      const evt = new Event('change', { bubbles: true });
      qcPrac.dispatchEvent(evt);
    }
    if (serviceId) {
      requestAnimationFrame(() => {
        const qcSvc = document.getElementById('qcSvcSel0');
        if (qcSvc) {
          qcSvc.value = serviceId;
          if (typeof window.qcServiceChanged === 'function') window.qcServiceChanged(0);
        }
      });
    }
  });
}

// ── Background events for FullCalendar ──
function gaBuildBackgroundEvents() {
  if (!gaActive || !gaData?.practitioners) return [];

  const events = [];
  gaData.practitioners.forEach(prac => {
    prac.gaps.forEach((gap, i) => {
      events.push({
        id: 'ga_' + prac.practitioner_id + '_' + i,
        start: gaCurrentDate + 'T' + gap.start + ':00',
        end: gaCurrentDate + 'T' + gap.end + ':00',
        display: 'background',
        resourceId: String(prac.practitioner_id),
        classNames: [gap.type === 'processing' ? 'ga-bg-processing' : 'ga-bg-gap'],
        extendedProps: { _isGapAnalyzer: true, practitioner_id: prac.practitioner_id }
      });
    });
  });
  return events;
}

// ── Bridge ──
bridge({ gaToggleMode, gaDeactivate, gaFillGap, gaAutoScan });

export { gaIsActive, gaToggleMode, gaOnDatesSet, gaOnFilterChanged, gaBuildBackgroundEvents, gaDeactivate, gaAutoScan };
