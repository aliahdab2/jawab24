/**
 * Store disconnect → reconnect lifecycle (real DB).
 *
 * Pins the repair contract added after the 2026-08-23 production incident:
 * a merchant disconnect severs four things (tokens, activation, page links,
 * webhooks) but the reconnect paths used to restore only the tokens — a
 * "Reauthorize App" returned 200 and silently fixed nothing (the store lookup
 * filtered isActive=true), and even a full reinstall left the pages unlinked,
 * so every reply on them degraded to store-less answers.
 *
 * Contract under test:
 *  - disconnectStore records the severed page links (platformData.relinkPageIds)
 *  - reconnectStore restores tokens + activation + page links + webhook status
 *  - restorePageLinks never steals a page that was meanwhile linked elsewhere,
 *    never crosses workspaces, and clears its record after one use
 *  - createStore's reinstall upsert (the Shopify/Zid/claim path) also restores links
 *  - getStoreByMerchantId only sees inactive stores when explicitly asked
 */
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import {
    testDb,
    createTestUser,
    createTestWorkspace,
    createTestPage,
    createTestEcommerceStore,
} from './setup';
import * as schema from '../../src/db/schema';
import {
    disconnectStore,
    reconnectStore,
    restorePageLinks,
    createStore,
    getStoreByMerchantId,
    type WebhookRegistrationResult,
} from '../../src/services/ecommerce';
import { decrypt } from '../../src/services/ecommerceCrypto';

const okRegistration = (): Promise<WebhookRegistrationResult> => Promise.resolve({
    registered: ['order.created'],
    failed: [],
    lastAttempt: new Date().toISOString(),
});

async function storeRow(storeId: string) {
    const [row] = await testDb.select().from(schema.ecommerceStores)
        .where(eq(schema.ecommerceStores.id, storeId)).limit(1);
    return row;
}

async function pageRow(pageId: string) {
    const [row] = await testDb.select().from(schema.pages)
        .where(eq(schema.pages.id, pageId)).limit(1);
    return row;
}

/** user + workspace + store + one page linked to the store */
async function connectedFixture() {
    const user = await createTestUser();
    const workspace = await createTestWorkspace(user.id);
    const store = await createTestEcommerceStore(user.id, {
        workspaceId: workspace.id,
        platformData: { merchantId: '424242' },
    });
    const page = await createTestPage(user.id, {
        workspaceId: workspace.id,
        ecommerceStoreId: store.id,
    });
    return { user, workspace, store, page };
}

