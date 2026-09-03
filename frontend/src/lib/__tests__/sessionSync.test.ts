import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `syncSessionState` is the ONLY thing that re-reads `isPartner` after login,
 * and the only thing anywhere that can notice the session changed hands.
 *
 * The bug the flag half exists to prevent: this reconciliation used to sit
 * behind `if (!Capacitor.isNativePlatform())`, so inside the app the Partner
 * nav entry was frozen at its login-time value — on the one surface with no
 * address bar, where that entry is the only route to /partner at all. A rep
 * registered (or deactivated) after their device signed in would have needed a
 * full re-login against a 60-day token.
 */

const getProfile = vi.fn();
const updateUser = vi.fn();
const captureError = vi.fn();

// Call ORDER is load-bearing in the fallback path — see the ordering test — so
// the authManager mock records the sequence rather than just the calls.
const authCalls: string[] = [];
const clearLocalSession = vi.fn(async (..._args: unknown[]) => {
    authCalls.push('clearLocalSession');
});
const signedOutPath = vi.fn(() => {
    authCalls.push('signedOutPath');
    return '/login';
});

let storedUser: { id?: string; isPartner?: boolean; isAdmin?: boolean } | null =
    { id: 'u-1', isPartner: false };

vi.mock('@/lib/api', () => ({ authApi: { getProfile: () => getProfile() } }));
vi.mock('@/lib/store', () => ({
    useAuthStore: { getState: () => ({ user: storedUser, updateUser }) },
}));
// ⛔ EXHAUSTIVE: a factory mock replaces the module wholesale, so every export
// sessionSync imports must be listed. Omit one and the failure is a TypeError
// mid-reconciliation, swallowed by this file's own catch — i.e. a GREEN suite
// for a session check that never ran.
vi.mock('@/lib/sentryHelpers', () => ({
    addErrorBreadcrumb: vi.fn(),
    captureError: (...args: unknown[]) => captureError(...args),
}));
vi.mock('@/lib/authManager', () => ({
    authManager: {
        clearLocalSession: (...args: unknown[]) => clearLocalSession(...args),
        signedOutPath: () => signedOutPath(),
    },
}));

// Native is the platform the old gate excluded. Pinned true for the whole
// suite: if a platform branch is ever reintroduced, every assertion below that
// expects a write starts failing here rather than silently on a device.
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true },
}));

import { syncSessionState } from '../sessionSync';

const RELOAD_MARKER = 'jawab24:session-identity-reload';

