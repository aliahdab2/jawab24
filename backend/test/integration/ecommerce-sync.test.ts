/**
 * Integration tests for the e-commerce product-sync flow (real Postgres, mocked
 * platform HTTP).
 *
 * House pattern (see payment.test.ts): mock ONLY third-party external
 * boundaries — here the Shopify Admin API (global fetch) and the BullMQ
 * notification queue (Redis) — and keep every DB operation real.
 *
 * Covered flows:
 *   - createStore: AES-GCM token encryption at rest + onConflictDoUpdate re-connect
 *   - claimPendingInstall: pending row decrypt → store created → row consumed,
 *     double-claim/expiry/platform-mismatch/foreign-owner guards, webhook-status persist
 *   - syncProducts (full Shopify catalog sync): insert, idempotent re-sync with
 *     stable internal ids (bug B-3.1), in-place update, removal, empty catalog, pagination
 *   - webhook product path: mapShopifyWebhookProduct → upsertSingleProduct /
 *     deleteSingleProduct (mirrors webhookProductsUpdate in controllers/shopify.ts)
 *
 * Intentionally NOT covered: the Salla order-event parser (buildSallaOrderEvent)
 * — known field-mapping bugs are under live validation and tests must not bless
 * current behavior — and live OAuth flows against real Shopify.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import * as schema from '../../src/db/schema';

// BullMQ queue connects to Redis — external boundary, not under test.
// services/ecommerce.ts → customerNotifications.ts imports it at module load,
// and no Redis runs alongside the integration test DB.
vi.mock('../../src/lib/customerNotificationQueue', () => ({
    CUSTOMER_NOTIFICATION_QUEUE: 'customer-notifications',
    customerNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import {
    createStore,
    deactivateStore,
    createPendingInstall,
    claimPendingInstall,
    saveWebhookStatus,
    upsertSingleProduct,
    deleteSingleProduct,
    replaceProductsAndRebuildSummary,
    PRODUCT_SAFETY_CAP,
    getAllActiveStores,
    type WebhookRegistrationResult,
} from '../../src/services/ecommerce';
import { syncProducts, mapShopifyWebhookProduct, SHOPIFY_API_VERSION } from '../../src/services/shopify';
import { encrypt, decrypt, decryptOptional } from '../../src/services/ecommerceCrypto';
import { uniq } from '../helpers/ecommerceFixtures';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------


async function getStoreRow(storeId: string): Promise<typeof schema.ecommerceStores.$inferSelect> {
    const [row] = await testDb.select().from(schema.ecommerceStores)
        .where(eq(schema.ecommerceStores.id, storeId)).limit(1);
    if (!row) throw new Error(`ecommerce_stores row ${storeId} not found`);
    return row;
}

async function getProductRows(storeId: string): Promise<Array<typeof schema.ecommerceProducts.$inferSelect>> {
    return testDb.select().from(schema.ecommerceProducts)
        .where(eq(schema.ecommerceProducts.ecommerceStoreId, storeId))
        .orderBy(schema.ecommerceProducts.platformProductId);
}

/** User + workspace + connected Shopify store (tokens go through the real encrypt path). */
async function createConnectedStore(opts: { accessToken?: string } = {}) {
    const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('merchant')}@test.com` });
    const workspace = await createTestWorkspace(user.id);
    const store = await createStore({
        userId: user.id,
        platform: 'shopify',
        storeDomain: `${uniq('store')}.myshopify.com`,
        accessToken: opts.accessToken ?? 'shpat_default_sync_token',
        shopInfo: { shopName: 'Test Store', shopCurrency: 'SAR' },
        workspaceId: workspace.id,
    });
    return { user, workspace, store };
}

// --- Shopify GraphQL response builders (shape of fetchAllProducts query) ---

interface GqlVariant {
    title: string;
    selectedOptions: Array<{ name: string; value: string }>;
}

interface GqlProductInput {
    id: string;
    title: string;
    handle?: string;
    description?: string;
    productType?: string;
    vendor?: string;
    status?: string;
    tags?: string[];
    totalInventory?: number;
    hasOnlyDefaultVariant?: boolean;
    imageUrl?: string;
    minPrice?: string;
    maxPrice?: string;
    currencyCode?: string;
    variants?: GqlVariant[];
}

function gqlProductNode(p: GqlProductInput) {
    const currencyCode = p.currencyCode ?? 'SAR';
    return {
        id: `gid://shopify/Product/${p.id}`,
        handle: p.handle ?? `handle-${p.id}`,
        title: p.title,
        description: p.description ?? '',
        productType: p.productType ?? '',
        vendor: p.vendor ?? '',
        status: p.status ?? 'ACTIVE',
        tags: p.tags ?? [],
        totalInventory: p.totalInventory ?? 10,
        hasOnlyDefaultVariant: p.hasOnlyDefaultVariant ?? true,
        featuredImage: p.imageUrl ? { url: p.imageUrl } : null,
        priceRangeV2: {
            minVariantPrice: { amount: p.minPrice ?? '100.00', currencyCode },
            maxVariantPrice: { amount: p.maxPrice ?? p.minPrice ?? '100.00', currencyCode },
        },
        variants: {
            edges: (p.variants ?? [
                { title: 'Default Title', selectedOptions: [{ name: 'Title', value: 'Default Title' }] },
            ]).map(v => ({ node: v })),
        },
    };
}

