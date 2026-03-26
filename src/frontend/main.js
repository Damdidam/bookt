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
import { api, user, biz, userRole, sectorLabels, categoryLabels, allowedSections, GendaUI } from './state.js';
import { initRouter, loadSection } from './router.js';
import { initTouchBlockers } from './utils/touch.js';
import { initDrawer, toggleDrawer } from './utils/drawer.js';
import { initTimeInputs } from './utils/dom.js';
import { bridge } from './utils/window-bridge.js';
import { closeModal } from './utils/dirty-guard.js';

// ── Auth guard ──
if (!api.isLoggedIn()) {
  // TEMPORARY: try dev auto-login before redirecting
  fetch('/api/dev-login').then(r => r.ok ? r.json() : null).then(d => {
    if (d && d.token) {
      localStorage.setItem('genda_token', d.token);
      localStorage.setItem('genda_user', JSON.stringify(d.user));
      localStorage.setItem('genda_business', JSON.stringify(d.business));
      window.location.reload();
    } else {
      window.location.href = '/login.html';
    }
  }).catch(() => { window.location.href = '/login.html'; });
}

// ── Display user info in sidebar ──
if (userRole === 'practitioner') {
  document.getElementById('userName').textContent = user?.practitioner_name || user?.email || '—';
} else {
  document.getElementById('userName').textContent = user?.business_name || user?.email || '—';
}
document.getElementById('userRole').textContent = sectorLabels[userRole] || userRole;

// ── Admin impersonation banner ──
if (window.__genda_impersonated) {
  const banner = document.createElement('div');
  banner.id = 'impersonBanner';
  banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#F59E0B;color:#78350F;padding:8px 20px;display:flex;align-items:center;justify-content:center;gap:12px;font-size:.82rem;font-weight:600;font-family:var(--sans)';
  banner.innerHTML = '⚠️ Mode admin — ' + (biz?.name || 'Salon') +
    ' <button onclick="localStorage.removeItem(\'genda_token\');window.close()" style="padding:4px 12px;background:#78350F;color:#FEF3C7;border:none;border-radius:6px;cursor:pointer;font-size:.78rem;font-weight:600;font-family:inherit;margin-left:8px">Quitter</button>';
  document.body.prepend(banner);
  document.body.style.paddingTop = '40px';
}

// ── RBAC: hide sidebar items not allowed for this role ──
document.querySelectorAll('.ni[data-section]').forEach(item => {
  const section = item.dataset.section;
  if (!allowedSections.includes(section)) {
    item.style.display = 'none';
  }
});
// Hide empty sidebar sections + restore collapsed state
document.querySelectorAll('.sb-section').forEach(sec => {
  const items = sec.querySelectorAll('.ni');
  const hasVisible = [...items].some(i => i.style.display !== 'none');
  if (!hasVisible) { sec.style.display = 'none'; return; }
  const group = sec.dataset.group;
  const hasActive = sec.querySelector('.ni.active');
  if (!hasActive && localStorage.getItem('sb_' + group) === '1') sec.classList.add('collapsed');
});

// ── Category-aware sidebar labels ──
if (biz) {
  const sbBiz = document.getElementById('sbBizName');
  if (sbBiz) { const sp = sbBiz.querySelector('span'); if (sp) sp.textContent = biz.name || 'Mon salon'; }
  const sbClients = document.getElementById('sbClientsLabel');
  if (sbClients) sbClients.textContent = categoryLabels.clients;
  const sbServices = document.getElementById('sbServicesLabel');
  if (sbServices) sbServices.textContent = categoryLabels.services;
  // Update all label placeholders in modals
  document.querySelectorAll('.lbl-practitioner').forEach(el => { el.textContent = sectorLabels.practitioner; });
  document.querySelectorAll('.lbl-client').forEach(el => { el.textContent = categoryLabels.client; });
  document.querySelectorAll('.lbl-service').forEach(el => { el.textContent = categoryLabels.service; });
  const addSvcBtn = document.getElementById('qcAddSvcBtn');
  if (addSvcBtn) addSvcBtn.textContent = '+ ' + categoryLabels.service;
}

// ── Set today's date ──
document.getElementById('todayDate').textContent = new Date().toLocaleDateString('fr-BE', {
  weekday: 'long', day: 'numeric', month: 'long'
});

// ── Plan badge (refresh from server to catch DB changes) ──
if (biz) {
  const badge = document.getElementById('planBadge');
  badge.textContent = (biz.plan || 'free').toUpperCase();
  // Async refresh
  api.getDashboard?.()?.then?.(d => {
    if (d?.business?.plan && d.business.plan !== biz.plan) {
      biz.plan = d.business.plan;
      api.setBusiness(biz);
      badge.textContent = d.business.plan.toUpperCase();
    }
  }).catch(() => {});
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

// ── Sidebar collapse/expand ──
function toggleSbSection(labelEl) {
  const sec = labelEl.closest('.sb-section');
  if (!sec) return;
  sec.classList.toggle('collapsed');
  localStorage.setItem('sb_' + sec.dataset.group, sec.classList.contains('collapsed') ? '1' : '0');
}

// ── Logout function ──
function doLogout() {
  api.logout();
}

// ── Global modal Escape handler (guard-aware) ──
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // Pre-defined calendar modals use closeCalModal (imported lazily)
    const calDetail = document.getElementById('calDetailModal');
    if (calDetail?.classList.contains('open')) {
      if (typeof window.closeCalModal === 'function') window.closeCalModal('calDetailModal');
      return;
    }
    const calCreate = document.getElementById('calCreateModal');
    if (calCreate?.classList.contains('open')) {
      if (typeof window.closeCalModal === 'function') window.closeCalModal('calCreateModal');
      return;
    }
    // Dynamic modals — route via guard-aware closeModal
    const modals = document.querySelectorAll('.m-overlay.open');
    if (modals.length) {
      const top = modals[modals.length - 1];
      closeModal(top.id);
    }
  }
});

// ── Bridge global functions ──
bridge({ doLogout, toggleSbSection, toggleDrawer });

// ── Init touch blockers ──
initTouchBlockers();

// ── Init sidebar drawer (tablet) ──
initDrawer();

// ── Init simple digit time inputs (replaces Android clock picker) ──
initTimeInputs();

// ── Init router & load default view ──
initRouter();
loadSection('home');

// ── Register service worker (PWA) ──
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
