/**
 * Facebook page-token recovery — the live counterpart to the 6-hourly
 * `tokenRefresh` sweep.
 *
 * WHY THIS EXISTS (production, twice):
 *   2026-08-10 a merchant changed his Facebook password. Every stored page token
 *   died with the session (`code=190 subcode=460`), ten sends failed, the page
 *   auto-paused, and he learned about it from lost customers ~37h later.
 *   2026-08-14 the same thing hit the owner's own two pages. It ended after ~14
 *   minutes only because he happened to be inside the app and re-logged in —
 *   nothing in the system asked him to.
 *
 * The recovery data was available the whole time in both cases: page tokens are
 * re-mintable from `/me/accounts` whenever the USER token still works. What was
 * missing is a trigger. This module is that trigger:
 *
 *   1. a live Graph call fails with a token-revoked code   → `handlePageTokenFailure`
 *   2. re-mint the page token from /me/accounts             → caller retries once
 *   3. if the user token is dead too (the password case)    → tell the merchant
 *      WHICH of the five causes it was, and stop guessing
 *
 * Never throws: every entry point is called from a catch block or a
 * fire-and-forget path, and an alerting failure must never look like — or
 * become — a reply failure.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db';
import { pages, settings, users } from '../db/schema';
import { redis } from '../lib/redis';
import { config } from '../config';
import { facebookService } from './facebook';
import { maybeDecryptToken, maybeEncryptToken } from './facebookCrypto';
import { notificationService } from './notifications';
import { emailService } from './email';
import { pageReconnectEmailTemplate } from '../utils/emailTemplates';
import { FacebookApiError, DmSendError, isTokenRevoked } from '../utils/fbGraphErrors';
import { captureError } from '../utils/sentryHelpers';
import type { Logger } from '../types/logger';
import { noopLogger } from '../types/logger';

let logger: Logger = noopLogger;
export function setPageTokenRecoveryLogger(l: Logger): void { logger = l; }

/**
 * How long after a FAILED recovery we refuse to try again for the same page.
 *
 * The 2026-08-14 window produced 36+ failing Graph calls in 11 minutes. Without
 * this, each one would issue its own `/me/accounts` — a self-inflicted rate-limit
 * on the exact API we need working to recover.
 *
 * Released on SUCCESS (see `recoverPageToken`) so a genuinely new failure minutes
 * later still self-heals immediately; held on failure, which is the case worth
 * damping.
 */
const RECOVERY_COOLDOWN_SECONDS = 5 * 60;

/** One reconnect alert per page per day, however many calls fail meanwhile. */
const RECONNECT_ALERT_DEDUP_SECONDS = 24 * 60 * 60;

const cooldownKey = (pageId: string) => `fb:token:recovery:cooldown:${pageId}`;
const alertDedupKey = (pageId: string) => `fb:token:reconnect:alerted:${pageId}`;

/**
 * In-process single-flight. Complements the Redis cooldown rather than
 * duplicating it: the cooldown bounds RETRIES OVER TIME, this bounds CONCURRENT
 * callers, which on a busy page all arrive inside the same few milliseconds and
 * would each pass the `SET NX` before any of them finished.
 */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Why Facebook rejected the token. Mapped from the Graph code/subcode pairs in
 * `fbGraphErrors.TOKEN_REVOKED_CODES` — the merchant-facing half of the same
 * table, so a new code cannot be handled in one place and forgotten in the other.
 *
 * This is the whole point of the feature: "reconnect your page" is advice the
 * merchant already ignored once; "you changed your Facebook password, so the
 * connection ended" is a sentence they can act on.
 */
export type TokenFailureCause =
    | 'password_changed'      // 190|460
    | 'logged_out'            // 190|458
    | 'security_checkpoint'   // 190|459
    | 'token_expired'         // 190|463
    | 'permissions_revoked'   // 200|10
    | 'unknown';              // any other 190 — still a token problem

/**
 * Classify a Graph failure. Returns `null` when the error is NOT a token
 * problem — transient blips, rate limits, and 5xx must never reach the
 * reconnect path, because the alert clears the stored token.
 *
 * Accepts a raw AxiosError too: most read call sites in `facebook.ts` catch
 * axios directly and fail soft, so requiring a pre-wrapped error would have
 * left exactly the paths that broke first uncovered.
 */
export function classifyTokenFailure(error: unknown): TokenFailureCause | null {
    const fbError = toFacebookApiError(error);
    if (!fbError || !isTokenRevoked(fbError)) return null;

    if (fbError.code === 200 && fbError.subcode === 10) return 'permissions_revoked';
    if (fbError.code !== 190) return 'unknown';

    switch (fbError.subcode) {
        case 460: return 'password_changed';
        case 458: return 'logged_out';
        case 459: return 'security_checkpoint';
        case 463: return 'token_expired';
        default:  return 'unknown';
    }
}

