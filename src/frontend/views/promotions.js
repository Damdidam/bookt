/**
 * Promotions view module — staff dashboard management.
 */
import { api, GendaUI } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';
import { guardModal, closeModal } from '../utils/dirty-guard.js';

let _lastPromos = [];
let _serviceCache = null;

const CONDITION_LABELS = {
  min_amount: v => `Panier min ${v || '?'}\u202F\u20AC`,
  specific_service: v => `Service\u00A0: ${v || '?'}`,
  first_visit: () => 'Nouveau client',
  date_range: (v, v2) => `Du ${v || '?'} au ${v2 || '?'}`,
  none: () => 'Sans condition'
};

const REWARD_LABELS = {
  free_service: v => `Service offert\u00A0: ${v || '?'}`,
  discount_pct: v => `R\u00E9duction ${v || '?'}%`,
  discount_fixed: v => `R\u00E9duction ${v || '?'}\u202F\u20AC`,
  info_only: () => 'Info seulement'
};

function conditionSummary(p) {
  const fn = CONDITION_LABELS[p.condition_type];
  if (!fn) return p.condition_type || '—';
  if (p.condition_type === 'date_range') return fn(p.condition_date_start, p.condition_date_end);
  return fn(p.condition_value);
}

function rewardSummary(p) {
  const fn = REWARD_LABELS[p.reward_type];
  if (!fn) return p.reward_type || '—';
  return fn(p.reward_value);
}

export async function loadPromotions() {
  const c = document.getElementById('contentArea');
  c.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    const data = await api.get('/api/promotions');
    const promos = data.promotions || data || [];
    _lastPromos = promos;
    renderPromotions(c, promos);
  } catch (e) {
    c.innerHTML = `<div class="empty" style="color:var(--red)">Erreur: ${esc(e.message)}</div>`;
  }
}

function renderPromotions(c, promos) {
  const total = promos.length;
  const activeCount = promos.filter(p => p.is_active).length;

  let h = '';

  // ── KPI CARDS ──
  h += `<div class="stats" style="grid-template-columns:repeat(2,1fr)">
    <div class="stat-card"><div class="label">Total promotions</div><div class="val" style="color:var(--primary)">${total}</div><div class="sub">cr\u00E9\u00E9es</div></div>
    <div class="stat-card"><div class="label">Promotions actives</div><div class="val" style="color:var(--green)">${activeCount}</div><div class="sub">en cours</div></div>
  </div>`;

  // ── ACTION BAR ──
  h += `<div class="card" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 16px">
    <div style="flex:1"></div>
    <span style="font-size:.78rem;color:var(--text-3)">${activeCount}/${total} actives</span>
    <button onclick="openPromoModal()" class="btn-primary"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;vertical-align:-2px;margin-right:4px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Nouvelle promotion</button>
  </div>`;

  // ── TABLE ──
  if (promos.length === 0) {
    h += `<div class="card"><div class="empty">Aucune promotion cr\u00E9\u00E9e.</div></div>`;
  } else {
    h += `<div class="card" style="padding:0;overflow:auto"><table style="width:100%;border-collapse:collapse;font-size:.82rem">
      <thead><tr style="background:var(--surface);border-bottom:1px solid var(--border)">
        <th style="padding:10px 14px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Titre</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Condition</th>
        <th style="padding:10px;text-align:left;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">R\u00E9compense</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Statut</th>
        <th style="padding:10px;text-align:center;font-weight:600;font-size:.72rem;text-transform:uppercase;color:var(--text-3)">Actions</th>
      </tr></thead><tbody>`;

    promos.forEach(p => {
      const isActive = !!p.is_active;
      const statusColor = isActive ? 'var(--green)' : 'var(--text-4)';
      const statusLabel = isActive ? 'Active' : 'Inactive';

      h += `<tr style="border-bottom:1px solid var(--border-light)">
        <td style="padding:10px 14px;font-weight:500">${esc(p.title)}</td>
        <td style="padding:10px;color:var(--text-2);font-size:.78rem">${esc(conditionSummary(p))}</td>
        <td style="padding:10px;color:var(--text-2);font-size:.78rem">${esc(rewardSummary(p))}</td>
        <td style="padding:10px;text-align:center">
          <label style="position:relative;display:inline-block;width:36px;height:20px;cursor:pointer">
            <input type="checkbox" ${isActive ? 'checked' : ''} onchange="togglePromo('${p.id}',this.checked)" style="opacity:0;width:0;height:0">
            <span style="position:absolute;inset:0;background:${isActive ? 'var(--green)' : 'var(--border)'};border-radius:10px;transition:background .2s"></span>
            <span style="position:absolute;top:2px;left:${isActive ? '18px' : '2px'};width:16px;height:16px;background:#fff;border-radius:50%;transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
          </label>
        </td>
        <td style="padding:10px;text-align:center;white-space:nowrap">
          <button onclick="openPromoModal('${p.id}')" title="Modifier" style="background:none;border:none;cursor:pointer;color:var(--primary);padding:4px 6px">${IC.edit}</button>
          <button onclick="deletePromo('${p.id}','${esc(p.title)}')" title="Supprimer" style="background:none;border:none;cursor:pointer;color:var(--red);padding:4px 6px"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
        </td>
      </tr>`;
    });
    h += `</tbody></table></div>`;
  }

  c.innerHTML = h;
}

