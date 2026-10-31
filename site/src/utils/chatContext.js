/* What the visitor is looking at, for the chat.
 *
 * Pages note the thing under the pointer (or last clicked) here; the head
 * reads it when a question is sent and passes it to the worker as
 * `context.hovered`, so "tell me about this one" has a referent. A tiny
 * module-level store rather than React context: the head and the page are
 * siblings in different parts of the tree, and the value is only ever read
 * at the moment of sending. Nothing re-renders when it changes. */

let attention = null; // { kind: "project", name, slug, at } | null
const listeners = new Set(); // the head, while it is asking the visitor to pick something

export function noteAttention(a) {
  attention = a && a.name ? { ...a, at: Date.now() } : null;
  listeners.forEach((fn) => fn(attention));
}

/** Called with every change while subscribed; returns the unsubscribe. */
export function onAttention(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getAttention() {
  return attention;
}

export function clearAttention() {
  attention = null;
}
