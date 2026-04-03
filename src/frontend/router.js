/**
 * SPA Router — handles sidebar navigation and dynamic view loading.
 * Uses dynamic imports for code splitting (each view is a separate chunk).
 */
import { getContentArea } from './utils/dom.js';
import { showDirtyPrompt, showConfirmDialog } from './utils/dirty-guard.js';

const esc=s=>s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'):'';


const SECTION_TITLES = {
  home: 'Dashboard',
  bookings: 'Agenda',
  clients: 'Clients',
  services: 'Prestations',
  hours: 'Horaires',
  waitlist: "Liste d'attente",
  team: 'Équipe',
  planning: 'Absences',
  site: 'Mon site',
  invoices: 'Facturation',
  deposits: 'Acomptes',
  passes: 'Abonnements',
  promotions: 'Promotions',
  'gift-cards': 'Cartes cadeau',
  reviews: 'Avis clients',
  settings: 'Paramètres',
  analytics: 'Statistiques',
  'cal-sync': 'Calendrier externe'
};

/**
 * Load a view section by name.
 * Uses dynamic import() for code splitting — Vite creates separate chunks per view.
 */
async function loadSection(section) {
  // Check if any open modal has unsaved changes
  const openModals = document.querySelectorAll('.m-overlay.open');
  for (const m of openModals) {
    if (m._dirtyGuard?.isDirty()) {
      const leave = await showDirtyPrompt(m.querySelector('.m-dialog') || m);
      if (!leave) return;
      m._dirtyGuard.destroy();
      m.classList.remove('open');
      if (m.id !== 'calDetailModal' && m.id !== 'calCreateModal') m.remove();
    }
  }
  // Check settings page dirty guard
  if (window._settingsGuard?.isDirty()) {
    const c = getContentArea();
    const leave = await showDirtyPrompt(c);
    if (!leave) return;
    window._settingsGuard.destroy();
    window._settingsGuard = null;
  }

  // Check featured-slots mode dirty guard
  if (window._fsFeaturedDirty?.()) {
    if (!(await showConfirmDialog('Vous avez des créneaux vedette non enregistrés. Quitter quand même ?'))) return;
    window._fsFeaturedDeactivate?.();
  }

  const c = getContentArea();

  // Reset agenda-specific classes
  c.classList.remove('agenda-active');
  document.querySelector('.main').classList.remove('agenda-mode');

  // Update page title
  document.getElementById('pageTitle').textContent = SECTION_TITLES[section] || 'Dashboard';

  // Remove injected save buttons from topbar when navigating away
  document.getElementById('settingsSaveBtn')?.remove();
  document.getElementById('siteSaveBtn')?.remove();

  // Update active sidebar item
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('active'));
  const activeItem = document.querySelector(`.ni[data-section="${section}"]`);
  if (activeItem) activeItem.classList.add('active');

  // Show loading state
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

  try {
    let mod;
    switch (section) {
      case 'home':
        mod = await import('./views/home.js');
        mod.loadDashboard();
        break;
      case 'bookings':
        mod = await import('./views/agenda/index.js');
        mod.loadAgenda();
        break;
      case 'clients':
        mod = await import('./views/clients.js');
        mod.loadClients();
        break;
      case 'services':
        mod = await import('./views/services.js');
        mod.loadServices();
        break;
      case 'hours':
        mod = await import('./views/hours.js');
        mod.loadHours();
        break;
      case 'waitlist':
        mod = await import('./views/waitlist.js');
        mod.loadWaitlist();
        break;
      case 'team':
        mod = await import('./views/team.js');
        mod.loadTeam();
        break;
      case 'planning':
        mod = await import('./views/planning.js');
        mod.loadPlanning();
        break;
      case 'site':
        mod = await import('./views/site.js');
        mod.loadSiteSection();
        break;
      case 'invoices':
        mod = await import('./views/invoices.js');
        mod.loadInvoices();
        break;
      case 'deposits':
        mod = await import('./views/deposits.js');
        mod.loadDeposits();
        break;
      case 'passes':
        mod = await import('./views/passes.js');
        mod.loadPasses();
        break;
      case 'promotions':
        mod = await import('./views/promotions.js');
        mod.loadPromotions();
        break;
      case 'gift-cards':
        mod = await import('./views/gift-cards.js');
        mod.loadGiftCards();
        break;
      case 'reviews':
        mod = await import('./views/reviews.js');
        mod.loadReviews();
        break;
      case 'analytics':
        mod = await import('./views/analytics.js');
        mod.loadAnalytics();
        break;
      case 'settings':
        mod = await import('./views/settings.js');
        mod.loadSettings();
        break;
      case 'cal-sync':
        mod = await import('./views/cal-sync.js');
        mod.loadCalSync();
        break;
      default:
        c.innerHTML = `<div class="empty">Section "${esc(section)}" — Bientôt disponible</div>`;
    }
  } catch (e) {
    console.error(`Error loading section "${section}":`, e);
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur de chargement: ${esc(e.message)}</div>`;
  }
}

/**
 * Initialize sidebar navigation listeners.
 */
export function initRouter() {
  document.querySelectorAll('.ni').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const section = item.dataset.section;
      if (section) loadSection(section);
    });
  });
}

export { loadSection };
