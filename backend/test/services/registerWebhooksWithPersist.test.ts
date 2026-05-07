/**
 * Shared webhook hardening: table-driven across all three platforms.
 *
 * Exercises `registerWebhooksWithPersist` — the helper that wraps a
 * platform's `registerWebhooks` with persist-on-throw + retry-queue
 * enqueue. The same helper is called by the install paths in all three
 * platform controllers and by the shared `/{platform}/store/webhooks/reregister`
 * handler, so coverage here covers every entry point.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDbSelectLimit = vi.fn();
const mockDbUpdateWhere = vi.fn();
const mockEnqueueWebhookRetry = vi.fn();
const mockCaptureError = vi.fn();

vi.mock('../../src/db', () => ({
    db: {
        select: () => ({
            from: () => ({
                where: () => ({
                    limit: () => mockDbSelectLimit(),
                }),
            }),
        }),
        update: () => ({
            set: () => ({
                where: () => mockDbUpdateWhere(),
            }),
        }),
    },
}));

vi.mock('../../src/db/schema', () => ({
    ecommerceStores: { platformData: 'platformData' },
    ecommerceProducts: {},
    pages: {},
    pendingEcommerceInstalls: {},
    workspaceMembers: {},
}));

vi.mock('../../src/lib/webhookRetryQueue', () => ({
    enqueueWebhookRetry: (...args: unknown[]) => mockEnqueueWebhookRetry(...args),
    WEBHOOK_RETRY_QUEUE: 'ecommerce-webhook-retry',
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

vi.mock('../../src/services/ecommerceCrypto', () => ({
    encrypt: vi.fn(),
    decrypt: vi.fn(),
}));

vi.mock('../../src/services/customerNotifications', () => ({
    customerNotificationService: { schedule: vi.fn() },
}));

vi.mock('../../src/lib/redis', () => ({
    redisScanDelete: vi.fn(),
}));

import { registerWebhooksWithPersist, type EcommercePlatform } from '../../src/services/ecommerce';

const PLATFORMS: EcommercePlatform[] = ['shopify', 'salla', 'zid'];

beforeEach(() => {
    vi.clearAllMocks();
    mockDbSelectLimit.mockResolvedValue([{ platformData: {} }]);
    mockDbUpdateWhere.mockResolvedValue(undefined);
    mockEnqueueWebhookRetry.mockResolvedValue(undefined);
});

describe.each(PLATFORMS)('registerWebhooksWithPersist (%s)', (platform) => {
    const STORE_ID = `store-${platform}-1`;

    it('persists the success status and does NOT enqueue retry when nothing failed', async () => {
        const status = {
            registered: ['app/uninstalled', 'orders/create'],
            failed: [],
            lastAttempt: '2026-05-07T00:00:00.000Z',
        };
        const registerFn = vi.fn().mockResolvedValue(status);

        const result = await registerWebhooksWithPersist(STORE_ID, platform, registerFn);

        expect(result).toEqual(status);
        expect(mockDbUpdateWhere).toHaveBeenCalled();
        expect(mockEnqueueWebhookRetry).not.toHaveBeenCalled();
    });

    it('persists status AND enqueues retry on partial failure', async () => {
        const status = {
            registered: ['app/uninstalled'],
            failed: [{ topic: 'orders/create', status: 502, error: 'upstream' }],
            lastAttempt: '2026-05-07T00:00:00.000Z',
        };
        const registerFn = vi.fn().mockResolvedValue(status);

        const result = await registerWebhooksWithPersist(STORE_ID, platform, registerFn);

        expect(result).toEqual(status);
        expect(mockDbUpdateWhere).toHaveBeenCalled();
        expect(mockEnqueueWebhookRetry).toHaveBeenCalledWith({ storeId: STORE_ID, platform });
    });

    it('persists "failed: all" marker AND enqueues retry on total throw', async () => {
        const err = new Error('connection refused');
        const registerFn = vi.fn().mockRejectedValue(err);

        const result = await registerWebhooksWithPersist(STORE_ID, platform, registerFn);

        expect(result.registered).toEqual([]);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0]).toMatchObject({ topic: 'all', error: 'connection refused' });
        expect(mockDbUpdateWhere).toHaveBeenCalled();
        expect(mockEnqueueWebhookRetry).toHaveBeenCalledWith({ storeId: STORE_ID, platform });
        expect(mockCaptureError).toHaveBeenCalledWith(
            err,
            expect.stringContaining(platform),
            expect.objectContaining({ tags: { service: platform, stage: 'webhook-registration' } }),
        );
    });

    it('does not crash if the retry queue is unavailable (install path stays alive)', async () => {
        const err = new Error('boom');
        const registerFn = vi.fn().mockRejectedValue(err);
        mockEnqueueWebhookRetry.mockRejectedValueOnce(new Error('redis unavailable'));

        // Should NOT throw — install path must continue.
        const result = await registerWebhooksWithPersist(STORE_ID, platform, registerFn);
        expect(result.failed).toHaveLength(1);
    });

    it('swallows saveWebhookStatus errors on the throw path so install never fails', async () => {
        const err = new Error('boom');
        const registerFn = vi.fn().mockRejectedValue(err);
        mockDbUpdateWhere.mockRejectedValueOnce(new Error('db down'));

        // Should NOT throw.
        const result = await registerWebhooksWithPersist(STORE_ID, platform, registerFn);
        expect(result.failed).toHaveLength(1);
    });
});
