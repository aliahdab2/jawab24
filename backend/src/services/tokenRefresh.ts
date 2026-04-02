import { db } from '../db';
import { pages, users } from '../db/schema';
import { and, ne, eq, isNotNull, lt, isNull, or } from 'drizzle-orm';
import { facebookService } from './facebook';
import { maybeEncryptToken } from './facebookCrypto';
import { notificationService } from './notifications';
import { captureError } from '../utils/sentryHelpers';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

/**
 * Facebook Token Health Monitor
 *
 * Page access tokens obtained from a long-lived user token do NOT expire by time.
 * They only become invalid when the user changes their Facebook password, revokes
 * app permissions, or the app loses approval.
 *
 * This service periodically verifies tokens are still valid using Facebook's
 * debug_token API, and notifies users to reconnect when tokens are found invalid.
 * If the user's long-lived token is still valid, it also re-fetches fresh page
 * tokens via /me/accounts to keep them up to date.
 */

/** Re-verify tokens that haven't been checked in this window. */
const VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** How often the cron sweeps. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
/** Delay between per-user checks to avoid hammering Facebook's API. */
const PER_USER_DELAY_MS = 2000;

let logger: Logger = noopLogger;
export function setTokenRefreshLogger(l: Logger): void { logger = l; }

let intervalHandle: ReturnType<typeof setInterval> | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Find pages whose tokens haven't been verified recently and check
 * they're still valid via Facebook's debug_token + /me/accounts APIs.
 */
async function verifyAndRefreshTokens(): Promise<{ verified: number; refreshed: number; invalid: number }> {
    const staleThreshold = new Date(Date.now() - VERIFY_INTERVAL_MS);
    let verified = 0;
    let refreshed = 0;
    let invalid = 0;

    // Find active pages that haven't been verified recently
    const stalePages = await db
        .select({
            id: pages.id,
            facebookPageId: pages.facebookPageId,
            name: pages.name,
            accessToken: pages.accessToken,
            userId: pages.userId,
        })
        .from(pages)
        .where(
            and(
                ne(pages.accessToken, ''),
                isNotNull(pages.userId),
                or(
                    isNull(pages.tokenLastVerifiedAt),
                    lt(pages.tokenLastVerifiedAt, staleThreshold),
                ),
            )
        );

    if (stalePages.length === 0) {
        logger.info('[TokenHealth] All tokens recently verified');
        return { verified: 0, refreshed: 0, invalid: 0 };
    }

    logger.info(`[TokenHealth] ${stalePages.length} page(s) need token verification`);

    // Group by userId for efficient batch processing
    const pagesByUser = new Map<string, typeof stalePages>();
    for (const page of stalePages) {
        if (!page.userId) continue;
        const group = pagesByUser.get(page.userId) || [];
        group.push(page);
        pagesByUser.set(page.userId, group);
    }

    let userIndex = 0;
    for (const [userId, userPages] of pagesByUser) {
        // Rate-limit Facebook API calls between users
        if (userIndex > 0) await sleep(PER_USER_DELAY_MS);
        userIndex++;

        try {
            // 1. Check if user's own token is still valid
            const [user] = await db
                .select({
                    facebookAccessToken: users.facebookAccessToken,
                    facebookTokenExpiresAt: users.facebookTokenExpiresAt,
                })
                .from(users)
                .where(eq(users.id, userId))
                .limit(1);

            if (!user?.facebookAccessToken) {
                logger.warn(`[TokenHealth] User ${userId} has no Facebook token — marking ${userPages.length} page(s) as unverifiable`);
                invalid += userPages.length;
                await notifyReconnectNeeded(userId, userPages);
                continue;
            }

            // 2. Try to re-fetch page tokens via /me/accounts
            //    This is the most reliable check: if it succeeds, tokens are valid
            //    and we get fresh page tokens as a bonus.
            const pagesResponse = await facebookService.getUserPages(user.facebookAccessToken);
            const freshTokenMap = new Map(
                (pagesResponse.data || []).map(p => [p.id, p.access_token])
            );

            const invalidPages: typeof userPages = [];

            for (const page of userPages) {
                const freshToken = freshTokenMap.get(page.facebookPageId);
                if (freshToken) {
                    // Token is valid — update with fresh token and mark as verified
                    await db
                        .update(pages)
                        .set({
                            accessToken: maybeEncryptToken(freshToken),
                            tokenLastVerifiedAt: new Date(),
                            updatedAt: new Date(),
                        })
                        .where(eq(pages.id, page.id));
                    refreshed++;
                } else {
                    // Page not returned — user may have revoked access to this page
                    invalidPages.push(page);
                    invalid++;
                    logger.warn(`[TokenHealth] Page "${page.name}" (${page.facebookPageId}) not in user's accounts — access may be revoked`);
                }
            }

            verified += userPages.length;

            if (invalidPages.length > 0) {
                await notifyReconnectNeeded(userId, invalidPages);
            }
        } catch (error) {
            // /me/accounts failed — user token is likely expired or invalid
            invalid += userPages.length;

            const isAuthError = isTokenExpiredError(error);
            if (isAuthError) {
                logger.warn(`[TokenHealth] User ${userId} Facebook token is invalid — notifying`);
                await notifyReconnectNeeded(userId, userPages);
            } else {
                // Transient error (network, rate limit) — don't mark as invalid, retry next sweep
                captureError(error, 'Token verification failed (transient)', {
                    tags: { service: 'token-health' },
                    extra: { userId, pageCount: userPages.length },
                });
                logger.error(`[TokenHealth] Transient error for user ${userId}`, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    logger.info(`[TokenHealth] Complete: ${verified} checked, ${refreshed} refreshed, ${invalid} invalid`);
    return { verified, refreshed, invalid };
}

/** Check if a Facebook API error indicates an expired/invalid token. */
function isTokenExpiredError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const msg = String((error as { message?: string }).message || '').toLowerCase();
    return msg.includes('invalid') || msg.includes('expired')
        || msg.includes('oauthexception') || msg.includes('error validating');
}

/** Notify user that they need to reconnect their page(s). */
async function notifyReconnectNeeded(
    userId: string,
    failedPages: Array<{ name: string | null }>,
): Promise<void> {
    try {
        const pageNames = failedPages.map(p => p.name || 'Unknown').join(', ');
        await notificationService.sendNotification(userId, {
            type: 'page_disconnected',
            titles: { en: 'Page Reconnection Needed', ar: 'يلزم إعادة ربط الصفحة' },
            bodies: {
                en: `Your Facebook connection for ${pageNames} is no longer valid. Please reconnect to keep auto-replies running.`,
                ar: `اتصال فيسبوك لصفحة ${pageNames} لم يعد صالحاً. يرجى إعادة الربط للحفاظ على الردود التلقائية.`,
            },
            data: { action: 'reconnect_page' },
        });
    } catch (error) {
        captureError(error, 'Failed to send reconnect notification', {
            tags: { service: 'token-health' },
            extra: { userId },
        });
    }
}

export function startTokenRefreshCron(): void {
    if (intervalHandle) return;
    logger.info(`[TokenHealth] Cron started — verifies every ${SWEEP_INTERVAL_MS / 3600000}h, re-checks tokens older than ${VERIFY_INTERVAL_MS / 3600000}h`);
    intervalHandle = setInterval(() => {
        verifyAndRefreshTokens().catch(err => {
            captureError(err, 'Token health cron failed', { tags: { service: 'token-health' } });
        });
    }, SWEEP_INTERVAL_MS);
}

export function stopTokenRefreshCron(): void {
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
