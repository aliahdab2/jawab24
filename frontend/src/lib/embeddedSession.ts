/**
 * Embedded-app session (Zid Merchant Dashboard iframe).
 *
 * Why this exists at all: on the web Jawab24 authenticates with HttpOnly
 * `SameSite=strict` cookies. Inside a THIRD-PARTY iframe those cookies are never
 * sent, so the cookie session — and the `/auth/refresh` rotation that depends on
 * the refresh cookie — simply do not work there. The embedded surface therefore
 * runs on Bearer tokens, exactly like the native app does.
 *
 * The durable credential is the UUID Zid hands us in the iframe URL
 * (docs.zid.sa/embedded-apps): the page trades it at `POST /zid/embedded/session`
 * for the SAME short-lived access token a normal login issues, and trades it
 * again when that token expires. No long-lived bearer token is ever minted, and
 * nothing is written to `localStorage` — `sessionStorage` keeps the credential
 * scoped to this tab, so closing the dashboard tab ends the session.
 */

const TOKEN_KEY = 'jawab24:embedded:token';
const PLATFORM_KEY = 'jawab24:embedded:platform';
const CREDENTIAL_KEY = 'jawab24:embedded:credential';

export type EmbeddedPlatform = 'zid';

function safeSessionStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    try {
        return window.sessionStorage;
    } catch {
        // Partitioned/blocked storage in a third-party frame — callers degrade
        // to a session that lasts only as long as the page is not reloaded.
        return null;
    }
}

/** True when this tab is running as an embedded app inside a platform dashboard. */
export function isEmbeddedSession(): boolean {
    return !!safeSessionStorage()?.getItem(PLATFORM_KEY);
}

export function getEmbeddedPlatform(): EmbeddedPlatform | null {
    const value = safeSessionStorage()?.getItem(PLATFORM_KEY);
    return value === 'zid' ? value : null;
}

/** The Bearer token used for API calls in the embedded surface. */
export function getEmbeddedToken(): string | null {
    return safeSessionStorage()?.getItem(TOKEN_KEY) ?? null;
}

/**
 * Record an established embedded session. `credential` is the platform's
 * iframe token (Zid's UUID) — kept so an expired access token can be re-minted
 * without asking the merchant to reopen the app.
 */
export function setEmbeddedSession(platform: EmbeddedPlatform, credential: string, token: string): void {
    const storage = safeSessionStorage();
    if (!storage) return;
    storage.setItem(PLATFORM_KEY, platform);
    storage.setItem(CREDENTIAL_KEY, credential);
    storage.setItem(TOKEN_KEY, token);
}

export function setEmbeddedToken(token: string): void {
    safeSessionStorage()?.setItem(TOKEN_KEY, token);
}

export function clearEmbeddedSession(): void {
    const storage = safeSessionStorage();
    if (!storage) return;
    storage.removeItem(PLATFORM_KEY);
    storage.removeItem(CREDENTIAL_KEY);
    storage.removeItem(TOKEN_KEY);
}

/**
 * Re-mint the access token from the stored platform credential.
 * Returns the new token, or null when the credential is gone or rejected
 * (uninstalled, rotated by a reinstall) — the caller then tells the merchant to
 * reopen the app from their dashboard, which is the only honest recovery.
 *
 * Uses `fetch` rather than the shared axios client on purpose: the client's
 * interceptor is what calls this, and routing it back through would recurse.
 */
export async function refreshEmbeddedToken(apiUrl: string): Promise<string | null> {
    const storage = safeSessionStorage();
    const credential = storage?.getItem(CREDENTIAL_KEY);
    const platform = getEmbeddedPlatform();
    if (!credential || !platform) return null;

    try {
        const response = await fetch(`${apiUrl}/${platform}/embedded/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: credential }),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { token?: string };
        if (!data.token) return null;
        setEmbeddedToken(data.token);
        return data.token;
    } catch {
        return null;
    }
}