function gqlProductsResponse(
    nodes: Array<ReturnType<typeof gqlProductNode>>,
    pageInfo: { hasNextPage: boolean; endCursor: string | null } = { hasNextPage: false, endCursor: null },
): Response {
    const body = {
        data: {
            products: {
                edges: nodes.map((node, i) => ({ node, cursor: `cursor-${i}` })),
                pageInfo,
            },
        },
    };
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

// ---------------------------------------------------------------------------
// createStore — tokens encrypted at rest + re-connect upsert
// ---------------------------------------------------------------------------

describe('createStore — tokens encrypted at rest', () => {
    it('stores AES-GCM ciphertext + IV (never plaintext) and round-trips on decrypt', async () => {
        const accessPlain = 'shpat_super_secret_access_token';
        const refreshPlain = 'salla_super_secret_refresh_token';
        const user = await createTestUser({ facebookId: uniq('fb') });

        const store = await createStore({
            userId: user.id,
            platform: 'salla',
            storeDomain: 'enc-test.salla.sa',
            accessToken: accessPlain,
            refreshToken: refreshPlain,
            tokenExpiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
        });

        const row = await getStoreRow(store.id);

        expect(row.accessToken).not.toContain(accessPlain);
        expect(row.accessTokenIv).toMatch(/^[0-9a-f]{32}$/i);
        expect(decrypt(row.accessToken, row.accessTokenIv)).toBe(accessPlain);

        expect(row.refreshToken).not.toBeNull();
        expect(row.refreshToken).not.toContain(refreshPlain);
        expect(row.refreshTokenIv).toMatch(/^[0-9a-f]{32}$/i);
        expect(decryptOptional(row.refreshToken, row.refreshTokenIv)).toBe(refreshPlain);
    });

    it('re-connecting the same platform+domain updates the row in place and reactivates it', async () => {
        const user = await createTestUser({ facebookId: uniq('fb') });
        const domain = 'reconnect.myshopify.com';

        const first = await createStore({
            userId: user.id, platform: 'shopify', storeDomain: domain,
            accessToken: 'token-one', shopInfo: { shopName: 'Old Name' },
        });

        await deactivateStore('shopify', domain);
        const deactivated = await getStoreRow(first.id);
        expect(deactivated.isActive).toBe(false);
        expect(deactivated.uninstalledAt).not.toBeNull();

        const second = await createStore({
            userId: user.id, platform: 'shopify', storeDomain: domain,
            accessToken: 'token-two', shopInfo: { shopName: 'New Name' },
        });

        expect(second.id).toBe(first.id); // onConflictDoUpdate, not a new row

        const rows = await testDb.select().from(schema.ecommerceStores).where(and(
            eq(schema.ecommerceStores.platform, 'shopify'),
            eq(schema.ecommerceStores.storeDomain, domain),
        ));
        expect(rows).toHaveLength(1);
        expect(rows[0].isActive).toBe(true);
        expect(rows[0].uninstalledAt).toBeNull();
        expect(rows[0].storeName).toBe('New Name');
        expect(decrypt(rows[0].accessToken, rows[0].accessTokenIv)).toBe('token-two');
    });
});

// ---------------------------------------------------------------------------
// getAllActiveStores — demo stores excluded from real-API iterators
// ---------------------------------------------------------------------------

describe('getAllActiveStores — demo store exclusion', () => {
    it('omits demo-seeded stores (platformData.demo) so the sync cron never hits their placeholder tokens', async () => {
        const { store: realStore } = await createConnectedStore();

        const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('demo')}@test.com` });
        const workspace = await createTestWorkspace(user.id);
        const [demoStore] = await testDb.insert(schema.ecommerceStores).values({
            userId: user.id,
            workspaceId: workspace.id,
            platform: 'shopify',
            storeDomain: `${uniq('demo-store')}.myshopify.com`,
            accessToken: 'demo_token_placeholder', // not real ciphertext — decrypt() throws
            accessTokenIv: '0'.repeat(32),
            platformData: { planName: 'basic', demo: true },
            isActive: true,
        }).returning({ id: schema.ecommerceStores.id });

        const activeIds = (await getAllActiveStores('shopify')).map(s => s.id);

        expect(activeIds).toContain(realStore.id);
        expect(activeIds).not.toContain(demoStore.id);
    });
});

// ---------------------------------------------------------------------------
// claimPendingInstall — pending install flow
// ---------------------------------------------------------------------------

describe('claimPendingInstall — pending install flow', () => {
    it('decrypts the pending token, creates the store in the user workspace, and marks the row claimed', async () => {
        const user = await createTestUser({ facebookId: uniq('fb') });
        const workspace = await createTestWorkspace(user.id);
        const plain = 'shpat_pending_token_123';

        const pendingId = await createPendingInstall('shopify', {
            storeDomain: 'claim-me.myshopify.com',
            accessToken: plain,
            nonce: 'nonce-1',
        });

        const store = await claimPendingInstall(pendingId, user.id, 'shopify');
        if (!store) throw new Error('claim returned null');

        expect(store.storeDomain).toBe('claim-me.myshopify.com');
        expect(store.userId).toBe(user.id);
        expect(store.workspaceId).toBe(workspace.id);
        expect(store.isActive).toBe(true);

        // Token was decrypted from the pending row and re-encrypted on the store row.
        const row = await getStoreRow(store.id);
        expect(row.accessToken).not.toContain(plain);
        expect(decrypt(row.accessToken, row.accessTokenIv)).toBe(plain);

        const [pending] = await testDb.select().from(schema.pendingEcommerceInstalls)
            .where(eq(schema.pendingEcommerceInstalls.id, pendingId));
        expect(pending.status).toBe('claimed');
        expect(pending.claimedByUserId).toBe(user.id);
    });

    it('carries refresh token and expiry through the claim (Salla-style installs stay refreshable)', async () => {
        const user = await createTestUser({ facebookId: uniq('fb') });
        await createTestWorkspace(user.id);
        const expiresAt = new Date(Date.now() + 14 * 24 * 3600 * 1000);

        const pendingId = await createPendingInstall('salla', {
            storeDomain: 'refresh-carry.salla.sa',
            accessToken: 'salla-access-1',
            refreshToken: 'salla-refresh-1',
            tokenExpiresAt: expiresAt,
            nonce: 'nonce-2',
        });

        const store = await claimPendingInstall(pendingId, user.id, 'salla');
        if (!store) throw new Error('claim returned null');

        const row = await getStoreRow(store.id);
        expect(decryptOptional(row.refreshToken, row.refreshTokenIv)).toBe('salla-refresh-1');
        if (!row.tokenExpiresAt) throw new Error('tokenExpiresAt not persisted');
        expect(Math.abs(row.tokenExpiresAt.getTime() - expiresAt.getTime())).toBeLessThan(1000);
    });

    it('double-claim: second claim returns null and creates no second store', async () => {
        const user = await createTestUser({ facebookId: uniq('fb') });
        await createTestWorkspace(user.id);
        const pendingId = await createPendingInstall('shopify', {
            storeDomain: 'double-claim.myshopify.com', accessToken: 'tok', nonce: 'n',
        });

        const first = await claimPendingInstall(pendingId, user.id, 'shopify');
        expect(first).not.toBeNull();

        const second = await claimPendingInstall(pendingId, user.id, 'shopify');
        expect(second).toBeNull();

        const rows = await testDb.select().from(schema.ecommerceStores)
            .where(eq(schema.ecommerceStores.storeDomain, 'double-claim.myshopify.com'));
        expect(rows).toHaveLength(1);
    });

    it('returns null for an expired pending install and creates no store', async () => {
        const user = await createTestUser({ facebookId: uniq('fb') });
        const { ciphertext, iv } = encrypt('expired-token');
        const [pending] = await testDb.insert(schema.pendingEcommerceInstalls).values({
            platform: 'shopify',
            storeDomain: 'expired.myshopify.com',
            accessToken: ciphertext,
            accessTokenIv: iv,
            nonce: 'n-expired',
            status: 'pending',
            expiresAt: new Date(Date.now() - 60_000),
        }).returning();

        const store = await claimPendingInstall(pending.id, user.id, 'shopify');
        expect(store).toBeNull();

        const rows = await testDb.select().from(schema.ecommerceStores)
            .where(eq(schema.ecommerceStores.storeDomain, 'expired.myshopify.com'));
        expect(rows).toHaveLength(0);
    });

    it('returns null when the claim platform does not match the pending platform', async () => {
        const user = await createTestUser({ facebookId: uniq('fb') });
        const pendingId = await createPendingInstall('salla', {
            storeDomain: 'mismatch.salla.sa', accessToken: 'tok', nonce: 'n',
        });

        const store = await claimPendingInstall(pendingId, user.id, 'shopify');
        expect(store).toBeNull();
    });

    it('rejects the claim when the store is actively connected to another account', async () => {
        const owner = await createTestUser({ facebookId: uniq('fb-owner'), email: `${uniq('owner')}@test.com` });
        const claimer = await createTestUser({ facebookId: uniq('fb-claimer'), email: `${uniq('claimer')}@test.com` });
        const domain = 'contested.myshopify.com';

        await createStore({ userId: owner.id, platform: 'shopify', storeDomain: domain, accessToken: 'owner-token' });
        const pendingId = await createPendingInstall('shopify', { storeDomain: domain, accessToken: 'claimer-token', nonce: 'n' });

        await expect(claimPendingInstall(pendingId, claimer.id, 'shopify'))
            .rejects.toThrow(/already connected to another account/);

        // Owner's store untouched — token NOT overwritten by the failed claim.
        const [row] = await testDb.select().from(schema.ecommerceStores)
            .where(eq(schema.ecommerceStores.storeDomain, domain));
        expect(row.userId).toBe(owner.id);
        expect(decrypt(row.accessToken, row.accessTokenIv)).toBe('owner-token');
    });

    it('passes the decrypted token to webhook registration and persists status in platformData', async () => {
        const user = await createTestUser({ facebookId: uniq('fb') });
        await createTestWorkspace(user.id);
        const plain = 'shpat_webhook_token';
        const pendingId = await createPendingInstall('shopify', {
            storeDomain: 'webhooks.myshopify.com', accessToken: plain, nonce: 'n',
        });

        const registerCalls: Array<{ storeDomain: string; accessToken: string }> = [];
        const registerFn = async (storeDomain: string, accessToken: string): Promise<WebhookRegistrationResult> => {
            registerCalls.push({ storeDomain, accessToken });
            return { registered: ['products/create', 'products/update'], failed: [], lastAttempt: new Date().toISOString() };
        };

        const store = await claimPendingInstall(pendingId, user.id, 'shopify', registerFn, saveWebhookStatus);
        if (!store) throw new Error('claim returned null');

        expect(registerCalls).toEqual([{ storeDomain: 'webhooks.myshopify.com', accessToken: plain }]);

        const row = await getStoreRow(store.id);
        const platformData = row.platformData as { webhookStatus?: WebhookRegistrationResult } | null;
        expect(platformData?.webhookStatus?.registered).toEqual(['products/create', 'products/update']);
        expect(platformData?.webhookStatus?.failed).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// syncProducts — full catalog sync (Shopify HTTP mocked, DB real)
// ---------------------------------------------------------------------------

describe('syncProducts — full catalog sync', () => {
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();

    beforeEach(() => {
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('inserts mapped product rows and refreshes store metadata on first sync', async () => {
        const { store } = await createConnectedStore({ accessToken: 'shpat_sync_token' });

        fetchMock.mockResolvedValueOnce(gqlProductsResponse([
            gqlProductNode({
                id: '111', title: 'Plain Tee', handle: 'plain-tee', description: 'Soft cotton tee',
                vendor: 'Acme', productType: 'Apparel', tags: ['summer', 'sale'],
                totalInventory: 12, minPrice: '100.00', imageUrl: 'https://cdn.example.com/tee.png',
            }),
            gqlProductNode({
                id: '222', title: 'Varsity Hoodie', handle: 'varsity-hoodie',
                totalInventory: 7, hasOnlyDefaultVariant: false, minPrice: '100.00', maxPrice: '150.00',
                variants: [
                    { title: 'S', selectedOptions: [{ name: 'Size', value: 'S' }] },
                    { title: 'M', selectedOptions: [{ name: 'Size', value: 'M' }] },
                ],
            }),
        ]));

        const result = await syncProducts(store.id);
        expect(result.synced).toBe(2);

        // The token stored encrypted at rest reached the API boundary decrypted.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe(`https://${store.storeDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
        const headers = init?.headers as Record<string, string>;
        expect(headers['X-Shopify-Access-Token']).toBe('shpat_sync_token');

        const rows = await getProductRows(store.id);
        expect(rows).toHaveLength(2);

        const tee = rows.find(r => r.platformProductId === '111');
        const hoodie = rows.find(r => r.platformProductId === '222');
        if (!tee || !hoodie) throw new Error('expected both product rows');

        expect(tee.title).toBe('Plain Tee');
        expect(tee.handle).toBe('plain-tee');
        expect(tee.description).toBe('Soft cotton tee');
        expect(tee.vendor).toBe('Acme');
        expect(tee.productType).toBe('Apparel');
        expect(tee.status).toBe('active'); // lowercased from ACTIVE
        expect(tee.priceRange).toBe('100 SAR');
        expect(tee.currency).toBe('SAR');
        expect(tee.totalInventory).toBe(12);
        expect(tee.hasVariants).toBe(false);
        expect(tee.variantSummary).toBeNull(); // Default Title variants filtered out
        expect(tee.tags).toBe('summer, sale');
        expect(tee.imageUrl).toBe('https://cdn.example.com/tee.png');

        expect(hoodie.priceRange).toBe('100 - 150 SAR');
        expect(hoodie.hasVariants).toBe(true);
        expect(hoodie.variantSummary).toBe('Size: S, M');

        const storeRow = await getStoreRow(store.id);
        expect(storeRow.productCount).toBe(2);
        expect(storeRow.lastSyncAt).not.toBeNull();
        expect(storeRow.productSummary).toContain('Plain Tee');
        expect(storeRow.productSummary).toContain(`https://${store.storeDomain}/products/plain-tee`);
    });

    it('re-running sync with the same payload neither duplicates rows nor rotates internal ids', async () => {
        const { store } = await createConnectedStore();
        const payload = () => gqlProductsResponse([
            gqlProductNode({ id: '111', title: 'Plain Tee', minPrice: '100.00' }),
            gqlProductNode({ id: '222', title: 'Varsity Hoodie', minPrice: '150.00' }),
        ]);

        fetchMock.mockResolvedValueOnce(payload());
        await syncProducts(store.id);
        const before = await getProductRows(store.id);

        fetchMock.mockResolvedValueOnce(payload());
        await syncProducts(store.id);
        const after = await getProductRows(store.id);

        expect(after).toHaveLength(2);
        // Bug B-3.1 regression: upsert must keep internal ids stable, not delete+reinsert.
        expect(after.map(r => r.id).sort()).toEqual(before.map(r => r.id).sort());
        expect((await getStoreRow(store.id)).productCount).toBe(2);
    });

    it('updates changed products in place, deletes removed ones, and clears all on empty catalog', async () => {
        const { store } = await createConnectedStore();

        fetchMock.mockResolvedValueOnce(gqlProductsResponse([
            gqlProductNode({ id: '111', title: 'Plain Tee', minPrice: '100.00' }),
            gqlProductNode({ id: '222', title: 'Varsity Hoodie', minPrice: '150.00' }),
        ]));
        await syncProducts(store.id);
        const teeBefore = (await getProductRows(store.id)).find(r => r.platformProductId === '111');
        if (!teeBefore) throw new Error('seed sync failed');

        // Price change on 111; 222 dropped from the platform catalog.
        fetchMock.mockResolvedValueOnce(gqlProductsResponse([
            gqlProductNode({ id: '111', title: 'Plain Tee', minPrice: '120.00' }),
        ]));
        await syncProducts(store.id);

        const rows = await getProductRows(store.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].platformProductId).toBe('111');
        expect(rows[0].priceRange).toBe('120 SAR');
        expect(rows[0].id).toBe(teeBefore.id); // updated in place
        expect((await getStoreRow(store.id)).productCount).toBe(1);

        // Empty catalog drops everything for the store.
        fetchMock.mockResolvedValueOnce(gqlProductsResponse([]));
        await syncProducts(store.id);
        expect(await getProductRows(store.id)).toHaveLength(0);
        expect((await getStoreRow(store.id)).productCount).toBe(0);
    });

    it('aggregates paginated product responses into one catalog', async () => {
        const { store } = await createConnectedStore();

        fetchMock
            .mockResolvedValueOnce(gqlProductsResponse(
                [gqlProductNode({ id: '1', title: 'Page1 A' }), gqlProductNode({ id: '2', title: 'Page1 B' })],
                { hasNextPage: true, endCursor: 'cursor-page-1' },
            ))
            .mockResolvedValueOnce(gqlProductsResponse(
                [gqlProductNode({ id: '3', title: 'Page2 A' })],
                { hasNextPage: false, endCursor: null },
            ));

        const result = await syncProducts(store.id);
        expect(result.synced).toBe(3);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(await getProductRows(store.id)).toHaveLength(3);
        expect((await getStoreRow(store.id)).productCount).toBe(3);
    });
});