async function fetchServices() {
  if (_serviceCache) return _serviceCache;
  try {
    const data = await api.get('/api/services');
    _serviceCache = (data.services || data || []).filter(s => s.is_active !== false);
  } catch (e) {
    console.error('[promotions] fetch services failed', e);
    _serviceCache = [];
  }
  return _serviceCache;
}

async function openPromoModal(id) {
  const existing = document.getElementById('promoModal');
  if (existing) existing.remove();

  let promo = null;
  if (id) {
    promo = _lastPromos.find(p => p.id === id);
    if (!promo) { GendaUI.toast('Promotion introuvable', 'error'); return; }
  }

  const services = await fetchServices();
  const serviceOpts = services.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');

  const ct = promo?.condition_type || 'none';
  const rt = promo?.reward_type || 'info_only';
  const ds = promo?.display_style || 'banner';

  const modal = document.createElement('div');
  modal.className = 'm-overlay open'; modal.id = 'promoModal';
  modal.innerHTML = `<div class="m-dialog m-md">
    <div class="m-header-simple">
      <h3>${promo ? 'Modifier la promotion' : 'Nouvelle promotion'}</h3>
      <button class="m-close" onclick="closeModal('promoModal')">${IC.x}</button>
    </div>
    <div class="m-body">
      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Titre <span style="color:var(--red)">*</span></label>
        <input type="text" id="promoTitle" value="${esc(promo?.title || '')}" placeholder="Ex: -20% premi\u00E8re visite" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Description <span style="color:var(--text-4);font-weight:400">(optionnel)</span></label>
        <textarea id="promoDescription" rows="3" placeholder="D\u00E9tails de la promotion..." style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;resize:vertical">${esc(promo?.description || '')}</textarea>
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Type de condition</label>
        <select id="promoConditionType" onchange="promoConditionChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="none" ${ct === 'none' ? 'selected' : ''}>Sans condition</option>
          <option value="min_amount" ${ct === 'min_amount' ? 'selected' : ''}>Panier minimum</option>
          <option value="specific_service" ${ct === 'specific_service' ? 'selected' : ''}>Service sp\u00E9cifique</option>
          <option value="first_visit" ${ct === 'first_visit' ? 'selected' : ''}>Nouveau client</option>
          <option value="date_range" ${ct === 'date_range' ? 'selected' : ''}>Plage de dates</option>
        </select>
      </div>

      <div id="promoConditionFields" style="margin-bottom:14px">
        ${buildConditionFields(ct, promo, serviceOpts)}
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Type de r\u00E9compense</label>
        <select id="promoRewardType" onchange="promoRewardChanged()" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="info_only" ${rt === 'info_only' ? 'selected' : ''}>Info seulement</option>
          <option value="free_service" ${rt === 'free_service' ? 'selected' : ''}>Service offert</option>
          <option value="discount_pct" ${rt === 'discount_pct' ? 'selected' : ''}>R\u00E9duction en %</option>
          <option value="discount_fixed" ${rt === 'discount_fixed' ? 'selected' : ''}>R\u00E9duction en \u20AC</option>
        </select>
      </div>

      <div id="promoRewardFields" style="margin-bottom:14px">
        ${buildRewardFields(rt, promo, serviceOpts)}
      </div>

      <div style="margin-bottom:14px">
        <label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Style d'affichage</label>
        <div style="display:flex;gap:10px">
          <label style="flex:1;cursor:pointer;padding:10px;border:2px solid ${ds === 'card' ? 'var(--primary)' : 'var(--border)'};border-radius:var(--radius-xs);text-align:center;font-size:.82rem;background:${ds === 'card' ? 'var(--primary-light)' : 'var(--surface)'}">
            <input type="radio" name="promoDisplay" value="card" ${ds === 'card' ? 'checked' : ''} style="display:none" onchange="promoDisplayChanged()"> Carte
          </label>
          <label style="flex:1;cursor:pointer;padding:10px;border:2px solid ${ds === 'banner' ? 'var(--primary)' : 'var(--border)'};border-radius:var(--radius-xs);text-align:center;font-size:.82rem;background:${ds === 'banner' ? 'var(--primary-light)' : 'var(--surface)'}">
            <input type="radio" name="promoDisplay" value="banner" ${ds === 'banner' ? 'checked' : ''} style="display:none" onchange="promoDisplayChanged()"> Banni\u00E8re
          </label>
        </div>
      </div>
    </div>
    <div class="m-bottom">
      <div style="flex:1"></div>
      <button class="m-btn m-btn-ghost" onclick="closeModal('promoModal')">Annuler</button>
      <button class="m-btn m-btn-primary" onclick="savePromo('${id || ''}')">${promo ? 'Enregistrer' : 'Cr\u00E9er'}</button>
    </div>
  </div>`;

  document.body.appendChild(modal);
  guardModal(document.getElementById('promoModal'), { noBackdropClose: true });
}

