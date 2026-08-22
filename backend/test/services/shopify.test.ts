import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// --- Mocks ---

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

const txProxy = {
    select: () => mockSelect(),
    insert: () => mockInsert(),
    update: () => mockUpdate(),
    delete: () => mockDelete(),
};

const mockExecute = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/db', () => ({
    db: {
        select: () => mockSelect(),
        insert: () => mockInsert(),
        update: () => mockUpdate(),
        delete: () => mockDelete(),
        execute: (...args: unknown[]) => mockExecute(...args),
        transaction: async (fn: (tx: typeof txProxy) => Promise<void>) => fn(txProxy),
    },
}));

vi.mock('../../src/db/schema', () => ({
    ecommerceStores: {
        id: 'id',
        userId: 'user_id',
        storeDomain: 'store_domain',
        platform: 'platform',
        isActive: 'is_active',
    },
    ecommerceProducts: {
        ecommerceStoreId: 'ecommerce_store_id',
        status: 'status',
    },
    pages: {
        id: 'id',
        userId: 'user_id',
        workspaceId: 'workspace_id',
        ecommerceStoreId: 'ecommerce_store_id',
        kbActiveVersion: 'kb_active_version',
    },
    pendingEcommerceInstalls: {
        id: 'id',
        platform: 'platform',
        storeDomain: 'store_domain',
        status: 'status',
        expiresAt: 'expires_at',
    },
    workspaceMembers: {
        id: 'id',
        workspaceId: 'workspace_id',
        userId: 'user_id',
        role: 'role',
    },
}));

vi.mock('drizzle-orm', () => ({
    eq: vi.fn((field, value) => ({ field, value, op: 'eq' })),
    and: vi.fn((...args) => ({ op: 'and', args })),
    lt: vi.fn((field, value) => ({ field, value, op: 'lt' })),
    sql: Object.assign(
        (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values, _tag: 'sql' }),
        { raw: (s: string) => ({ raw: s, _tag: 'sql_raw' }) },
    ),
}));

const mockCaptureError = vi.fn();
vi.mock('../../src/utils/sentryHelpers', () => ({
    captureError: (...args: unknown[]) => mockCaptureError(...args),
}));

vi.mock('../../src/config', () => ({
    config: {
        shopify: {
            apiKey: 'test_api_key',
            apiSecret: 'test_api_secret',
            scopes: 'read_products,read_content',
            hostName: 'jawab24.com',
        },
    },
}));

// Mock Redis
const mockRedisScan = vi.fn().mockResolvedValue(['0', []]);
const mockRedisDel = vi.fn().mockResolvedValue(0);
vi.mock('../../src/lib/redis', () => ({
    redis: {
        scan: (...args: unknown[]) => mockRedisScan(...args),
        del: (...args: unknown[]) => mockRedisDel(...args),
        get: vi.fn().mockResolvedValue(null),
        set: vi.fn().mockResolvedValue('OK'),
        quit: vi.fn(),
    },
    async redisScanDelete(pattern: string, filter?: (k: string) => boolean) {
        let cursor = '0';
        const toDelete: string[] = [];
        do {
            const [nextCursor, keys] = await mockRedisScan(cursor, 'MATCH', pattern, 'COUNT', 100);
            cursor = nextCursor;
            for (const k of keys as string[]) {
                if (!filter || filter(k)) toDelete.push(k);
            }
        } while (cursor !== '0');
        for (let i = 0; i < toDelete.length; i += 100) {
            const batch = toDelete.slice(i, i + 100);
            if (batch.length > 0) await mockRedisDel(...batch);
        }
    },
}));

