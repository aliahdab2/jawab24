/**
 * Shared `/{platform}/store/webhooks/reregister` handler — table-driven across
 * all three platforms.
 *
 * Replaces the per-platform reregister handler (was Shopify-only). Verifies the
 * shared factory wires through registry → adapter.registerWebhooks → save +
 * enqueue regardless of platform.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetStoreByWorkspaceAny = vi.fn();
const mockRegisterWebhooksWithPersist = vi.fn();

vi.mock('../../src/services/ecommerce', () => ({
    getStoreByWorkspaceAny: (...args: unknown[]) => mockGetStoreByWorkspaceAny(...args),
    registerWebhooksWithPersist: (...args: unknown[]) => mockRegisterWebhooksWithPersist(...args),
}));

const mockAdapterRegister = vi.fn();
const mockRegistryGet = vi.fn();
vi.mock('../../src/integrations/registry', () => ({
    integrationRegistry: {
        get: (name: string) => mockRegistryGet(name),
    },
}));

import { createReregisterHandler } from '../../src/controllers/ecommerceWebhooks';
import type { EcommercePlatform } from '../../src/services/ecommerce';

const PLATFORMS: EcommercePlatform[] = ['shopify', 'salla', 'zid'];

function makeReply() {
    const r: any = {};
    r.status = vi.fn().mockReturnValue(r);
    r.send = vi.fn().mockReturnValue(r);
    return r;
}

beforeEach(() => {
    vi.clearAllMocks();
    mockRegistryGet.mockReturnValue({ registerWebhooks: mockAdapterRegister });
});

describe.each(PLATFORMS)('reregister handler (%s)', (platform) => {
    it('returns 401 if no workspace on the request', async () => {
        const handler = createReregisterHandler(platform);
        const req: any = {};
        const reply = makeReply();
        await handler(req, reply);
        expect(reply.status).toHaveBeenCalledWith(401);
        expect(mockRegistryGet).not.toHaveBeenCalled();
    });

    it(`returns 404 if no ${platform} store is connected`, async () => {
        const handler = createReregisterHandler(platform);
        mockGetStoreByWorkspaceAny.mockResolvedValueOnce(null);
        const req: any = { workspaceId: 'ws-1' };
        const reply = makeReply();
        await handler(req, reply);
        expect(reply.status).toHaveBeenCalledWith(404);
    });

    it('returns 409 if the store is disconnected', async () => {
        const handler = createReregisterHandler(platform);
        mockGetStoreByWorkspaceAny.mockResolvedValueOnce({
            id: 'store-1', isActive: false, storeDomain: 'x', accessToken: 'enc', accessTokenIv: 'iv',
        });
        const req: any = { workspaceId: 'ws-1' };
        const reply = makeReply();
        await handler(req, reply);
        expect(reply.status).toHaveBeenCalledWith(409);
    });

    it('looks up adapter via registry and persists status on success', async () => {
        const handler = createReregisterHandler(platform);
        mockGetStoreByWorkspaceAny.mockResolvedValueOnce({
            id: 'store-1', isActive: true, storeDomain: 'shop.example', accessToken: 'enc', accessTokenIv: 'iv',
        });
        const status = { registered: ['t1', 't2'], failed: [], lastAttempt: '2026-05-07T00:00:00.000Z' };
        mockRegisterWebhooksWithPersist.mockResolvedValueOnce(status);

        const req: any = { workspaceId: 'ws-1' };
        const reply = makeReply();
        await handler(req, reply);

        expect(mockRegistryGet).toHaveBeenCalledWith(platform);
        expect(mockGetStoreByWorkspaceAny).toHaveBeenCalledWith(platform, 'ws-1');
        expect(mockRegisterWebhooksWithPersist).toHaveBeenCalledWith(
            'store-1',
            platform,
            expect.any(Function),
        );
        expect(reply.send).toHaveBeenCalledWith({ ok: true, webhookStatus: status });
    });

    it('returns ok:false when status has failed topics (UI shows pending)', async () => {
        const handler = createReregisterHandler(platform);
        mockGetStoreByWorkspaceAny.mockResolvedValueOnce({
            id: 'store-1', isActive: true, storeDomain: 'x', accessToken: 'enc', accessTokenIv: 'iv',
        });
        const status = {
            registered: ['t1'],
            failed: [{ topic: 't2', error: 'boom' }],
            lastAttempt: '2026-05-07T00:00:00.000Z',
        };
        mockRegisterWebhooksWithPersist.mockResolvedValueOnce(status);

        const req: any = { workspaceId: 'ws-1' };
        const reply = makeReply();
        await handler(req, reply);

        expect(reply.send).toHaveBeenCalledWith({ ok: false, webhookStatus: status });
    });

    it('returns 404 if platform is not registered (defensive)', async () => {
        const handler = createReregisterHandler(platform);
        mockRegistryGet.mockReturnValueOnce(null);
        const req: any = { workspaceId: 'ws-1' };
        const reply = makeReply();
        await handler(req, reply);
        expect(reply.status).toHaveBeenCalledWith(404);
    });
});
