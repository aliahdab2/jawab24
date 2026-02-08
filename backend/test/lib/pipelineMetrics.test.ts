import { describe, it, expect, beforeEach } from 'vitest';
import { pipelineMetrics } from '../../src/lib/pipelineMetrics';

describe('pipelineMetrics', () => {
    beforeEach(() => {
        pipelineMetrics.reset();
    });

    it('should start with empty counters', () => {
        const metrics = pipelineMetrics.getMetrics();
        expect(metrics.counters).toEqual({});
        expect(metrics.since).toBeDefined();
    });

    it('should record and increment counters', () => {
        pipelineMetrics.record('facebook_message', 'success');
        pipelineMetrics.record('facebook_message', 'success');
        pipelineMetrics.record('facebook_message', 'debounce_skipped');

        const { counters } = pipelineMetrics.getMetrics();
        expect(counters['facebook_message.success']).toBe(2);
        expect(counters['facebook_message.debounce_skipped']).toBe(1);
    });

    it('should track different pipelines independently', () => {
        pipelineMetrics.record('facebook_message', 'success');
        pipelineMetrics.record('instagram_message', 'success');
        pipelineMetrics.record('facebook_comment', 'rate_limited');
        pipelineMetrics.record('instagram_comment', 'handoff_active');

        const { counters } = pipelineMetrics.getMetrics();
        expect(counters['facebook_message.success']).toBe(1);
        expect(counters['instagram_message.success']).toBe(1);
        expect(counters['facebook_comment.rate_limited']).toBe(1);
        expect(counters['instagram_comment.handoff_active']).toBe(1);
    });

    it('should reset counters and update since timestamp', async () => {
        pipelineMetrics.record('facebook_message', 'success');
        const before = pipelineMetrics.getMetrics();
        expect(before.counters['facebook_message.success']).toBe(1);

        // Wait 1ms so the timestamp differs
        await new Promise(resolve => setTimeout(resolve, 2));
        pipelineMetrics.reset();

        const after = pipelineMetrics.getMetrics();
        expect(after.counters).toEqual({});
        expect(after.since).not.toBe(before.since);
    });

    it('should handle all outcome types', () => {
        const outcomes = [
            'success', 'page_not_found', 'no_user', 'auto_reply_disabled',
            'debounce_skipped', 'handoff_active', 'rate_limited', 'settings_disabled',
            'already_replied', 'no_reply_generated', 'send_failed', 'post_disabled',
            'media_disabled', 'error',
        ] as const;

        for (const outcome of outcomes) {
            pipelineMetrics.record('facebook_message', outcome);
        }

        const { counters } = pipelineMetrics.getMetrics();
        expect(Object.keys(counters)).toHaveLength(outcomes.length);
        for (const outcome of outcomes) {
            expect(counters[`facebook_message.${outcome}`]).toBe(1);
        }
    });
});