/** Normalize whatever a call site caught into the structured error shape. */
function toFacebookApiError(error: unknown): FacebookApiError | DmSendError | null {
    if (error instanceof FacebookApiError || error instanceof DmSendError) return error;
    // `axios.isAxiosError` rather than an instanceof check: interceptors and
    // retries can hand back an error created by a different axios copy.
    if (isAxiosLike(error)) return FacebookApiError.fromAxios(error, 'Graph API error');
    // A `DmFailure` — the already-classified shape commentProcessor holds instead
    // of the raw error.
    //
    // The numeric-`code` narrowing is belt-and-braces, NOT the gate: a Node system
    // error carries a string code (`ECONNRESET`), and `isTokenRevoked` above
    // already rejects it because the lookup and the code-190 fallback are both
    // strict on numbers. Verified by mutation — widening this predicate to accept
    // any `code` changes no test outcome. It stays because it keeps a
    // string-coded object from being wrapped as a Graph error at all, which is
    // cheaper to reason about than relying on a downstream guard.
    if (isCodedFailure(error)) {
        return new FacebookApiError(error.fbMessage ?? 'Graph API error', { code: error.code, subcode: error.subcode });
    }
    return null;
}

function isCodedFailure(error: unknown): error is { code: number; subcode?: number; fbMessage?: string } {
    return typeof error === 'object'
        && error !== null
        && typeof (error as { code?: unknown }).code === 'number';
}

function isAxiosLike(error: unknown): error is import('axios').AxiosError {
    return typeof error === 'object' && error !== null && (error as { isAxiosError?: boolean }).isAxiosError === true;
}

interface RecoverablePage {
    id: string;
    userId: string | null;
    workspaceId: string | null;
    name: string | null;
    facebookPageId: string | null;
}

/**
 * Re-mint one page's token from `/me/accounts` using the connecting user's own
 * token — mechanically the same thing a merchant's Facebook re-login does, minus
 * the merchant.
 *
 * Returns the fresh DECRYPTED token, or `null` when recovery is impossible.
 * `null` is not "try again": it means the user token is gone too, and
 * `handlePageTokenFailure` has already told the merchant.
 */
export async function recoverPageToken(pageId: string, cause: TokenFailureCause): Promise<string | null> {
    const existing = inFlight.get(pageId);
    if (existing) return existing;

    const attempt = runRecovery(pageId, cause).finally(() => inFlight.delete(pageId));
    inFlight.set(pageId, attempt);
    return attempt;
}

