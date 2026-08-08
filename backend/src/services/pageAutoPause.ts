import { db } from '../db';
import { pages } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { DmFailureBucket } from '../utils/fbGraphErrors';
import { captureError } from '../utils/sentryHelpers';
import { logAutoReplyToggle } from './auditLog';
import { redis } from '../lib/redis';

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
 *  - At PAUSE_THRESHOLD consecutive failures, flip `auto_reply_enabled=false`,
 *    set `auto_pause_reason='send_rejected'`, and stamp
 *    `auto_reply_disabled_reason='auto_pause'` (a SYSTEM disable — comments
 *    keep being stored unreplied, see commentProcessor).
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
 * Buckets that indicate the CHANNEL is broken (as opposed to one customer
 * refusing / one expired window). Superset of the page-level set:
 * `thread_owned_elsewhere` breaks every send on its platform but must NOT
 * pause the page — the other platforms keep working (MES 2026-08: IG 100%
 * dead behind a handover conflict while Facebook served hundreds of replies).
 */
const CHANNEL_LEVEL_BUCKETS: ReadonlySet<DmFailureBucket | 'no_bucket'> = new Set([
    ...PAGE_LEVEL_BUCKETS,
    'thread_owned_elsewhere',
]);

export function isChannelLevelFailure(bucket: DmFailureBucket | undefined): boolean {
    return CHANNEL_LEVEL_BUCKETS.has(bucket ?? 'no_bucket');
}

/**
 * Per-(page, platform) consecutive send-failure streak, in Redis.
 *
 * Why this exists when `consecutive_send_failures` already does: that counter
 * is per-PAGE and resets on ANY successful send — so a page healthy on one
 * platform can mask a channel that is 100% dead on another, indefinitely.
 * That is exactly how MES's Instagram stayed silently broken for 6 days while
 * its Facebook traffic kept the page counter at zero (2026-08-08 trace).
 *
 * The streak alerts to Sentry once per streak, at the moment it crosses the
 * threshold; a successful send on that platform deletes the key. Purely a
 * detection signal — it never gates, pauses, or retries anything.
 */
export const PLATFORM_FAILURE_ALERT_THRESHOLD = 5;
const PLATFORM_FAILURE_TTL_SECONDS = 7 * 24 * 60 * 60;

export function platformSendFailureKey(pageId: string, platform: string): string {
    return `sendfail:${pageId}:${platform}`;
}

function trackPlatformFailure(pageId: string, platform: string, bucket: DmFailureBucket | undefined): void {
    // Diagnostics only — must never throw into the reply path, even with a
    // half-initialized redis client (same discipline as the §13c AI counters).
    try {
        const key = platformSendFailureKey(pageId, platform);
        redis.incr(key)
            .then(async (streak) => {
                await redis.expire(key, PLATFORM_FAILURE_TTL_SECONDS).catch(() => {});
                if (streak === PLATFORM_FAILURE_ALERT_THRESHOLD) {
                    captureError(
                        new Error(`${platform} sends have failed ${streak}× consecutively for page ${pageId} (bucket: ${bucket ?? 'no_bucket'})`),
                        'pageAutoPause.platformChannelDown',
                        {
                            tags: { component: 'pageAutoPause', platform },
                            extra: { pageId, bucket: bucket ?? 'no_bucket', consecutiveFailures: streak },
                        },
                    );
                }
            })
            .catch(() => {});
    } catch {
        // never let a metrics emit break a send-failure handler
    }
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
    platform?: string,
): Promise<void> {
    // Per-platform streak first: it covers channel-level buckets the page-level
    // counter deliberately ignores (thread_owned_elsewhere), and fire-and-forget
    // so it can never block or fail the caller.
    if (platform && isChannelLevelFailure(bucket)) {
        trackPlatformFailure(pageId, platform, bucket);
    }

    if (!isPageLevelFailure(bucket)) return;

    try {
        // Single UPDATE: bump counter, and if it would cross threshold, pause atomically.
        // The CASE WHEN means we don't need a SELECT-then-UPDATE round trip.
        const [row] = await db
            .update(pages)
            .set({
                consecutiveSendFailures: sql`${pages.consecutiveSendFailures} + 1`,
                autoReplyEnabled: sql`CASE WHEN ${pages.consecutiveSendFailures} + 1 >= ${PAUSE_THRESHOLD} THEN false ELSE ${pages.autoReplyEnabled} END`,
                // 'auto_pause' is a SYSTEM disable: the comment pipeline keeps storing
                // (but not answering) comments, and the admin UI names the cause.
                autoReplyDisabledReason: sql`CASE WHEN ${pages.consecutiveSendFailures} + 1 >= ${PAUSE_THRESHOLD} AND ${pages.autoReplyDisabledReason} IS NULL THEN 'auto_pause' ELSE ${pages.autoReplyDisabledReason} END`,
                autoPauseReason: sql`CASE WHEN ${pages.consecutiveSendFailures} + 1 >= ${PAUSE_THRESHOLD} AND ${pages.autoPauseReason} IS NULL THEN 'send_rejected' ELSE ${pages.autoPauseReason} END`,
                autoPausedAt: sql`CASE WHEN ${pages.consecutiveSendFailures} + 1 >= ${PAUSE_THRESHOLD} AND ${pages.autoPausedAt} IS NULL THEN NOW() ELSE ${pages.autoPausedAt} END`,
            })
            .where(eq(pages.id, pageId))
            .returning({
                id: pages.id,
                userId: pages.userId,
                workspaceId: pages.workspaceId,
                consecutiveSendFailures: pages.consecutiveSendFailures,
                autoReplyDisabledReason: pages.autoReplyDisabledReason,
            });

        // Audit the auto-pause the instant it trips. The counter equals exactly
        // PAUSE_THRESHOLD only on the crossing UPDATE (later failures push it past),
        // and reason == 'auto_pause' confirms THIS call flipped it (not a page the
        // merchant had already disabled). Gives support a timestamped "system paused
        // this page" event instead of only the standing reason column.
        if (
            row &&
            row.consecutiveSendFailures === PAUSE_THRESHOLD &&
            row.autoReplyDisabledReason === 'auto_pause'
        ) {
            // System disable → omit userId so `actor` derives to 'system'.
            logAutoReplyToggle({
                pageId: row.id,
                workspaceId: row.workspaceId ?? undefined,
                enabled: false,
                previous: true,
                reason: 'auto_pause',
                extra: { bucket },
            });
        }
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
export async function recordSendSuccess(pageId: string, platform?: string): Promise<void> {
    // A success on THIS platform ends this platform's streak — and only this
    // platform's. A Facebook success saying nothing about Instagram is the whole
    // point of the per-platform key (see PLATFORM_FAILURE_ALERT_THRESHOLD docs).
    if (platform) {
        try {
            redis.del(platformSendFailureKey(pageId, platform)).catch(() => {});
        } catch {
            // diagnostics only — never throw into the success path
        }
    }
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
            autoReplyDisabledReason: null,
        })
        .where(eq(pages.id, pageId));
}
