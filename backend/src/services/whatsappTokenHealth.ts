import { db } from '../db';
import { pages } from '../db/schema';
import { and, eq, isNotNull, lt, isNull, or, ne, sql } from 'drizzle-orm';
import { whatsappService, WhatsAppApiError, META_TOKEN_EXPIRED } from './whatsapp';
import { maybeDecryptToken } from './facebookCrypto';
import { notificationService } from './notifications';
import { captureError } from '../utils/sentryHelpers';
import { withRetry } from '../utils/retry';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

/**
 * WhatsApp Token Health Monitor
 *
 * Unlike Facebook page tokens (which expire only on password change / revoke),
 * a WhatsApp business token dies on a clock: Meta FORCES a 60-day expiry on the
 * "WhatsApp Embedded Signup" login variation — the never-expire option exists
 * only for the "General" variation, which cannot do embedded signup. There is no
 * dashboard setting that avoids this, so it has to be managed here.
 *
 * Why this matters more than it looks: when the token dies, inbound webhooks keep
 * arriving (the WABA→app subscription is a separate server-side resource and Meta
 * presents no token when delivering). So customers keep messaging and simply get
 * silence — the worst kind of failure, invisible from the outside.
 *
 * The sweep therefore does two things:
 *   1. WARNS the merchant days BEFORE expiry, while reconnecting is still painless.
 *   2. Detects an already-dead token and surfaces it instead of letting the reply
 *      pipeline discover it one burned customer message at a time.
 *
 * Health is read from Graph's debug_token, authenticated with the APP access token
 * so the checker itself can never go stale.
 */

/** Re-verify tokens that haven't been checked in this window. */
const VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** How often the cron sweeps. Matches the Facebook token-health cadence. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
/** Delay between per-page Graph calls so a large tenant can't hammer Meta. */
const PER_PAGE_DELAY_MS = 1000;
/**
 * Warn this far ahead of expiry. Comfortably wider than the sweep interval, so a
 * merchant gets several nudges (one per day, per the notification cooldown) rather
 * than a single message they might miss.
 */
const WARN_BEFORE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let logger: Logger = noopLogger;
export function setWhatsAppTokenHealthLogger(l: Logger): void { logger = l; }

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry posture for every Graph call in this sweep: a WhatsAppApiError
 * self-declares `transient` (network / 429 / 5xx) and only those are retried
 * in-sweep — a definitive 4xx cannot be fixed by retrying. Anything still
 * failing after the attempts is thrown to the per-page catch and retried on
 * the next sweep instead.
 */
const GRAPH_RETRY_OPTIONS = {
    maxAttempts: 3,
    baseDelayMs: 1000,
    maxDelayMs: 8000,
    retryableErrors: (err: unknown) => err instanceof WhatsAppApiError && err.transient,
} as const;

/**
 * Why WhatsApp was disconnected. Persisted on `pages.whatsapp_disconnect_reason`
 * so support can answer "why did this number stop replying?" with one query.
 */
export type WhatsAppDisconnectReason = 'token_expired' | 'app_uninstalled';

/**
 * Graph error codes that specifically mean "this asset is not (or no longer)
 * yours": invalid/revoked token, missing permission, or an unreachable node.
 * Only these may raise the merchant-visible reconnect banner.
 *
 * 10 = permission denied · 33 / 100 = object unsupported/missing (what a node
 * answers once the app lost access to it) · 190 = invalid OAuth token (the
 * probe authenticates with the MERCHANT token, so — unlike debug_token, where
 * 190 blames OUR app token — it is the merchant's credential being rejected).
 * The 200-series is Graph's permission-error block.
 */
const ACCESS_LOSS_META_CODES = new Set([10, 33, 100, 190]);
const isPermissionSeriesCode = (code: number) => code >= 200 && code <= 299;

/**
 * A number-node probe failure that PROVES the number is no longer reachable
 * with the merchant's (still valid) token — i.e. the WABA↔app link was severed
 * at Meta's side (coexistence unlink, partner removal).
 *
 * ALLOWLIST, not "any 4xx": `sanitizeWhatsAppError` marks every HTTP 4xx
 * non-transient, but Meta also delivers rate limiting as HTTP 400 (app-level
 * code 4, WABA BUC 80007, Cloud API 130429) and will one day answer these
 * probes with a version-deprecation 4xx. Treating any of those as access loss
 * would banner + push-notify every number in a single sweep — the estate-wide
 * false-positive class the 190 `checkerFaults` note below exists to prevent.
 * An unlisted code therefore degrades to "retry next sweep + Sentry", never to
 * a merchant-visible flag.
 */
