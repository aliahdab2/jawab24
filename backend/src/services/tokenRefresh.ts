import { db } from '../db';
import { pages, users } from '../db/schema';
import { and, ne, eq, isNotNull, lt, isNull, or, inArray } from 'drizzle-orm';
import { facebookService } from './facebook';
import { maybeEncryptToken, maybeDecryptToken } from './facebookCrypto';
import { notificationService } from './notifications';
import { captureError } from '../utils/sentryHelpers';
import { withRetry } from '../utils/retry';
import { isTokenRevoked, FacebookApiError } from '../utils/fbGraphErrors';
import { clearReconnectAlertClaims } from './pageTokenRecovery';
import { isDemoPlatformId } from '../utils/demo';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

/**
 * Facebook Token Health Monitor
 *
 * Page access tokens obtained from a long-lived user token do NOT expire by time.
 * They only become invalid when the user changes their Facebook password, revokes
 * app permissions, or the app loses approval.
 *
 * This service periodically verifies tokens are still valid and notifies users
 * to reconnect when tokens are found invalid, in two passes:
 *
 *   1. Every stale PAGE token is checked directly against its own page
 *      (`facebookService.verifyPageToken`). This is the only check that sees a
 *      page-level revocation — Meta dropping the app's access to ONE page while
 *      the user token stays valid (a later Facebook Login that ticked a
 *      different subset of pages). A confirmed revoke clears the token and
 *      notifies; a transport error leaves it for the next sweep.
 *   2. Where the owning user still has a long-lived token, `/me/accounts`
 *      re-fetches fresh page tokens as before.
 *
 * Until 2026-08-23 only pass 2 existed. It could not see a page-level revoke
 * (a page missing from `/me/accounts` is deliberately left intact — the
 * false-clear loop), and a user with NO Facebook token had every page
 * disconnected even when the page tokens themselves were valid — which is
 * exactly the shape of a store-provisioned account whose page was linked
 * through the embedded break-out. «Jawab24 Test» sat "connected" with a
 * code-190 token for 7+ hours, ignoring every customer.
 */

/** Re-verify tokens that haven't been checked in this window. */
const VERIFY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
/** How often the cron sweeps. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
/**
 * First sweep shortly after boot. A bare `setInterval` restarts its clock on
 * every deploy, and with several deploys a day (four on 2026-08-23 alone) the
 * six-hour mark was never reached — the monitor had not run in over a day.
 */
const INITIAL_SWEEP_DELAY_MS = 2 * 60 * 1000; // 2 minutes
/** Delay between per-user checks to avoid hammering Facebook's API. */
const PER_USER_DELAY_MS = 2000;
/** Delay between per-page direct checks — one Graph read each, bounded by the stale set. */
const PER_PAGE_DELAY_MS = 250;

let logger: Logger = noopLogger;
export function setTokenRefreshLogger(l: Logger): void { logger = l; }

let intervalHandle: ReturnType<typeof setInterval> | null = null;
let initialSweepHandle: ReturnType<typeof setTimeout> | null = null;

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Find pages whose tokens haven't been verified recently and check they are
 * still valid — each page token against its own page, then /me/accounts on
 * the owner's user token where one exists.
 */
