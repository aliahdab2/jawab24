/**
 * One-shot handoff of a page-sync outcome from a Facebook reconnect leg to
 * `/pages`, which is the only place these refusals are rendered.
 *
 * Why a handoff instead of reporting where the sync happened: `auth/callback.tsx`
 * redirects to `/pages` under the ACCOUNT's language, which can differ from the
 * locale the callback rendered in; it has no usable workspace store, so the
 * "Switch to ‹X›" action cannot be offered; and reporting there would drag the
 * `pages` namespace into every Facebook login's payload. Reporting at the
 * destination fixes all three at once.
 *
 * `sessionStorage`, not the URL, deliberately. The messages name pages and tell
 * the merchant to upgrade or subscribe — content that must not be forgeable by
 * anyone who can get them to open a link. sessionStorage is same-origin and
 * written only by our own code; a URL parameter would let a crafted link raise
 * an authoritative-looking in-app warning.
 *
 * ⚠️ Known limit (unchanged by this module): the MOBILE reconnect leg leaves via
 * the `app-sync` App Link, and the system browser's sessionStorage is not the
 * app WebView's. Nothing client-side crosses that boundary — carrying the
 * outcome across it needs the app to re-read it from the server.
 */
import { hasRefusedPages, type PageSyncOutcome } from '@jawab24/shared';

const KEY = 'jawab24:pageSyncOutcome';

/**
 * Hand an outcome to `/pages`. No-op when nothing was refused, so the happy path
 * never leaves a stale entry for a later navigation to pick up and report.
 */
export function stashPageSyncOutcome(outcome: PageSyncOutcome | null | undefined): void {
    if (!hasRefusedPages(outcome)) return;
    try {
        window.sessionStorage.setItem(KEY, JSON.stringify(outcome));
    } catch {
        // Storage disabled / full. The outcome is an explanation, never a gate —
        // losing it must not break the redirect that follows.
    }
}

/**
 * Read and CLEAR the pending outcome. Clearing is part of the read: these toasts
 * are `duration: Infinity`, so a re-render or a second visit re-raising them
 * would stack undismissable warnings about a sync that already happened.
 */
export function takePageSyncOutcome(): PageSyncOutcome | undefined {
    try {
        const raw = window.sessionStorage.getItem(KEY);
        if (!raw) return undefined;
        window.sessionStorage.removeItem(KEY);
        const parsed = JSON.parse(raw) as PageSyncOutcome;
        return hasRefusedPages(parsed) ? parsed : undefined;
    } catch {
        // Unparseable or unavailable — drop it rather than throwing on a page load.
        try { window.sessionStorage.removeItem(KEY); } catch { /* storage gone entirely */ }
        return undefined;
    }
}
