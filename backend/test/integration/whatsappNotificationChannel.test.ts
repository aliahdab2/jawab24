/**
 * Integration: the notification channel round-trip against a real Postgres.
 *
 * Unit mocks cannot prove these two things, and both are load-bearing:
 *  1. `schedule()` actually PERSISTS the rendered variables — the WhatsApp send
 *     rebuilds `{{1}}`, `{{2}}` from them, and `messageSent` has already
 *     flattened them into one string, so losing them silently breaks every
 *     template send while SMS keeps working.
 *  2. The sender query only ever finds a WhatsApp page LINKED to that store —
 *     a workspace-mate's number must never be picked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import * as schema from '../../src/db/schema';

vi.mock('../../src/lib/customerNotificationQueue', () => ({
    CUSTOMER_NOTIFICATION_QUEUE: 'customer-notifications',
    customerNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { createStore } from '../../src/services/ecommerce';
import { customerNotificationService } from '../../src/services/customerNotifications';
import { resolveWhatsAppSender } from '../../src/services/whatsappNotificationSender';

function uniq(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createStoreWithWorkspace() {
    const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('merchant')}@test.com` });
    const workspace = await createTestWorkspace(user.id);
    const store = await createStore({
        userId: user.id,
        platform: 'zid',
        storeDomain: `${uniq('store')}.zid.store`,
        accessToken: 'tok_default',
        shopInfo: { shopName: 'WA Channel Store', shopCurrency: 'SAR' },
        workspaceId: workspace.id,
    });
    return { user, workspace, store };
}

/** A page row carrying WhatsApp credentials, optionally linked to a store. */
async function createWhatsAppPage(opts: {
    userId: string; workspaceId: string; storeId?: string; phoneNumberId: string;
}) {
    const [page] = await testDb.insert(schema.pages).values({
        userId: opts.userId,
        workspaceId: opts.workspaceId,
        facebookPageId: null,
        name: 'WA Number',
        accessToken: '',
        whatsappPhoneNumberId: opts.phoneNumberId,
        whatsappBusinessAccountId: 'waba-1',
        whatsappAccessToken: 'plain-token',   // unencrypted: safeDecryptToken passes it through
        ecommerceStoreId: opts.storeId ?? null,
    }).returning();
    return page;
}

describe('WhatsApp notification channel (real Postgres)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('persists the rendered variables on the log row so a template send can rebuild its params', async () => {
        const { store } = await createStoreWithWorkspace();
        await customerNotificationService.seedDefaults(store.id);
        await testDb.update(schema.customerNotificationTemplates)
            .set({ isEnabled: true, channel: 'whatsapp' })
            .where(and(
                eq(schema.customerNotificationTemplates.ecommerceStoreId, store.id),
                eq(schema.customerNotificationTemplates.notificationType, 'order_confirmed'),
            ));

        await customerNotificationService.schedule({
            storeId: store.id,
            type: 'order_confirmed',
            customerPhone: '+966501806978',
            customerName: 'Ahmed',
            variables: { order_number: '72524870', tracking_number: '', cart_total: '' },
            platformEventId: 'zid:order_confirmed:72524870',
            orderNumber: '72524870',
        });

        const [row] = await testDb.select().from(schema.customerNotificationsLog)
            .where(eq(schema.customerNotificationsLog.ecommerceStoreId, store.id));

        expect(row.channel).toBe('whatsapp');
        expect(row.variables).toMatchObject({ customer_name: 'Ahmed', order_number: '72524870' });
        // The flattened text is still there for the log UI — both, not either.
        expect(row.messageSent).toContain('72524870');
    });

    // The tracking-number upgrade: Salla's `order.status.updated` schedules a
    // shipped row before a courier is assigned, then `order.shipment.created`
    // arrives within the grace window carrying the real number and upgrades the
    // still-pending row in place (`upgradePendingOnDuplicate`).
    //
    // `messageSent` and `variables` are two renderings of the SAME values, read by
    // different rails — SMS sends the flattened text, WhatsApp rebuilds {{1}},{{2}},…
    // from the variables. Upgrading only the text left the WhatsApp send filling
    // {{3}} from the stale variables, telling the customer «سيصلك من مندوب التوصيل»
    // on the very event that carried the tracking number.
    it('upgrades the stored variables, not just the text, when a richer duplicate arrives', async () => {
        const { store } = await createStoreWithWorkspace();
        await customerNotificationService.seedDefaults(store.id);
        await testDb.update(schema.customerNotificationTemplates)
            .set({ isEnabled: true, channel: 'whatsapp' })
            .where(and(
                eq(schema.customerNotificationTemplates.ecommerceStoreId, store.id),
                eq(schema.customerNotificationTemplates.notificationType, 'order_shipped'),
            ));

        const base = {
            storeId: store.id,
            type: 'order_shipped' as const,
            customerPhone: '+966501806978',
            customerName: 'Ahmed',
            platformEventId: 'salla:order_shipped:9001',
            orderNumber: '9001',
        };

        // 1. status update: shipped, no courier assigned yet.
        await customerNotificationService.schedule({
            ...base,
            variables: { order_number: '9001', tracking_number: '', cart_total: '' },
        });

        // 2. shipment created: the same dedup key, now carrying the tracking number.
        await customerNotificationService.schedule({
            ...base,
            variables: { order_number: '9001', tracking_number: 'SA1234567890', cart_total: '' },
            upgradePendingOnDuplicate: true,
        });

        const rows = await testDb.select().from(schema.customerNotificationsLog)
            .where(eq(schema.customerNotificationsLog.ecommerceStoreId, store.id));

        expect(rows).toHaveLength(1);                                  // deduped, not doubled
        expect(rows[0].messageSent).toContain('SA1234567890');         // SMS rail sees it
        expect(rows[0].variables).toMatchObject({ tracking_number: 'SA1234567890' }); // WhatsApp rail too
    });

    it('finds the WhatsApp number linked to the store', async () => {
        const { user, workspace, store } = await createStoreWithWorkspace();
        await createWhatsAppPage({ userId: user.id, workspaceId: workspace.id, storeId: store.id, phoneNumberId: uniq('pn') });

        const sender = await resolveWhatsAppSender(store.id);

        expect(sender).not.toBeNull();
        expect(sender?.wabaId).toBe('waba-1');
        expect(sender?.accessToken).toBe('plain-token');
    });

    // The rule that protects the merchant's customers: an unlinked number in the
    // same workspace is NOT a valid sender for this store.
    it('does NOT fall back to an unlinked WhatsApp number in the same workspace', async () => {
        const { user, workspace, store } = await createStoreWithWorkspace();
        await createWhatsAppPage({ userId: user.id, workspaceId: workspace.id, phoneNumberId: uniq('pn') }); // no storeId

        await expect(resolveWhatsAppSender(store.id)).resolves.toBeNull();
    });
});