function buildConditionFields(type, promo, serviceOpts) {
  const cv = promo?.condition_value || '';
  switch (type) {
    case 'min_amount':
      return `<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant minimum (\u20AC)</label>
        <input type="number" id="promoConditionValue" min="0" step="0.01" value="${esc(cv)}" placeholder="50" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;
    case 'specific_service':
      return `<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Service concern\u00E9</label>
        <select id="promoConditionValue" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">-- Choisir --</option>${serviceOpts}
        </select>`;
    case 'date_range':
      return `<div style="display:flex;gap:12px">
        <div style="flex:1"><label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date de d\u00E9but</label>
          <input type="date" id="promoConditionDateStart" value="${esc(promo?.condition_date_start || '')}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box"></div>
        <div style="flex:1"><label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Date de fin</label>
          <input type="date" id="promoConditionDateEnd" value="${esc(promo?.condition_date_end || '')}" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box"></div>
      </div>`;
    default:
      return '';
  }
}

function buildRewardFields(type, promo, serviceOpts) {
  const rv = promo?.reward_value || '';
  switch (type) {
    case 'free_service':
      return `<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Service offert</label>
        <select id="promoRewardValue" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box;background:var(--surface);color:var(--text-1)">
          <option value="">-- Choisir --</option>${serviceOpts}
        </select>`;
    case 'discount_pct':
      return `<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Pourcentage de r\u00E9duction</label>
        <input type="number" id="promoRewardValue" min="1" max="100" value="${esc(rv)}" placeholder="20" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;
    case 'discount_fixed':
      return `<label style="font-size:.78rem;font-weight:600;color:var(--text-2);display:block;margin-bottom:6px">Montant de r\u00E9duction (\u20AC)</label>
        <input type="number" id="promoRewardValue" min="0" step="0.01" value="${esc(rv)}" placeholder="10" style="width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:var(--radius-xs);font-size:.85rem;box-sizing:border-box">`;
    default:
      return '';
  }
}

