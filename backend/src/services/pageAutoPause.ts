import { db } from '../db';
import { pages, users, settings } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import type { DmFailureBucket } from '../utils/fbGraphErrors';
import { captureError } from '../utils/sentryHelpers';
import { logAutoReplyToggle } from './auditLog';
import { redis } from '../lib/redis';
import { notificationService } from './notifications';
import { emailService } from './email';
import { autoPausedEmailTemplate } from '../utils/emailTemplates';
import { config } from '../config';
import { handlePageTokenFailure } from './pageTokenRecovery';

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
 *  - The crossing also NOTIFIES the merchant (in-app + push to the workspace,
 *    email to the page owner) — a paused page answers nobody, and only a human
 *    re-enable brings it back, so silence here costs customers. The alert is
 *    gated to Facebook-family channels (NOTIFIABLE_AUTO_PAUSE_PLATFORMS); the
 *    pause itself still applies to every channel.
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
 * Does this platform's send use the FACEBOOK page token (`pages.access_token`)?
 *
 * Instagram does — it is columns on the page row, not a separate credential, so
 * one revoked Facebook session kills both. WhatsApp does NOT: it carries
 * `pages.whatsapp_access_token`, a separate credential on Meta's forced 60-day
 * clock with its own health cron and its own reconnect path.
 *
 * The distinction matters because Meta answers an expired WABA token with the
 * same code 190 as a revoked page token, so anything that reads a Graph code to
 * decide "this page's credential is dead" must ask which credential first.
 *
 * `undefined` = the comment pipelines, which are Facebook/Instagram-only by
 * construction (there is no WhatsApp comment adapter).
 */
