import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock config
vi.mock('../../src/config', () => ({
    config: {
        zid: {
            clientId: '',
            clientSecret: '',
            webhookSecret: '',
            scopes: '',
        },
    },
}));

// Mock Sentry
vi.mock('@sentry/node', () => ({
    startSpan: vi.fn((_opts, fn) => fn()),
}));

// Mock ecommerce service
const mockGetStoreById = vi.fn();
const mockGetEnrichedKnowledgeBase = vi.fn();
const mockClaimPendingInstall = vi.fn();
const mockCleanupExpiredInstalls = vi.fn();

vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: any[]) => mockGetStoreById(...args),
    getEnrichedKnowledgeBase: (...args: any[]) => mockGetEnrichedKnowledgeBase(...args),
    claimPendingInstall: (...args: any[]) => mockClaimPendingInstall(...args),
    cleanupExpiredInstalls: (...args: any[]) => mockCleanupExpiredInstalls(...args),
}));

// Mock zid service
const mockRegisterWebhooks = vi.fn().mockResolvedValue(undefined);
const mockRefreshExpiringTokens = vi.fn().mockResolvedValue(0);

vi.mock('../../src/services/zid', () => ({
    registerWebhooks: (...args: any[]) => mockRegisterWebhooks(...args),
    refreshExpiringTokens: (...args: any[]) => mockRefreshExpiringTokens(...args),
}));

// Mock routes
vi.mock('../../src/routes/zid', () => ({
    default: vi.fn(),
}));

// Mock workers
vi.mock('../../src/workers/ecommerceSyncWorker', () => ({
    startEcommerceSyncWorker: vi.fn(),
    setSyncWorkerLogger: vi.fn(),
}));

import { ZidIntegration } from '../../src/integrations/zid';
import { config } from '../../src/config';

