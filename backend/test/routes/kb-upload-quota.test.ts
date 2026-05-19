import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyRequest } from 'fastify';

// Hoisted mocks — must be created before the module under test is imported.
const mockGetUserSubscription = vi.hoisted(() => vi.fn());
const mockRedisGet = vi.hoisted(() => vi.fn());
const mockCaptureError = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/subscriptions', () => ({
    subscriptionsService: { getUserSubscription: mockGetUserSubscription },
}));
vi.mock('../../src/lib/redis', () => ({
    redis: { get: mockRedisGet },
}));
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: mockCaptureError,
}));

// Import after mocks are registered.
import { checkVisionAccessAndQuota, type VisionCheckResult } from '../../src/routes/kb-upload';

function buildRequest(userId: string | undefined): FastifyRequest {
    // The helper only inspects `user.userId` — minimal stub is enough.
    return { user: userId === undefined ? undefined : { userId } } as unknown as FastifyRequest;
}

describe('checkVisionAccessAndQuota', () => {
    beforeEach(() => {
        mockGetUserSubscription.mockReset();
        mockRedisGet.mockReset();
        mockCaptureError.mockReset();
    });

    it('denies with 403 plan_upgrade_required when the request has no userId', async () => {
        const result = await checkVisionAccessAndQuota(buildRequest(undefined));

        expect(result.allowed).toBe(false);
        // Type guard so the assertion below compiles.
        if (result.allowed) throw new Error('unreachable');
        expect(result.status).toBe(403);
        expect(result.response).toMatchObject({ error: 'plan_upgrade_required' });
        // Should not have hit subscription or redis lookups.
        expect(mockGetUserSubscription).not.toHaveBeenCalled();
        expect(mockRedisGet).not.toHaveBeenCalled();
    });

    it('denies with 403 plan_upgrade_required when the user has no Business plan', async () => {
        mockGetUserSubscription.mockResolvedValue({ plan: { ecommerceEnabled: false } });

        const result = await checkVisionAccessAndQuota(buildRequest('user-123'));

        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('unreachable');
        expect(result.status).toBe(403);
        expect(result.response).toMatchObject({ error: 'plan_upgrade_required' });
        // Quota lookup should be skipped if plan check fails.
        expect(mockRedisGet).not.toHaveBeenCalled();
    });

    it('allows and returns the validated userId when plan + quota both pass', async () => {
        mockGetUserSubscription.mockResolvedValue({
            plan: { ecommerceEnabled: true, slug: 'business' },
        });
        mockRedisGet.mockResolvedValue('3'); // 3 used, limit 10 → allowed

        const result: VisionCheckResult = await checkVisionAccessAndQuota(buildRequest('user-123'));

        // Lock in the contract change from PR #177: the success result must
        // carry the validated userId so the caller never re-extracts with a
        // non-null assertion.
        expect(result).toEqual({ allowed: true, userId: 'user-123' });
    });

    it('denies with 429 daily_limit_reached when the per-day quota is hit', async () => {
        mockGetUserSubscription.mockResolvedValue({
            plan: { ecommerceEnabled: true, slug: 'business' },
        });
        mockRedisGet.mockResolvedValue('10'); // Business limit is 10

        const result = await checkVisionAccessAndQuota(buildRequest('user-123'));

        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('unreachable');
        expect(result.status).toBe(429);
        expect(result.response).toMatchObject({
            error: 'daily_limit_reached',
            limit: 10,
            used: 10,
        });
    });

    it('denies with 503 quota_check_unavailable when Redis is unreachable', async () => {
        mockGetUserSubscription.mockResolvedValue({
            plan: { ecommerceEnabled: true, slug: 'business' },
        });
        mockRedisGet.mockRejectedValue(new Error('redis offline'));

        const result = await checkVisionAccessAndQuota(buildRequest('user-123'));

        expect(result.allowed).toBe(false);
        if (result.allowed) throw new Error('unreachable');
        // Fail-closed: don't expose unbounded Vision spend if quota cannot be enforced.
        expect(result.status).toBe(503);
        expect(result.response).toMatchObject({ error: 'quota_check_unavailable' });
        // Failure should be reported to Sentry for ops visibility.
        expect(mockCaptureError).toHaveBeenCalledTimes(1);
    });
});
