/**
 * Pipeline Metrics
 *
 * Tracks outcomes across all message/comment processing pipelines.
 * Counters are stored in Redis and survive process restarts.
 *
 * Uses SCAN (not KEYS) for all key enumeration — KEYS is O(N) and
 * blocks the Redis event loop, which also serves rate limiting, AI
 * cache, and BullMQ queues in production.
 */
import { redis, redisScanDelete } from './redis';
import { pipelineOutcomeCounter } from './metrics';

export type Pipeline =
    | 'facebook_message'
    | 'instagram_message'
    | 'whatsapp_message'
    | 'facebook_comment'
    | 'instagram_comment';

export type Outcome =
    | 'success'
    | 'page_not_found'
    | 'no_user'
    | 'no_workspace'
    | 'auto_reply_disabled'
    | 'debounce_skipped'
    | 'handoff_active'
    | 'handoff_requeued'
    | 'handoff_backlog_stale'
    | 'rate_limited'
    | 'settings_disabled'
    | 'already_replied'
    | 'no_reply_generated'
    | 'send_failed'
    | 'post_disabled'
    | 'media_disabled'
    // The post id resolves to a row owned by another page, so no content row can be
    // created for it and the comment cannot be ingested. Deterministic, never retried —
    // counted so a silent drop shows up as a number instead of only a log line.
    | 'content_not_owned'
    | 'skipped_risky'
    | 'skipped_spam'
    // A Facebook comment carrying a user-tag and no tag of our own page — the commenter is
    // addressing a tagged friend, not us, so we stay out of it (step 3a). Counted APART from
    // `skipped_spam`, which it used to share, for two reasons. It is by far the larger class
    // (4,720 comments in the 30 days to 2026-08-28, vs the handful of AI-classified spam),
    // so pooling them made the pool useless for either. And D-108 deliberately grew it by
    // removing the `length > 50` cap on the Graph repair fetch: that widening is CORRECT for
    // peer-to-peer chatter and would be a silent regression if it ever swept up customers
    // addressing the page, and this is the only number that can show the trend. These skips
    // are resolved without `needs_attention` by design — at this volume the alternative is
    // 4,700 rows a month in every merchant's attention queue — so the counter is the ONLY
    // signal that the class is growing. Watch it against `success` per page, not in isolation.
    | 'skipped_friend_tag'
    | 'held_low_confidence'
    | 'held_self_identification'
    | 'greeting_sent'
    | 'greeting_suppressed'
    | 'subscription_inactive'
    | 'lock_contention'
    | 'trigger_no_match'
    | 'post_reply_capped'
    | 'like_failed'
    | 'transient_error_retry'
    | 'ai_failed_immediate_flag'
    | 'ai_parked'
    | 'ai_park_exhausted'
    | 'attachment_park'
    | 'attachment_park_exhausted'
    | 'attachment_park_requeued'
    | 'error';

const PREFIX = 'metrics:pipeline:';
const SINCE_KEY = `${PREFIX}_since`;

export class PipelineMetrics {
    /**
     * Count a SENT reply by the mode it was generated under, and by whether that
     * mode had a channel to route to (D-087).
     *
     * Why a counter and not only the structured log: D-087 owes a weekly
     * ask/promise reading per effective-info page, and the log is the only
     * per-reply record of the mode — `messages`, `comments` and `ai_usage_log`
     * have no column for it. A counter survives log rotation and answers the
     * cheap half of the question ("is anyone on info, and are their pages
     * routable?") without a log query at all.
     *
     * `no_channel` is the interesting cell: an info reply on a page publishing
     * neither phone, WhatsApp nor email is the dead-end case the settings card
     * warns about — this makes "warned and proceeded anyway" countable, and so
     * makes the warn-don't-block ruling revisable on evidence.
     */
    async recordReplyMode(mode: string, hasContactChannel: boolean): Promise<void> {
        const key = `${PREFIX}reply_mode.${mode}.${hasContactChannel ? 'channel' : 'no_channel'}`;
        try {
            await redis.incr(key);
        } catch {
            // Never block a reply for a metric.
        }
    }

    /**
     * Increment counter for a pipeline outcome.
     * Fire-and-forget safe: errors are silently swallowed so metrics
     * never block or crash the processing pipeline.
     */
    async record(pipeline: Pipeline, outcome: Outcome): Promise<void> {
        // Prometheus counter (in-process, zero-cost)
        pipelineOutcomeCounter.inc({ pipeline, outcome });

        // Redis counter (survives restarts, serves /health/pipeline-metrics JSON endpoint)
        const key = `${PREFIX}${pipeline}.${outcome}`;
        try {
            await redis.incr(key);
        } catch {
            // Never block the pipeline for metrics failures
        }
    }

    /**
     * Read all counters from Redis.
     * Uses cursor-based SCAN (non-blocking) to enumerate keys.
     * Returns empty counters on Redis failure (graceful degradation).
     */
    async getMetrics(): Promise<{ since: string; counters: Record<string, number> }> {
        try {
            // Get or initialise the since timestamp
            let since = await redis.get(SINCE_KEY);
            if (!since) {
                since = new Date().toISOString();
                await redis.set(SINCE_KEY, since);
            }

            // SCAN for all counter keys — cursor-based, non-blocking
            const counterKeys: string[] = [];
            let cursor = '0';
            do {
                const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${PREFIX}*`, 'COUNT', 100);
                cursor = nextCursor;
                for (const k of keys) {
                    if (k !== SINCE_KEY) counterKeys.push(k);
                }
            } while (cursor !== '0');

            if (counterKeys.length === 0) {
                return { since, counters: {} };
            }

            // Batch-read all counter values in one round-trip
            const values = await redis.mget(...counterKeys);
            const counters: Record<string, number> = {};
            for (let i = 0; i < counterKeys.length; i++) {
                const shortKey = counterKeys[i].slice(PREFIX.length);
                counters[shortKey] = parseInt(values[i] || '0', 10);
            }

            return { since, counters };
        } catch {
            // Redis unavailable — return empty rather than 500
            return { since: new Date().toISOString(), counters: {} };
        }
    }

    /**
     * Reset all counters and update the since timestamp.
     * Deletes counter keys via SCAN (never KEYS).
     */
    async reset(): Promise<void> {
        try {
            const newSince = new Date().toISOString();

            await redisScanDelete(`${PREFIX}*`, k => k !== SINCE_KEY);

            // Update since timestamp last so it reflects a clean reset
            await redis.set(SINCE_KEY, newSince);
        } catch {
            // Ignore reset errors
        }
    }
}

export const pipelineMetrics = new PipelineMetrics();
