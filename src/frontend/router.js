/**
 * SPA Router — handles sidebar navigation and dynamic view loading.
 * Uses dynamic imports for code splitting (each view is a separate chunk).
 */
import { getContentArea } from './utils/dom.js';

const SECTION_TITLES = {
  home: 'Dashboard',
  bookings: 'Agenda',
  clients: 'Clients',
  services: 'Prestations',
  hours: 'Disponibilités',
  waitlist: "Liste d'attente",
  team: 'Équipe',
  site: 'Mon site',
  calls: 'Appels',
  invoices: 'Facturation',
  deposits: 'Acomptes',
  documents: 'Documents pré-RDV',
  settings: 'Paramètres',
  analytics: 'Statistiques',
  'cal-sync': 'Calendrier externe',
  profile: 'Mon profil'
};

/**
 * Load a view section by name.
 * Uses dynamic import() for code splitting — Vite creates separate chunks per view.
 */
async function loadSection(section) {
  const c = getContentArea();

  // Reset agenda-specific classes
  c.classList.remove('agenda-active');
  document.querySelector('.main').classList.remove('agenda-mode');

  // Update page title
  document.getElementById('pageTitle').textContent = SECTION_TITLES[section] || 'Dashboard';

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
      case 'site':
        mod = await import('./views/site.js');
        mod.loadSiteSection();
        break;
      case 'calls':
        mod = await import('./views/calls.js');
        mod.loadCalls();
        break;
      case 'invoices':
        mod = await import('./views/invoices.js');
        mod.loadInvoices();
        break;
      case 'deposits':
        mod = await import('./views/deposits.js');
        mod.loadDeposits();
        break;
      case 'documents':
        mod = await import('./views/documents.js');
        mod.loadDocuments();
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
      case 'profile':
        mod = await import('./views/profile.js');
        mod.loadProfile();
        break;
      default:
        c.innerHTML = `<div class="empty">Section "${section}" — Bientôt disponible</div>`;
    }
  } catch (e) {
    console.error(`Error loading section "${section}":`, e);
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur de chargement: ${e.message}</div>`;
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
