import { addErrorBreadcrumb } from '@/lib/sentryHelpers';

/**
 * Reconcile the standing session against the server, once per authenticated
 * page mount. Two jobs, one request to `/auth/me`:
 *
 *  1. **Session verification.** The store's `isAuthenticated` is optimistic —
 *     it renders the shell instantly from persisted state. This call is what
 *     surfaces a session the server has since revoked (the 401 interceptor in
 *     `authManager` handles the redirect).
 *  2. **Server-resolved flags.** `isPartner` is decided by the `partners` table,
 *     which an admin can change while a device stays signed in. Login is the
 *     only other place it is resolved, so without this a rep registered — or
 *     deactivated — after signing in would be stuck with the login-time value.
 *
 * ⛔ NO PLATFORM BRANCH, deliberately. Job 1 alone is web-shaped (native carries
 * a Bearer token, not an HttpOnly cookie), and the native skip that used to
 * express that also froze job 2 — on the ONE surface with no address bar, where
 * the nav entry is the only route to `/partner` at all. This adds no failure
 * mode on native: every authenticated page already issues `api` calls there, so
 * a dead session takes the same 401 path with or without this one.
 */
export async function syncSessionState(): Promise<void> {
    try {
        // Dynamic imports: `lib/api` ↔ `lib/store` is a cycle at module load.
        const [{ authApi }, { useAuthStore }] = await Promise.all([
            import('@/lib/api'),
            import('@/lib/store'),
        ]);

        const { data } = await authApi.getProfile();

        // Written only on a real change. The store is persisted, so an
        // unconditional patch would rewrite localStorage on every page mount.
        if (typeof data?.isPartner === 'boolean'
            && data.isPartner !== useAuthStore.getState().user?.isPartner) {
            useAuthStore.getState().updateUser({ isPartner: data.isPartner });
        }
    } catch {
        // A 401 is already handled by the interceptor (refresh, then logout).
        // Anything else — offline, timeout, 5xx — must leave the session alone:
        // logging a merchant out because their train went into a tunnel is a
        // far worse failure than a nav entry that updates one mount later.
        addErrorBreadcrumb('auth', 'Session verification failed');
    }
}