// ---------------------------------------------------------------------------
// Webhook product path — mapShopifyWebhookProduct + upsert/delete
// ---------------------------------------------------------------------------

type ShopifyWebhookPayload = Parameters<typeof mapShopifyWebhookProduct>[0];

/** Mirrors webhookProductsUpdate in controllers/shopify.ts: map (with store currency) → upsert. */
async function applyProductWebhook(
    store: { id: string; storeCurrency: string | null },
    payload: ShopifyWebhookPayload,
): Promise<void> {
    const normalized = mapShopifyWebhookProduct(payload, store.storeCurrency || '');
    await upsertSingleProduct(store.id, normalized);
}

function hoodiePayload(overrides: Partial<ShopifyWebhookPayload> = {}): ShopifyWebhookPayload {
    return {
        id: 222333,
        title: 'Hoodie',
        body_html: '<p>Warm <b>hoodie</b></p>',
        vendor: 'Acme',
        product_type: 'Apparel',
        handle: 'hoodie',
        status: 'active',
        tags: 'winter, sale',
        image: { src: 'https://cdn.example.com/hoodie.png' },
        variants: [
            { title: 'S', price: '120.00', inventory_quantity: 3, option1: 'S' },
            { title: 'M', price: '140.00', inventory_quantity: 4, option1: 'M' },
        ],
        options: [{ name: 'Size', values: ['S', 'M'] }],
        ...overrides,
    };
}