export function isDefinitiveAccessLoss(error: unknown): error is WhatsAppApiError {
    return error instanceof WhatsAppApiError
        && !error.transient
        && typeof error.metaCode === 'number'
        && (ACCESS_LOSS_META_CODES.has(error.metaCode) || isPermissionSeriesCode(error.metaCode));
}

/**
 * True when the token is dead or dying and the merchant must act.
 * Exported for unit tests — the expiry arithmetic is the part most likely to
 * regress, and `expiresAt: undefined` (Meta's "never expires") must never be
 * treated as an expired date.
 */
export function assessToken(
    info: { isValid: boolean; expiresAt?: Date; dataAccessExpiresAt?: Date },
    now: Date = new Date(),
    /**
     * Deadline captured at Embedded Signup (`pages.whatsapp_token_expires_at`).
     * debug_token reports `expires_at: 0` for system-user tokens, so for those the
     * ES-time `expires_in` is the ONLY place the real 60-day deadline is known —
     * without folding it in here, the warning would never fire and the merchant
     * would go dark on day 60 with no notice, which is the failure this whole
     * service exists to prevent.
     */
    storedExpiresAt?: Date | null,
): { dead: boolean; expiringSoon: boolean; msUntilExpiry?: number } {
    if (!info.isValid) return { dead: true, expiringSoon: false };

    const usable = (d: Date | null | undefined): d is Date =>
        d instanceof Date && !Number.isNaN(d.getTime());

    // Only the CREDENTIAL's own expiry may declare a token dead, because "dead"
    // costs the merchant their connection.
    //
    // `data_access_expires_at` is deliberately NOT part of this. It is a separate
    // ~90-day clock governing Graph access to user data, and we have NOT verified
    // that letting it lapse blocks POST /{phone-number-id}/messages. An earlier
    // revision folded it into the dead verdict on that unverified assumption; the
    // consequence would have been brutal, because the clock is anchored to the
    // original login and is NOT reset by reconnecting — a merchant reconnecting
    // near day 90 would be disconnected again within one sweep, forever. It may
    // still warn (below), which is useful and costs nothing if the premise is wrong.
    const hardDeadlines = [info.expiresAt, storedExpiresAt].filter(usable).map(d => d.getTime());
    const warnDeadlines = [...hardDeadlines, ...[info.dataAccessExpiresAt].filter(usable).map(d => d.getTime())];

    if (warnDeadlines.length === 0) return { dead: false, expiringSoon: false };

    const msUntilExpiry = Math.min(...warnDeadlines) - now.getTime();
    const msUntilDead = hardDeadlines.length ? Math.min(...hardDeadlines) - now.getTime() : undefined;

    return {
        dead: msUntilDead !== undefined && msUntilDead <= 0,
        expiringSoon: msUntilExpiry > 0 && msUntilExpiry <= WARN_BEFORE_EXPIRY_MS,
        msUntilExpiry,
    };
}

/**
 * Check every connected WhatsApp number whose token hasn't been verified recently.
 */
