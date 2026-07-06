/**
 * Redirect-target safety check, shared by frontend and backend so the two can never
 * disagree on what counts as a safe redirect.
 *
 * Returns true ONLY for a same-origin relative path: a non-empty string that starts
 * with a single "/" and is not protocol-relative ("//host") or backslash-tricked
 * ("/\\host") — browsers resolve both of those to an EXTERNAL origin, which is the
 * open-redirect / phishing vector. A bare `startsWith('/')` check is NOT enough
 * precisely because it accepts "//evil.com".
 *
 * Callers MUST fall back to a known-safe default (e.g. "/dashboard") when this
 * returns false — never pass an untrusted value straight to router.push / redirect.
 */
export function isSafeRedirectPath(value: unknown): value is string {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (value[0] !== '/') return false; // must be relative to our own origin
    // Reject "//host" and "/\host" (and their tab/newline-obfuscated forms).
    if (value[1] === '/' || value[1] === '\\') return false;
    return true;
}
