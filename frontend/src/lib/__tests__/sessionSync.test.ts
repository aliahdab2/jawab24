import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * `syncSessionState` is the ONLY thing that re-reads `isPartner` after login.
 *
 * The bug it exists to prevent: this reconciliation used to sit behind
 * `if (!Capacitor.isNativePlatform())`, so inside the app the Partner nav entry
 * was frozen at its login-time value — on the one surface with no address bar,
 * where that entry is the only route to /partner at all. A rep registered (or
 * deactivated) after their device signed in would have needed a full re-login
 * against a 60-day token.
 */

const getProfile = vi.fn();
const updateUser = vi.fn();
const clearLocalSession = vi.fn();
let storedUser: { id?: string; isPartner?: boolean; isAdmin?: boolean } | null =
    { id: 'u-1', isPartner: false };

vi.mock('@/lib/api', () => ({ authApi: { getProfile: () => getProfile() } }));
vi.mock('@/lib/store', () => ({
    useAuthStore: { getState: () => ({ user: storedUser, updateUser }) },
}));
vi.mock('@/lib/sentryHelpers', () => ({ addErrorBreadcrumb: vi.fn() }));
vi.mock('@/lib/authManager', () => ({
    authManager: {
        clearLocalSession: (...args: unknown[]) => clearLocalSession(...args),
        signedOutPath: () => '/login',
    },
}));

// Native is the platform the old gate excluded. Pinned true for the whole
// suite: if a platform branch is ever reintroduced, every assertion below that
// expects a write starts failing here rather than silently on a device.
vi.mock('@capacitor/core', () => ({
    Capacitor: { isNativePlatform: () => true },
}));

import { syncSessionState } from '../sessionSync';

describe('syncSessionState', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storedUser = { id: 'u-1', isPartner: false };
        Object.defineProperty(window, 'location', {
            value: { href: '/admin/customers' },
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
        it('picks up admin granted after this device signed in', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isAdmin: true } });

            await syncSessionState();

            expect(updateUser).toHaveBeenCalledWith({ isAdmin: true });
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
        it('drops the local session when the server answers for another user', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2', isAdmin: false } });

            await syncSessionState();

            expect(clearLocalSession).toHaveBeenCalled();
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
         * A full page load, not a client route change: a router push leaves the
         * mounted tree holding the old user in React state.
         */
        it('sends the tab to the signed-out path with a real navigation', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2' } });

            await syncSessionState();

            expect(window.location.href).toBe('/login');
        });

        it('leaves an unchanged identity completely alone', async () => {
            getProfile.mockResolvedValueOnce({ data: { id: 'u-1', isPartner: false } });

            await syncSessionState();

            expect(clearLocalSession).not.toHaveBeenCalled();
            expect(window.location.href).toBe('/admin/customers');
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
        });

        it('does nothing when the stored user has no id', async () => {
            storedUser = { isPartner: false };
            getProfile.mockResolvedValueOnce({ data: { id: 'u-2', isPartner: false } });

            await syncSessionState();

            expect(clearLocalSession).not.toHaveBeenCalled();
        });
    });
});
