/**
 * Calendar Toolbar - navigation, view switching, title updates.
 */
import { calState } from '../../state.js';
import { fcIsMobile } from '../../utils/touch.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcLoadMobileList } from './calendar-mobile.js';

function atNav(action) {
  if (!calState.fcCal) return;
  if (action === 'prev') calState.fcCal.prev();
  else if (action === 'next') calState.fcCal.next();
  else if (action === 'today') calState.fcCal.today();
  if (fcIsMobile() && calState.fcMobileView === 'list') {
    calState.fcMobileDate = calState.fcCal.getDate();
    fcLoadMobileList();
  }
}

function atView(view) {
  if (!calState.fcCal) return;
  calState.fcCal.changeView(view);
  document.querySelectorAll('.at-view-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
}

function atMobView(view) {
  calState.fcMobileView = view;
  document.querySelectorAll('.at-mob-vbtn').forEach((b, i) => {
    b.classList.toggle('active', i === (view === 'list' ? 0 : 1));
  });
  const cal = document.getElementById('fcCalendar');
  const list = document.getElementById('fcMobList');
  if (view === 'list') {
    if (cal) cal.style.display = 'none';
    if (list) { list.classList.add('active'); }
    calState.fcMobileDate = calState.fcCal ? calState.fcCal.getDate() : new Date();
    fcLoadMobileList();
  } else {
    if (cal) cal.style.display = '';
    if (list) list.classList.remove('active');
    if (calState.fcCal) calState.fcCal.updateSize();
  }
}

function atUpdateTitle() {
  if (!calState.fcCal) return;
  const view = calState.fcCal.view;
  const MNAMES = ['janv.', 'f\u00e9vr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'ao\u00fbt', 'sept.', 'oct.', 'nov.', 'd\u00e9c.'];
  const MFULL = ['janvier', 'f\u00e9vrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'ao\u00fbt', 'septembre', 'octobre', 'novembre', 'd\u00e9cembre'];
  const DNAMES = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const DFULL = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  let title = '';
  if (view.type === 'timeGridDay') {
    const d = view.currentStart;
    title = DFULL[d.getDay()] + ' ' + d.getDate() + ' ' + MFULL[d.getMonth()];
    if (d.getFullYear() !== new Date().getFullYear()) title += ' ' + d.getFullYear();
  } else if (view.type === 'timeGridWeek') {
    const s = view.currentStart, e = new Date(view.currentEnd.getTime() - 86400000);
    if (s.getMonth() === e.getMonth()) {
      title = s.getDate() + ' \u2013 ' + e.getDate() + ' ' + MNAMES[s.getMonth()] + ' ' + s.getFullYear();
    } else {
      title = s.getDate() + ' ' + MNAMES[s.getMonth()] + ' \u2013 ' + e.getDate() + ' ' + MNAMES[e.getMonth()] + ' ' + s.getFullYear();
    }
  } else if (view.type === 'dayGridMonth') {
    const d = view.currentStart;
    title = MFULL[d.getMonth()] + ' ' + d.getFullYear();
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  // Update both desktop and mobile title elements
  const el = document.getElementById('atTitle'); if (el) el.textContent = title;
  const elM = document.getElementById('atTitleMob'); if (elM) elM.textContent = title;
  // Update date label
  const now = new Date();
  const dateStr = DNAMES[now.getDay()] + ' ' + now.getDate() + ' ' + MNAMES[now.getMonth()];
  const elD = document.getElementById('atDate'); if (elD) elD.textContent = dateStr;
}

// Expose to global scope for onclick handlers
bridge({ atNav, atView, atMobView });

export { atNav, atView, atMobView, atUpdateTitle };