export async function verifyAndRefreshTokens(): Promise<{ verified: number; refreshed: number; invalid: number }> {
    const staleThreshold = new Date(Date.now() - VERIFY_INTERVAL_MS);
    let verified = 0;
    let refreshed = 0;
    let invalid = 0;

    // Find active pages that haven't been verified recently
    const stalePages = (await db
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
                isNotNull(pages.facebookPageId),
                or(
                    isNull(pages.tokenLastVerifiedAt),
                    lt(pages.tokenLastVerifiedAt, staleThreshold),
                ),
            )
        ))
        // Demo pages carry fake tokens BY DESIGN (`demo_page_*`, see
        // utils/demo.ts) — validating them against the real Graph API burns
        // calls and "disconnects" the whole demo fleet on every sweep, which
        // the /business connected-pages filter then hides. Same shared
        // predicate as every other keep-demo-off-Graph guard, so the two
        // conventions cannot drift.
        .filter((page) => !isDemoPlatformId(page.facebookPageId));

    if (stalePages.length === 0) {
        logger.info('[TokenHealth] All tokens recently verified');
        return { verified: 0, refreshed: 0, invalid: 0 };
    }

    logger.info(`[TokenHealth] ${stalePages.length} page(s) need token verification`);

    // Pass 1 — each page token against its own page. Definitive for a
    // page-level revoke, and independent of whether the owner still has a
    // user token at all.
    const revokedPageIds = new Set<string>();
    let pageIndex = 0;
    for (const page of stalePages) {
        if (pageIndex > 0) await sleep(PER_PAGE_DELAY_MS);
        pageIndex++;

        let pageToken: string;
        try {
            pageToken = maybeDecryptToken(page.accessToken);
        } catch (decryptErr) {
            // Corrupt row / wrong key — a config-or-data problem, not a revoke.
            captureError(decryptErr, 'Page token decryption failed — skipping verification this sweep (token NOT cleared)', {
                tags: { service: 'token-health', entity: 'page' },
                extra: { pageId: page.id },
            });
            continue;
        }

        try {
            await facebookService.verifyPageToken(page.facebookPageId as string, pageToken);
            await db
                .update(pages)
                .set({ tokenLastVerifiedAt: new Date(), disconnectReason: null, updatedAt: new Date() })
                .where(eq(pages.id, page.id));
            verified++;
        } catch (error) {
            if (isTokenRevoked(error)) {
                const fbErr = error as FacebookApiError;
                logger.warn(`[TokenHealth] Page "${page.name}" (${page.facebookPageId}) token revoked by Graph — disconnecting`, {
                    pageId: page.id,
                    code: fbErr.code,
                    subcode: fbErr.subcode,
                });
                revokedPageIds.add(page.id);
                invalid++;
                if (page.userId) await notifyReconnectNeeded(page.userId, [page], 'token_revoked');
            } else {
                // Transport blip or an unrecognised shape — never a revoke.
                // Left intact; the next sweep retries.
                logger.warn(`[TokenHealth] Page "${page.name}" (${page.facebookPageId}) could not be verified (transient) — token left intact`, {
                    pageId: page.id,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    // Pass 2 — refresh via the owner's user token where one exists. Pages
    // already found revoked are out: their tokens are cleared and a stale
    // /me/accounts entry must not resurrect them.
    const pagesByUser = new Map<string, typeof stalePages>();
    for (const page of stalePages) {
        if (!page.userId || revokedPageIds.has(page.id)) continue;
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
                // No user token to refresh from — but the page tokens were just
                // checked directly in pass 1, and a page token does not need a
                // user token to keep working (page tokens from a long-lived
                // user token never expire by time). Disconnecting here used to
                // kill every valid page of a store-provisioned account.
                logger.info(`[TokenHealth] User ${userId} has no Facebook token — ${userPages.length} page(s) verified directly only, no refresh`);
                continue;
            }

            // Decrypt before calling FB. User tokens are stored AES-GCM
            // encrypted (enc:v1:...). Sending the ciphertext makes FB return
            // code 190 with a malformed-token message, which isTokenRevoked()
            // then misclassifies as a real revoke and bulk-clears page tokens.
            //
            // Decrypt failure (corrupt row / wrong key) is a config-or-data
            // problem, NOT a revoked token: skip this user without touching
            // page tokens, and don't let the outer catch label it transient —
            // it would recur every sweep.
            let userToken: string;
            try {
                userToken = maybeDecryptToken(user.facebookAccessToken);
            } catch (decryptErr) {
                captureError(decryptErr, 'User token decryption failed — skipping verification this sweep (pages NOT cleared)', {
                    tags: { service: 'token-health', entity: 'user' },
                    extra: { userId, pageCount: userPages.length },
                });
                continue;
            }

            // 2. Try to re-fetch page tokens via /me/accounts
            //    This is the most reliable check: if it succeeds, tokens are valid
            //    and we get fresh page tokens as a bonus.
            //
            //    Wrapped in withRetry so transient FB API blips (network, 5xx,
            //    rate limits) don't trigger a false-positive disconnect for the
            //    user. Real token-revoked errors (FacebookApiError with auth
            //    code/subcode) are NOT retried — withRetry's default retryable
            //    matcher only retries network/timeout/5xx responses.
            const pagesResponse = await withRetry(
                () => facebookService.getUserPages(userToken),
                {
                    maxAttempts: 3,
                    baseDelayMs: 1000,
                    maxDelayMs: 8000,
                    retryableErrors: (err) => {
                        // Don't retry definitive token-revoked errors
                        if (err instanceof FacebookApiError) {
                            if (isTokenRevoked(err)) return false;
                            // Transport-layer failures (network, 5xx) are retry-worthy
                            return err.isTransport;
                        }
                        return false;
                    },
                },
            );
            const freshTokenMap = new Map(
                (pagesResponse.data || []).map(p => [p.id, p.access_token])
            );

            for (const page of userPages) {
                const freshToken = page.facebookPageId ? freshTokenMap.get(page.facebookPageId) : undefined;
                if (freshToken) {
                    // Token is valid — update with fresh token and mark as verified.
                    // Clear disconnect_reason: a previously-disconnected page that
                    // came back via OAuth re-auth would have a stale reason value.
                    await db
                        .update(pages)
                        .set({
                            accessToken: maybeEncryptToken(freshToken),
                            tokenLastVerifiedAt: new Date(),
                            disconnectReason: null,
                            updatedAt: new Date(),
                        })
                        .where(eq(pages.id, page.id));
                    // Restored token = incident over; the reconnect-alert dedup
                    // claims must not suppress the NEXT incident's alerts.
                    clearReconnectAlertClaims(page.id, userId);
                    refreshed++;
                } else {
                    // Page exists in our DB but is not in the user's /me/accounts
                    // response. This is NOT a definitive signal of revocation:
                    //  - Business-Portfolio-owned pages may legitimately be absent
                    //    from /me/accounts (granular_scopes fallback in
                    //    facebookService.getUserPages only triggers when /me/accounts
                    //    returns zero pages, not when it returns a partial set).
                    //  - The user may have lost admin access to this specific page
                    //    while keeping access to others.
                    //
                    // Log for observability and triage, but do NOT clear the token.
                    // If access is genuinely revoked, the next real send/read call
                    // for this page will fail with a FacebookApiError that the
                    // calling code can act on. False-clearing here is what produced
                    // the disconnect-loop bug.
                    logger.warn(`[TokenHealth] Page "${page.name}" (${page.facebookPageId}) not in /me/accounts response — token left intact, will revisit next sweep`);
                }
            }

            // `verified` was counted per page in pass 1; pass 2 only refreshes.
        } catch (error) {
            // /me/accounts failed even after retries.
            //
            // Only clear page tokens when the error is a *confirmed* token-revoked
            // error — real OAuth code/subcode pair from FB. Anything else (transient
            // network failure, FB outage, rate limit, unrecognized error shape) is
            // logged for triage and retried next sweep.
            //
            // This prevents the bulk-clear bug where a single transient user-token
            // failure would empty all of the user's page tokens — even though page
            // tokens are independent of the user-level token's session state.
            if (isTokenRevoked(error)) {
                invalid += userPages.length;
                const fbErr = error as FacebookApiError;
                logger.warn(`[TokenHealth] User ${userId} Facebook token revoked — notifying`, {
                    code: fbErr.code,
                    subcode: fbErr.subcode,
                });
                await notifyReconnectNeeded(userId, userPages, 'token_revoked');
            } else {
                // Transient error (network, rate limit, FB blip, retries exhausted).
                // Do NOT clear page tokens. Retry on the next 6h sweep.
                captureError(error, 'Token verification failed (transient — retrying next sweep)', {
                    tags: { service: 'token-health' },
                    extra: { userId, pageCount: userPages.length },
                });
                logger.warn(`[TokenHealth] Transient error for user ${userId} — page tokens NOT cleared, will retry next sweep`, {
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

    logger.info(`[TokenHealth] Complete: ${verified} checked, ${refreshed} refreshed, ${invalid} invalid`);
    return { verified, refreshed, invalid };
}

/**
 * Categorical reason a page is being marked disconnected. Persisted on
 * `pages.disconnect_reason` so support can answer "why isn't this customer
 * replying?" with one SQL query instead of cross-referencing logs.
 */
export type DisconnectReason = 'token_revoked' | 'user_revoked';

/** Notify user that they need to reconnect their page(s). */
async function notifyReconnectNeeded(
    userId: string,
    failedPages: Array<{ id: string; name: string | null }>,
    reason: DisconnectReason,
): Promise<void> {
    try {
        // Clear stored tokens so isConnected becomes false and the reconnect UI appears.
        // Persist the reason so support can triage without log spelunking.
        const pageIds = failedPages.map(p => p.id);
        await db
            .update(pages)
            .set({ accessToken: '', disconnectReason: reason, updatedAt: new Date() })
            .where(inArray(pages.id, pageIds));

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

function runSweep(): void {
    verifyAndRefreshTokens().catch(err => {
        captureError(err, 'Token health cron failed', { tags: { service: 'token-health' } });
    });
}

export function startTokenRefreshCron(): void {
    if (intervalHandle) return;
    logger.info(`[TokenHealth] Cron started — first sweep in ${INITIAL_SWEEP_DELAY_MS / 60000}min, then every ${SWEEP_INTERVAL_MS / 3600000}h, re-checks tokens older than ${VERIFY_INTERVAL_MS / 3600000}h`);
    // The interval alone never fired on a day with four deploys — each restart
    // reset its clock. The early first sweep makes the 24h staleness window
    // the real cadence, independent of how often the process is replaced.
    initialSweepHandle = setTimeout(() => {
        initialSweepHandle = null;
        runSweep();
    }, INITIAL_SWEEP_DELAY_MS);
    intervalHandle = setInterval(runSweep, SWEEP_INTERVAL_MS);
}

export function stopTokenRefreshCron(): void {
    if (initialSweepHandle) {
        clearTimeout(initialSweepHandle);
        initialSweepHandle = null;
    }
    if (intervalHandle) {
        clearInterval(intervalHandle);
        intervalHandle = null;
    }
}