// Mock pages service (getIngestionService used by invalidateCachesForStore)
vi.mock('../../src/services/pages', () => ({
    getIngestionService: vi.fn(() => ({
        ingestFullPage: vi.fn().mockResolvedValue(undefined),
    })),
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocks
import {
    buildAuthUrl,
    verifyWebhookHmac,
    buildVariantSummary,
    getEnrichedKnowledgeBase,
    mapToEcommerceStore,
    exchangeCodeForToken,
    registerWebhooks,
    linkStoreToPage,
    invalidateCachesForStore,
    SHOPIFY_API_VERSION,
} from '../../src/services/shopify';

describe('Shopify Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    // --- buildAuthUrl ---

    describe('buildAuthUrl', () => {
        it('should build a valid OAuth URL', () => {
            const url = buildAuthUrl('test-store.myshopify.com', 'abc123');

            expect(url).toContain('test-store.myshopify.com/admin/oauth/authorize');
            expect(url).toContain('client_id=test_api_key');
            expect(url).toContain('scope=read_products,read_content');
            expect(url).toContain('state=abc123');
            expect(url).toContain(encodeURIComponent('https://jawab24.com/shopify/auth/callback'));
        });

        it('should encode the redirect URI', () => {
            const url = buildAuthUrl('my-store.myshopify.com', 'state123');
            expect(url).toContain('redirect_uri=');
            expect(url).not.toContain('redirect_uri=https://'); // Should be encoded
        });
    });

    // --- verifyWebhookHmac ---

    describe('verifyWebhookHmac', () => {
        it('should return true for a valid HMAC', () => {
            const body = '{"test": "data"}';
            const hash = crypto
                .createHmac('sha256', 'test_api_secret')
                .update(body, 'utf8')
                .digest('base64');

            expect(verifyWebhookHmac(body, hash)).toBe(true);
        });

        it('should return false for an invalid HMAC', () => {
            const body = '{"test": "data"}';
            expect(verifyWebhookHmac(body, 'invalid_hmac_value')).toBe(false);
        });

        it('should return false for mismatched body content', () => {
            const body = '{"test": "data"}';
            const hash = crypto
                .createHmac('sha256', 'test_api_secret')
                .update('different body', 'utf8')
                .digest('base64');

            expect(verifyWebhookHmac(body, hash)).toBe(false);
        });

        it('should return false for different length buffers', () => {
            expect(verifyWebhookHmac('body', 'short')).toBe(false);
        });
    });

    // --- exchangeCodeForToken ---

    describe('exchangeCodeForToken', () => {
        it('should exchange code for access token', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ access_token: 'shpat_test123' }),
            });

            const token = await exchangeCodeForToken('test-store.myshopify.com', 'auth_code_123');

            expect(token).toBe('shpat_test123');
            expect(mockFetch).toHaveBeenCalledWith(
                'https://test-store.myshopify.com/admin/oauth/access_token',
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('auth_code_123'),
                })
            );
        });

        it('should throw on failed token exchange', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

            await expect(
                exchangeCodeForToken('test-store.myshopify.com', 'bad_code')
            ).rejects.toThrow('Shopify token exchange failed: 400');
        });
    });

    // --- registerWebhooks (GraphQL list-then-upsert) ---

    describe('registerWebhooks', () => {
        const GRAPHQL_URL = `https://test-store.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
        const WEBHOOK_BASE = 'https://jawab24.com/shopify/webhooks';

        // REST-style topic → { GraphQL enum, delivery address } — mirrors the
        // service's SHOPIFY_WEBHOOK_TOPIC_DEFS; a drift here is a real topic change.
        const TOPIC_MAP: Array<{ topic: string; gqlTopic: string; address: string }> = [
            { topic: 'app/uninstalled', gqlTopic: 'APP_UNINSTALLED', address: `${WEBHOOK_BASE}/uninstall` },
            { topic: 'products/create', gqlTopic: 'PRODUCTS_CREATE', address: `${WEBHOOK_BASE}/products-update` },
            { topic: 'products/update', gqlTopic: 'PRODUCTS_UPDATE', address: `${WEBHOOK_BASE}/products-update` },
            { topic: 'products/delete', gqlTopic: 'PRODUCTS_DELETE', address: `${WEBHOOK_BASE}/products-update` },
            { topic: 'orders/create', gqlTopic: 'ORDERS_CREATE', address: `${WEBHOOK_BASE}/orders` },
            { topic: 'orders/fulfilled', gqlTopic: 'ORDERS_FULFILLED', address: `${WEBHOOK_BASE}/orders` },
            { topic: 'orders/cancelled', gqlTopic: 'ORDERS_CANCELLED', address: `${WEBHOOK_BASE}/orders` },
            { topic: 'fulfillments/update', gqlTopic: 'FULFILLMENTS_UPDATE', address: `${WEBHOOK_BASE}/fulfillments` },
        ];

        const gqlResponse = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

        const listResponse = (edges: Array<{ id: string; gqlTopic: string; callbackUrl: string }>) =>
            gqlResponse({
                data: {
                    webhookSubscriptions: {
                        edges: edges.map(e => ({
                            node: {
                                id: e.id,
                                topic: e.gqlTopic,
                                endpoint: { __typename: 'WebhookHttpEndpoint', callbackUrl: e.callbackUrl },
                            },
                        })),
                    },
                },
            });

        const createSuccess = gqlResponse({
            data: { webhookSubscriptionCreate: { webhookSubscription: { id: 'gid://shopify/WebhookSubscription/1' }, userErrors: [] } },
        });
        const updateSuccess = gqlResponse({
            data: { webhookSubscriptionUpdate: { webhookSubscription: { id: 'gid://shopify/WebhookSubscription/1' }, userErrors: [] } },
        });

        /** Parsed bodies of every GraphQL call made so far */
        const sentBodies = () => mockFetch.mock.calls.map(([, opts]) => JSON.parse((opts as { body: string }).body));
        const isListCall = (body: { query: string }) => body.query.includes('query webhookSubscriptions');
        const createCalls = () => sentBodies().filter(b => b.query.includes('webhookSubscriptionCreate'));
        const updateCalls = () => sentBodies().filter(b => b.query.includes('webhookSubscriptionUpdate'));

        it('creates all 8 subscriptions via GraphQL when none exist, in topic order', async () => {
            mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
                const body = JSON.parse(opts.body);
                if (isListCall(body)) return listResponse([]);
                return createSuccess;
            });

            const result = await registerWebhooks('test-store.myshopify.com', 'token123');

            // 1 list query + 8 creates, all against the GraphQL endpoint
            expect(mockFetch).toHaveBeenCalledTimes(9);
            for (const [url] of mockFetch.mock.calls) {
                expect(url).toBe(GRAPHQL_URL);
            }
            expect(updateCalls()).toHaveLength(0);
            const creates = createCalls();
            for (const { gqlTopic, address } of TOPIC_MAP) {
                const call = creates.find(c => c.variables.topic === gqlTopic);
                expect(call, `missing create for ${gqlTopic}`).toBeDefined();
                expect(call.variables.webhookSubscription).toEqual({ callbackUrl: address, format: 'JSON' });
            }
            // Contract: REST-style topic names in registration order, empty failed, ISO timestamp
            expect(result.registered).toEqual(TOPIC_MAP.map(t => t.topic));
            expect(result.failed).toEqual([]);
            expect(new Date(result.lastAttempt).toISOString()).toBe(result.lastAttempt);
        });

        it('issues no mutations when every subscription already points at the right URL', async () => {
            mockFetch.mockResolvedValue(listResponse(
                TOPIC_MAP.map((t, i) => ({ id: `gid://shopify/WebhookSubscription/${i}`, gqlTopic: t.gqlTopic, callbackUrl: t.address })),
            ));

            const result = await registerWebhooks('test-store.myshopify.com', 'token123');

            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(result.registered).toEqual(TOPIC_MAP.map(t => t.topic));
            expect(result.failed).toEqual([]);
        });

        it('updates the existing subscription in place when its callback URL drifted (stale-URL fix)', async () => {
            mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
                const body = JSON.parse(opts.body);
                if (isListCall(body)) {
                    return listResponse([{
                        id: 'gid://shopify/WebhookSubscription/99',
                        gqlTopic: 'ORDERS_CREATE',
                        callbackUrl: 'https://stale-tunnel.ngrok.io/shopify/webhooks/orders',
                    }]);
                }
                if (body.query.includes('webhookSubscriptionUpdate')) return updateSuccess;
                return createSuccess;
            });

            const result = await registerWebhooks('test-store.myshopify.com', 'token123');

            const updates = updateCalls();
            expect(updates).toHaveLength(1);
            expect(updates[0].variables).toEqual({
                id: 'gid://shopify/WebhookSubscription/99',
                webhookSubscription: { callbackUrl: `${WEBHOOK_BASE}/orders` },
            });
            // The drifted topic is NOT re-created — the other 7 are
            const creates = createCalls();
            expect(creates).toHaveLength(7);
            expect(creates.some(c => c.variables.topic === 'ORDERS_CREATE')).toBe(false);
            expect(result.registered).toEqual(TOPIC_MAP.map(t => t.topic));
            expect(result.failed).toEqual([]);
        });

        it('prefers the URL-matching subscription over a stale REST-era duplicate of the same topic', async () => {
            // The REST era could leave TWO subscriptions on one topic (a changed
            // address POSTed a second subscription; 422 only fired on exact
            // topic+address match). Updating the stale twin would collide with
            // the matching one — the matching one must win and the topic skip.
            mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
                const body = JSON.parse(opts.body);
                if (isListCall(body)) {
                    return listResponse([
                        { id: 'gid://shopify/WebhookSubscription/10', gqlTopic: 'ORDERS_CREATE', callbackUrl: 'https://stale-tunnel.ngrok.io/shopify/webhooks/orders' },
                        { id: 'gid://shopify/WebhookSubscription/11', gqlTopic: 'ORDERS_CREATE', callbackUrl: `${WEBHOOK_BASE}/orders` },
                    ]);
                }
                return createSuccess;
            });

            const result = await registerWebhooks('test-store.myshopify.com', 'token123');

            expect(updateCalls()).toHaveLength(0);
            expect(createCalls().some(c => c.variables.topic === 'ORDERS_CREATE')).toBe(false);
            expect(result.registered).toContain('orders/create');
            expect(result.failed).toEqual([]);
        });

        it('reports a per-topic failure on userErrors without failing the batch', async () => {
            mockCaptureError.mockClear();
            mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
                const body = JSON.parse(opts.body);
                if (isListCall(body)) return listResponse([]);
                if (body.variables.topic === 'PRODUCTS_UPDATE') {
                    return gqlResponse({
                        data: { webhookSubscriptionCreate: { webhookSubscription: null, userErrors: [{ field: ['topic'], message: 'Topic not allowed' }] } },
                    });
                }
                return createSuccess;
            });

            const result = await registerWebhooks('test-store.myshopify.com', 'token123');

            expect(result.failed).toEqual([{ topic: 'products/update', error: 'Topic not allowed' }]);
            expect(result.registered).toEqual(TOPIC_MAP.filter(t => t.topic !== 'products/update').map(t => t.topic));
            expect(mockCaptureError).toHaveBeenCalledTimes(1);
        });

        it('retries a THROTTLED mutation and succeeds', async () => {
            vi.useFakeTimers();
            let fulfillmentsAttempts = 0;
            mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
                const body = JSON.parse(opts.body);
                if (isListCall(body)) return listResponse([]);
                if (body.variables.topic === 'FULFILLMENTS_UPDATE' && ++fulfillmentsAttempts === 1) {
                    return gqlResponse({
                        errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }],
                        extensions: { cost: { requestedQueryCost: 10, throttleStatus: { currentlyAvailable: 0, restoreRate: 50 } } },
                    });
                }
                return createSuccess;
            });

            const promise = registerWebhooks('test-store.myshopify.com', 'token123');
            await vi.runAllTimersAsync();
            const result = await promise;
            vi.useRealTimers();

            expect(fulfillmentsAttempts).toBe(2);
            expect(result.registered).toEqual(TOPIC_MAP.map(t => t.topic));
            expect(result.failed).toEqual([]);
        });

        it('throws when the subscription list query fails (callers persist failed-all + enqueue retry)', async () => {
            mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) });

            await expect(registerWebhooks('test-store.myshopify.com', 'token123'))
                .rejects.toThrow('Shopify GraphQL HTTP error: 400');
        });

        it('names the page-overflow condition loudly instead of colliding silently', async () => {
            // >100 subscriptions pushes the URL-matching twin onto an unseen
            // page 2, degenerating the upsert into the unhealable "address
            // already taken" loop. The guard can't see page 2 either — but it
            // makes the failure one Sentry search away instead of a mystery.
            mockCaptureError.mockClear();
            mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
                const body = JSON.parse(opts.body);
                if (isListCall(body)) {
                    const full = listResponse([]);
                    const payload = await full.json() as { data: { webhookSubscriptions: Record<string, unknown> } };
                    payload.data.webhookSubscriptions.pageInfo = { hasNextPage: true };
                    return gqlResponse(payload);
                }
                return createSuccess;
            });

            await registerWebhooks('test-store.myshopify.com', 'token123');

            expect(mockCaptureError).toHaveBeenCalledWith(
                expect.any(Error),
                expect.stringContaining('shopify_webhook_list_overflow'),
                expect.objectContaining({ level: 'warning' }),
            );
        });

        it('prefers an HTTP twin over a non-HTTP subscription when healing drift', async () => {
            // An EventBridge/PubSub subscription (created out-of-band on the
            // same app credentials) has no callbackUrl and cannot take one —
            // updating it would loop on userErrors forever. The HTTP twin,
            // even stale, is the one that can be healed.
            mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
                const body = JSON.parse(opts.body);
                if (isListCall(body)) {
                    return gqlResponse({
                        data: {
                            webhookSubscriptions: {
                                edges: [
                                    // Non-HTTP first so naive first-wins would pick it
                                    { node: { id: 'gid://shopify/WebhookSubscription/20', topic: 'ORDERS_CREATE', endpoint: { __typename: 'WebhookEventBridgeEndpoint' } } },
                                    { node: { id: 'gid://shopify/WebhookSubscription/21', topic: 'ORDERS_CREATE', endpoint: { __typename: 'WebhookHttpEndpoint', callbackUrl: 'https://stale-tunnel.ngrok.io/shopify/webhooks/orders' } } },
                                ],
                            },
                        },
                    });
                }
                if (body.query.includes('webhookSubscriptionUpdate')) return updateSuccess;
                return createSuccess;
            });

            const result = await registerWebhooks('test-store.myshopify.com', 'token123');

            const updates = updateCalls();
            expect(updates).toHaveLength(1);
            expect(updates[0].variables.id).toBe('gid://shopify/WebhookSubscription/21');
            expect(result.failed).toEqual([]);
        });
    });

    // --- buildVariantSummary ---

    describe('buildVariantSummary', () => {
        it('should group options by name', () => {
            const variants = [
                {
                    title: 'S / Black',
                    selectedOptions: [
                        { name: 'Size', value: 'S' },
                        { name: 'Color', value: 'Black' },
                    ],
                },
                {
                    title: 'M / Black',
                    selectedOptions: [
                        { name: 'Size', value: 'M' },
                        { name: 'Color', value: 'Black' },
                    ],
                },
                {
                    title: 'S / White',
                    selectedOptions: [
                        { name: 'Size', value: 'S' },
                        { name: 'Color', value: 'White' },
                    ],
                },
            ];

            const result = buildVariantSummary(variants);
            expect(result).toContain('Size: S, M');
            expect(result).toContain('Color: Black, White');
            expect(result).toContain(' | ');
        });

        it('should skip Default Title variants', () => {
            const variants = [
                {
                    title: 'Default Title',
                    selectedOptions: [{ name: 'Title', value: 'Default Title' }],
                },
            ];

            const result = buildVariantSummary(variants);
            expect(result).toBe('');
        });

        it('should handle empty variants', () => {
            expect(buildVariantSummary([])).toBe('');
        });

        it('should handle single option group', () => {
            const variants = [
                { title: 'S', selectedOptions: [{ name: 'Size', value: 'S' }] },
                { title: 'M', selectedOptions: [{ name: 'Size', value: 'M' }] },
                { title: 'L', selectedOptions: [{ name: 'Size', value: 'L' }] },
            ];

            const result = buildVariantSummary(variants);
            expect(result).toBe('Size: S, M, L');
        });

        it('should truncate variant summary longer than 200 chars', () => {
            // Create many variants that produce a long summary
            const variants = Array.from({ length: 50 }, (_, i) => ({
                title: `Variant-${i}`,
                selectedOptions: [
                    { name: 'Color', value: `VeryLongColorName-${i}` },
                ],
            }));

            const result = buildVariantSummary(variants);
            expect(result.length).toBeLessThanOrEqual(200);
            expect(result).toMatch(/\.\.\.$/);
        });

        it('should not truncate variant summary under 200 chars', () => {
            const variants = [
                { title: 'S', selectedOptions: [{ name: 'Size', value: 'S' }] },
                { title: 'M', selectedOptions: [{ name: 'Size', value: 'M' }] },
            ];

            const result = buildVariantSummary(variants);
            expect(result).not.toMatch(/\.\.\.$/);
        });

        it('should handle variants with missing selectedOptions', () => {
            const variants = [
                { title: 'S', selectedOptions: [{ name: 'Size', value: 'S' }] },
                { title: 'Missing', selectedOptions: undefined as any },
            ];

            const result = buildVariantSummary(variants);
            expect(result).toBe('Size: S');
        });
    });

    // --- linkStoreToPage ---

    describe('linkStoreToPage', () => {
        it('should throw if page does not belong to workspace', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            await expect(
                linkStoreToPage('store-1', 'page-1', 'workspace-1')
            ).rejects.toThrow('Page not found or does not belong to workspace');
        });

        it('should link page when workspace owns it', async () => {
            const mockWhere = vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'page-1', workspaceId: 'workspace-1' }]),
            });
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({ where: mockWhere }),
            });

            const mockSet = vi.fn().mockReturnValue({
                where: vi.fn().mockResolvedValue(undefined),
            });
            mockUpdate.mockReturnValue({
                set: mockSet,
            });

            await linkStoreToPage('store-1', 'page-1', 'workspace-1');
            expect(mockUpdate).toHaveBeenCalled();
        });
    });

    // --- getEnrichedKnowledgeBase ---

    describe('getEnrichedKnowledgeBase', () => {
        it('should return pageKB when store not found', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('page KB content', 'non-existent');
            expect(result).toBe('page KB content');
        });

        it('should return pageKB when store is inactive', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([{ isActive: false }]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('page KB', 'store-1');
            expect(result).toBe('page KB');
        });

        it('should prioritize Shopify data over page KB', async () => {
            const store = {
                isActive: true,
                productSummary: 'Product A — 100 AED\nProduct B — 200 AED',
                policiesSummary: 'Shipping: 2-3 days',
            };
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([store]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('My page info', 'store-1');
            expect(result).toContain('Product A — 100 AED');
            expect(result).toContain('Shipping: 2-3 days');
            expect(result).toContain('My page info');
        });

        it('should truncate page KB to stay under 1500 chars', async () => {
            const longProductSummary = 'X'.repeat(1400);
            const store = {
                isActive: true,
                productSummary: longProductSummary,
                policiesSummary: null,
            };
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([store]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('Page KB that should be truncated', 'store-1');
            expect(result.length).toBeLessThanOrEqual(1500 + 10); // Allow for separator
        });

        it('should skip page KB when remaining space is less than 100 chars', async () => {
            const store = {
                isActive: true,
                productSummary: 'X'.repeat(7950),
                policiesSummary: null,
            };
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([store]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase('Should be excluded', 'store-1');
            expect(result).not.toContain('Should be excluded');
        });

        it('should return empty string when no data available', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockReturnValue({
                        limit: vi.fn().mockResolvedValue([]),
                    }),
                }),
            });

            const result = await getEnrichedKnowledgeBase(undefined, 'non-existent');
            expect(result).toBe('');
        });
    });

    // --- mapToEcommerceStore ---

    describe('mapToEcommerceStore', () => {
        it('should map database row to EcommerceStore type', () => {
            const row = {
                id: 'store-1',
                userId: 'user-1',
                platform: 'shopify',
                storeDomain: 'test.myshopify.com',
                accessToken: 'shpat_xxx',
                storeName: 'Test Store',
                storeEmail: 'test@example.com',
                storeCurrency: 'AED',
                storeTimezone: 'GST',
                platformData: { planName: 'basic' },
                productCount: 42,
                productSummary: 'Products summary',
                policiesSummary: 'Policies summary',
                lastSyncAt: new Date('2026-01-01'),
                isActive: true,
                installedAt: new Date('2025-12-01'),
                uninstalledAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const result = mapToEcommerceStore(row as any);

            expect(result.id).toBe('store-1');
            expect(result.userId).toBe('user-1');
            expect(result.storeDomain).toBe('test.myshopify.com');
            expect(result.shopDomain).toBe('test.myshopify.com'); // DTO alias
            expect(result.storeName).toBe('Test Store');
            expect(result.productCount).toBe(42);
            expect(result.isActive).toBe(true);
            // Should NOT expose accessToken
            expect((result as any).accessToken).toBeUndefined();
        });

        it('should default productCount to 0 when null', () => {
            const row = {
                id: 'store-1',
                userId: 'user-1',
                platform: 'shopify',
                storeDomain: 'test.myshopify.com',
                productCount: null,
                isActive: null,
            };

            const result = mapToEcommerceStore(row as any);
            expect(result.productCount).toBe(0);
            expect(result.isActive).toBe(true);
        });
    });

    // --- invalidateCachesForStore ---

    describe('invalidateCachesForStore', () => {
        /**
         * Helper: mock the full db.select() chain used by invalidateCachesForStore.
         * The function calls db.select() multiple times:
         *   1. Linked pages (from pages WHERE ecommerceStoreId)
         *   2..N+1. Per-page kbActiveVersion (.limit(1) per page)
         *   N+2. Store policies (from ecommerceStores WHERE id) — .limit(1)
         *   N+3. All active products (from ecommerceProducts WHERE storeId + active)
         *   N+4..2N+3. Per-page knowledgeBase (.limit(1) per page)
         */
        function mockLinkedPages(pageIds: string[]) {
            const n = pageIds.length;
            let callCount = 0;
            mockSelect.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // 1. Linked pages
                    return {
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue(pageIds.map(id => ({ id }))),
                        }),
                    };
                }
                if (callCount <= 1 + n) {
                    // 2..N+1. Per-page kbActiveVersion
                    return {
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([{ kbActiveVersion: 1 }]),
                            }),
                        }),
                    };
                }
                if (callCount === 2 + n) {
                    // N+2. Store policies
                    return {
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockReturnValue({
                                limit: vi.fn().mockResolvedValue([{ policiesSummary: '' }]),
                            }),
                        }),
                    };
                }
                if (callCount === 3 + n) {
                    // N+3. All active products
                    return {
                        from: vi.fn().mockReturnValue({
                            where: vi.fn().mockResolvedValue([]),
                        }),
                    };
                }
                // N+4+. Per-page knowledgeBase
                return {
                    from: vi.fn().mockReturnValue({
                        where: vi.fn().mockReturnValue({
                            limit: vi.fn().mockResolvedValue([{
                                knowledgeBase: 'KB text',
                            }]),
                        }),
                    }),
                };
            });
        }

        it('should return 0 and skip work when no pages linked', async () => {
            mockLinkedPages([]);

            const result = await invalidateCachesForStore('store-1');

            expect(result).toBe(0);
            expect(mockUpdate).not.toHaveBeenCalled();
            expect(mockRedisScan).not.toHaveBeenCalled();
        });

        it('should compute next kbVersion without bumping kbActiveVersion', async () => {
            mockLinkedPages(['page-1', 'page-2']);

            await invalidateCachesForStore('store-1');

            // Should NOT have called db.update — version activation is handled by ingestFullPage
            expect(mockUpdate).not.toHaveBeenCalled();
        });

        it('should NOT scan or delete Redis ai_reply cache keys (D-090)', async () => {
            mockLinkedPages(['page-1']);

            // If a flush were re-introduced, the real redisScanDelete would drive these two
            // (this file mocks the redis CLIENT, not the helper), so the assertions below are
            // load-bearing. Inverted 2026-08-22: the key carries `kbv:{kbActiveVersion}`, so
            // activating the new version retires the linked pages' entries on its own — while
            // the pattern `cache:ai_reply:*` is unscopeable and wiped every workspace's warm
            // replies on every product webhook and every 6-hourly sync (Rule 17.1).
            await invalidateCachesForStore('store-1');

            expect(mockRedisScan).not.toHaveBeenCalled();
            expect(mockRedisDel).not.toHaveBeenCalled();
        });

        it('should delete semantic_cache rows for affected pages', async () => {
            mockLinkedPages(['page-1', 'page-2']);

            await invalidateCachesForStore('store-1');

            // Should have called db.execute for each page (semantic_cache delete)
            expect(mockExecute).toHaveBeenCalledTimes(2);
        });

        it('should return the count of invalidated pages', async () => {
            mockLinkedPages(['page-1', 'page-2', 'page-3']);

            const result = await invalidateCachesForStore('store-1');
            expect(result).toBe(3);
        });

        it('should not throw when Redis is unavailable', async () => {
            mockLinkedPages(['page-1']);

            // Simulate Redis failure
            mockRedisScan.mockRejectedValueOnce(new Error('Connection refused'));

            // Should not throw — best-effort
            const result = await invalidateCachesForStore('store-1');
            expect(result).toBe(1);
        });

        it('should capture error and return 0 when DB query fails', async () => {
            mockSelect.mockReturnValue({
                from: vi.fn().mockReturnValue({
                    where: vi.fn().mockRejectedValue(new Error('DB down')),
                }),
            });

            const result = await invalidateCachesForStore('store-1');

            expect(result).toBe(0);
            expect(mockCaptureError).toHaveBeenCalledWith(
                expect.any(Error),
                'E-commerce cache invalidation failed',
                expect.objectContaining({ tags: { service: 'ecommerce' } }),
            );
        });
    });
});
