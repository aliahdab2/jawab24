/**
 * webhookRetryWorker: registry-dispatch processor.
 *
 * Phase 1.4 collapsed the platform switch into `integrationRegistry.get(platform)`.
 * If the registry isn't populated at worker startup the dispatch silently
 * no-ops every retry job — these tests pin that behavior and exercise the
 * three real outcomes (success, partial-failure throw-for-backoff, missing adapter).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetStoreById = vi.fn();
const mockSaveWebhookStatus = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/services/ecommerce', () => ({
    getStoreById: (...args: unknown[]) => mockGetStoreById(...args),
    saveWebhookStatus: (...args: unknown[]) => mockSaveWebhookStatus(...args),
}));

const mockRegistryGet = vi.fn();
vi.mock('../../src/integrations/registry', async (importOriginal) => ({
    // `toStoreForWebhooks` keeps its REAL implementation — stubbing the picker
    // would hide a dropped credential, which is the bug it exists to prevent.
    ...(await importOriginal<typeof import('../../src/integrations/registry')>()),
    integrationRegistry: { get: (name: string) => mockRegistryGet(name) },
}));

vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: vi.fn(),
}));

// Capture the processor function passed to `new Worker(name, processor, opts)`.
let capturedProcessor: ((job: { id: string; data: { storeId: string; platform: string } }) => Promise<void>) | null = null;
/** Worker event handlers, so the retry-exhaustion path is reachable from a test. */
const capturedHandlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('bullmq', () => ({
    Worker: vi.fn().mockImplementation((_name: string, processor: (...args: unknown[]) => unknown) => {
        capturedProcessor = processor as typeof capturedProcessor;
        return {
            on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
                capturedHandlers.set(event, handler);
            }),
            close: vi.fn().mockResolvedValue(undefined),
        };
    }),
    Job: vi.fn(),
}));

vi.mock('../../src/config', () => ({
    config: {
        redis: { host: 'localhost', port: 6379, password: '' },
    },
}));

vi.mock('../../src/lib/webhookRetryQueue', () => ({
    WEBHOOK_RETRY_QUEUE: 'ecommerce-webhook-retry',
}));

import { startWebhookRetryWorker, stopWebhookRetryWorker } from '../../src/workers/webhookRetryWorker';

const PLATFORMS: Array<'shopify' | 'salla' | 'zid'> = ['shopify', 'salla', 'zid'];

beforeEach(async () => {
    vi.clearAllMocks();
    capturedProcessor = null;
    capturedHandlers.clear();
    await stopWebhookRetryWorker();
    startWebhookRetryWorker();
    if (!capturedProcessor) throw new Error('Worker mock did not capture the processor');
});

