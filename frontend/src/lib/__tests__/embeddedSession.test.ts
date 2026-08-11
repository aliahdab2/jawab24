import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    isEmbeddedSession,
    getEmbeddedPlatform,
    getEmbeddedToken,
    setEmbeddedSession,
    setEmbeddedToken,
    clearEmbeddedSession,
    refreshEmbeddedToken,
} from '../embeddedSession';

describe('embeddedSession', () => {
    beforeEach(() => {
        // A prior test may have stubbed a throwing sessionStorage — undo that
        // before touching real storage.
        vi.unstubAllGlobals();
        try { sessionStorage.clear(); } catch { /* blocked-storage test */ }
        try { localStorage.clear(); } catch { /* ignore */ }
        vi.restoreAllMocks();
    });

    afterEach(() => {
        try { sessionStorage.clear(); } catch { /* blocked-storage test */ }
        vi.unstubAllGlobals();
    });

    it('reports no embedded session by default — the ordinary web app must be unaffected', () => {
        expect(isEmbeddedSession()).toBe(false);
        expect(getEmbeddedPlatform()).toBeNull();
        expect(getEmbeddedToken()).toBeNull();
    });

    it('records and clears a session', () => {
        setEmbeddedSession('zid', 'uuid-1', 'token-1');

        expect(isEmbeddedSession()).toBe(true);
        expect(getEmbeddedPlatform()).toBe('zid');
        expect(getEmbeddedToken()).toBe('token-1');

        clearEmbeddedSession();
        expect(isEmbeddedSession()).toBe(false);
        expect(getEmbeddedToken()).toBeNull();
    });

    it('never writes to localStorage — the credential must die with the tab', () => {
        const localSet = vi.spyOn(Storage.prototype, 'setItem');
        setEmbeddedSession('zid', 'uuid-1', 'token-1');

        // sessionStorage and localStorage share Storage.prototype, so assert on
        // the receiver rather than the call count.
        for (const call of localSet.mock.instances) {
            expect(call).toBe(sessionStorage);
        }
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('ignores an unrecognized platform value rather than trusting it', () => {
        sessionStorage.setItem('jawab24:embedded:platform', 'evil');
        expect(getEmbeddedPlatform()).toBeNull();
    });

    it('re-mints the access token from the stored credential and persists the new one', async () => {
        setEmbeddedSession('zid', 'uuid-1', 'old-token');
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ accessToken: 'new-token' }),
        });
        vi.stubGlobal('fetch', fetchMock);

        const result = await refreshEmbeddedToken('https://api.test');

        // `embeddedToken` is the credential IN; `accessToken` is the session OUT.
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.test/zid/embedded/session',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ embeddedToken: 'uuid-1' }),
            }),
        );
        expect(result).toBe('new-token');
        expect(getEmbeddedToken()).toBe('new-token');
    });

    it('returns null when the credential is rejected — a rotated or revoked token cannot self-heal', async () => {
        setEmbeddedSession('zid', 'stale-uuid', 'old-token');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));

        expect(await refreshEmbeddedToken('https://api.test')).toBeNull();
        // The old token is left as-is; the caller decides to log out.
        expect(getEmbeddedToken()).toBe('old-token');
    });

    it('returns null without a network call when there is no embedded session', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        expect(await refreshEmbeddedToken('https://api.test')).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('swallows a network failure rather than throwing into the axios interceptor', async () => {
        setEmbeddedSession('zid', 'uuid-1', 'old-token');
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

        await expect(refreshEmbeddedToken('https://api.test')).resolves.toBeNull();
    });

    it('updates only the access token when re-minting, leaving the credential intact', () => {
        setEmbeddedSession('zid', 'uuid-1', 'token-1');
        setEmbeddedToken('token-2');

        expect(getEmbeddedToken()).toBe('token-2');
        expect(getEmbeddedPlatform()).toBe('zid');
    });

    // ── H-3: a third-party frame may block sessionStorage entirely. The session
    //    must still work via an in-memory fallback — it must NOT silently no-op
    //    the write and let a later request fall through to a (nonexistent)
    //    cookie session, which produced a 401 → /login INSIDE the iframe.
    it('falls back to in-memory storage when sessionStorage is blocked, and still re-mints', async () => {
        vi.resetModules();
        // Make every sessionStorage access throw, as a partitioned frame does.
        vi.stubGlobal('sessionStorage', {
            get length() { throw new DOMException('blocked'); },
            getItem() { throw new DOMException('blocked'); },
            setItem() { throw new DOMException('blocked'); },
            removeItem() { throw new DOMException('blocked'); },
            clear() { throw new DOMException('blocked'); },
            key() { throw new DOMException('blocked'); },
        } as unknown as Storage);

        const mod = await import('../embeddedSession');
        mod.setEmbeddedSession('zid', 'uuid-mem', 'token-mem');

        // The write did NOT no-op: the session is readable from the fallback.
        expect(mod.isEmbeddedSession()).toBe(true);
        expect(mod.getEmbeddedPlatform()).toBe('zid');
        expect(mod.getEmbeddedToken()).toBe('token-mem');

        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ accessToken: 'fresh' }) });
        vi.stubGlobal('fetch', fetchMock);

        const refreshed = await mod.refreshEmbeddedToken('https://api.test');
        expect(fetchMock).toHaveBeenCalledWith(
            'https://api.test/zid/embedded/session',
            expect.objectContaining({ body: JSON.stringify({ embeddedToken: 'uuid-mem' }) }),
        );
        expect(refreshed).toBe('fresh');
        expect(mod.getEmbeddedToken()).toBe('fresh');
    });
});
