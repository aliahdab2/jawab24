import { db } from '../db';
import { pages } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { DmFailureBucket } from '../utils/fbGraphErrors';
import { captureError } from '../utils/sentryHelpers';

/**
 * Auto-pause defense for "dead pages" — pages where Facebook persistently
 * rejects our reply sends (Page restricted/unpublished by Meta, permission
 * lost mid-flight, token usable for read but blocked for write).
 *
 * Without this, the bot keeps ingesting comments, burns AI credit generating
 * replies, then watches every send fail. The customer sees their smart-reply
 * quota drain with no visible bot activity on the Page.
 *
 * Mechanism:
 *  - On a *page-level* send failure (`our_fault` / `unknown` / `null` bucket),
 *    bump `pages.consecutive_send_failures`.
 *  - On any successful send, reset the counter to 0.
 *  - At PAUSE_THRESHOLD consecutive failures, flip `auto_reply_enabled=false`
 *    and set `auto_pause_reason='send_rejected'`.
 *  - Comment + message processors short-circuit on paused pages BEFORE the
 *    OpenAI call, so paused pages cost nothing.
 *  - Customer toggling auto-reply back on in the UI clears the counter +
 *    reason (handled in pages.ts updatePage / settings route).
 *
 * Per-customer / per-conversation failures (customer_refused, window_expired,
 * transient rate limits) are explicitly NOT counted — they don't indicate
 * the Page itself is broken.
 *
 * See docs/page-auto-pause.md for the full rationale.
 */

export const PAUSE_THRESHOLD = 10;

/** DmFailureBucket values that indicate a page-level problem, not a per-customer one. */
const PAGE_LEVEL_BUCKETS: ReadonlySet<DmFailureBucket | 'no_bucket'> = new Set([
    'our_fault',
    'unknown',
    // Comment-reply failures arrive with no bucket — treat as 'unknown'.
    'no_bucket',
]);

export function isPageLevelFailure(bucket: DmFailureBucket | undefined): boolean {
    return PAGE_LEVEL_BUCKETS.has(bucket ?? 'no_bucket');
}

/**
 * Bump the failure counter; auto-pause the page if the threshold is crossed.
 * Fire-and-forget — never blocks the reply path. Errors logged to Sentry only.
 *
 * Only call for page-level buckets (caller checks with `isPageLevelFailure`).
 */
export async function recordSendFailure(
    pageId: string,
    bucket: DmFailureBucket | undefined,
): Promise<void> {
    if (!isPageLevelFailure(bucket)) return;

    try {
        // Single UPDATE: bump counter, and if it would cross threshold, pause atomically.
        // The CASE WHEN means we don't need a SELECT-then-UPDATE round trip.
        await db
            .update(pages)
            .set({
                consecutiveSendFailures: sql`${pages.consecutiveSendFailures} + 1`,
                autoReplyEnabled: sql`CASE WHEN ${pages.consecutiveSendFailures} + 1 >= ${PAUSE_THRESHOLD} THEN false ELSE ${pages.autoReplyEnabled} END`,
                autoPauseReason: sql`CASE WHEN ${pages.consecutiveSendFailures} + 1 >= ${PAUSE_THRESHOLD} AND ${pages.autoPauseReason} IS NULL THEN 'send_rejected' ELSE ${pages.autoPauseReason} END`,
                autoPausedAt: sql`CASE WHEN ${pages.consecutiveSendFailures} + 1 >= ${PAUSE_THRESHOLD} AND ${pages.autoPausedAt} IS NULL THEN NOW() ELSE ${pages.autoPausedAt} END`,
            })
            .where(eq(pages.id, pageId));
    } catch (err) {
        captureError(err, 'pageAutoPause.recordSendFailure failed', {
            tags: { component: 'pageAutoPause' },
            extra: { pageId, bucket },
        });
    }
}

/**
 * Reset the failure counter after any successful send.
 * Does NOT clear auto_pause_reason — if a page was paused, only the customer's
 * explicit re-enable should clear it (otherwise a single stray success could
 * silently un-pause a known-bad page mid-investigation).
 *
 * Cheap guard: only writes if counter is non-zero, to avoid hot-path UPDATEs.
 */
export async function recordSendSuccess(pageId: string): Promise<void> {
    try {
        await db
            .update(pages)
            .set({ consecutiveSendFailures: 0 })
            .where(sql`${pages.id} = ${pageId} AND ${pages.consecutiveSendFailures} > 0`);
    } catch (err) {
        captureError(err, 'pageAutoPause.recordSendSuccess failed', {
            tags: { component: 'pageAutoPause' },
            extra: { pageId },
        });
    }
}

/**
 * Clear the auto-pause state when the customer manually re-enables auto-reply.
 * Called from the pages-update / settings route on the `auto_reply_enabled
 * false -> true` transition.
 */
export async function clearAutoPause(pageId: string): Promise<void> {
    await db
        .update(pages)
        .set({
            consecutiveSendFailures: 0,
            autoPauseReason: null,
            autoPausedAt: null,
        })
        .where(eq(pages.id, pageId));
}