describe('webhook product path — upsert and delete', () => {
    it('products/create payload upserts a row with REST field mapping and store currency stamp', async () => {
        const { store } = await createConnectedStore();

        await applyProductWebhook(store, hoodiePayload());

        const rows = await getProductRows(store.id);
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row.platformProductId).toBe('222333');
        expect(row.title).toBe('Hoodie');
        expect(row.description).toBe('Warm hoodie'); // body_html stripped
        expect(row.handle).toBe('hoodie');
        expect(row.status).toBe('active');
        expect(row.priceRange).toBe('120 - 140 SAR'); // min/max across variants, currency from store
        expect(row.currency).toBe('SAR'); // REST payload has no currency — passed in from store
        expect(row.totalInventory).toBe(7); // summed across variants
        expect(row.hasVariants).toBe(true);
        expect(row.variantSummary).toBe('Size: S, M');
        expect(row.tags).toBe('winter, sale');
        expect(row.imageUrl).toBe('https://cdn.example.com/hoodie.png');

        expect((await getStoreRow(store.id)).productCount).toBe(1);
    });

    it('products/update payload updates the existing row in place (same internal id, no duplicate)', async () => {
        const { store } = await createConnectedStore();
        await applyProductWebhook(store, hoodiePayload());
        const [before] = await getProductRows(store.id);

        await applyProductWebhook(store, hoodiePayload({
            title: 'Hoodie V2',
            variants: [{ title: 'S', price: '150.00', inventory_quantity: 9, option1: 'S' }],
        }));

        const rows = await getProductRows(store.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe(before.id);
        expect(rows[0].title).toBe('Hoodie V2');
        expect(rows[0].priceRange).toBe('150 SAR');
        expect(rows[0].totalInventory).toBe(9);
        expect(rows[0].hasVariants).toBe(false); // single variant after update
    });

    it('products/delete removes only the targeted product and refreshes the count', async () => {
        const { store } = await createConnectedStore();
        await applyProductWebhook(store, hoodiePayload());
        await applyProductWebhook(store, hoodiePayload({ id: 444555, title: 'Cap', handle: 'cap' }));
        expect((await getStoreRow(store.id)).productCount).toBe(2);

        await deleteSingleProduct(store.id, '222333');

        const rows = await getProductRows(store.id);
        expect(rows).toHaveLength(1);
        expect(rows[0].platformProductId).toBe('444555');
        expect(rows[0].title).toBe('Cap');
        expect((await getStoreRow(store.id)).productCount).toBe(1);
    });
});

