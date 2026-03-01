/**
 * Global state store for the Genda dashboard.
 * Centralizes all shared mutable state that was previously in global variables.
 */
import { GendaAPI, GendaUI } from './api-client.js';

// ── Auth & API ──
export const api = new GendaAPI();
export const user = api.getUser();
export const biz = api.getBusiness();

// ── RBAC ──
export const ROLE_ACCESS = {
  owner: ['home','bookings','clients','services','hours','waitlist','cal-sync','team','site','calls','invoices','deposits','documents','analytics','settings'],
  manager: ['home','bookings','clients','services','hours','waitlist','cal-sync','documents','deposits','analytics'],
  receptionist: ['home','bookings','clients','waitlist'],
  practitioner: ['home','bookings','clients','profile']
};

export const SECTOR_LABELS = {
  coiffeur: { owner:'Gérant·e', practitioner:'Coiffeur·se', manager:'Responsable salon', receptionist:'Réceptionniste' },
  esthetique: { owner:'Gérant·e', practitioner:'Esthéticien·ne', manager:'Responsable', receptionist:'Réceptionniste' },
  bien_etre: { owner:'Gérant·e', practitioner:'Praticien·ne', manager:'Responsable', receptionist:'Réceptionniste' },
  osteopathe: { owner:'Gérant·e', practitioner:'Ostéopathe', manager:'Responsable', receptionist:'Secrétaire' },
  veterinaire: { owner:'Gérant·e', practitioner:'Vétérinaire', manager:'Responsable', receptionist:'Secrétaire' },
  photographe: { owner:'Gérant·e', practitioner:'Photographe', manager:'Responsable', receptionist:'Assistant·e' },
  medecin: { owner:'Gérant·e', practitioner:'Médecin', manager:'Responsable', receptionist:'Secrétaire médicale' },
  dentiste: { owner:'Gérant·e', practitioner:'Dentiste', manager:'Responsable', receptionist:'Secrétaire' },
  kine: { owner:'Gérant·e', practitioner:'Kinésithérapeute', manager:'Responsable', receptionist:'Secrétaire' },
  comptable: { owner:'Gérant·e', practitioner:'Collaborateur·rice', manager:'Office Manager', receptionist:'Secrétaire' },
  avocat: { owner:'Associé·e gérant·e', practitioner:'Avocat·e', manager:'Office Manager', receptionist:'Secrétaire juridique' },
  autre: { owner:'Gérant·e', practitioner:'Membre', manager:'Responsable', receptionist:'Réceptionniste' }
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
  veterinaire:'autre', autre:'autre'
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
  fcCurrentBooking: null
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
  currentThemePreset: 'classique',
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
