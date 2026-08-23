import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyReply } from 'fastify';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: vi.fn(),
}));

import * as ecommerceService from '../../src/services/ecommerce';
import { requireOwnedStore, type StoreRequest } from '../../src/middleware/storeOwnership';

const STORE = {
    id: 'store-1',
    workspaceId: 'ws-1',
    isActive: true,
    platform: 'zid' as const,
};

function buildRequest(overrides: Partial<WorkspaceRequest> = {}): WorkspaceRequest {
    return {
        params: { storeId: 'store-1' },
        url: '/notification-log/store-1',
        workspaceId: 'ws-1',
        user: { userId: 'user-1' },
        log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
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

describe('requireOwnedStore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 401 when no workspace was resolved, without touching the DB', async () => {
        const reply = buildReply();
        await requireOwnedStore(buildRequest({ workspaceId: undefined }), reply);
        expect(reply.statusCode).toBe(401);
        expect(ecommerceService.getStoreById).not.toHaveBeenCalled();
    });

    it('returns 400 when the route carries no storeId', async () => {
        const reply = buildReply();
        await requireOwnedStore(buildRequest({ params: {} }), reply);
        expect(reply.statusCode).toBe(400);
        expect(ecommerceService.getStoreById).not.toHaveBeenCalled();
    });

    it('returns 404 when the store does not exist', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue(null);
        const reply = buildReply();
        await requireOwnedStore(buildRequest(), reply);
        expect(reply.statusCode).toBe(404);
    });

    it('returns 403 and attaches nothing when the store belongs to another workspace', async () => {
        // The IDOR this middleware closes (2026-08-23): a caller in ws-1 naming a
        // store owned by other-ws must be refused, and the handler must never
        // see the foreign store on the request.
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue({ ...STORE, workspaceId: 'other-ws' } as never);
        const request = buildRequest();
        const reply = buildReply();

        await requireOwnedStore(request, reply);

        expect(reply.statusCode).toBe(403);
        expect((request as StoreRequest).store).toBeUndefined();
        expect(request.log.warn).toHaveBeenCalledWith(
            expect.objectContaining({ storeId: 'store-1', workspaceId: 'ws-1', userId: 'user-1' }),
            expect.stringContaining('different workspace'),
        );
    });

    it('refuses a store whose workspaceId is null (never-assigned store)', async () => {
        // A null workspaceId must not compare equal to anything a caller can send.
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue({ ...STORE, workspaceId: null } as never);
        const reply = buildReply();
        await requireOwnedStore(buildRequest(), reply);
        expect(reply.statusCode).toBe(403);
    });

    it('attaches the store and sends no reply when it belongs to the caller', async () => {
        vi.mocked(ecommerceService.getStoreById).mockResolvedValue(STORE as never);
        const request = buildRequest();
        const reply = buildReply();

        const result = await requireOwnedStore(request, reply);

        expect(result).toBeUndefined();
        expect(reply.statusCode).toBe(200);
        expect(reply.payload).toBeUndefined();
        expect((request as StoreRequest).store).toEqual(STORE);
        expect(ecommerceService.getStoreById).toHaveBeenCalledWith('store-1');
    });
});