async function runRecovery(pageId: string, cause: TokenFailureCause): Promise<string | null> {
    // Claim the cooldown BEFORE the Graph call, so a failure that throws still
    // leaves the damper in place. Redis down → proceed (fail open): the
    // single-flight map still bounds this to one call at a time, and a page that
    // cannot recover is worse than an extra /me/accounts.
    try {
        const claimed = await redis.set(cooldownKey(pageId), '1', 'EX', RECOVERY_COOLDOWN_SECONDS, 'NX');
        if (claimed !== 'OK') return null;
    } catch {
        // Redis unreachable — proceed.
    }

    const [page] = await db
        .select({
            id: pages.id,
            userId: pages.userId,
            workspaceId: pages.workspaceId,
            name: pages.name,
            facebookPageId: pages.facebookPageId,
        })
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1);

    if (!page?.facebookPageId || !page.userId) return null;

    const [user] = await db
        .select({ facebookAccessToken: users.facebookAccessToken })
        .from(users)
        .where(eq(users.id, page.userId))
        .limit(1);

    if (!user?.facebookAccessToken) {
        await markPageNeedsReconnect(page, cause);
        return null;
    }

    let userToken: string;
    try {
        userToken = maybeDecryptToken(user.facebookAccessToken);
    } catch (err) {
        // Corrupt row or wrong key — a config problem, NOT a revoked token.
        // Do not clear the page token and do not alarm the merchant about a
        // reconnect that would not fix it.
        captureError(err, 'pageTokenRecovery.userTokenDecryptFailed', {
            tags: { component: 'page-token-recovery' },
            extra: { pageId, userId: page.userId },
        });
        return null;
    }

    let freshToken: string | undefined;
    try {
        const response = await facebookService.getUserPages(userToken);
        freshToken = (response.data ?? []).find(p => p.id === page.facebookPageId)?.access_token;
    } catch (err) {
        if (isTokenRevoked(err)) {
            // The user session itself is gone — the password-change case. No
            // amount of retrying re-mints this; only the merchant can.
            logger.warn('[PageTokenRecovery] User token revoked — merchant must reconnect', {
                pageId, cause, code: (err as FacebookApiError).code, subcode: (err as FacebookApiError).subcode,
            });
            await markPageNeedsReconnect(page, cause);
            return null;
        }
        // Transient (network, 5xx, rate limit): leave everything intact and let
        // the next failure — or the 6h sweep — try again.
        logger.warn('[PageTokenRecovery] Transient failure re-fetching page token', {
            pageId, error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }

    if (!freshToken) {
        // The user token works but this page is not in /me/accounts. NOT proof of
        // revocation (Business-Portfolio pages, partial admin loss) — the same
        // conservative rule tokenRefresh applies. Leave the token alone.
        logger.warn('[PageTokenRecovery] Page absent from /me/accounts — token left intact', { pageId });
        return null;
    }

    await db
        .update(pages)
        .set({
            accessToken: maybeEncryptToken(freshToken),
            tokenLastVerifiedAt: new Date(),
            disconnectReason: null,
            updatedAt: new Date(),
        })
        .where(eq(pages.id, pageId));

    // Recovery worked, so release the damper: a genuinely new failure minutes
    // from now deserves its own immediate attempt rather than a 5-minute wait.
    await redis.del(cooldownKey(pageId)).catch(() => {});

    logger.info('[PageTokenRecovery] Page token re-minted from /me/accounts', { pageId, cause });
    return freshToken;
}

/**
 * The public entry point. Give it the page id and whatever a Graph call threw;
 * it decides whether this is a token problem at all, tries to fix it silently,
 * and alerts the merchant only when it cannot.
 *
 * Returns a fresh token when the caller can retry, `null` otherwise.
 * NEVER throws.
 */
export async function handlePageTokenFailure(pageId: string, error: unknown): Promise<string | null> {
    try {
        const cause = classifyTokenFailure(error);
        if (!cause) return null;
        return await recoverPageToken(pageId, cause);
    } catch (err) {
        captureError(err, 'pageTokenRecovery.handlePageTokenFailure failed', {
            tags: { component: 'page-token-recovery' },
            extra: { pageId },
        });
        return null;
    }
}

/**
 * Run a Graph call that needs this page's token, and self-heal a dead token once.
 *
 * The retry is deliberately ONE attempt with a freshly-minted token: if the
 * second call fails the same way, the problem is not staleness and looping would
 * only multiply the damage.
 */
export async function withPageTokenRetry<T>(
    page: { id: string; accessToken: string },
    call: (accessToken: string) => Promise<T>,
): Promise<T> {
    try {
        return await call(page.accessToken);
    } catch (error) {
        const freshToken = await handlePageTokenFailure(page.id, error);
        if (!freshToken) throw error;
        return call(freshToken);
    }
}

/**
 * Mark the page as needing a merchant reconnect, and say WHY.
 *
 * Clears the stored token so `isConnected` turns false and the reconnect UI
 * appears — the same contract `tokenRefresh.notifyReconnectNeeded` has always
 * had. Only reached when Facebook itself confirmed the credential is gone;
 * never on a transient error.
 *
 * Three channels, because the failure mode being fixed is silence:
 *   - in-app, to the whole WORKSPACE (agencies manage merchant pages)
 *   - push, via the same notification
 *   - email to the page OWNER only — the original connector is the one person
 *     whose re-auth can re-mint the token (pages.ts, isOriginalConnector)
 *
 * ⚠️ `tokenRefresh.notifyReconnectNeeded` is NOT dead code and must not be merged
 * into this: it alerts per USER for a whole batch of pages the 6h sweep found
 * dead at once, in ONE notification. Folding it into this per-page function
 * would turn one message into nine for an agency workspace. The overlap is the
 * DB write and the `page_disconnected` type — both deliberately identical, so a
 * page marked by either route looks the same to the UI and to support.
 */
export async function markPageNeedsReconnect(page: RecoverablePage, cause: TokenFailureCause): Promise<void> {
    try {
        // Deduped per page per day. Fails OPEN (Redis down → alert anyway): a
        // duplicate email is a nuisance, a missed one costs the merchant every
        // customer who writes while the page is dead.
        try {
            const claimed = await redis.set(alertDedupKey(page.id), '1', 'EX', RECONNECT_ALERT_DEDUP_SECONDS, 'NX');
            if (claimed !== 'OK') return;
        } catch {
            // Redis unreachable — alert anyway.
        }

        await db
            .update(pages)
            .set({ accessToken: '', disconnectReason: 'token_revoked', updatedAt: new Date() })
            .where(eq(pages.id, page.id));

        const pageName = page.name || 'Facebook Page';
        const data = { pageId: page.id, action: 'reconnect_page', cause, urgent: true };

        // Own try: `sendNotification` has no internal catch, and a failed insert
        // must not take the email down with it (pageAutoPause precedent).
        try {
            const payload = {
                type: 'page_disconnected' as const,
                titles: reconnectTitles(pageName),
                bodies: reconnectBodies(pageName, cause),
                data,
            };
            if (page.workspaceId) {
                await notificationService.sendNotificationToWorkspace(page.workspaceId, payload);
            } else if (page.userId) {
                await notificationService.sendNotification(page.userId, payload);
            }
        } catch (err) {
            captureError(err, 'pageTokenRecovery.reconnectNotificationFailed', {
                tags: { component: 'page-token-recovery' },
                extra: { pageId: page.id, workspaceId: page.workspaceId },
            });
        }

        await emailPageOwner(page, pageName, cause);
    } catch (err) {
        captureError(err, 'pageTokenRecovery.markPageNeedsReconnect failed', {
            tags: { component: 'page-token-recovery' },
            extra: { pageId: page.id, cause },
        });
    }
}

async function emailPageOwner(page: RecoverablePage, pageName: string, cause: TokenFailureCause): Promise<void> {
    if (!page.userId) return;

    const [info] = await db
        .select({ ownerEmail: users.email, dashboardLanguage: settings.dashboardLanguage })
        .from(users)
        .leftJoin(settings, eq(settings.userId, users.id))
        .where(and(eq(users.id, page.userId), isNotNull(users.email)))
        .limit(1);

    if (!info?.ownerEmail) return;

    // emailService.send fails in two shapes — resolves `{success:false}` for a
    // provider error and THROWS for a network one. Both are the same event here.
    try {
        const { subject, html } = pageReconnectEmailTemplate({
            lang: info.dashboardLanguage === 'en' ? 'en' : 'ar',
            pageName,
            cause,
            dashboardUrl: `${config.frontendUrl}/pages`,
        });
        const result = await emailService.send({
            to: info.ownerEmail, subject, html, type: 'page_reconnect', userId: page.userId,
        });
        if (!result.success) throw new Error(result.error ?? 'unknown error');
    } catch (err) {
        captureError(err, 'pageTokenRecovery.reconnectEmailFailed', {
            tags: { component: 'page-token-recovery' },
            extra: { pageId: page.id, userId: page.userId },
        });
    }
}

function reconnectTitles(pageName: string): { en: string; ar: string } {
    return {
        en: `Reconnect "${pageName}" to Facebook`,
        ar: `أعد ربط صفحة «${pageName}» بفيسبوك`,
    };
}

/**
 * The cause sentence, then the consequence, then the action — in that order,
 * because the merchant's first question is "what did I do?" and the honest
 * answer usually removes the suspicion that Jawab24 broke.
 *
 * Arabic is فصحى per AI_INSTRUCTIONS §5.
 */
function reconnectBodies(pageName: string, cause: TokenFailureCause): { en: string; ar: string } {
    const causeText: Record<TokenFailureCause, { en: string; ar: string }> = {
        password_changed: {
            en: 'because your Facebook password was changed',
            ar: 'بسبب تغيير كلمة مرور فيسبوك',
        },
        logged_out: {
            en: 'because your Facebook account was signed out',
            ar: 'بسبب تسجيل الخروج من حساب فيسبوك',
        },
        security_checkpoint: {
            en: 'because Facebook asked you to confirm your account',
            ar: 'لأن فيسبوك طلب تأكيد حسابك',
        },
        token_expired: {
            en: 'because the connection reached its expiry date',
            ar: 'لانتهاء مدة صلاحية الربط',
        },
        permissions_revoked: {
            en: "because Jawab24's permissions were removed from your Facebook account",
            ar: 'بسبب سحب أذونات جواب24 من حساب فيسبوك',
        },
        unknown: {
            en: 'because Facebook ended the connection',
            ar: 'لأن فيسبوك أنهى الربط',
        },
    };

    const reason = causeText[cause];
    return {
        en: `Auto-replies for "${pageName}" have stopped ${reason.en}. Reconnect the page to resume replying to your customers.`,
        ar: `توقفت الردود التلقائية لصفحة «${pageName}» ${reason.ar}. أعد ربط الصفحة لاستئناف الرد على عملائك.`,
    };
}
