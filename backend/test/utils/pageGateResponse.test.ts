import { describe, it, expect } from 'vitest';
import { pageGateError } from '../../src/utils/pageGateResponse';
import type { LimitCheckResult } from '@jawab24/shared';

describe('pageGateError', () => {
    it('maps a subscription-inactive check to 402 SUBSCRIPTION_INACTIVE', () => {
        const check: LimitCheckResult = {
            allowed: false,
            reason: 'Subscription expired. Please renew to continue.',
            code: 'subscription_inactive',
        };

        const { status, body } = pageGateError(check);

        expect(status).toBe(402);
        expect(body.code).toBe('SUBSCRIPTION_INACTIVE');
        expect(body.error).toBe('Subscription expired. Please renew to continue.');
        // A billing problem carries no page-count numbers — those would imply the
        // wrong "disable a page" remedy.
        expect(body.limit).toBeUndefined();
        expect(body.used).toBeUndefined();
    });

    it('maps a real page-limit check to 403 PAGE_LIMIT_REACHED with counts', () => {
        const check: LimitCheckResult = {
            allowed: false,
            reason: 'Enabled page limit reached. Disable another page or upgrade your plan.',
            code: 'page_limit_reached',
            limit: 1,
            used: 1,
            remaining: 0,
        };

        const { status, body } = pageGateError(check);

        expect(status).toBe(403);
        expect(body.code).toBe('PAGE_LIMIT_REACHED');
        expect(body.limit).toBe(1);
        expect(body.used).toBe(1);
    });

    it('defaults to PAGE_LIMIT_REACHED when no code is present (legacy/unknown)', () => {
        const check: LimitCheckResult = { allowed: false, reason: 'Page limit reached' };

        const { status, body } = pageGateError(check);

        expect(status).toBe(403);
        expect(body.code).toBe('PAGE_LIMIT_REACHED');
    });
});
