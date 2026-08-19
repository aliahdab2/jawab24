import { useEffect } from 'react';
// Direct imports, NOT the '@/hooks' or '@/components/ui' barrels — this hook is
// mounted from DashboardLayout, which is also the PUBLIC /pricing page's layout.
// A barrel here would land on eight public pages at once (see
// __tests__/perf/publicPageBarrels.test.ts).
import { authApi } from '@/lib/api';
import { getGaClientId } from '@/utils/analytics';

/**
 * Once per browser session, hand the GA4 client id to the backend so
 * server-side conversions can be attributed to the ad click that started the
 * session (see `backend/src/services/ga4.ts`).
 *
 * WHY A SEPARATE CALL AND NOT A LOGIN FIELD. The GA tag is deliberately loaded
 * with `strategy="lazyOnload"` — a first-paint decision, since as a plain
 * `<script async>` it was the first resource in `<head>` and cost seconds on a
 * slow link. That means the `_ga` cookie frequently does not exist yet when a
 * fast merchant submits the login form. Reading it after the authenticated
 * shell has mounted catches the users a login-time field would silently miss.
 *
 * The backend enforces first-touch (it writes only while the column is NULL),
 * so re-sending is harmless; the sessionStorage flag exists purely to avoid a
 * pointless request on every route change.
 */

/** Session-scoped marker so the POST happens at most once per tab. */
const SYNCED_FLAG = 'ga_client_id_synced';

export function useGaClientIdSync(enabled: boolean): void {
    useEffect(() => {
        if (!enabled) return;

        // Not yet authenticated, no cookie, or analytics blocked — all normal,
        // all "do nothing". This hook must never surface an error to the user;
        // a missing attribution id costs a bid signal, not a working product.
        const clientId = getGaClientId();
        if (!clientId) return;

        try {
            if (sessionStorage.getItem(SYNCED_FLAG)) return;
        } catch {
            // sessionStorage can throw in private-mode / embedded WebViews. Fall
            // through and send: the backend's first-touch guard makes a repeat a
            // no-op, so a working attribution beats skipping it to save a request.
        }

        void authApi
            .setAnalyticsClientId(clientId)
            .then(() => {
                try {
                    sessionStorage.setItem(SYNCED_FLAG, '1');
                } catch {
                    // Same tolerance as above — only the retry-suppression is lost.
                }
            })
            .catch(() => {
                // Deliberately silent. This is analytics plumbing on a
                // post-login path; a failed beacon must not produce a toast, a
                // Sentry error, or a retry loop. The next session tries again.
            });
    }, [enabled]);
}
