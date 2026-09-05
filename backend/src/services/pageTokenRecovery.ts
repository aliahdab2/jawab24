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
import { and, eq } from 'drizzle-orm';
import { db } from '../db';
import { pages, users } from '../db/schema';
import { redis } from '../lib/redis';
import { acquireMutex, releaseMutex } from '../lib/redisMutex';
import { config } from '../config';
import { facebookService } from './facebook';
import { maybeDecryptToken, maybeEncryptToken } from './facebookCrypto';
import { notificationService } from './notifications';
import { emailService } from './email';
import { getEmailRecipient } from './emailRecipient';
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

/**
 * One reconnect EMAIL per page OWNER per day, however many of their pages died.
 *
 * The page-scoped key cannot do this job, because the page is the wrong unit for
 * this cause: a revoked user session kills EVERY page token minted from it in the
 * same instant, so an agency with nine pages clears nine page-scoped keys and
 * mails the owner nine identical notices about one Facebook password change.
 *
 * Only the mailbox needs the collapse. The in-app notification stays per page —
 * each carries its own `pageId` and its own reconnect action, and account health
 * pins them individually, so nine cards are nine things to fix rather than nine
 * copies of one thing.
 */
const RECONNECT_EMAIL_DEDUP_SECONDS = 24 * 60 * 60;

const cooldownKey = (pageId: string) => `fb:token:recovery:cooldown:${pageId}`;
const alertDedupKey = (pageId: string) => `fb:token:reconnect:alerted:${pageId}`;
const emailDedupKey = (userId: string) => `fb:token:reconnect:emailed:${userId}`;

/**
 * In-process single-flight. Complements the Redis cooldown rather than
 * duplicating it: the cooldown bounds RETRIES OVER TIME, this bounds CONCURRENT
 * callers, which on a busy page all arrive inside the same few milliseconds and
 * would each pass the `SET NX` before any of them finished.
 */
const inFlight = new Map<string, Promise<string | null>>();

/**
 * Per-process fallback for the two Redis claims below, used ONLY when Redis
 * itself failed.
 *
 * Both guards fail OPEN on a Redis error, and each is right to on its own — a
 * suppressed reconnect alert costs the merchant every customer who writes while
 * the page is dead. But failing open on BOTH at once restores the exact storm
 * they exist to stop: the 2026-08-14 window produced 36 failing Graph calls in 11
 * minutes, and `inFlight` cannot damp those because they arrived SEQUENTIALLY,
 * not concurrently. Redis down would therefore have meant 36 `/me/accounts` calls
 * and 36 emails.
 *
 * This is deliberately NOT a Redis substitute: it is per-process and lost on
 * restart, which is the correct trade for "cap the storm, still alert".
 */
const localClaims = new Map<string, number>();

/** `SET NX`-equivalent against the in-process ledger. True = the caller owns it. */
function claimLocally(key: string, ttlSeconds: number): boolean {
    const now = Date.now();
    // Drop lapsed entries first, so the map holds live claims rather than every
    // key this process has ever seen.
    for (const [k, expiry] of localClaims) {
        if (expiry <= now) localClaims.delete(k);
    }
    if (localClaims.has(key)) return false;
    localClaims.set(key, now + ttlSeconds * 1000);
    return true;
}

function releaseLocally(key: string): void {
    localClaims.delete(key);
}

/**
 * Give a claim back, whichever ledger holds it.
 *
 * Compare-and-delete on the Redis side (`token` is what `acquireMutex` returned,
 * or `null` when the claim only ever landed in the per-process fallback): a blind
 * `DEL` would also remove a claim someone else took after ours lapsed, which on
 * the cooldown means stripping the damper from the caller still relying on it.
 * Never throws — releasing is always best-effort, and a failure to release costs
 * at most one extra attempt after the TTL.
 */
async function releaseClaim(key: string, token: string | null): Promise<void> {
    if (token) await releaseMutex(key, token).catch(() => {});
    releaseLocally(key);
}

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
        // `isTransport` must be carried, not defaulted. Graph answers some 5xx
        // responses with a populated `error.code` — 190 among them — and
        // `classifyDmError` buckets those by the code, so the resulting
        // `DmFailure` looks exactly like a revoked token. Reconstructing it here
        // without the flag made `isTokenRevoked` say yes to a Facebook outage,
        // which on this path means clearing the stored token of every page whose
        // send failed during it and mailing each owner a reconnect notice.
        return new FacebookApiError(error.fbMessage ?? 'Graph API error', {
            code: error.code,
            subcode: error.subcode,
            isTransport: error.isTransport === true,
        });
    }
    return null;
}

