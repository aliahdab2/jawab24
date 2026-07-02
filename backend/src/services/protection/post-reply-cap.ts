import { redis } from '../../lib/redis';
import { Logger, noopLogger } from '../../types';

/**
 * Per-post reply cap for any-comment ("reply to any comment") Post Reply rules.
 *
 * Keyword-mode Post Reply is naturally bounded — only comments matching the
 * merchant's keywords fire. An any-comment rule fires on EVERY comment, so on a
 * viral post it would otherwise send hundreds of replies/DMs: public-reply spam and
 * a Meta-flagging risk. This caps the number of automated any-comment sends per post
 * within a rolling window; over-cap comments are resolved silently and the merchant
 * can still reply manually from the inbox.
 *
 * Cap is configurable via POST_REPLY_ANY_COMMENT_CAP (default 300). Set to 0 to
 * disable the cap entirely (unlimited) without a redeploy. The window is 24h from
 * the first automated any-comment send on the post.
 *
 * The default is deliberately HIGH — an invisible anti-runaway valve, not a
 * merchant-facing limit ("unlimited post replies" is a live pricing promise).
 * Normal merchants never reach it; it only trips on a truly viral post, where
 * uncapped identical sends would risk Meta's ~4,800 actions/day API ceiling and
 * spam enforcement. Trips are logged + counted (post_reply_capped metric); never
 * surface this cap in UI copy (see DECISIONS.md).
 *
 * Distinct from: the per-sender rate limiter (counts per sender across posts) and the
 * per-(page, post, sender) debounce (dedupes one sender's back-to-back comments).
 * This bounds TOTAL automated sends on a single post across ALL senders.
 */
const DEFAULT_CAP = 300;
const WINDOW_SECONDS = 24 * 60 * 60;
const KEY_PREFIX = 'comment:postreplycap:';

function getCap(): number {
    const raw = process.env.POST_REPLY_ANY_COMMENT_CAP;
    if (raw === undefined || raw === '') return DEFAULT_CAP;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_CAP;
    return parsed;
}

function buildKey(pageId: string, postId: string): string {
    return `${KEY_PREFIX}${pageId}:${postId}`;
}

export class PostReplyCap {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * True when this post has already hit the any-comment send cap in the window.
     * Read-only — does NOT increment. Fail-open on Redis errors (availability over
     * precision: a Redis blip must not silence a merchant's replies).
     */
    async isOverCap(pageId: string, postId: string): Promise<boolean> {
        const cap = getCap();
        if (cap === 0) return false;
        try {
            const raw = await redis.get(buildKey(pageId, postId));
            const count = raw ? parseInt(raw, 10) : 0;
            return count >= cap;
        } catch (error) {
            this.logger.error('[PostReplyCap] Redis error on check, allowing reply', { error });
            return false;
        }
    }

    /**
     * Count one automated any-comment send toward the cap. Sets the 24h window TTL on
     * the first send of the window. Fail-open.
     */
    async increment(pageId: string, postId: string): Promise<void> {
        if (getCap() === 0) return;
        try {
            const key = buildKey(pageId, postId);
            const count = await redis.incr(key);
            if (count === 1) {
                await redis.expire(key, WINDOW_SECONDS);
            }
        } catch (error) {
            this.logger.error('[PostReplyCap] Redis error on increment', { error });
        }
    }
}

export const postReplyCap = new PostReplyCap();
