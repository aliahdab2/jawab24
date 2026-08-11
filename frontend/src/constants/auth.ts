/**
 * Authentication related constants
 */

// Shared callback path for Facebook OAuth
// Must exactly match the redirect_uri path sent during authorization
// IMPORTANT: No trailing slash - must match Facebook Developer Console settings exactly
export const FB_CALLBACK_PATH = '/auth/callback';

// Transient auth-bridge pages: they exist only to hand the session to the
// native app and navigate away within milliseconds. Shared by the _app.tsx
// deep-link handler and authManager's 401 guard (no refresh/logout there —
// a refresh's Set-Cookie can be lost mid-teardown, stranding a revoked
// token in the cookie jar; prod incident 2026-07-30).
// `/zid/embedded` belongs here for the same reason: it is the platform-dashboard
// entry point that ESTABLISHES the session. A background 401 while it is still
// exchanging Zid's token must not trigger a refresh or a logout — it would race
// the exchange and bounce the merchant out of the iframe.
export const AUTH_BRIDGE_PATHS = ['/auth/app-sync', '/auth/sync', '/zid/embedded'] as const;
