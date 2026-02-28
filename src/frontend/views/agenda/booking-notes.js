/**
 * Booking Notes - CRUD for booking notes in detail modal.
 */
import { api, calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { fcRefresh } from './calendar-init.js';

function fcRenderNotes() {
  const n = calState.fcDetailData.notes, el = document.getElementById('calNoteList');
  if (!n.length) {
    el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg></div>Aucune note</div>';
    return;
  }
  el.innerHTML = n.map(x => `<div class="note-card ${x.is_pinned ? 'pinned' : ''}"><div class="note-content">${esc(x.content)}</div><div class="note-meta">${x.author_email || 'Vous'} \u00b7 ${new Date(x.created_at).toLocaleDateString('fr-BE')}${x.is_pinned ? ' \u00b7 <svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>' : ''}</div><button class="note-delete" onclick="fcDeleteNote('${x.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
}

async function calAddNote() {
  const c = document.getElementById('calNewNote').value.trim();
  if (!c) return;
  const p = document.getElementById('calNotePinned').checked;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ content: c, is_pinned: p })
    });
    if (!r.ok) throw new Error('Erreur');
    const d = await r.json();
    calState.fcDetailData.notes.unshift(d.note);
    document.getElementById('calNewNote').value = '';
    document.getElementById('calNotePinned').checked = false;
    fcRenderNotes();
    gToast('Note ajout\u00e9e', 'success');
    fcRefresh();
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

async function fcDeleteNote(noteId) {
  try {
    await fetch(`/api/bookings/${calState.fcCurrentEventId}/notes/${noteId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    calState.fcDetailData.notes = calState.fcDetailData.notes.filter(n => n.id !== noteId);
    fcRenderNotes();
  } catch (e) { gToast('Erreur', 'error'); }
}

// Expose to global scope for onclick handlers
bridge({ calAddNote, fcDeleteNote });

export { fcRenderNotes, calAddNote, fcDeleteNote };
