import { acquireMutex, releaseMutex } from '../../lib/redisMutex';
import { randomUUID } from 'crypto';
import { Logger, noopLogger } from '../../types';

/**
 * Per-(page, post, sender) auto-reply debounce.
 *
 * Prevents wasted AI replies and duplicate-looking responses when the same
 * commenter posts multiple comments back-to-back on the same post (e.g.
 * accidental double-comment, "..", "...", same question twice). The existing
 * per-comment idempotency lock (replyLock.ts) only dedupes on comment_id —
 * different comments from the same sender on the same post still each fire
 * a fresh AI reply.
 *
 * The slot is CLAIMED atomically at the start of processing (SET NX EX) rather
 * than armed after the reply is sent. The old check-then-arm design had a
 * time-of-check/time-of-use race: a burst of comments from one sender all
 * passed the read-only "is cooling down?" check before any of them armed the
 * key (arming happened seconds later, after AI generation + send), so each one
 * fired its own reply. Confirmed in prod 2026-07-05 (معرض الأحمد للسيارات:
 * عطر الشام / ابومحمد الشعاع each received the identical reply 2–3× within
 * seconds). Claiming the slot atomically before generation closes the window —
 * only the first comment of a burst wins the slot; the rest are debounced.
 *
 * Caller responsibilities:
 * - Skip acquire when senderId is unavailable (Page-as-Page comments, anonymous
 *   webhooks). Two such comments back-to-back will each fire a fresh reply —
 *   accepted as edge case, blast radius is tiny.
 * - RELEASE the slot on any terminal outcome that did NOT send a reply (send
 *   failure, spam/rate-limit skip, held-for-review, and — critically — the
 *   transient-error rethrow that triggers a BullMQ retry). Otherwise the retry
 *   of the very same comment would hit its own held key and be debounced,
 *   silently dropping the reply. A committed successful send keeps the slot for
 *   the full window so genuine back-to-back duplicates are suppressed.
 * - SET NX means a second successful reply inside the window does NOT refresh
 *   the cooldown. The window is anchored on the first claim, by design.
 *
 * Window is configurable via COMMENT_DEBOUNCE_WINDOW_SECONDS (default 60).
 * Set to 0 to disable instantly without a redeploy.
 */
const DEFAULT_WINDOW_SECONDS = 60;
const KEY_PREFIX = 'comment:debounce:';

function getWindowSeconds(): number {
    const raw = process.env.COMMENT_DEBOUNCE_WINDOW_SECONDS;
    if (raw === undefined || raw === '') return DEFAULT_WINDOW_SECONDS;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_WINDOW_SECONDS;
    return parsed;
}

function buildKey(pageId: string, postId: string, senderId: string): string {
    return `${KEY_PREFIX}${pageId}:${postId}:${senderId}`;
}

export class CommentDebounce {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * Atomically claim the reply slot for this (page, post, sender). Returns a
     * unique token when the slot is won (caller should proceed to reply, and
     * MUST {@link release} it with this token if it ends up not sending), or
     * `null` when the slot is already held — i.e. this sender already received
     * (or is mid-flight receiving) an auto-reply on this post inside the window,
     * so the caller should skip as a back-to-back duplicate.
     *
     * Fail-open on Redis errors and when the window is disabled — returns a token
     * so the reply proceeds (service availability over dedup precision). Such a
     * token maps to no stored key, so a later {@link release} is a harmless no-op.
     */
    async tryAcquire(pageId: string, postId: string, senderId: string): Promise<string | null> {
        // Window disabled → never debounce; return a token so the caller proceeds
        // (it maps to no stored key, so a later release is a harmless no-op).
        if (getWindowSeconds() === 0) return randomUUID();
        try {
            return await acquireMutex(buildKey(pageId, postId, senderId), getWindowSeconds());
        } catch (error) {
            this.logger.error('[CommentDebounce] Redis error on acquire, allowing reply', { error });
            return randomUUID(); // fail-open — availability over dedup precision
        }
    }

    /**
     * Release the slot only if we still hold it (compare-and-delete — prevents
     * releasing a slot re-acquired by another worker after TTL expiry). Fail-open
     * on Redis errors; the TTL expires the key regardless.
     */
    async release(pageId: string, postId: string, senderId: string, token: string): Promise<void> {
        if (getWindowSeconds() === 0) return;
        try {
            await releaseMutex(buildKey(pageId, postId, senderId), token);
        } catch (error) {
            this.logger.error('[CommentDebounce] Redis error on release', { error });
        }
    }
}

export const commentDebounce = new CommentDebounce();
