import { describe, it, expect } from 'vitest';
import { thresholdToNotificationType } from '../../src/services/subscriptions';

describe('thresholdToNotificationType', () => {
    it('maps 80 → ai_usage_warning_80', () => {
        expect(thresholdToNotificationType(80)).toBe('ai_usage_warning_80');
    });

    it('maps 90 → ai_usage_warning_90', () => {
        expect(thresholdToNotificationType(90)).toBe('ai_usage_warning_90');
    });

    it('maps 100 → ai_usage_limit_reached', () => {
        expect(thresholdToNotificationType(100)).toBe('ai_usage_limit_reached');
    });
});
