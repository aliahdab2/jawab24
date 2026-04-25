import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: vi.fn(),
}));
vi.mock('../../src/services/ecommerceAnalytics', () => ({
    getStoreAnalytics: vi.fn(),
}));
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

import * as ecommerceService from '../../src/services/ecommerce';
import * as analyticsService from '../../src/services/ecommerceAnalytics';
import { getAnalytics } from '../../src/controllers/ecommerceAnalytics';

function buildRequest(overrides: Partial<WorkspaceRequest> = {}): WorkspaceRequest {
    return {
        params: { storeId: 'store-1' },
        query: {},
        workspaceId: 'ws-1',
        ...overrides,
    } as unknown as WorkspaceRequest;
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

const STORE = {
    id: 'store-1',
    workspaceId: 'ws-1',
    isActive: true,
    platform: 'shopify' as const,
};

describe('getAnalytics controller', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 when no workspace is resolved', async () => {
        const reply = buildReply();
        await getAnalytics(buildRequest({ workspaceId: undefined }), reply);
        expect(reply.statusCode).toBe(401);
    });

    it('returns 404 when the store does not exist', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue(null);
        const reply = buildReply();
        await getAnalytics(buildRequest(), reply);
        expect(reply.statusCode).toBe(404);
    });

    it('returns 403 when the store belongs to a different workspace', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue({ ...STORE, workspaceId: 'other-ws' } as never);
        const reply = buildReply();
        await getAnalytics(buildRequest(), reply);
        expect(reply.statusCode).toBe(403);
        expect(analyticsService.getStoreAnalytics).not.toHaveBeenCalled();
    });

    it('defaults to 30d range when query omits it', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue(STORE as never);
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue({} as never);
        const reply = buildReply();
        await getAnalytics(buildRequest(), reply);
        expect(analyticsService.getStoreAnalytics).toHaveBeenCalledWith('store-1', '30d');
    });

    it('passes a valid range through to the service', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue(STORE as never);
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue({} as never);
        const reply = buildReply();
        await getAnalytics(buildRequest({ query: { range: '90d' } }), reply);
        expect(analyticsService.getStoreAnalytics).toHaveBeenCalledWith('store-1', '90d');
    });

    it('coerces invalid ranges to 30d (not 400)', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue(STORE as never);
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue({} as never);
        const reply = buildReply();
        await getAnalytics(buildRequest({ query: { range: 'forever' } }), reply);
        expect(analyticsService.getStoreAnalytics).toHaveBeenCalledWith('store-1', '30d');
    });

    it('returns 500 with generic error when aggregator throws', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue(STORE as never);
        vi.mocked(analyticsService.getStoreAnalytics).mockRejectedValue(new Error('db down'));
        const reply = buildReply();
        await getAnalytics(buildRequest(), reply);
        expect(reply.statusCode).toBe(500);
        expect((reply.payload as { error: string }).error).not.toContain('db down');
    });

    it('returns the analytics payload on success', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue(STORE as never);
        const overview = { storeId: 'store-1', recovery: { cartsRecovered: 4 } };
        vi.mocked(analyticsService.getStoreAnalytics).mockResolvedValue(overview as never);
        const reply = buildReply();
        await getAnalytics(buildRequest(), reply);
        expect(reply.statusCode).toBe(200);
        expect(reply.payload).toEqual(overview);
    });
});
