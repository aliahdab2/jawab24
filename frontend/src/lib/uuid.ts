/**
 * Returns a UUID-shaped string suitable for client-generated identifiers
 * (idempotency keys, optimistic-update IDs, etc.).
 *
 * Falls back to a timestamp+random string when `crypto.randomUUID` is unavailable —
 * relevant for older Capacitor WebViews on Android. The fallback is prefixed so it
 * can never collide with a real UUID emitted elsewhere.
 */
export function newClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `cmid-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
