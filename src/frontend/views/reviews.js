/**
 * Reviews (Avis clients) view module — staff dashboard.
 */
import { api, GendaUI, viewState } from '../state.js';
import { esc } from '../utils/dom.js';
import { bridge } from '../utils/window-bridge.js';
import { IC } from '../utils/icons.js';
import { showConfirmDialog } from '../utils/dirty-guard.js';
import { renderPagination } from '../utils/pagination.js';

const REVIEWS_PAGE_SIZE = 50;

/** Relative time in French */
function timeAgo(dateStr) {
  const now = Date.now();
  const d = new Date(dateStr).getTime();
  const diff = Math.max(0, now - d);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs} heure${hrs > 1 ? 's' : ''}`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(months / 12);
  return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

/** Render star rating */
function stars(rating) {
  let s = '';
  for (let i = 1; i <= 5; i++) {
    s += i <= rating
      ? `<span style="color:var(--gold)">${IC.star}</span>`
      : `<span style="color:var(--border)">${IC.star}</span>`;
  }
  return s;
}

/** Format client name: first_name + last initial */
function clientDisplayName(r) {
  const first = r.client_first_name || r.first_name || '';
  const last = r.client_last_name || r.last_name || '';
  if (!first && !last) return 'Client anonyme';
  const initial = last ? last.charAt(0).toUpperCase() + '.' : '';
  return `${first} ${initial}`.trim();
}

async function loadReviews() {
  const c = document.getElementById('contentArea');
  c.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  if (viewState.reviewsOffset === undefined) viewState.reviewsOffset = 0;
  try {
    const qs = `?limit=${REVIEWS_PAGE_SIZE}&offset=${viewState.reviewsOffset}`;
    const [rData, sData] = await Promise.all([
      api.get('/api/reviews' + qs),
      api.get('/api/reviews/stats')
    ]);
    const reviews = rData.reviews || [];
    const pag = rData.pagination || {total_count: reviews.length, limit: REVIEWS_PAGE_SIZE, offset: viewState.reviewsOffset};
    const stats = sData.stats || { total: 0, average: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } };
    const dist = stats.distribution || {};

    // Store reviews for action handlers
    viewState.reviews = reviews;

    let h = '';

    // KPIs
    h += `<div class="kpis">`;
    h += `<div class="kpi"><div class="kpi-val" style="color:var(--gold);font-size:1.8rem">${stars(Math.round(stats.average))} ${(stats.average || 0).toFixed(1)}</div><div class="kpi-label">Note moyenne</div></div>`;
    h += `<div class="kpi"><div class="kpi-val">${stats.total || 0}</div><div class="kpi-label">Total avis</div></div>`;
    h += `<div class="kpi"><div class="kpi-val" style="color:var(--green)">${dist[5] || 0}</div><div class="kpi-label">★★★★★</div></div>`;
    h += `<div class="kpi"><div class="kpi-val" style="color:var(--amber-dark)">${dist[4] || 0}</div><div class="kpi-label">★★★★☆</div></div>`;
    h += `<div class="kpi"><div class="kpi-val" style="color:var(--red)">${(dist[3] || 0) + (dist[2] || 0) + (dist[1] || 0)}</div><div class="kpi-label">≤ 3 étoiles</div></div>`;
    h += `</div>`;

    // Empty state
    if (!reviews.length) {
      h += `<div style="text-align:center;padding:60px 20px;color:var(--text-3);font-size:.88rem;line-height:1.6">`;
      h += `<div style="font-size:2.4rem;margin-bottom:12px">${IC.messageCircle}</div>`;
      h += `Aucun avis pour le moment.<br>Activez les avis dans les <strong>Paramètres</strong> pour commencer à recevoir des retours de vos clients.`;
      h += `</div>`;
      c.innerHTML = h;
      return;
    }

    // Review list
    reviews.forEach((r, i) => {
      const name = clientDisplayName(r);
      const isHidden = r.status === 'hidden';
      const hiddenStyle = isHidden ? 'opacity:.55;' : '';

      h += `<div class="card" style="margin-bottom:12px;${hiddenStyle}" id="review-card-${r.id}">`;

      // Header: stars + name + tag
      h += `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">`;
      h += `<span style="font-size:1rem;letter-spacing:1px">${stars(r.rating)}</span>`;
      h += `<strong style="color:var(--text-1);font-size:.88rem">${esc(name)}</strong>`;
      if (r.is_regular) {
        h += `<span style="font-size:.68rem;color:var(--text-3);background:var(--surface,#F3F4F6);padding:2px 8px;border-radius:20px">Cliente régulière</span>`;
      }
      if (isHidden) {
        h += `<span style="font-size:.68rem;color:var(--red);background:var(--red-bg);padding:2px 8px;border-radius:20px">Masqué</span>`;
      }
      h += `</div>`;

      // Meta: date + service + practitioner
      h += `<div style="font-size:.76rem;color:var(--text-3);margin-top:4px">`;
      h += esc(timeAgo(r.created_at));
      if (r.service_name) h += ` · ${esc(r.service_name)}`;
      if (r.practitioner_name) h += ` avec ${esc(r.practitioner_name)}`;
      h += `</div>`;

      // Comment
      if (r.comment) {
        h += `<div style="margin-top:10px;font-size:.84rem;color:var(--text-2);line-height:1.55">"${esc(r.comment)}"</div>`;
      }

      // Owner reply
      if (r.reply) {
        h += `<div style="margin-top:12px;padding:10px 14px;background:var(--surface,#F9FAFB);border-left:3px solid var(--border);border-radius:6px;font-size:.8rem;color:var(--text-2)">`;
        h += `<div style="font-weight:600;font-size:.72rem;color:var(--text-3);margin-bottom:4px">Réponse du salon</div>`;
        h += esc(r.reply);
        h += `</div>`;
      }

      // Reply textarea (hidden by default)
      h += `<div id="reply-area-${r.id}" style="display:none;margin-top:12px">`;
      h += `<textarea id="reply-text-${r.id}" style="width:100%;min-height:80px;padding:10px;border:1.5px solid var(--border);border-radius:8px;font-size:.82rem;font-family:var(--sans);resize:vertical" placeholder="Votre réponse...">${esc(r.reply || '')}</textarea>`;
      h += `<div style="display:flex;gap:8px;margin-top:8px;justify-content:flex-end">`;
      h += `<button class="btn-sm" onclick="reviewAction('cancelReply','${r.id}')">Annuler</button>`;
      h += `<button class="btn-sm active" onclick="reviewAction('submitReply','${r.id}')">Envoyer</button>`;
      h += `</div></div>`;

      // Action buttons
      h += `<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">`;
      if (r.reply) {
        h += `<button class="btn-sm" onclick="reviewAction('reply','${r.id}')">Modifier la réponse</button>`;
        h += `<button class="btn-sm" style="color:var(--red)" onclick="reviewAction('deleteReply','${r.id}')">Supprimer la réponse</button>`;
      } else {
        h += `<button class="btn-sm" onclick="reviewAction('reply','${r.id}')">Répondre</button>`;
      }
      h += `<button class="btn-sm" onclick="reviewAction('toggleHide','${r.id}','${r.status || 'published'}')">${isHidden ? 'Afficher' : 'Masquer'}</button>`;
      h += `</div>`;

      h += `</div>`;
    });

    h += renderPagination({ total: pag.total_count, limit: pag.limit, offset: pag.offset, onPage: 'reviewsGoToPage', label: 'avis' });
    c.innerHTML = h;
  } catch (e) {
    c.innerHTML = `<div class="empty">Erreur : ${esc(e.message)}</div>`;
  }
}

