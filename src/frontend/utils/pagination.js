/**
 * Shared pagination component.
 *
 * Renders a "< Page X / Y (N total) >" bar + prev/next buttons.
 * Usage :
 *   import { renderPagination } from '../utils/pagination.js';
 *   container.innerHTML += renderPagination({
 *     total: data.pagination.total_count,
 *     limit: data.pagination.limit,
 *     offset: data.pagination.offset,
 *     onPage: 'myGoToPage'   // window-bridged function that receives offset
 *   });
 *
 * The view module must bridge `myGoToPage` to window so the inline onclick works.
 */
export function renderPagination({ total, limit, offset, onPage, label }) {
  total = parseInt(total) || 0;
  limit = parseInt(limit) || 50;
  offset = parseInt(offset) || 0;
  if (total <= limit && offset === 0) return ''; // single page, no nav needed

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const hasPrev = offset > 0;
  const hasNext = nextOffset < total;
  const shown = `${offset + 1}–${Math.min(offset + limit, total)}`;
  const labelTxt = label || 'éléments';

  return `<div class="paginate-bar" role="navigation" aria-label="Pagination" style="display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 12px;font-size:.82rem;color:var(--text-3)">
    <button class="btn-outline btn-sm" onclick="${onPage}(${prevOffset})" ${!hasPrev ? 'disabled' : ''} aria-label="Page précédente" style="${!hasPrev ? 'opacity:.4;cursor:not-allowed' : ''}">‹</button>
    <span style="min-width:140px;text-align:center">Page <strong>${currentPage}</strong> / ${totalPages} <span style="color:var(--text-4);font-size:.72rem">(${shown} sur ${total} ${labelTxt})</span></span>
    <button class="btn-outline btn-sm" onclick="${onPage}(${nextOffset})" ${!hasNext ? 'disabled' : ''} aria-label="Page suivante" style="${!hasNext ? 'opacity:.4;cursor:not-allowed' : ''}">›</button>
  </div>`;
}
