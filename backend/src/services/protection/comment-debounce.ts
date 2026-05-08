import { redis } from '../../lib/redis';
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
 * Window is configurable via COMMENT_DEBOUNCE_WINDOW_SECONDS (default 60).
 * Set to 0 to disable instantly without a redeploy.
 *
 * Caller responsibilities:
 * - Skip both check and arm when fromId is unavailable (Page-as-Page comments,
 *   anonymous webhooks). Two such comments back-to-back will each fire a fresh
 *   reply — accepted as edge case, blast radius is tiny.
 * - SET NX (in arm) means a second successful reply inside the window does NOT
 *   refresh the cooldown. The window is anchored on the first reply, by design.
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
     * Returns true if the (page, post, sender) tuple already received an
     * auto-reply within the cooldown window. Read-only — does NOT set the key.
     * Caller arms the cooldown via {@link arm} after a successful reply.
     *
     * Fail-open on Redis errors — service availability over dedup precision.
     */
    async isCoolingDown(pageId: string, postId: string, senderId: string): Promise<boolean> {
        if (getWindowSeconds() === 0) return false;
        try {
            const exists = await redis.exists(buildKey(pageId, postId, senderId));
            return exists === 1;
        } catch (error) {
            this.logger.error('[CommentDebounce] Redis error on check, allowing reply', { error });
            return false;
        }
    }

    /**
     * Arm the cooldown after a successful reply. SET NX EX — if another
     * worker already armed it (rare race), we don't extend the existing TTL.
     */
    async arm(pageId: string, postId: string, senderId: string): Promise<void> {
        const window = getWindowSeconds();
        if (window === 0) return;
        try {
            await redis.set(buildKey(pageId, postId, senderId), '1', 'EX', window, 'NX');
        } catch (error) {
            this.logger.error('[CommentDebounce] Redis error on arm', { error });
        }
    }
}

export const commentDebounce = new CommentDebounce();
