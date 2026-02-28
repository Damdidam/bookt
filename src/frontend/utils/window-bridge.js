/**
 * Window Bridge — exposes module functions to window.* for onclick handlers in dynamic HTML.
 * Each view module calls bridge() to register its onclick-callable functions.
 */
export function bridge(fns) {
  for (const [name, fn] of Object.entries(fns)) {
    window[name] = fn;
  }
}