describe.each(PLATFORMS)('webhookRetryWorker (%s)', (platform) => {
    it('dispatches via integrationRegistry and persists status on success', async () => {
        const adapterRegister = vi.fn().mockResolvedValue({
            registered: ['t1', 't2'],
            failed: [],
            lastAttempt: '2026-05-07T00:00:00.000Z',
        });
        mockRegistryGet.mockReturnValue({ registerWebhooks: adapterRegister });
        mockGetStoreById.mockResolvedValue({
            id: 'store-1', isActive: true, storeDomain: 'shop.example',
            accessToken: 'enc', accessTokenIv: 'iv',
            // Zid dual-header auth: the second credential must reach the adapter
            // (null/undefined for Shopify/Salla rows — passed through either way).
            authorizationToken: 'enc-auth', authorizationTokenIv: 'iv-auth',
        });

        await capturedProcessor!({ id: 'job-1', data: { storeId: 'store-1', platform } });

        expect(mockRegistryGet).toHaveBeenCalledWith(platform);
        expect(adapterRegister).toHaveBeenCalledWith({
            id: 'store-1', storeDomain: 'shop.example', accessToken: 'enc', accessTokenIv: 'iv',
            authorizationToken: 'enc-auth', authorizationTokenIv: 'iv-auth',
        });
        expect(mockSaveWebhookStatus).toHaveBeenCalledWith('store-1', expect.objectContaining({
            registered: ['t1', 't2'], failed: [],
        }));
    });

    it('throws on partial failure so BullMQ schedules an exponential-backoff retry', async () => {
        const adapterRegister = vi.fn().mockResolvedValue({
            registered: ['t1'],
            failed: [{ topic: 't2', error: 'boom' }],
            lastAttempt: '2026-05-07T00:00:00.000Z',
        });
        mockRegistryGet.mockReturnValue({ registerWebhooks: adapterRegister });
        mockGetStoreById.mockResolvedValue({
            id: 'store-1', isActive: true, storeDomain: 'shop.example',
            accessToken: 'enc', accessTokenIv: 'iv',
        });

        await expect(capturedProcessor!({ id: 'job-1', data: { storeId: 'store-1', platform } }))
            .rejects.toThrow(new RegExp(`${platform} webhook retry`));
        expect(mockSaveWebhookStatus).toHaveBeenCalled();
    });

    it('skips silently when the platform has no registered adapter (no crash, no save)', async () => {
        mockRegistryGet.mockReturnValue(null);
        mockGetStoreById.mockResolvedValue({
            id: 'store-1', isActive: true, storeDomain: 'shop.example',
            accessToken: 'enc', accessTokenIv: 'iv',
        });

        await capturedProcessor!({ id: 'job-1', data: { storeId: 'store-1', platform } });

        expect(mockSaveWebhookStatus).not.toHaveBeenCalled();
    });

    it('skips when the store row is missing or inactive', async () => {
        mockGetStoreById.mockResolvedValue(null);

        await capturedProcessor!({ id: 'job-1', data: { storeId: 'store-1', platform } });

        expect(mockRegistryGet).not.toHaveBeenCalled();
        expect(mockSaveWebhookStatus).not.toHaveBeenCalled();
    });

    it('carries alreadyRegistered through the exhaustion marker instead of erasing it', async () => {
        // The exhaustion marker rebuilds webhookStatus from the previous row, so
        // anything it forgets to copy is destroyed — at exactly the moment the
        // store is stuck and the diagnostic matters most. `alreadyRegistered`
        // records which topics Zid rejected as duplicates, and with which status;
        // it is the only evidence distinguishing "the subscription already existed"
        // from "we just created a second one".
        mockGetStoreById.mockResolvedValue({
            id: 'store-1',
            platformData: {
                webhookStatus: {
                    registered: ['product.create', 'order.create'],
                    failed: [{ topic: 'product.update', status: 400 }],
                    alreadyRegistered: [{ topic: 'product.create', status: 400 }],
                },
            },
        });

        const onFailed = capturedHandlers.get('failed');
        expect(onFailed).toBeDefined();
        await onFailed!(
            { id: 'job-1', data: { storeId: 'store-1', platform }, attemptsMade: 3, opts: { attempts: 3 } },
            new Error('boom'),
        );
        // markWebhookStatusExhausted is fire-and-forget inside the handler.
        await vi.waitFor(() => expect(mockSaveWebhookStatus).toHaveBeenCalled());

        expect(mockSaveWebhookStatus).toHaveBeenCalledWith('store-1', expect.objectContaining({
            exhausted: true,
            alreadyRegistered: [{ topic: 'product.create', status: 400 }],
        }));
    });

    it('skips demo stores — placeholder tokens cannot be decrypted (JAWAB24-BACKEND-19)', async () => {
        mockGetStoreById.mockResolvedValue({
            id: 'store-demo', isActive: true, storeDomain: 'demo-electronics.myshopify.com',
            accessToken: 'demo_token_placeholder', accessTokenIv: '0'.repeat(32),
            platformData: { demo: true },
        });

        await capturedProcessor!({ id: 'job-1', data: { storeId: 'store-demo', platform } });

        expect(mockRegistryGet).not.toHaveBeenCalled();
        expect(mockSaveWebhookStatus).not.toHaveBeenCalled();
    });
});
