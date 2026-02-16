/**
 * Pipeline Metrics
 *
 * Lightweight in-memory counters for tracking outcomes across
 * all message/comment processing pipelines. No external dependencies.
 *
 * Counters reset on process restart — this is for operational
 * visibility, not durable analytics.
 */

export type Pipeline =
    | 'facebook_message'
    | 'instagram_message'
    | 'facebook_comment'
    | 'instagram_comment';

export type Outcome =
    | 'success'
    | 'page_not_found'
    | 'no_user'
    | 'auto_reply_disabled'
    | 'debounce_skipped'
    | 'handoff_active'
    | 'handoff_requeued'
    | 'rate_limited'
    | 'settings_disabled'
    | 'already_replied'
    | 'no_reply_generated'
    | 'send_failed'
    | 'post_disabled'
    | 'media_disabled'
    | 'skipped_risky'
    | 'error';

class PipelineMetrics {
    private counters = new Map<string, number>();
    private since = new Date().toISOString();

    record(pipeline: Pipeline, outcome: Outcome): void {
        const key = `${pipeline}.${outcome}`;
        this.counters.set(key, (this.counters.get(key) || 0) + 1);
    }

    getMetrics(): { since: string; counters: Record<string, number> } {
        const counters: Record<string, number> = {};
        for (const [key, value] of this.counters) {
            counters[key] = value;
        }
        return { since: this.since, counters };
    }

    reset(): void {
        this.counters.clear();
        this.since = new Date().toISOString();
    }
}

export const pipelineMetrics = new PipelineMetrics();
