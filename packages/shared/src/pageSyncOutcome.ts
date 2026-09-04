import type { NoPagesReason } from './activation';

/**
 * The "we did NOT connect that page, and here is why" half of a page sync.
 *
 * A sync can answer 200 and still REFUSE pages — the plan's page limit was
 * reached, the channel already used its free trial under another identity, or
 * another workspace holds the page. Those reasons ride in the response body and
 * are the only thing standing between the merchant and "I granted two pages and
 * only got one, with no explanation" (observed 2026-09-04, Starter workspace at
 * `max_pages = 1`).
 *
 * Two backend routes produce it — `POST /pages/sync` inlines these fields at the
 * top level, and `POST /auth/facebook/link` nests them under `pageSync` because
 * it syncs server-side as a side effect of linking. The type lives here so the
 * two emit sites and the single frontend renderer (`features/pageSync`) cannot
 * drift; a field added on one side without the other is a compile error.
 */
export type PageSyncOutcome = {
    /** Set only when the sync connected nothing AND Facebook returned no pages. */
    reason?: NoPagesReason | null;
    /** Pages withheld because another workspace holds them (D-039: names only, never the holder). */
    takenCount?: number;
    takenPages?: { pageName: string }[];
    /** Taken pages whose holding workspace the syncing user already belongs to — offer a switch. */
    alreadyMemberOf?: { workspaceId: string; workspaceName: string; role: string; pageName: string }[];
    /** Pages connected but kept OFF: the channel already used its free trial elsewhere. */
    trialBlockedCount?: number;
    trialBlockedPages?: { pageName: string }[];
    /** Pages REFUSED at connect (never persisted). `skipReason` decides the call to action. */
    skippedCount?: number;
    skippedPages?: { pageName: string }[];
    skipReason?: 'subscription_inactive' | 'page_limit';
    /** The plan's page cap; null on an unlimited plan. Only meaningful with `skipReason: 'page_limit'`. */
    pageLimit?: number | null;
};

/**
 * True when the outcome carries something the merchant must be told about.
 *
 * Both the backend (decide whether to attach `pageSync` to a link response) and
 * the frontend (decide whether to stash an outcome for the destination page)
 * answer the same question, so they ask it in one place. An outcome that fails
 * this predicate is a fully successful sync and must produce NO message —
 * a "nothing was refused" toast is noise on the happy path.
 */
export function hasRefusedPages(outcome: PageSyncOutcome | null | undefined): boolean {
    if (!outcome) return false;
    return Boolean(
        (outcome.skippedCount ?? 0) > 0 ||
        (outcome.takenCount ?? 0) > 0 ||
        (outcome.trialBlockedCount ?? 0) > 0 ||
        (outcome.alreadyMemberOf?.length ?? 0) > 0,
    );
}