describe('store disconnect → reconnect lifecycle', () => {
    it('disconnectStore unlinks pages, blanks tokens, and RECORDS the severed links', async () => {
        const { store, page } = await connectedFixture();

        await disconnectStore(store.id);

        const s = await storeRow(store.id);
        expect(s.isActive).toBe(false);
        expect(s.uninstalledAt).not.toBeNull();
        expect(s.accessToken).toBe('');
        expect(s.accessTokenIv).toBe('');
        expect((await pageRow(page.id)).ecommerceStoreId).toBeNull();
        // The record a reconnect needs — without it the links are unrecoverable.
        expect((s.platformData as Record<string, unknown>).relinkPageIds).toEqual([page.id]);
    });

    it('reconnectStore restores tokens, activation, page links, and webhook status', async () => {
        const { store, page } = await connectedFixture();
        await disconnectStore(store.id);

        let registerCalls = 0;
        const { relinkedPageIds } = await reconnectStore(
            store.id, 'salla',
            { accessToken: 'fresh-token', refreshToken: 'fresh-refresh', tokenExpiresAt: new Date(Date.now() + 14 * 86400_000) },
            () => { registerCalls++; return okRegistration(); },
        );

        expect(relinkedPageIds).toEqual([page.id]);
        expect(registerCalls).toBe(1);

        const s = await storeRow(store.id);
        expect(s.isActive).toBe(true);
        expect(s.uninstalledAt).toBeNull();
        // Tokens must be REAL ciphertext that decrypts to what the platform delivered —
        // not the blanked sentinel, not plaintext.
        expect(decrypt(s.accessToken, s.accessTokenIv)).toBe('fresh-token');
        const pd = s.platformData as Record<string, unknown>;
        expect(pd.relinkPageIds).toBeUndefined();
        expect((pd.webhookStatus as WebhookRegistrationResult).registered).toEqual(['order.created']);
        expect((await pageRow(page.id)).ecommerceStoreId).toBe(store.id);
    });

    it('getStoreByMerchantId hides inactive stores by default and finds them with includeInactive', async () => {
        const { store } = await connectedFixture();
        await disconnectStore(store.id);

        expect(await getStoreByMerchantId('salla', '424242')).toBeNull();
        const found = await getStoreByMerchantId('salla', '424242', { includeInactive: true });
        expect(found?.id).toBe(store.id);
    });

    it('restorePageLinks never steals a page that was meanwhile linked to another store', async () => {
        const { user, workspace, store, page } = await connectedFixture();
        await disconnectStore(store.id);

        const otherStore = await createTestEcommerceStore(user.id, { workspaceId: workspace.id });
        await testDb.update(schema.pages)
            .set({ ecommerceStoreId: otherStore.id })
            .where(eq(schema.pages.id, page.id));

        const relinked = await restorePageLinks(await storeRow(store.id));

        expect(relinked).toEqual([]);
        expect((await pageRow(page.id)).ecommerceStoreId).toBe(otherStore.id);
        // Record cleared even when nothing was eligible — it must not replay later.
        expect((await storeRow(store.id)).platformData).not.toHaveProperty('relinkPageIds');
    });

    it('restorePageLinks never crosses workspaces', async () => {
        const { user, store, page } = await connectedFixture();
        await disconnectStore(store.id);

        const otherWorkspace = await createTestWorkspace(user.id, { name: 'Other Workspace' });
        await testDb.update(schema.pages)
            .set({ workspaceId: otherWorkspace.id })
            .where(eq(schema.pages.id, page.id));

        const relinked = await restorePageLinks(await storeRow(store.id));

        expect(relinked).toEqual([]);
        expect((await pageRow(page.id)).ecommerceStoreId).toBeNull();
    });

    it.each(['zid', 'shopify'] as const)(
        '%s reconnects through createStore and gets the same page-link repair',
        async (platform) => {
            // The repair is deliberately platform-agnostic: disconnectStore (the
            // SHARED handler in ecommerceControllers) records the links, and
            // createStore — which is how Zid and Shopify reconnect (OAuth callback
            // → upsert) — restores them. Only Salla needs the extra reconnectStore
            // branch, because only Salla re-delivers credentials out-of-band via
            // app.store.authorize. Pinning that here so a future change to
            // createStore can't silently drop non-Salla platforms.
            const user = await createTestUser();
            const workspace = await createTestWorkspace(user.id);
            const store = await createTestEcommerceStore(user.id, { workspaceId: workspace.id, platform });
            const page = await createTestPage(user.id, {
                workspaceId: workspace.id,
                ecommerceStoreId: store.id,
            });

            await disconnectStore(store.id);
            expect((await pageRow(page.id)).ecommerceStoreId).toBeNull();

            const reconnected = await createStore({
                userId: user.id,
                workspaceId: workspace.id,
                platform,
                storeDomain: store.storeDomain,
                accessToken: 'reconnect-token',
            });

            expect(reconnected.id).toBe(store.id);
            expect(reconnected.isActive).toBe(true);
            expect((await pageRow(page.id)).ecommerceStoreId).toBe(store.id);
        },
    );

    it('createStore reinstall (upsert on the same domain) also restores page links', async () => {
        const { user, workspace, store, page } = await connectedFixture();
        await disconnectStore(store.id);

        const reinstalled = await createStore({
            userId: user.id,
            workspaceId: workspace.id,
            platform: 'salla',
            storeDomain: store.storeDomain,
            accessToken: 'reinstall-token',
        });

        expect(reinstalled.id).toBe(store.id);
        expect(reinstalled.isActive).toBe(true);
        expect((await pageRow(page.id)).ecommerceStoreId).toBe(store.id);
        expect((await storeRow(store.id)).platformData).not.toHaveProperty('relinkPageIds');
    });
});
