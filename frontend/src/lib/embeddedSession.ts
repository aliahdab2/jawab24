/**
 * Embedded-app session (Zid Merchant Dashboard iframe).
 *
 * Why this exists at all: on the web Jawab24 authenticates with HttpOnly
 * `SameSite=strict` cookies. Inside a THIRD-PARTY iframe those cookies are never
 * sent, so the cookie session — and the `/auth/refresh` rotation that depends on
 * the refresh cookie — simply do not work there. The embedded surface therefore
 * runs on Bearer tokens, exactly like the native app does.
 *
 * The durable credential is the UUID the platform hands us in the iframe URL
 * (docs.zid.sa/embedded-apps): the page trades it at `POST /zid/embedded/session`
 * for the SAME short-lived, workspace-scoped access token, and trades it again
 * when that token expires. No long-lived bearer token is ever minted.
 *
 * STORAGE. Preferred store is `sessionStorage` — scoped to this tab, so closing
 * the dashboard tab ends the session, and never `localStorage` (the credential
 * must not outlive the tab). But a third-party frame may PARTITION or BLOCK
 * storage entirely; there, reading storage throws or returns null. When that
 * happens we fall back to a module-level object so the session still works for
 * the life of the page. The one thing we must never do is silently no-op the
 * write and then let a later request fall through to a cookie session that a
 * cross-site frame cannot send — that produced a 401 → /login redirect INSIDE
 * the iframe, i.e. the exact "sign-in prompt" this whole feature removes.
 */

const TOKEN_KEY = 'jawab24:embedded:token';
const PLATFORM_KEY = 'jawab24:embedded:platform';
const CREDENTIAL_KEY = 'jawab24:embedded:credential';

export type EmbeddedPlatform = 'zid';

// Last-resort store when the frame denies sessionStorage. Lives only for the
// life of the page (a reload clears it) — acceptable, and far better than
// falling through to a cookie session that does not exist in this frame.
const memoryStore: Record<string, string | undefined> = {};

/** True once we have proven sessionStorage is unusable in this frame. */
let sessionStorageBlocked = false;

function trySessionStorage(): Storage | null {
    if (typeof window === 'undefined') return null;
    if (sessionStorageBlocked) return null;
    try {
        // Touch it — access alone throws in some partitioned frames.
        const s = window.sessionStorage;
        const probe = '__jawab24_probe__';
        s.setItem(probe, '1');
        s.removeItem(probe);
        return s;
    } catch {
        sessionStorageBlocked = true;
        return null;
    }
}

function readKey(key: string): string | null {
    const storage = trySessionStorage();
    if (storage) return storage.getItem(key);
    return memoryStore[key] ?? null;
}

function writeKey(key: string, value: string): void {
    const storage = trySessionStorage();
    if (storage) {
        storage.setItem(key, value);
        return;
    }
    memoryStore[key] = value;
}

function removeKey(key: string): void {
    const storage = trySessionStorage();
    if (storage) storage.removeItem(key);
    delete memoryStore[key];
}

/** True when this tab is running as an embedded app inside a platform dashboard. */
export function isEmbeddedSession(): boolean {
    return !!readKey(PLATFORM_KEY);
}

export function getEmbeddedPlatform(): EmbeddedPlatform | null {
    const value = readKey(PLATFORM_KEY);
    return value === 'zid' ? value : null;
}

/** The Bearer token used for API calls in the embedded surface. */
export function getEmbeddedToken(): string | null {
    return readKey(TOKEN_KEY);
}

/**
 * Record an established embedded session. `credential` is the platform's
 * iframe token (Zid's UUID) — kept so an expired access token can be re-minted
 * without asking the merchant to reopen the app.
 */
export function setEmbeddedSession(platform: EmbeddedPlatform, credential: string, token: string): void {
    writeKey(PLATFORM_KEY, platform);
    writeKey(CREDENTIAL_KEY, credential);
    writeKey(TOKEN_KEY, token);
}

export function setEmbeddedToken(token: string): void {
    writeKey(TOKEN_KEY, token);
}

/**
 * The stored platform credential (Zid's iframe UUID). The launchpad reads it to
 * re-establish the session when the frame remounts WITHOUT a `?token` in the
 * URL — a locale switch, or the platform re-rendering its iframe mid-visit.
 */
export function getEmbeddedCredential(): string | null {
    return readKey(CREDENTIAL_KEY);
}

export function clearEmbeddedSession(): void {
    removeKey(PLATFORM_KEY);
    removeKey(CREDENTIAL_KEY);
    removeKey(TOKEN_KEY);
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
    const credential = readKey(CREDENTIAL_KEY);
    const platform = getEmbeddedPlatform();
    if (!credential || !platform) return null;

    try {
        const response = await fetch(`${apiUrl}/${platform}/embedded/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // `embeddedToken` is the credential in; `accessToken` is the session
            // out. Distinct names so the two can't be wired backwards.
            body: JSON.stringify({ embeddedToken: credential }),
        });
        if (!response.ok) return null;
        const data = (await response.json()) as { accessToken?: string };
        if (!data.accessToken) return null;
        setEmbeddedToken(data.accessToken);
        return data.accessToken;
    } catch {
        return null;
    }
}
