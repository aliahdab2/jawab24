/**
 * Integration tests for autoLinkSolePageToSoleStore (D-119).
 *
 * The embedded Zid wizard's manual «ربط الصفحة» step is retired; a page sync
 * now auto-links the workspace's ONLY page to its ONLY active store. These
 * tests pin the strictness of the rule — any ambiguity (several pages, several
 * stores, an existing link) must leave everything untouched, because a wrong
 * guess here silently feeds one page another store's catalog.
 *
 * House pattern: real Postgres, external boundaries mocked (BullMQ queue).
 */
import { describe, it, expect, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, createTestPage, testDb } from './setup';
import * as schema from '../../src/db/schema';

// services/ecommerce.ts → customerNotifications.ts imports the BullMQ queue at
// module load; no Redis runs alongside the integration test DB.
vi.mock('../../src/lib/customerNotificationQueue', () => ({
    CUSTOMER_NOTIFICATION_QUEUE: 'customer-notifications',
    customerNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { createStore, deactivateStore, autoLinkSolePageToSoleStore } from '../../src/services/ecommerce';
import { uniq } from '../helpers/ecommerceFixtures';

async function fixture() {
    const user = await createTestUser();
    const workspace = await createTestWorkspace(user.id);
    return { user, workspace };
}

async function zidStore(userId: string, workspaceId: string) {
    return createStore({
        userId,
        platform: 'zid',
        storeDomain: `${uniq('zid-store')}.zid.store`,
        accessToken: 'zid-token',
        shopInfo: { shopName: 'Zid Store', shopCurrency: 'SAR' },
        workspaceId,
    });
}

async function pageLink(pageId: string): Promise<string | null> {
    const [row] = await testDb
        .select({ ecommerceStoreId: schema.pages.ecommerceStoreId })
        .from(schema.pages)
        .where(eq(schema.pages.id, pageId));
    return row?.ecommerceStoreId ?? null;
}

describe('autoLinkSolePageToSoleStore (D-119)', () => {
    it('links the sole unlinked page to the sole active store', async () => {
        const { user, workspace } = await fixture();
        const store = await zidStore(user.id, workspace.id);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        const linked = await autoLinkSolePageToSoleStore(workspace.id);

        expect(linked).toBe(page.id);
        expect(await pageLink(page.id)).toBe(store.id);
    });

    it('does nothing when the workspace has more than one page (ambiguous)', async () => {
        const { user, workspace } = await fixture();
        await zidStore(user.id, workspace.id);
        const p1 = await createTestPage(user.id, { workspaceId: workspace.id });
        const p2 = await createTestPage(user.id, { workspaceId: workspace.id });

        expect(await autoLinkSolePageToSoleStore(workspace.id)).toBeNull();
        expect(await pageLink(p1.id)).toBeNull();
        expect(await pageLink(p2.id)).toBeNull();
    });

    it('does nothing when the sole page is already linked', async () => {
        const { user, workspace } = await fixture();
        const storeA = await zidStore(user.id, workspace.id);
        const page = await createTestPage(user.id, {
            workspaceId: workspace.id,
            ecommerceStoreId: storeA.id,
        });

        expect(await autoLinkSolePageToSoleStore(workspace.id)).toBeNull();
        expect(await pageLink(page.id)).toBe(storeA.id);
    });

    it('does nothing when the workspace has more than one active store (ambiguous)', async () => {
        const { user, workspace } = await fixture();
        await zidStore(user.id, workspace.id);
        await createStore({
            userId: user.id,
            platform: 'shopify',
            storeDomain: `${uniq('shop')}.myshopify.com`,
            accessToken: 'shpat_x',
            shopInfo: { shopName: 'Shop', shopCurrency: 'SAR' },
            workspaceId: workspace.id,
        });
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        expect(await autoLinkSolePageToSoleStore(workspace.id)).toBeNull();
        expect(await pageLink(page.id)).toBeNull();
    });

    it('ignores a deactivated store (uninstalled app must not re-claim the page)', async () => {
        const { user, workspace } = await fixture();
        const store = await zidStore(user.id, workspace.id);
        await deactivateStore('zid', store.storeDomain);
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        expect(await autoLinkSolePageToSoleStore(workspace.id)).toBeNull();
        expect(await pageLink(page.id)).toBeNull();
    });

    it('does nothing when the workspace has no store at all', async () => {
        const { user, workspace } = await fixture();
        const page = await createTestPage(user.id, { workspaceId: workspace.id });

        expect(await autoLinkSolePageToSoleStore(workspace.id)).toBeNull();
        expect(await pageLink(page.id)).toBeNull();
    });
});
