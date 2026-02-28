/**
 * Booking Todos - CRUD for booking todos in detail modal.
 */
import { api, calState } from '../../state.js';
import { esc, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';

function fcRenderTodos() {
  const t = calState.fcDetailData.todos, el = document.getElementById('calTodoList');
  if (!t.length) {
    el.innerHTML = '<div class="cal-empty"><div class="cal-empty-icon"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg></div>Aucune t\u00e2che</div>';
    return;
  }
  el.innerHTML = t.map(x => `<div class="todo-item ${x.is_done ? 'done' : ''}"><div class="todo-check" onclick="fcToggleTodo('${x.id}',${!x.is_done})">${x.is_done ? '<svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div><span class="todo-text">${esc(x.content)}</span><button class="todo-delete" onclick="fcDeleteTodo('${x.id}')"><svg class="gi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('');
}

async function calAddTodo() {
  const c = document.getElementById('calNewTodo').value.trim();
  if (!c) return;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/todos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ content: c })
    });
    if (!r.ok) throw new Error('Erreur');
    const d = await r.json();
    calState.fcDetailData.todos.push(d.todo);
    document.getElementById('calNewTodo').value = '';
    fcRenderTodos();
    gToast('T\u00e2che ajout\u00e9e', 'success');
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
}

async function fcToggleTodo(todoId, isDone) {
  try {
    await fetch(`/api/bookings/${calState.fcCurrentEventId}/todos/${todoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ is_done: isDone })
    });
    const todo = calState.fcDetailData.todos.find(t => t.id === todoId);
    if (todo) todo.is_done = isDone;
    fcRenderTodos();
  } catch (e) { gToast('Erreur', 'error'); }
}

async function fcDeleteTodo(todoId) {
  try {
    await fetch(`/api/bookings/${calState.fcCurrentEventId}/todos/${todoId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    calState.fcDetailData.todos = calState.fcDetailData.todos.filter(t => t.id !== todoId);
    fcRenderTodos();
  } catch (e) { gToast('Erreur', 'error'); }
}

// Expose to global scope for onclick handlers
bridge({ calAddTodo, fcToggleTodo, fcDeleteTodo });

export { fcRenderTodos, calAddTodo, fcToggleTodo, fcDeleteTodo };