// ---------------------------------------------------------------------------
// Product safety cap — truncation + batched insert (>4369 rows would exceed the
// Postgres 65535-param limit if inserted in one statement, so this also guards
// that the chunked insert works at scale).
// ---------------------------------------------------------------------------

describe('replaceProductsAndRebuildSummary — safety cap', () => {
    it('caps at PRODUCT_SAFETY_CAP, reports capped, and persists exactly the cap', async () => {
        const { store } = await createConnectedStore();
        const overflow = PRODUCT_SAFETY_CAP + 5;
        const products = Array.from({ length: overflow }, (_, i) => ({
            platformProductId: `p-${i}`,
            title: `Product ${i}`,
            status: 'active',
            priceRange: '10',
            currency: 'SAR',
            totalInventory: 1,
            hasVariants: false,
        }));

        const result = await replaceProductsAndRebuildSummary(store.id, products);

        expect(result.capped).toBe(true);
        expect(result.synced).toBe(PRODUCT_SAFETY_CAP);
        expect(await getProductRows(store.id)).toHaveLength(PRODUCT_SAFETY_CAP);
        expect((await getStoreRow(store.id)).productCount).toBe(PRODUCT_SAFETY_CAP);
    });

    it('does not flag capped for a normal-sized catalog', async () => {
        const { store } = await createConnectedStore();
        const products = Array.from({ length: 3 }, (_, i) => ({
            platformProductId: `s-${i}`, title: `Small ${i}`, status: 'active',
            priceRange: '10', currency: 'SAR', totalInventory: 1, hasVariants: false,
        }));

        const result = await replaceProductsAndRebuildSummary(store.id, products);

        expect(result).toEqual({ synced: 3, capped: false });
    });
});
