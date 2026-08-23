import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import * as schema from '../../src/db/schema';
import { createStore } from '../../src/services/ecommerce';

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function templatesFor(storeId: string) {
    return testDb.select({
        type: schema.customerNotificationTemplates.notificationType,
        messageEn: schema.customerNotificationTemplates.messageEn,
        isEnabled: schema.customerNotificationTemplates.isEnabled,
    })
        .from(schema.customerNotificationTemplates)
        .where(eq(schema.customerNotificationTemplates.ecommerceStoreId, storeId))
        .orderBy(schema.customerNotificationTemplates.notificationType);
}

/**
 * Regression for 2026-08-23: only the pending-install CLAIM path seeded the
 * customer-notification templates. A store created through the logged-in OAuth
 * callback, the auto-provisioned embedded install, or Shopify's callback — i.e.
 * every path that calls createStore directly — had zero template rows, so
 * `customerNotificationService.schedule()` returned before writing anything
 * and no order SMS could ever fire. Found on the live Zid dev store.
 *
 * Every platform funnels through createStore, so that is where the seed lives.
 */
describe('createStore seeds the customer-notification templates', () => {
    async function owner() {
        const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('u')}@test.com` });
        const workspace = await createTestWorkspace(user.id);
        return { user, workspace };
    }

    it.each(['zid', 'salla', 'shopify'] as const)('a fresh %s store gets the full default set', async (platform) => {
        const { user, workspace } = await owner();

        const store = await createStore({
            userId: user.id,
            platform,
            storeDomain: `${uniq('s')}.example`,
            accessToken: 'tok',
            workspaceId: workspace.id,
        });

        const rows = await templatesFor(store.id);
        expect(rows.map(r => r.type)).toEqual([
            'abandoned_cart', 'digital_delivery', 'order_confirmed',
            'order_delivered', 'order_shipped', 'review_request',
        ]);
    });

    it('a reinstall keeps the merchant\'s edited template instead of resetting it', async () => {
        const { user, workspace } = await owner();
        const storeDomain = `${uniq('s')}.zid.store`;
        const base = { userId: user.id, platform: 'zid' as const, storeDomain, accessToken: 'tok', workspaceId: workspace.id };

        const store = await createStore(base);
        await testDb.update(schema.customerNotificationTemplates)
            .set({ messageEn: 'merchant wording', isEnabled: true })
            .where(and(
                eq(schema.customerNotificationTemplates.ecommerceStoreId, store.id),
                eq(schema.customerNotificationTemplates.notificationType, 'order_confirmed'),
            ));

        // Same platform + domain → the ON CONFLICT branch (uninstall → reinstall).
        const again = await createStore({ ...base, accessToken: 'tok2' });
        expect(again.id).toBe(store.id);

        const rows = await templatesFor(store.id);
        expect(rows).toHaveLength(6); // no duplicates
        const confirmed = rows.find(r => r.type === 'order_confirmed');
        expect(confirmed?.messageEn).toBe('merchant wording');
        expect(confirmed?.isEnabled).toBe(true);
    });
});
