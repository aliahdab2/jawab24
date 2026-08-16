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
let storedUser: { isPartner?: boolean } | null = { isPartner: false };

vi.mock('@/lib/api', () => ({ authApi: { getProfile: () => getProfile() } }));
vi.mock('@/lib/store', () => ({
    useAuthStore: { getState: () => ({ user: storedUser, updateUser }) },
}));
vi.mock('@/lib/sentryHelpers', () => ({ addErrorBreadcrumb: vi.fn() }));

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
        storedUser = { isPartner: false };
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
});