export async function verifyWhatsAppTokens(): Promise<{ checked: number; expiringSoon: number; dead: number; accessLost: number; checkerFaults: number }> {
    const staleThreshold = new Date(Date.now() - VERIFY_INTERVAL_MS);
    let checked = 0;
    let expiringSoon = 0;
    let dead = 0;
    /** Token valid but the WABA/number no longer reachable — link severed at Meta. */
    let accessLost = 0;
    /** 190s caused by OUR app token, not the merchant's — see the catch below. */
    let checkerFaults = 0;

    const stalePages = await db
        .select({
            id: pages.id,
            name: pages.name,
            userId: pages.userId,
            workspaceId: pages.workspaceId,
            whatsappAccessToken: pages.whatsappAccessToken,
            whatsappDisplayPhoneNumber: pages.whatsappDisplayPhoneNumber,
            whatsappTokenExpiresAt: pages.whatsappTokenExpiresAt,
            whatsappPhoneNumberId: pages.whatsappPhoneNumberId,
        })
        .from(pages)
        .where(
            and(
                isNotNull(pages.whatsappAccessToken),
                ne(pages.whatsappAccessToken, ''),
                isNotNull(pages.userId),
                or(
                    isNull(pages.whatsappTokenLastVerifiedAt),
                    lt(pages.whatsappTokenLastVerifiedAt, staleThreshold),
                ),
            ),
        );

    if (stalePages.length === 0) {
        logger.info('[WhatsAppTokenHealth] All tokens recently verified');
        return { checked: 0, expiringSoon: 0, dead: 0, accessLost: 0, checkerFaults: 0 };
    }

    logger.info(`[WhatsAppTokenHealth] ${stalePages.length} number(s) need verification`);

    let index = 0;
    for (const page of stalePages) {
        if (index > 0) await sleep(PER_PAGE_DELAY_MS);
        index++;

        if (!page.whatsappAccessToken || !page.userId) continue;

        // A decrypt failure is a config/data problem (corrupt row, rotated key), NOT
        // an expired token. Skip without touching the token — clearing it here would
        // disconnect a perfectly live number on every sweep.
        let token: string;
        try {
            token = maybeDecryptToken(page.whatsappAccessToken);
        } catch (decryptErr) {
            captureError(decryptErr, 'WhatsApp token decryption failed — skipping verification this sweep (token NOT cleared)', {
                tags: { service: 'whatsapp-token-health' },
                extra: { pageId: page.id },
            });
            continue;
        }

        try {
            // Retry transient Graph blips so a network hiccup never masquerades as an
            // expired token. A WhatsAppApiError self-declares `transient` (network /
            // 429 / 5xx); a 4xx — including 190 — is definitive and must not be retried.
            const info = await withRetry(() => whatsappService.debugToken(token), GRAPH_RETRY_OPTIONS);

            checked++;
            const verdict = assessToken(info, new Date(), page.whatsappTokenExpiresAt);

            if (verdict.dead) {
                dead++;
                logger.warn(`[WhatsAppTokenHealth] Token dead for "${page.name}" (${page.whatsappDisplayPhoneNumber})`, {
                    isValid: info.isValid,
                    metaError: info.errorMessage,
                });
                await markWhatsAppNeedsReconnect(page, 'token_expired');
                continue;
            }

            // debug_token proves the TOKEN is alive; it says nothing about whether
            // the WABA still grants our app access. A coexistence merchant
            // unlinking from their phone (or Meta removing us as partner) leaves
            // the token valid while every webhook stops — Z net went dark for 27
            // hours this way on 2026-08-31 with the sweep reporting all-healthy.
            // Probe the number node itself with the merchant's token: a definitive
            // (non-transient) 4xx here is Meta saying the number is no longer ours.
            //
            // Same false-positive posture as everything in this file: transient
            // errors (network / 429 / 5xx) are retried, then thrown to the outer
            // catch — never flagged, and neither is any 4xx outside the
            // access-loss allowlist (see isDefinitiveAccessLoss). The bar is
            // deliberately high because an 'app_uninstalled' flag does NOT
            // self-clear on the next sweep (see the CASE below) — a wrong flag
            // here is a banner that stays until the merchant reconnects.
            const phoneNumberId = page.whatsappPhoneNumberId;
            if (phoneNumberId) {
                try {
                    await withRetry(() => whatsappService.getPhoneNumberInfo(phoneNumberId, token), GRAPH_RETRY_OPTIONS);
                } catch (probeError) {
                    if (isDefinitiveAccessLoss(probeError)) {
                        accessLost++;
                        logger.warn(`[WhatsAppTokenHealth] WABA access lost for "${page.name}" (${page.whatsappDisplayPhoneNumber}) — token valid but number no longer reachable`, {
                            metaCode: probeError.metaCode,
                            error: probeError.message,
                        });
                        await markWhatsAppNeedsReconnect(page, 'app_uninstalled');
                        continue;
                    }
                    // Transient after retries — book it with the outer catch so the
                    // sweep's error accounting stays in one place.
                    throw probeError;
                }
            }

            // Still alive: record the freshly-learned deadline so the warning fires on
            // the real date even for numbers connected before this column existed.
            await db
                .update(pages)
                .set({
                    // Never NULL a deadline we already know. debug_token reports
                    // expires_at: 0 for system-user tokens, so overwriting with null
                    // would erase the 60-day deadline captured at Embedded Signup —
                    // no warning would ever fire and the merchant would go dark on
                    // day 60 in silence, the exact failure this service prevents.
                    whatsappTokenExpiresAt: info.expiresAt ?? page.whatsappTokenExpiresAt ?? null,
                    whatsappTokenLastVerifiedAt: new Date(),
                    // Self-clear ONLY the verdicts this sweep is the oracle for.
                    // debug_token can refute its own past 'token_expired', so that
                    // clears. 'app_uninstalled' must survive a healthy-looking
                    // sweep: it is set by the PARTNER_REMOVED webhook (Meta's
                    // definitive push signal) or by support, and whether the
                    // number-node probe reliably 4xxes on a severed link is not
                    // yet proven at Meta's side — a probe that answers 200 there
                    // must not un-flag a genuinely dark number (Z net went dark
                    // 27h with every poll signal reading healthy, 2026-08-31).
                    // Only an actual reconnect (connectWhatsApp) clears it.
                    // SQL CASE, not read-then-write: a webhook flag landing
                    // between this sweep's SELECT and this UPDATE must not be
                    // overwritten either.
                    whatsappDisconnectReason: sql`CASE WHEN ${pages.whatsappDisconnectReason} = 'app_uninstalled' THEN ${pages.whatsappDisconnectReason} ELSE NULL END`,
                    updatedAt: new Date(),
                })
                .where(eq(pages.id, page.id));

            if (verdict.expiringSoon) {
                expiringSoon++;
                const days = Math.max(1, Math.ceil((verdict.msUntilExpiry ?? 0) / 86_400_000));
                logger.warn(`[WhatsAppTokenHealth] Token for "${page.name}" expires in ~${days}d — warning merchant`);
                await warnExpiringSoon(page, days);
            }
        } catch (error) {
            // A 190 here is a CHECKER fault, not a merchant fault.
            //
            // debug_token authenticates with OUR app token (`{app-id}|{app-secret}`),
            // so a wrong, rotated or restricted app secret returns 190 about the APP —
            // for every page in the loop. An earlier revision read that as "this
            // merchant's token expired" and flagged the entire estate. Rotating
            // FACEBOOK_APP_SECRET and missing an env reload is a documented recurring
            // failure in this repo, so this was reachable in the ordinary course.
            //
            // Only `is_valid: false` in a well-formed body (handled above) may declare
            // a merchant's token dead. Everything thrown here is retried next sweep.
            if (error instanceof WhatsAppApiError && error.metaCode === META_TOKEN_EXPIRED) {
                checkerFaults++;
                captureError(error, 'debug_token rejected OUR app token — check FACEBOOK_APP_SECRET, NOT the merchant', {
                    tags: { service: 'whatsapp-token-health', fault: 'checker' },
                    extra: { pageId: page.id },
                });
            } else {
                captureError(error, 'WhatsApp token verification failed (transient — retrying next sweep)', {
                    tags: { service: 'whatsapp-token-health' },
                    extra: { pageId: page.id },
                });
            }
        }
    }

    logger.info(`[WhatsAppTokenHealth] Complete: ${checked} checked, ${expiringSoon} expiring soon, ${dead} dead, ${accessLost} access lost`);
    return { checked, expiringSoon, dead, accessLost, checkerFaults };
}