describe('ZidIntegration', () => {
    let integration: ZidIntegration;

    beforeEach(() => {
        vi.clearAllMocks();
        integration = new ZidIntegration();
    });

    describe('name', () => {
        it('should be "zid"', () => {
            expect(integration.name).toBe('zid');
        });
    });

    describe('isEnabled', () => {
        it('should return false when clientId is empty', () => {
            expect(integration.isEnabled()).toBe(false);
        });

        it('should return true when clientId is set', () => {
            (config.zid as any).clientId = 'test_zid_client_id';
            expect(integration.isEnabled()).toBe(true);
            (config.zid as any).clientId = '';
        });
    });

    describe('enrichKnowledgeBase', () => {
        it('should return null when page has no ecommerceStoreId', async () => {
            const result = await integration.enrichKnowledgeBase('some kb', {});
            expect(result).toBeNull();
        });

        it('should return null when ecommerceStoreId is not a string', async () => {
            const result = await integration.enrichKnowledgeBase('some kb', { ecommerceStoreId: 123 });
            expect(result).toBeNull();
        });

        it('should return null when store is not found', async () => {
            mockGetStoreById.mockResolvedValue(null);
            const result = await integration.enrichKnowledgeBase('some kb', { ecommerceStoreId: 'store-1' });
            expect(result).toBeNull();
        });

        it('should return null when store is not a Zid store', async () => {
            mockGetStoreById.mockResolvedValue({ id: 'store-1', platform: 'shopify' });
            const result = await integration.enrichKnowledgeBase('some kb', { ecommerceStoreId: 'store-1' });
            expect(result).toBeNull();
        });

        it('should return enriched KB when store is a Zid store', async () => {
            mockGetStoreById.mockResolvedValue({ id: 'store-1', platform: 'zid' });
            mockGetEnrichedKnowledgeBase.mockResolvedValue('enriched KB with Zid products');

            const result = await integration.enrichKnowledgeBase('page kb', { ecommerceStoreId: 'store-1' });

            expect(result).toBe('enriched KB with Zid products');
            expect(mockGetEnrichedKnowledgeBase).toHaveBeenCalledWith('page kb', 'store-1');
        });
    });

    describe('claimPendingInstall', () => {
        function mockRequest(overrides: Partial<any> = {}): any {
            return {
                cookies: {},
                unsignCookie: vi.fn().mockReturnValue({ valid: false, value: null }),
                log: { error: vi.fn() },
                ...overrides,
            };
        }

        function mockReply(): any {
            return {
                clearCookie: vi.fn().mockReturnThis(),
            };
        }

        it('should return null when no cookies', async () => {
            const req = mockRequest({ cookies: undefined });
            const result = await integration.claimPendingInstall(req, mockReply(), 'user-1');
            expect(result).toBeNull();
        });

        it('should return null when pendingZidId cookie is missing', async () => {
            const req = mockRequest({ cookies: {} });
            const result = await integration.claimPendingInstall(req, mockReply(), 'user-1');
            expect(result).toBeNull();
        });

        it('should return null when unsignCookie is not available', async () => {
            const req = mockRequest({
                cookies: { pendingZidId: 'some-value' },
                unsignCookie: undefined,
            });
            const result = await integration.claimPendingInstall(req, mockReply(), 'user-1');
            expect(result).toBeNull();
        });

        it('should return null when cookie signature is invalid', async () => {
            const req = mockRequest({
                cookies: { pendingZidId: 'tampered' },
                unsignCookie: vi.fn().mockReturnValue({ valid: false, value: null }),
            });
            const result = await integration.claimPendingInstall(req, mockReply(), 'user-1');
            expect(result).toBeNull();
        });

        it('should claim pending install and clear cookie on success', async () => {
            const req = mockRequest({
                cookies: { pendingZidId: 'signed_pending_id' },
                unsignCookie: vi.fn().mockReturnValue({ valid: true, value: 'pending-uuid-123' }),
            });
            const rep = mockReply();

            mockClaimPendingInstall.mockResolvedValue({ id: 'store-new', storeDomain: 'new-store.zid.store' });

            const result = await integration.claimPendingInstall(req, rep, 'user-1');

            expect(mockClaimPendingInstall).toHaveBeenCalledWith(
                'pending-uuid-123',
                'user-1',
                'zid',
                expect.any(Function),
            );
            expect(rep.clearCookie).toHaveBeenCalledWith('pendingZidId', { path: '/' });
            expect(result).toEqual({ zidOnboarding: true, ecommerceStoreId: 'store-new' });
        });

        it('should return null when claimPendingInstall returns null', async () => {
            const req = mockRequest({
                cookies: { pendingZidId: 'signed_pending_id' },
                unsignCookie: vi.fn().mockReturnValue({ valid: true, value: 'non-existent' }),
            });

            mockClaimPendingInstall.mockResolvedValue(null);

            const result = await integration.claimPendingInstall(req, mockReply(), 'user-1');
            expect(result).toBeNull();
        });

        it('should return null and log error when claim throws', async () => {
            const req = mockRequest({
                cookies: { pendingZidId: 'signed_pending_id' },
                unsignCookie: vi.fn().mockReturnValue({ valid: true, value: 'pending-id' }),
            });

            mockClaimPendingInstall.mockRejectedValue(new Error('Store already connected'));

            const result = await integration.claimPendingInstall(req, mockReply(), 'user-1');
            expect(result).toBeNull();
            expect(req.log.error).toHaveBeenCalled();
        });
    });

    describe('onShutdown', () => {
        it('should clear intervals without error when never started', async () => {
            await expect(integration.onShutdown()).resolves.not.toThrow();
        });

        it('should clear both intervals when they are set', async () => {
            (integration as any).cleanupInterval = setInterval(() => {}, 100000);
            (integration as any).tokenRefreshInterval = setInterval(() => {}, 100000);

            await integration.onShutdown();

            expect((integration as any).cleanupInterval).toBeNull();
            expect((integration as any).tokenRefreshInterval).toBeNull();
        });
    });
});
