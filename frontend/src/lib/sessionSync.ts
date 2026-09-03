import { addErrorBreadcrumb, captureError } from '@/lib/sentryHelpers';

/**
 * Tab-scoped, and survives a reload — exactly the lifetime the adopt-by-reload
 * below needs to guarantee it happens at most once.
 *
 * Touching `sessionStorage` THROWS outright in a partitioned or storage-blocked
 * third-party frame (see the STORAGE note in `lib/embeddedSession`), so every
 * access is guarded and a failed WRITE means "do not reload at all" rather than
 * "reload again" — otherwise a frame that denies storage would reload forever.
 */
const IDENTITY_RELOAD_KEY = 'jawab24:session-identity-reload';

function reloadAlreadyAttempted(): boolean {
    try {
        return window.sessionStorage.getItem(IDENTITY_RELOAD_KEY) === '1';
    } catch {
        return false;
    }
}

function markReloadAttempted(): boolean {
    try {
        window.sessionStorage.setItem(IDENTITY_RELOAD_KEY, '1');
        return true;
    } catch {
        return false;
    }
}

function clearReloadMarker(): void {
    try {
        window.sessionStorage.removeItem(IDENTITY_RELOAD_KEY);
    } catch {
        // Nothing to clear in a frame that denies storage.
    }
}

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
 *     signing in would be stuck with the login-time value. `isAdmin` is applied
 *     in ONE direction only; the note at the patch below says why.
 *
 * Called from BOTH protected layouts through `useSessionSync` —
 * `DashboardLayout` and `AdminLayout`, which do not nest. The admin area needs
 * it in its own right: it is the screen the cross-tab defect was reported on
 * (D-123), and with only the dashboard calling this, the identity check never
 * ran there at all.
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
         * ⛔ ADOPT the new session — do not clear. `auth-storage` is ONE
         * localStorage key for the whole browser PROFILE (`store.partialize`
         * persists `user`/`isAuthenticated`/`workspaces` on web), and the tab
         * that just signed in has already written the new user into it. So a
         * reload rebuilds THIS tab as the correct account with nothing dropped,
         * while clearing would wipe that shared key and leave the tab which
         * OWNS the live session facing a login wall on ITS next reload
         * (`pages/login` bounces on the store's `isAuthenticated`; it never
         * probes the cookie). Adopting exposes nothing new either: every
         * request from this tab was already being answered for the new user.
         *
         * Both ids required: a store predating this check, or a truncated
         * response, is missing data — not evidence of a different user.
         */
        if (data?.id && storedUser?.id && data.id !== storedUser.id) {
            // Client-only by construction — both callers are effects — but
            // asserted rather than assumed, because every recovery below is a
            // navigation and a silent clear with nowhere to go is the worst of
            // the available outcomes.
            if (typeof window === 'undefined') return;

            const { authManager } = await import('@/lib/authManager');

            // Resolved BEFORE anything is cleared. `clearLocalSession` drops
            // the embedded-platform marker that `signedOutPath()` reads back
            // through `getEmbeddedPlatform()`, so asking afterwards can only
            // ever answer `/login` — which inside a platform dashboard is the
            // sign-in prompt the embedded flow exists to remove (D-A).
            // `authManager.logout()` captures it before its own clear for
            // exactly this reason.
            const signedOutDestination = authManager.signedOutPath();

            const adopting = !reloadAlreadyAttempted();

            // An EVENT, not a breadcrumb. A breadcrumb only ever ships attached
            // to some later error, and both branches below end this document —
            // so a breadcrumb here is discarded and the product cannot count
            // how often sessions change hands. Fire-and-forget, never awaited:
            // telemetry must not delay putting the right account on screen.
            captureError(
                new Error('Session identity changed under this tab'),
                'Session identity changed under this tab',
                {
                    level: 'warning',
                    tags: { context: 'session-identity-mismatch' },
                    extra: { adopting },
                },
            );

            // At most one reload, and only once the marker WRITE has landed.
            if (adopting && markReloadAttempted()) {
                window.location.reload();
                return;
            }

            // The reload did not settle it, or storage refused the marker. The
            // persisted store was not written by a sign-in on this profile — a
            // native Bearer session, a storage-denied frame, a session handed
            // over without `setAuth` — so there is nothing correct to adopt and
            // local state has to go.
            clearReloadMarker();
            await authManager.clearLocalSession('Session identity changed — cleared local state');
            window.location.href = signedOutDestination;
            return;
        }

        // Identity agrees, so any marker left by an earlier hand-over in this
        // tab has done its job. Cleared, so a LATER hand-over gets its own
        // single reload attempt instead of going straight to the fallback.
        clearReloadMarker();

        // Written only on a real change. The store is persisted, so an
        // unconditional patch would rewrite localStorage on every page mount.
        const patch: { isPartner?: boolean; isAdmin?: boolean } = {};
        // Both directions are safe for isPartner: the server resolves it per
        // request from the `partners` table (`isPartnerUser`), so the store and
        // every gate that honours it are reading the same source.
        if (typeof data?.isPartner === 'boolean' && data.isPartner !== storedUser?.isPartner) {
            patch.isPartner = data.isPartner;
        }
        // ⛔ isAdmin moves in ONE direction here — revocation only — and the
        // asymmetry is load-bearing.
        //
        // `/auth/me` resolves isAdmin from `users.is_admin` (the database),
        // while the gate on every admin route reads the copy cached in the
        // ACCESS TOKEN ("isAdmin cached in JWT, refreshed on token rotation
        // every 15 min", backend `middleware/auth.ts`). Promoting the store
        // from the database would therefore render AdminLayout — which gates on
        // this very flag — against a session the gate still refuses: the
        // shell-renders-while-every-panel-403s state this file exists to
        // detect, manufactured through a second door, with the interceptor's
        // ADMIN_REQUIRED net writing it straight back to false. Two writers
        // flapping until the token rotates. A GRANT is picked up at the next
        // login or token rotation, which is when the gate starts honouring it.
        // A REVOCATION is always safe to apply early: the server is the
        // authority either way, and hiding the area costs nothing.
        if (data?.isAdmin === false && storedUser?.isAdmin) {
            patch.isAdmin = false;
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
