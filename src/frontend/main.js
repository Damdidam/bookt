/**
 * Main entry point for the Genda Dashboard.
 * Imports CSS, initializes auth, RBAC, sidebar, and loads the default view.
 */

// ── CSS imports (Vite handles bundling) ──
import './styles/variables.css';
import './styles/base.css';
import './styles/sidebar.css';
import './styles/topbar.css';
import './styles/cards.css';
import './styles/buttons.css';
import './styles/tables.css';
import './styles/modal.css';
import './styles/calendar.css';
import './styles/components.css';
import './styles/responsive.css';

// ── Core modules ──
import { api, user, biz, userRole, sectorLabels, allowedSections, GendaUI } from './state.js';
import { initRouter, loadSection } from './router.js';
import { initTouchBlockers } from './utils/touch.js';
import { bridge } from './utils/window-bridge.js';

// ── Auth guard ──
if (!api.isLoggedIn()) {
  window.location.href = '/login.html';
}

// ── Display user info in sidebar ──
if (userRole === 'practitioner') {
  document.getElementById('userName').textContent = user?.practitioner_name || user?.email || '—';
} else {
  document.getElementById('userName').textContent = user?.business_name || user?.email || '—';
}
document.getElementById('userRole').textContent = sectorLabels[userRole] || userRole;

// ── RBAC: hide sidebar items not allowed for this role ──
document.querySelectorAll('.ni[data-section]').forEach(item => {
  const section = item.dataset.section;
  if (!allowedSections.includes(section)) {
    item.style.display = 'none';
  }
});
// Hide empty sidebar groups
document.querySelectorAll('.sb-label').forEach(label => {
  let next = label.nextElementSibling;
  let hasVisible = false;
  while (next && !next.classList.contains('sb-label')) {
    if (next.classList.contains('ni') && next.style.display !== 'none') hasVisible = true;
    next = next.nextElementSibling;
  }
  if (!hasVisible) label.style.display = 'none';
});

// ── Set today's date ──
document.getElementById('todayDate').textContent = new Date().toLocaleDateString('fr-BE', {
  weekday: 'long', day: 'numeric', month: 'long'
});

// ── Plan badge ──
if (biz) {
  document.getElementById('planBadge').textContent = (biz.plan || 'free').toUpperCase();
}

// ── Query param handlers (onboarding, subscription) ──
const params = new URLSearchParams(location.search);
if (params.get('onboarding')) {
  GendaUI.toast('Bienvenue !', 'success', 5000);
}
if (params.get('subscription') === 'success') {
  const planName = params.get('plan') || '';
  GendaUI.toast('Abonnement ' + planName.toUpperCase() + ' activé ! 14 jours d\'essai gratuit.', 'success', 6000);
  history.replaceState(null, '', '/dashboard');
}
if (params.get('subscription') === 'cancel') {
  GendaUI.toast('Abonnement annulé. Vous pouvez réessayer à tout moment.', 'info', 4000);
  history.replaceState(null, '', '/dashboard');
}

// ── Logout function ──
function doLogout() {
  api.logout();
}

// ── Bridge global functions ──
bridge({ doLogout });

// ── Init touch blockers ──
initTouchBlockers();

// ── Init router & load default view ──
initRouter();
loadSection('home');