export function ownsFacebookCredential(platform: string | undefined): boolean {
    return platform === undefined || platform === 'facebook' || platform === 'instagram';
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
 * The streak alerts to Sentry at escalating marks (5, 50, 500) rather than
 * once: a single missed alert on a permanently-dead channel would otherwise
 * restore exactly the blindness this exists to fix — continuing failures keep
 * refreshing the TTL, so the key never expires and a one-shot alert never
 * re-fires. A successful send on that platform deletes the key. Purely a
 * detection signal — it never gates, pauses, or retries anything.
 */
export const PLATFORM_FAILURE_ALERT_THRESHOLD = 5;
const PLATFORM_FAILURE_ALERT_MARKS: ReadonlySet<number> = new Set([PLATFORM_FAILURE_ALERT_THRESHOLD, 50, 500]);
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
                if (PLATFORM_FAILURE_ALERT_MARKS.has(streak)) {
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

/** One auto-pause email per page per 24h, across pause cycles. A merchant who
 * re-toggles without reconnecting re-pauses within minutes — they should get
 * ONE email a day about it, not one per cycle (the in-app/push notification
 * still fires each cycle, since each cycle is a deliberate merchant action). */
const AUTO_PAUSE_EMAIL_DEDUP_TTL_SECONDS = 24 * 60 * 60;
const NOTIFY_EMAIL_DEDUP_KEY = (pageId: string) => `notif:auto_pause_email:${pageId}`;

/**
 * Channels the auto-pause alert's copy is actually true for.
 *
 * Every string in that alert is Facebook-family specific — "reconnect the page",
 * "complete the Facebook sign-in", "if you changed your Facebook password". The
 * pause itself is platform-AGNOSTIC (`recordSendFailure` counts any page-level
 * failure from any channel), so without this gate a WhatsApp merchant is handed
 * instructions that are false on every clause: their credential is a separate
 * WABA token with its own reconnect flow, and reconnecting the Facebook page
 * does nothing for it.
 *
 * `undefined` is in the set on purpose: commentProcessor calls recordSendFailure
 * with no platform, and comments exist only on Facebook and Instagram.
 *
 * An ALLOWLIST, not a WhatsApp denylist — a channel added later (TikTok, webchat)
 * must default to silence rather than inheriting Facebook copy by omission.
 *
 * WhatsApp deliberately gets NOTHING here rather than something wrong. Its
 * dead-token case already alerts through its own path
 * (whatsappTokenHealth.markWhatsAppNeedsReconnect, fired on the FIRST 190 so it
 * never reaches this threshold); the remaining causes that DO reach it — WABA
 * quality restriction, policy block — need their own copy and their own recovery
 * steps, which are not guessed here.
 */
const NOTIFIABLE_AUTO_PAUSE_PLATFORMS: ReadonlySet<string | undefined> = new Set([undefined, 'facebook', 'instagram']);

export function isNotifiableAutoPausePlatform(platform: string | undefined): boolean {
    return NOTIFIABLE_AUTO_PAUSE_PLATFORMS.has(platform);
}

/**
 * Tell the humans their page just went quiet. Dashboard-banner-only proved
 * insufficient in production (2026-08-10: a page auto-paused twice in one
 * evening; the merchant learned of it from lost customers, and the recovery
 * attempt — a Facebook login/logout — was the wrong fix for lack of guidance).
 *
 * - In-app + push to the whole workspace (agencies manage merchant pages),
 *   falling back to the page owner when the page has no workspace.
 * - Email to the page OWNER only — the original connector is the one user
 *   whose re-auth can refresh the stored token (pages.ts, isOriginalConnector).
 *
 * Never throws — an alerting failure must not look like a pause failure.
 */
async function notifyMerchantAutoPaused(row: { id: string; userId: string | null; workspaceId: string | null }): Promise<void> {
    try {
        const [info] = await db
            .select({
                pageName: pages.name,
                ownerEmail: users.email,
                dashboardLanguage: settings.dashboardLanguage,
            })
            .from(pages)
            .leftJoin(users, eq(users.id, pages.userId))
            .leftJoin(settings, eq(settings.userId, pages.userId))
            .where(eq(pages.id, row.id))
            .limit(1);

        const pageName = info?.pageName ?? 'Facebook Page';
        const data = { pageId: row.id, action: 'reconnect_page', urgent: true };

        // The notification fails INDEPENDENTLY of the email. sendNotification has
        // no internal catch (a failed `notifications` insert, or the workspace
        // members query, throws straight out), so sharing this try with the email
        // made the least reliable channel a hard gate on the most important one —
        // while the dedup below deliberately fails OPEN to protect that same email.
        // Both channels now get their own shot at reaching the merchant.
        try {
            if (row.workspaceId) {
                await notificationService.sendTemplateNotificationToWorkspace(row.workspaceId, 'auto_reply_paused', { pageName }, data);
            } else if (row.userId) {
                await notificationService.sendTemplateNotification(row.userId, 'auto_reply_paused', { pageName }, data);
            }
        } catch (err) {
            captureError(err, 'pageAutoPause.autoPauseNotificationFailed', {
                tags: { component: 'pageAutoPause' },
                extra: { pageId: row.id, workspaceId: row.workspaceId, userId: row.userId },
            });
        }

        if (!row.userId || !info?.ownerEmail) return;

        // Fail OPEN when Redis is unavailable. The crossing guard in the caller
        // (`consecutiveSendFailures === PAUSE_THRESHOLD` exactly) already limits
        // this to one email per pause cycle with no Redis at all; the dedup key
        // only damps the re-toggle → re-pause loop. So a Redis blip costing the
        // merchant their most important email is a far worse trade than a second
        // email after a deliberate human re-toggle.
        let dedupKeyClaimed = false;
        try {
            const set = await redis.set(NOTIFY_EMAIL_DEDUP_KEY(row.id), '1', 'EX', AUTO_PAUSE_EMAIL_DEDUP_TTL_SECONDS, 'NX');
            if (set !== 'OK') return; // already emailed within the window
            dedupKeyClaimed = true;
        } catch {
            // Redis unreachable — send anyway (see above).
        }

        // The dedup key is released on ANY outcome that isn't a delivered email —
        // hence the `finally`, not a check on `result.success` alone.
        //
        // emailService.send fails in TWO shapes and they need identical handling:
        //   - it RESOLVES with { success: false } for a provider-level failure
        //     (Resend 4xx/5xx, unconfigured API key), and
        //   - it THROWS for a network-level one — there is no try/catch around its
        //     `fetch`, so DNS failure, socket reset, TLS error and timeout all
        //     propagate as a raw TypeError.
        // Only the first shape was released before, which left the far more likely
        // outage shape holding the key for the full 24h. The crossing guard
        // guarantees no retry inside that window, so the merchant simply never
        // heard about a page that had stopped answering.
        let emailed = false;
        let failureReason: string | undefined;
        try {
            const { subject, html } = autoPausedEmailTemplate({
                lang: info.dashboardLanguage === 'en' ? 'en' : 'ar',
                pageName,
                dashboardUrl: `${config.frontendUrl}/dashboard`,
            });
            const result = await emailService.send({ to: info.ownerEmail, subject, html, type: 'auto_pause', userId: row.userId });
            emailed = result.success;
            failureReason = result.error;
        } catch (err) {
            failureReason = err instanceof Error ? err.message : String(err);
        } finally {
            if (!emailed && dedupKeyClaimed) {
                await redis.del(NOTIFY_EMAIL_DEDUP_KEY(row.id)).catch(() => {});
            }
        }

        if (!emailed) {
            captureError(new Error(`Auto-pause email failed for page ${row.id}: ${failureReason ?? 'unknown error'}`), 'pageAutoPause.autoPauseEmailFailed', {
                tags: { component: 'pageAutoPause' },
                extra: { pageId: row.id, userId: row.userId },
            });
        }
    } catch (err) {
        captureError(err, 'pageAutoPause.notifyMerchantAutoPaused failed', {
            tags: { component: 'pageAutoPause' },
            extra: { pageId: row.id },
        });
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
    failure?: unknown,
): Promise<void> {
    // Per-platform streak first: it covers channel-level buckets the page-level
    // counter deliberately ignores (thread_owned_elsewhere), and fire-and-forget
    // so it can never block or fail the caller.
    if (platform && isChannelLevelFailure(bucket)) {
        trackPlatformFailure(pageId, platform, bucket);
    }

    // A revoked page credential is a DIFFERENT event from a page that keeps
    // getting rejected, even though both arrive here as `our_fault`. Counting to
    // ten before acting is right for the second and indefensible for the first:
    // the credential is re-mintable in one Graph call, and when it isn't, the
    // merchant is the only one who can fix it and must be told which of Meta's
    // five causes it was. Never throws, and leaves the counter logic below
    // untouched — a page whose token recovers still owes its failure count.
    //
    // ⛔ Facebook-credential platforms ONLY. WhatsApp lives on the same page row
    // but holds a SEPARATE credential (`pages.whatsapp_access_token`) on its own
    // 60-day clock, with its own health cron and its own reconnect notice
    // (whatsappAdapter → markWhatsAppNeedsReconnect). Meta answers an expired WABA
    // token with code 190 too, so without this gate a WhatsApp expiry would run
    // Facebook page-token recovery: re-minting `pages.access_token` the WhatsApp
    // failure says nothing about, and — when the user session is also gone —
    // CLEARING the Facebook token and mailing the merchant "reconnect your
    // Facebook page" to explain a WhatsApp outage.
    //
    // The gate is here rather than at the caller because this is the choke point
    // every send path flows through; a new caller cannot forget it. `undefined`
    // is the comment pipelines, which are Facebook/Instagram-only by construction
    // (there is no WhatsApp comment adapter).
    if (failure !== undefined && ownsFacebookCredential(platform)) {
        await handlePageTokenFailure(pageId, failure);
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
            // AWAITED, not fire-and-forget: both callers already dispatch
            // recordSendFailure with `void` (commentProcessor, messageProcessor),
            // so this costs the reply path nothing — and awaiting keeps the
            // notification's ~4 queries inside the caller's promise instead of
            // escaping it. The escaped version raced the integration suite's
            // per-test TRUNCATE (queries landing after the test that spawned
            // them), which is a flaky-gate generator. notifyMerchantAutoPaused
            // never throws, so this cannot fail the pause.
            //
            // The PAUSE is platform-agnostic; the ALERT is not — its copy only
            // holds for the Facebook family (see NOTIFIABLE_AUTO_PAUSE_PLATFORMS).
            if (isNotifiableAutoPausePlatform(platform)) {
                await notifyMerchantAutoPaused(row);
            }
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
