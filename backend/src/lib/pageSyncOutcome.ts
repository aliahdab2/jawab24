import type { PageSyncOutcome } from '@jawab24/shared';
import type { SyncFromFacebookResult } from '../services/pages';

/**
 * Narrow a `syncFromFacebook` result to the merchant-facing "we did NOT connect
 * that page, and here is why" outcome.
 *
 * Two routes answer with this — `POST /pages/sync` (inlined at the top level)
 * and `POST /auth/facebook/link` (nested under `pageSync`, because it syncs as a
 * side effect of linking). Before this existed only the first one mapped the
 * result, so the link route — the leg a signed-in web merchant actually takes to
 * reconnect — dropped every refusal on the floor and the merchant was left with
 * fewer pages than they granted and no reason given.
 *
 * Empty lists and zero counts are omitted so `hasRefusedPages` and the frontend
 * renderer see the same "nothing to report" shape from both routes.
 */
export function toClientSyncOutcome(result: SyncFromFacebookResult): PageSyncOutcome {
    const outcome: PageSyncOutcome = {};
    if (result.skippedCount > 0) {
        outcome.skippedCount = result.skippedCount;
        outcome.skippedPages = result.skippedPages;
        outcome.skipReason = result.skipReason;
        // Only meaningful for a page-count refusal; a trial-already-used refusal
        // must not render "upgrade for more pages".
        if (result.skipReason !== 'subscription_inactive') outcome.pageLimit = result.pageLimit;
    }
    if (result.takenCount > 0) {
        outcome.takenCount = result.takenCount;
        outcome.takenPages = result.takenPages;
    }
    if ((result.trialBlockedCount ?? 0) > 0) {
        outcome.trialBlockedCount = result.trialBlockedCount;
        outcome.trialBlockedPages = result.trialBlockedPages;
    }
    if (result.alreadyMemberOf && result.alreadyMemberOf.length > 0) {
        outcome.alreadyMemberOf = result.alreadyMemberOf;
    }
    return outcome;
}
