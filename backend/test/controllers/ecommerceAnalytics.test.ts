import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { StoreRequest } from '../../src/middleware/storeOwnership';

vi.mock('../../src/services/ecommerceAnalytics', () => ({
    getStoreAnalytics: vi.fn(),
}));
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import * as analyticsService from '../../src/services/ecommerceAnalytics';
import { getAnalytics } from '../../src/controllers/ecommerceAnalytics';

const STORE = {
    id: 'store-1',
    workspaceId: 'ws-1',
    isActive: true,
    platform: 'shopify' as const,
};

/**
 * The controller runs behind `resolveWorkspace` + `requireOwnedStore`, so by
 * the time it executes `request.store` is loaded and owned. Ownership denials
 * (401 / 404 / 403) are covered in test/middleware/storeOwnership.test.ts.
 */
function buildRequest(overrides: Partial<StoreRequest> = {}): StoreRequest {
    return {
        params: { storeId: 'store-1' },
        query: {},
        workspaceId: 'ws-1',
        store: STORE,
        ...overrides,
    } as unknown as StoreRequest;
}

function buildReply() {
    const reply = {
        statusCode: 200,
        payload: undefined as unknown,
        status(code: number) {
            this.statusCode = code;
            return this;
        },
        send(body: unknown) {
            this.payload = body;
            return this;
        },
    };
    return reply as unknown as FastifyReply & { statusCode: number; payload: unknown };
}

describe('getAnalytics controller', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults to 30d range when query omits it', async () => {
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue({} as never);
        const reply = buildReply();
        await getAnalytics(buildRequest(), reply);
        expect(analyticsService.getStoreAnalytics).toHaveBeenCalledWith('store-1', '30d');
    });

    it('passes a valid range through to the service', async () => {
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue({} as never);
        const reply = buildReply();
        await getAnalytics(buildRequest({ query: { range: '90d' } }), reply);
        expect(analyticsService.getStoreAnalytics).toHaveBeenCalledWith('store-1', '90d');
    });

    it('coerces invalid ranges to 30d (not 400)', async () => {
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue({} as never);
        const reply = buildReply();
        await getAnalytics(buildRequest({ query: { range: 'forever' } }), reply);
        expect(analyticsService.getStoreAnalytics).toHaveBeenCalledWith('store-1', '30d');
    });

    it('queries the store the middleware attached, not the raw URL param', async () => {
        // If a handler ever re-read :storeId from params it would bypass the
        // ownership proof; the attached store is the only trustworthy source.
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue({} as never);
        const reply = buildReply();
        await getAnalytics(buildRequest({ params: { storeId: 'someone-elses-store' } }), reply);
        expect(analyticsService.getStoreAnalytics).toHaveBeenCalledWith('store-1', '30d');
    });

    it('returns 500 with generic error when aggregator throws', async () => {
        vi.mocked(analyticsService.getStoreAnalytics).mockRejectedValue(new Error('db down'));
        const reply = buildReply();
        await getAnalytics(buildRequest(), reply);
        expect(reply.statusCode).toBe(500);
        expect((reply.payload as { error: string }).error).not.toContain('db down');
    });

    it('returns the analytics payload on success', async () => {
        const overview = { storeId: 'store-1', recovery: { cartsRecovered: 4 } };
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue(overview as never);
        const reply = buildReply();
        await getAnalytics(buildRequest(), reply);
        expect(reply.statusCode).toBe(200);
        expect(reply.payload).toEqual(overview);
    });
});