describe('syncSessionState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        authCalls.length = 0;
        storedUser = { id: 'u-1', isPartner: false };
        window.sessionStorage.clear();
        Object.defineProperty(window, 'location', {
            value: { href: '/admin/customers', reload: vi.fn() },
            writable: true,
        });
    });

    it('picks up a partner registered after this device signed in', async () => {
        getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isPartner: true } });

        await syncSessionState();

        expect(updateUser).toHaveBeenCalledWith({ isPartner: true });
    });

    it('drops the entry when the rep is deactivated', async () => {
        storedUser = { isPartner: true };
        getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isPartner: false } });

        await syncSessionState();

        expect(updateUser).toHaveBeenCalledWith({ isPartner: false });
    });

    /**
     * The store is persisted to localStorage. An unconditional patch would
     * rewrite it on every authenticated page mount for every user in the
     * product, to store the value it already held.
     */
    it('writes nothing when the answer is unchanged', async () => {
        getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isPartner: false } });

        await syncSessionState();

        expect(updateUser).not.toHaveBeenCalled();
    });

    /**
     * A session persisted before `isPartner` existed has no such field, and an
     * older backend omits it from /auth/me. Neither is "the user is not a
     * partner" — writing `undefined` in would be a guess.
     */
    it('leaves the flag alone when the server does not report one', async () => {
        getProfile.mockResolvedValueOnce({ data: { id: 'u-1' } });

        await syncSessionState();

        expect(updateUser).not.toHaveBeenCalled();
    });

    /**
     * Offline / timeout / 5xx must never touch the session. The 401 case is the
     * interceptor's job (refresh, then logout) — swallowing here would not
     * prevent it, and throwing would surface an unhandled rejection on every
     * page mount in a tunnel.
     */
    it('swallows a failed profile call without touching the store', async () => {
        getProfile.mockRejectedValueOnce(new Error('Network Error'));

        await expect(syncSessionState()).resolves.toBeUndefined();
        expect(updateUser).not.toHaveBeenCalled();
    });

    /**
     * `isAdmin` is the same staleness class as `isPartner` and was being
     * discarded from the same response. It decides whether AdminLayout renders
     * at all, so a stale `true` is what produced a fully-rendered admin area in
     * which every panel 403'd.
     */
    describe('isAdmin', () => {
        /**
         * ⛔ Revocation only, and the asymmetry is the point.
         *
         * /auth/me answers from `users.is_admin`; the gate on every admin route
         * reads the copy cached in the ACCESS TOKEN, which lags a promotion by
         * up to 15 minutes. Writing `true` here would render AdminLayout — it
         * gates on this flag — against a session the backend still refuses,
         * which IS the "shell renders, every panel 403s" defect this file
         * exists to detect, and the interceptor's ADMIN_REQUIRED net would
         * write it straight back to false: two writers flapping until the token
         * rotates. The grant arrives at the next login or rotation instead.
         */
        it('does not promote a grant the admin gate will still refuse', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isAdmin: true } });

            await syncSessionState();

            expect(updateUser).not.toHaveBeenCalled();
        });

        it('drops admin revoked after this device signed in', async () => {
            storedUser = { id: 'u-1', isAdmin: true };
            getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isAdmin: false } });

            await syncSessionState();

            expect(updateUser).toHaveBeenCalledWith({ isAdmin: false });
        });

        it('patches both flags in one write when both drifted', async () => {
            storedUser = { id: 'u-1', isPartner: false, isAdmin: true };
            getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isPartner: true, isAdmin: false } });

            await syncSessionState();

            expect(updateUser).toHaveBeenCalledTimes(1);
            expect(updateUser).toHaveBeenCalledWith({ isPartner: true, isAdmin: false });
        });
    });

    /**
     * The reported bug (2026-09-03). On web the session is an HttpOnly cookie
     * owned by the browser PROFILE while the identity on screen comes from
     * localStorage, so signing in as a second account anywhere in that profile
     * leaves this tab's store describing one user and its cookie another.
     * Nothing 401s — the new cookie is a valid session — so before this check
     * there was no code anywhere that could notice.
     */
    describe('identity mismatch', () => {
        /**
         * ⛔ ADOPT, don't clear. `auth-storage` is ONE localStorage key for the
         * whole browser profile, and the tab that just signed in already wrote
         * the new user into it — so a reload rebuilds this tab as the correct
         * account. Clearing instead would wipe that shared key and leave the
         * tab which OWNS the live session facing a login wall on its next
         * reload, with a perfectly valid cookie.
         */
        it('adopts the new session with a reload, touching no shared state', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2', isAdmin: false } });

            await syncSessionState();

            expect(window.location.reload).toHaveBeenCalled();
            expect(clearLocalSession).not.toHaveBeenCalled();
            expect(window.location.href).toBe('/admin/customers');
        });

        it('marks the attempt so the reload can happen at most once', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2' } });

            await syncSessionState();

            expect(window.sessionStorage.getItem(RELOAD_MARKER)).toBe('1');
        });

        /**
         * The reload did not settle it — the persisted store was not written by
         * a sign-in on this profile (a native Bearer session, a session handed
         * over without `setAuth`). There is nothing correct to adopt, so local
         * state goes.
         */
        it('falls back to dropping local state when the reload did not settle it', async () => {
            window.sessionStorage.setItem(RELOAD_MARKER, '1');
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2' } });

            await syncSessionState();

            expect(window.location.reload).not.toHaveBeenCalled();
            expect(clearLocalSession).toHaveBeenCalled();
            expect(window.location.href).toBe('/login');
        });

        /**
         * ⛔ `signedOutPath()` MUST be resolved before the clear.
         * `clearLocalSession` drops the embedded-platform marker that
         * `signedOutPath` reads back, so asking afterwards can only ever answer
         * `/login` — which inside a platform dashboard is the sign-in prompt
         * the embedded flow exists to remove (D-A). `authManager.logout()`
         * captures it before its own clear for exactly this reason.
         */
        it('resolves the destination before clearing anything', async () => {
            window.sessionStorage.setItem(RELOAD_MARKER, '1');
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2' } });

            await syncSessionState();

            expect(authCalls).toEqual(['signedOutPath', 'clearLocalSession']);
        });

        /**
         * A frame that denies storage cannot hold the marker, so the reload
         * could never be bounded — it would loop forever. A failed WRITE means
         * "do not reload at all", not "reload again".
         */
        it('never reloads when the marker cannot be written', async () => {
            // ⛔ The PROTOTYPE, not the instance. jsdom's Storage is a Proxy
            // whose set trap turns `sessionStorage.setItem = fn` into a stored
            // ITEM called "setItem", leaving the real method in place — so an
            // instance spy here reads as installed and does nothing, and this
            // test passed while asserting the opposite of the truth.
            const setItem = vi.spyOn(Storage.prototype, 'setItem')
                .mockImplementation(() => { throw new Error('storage denied'); });
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2' } });

            try {
                // The stub is the whole premise; prove it bites before relying
                // on it.
                expect(() => window.sessionStorage.setItem('probe', '1')).toThrow();

                await syncSessionState();

                expect(window.location.reload).not.toHaveBeenCalled();
                expect(clearLocalSession).toHaveBeenCalled();
            } finally {
                setItem.mockRestore();
            }
        });

        /**
         * ⛔ The stale flags must NOT be patched onto the old user instead:
         * that would leave the previous account's name, picture and workspaces
         * on screen and merely stop the admin shell from rendering — the crossed
         * state, tidied up.
         */
        it('does not try to patch flags onto the departed user', async () => {
            storedUser = { id: 'u-1', isAdmin: true };
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2', isAdmin: false } });

            await syncSessionState();

            expect(updateUser).not.toHaveBeenCalled();
        });

        /**
         * A breadcrumb would be discarded: it only ever ships attached to a
         * later error, and both recoveries end this document. Without an event
         * the product cannot count how often sessions change hands — which is
         * why the original report's 403 could only ever be inferred.
         */
        it('reports the hand-over as its own event', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2' } });

            await syncSessionState();

            expect(captureError).toHaveBeenCalledWith(
                expect.any(Error),
                expect.any(String),
                expect.objectContaining({
                    tags: { context: 'session-identity-mismatch' },
                    extra: { adopting: true },
                }),
            );
        });

        it('leaves an unchanged identity completely alone', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isPartner: false } });

            await syncSessionState();

            expect(clearLocalSession).not.toHaveBeenCalled();
            expect(window.location.reload).not.toHaveBeenCalled();
            expect(window.location.href).toBe('/admin/customers');
        });

        /**
         * A marker left by an earlier hand-over must not send the NEXT one
         * straight to the fallback — the tab has since settled, so the next
         * hand-over is entitled to its own single reload.
         */
        it('clears a spent marker once the identity agrees', async () => {
            window.sessionStorage.setItem(RELOAD_MARKER, '1');
            getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isPartner: false } });

            await syncSessionState();

            expect(window.sessionStorage.getItem(RELOAD_MARKER)).toBeNull();
        });

        /**
         * Missing data is not evidence of a different user. A response without
         * an `id` (older backend, truncated payload) or a store predating this
         * check must never be read as "the session changed hands" — that would
         * sign merchants out of working sessions.
         */
        it('does nothing when the server reports no id', async () => {
            getProfile.mockResolvedValueOnce({ data: { isPartner: false } });

            await syncSessionState();

            expect(clearLocalSession).not.toHaveBeenCalled();
            expect(window.location.reload).not.toHaveBeenCalled();
        });

        it('does nothing when the stored user has no id', async () => {
            storedUser = { isPartner: false };
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2', isPartner: false } });

            await syncSessionState();

            expect(clearLocalSession).not.toHaveBeenCalled();
            expect(window.location.reload).not.toHaveBeenCalled();
        });
    });
});