/**
 * Mark a number as needing reconnection.
 *
 * Mirrors the Facebook flow (tokenRefresh.notifyReconnectNeeded): clear the stored
 * credential so `whatsappConnected` flips false and the reconnect UI appears, stamp
 * the reason for support, and notify the merchant once.
 *
 * whatsappAutoReplyEnabled is also cleared: leaving it on would keep the pipeline
 * picking up jobs it cannot possibly deliver.
 */
export async function markWhatsAppNeedsReconnect(
    page: { id: string; name: string | null; userId: string | null; whatsappDisplayPhoneNumber: string | null },
    reason: WhatsAppDisconnectReason,
): Promise<void> {
    try {
        // FLAG, never destroy.
        //
        // An earlier revision NULLed `whatsapp_access_token` here (mirroring the
        // Facebook sweep). Review found four independent ways a HEALTHY merchant
        // reaches this function — an unverified data-access assumption, a malformed
        // HTTP 200 read as `is_valid: false`, a 190 raised by our OWN app token, and
        // `safeDecryptToken` returning '' after a key misconfiguration, which sends an
        // empty bearer and earns a 190 on the first inbound message. Any one of them
        // would have destroyed the ciphertext for every connected number, unrecoverably:
        // the merchant would have to redo Embedded Signup, and Meta forces a fresh
        // 60-day clock on the way through.
        //
        // Keeping the credential turns every false positive from "catastrophic and
        // permanent" into "a banner": a false 'token_expired' clears itself on the
        // next healthy sweep, and a false 'app_uninstalled' clears on reconnect —
        // which restores nothing destructively (connectWhatsApp updates the same
        // row). The reason column — not the absence of a token — is the gate.
        //
        // whatsappAutoReplyEnabled is deliberately NOT touched either: it is the
        // merchant's own setting, and flipping it produced a broken promise (the
        // banner says "reconnect to start answering again", but reconnect had nothing
        // to restore it). Sends are gated on the reason instead.
        const [updated] = await db
            .update(pages)
            .set({
                whatsappDisconnectReason: reason,
                whatsappTokenLastVerifiedAt: new Date(),
                updatedAt: new Date(),
            })
            // Idempotency gate: only the transition into a flagged state notifies.
            // markWhatsAppNeedsReconnect is called per failed send, so N queued
            // messages meant N pushes AND N bell rows (the push cooldown does not
            // gate the bell insert). The row lock serialises concurrent workers, so
            // exactly one of them gets a row back.
            .where(and(eq(pages.id, page.id), isNull(pages.whatsappDisconnectReason)))
            .returning({ id: pages.id });

        if (!updated) return;

        if (!page.userId) return;
        const label = page.whatsappDisplayPhoneNumber || page.name || 'WhatsApp';
        // Through the template registry — the copy below used to be restated here
        // verbatim, which is how a merchant-facing string can drift from the one
        // place every other notification is translated from (Rule 10.8).
        await notificationService.sendTemplateNotification(
            page.userId,
            'whatsapp_reconnect_needed',
            { number: label },
            { action: 'reconnect_whatsapp' },
        );
    } catch (error) {
        captureError(error, 'Failed to flag WhatsApp reconnect', {
            tags: { service: 'whatsapp-token-health' },
            extra: { pageId: page.id, reason },
        });
    }
}

