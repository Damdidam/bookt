/**
 * Global state store for the Genda dashboard.
 * Centralizes all shared mutable state that was previously in global variables.
 */
import { GendaAPI, GendaUI } from './api-client.js';

// ── Admin impersonation: capture token from URL before anything else ──
(function() {
  const p = new URLSearchParams(window.location.search);
  const at = p.get('admin_token');
  if (at) {
    localStorage.setItem('genda_token', at);
    localStorage.removeItem('genda_user');
    localStorage.removeItem('genda_business');
    // Fetch fresh user/business data, then reload clean
    const headers = { 'Authorization': 'Bearer ' + at };
    Promise.all([
      fetch('/api/auth/me', { headers }).then(r => r.ok ? r.json() : {}),
      fetch('/api/dashboard', { headers }).then(r => r.ok ? r.json() : {})
    ])
      .then(([me, dash]) => {
        if (me.user) localStorage.setItem('genda_user', JSON.stringify(me.user));
        if (dash.business) localStorage.setItem('genda_business', JSON.stringify(dash.business));
      })
      .catch(() => {})
      .finally(() => {
        window.location.replace('/dashboard');
      });
    // Stop further script execution while we redirect
    throw new Error('__impersonation_redirect__');
  }
})();

// ── Auth & API ──
export const api = new GendaAPI();
export const user = api.getUser();
export const biz = api.getBusiness();

// ── RBAC ──
export const ROLE_ACCESS = {
  owner: ['home','bookings','clients','services','hours','waitlist','cal-sync','team','planning','site','invoices','deposits','analytics','promotions','settings','gift-cards','passes','reviews','featured-slots'],
  practitioner: ['home','bookings','clients']
};

export const SECTOR_LABELS = {
  coiffeur: { owner:'Gérant·e', practitioner:'Coiffeur·se' },
  esthetique: { owner:'Gérant·e', practitioner:'Esthéticien·ne' },
  bien_etre: { owner:'Gérant·e', practitioner:'Praticien·ne' },
  osteopathe: { owner:'Gérant·e', practitioner:'Ostéopathe' },
  veterinaire: { owner:'Gérant·e', practitioner:'Vétérinaire' },
  photographe: { owner:'Gérant·e', practitioner:'Photographe' },
  medecin: { owner:'Gérant·e', practitioner:'Médecin' },
  dentiste: { owner:'Gérant·e', practitioner:'Dentiste' },
  kine: { owner:'Gérant·e', practitioner:'Kinésithérapeute' },
  comptable: { owner:'Gérant·e', practitioner:'Collaborateur·rice' },
  avocat: { owner:'Associé·e gérant·e', practitioner:'Avocat·e' },
  barbier: { owner:'Gérant·e', practitioner:'Barbier' },
  coaching: { owner:'Gérant·e', practitioner:'Coach' },
  garage: { owner:'Gérant·e', practitioner:'Mécanicien·ne' },
  autre: { owner:'Gérant·e', practitioner:'Membre' }
};

// ── Category-based terminology ──
export const CATEGORY_LABELS = {
  sante:            { client:'Patient·e',  clients:'Patients',    service:'Consultation', services:'Consultations' },
  beaute:           { client:'Client·e',   clients:'Client·e·s',  service:'Prestation',   services:'Prestations' },
  juridique_finance:{ client:'Client·e',   clients:'Client·e·s',  service:'Consultation', services:'Consultations' },
  education:        { client:'Élève',      clients:'Élèves',      service:'Cours',        services:'Cours' },
  creatif:          { client:'Client·e',   clients:'Client·e·s',  service:'Séance',       services:'Séances' },
  autre:            { client:'Client·e',   clients:'Client·e·s',  service:'Service',      services:'Services' }
};

export const SECTOR_TO_CATEGORY = {
  medecin:'sante', dentiste:'sante', kine:'sante', osteopathe:'sante', bien_etre:'sante',
  coiffeur:'beaute', esthetique:'beaute',
  comptable:'juridique_finance', avocat:'juridique_finance',
  photographe:'creatif',
  veterinaire:'autre',
  barbier:'beaute', coaching:'sante', garage:'autre',
  autre:'autre'
};

export const userRole = user?.role || 'owner';
export const userSector = biz?.sector || 'autre';
export const sectorLabels = SECTOR_LABELS[userSector] || SECTOR_LABELS.autre;
export const userCategory = biz?.category || SECTOR_TO_CATEGORY[userSector] || 'autre';
export const categoryLabels = CATEGORY_LABELS[userCategory] || CATEGORY_LABELS.autre;
export const allowedSections = ROLE_ACCESS[userRole] || ROLE_ACCESS.owner;

// ── Calendar state (mutable, shared across agenda sub-modules) ──
export const calState = {
  fcCal: null,
  fcCalOptions: null,
  fcPractitioners: [],
  fcServices: [],
  fcCurrentFilter: 'all',
  fcCurrentEventId: null,
  fcShowCancelled: false,
  fcShowNoShow: false,
  fcShowPending: true,
  fcShowCompleted: true,
  fcEditOriginal: {},
  fcSelectedNotifyChannel: null,
  fcDetailData: { notes: [], todos: [], reminders: [] },
  fcClientSearchTimer: null,
  fcSlotMin: '08:00:00',
  fcSlotMax: '19:00:00',
  fcHiddenDays: [],
  fcBusinessHours: [],
  fcAllowOverlap: false,
  fcPracBusinessHours: {},
  fcMobileView: 'grid',
  fcMobileDate: new Date(),
  fcAllBookings: [],
  fcCurrentBooking: null,
  fcLocked: false,
  fcAbsences: []
};

// ── View-specific state ──
export const viewState = {
  clientSearch: '',
  clientFilter: '',
  allPractitioners: [],
  analyticsPeriod: '30d',
  invoiceFilter: 'all',
  invoiceType: 'all',
  scheduleData: {},
  currentThemePreset: 'epure_nude',
  businessPlan: biz?.plan || 'free',
  callTab: 'logs',
  wlFilter: 'waiting',
  wlPracFilter: '',
  wlEntries: [],
  qcServiceCount: 0,
  pPendingPhoto: null
};

// Re-export GendaUI for convenience
export { GendaUI };
