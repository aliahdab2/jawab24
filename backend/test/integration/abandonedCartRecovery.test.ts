/**
 * Integration tests for abandoned-cart recovery attribution (real Postgres).
 *
 * Pins the cancelled-row exclusion in queryRecoveryStats: a `cancelled` row means
 * the customer completed checkout BEFORE the nudge was sent (abandoned_cart.completed
 * / the order_confirmed cancel hook), so it must count neither as "notified" nor as
 * "recovered" revenue. A raw-SQL predicate (`IS DISTINCT FROM`) cannot be pinned by
 * unit mocks — this runs the real query.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import * as schema from '../../src/db/schema';

vi.mock('../../src/lib/customerNotificationQueue', () => ({
    CUSTOMER_NOTIFICATION_QUEUE: 'customer-notifications',
    customerNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { createStore } from '../../src/services/ecommerce';
import { getStoreAnalytics } from '../../src/services/ecommerceAnalytics';

function uniq(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestStore() {
    const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('merchant')}@test.com` });
    const workspace = await createTestWorkspace(user.id);
    return createStore({
        userId: user.id,
        platform: 'zid',
        storeDomain: `${uniq('store')}.zid.store`,
        accessToken: 'tok_default',
        shopInfo: { shopName: 'Recovery Store', shopCurrency: 'SAR' },
        workspaceId: workspace.id,
    });
}

async function insertLogRow(storeId: string, row: {
    type: string; phone: string; status: string; cartTotal?: string; eventId: string;
}) {
    await testDb.insert(schema.customerNotificationsLog).values({
        ecommerceStoreId: storeId,
        notificationType: row.type,
        customerPhone: row.phone,
        channel: 'sms',
        messageSent: 'test message',
        status: row.status,
        cartTotal: row.cartTotal,
        platformEventId: row.eventId,
        sentAt: row.status === 'sent' ? new Date() : null,
    });
}

describe('abandoned-cart recovery attribution (real Postgres)', () => {
    it('a cancelled nudge counts neither as notified nor as recovered revenue', async () => {
        const store = await createTestStore();

        // Customer 1: nudge SENT, then ordered within the window → genuine recovery.
        await insertLogRow(store.id, {
            type: 'abandoned_cart', phone: '+966500000001', status: 'sent',
            cartTotal: '100 SAR', eventId: 'zid:abandoned_cart:1',
        });
        await insertLogRow(store.id, {
            type: 'order_confirmed', phone: '+966500000001', status: 'sent',
            eventId: 'zid:order_confirmed:11',
        });

        // Customer 2: completed checkout BEFORE the nudge fired → row cancelled.
        // Crediting its 200 SAR would inflate revenueRecovered with a send that
        // never happened (the order_confirmed row exists here too, as it would live).
        await insertLogRow(store.id, {
            type: 'abandoned_cart', phone: '+966500000002', status: 'cancelled',
            cartTotal: '200 SAR', eventId: 'zid:abandoned_cart:2',
        });
        await insertLogRow(store.id, {
            type: 'order_confirmed', phone: '+966500000002', status: 'sent',
            eventId: 'zid:order_confirmed:22',
        });

        const overview = await getStoreAnalytics(store.id, '30d');

        expect(overview.recovery.abandonedCartsNotified).toBe(1);
        expect(overview.recovery.cartsRecovered).toBe(1);
        expect(overview.recovery.revenueRecovered).toBe(100);
        expect(overview.recovery.currency).toBe('SAR');
    });

    it('pending and sent nudges still count as before (no over-exclusion)', async () => {
        const store = await createTestStore();

        // A pending nudge with no matching order — notified, not recovered.
        await insertLogRow(store.id, {
            type: 'abandoned_cart', phone: '+966500000003', status: 'pending',
            cartTotal: '50 SAR', eventId: 'zid:abandoned_cart:3',
        });

        const overview = await getStoreAnalytics(store.id, '30d');

        expect(overview.recovery.abandonedCartsNotified).toBe(1);
        expect(overview.recovery.cartsRecovered).toBe(0);
        expect(overview.recovery.revenueRecovered).toBe(0);
    });
});