/**
 * Warn ahead of expiry — the token still works, so nothing is cleared here. The
 * point is to let the merchant reconnect on their own time instead of discovering
 * the outage through a customer complaint.
 */
async function warnExpiringSoon(
    page: { id: string; name: string | null; userId: string | null; whatsappDisplayPhoneNumber: string | null },
    days: number,
): Promise<void> {
    if (!page.userId) return;
    try {
        const label = page.whatsappDisplayPhoneNumber || page.name || 'WhatsApp';
        await notificationService.sendTemplateNotification(
            page.userId,
            'whatsapp_token_expiring',
            { number: label, days: String(days) },
            { action: 'reconnect_whatsapp' },
        );
    } catch (error) {
        captureError(error, 'Failed to send WhatsApp expiry warning', {
            tags: { service: 'whatsapp-token-health' },
            extra: { pageId: page.id },
        });
    }
}

export function startWhatsAppTokenHealthCron(): void {
    if (intervalHandle) return;
    logger.info(`[WhatsAppTokenHealth] Cron started — sweeps every ${SWEEP_INTERVAL_MS / 3600000}h, re-checks tokens older than ${VERIFY_INTERVAL_MS / 3600000}h, warns ${WARN_BEFORE_EXPIRY_MS / 86400000}d ahead`);
    intervalHandle = setInterval(() => {
        verifyWhatsAppTokens().catch(err => {
            captureError(err, 'WhatsApp token health cron failed', { tags: { service: 'whatsapp-token-health' } });
        });
    }, SWEEP_INTERVAL_MS);
}

export function stopWhatsAppTokenHealthCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
