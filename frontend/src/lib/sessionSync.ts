import { addErrorBreadcrumb } from '@/lib/sentryHelpers';

/**
 * Reconcile the standing session against the server, once per authenticated
 * page mount. Three jobs, one request to `/auth/me`:
 *
 *  1. **Session verification.** The store's `isAuthenticated` is optimistic —
 *     it renders the shell instantly from persisted state. This call is what
 *     surfaces a session the server has since revoked (the 401 interceptor in
 *     `authManager` handles the redirect).
 *  2. **Identity verification.** WHO the server answered for, not merely whether
 *     it answered. See the note on `data.id` below — this is the only check in
 *     the product that can notice the session changed hands.
 *  3. **Server-resolved flags.** `isPartner` is decided by the `partners` table
 *     and `isAdmin` by `users.is_admin`, either of which an admin can change
 *     while a device stays signed in. Login is the only other place they are
 *     resolved, so without this a rep registered — or deactivated — after
 *     signing in would be stuck with the login-time value.
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
        const storedUser = useAuthStore.getState().user;

        /**
         * The server answered for somebody else.
         *
         * On web the session is an HttpOnly cookie owned by the browser
         * PROFILE, while the identity on screen — name, picture, `isAdmin` —
         * comes from the zustand store persisted in localStorage. Sign in as a
         * second account anywhere in that profile and the cookie is replaced
         * while this tab's persisted store is not, so the two disagree about
         * who is signed in. Nothing 401s: the new cookie is a perfectly valid
         * session, just not the one this tab was built for. The interceptor
         * never fires, and the tab stays wedged until someone logs out by hand
         * — the old identity in the chrome, every request answered for the new
         * one. Reported 2026-09-03 as an admin page rendering "0 customers"
         * over "Failed to load customers" (403 ADMIN_REQUIRED underneath).
         *
         * Comparing ids is the whole detection. `/auth/me` has always returned
         * `id`; this code simply threw it away.
         *
         * Local state only — see `clearLocalSession`. The cookie belongs to a
         * session the merchant is legitimately using elsewhere, so revoking it
         * to tidy up this tab is off the table. `isAuthenticated: false` then
         * sends DashboardLayout to the signed-out path, and a full page load
         * (rather than a client route change) is what guarantees no component
         * is left holding the old user in React state.
         *
         * Both ids required: a store predating this, or a truncated response,
         * is missing data — not evidence of a different user.
         */
        if (data?.id && storedUser?.id && data.id !== storedUser.id) {
            const { authManager } = await import('@/lib/authManager');
            await authManager.clearLocalSession('Session identity changed — cleared local state');
            if (typeof window !== 'undefined') {
                window.location.href = authManager.signedOutPath();
            }
            return;
        }

        // Written only on a real change. The store is persisted, so an
        // unconditional patch would rewrite localStorage on every page mount.
        const patch: { isPartner?: boolean; isAdmin?: boolean } = {};
        if (typeof data?.isPartner === 'boolean' && data.isPartner !== storedUser?.isPartner) {
            patch.isPartner = data.isPartner;
        }
        // Same staleness class as isPartner, and the one that decides whether
        // AdminLayout renders at all — it gates on the persisted flag.
        if (typeof data?.isAdmin === 'boolean' && data.isAdmin !== storedUser?.isAdmin) {
            patch.isAdmin = data.isAdmin;
        }
        if (Object.keys(patch).length > 0) {
            useAuthStore.getState().updateUser(patch);
        }
    } catch {
        // A 401 is already handled by the interceptor (refresh, then logout).
        // Anything else — offline, timeout, 5xx — must leave the session alone:
        // logging a merchant out because their train went into a tunnel is a
        // far worse failure than a nav entry that updates one mount later.
        addErrorBreadcrumb('auth', 'Session verification failed');
    }
}