function promoConditionChanged() {
  const type = document.getElementById('promoConditionType').value;
  const container = document.getElementById('promoConditionFields');
  // Fetch cached serviceOpts
  const services = _serviceCache || [];
  const serviceOpts = services.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  container.innerHTML = buildConditionFields(type, null, serviceOpts);
}

function promoRewardChanged() {
  const type = document.getElementById('promoRewardType').value;
  const container = document.getElementById('promoRewardFields');
  const services = _serviceCache || [];
  const serviceOpts = services.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  container.innerHTML = buildRewardFields(type, null, serviceOpts);
}

function promoDisplayChanged() {
  const radios = document.querySelectorAll('input[name="promoDisplay"]');
  radios.forEach(r => {
    const lbl = r.closest('label');
    if (r.checked) {
      lbl.style.borderColor = 'var(--primary)';
      lbl.style.background = 'var(--primary-light)';
    } else {
      lbl.style.borderColor = 'var(--border)';
      lbl.style.background = 'var(--surface)';
    }
  });
}

async function savePromo(id) {
  const title = document.getElementById('promoTitle').value.trim();
  if (!title) { GendaUI.toast('Le titre est requis', 'error'); return; }

  const description = document.getElementById('promoDescription').value.trim();
  const conditionType = document.getElementById('promoConditionType').value;
  const rewardType = document.getElementById('promoRewardType').value;
  const displayStyle = document.querySelector('input[name="promoDisplay"]:checked')?.value || 'banner';

  const body = { title, description, condition_type: conditionType, reward_type: rewardType, display_style: displayStyle };

  // Condition fields
  if (conditionType === 'min_amount') {
    var minVal = parseFloat(document.getElementById('promoConditionValue')?.value || 0);
    body.condition_min_cents = Math.round(minVal * 100);
  } else if (conditionType === 'specific_service') {
    body.condition_service_id = document.getElementById('promoConditionValue')?.value || null;
  } else if (conditionType === 'date_range') {
    body.condition_start_date = document.getElementById('promoConditionDateStart')?.value || null;
    body.condition_end_date = document.getElementById('promoConditionDateEnd')?.value || null;
  }

  // Reward fields
  if (rewardType === 'free_service') {
    body.reward_service_id = document.getElementById('promoRewardValue')?.value || null;
  } else if (rewardType === 'discount_pct') {
    body.reward_value = parseInt(document.getElementById('promoRewardValue')?.value || 0);
  } else if (rewardType === 'discount_fixed') {
    var fixedVal = parseFloat(document.getElementById('promoRewardValue')?.value || 0);
    body.reward_value = Math.round(fixedVal * 100);
  }

  try {
    if (id) {
      await api.patch(`/api/promotions/${id}`, body);
      GendaUI.toast('Promotion mise \u00E0 jour', 'success');
    } else {
      await api.post('/api/promotions', body);
      GendaUI.toast('Promotion cr\u00E9\u00E9e', 'success');
    }
    document.getElementById('promoModal').remove();
    loadPromotions();
  } catch (e) { GendaUI.toast(e.message || 'Erreur lors de l\'enregistrement', 'error'); }
}

async function togglePromo(id, active) {
  try {
    await api.patch(`/api/promotions/${id}`, { is_active: active });
    GendaUI.toast(active ? 'Promotion activ\u00E9e' : 'Promotion d\u00E9sactiv\u00E9e', 'success');
    loadPromotions();
  } catch (e) { GendaUI.toast(e.message || 'Erreur', 'error'); }
}

async function deletePromo(id, title) {
  if (!confirm(`Supprimer d\u00E9finitivement la promotion "${title}" ? Cette action est irr\u00E9versible.`)) return;
  try {
    await api.delete(`/api/promotions/${id}`);
    GendaUI.toast('Promotion supprim\u00E9e', 'success');
    loadPromotions();
  } catch (e) { GendaUI.toast(e.message || 'Erreur lors de la suppression', 'error'); }
}

bridge({ loadPromotions, openPromoModal, savePromo, togglePromo, deletePromo, promoConditionChanged, promoRewardChanged, promoDisplayChanged });