function isCodedFailure(error: unknown): error is { code: number; subcode?: number; fbMessage?: string; isTransport?: boolean } {
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
    /** The stored ciphertext as read at recovery entry — the CAS guard on both
     *  writes below, so a reconnect that lands mid-recovery is never overwritten. */
    accessToken: string;
}

/**
 * Forget the 24h alert/email dedup claims for a page whose token was just
 * restored. Every restore path must call this: the claims exist to collapse
 * repeats of ONE incident, and a working token ends that incident — a page that
 * dies again afterwards is a NEW incident that must alert on every channel.
 * Without this release, a re-revocation inside the 24h window is completely
 * silent (no card, no push, no email).
 *
 * Blind DEL on purpose, unlike `releaseClaim`: any claim at these keys —
 * however recently taken, by whichever process — refers to the pre-restore
 * incident, so deleting it is always correct here. Fire-and-forget; a restore
 * must never fail on Redis.
 */
export function clearReconnectAlertClaims(pageId: string, userId: string | null): void {
    const keys = [alertDedupKey(pageId)];
    if (userId) keys.push(emailDedupKey(userId));
    for (const key of keys) releaseLocally(key);
    // try/catch AROUND the call, not just `.catch()` on the promise: a broken
    // client can throw synchronously, and a token-restore path must never fail
    // on this release — an unreleased claim merely expires by TTL.
    try {
        redis.del(...keys).catch(() => {});
    } catch {
        // Claims fall back to their 24h TTL.
    }
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
    // leaves the damper in place. Redis down → fall back to the per-process
    // ledger rather than to no damper at all: `inFlight` only bounds CONCURRENT
    // callers, and the failures this damps arrive sequentially over minutes.
    //
    // Tokened, because this claim is RELEASED on success below. A bare `DEL`
    // there would delete whatever is at the key — including a claim a second
    // process took after ours lapsed on a slow `/me/accounts`, which removes the
    // damper for the one caller still relying on it. `releaseMutex` compares
    // before deleting, so a lapsed holder releases nothing.
    let cooldownToken: string | null = null;
    try {
        cooldownToken = await acquireMutex(cooldownKey(pageId), RECOVERY_COOLDOWN_SECONDS);
        if (!cooldownToken) return null;
    } catch {
        if (!claimLocally(cooldownKey(pageId), RECOVERY_COOLDOWN_SECONDS)) return null;
    }

    const [page] = await db
        .select({
            id: pages.id,
            userId: pages.userId,
            workspaceId: pages.workspaceId,
            name: pages.name,
            facebookPageId: pages.facebookPageId,
            accessToken: pages.accessToken,
        })
        .from(pages)
        .where(eq(pages.id, pageId))
        .limit(1);

    // No Facebook Page ⇒ nothing to re-mint. This is the single guard that keeps
    // Facebook page-token recovery away from an Instagram LOGIN row, which holds
    // its own `instagram_access_token` and has no Facebook Page behind it: without
    // it, an Instagram-direct send failure would run /me/accounts and — when the
    // user session is also gone — mail the merchant "reconnect your Facebook page"
    // to explain an Instagram outage. Same class of mistake the WhatsApp gate in
    // `recordSendFailure` exists to prevent, one layer lower.
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

    // Compare-and-set on the ciphertext read at entry: the decision to write was
    // made BEFORE the `/me/accounts` round trip, and a merchant reconnect can
    // land inside it. Zero rows = someone else already wrote a fresh token; ours
    // is still valid for the caller's retry, but the ROW is theirs.
    const reminted = await db
        .update(pages)
        .set({
            accessToken: maybeEncryptToken(freshToken),
            tokenLastVerifiedAt: new Date(),
            disconnectReason: null,
            updatedAt: new Date(),
        })
        .where(and(eq(pages.id, pageId), eq(pages.accessToken, page.accessToken)))
        .returning({ id: pages.id });

    // Recovery worked, so release the damper: a genuinely new failure minutes
    // from now deserves its own immediate attempt rather than a 5-minute wait.
    await releaseClaim(cooldownKey(pageId), cooldownToken);

    if (reminted.length === 0) {
        logger.info('[PageTokenRecovery] Re-mint lost the race to a concurrent token write — row left as-is', { pageId, cause });
        return freshToken;
    }

    // A working token ends the incident, so the merchant must be alertable again
    // at once. This matters beyond the reconnect flow: a 190/459 security
    // checkpoint is resolved on facebook.com with no Jawab24 re-auth, so THIS is
    // the only place that learns the credential came back.
    clearReconnectAlertClaims(pageId, page.userId);

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
 * The same contract as {@link withPageTokenRetry}, for call sites that report
 * failure by RETURNING it instead of throwing.
 *
 * The comment adapters are the reason: `sendReply` resolves
 * `{ success: false, dmFailure }` rather than rejecting, so the throw-based
 * wrapper above never fires there — and the comment surface is precisely where
 * the 2026-08-14 symptom was reported (an empty Post Reply picker on a page
 * whose token had died). Without this the comment that EXPOSED the dead token is
 * flagged `dm_failed` and never answered, while the fire-and-forget
 * `recordSendFailure` re-mints in the background for the benefit of the NEXT
 * customer. That is the defect this module was written to end, one surface over.
 *
 * Returns the token that produced the final result so the caller can ADOPT it.
 * Borrowing it for the retry alone is not enough: a comment reply is followed by
 * `likeComment` on the same credential, which would otherwise be issued with the
 * token we just proved dead (the identical trap `sendProductCards` set on the DM
 * path).
 *
 * `failureOf` returns the thing to classify — `undefined` for success. It is the
 * caller's, not this function's, because only the caller knows which field of its
 * result shape carries the Graph error.
 */
export async function withPageTokenRetryResult<T>(
    pageId: string,
    accessToken: string,
    call: (accessToken: string) => Promise<T>,
    failureOf: (result: T) => unknown,
): Promise<{ result: T; accessToken: string }> {
    const result = await call(accessToken);

    const failure = failureOf(result);
    if (failure === undefined || failure === null) return { result, accessToken };

    // Returns null for anything that is not a revoked credential, so a rate
    // limit, a blocked customer, or a 5xx costs one classification and no retry.
    const freshToken = await handlePageTokenFailure(pageId, failure);
    if (!freshToken) return { result, accessToken };

    return { result: await call(freshToken), accessToken: freshToken };
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
 *   - in-app, to the whole WORKSPACE (agencies manage merchant pages), per page
 *   - push, via the same notification
 *   - email to the page OWNER, at most ONE per owner per day however many of
 *     their pages died — the original connector is the one person whose re-auth
 *     can re-mint the token (pages.ts, isOriginalConnector), and one revoked
 *     session kills all their pages at once. See `RECONNECT_EMAIL_DEDUP_SECONDS`
 *     for why the page-scoped claim below cannot cover that.
 *
 * ⚠️ `tokenRefresh.notifyReconnectNeeded` is NOT dead code and must not be merged
 * into this: it alerts per USER for a whole batch of pages the 6h sweep found
 * dead at once, in ONE in-app notification naming every page (and no email at
 * all). Folding it into this per-page function would turn one message into nine
 * for an agency workspace. The overlap is the DB write and the
 * `page_disconnected` type — both deliberately identical, so a page marked by
 * either route looks the same to the UI and to support.
 */
export async function markPageNeedsReconnect(page: RecoverablePage, cause: TokenFailureCause): Promise<void> {
    try {
        // ⚠️ THE STATE WRITE COMES FIRST, AND IS NOT GATED BY THE ALERT DEDUP.
        //
        // These are two different questions and only one of them is about the
        // merchant's attention:
        //   "is this page's stored credential dead?" — a fact about the ROW. We
        //      must record it every single time Facebook tells us, because every
        //      reader of that row (isConnected, the reconnect UI, the Post Reply
        //      picker, support triage) is answering from it.
        //   "have we already told them today?" — a fact about the MAILBOX.
        //
        // Gating the first on the second re-creates the exact defect this module
        // exists to remove. A page that dies, is reconnected, and dies again
        // inside 24h (nothing deletes the Redis key on reconnect — see
        // controllers/pages.ts, which restores accessToken and nulls
        // disconnectReason) would find the claim already taken, return here, and
        // keep a POPULATED access_token with a NULL disconnect_reason: a
        // healthy-looking row with a dead token, no card and no email. That is
        // 2026-08-10 and 2026-08-14 verbatim, produced by the fix for them.
        //
        // The same ordering also survives a failed write: the UPDATE below can
        // throw (it is inside the outer catch), and with the claim taken first
        // that failure would have silenced the next 24 hours of attempts.
        //
        // Idempotent, so repeating it costs one UPDATE — and it is reached at
        // most once per RECOVERY_COOLDOWN_SECONDS per page anyway.
        //
        // Compare-and-set on the ciphertext read at recovery entry. The verdict
        // "this credential is dead" was formed before a network round trip; if
        // the merchant completed a reconnect inside it (the 2026-08-14 pattern —
        // the owner was re-logging in DURING the failure storm), the row now
        // holds a fresh token this verdict says nothing about. Zero rows = the
        // race was lost: leave the row alone and say nothing to the merchant —
        // their page works. Idempotency survives the guard: a repeat pass reads
        // the already-cleared '' at entry and '' == '' still matches.
        const cleared = await db
            .update(pages)
            .set({ accessToken: '', disconnectReason: 'token_revoked', updatedAt: new Date() })
            .where(and(eq(pages.id, page.id), eq(pages.accessToken, page.accessToken)))
            .returning({ id: pages.id });
        if (cleared.length === 0) {
            logger.info('[PageTokenRecovery] Disconnect skipped — a concurrent write restored the token first', { pageId: page.id, cause });
            return;
        }

        // Only the NOTIFICATION is deduped — per page per day. Redis down
        // degrades to the per-process ledger rather than to no dedup: a duplicate
        // alert is a nuisance, a missed one costs the merchant every customer who
        // writes while the page is dead, and 36 of them is its own outage.
        try {
            const claimed = await redis.set(alertDedupKey(page.id), '1', 'EX', RECONNECT_ALERT_DEDUP_SECONDS, 'NX');
            if (claimed !== 'OK') return;
        } catch {
            if (!claimLocally(alertDedupKey(page.id), RECONNECT_ALERT_DEDUP_SECONDS)) return;
        }

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
    const userId = page.userId;
    const dedupKey = emailDedupKey(userId);

    // Collapse the fan-out to ONE email per owner per day. The page-scoped claim
    // in the caller cannot: the cause is per USER, so N dead pages clear N page
    // keys and produce N identical emails to the same address. Claimed before the
    // lookup so the DB read is skipped too.
    //
    // Tokened (`acquireMutex`) rather than a bare `SET NX`, because it now has a
    // release path: a CAS release can only ever delete OUR claim, never one a
    // later attempt took after this one lapsed.
    let claimToken: string | null = null;
    try {
        claimToken = await acquireMutex(dedupKey, RECONNECT_EMAIL_DEDUP_SECONDS);
        if (!claimToken) {
            logger.info('[PageTokenRecovery] Reconnect email suppressed — owner already notified today', {
                pageId: page.id, userId,
            });
            return;
        }
    } catch {
        if (!claimLocally(dedupKey, RECONNECT_EMAIL_DEDUP_SECONDS)) return;
    }

    // A claim that did not result in a DELIVERED email must be given back (see
    // `releaseClaim`). Holding it costs the merchant the one channel that reaches
    // them when they are not in the app — for a full day, over a failure that was
    // ours: the 37-hour-dark scenario with the notification switched off.
    // `pageAutoPause.notifyMerchantAutoPaused` learned this first, and this copy
    // did not inherit the fix — which is why the "did it deliver?" question now
    // lives in one place, `emailService.trySend`.
    const info = await getEmailRecipient(userId);

    // No address on file: nothing was sent, so nothing is deduped. Releasing lets
    // a sibling page — or the same page once the owner adds an email — try again
    // rather than inheriting a day of silence bought by a send that never happened.
    if (!info) {
        await releaseClaim(dedupKey, claimToken);
        return;
    }

    // `trySend`, not `send`: delivery is what the claim above is spending, and
    // only `trySend` answers that in one value (see its docblock — `send` fails
    // in two shapes and one of them does not look like failure).
    let delivered = false;
    let failureReason: string | undefined;
    try {
        const { subject, html } = pageReconnectEmailTemplate({
            lang: info.lang,
            pageName,
            cause,
            dashboardUrl: `${config.frontendUrl}/pages`,
        });
        ({ delivered, error: failureReason } = await emailService.trySend({
            to: info.email, subject, html, type: 'page_reconnect', userId,
        }));
    } catch (err) {
        // Template rendering, not the send — `trySend` never throws.
        failureReason = err instanceof Error ? err.message : String(err);
    }

    if (!delivered) {
        await releaseClaim(dedupKey, claimToken);
        captureError(
            new Error(`Reconnect email failed for page ${page.id}: ${failureReason ?? 'unknown error'}`),
            'pageTokenRecovery.reconnectEmailFailed',
            { tags: { component: 'page-token-recovery' }, extra: { pageId: page.id, userId } },
        );
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
