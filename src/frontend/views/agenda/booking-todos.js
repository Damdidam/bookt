/**
 * Booking Todos - CRUD for booking todos in detail modal.
 */
import { api, calState } from '../../state.js';
import { esc, safeId, gToast } from '../../utils/dom.js';
import { bridge } from '../../utils/window-bridge.js';
import { IC } from '../../utils/icons.js';

function fcRenderTodos() {
  const t = calState.fcDetailData.todos, el = document.getElementById('calTodoList');
  if (!t.length) {
    el.innerHTML = '<div class="m-empty"><div class="m-empty-icon">' + IC.checkSquare + '</div>Aucune t\u00e2che</div>';
    return;
  }
  el.innerHTML = t.map(x => `<div class="todo-item ${x.is_done ? 'done' : ''}"><div class="todo-check" onclick="fcToggleTodo('${safeId(x.id)}',${!x.is_done})">${x.is_done ? IC.check : ''}</div><span class="todo-text">${esc(x.content)}</span><button class="todo-delete" onclick="fcDeleteTodo('${safeId(x.id)}')">${IC.x}</button></div>`).join('');
}

async function calAddTodo() {
  if (calAddTodo._busy) return;
  calAddTodo._busy = true;
  try {
    const c = document.getElementById('calNewTodo').value.trim();
    if (!c) return;
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
    gToast('Tâche ajoutée', 'success');
  } catch (e) { gToast('Erreur: ' + e.message, 'error'); }
  finally { calAddTodo._busy = false; }
}

async function fcToggleTodo(todoId, isDone) {
  if (fcToggleTodo._busy) return;
  fcToggleTodo._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/todos/${todoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.getToken() },
      body: JSON.stringify({ is_done: isDone })
    });
    if (!r.ok) throw new Error('Erreur');
    const todo = calState.fcDetailData.todos.find(t => String(t.id) === String(todoId));
    if (todo) todo.is_done = isDone;
    fcRenderTodos();
  } catch (e) {
    // Revert checkbox state on error
    const todo = calState.fcDetailData.todos.find(t => String(t.id) === String(todoId));
    if (todo) todo.is_done = !isDone;
    fcRenderTodos();
    gToast('Erreur', 'error');
  } finally { fcToggleTodo._busy = false; }
}

async function fcDeleteTodo(todoId) {
  if (fcDeleteTodo._busy) return;
  fcDeleteTodo._busy = true;
  try {
    const r = await fetch(`/api/bookings/${calState.fcCurrentEventId}/todos/${todoId}`, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + api.getToken() }
    });
    if (!r.ok) throw new Error('Erreur');
    calState.fcDetailData.todos = calState.fcDetailData.todos.filter(t => String(t.id) !== String(todoId));
    fcRenderTodos();
  } catch (e) { gToast('Erreur', 'error'); }
  finally { fcDeleteTodo._busy = false; }
}

// Expose to global scope for onclick handlers
bridge({ calAddTodo, fcToggleTodo, fcDeleteTodo });

export { fcRenderTodos, calAddTodo, fcToggleTodo, fcDeleteTodo };
