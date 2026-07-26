import { db } from '../db';
import { pages } from '../db/schema';
import { and, eq, isNotNull, lt, isNull, or, ne } from 'drizzle-orm';
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
 * Why WhatsApp was disconnected. Persisted on `pages.whatsapp_disconnect_reason`
 * so support can answer "why did this number stop replying?" with one query.
 */
export type WhatsAppDisconnectReason = 'token_expired' | 'app_uninstalled';

/**
 * True when the token is dead or dying and the merchant must act.
 * Exported for unit tests — the expiry arithmetic is the part most likely to
 * regress, and `expiresAt: undefined` (Meta's "never expires") must never be
 * treated as an expired date.
 */
export function assessToken(
    info: { isValid: boolean; expiresAt?: Date; dataAccessExpiresAt?: Date },
    now: Date = new Date(),
): { dead: boolean; expiringSoon: boolean; msUntilExpiry?: number } {
    if (!info.isValid) return { dead: true, expiringSoon: false };

    // Two INDEPENDENT clocks: the credential itself (expires_at) and the app's
    // access to the customer's data (data_access_expires_at, ~90 days). Either can
    // fire first, so the earlier one governs. Both undefined ⇒ nothing to warn about.
    const deadlines = [info.expiresAt, info.dataAccessExpiresAt]
        .filter((d): d is Date => d instanceof Date && !Number.isNaN(d.getTime()))
        .map(d => d.getTime());

    if (deadlines.length === 0) return { dead: false, expiringSoon: false };

    const msUntilExpiry = Math.min(...deadlines) - now.getTime();
    return {
        dead: msUntilExpiry <= 0,
        expiringSoon: msUntilExpiry > 0 && msUntilExpiry <= WARN_BEFORE_EXPIRY_MS,
        msUntilExpiry,
    };
}

/**
 * Check every connected WhatsApp number whose token hasn't been verified recently.
 */
export async function verifyWhatsAppTokens(): Promise<{ checked: number; expiringSoon: number; dead: number }> {
    const staleThreshold = new Date(Date.now() - VERIFY_INTERVAL_MS);
    let checked = 0;
    let expiringSoon = 0;
    let dead = 0;

    const stalePages = await db
        .select({
            id: pages.id,
            name: pages.name,
            userId: pages.userId,
            workspaceId: pages.workspaceId,
            whatsappAccessToken: pages.whatsappAccessToken,
            whatsappDisplayPhoneNumber: pages.whatsappDisplayPhoneNumber,
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
        return { checked: 0, expiringSoon: 0, dead: 0 };
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
            const info = await withRetry(
                () => whatsappService.debugToken(token),
                {
                    maxAttempts: 3,
                    baseDelayMs: 1000,
                    maxDelayMs: 8000,
                    retryableErrors: (err) => err instanceof WhatsAppApiError && err.transient,
                },
            );

            checked++;
            const verdict = assessToken(info);

            if (verdict.dead) {
                dead++;
                logger.warn(`[WhatsAppTokenHealth] Token dead for "${page.name}" (${page.whatsappDisplayPhoneNumber})`, {
                    isValid: info.isValid,
                    metaError: info.errorMessage,
                });
                await markWhatsAppNeedsReconnect(page, 'token_expired');
                continue;
            }

            // Still alive: record the freshly-learned deadline so the warning fires on
            // the real date even for numbers connected before this column existed.
            await db
                .update(pages)
                .set({
                    whatsappTokenExpiresAt: info.expiresAt ?? null,
                    whatsappTokenLastVerifiedAt: new Date(),
                    whatsappDisconnectReason: null,
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
            // A definitive 190 here means the token is already dead — same treatment as
            // is_valid:false. Anything else (transient, unrecognised) is left alone and
            // retried next sweep rather than disconnecting a possibly-healthy number.
            if (error instanceof WhatsAppApiError && error.metaCode === META_TOKEN_EXPIRED) {
                dead++;
                logger.warn(`[WhatsAppTokenHealth] 190 on debug_token for "${page.name}" — treating as expired`);
                await markWhatsAppNeedsReconnect(page, 'token_expired');
            } else {
                captureError(error, 'WhatsApp token verification failed (transient — retrying next sweep)', {
                    tags: { service: 'whatsapp-token-health' },
                    extra: { pageId: page.id },
                });
            }
        }
    }

    logger.info(`[WhatsAppTokenHealth] Complete: ${checked} checked, ${expiringSoon} expiring soon, ${dead} dead`);
    return { checked, expiringSoon, dead };
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
        await db
            .update(pages)
            .set({
                whatsappAccessToken: null,
                whatsappAutoReplyEnabled: false,
                whatsappDisconnectReason: reason,
                whatsappTokenLastVerifiedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(pages.id, page.id));

        if (!page.userId) return;
        const label = page.whatsappDisplayPhoneNumber || page.name || 'WhatsApp';
        await notificationService.sendNotification(page.userId, {
            type: 'whatsapp_reconnect_needed',
            titles: { en: 'WhatsApp Reconnection Needed', ar: 'يلزم إعادة ربط واتساب' },
            bodies: {
                en: `Your WhatsApp connection for ${label} has expired. Reconnect to keep replying to your customers.`,
                ar: `انتهت صلاحية ربط واتساب للرقم ${label}. أعد الربط لمتابعة الرد على عملائك.`,
            },
            data: { action: 'reconnect_whatsapp' },
        });
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
        await notificationService.sendNotification(page.userId, {
            type: 'whatsapp_token_expiring',
            titles: { en: 'WhatsApp Connection Expiring', ar: 'ربط واتساب على وشك الانتهاء' },
            bodies: {
                en: `Your WhatsApp connection for ${label} expires in ${days} day(s). Reconnect now so replies never stop.`,
                ar: `ينتهي ربط واتساب للرقم ${label} خلال ${days} يوم. أعد الربط الآن حتى لا تتوقف الردود.`,
            },
            data: { action: 'reconnect_whatsapp' },
        });
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