async function reviewAction(action, id, extra) {
  if (action === 'reply') {
    const area = document.getElementById(`reply-area-${id}`);
    if (area) area.style.display = area.style.display === 'none' ? 'block' : 'none';
    return;
  }

  if (action === 'cancelReply') {
    const area = document.getElementById(`reply-area-${id}`);
    if (area) area.style.display = 'none';
    return;
  }

  if (action === 'submitReply') {
    const text = document.getElementById(`reply-text-${id}`)?.value?.trim();
    if (!text) { GendaUI.toast('La réponse ne peut pas être vide', 'error'); return; }
    try {
      await api.patch(`/api/reviews/${id}/reply`, { reply: text });
      GendaUI.toast('Réponse enregistrée', 'success');
      loadReviews();
    } catch (e) { GendaUI.toast('Erreur : ' + e.message, 'error'); }
    return;
  }

  if (action === 'deleteReply') {
    if (!(await showConfirmDialog('Supprimer cette réponse ?'))) return;
    try {
      await api.delete(`/api/reviews/${id}/reply`);
      GendaUI.toast('Réponse supprimée', 'success');
      loadReviews();
    } catch (e) { GendaUI.toast('Erreur : ' + e.message, 'error'); }
    return;
  }

  if (action === 'toggleHide') {
    const newStatus = extra === 'hidden' ? 'published' : 'hidden';
    try {
      await api.patch(`/api/reviews/${id}/flag`, { status: newStatus });
      GendaUI.toast(newStatus === 'hidden' ? 'Avis masqué' : 'Avis affiché', 'success');
      loadReviews();
    } catch (e) { GendaUI.toast('Erreur : ' + e.message, 'error'); }
    return;
  }
}

function reviewsGoToPage(newOffset){ viewState.reviewsOffset = Math.max(0, parseInt(newOffset) || 0); loadReviews(); }

bridge({ loadReviews, reviewAction, reviewsGoToPage });

export { loadReviews, reviewAction };
