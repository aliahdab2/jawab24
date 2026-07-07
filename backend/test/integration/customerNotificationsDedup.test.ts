/**
 * Integration tests for customer-notification deduplication (real Postgres).
 *
 * House pattern (see ecommerce-sync.test.ts): mock ONLY the BullMQ queue (Redis,
 * an external boundary) and keep every DB operation real. These cover behaviour
 * that unit mocks cannot — the atomicity of the unique index under a genuine
 * concurrent race, and the migration actually producing a UNIQUE index.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import * as schema from '../../src/db/schema';

vi.mock('../../src/lib/customerNotificationQueue', () => ({
    CUSTOMER_NOTIFICATION_QUEUE: 'customer-notifications',
    customerNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { createStore } from '../../src/services/ecommerce';
import { customerNotificationService } from '../../src/services/customerNotifications';

function uniq(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** A connected store with default notification templates seeded. */
async function createStoreWithTemplates() {
    const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('merchant')}@test.com` });
    const workspace = await createTestWorkspace(user.id);
    const store = await createStore({
        userId: user.id,
        platform: 'salla',
        storeDomain: `${uniq('store')}.example.com`,
        accessToken: 'tok_default',
        shopInfo: { shopName: 'Dedup Store', shopCurrency: 'SAR' },
        workspaceId: workspace.id,
    });
    await customerNotificationService.seedDefaults(store.id);
    // Seeded templates default to isEnabled=false (merchant opts in). Enable them so
    // schedule() actually runs — this test is about dedup, not the opt-in gate.
    await testDb.update(schema.customerNotificationTemplates)
        .set({ isEnabled: true })
        .where(eq(schema.customerNotificationTemplates.ecommerceStoreId, store.id));
    return { store };
}

async function logRows(storeId: string, type: string) {
    return testDb.select().from(schema.customerNotificationsLog)
        .where(and(
            eq(schema.customerNotificationsLog.ecommerceStoreId, storeId),
            eq(schema.customerNotificationsLog.notificationType, type),
        ));
}

describe('customer-notification dedup (real Postgres)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('two concurrent schedule() calls for the same event insert exactly one row', async () => {
        const { store } = await createStoreWithTemplates();
        const params = {
            storeId: store.id,
            type: 'order_confirmed' as const,
            customerPhone: '+966501806978',
            customerName: 'Ahmed',
            variables: { order_number: '42' },
            platformEventId: 'salla:order_confirmed:42',
            orderNumber: '42',
        };

        // The real race: both webhook deliveries hit schedule() at once.
        await Promise.all([
            customerNotificationService.schedule(params),
            customerNotificationService.schedule(params),
        ]);

        const rows = await logRows(store.id, 'order_confirmed');
        expect(rows).toHaveLength(1);
    });

    it('a tracking-bearing shipment upgrades an earlier tracking-less shipped row in place', async () => {
        const { store } = await createStoreWithTemplates();

        // Status path first: order.status.updated (slug shipped) — no tracking, held 5 min.
        await customerNotificationService.schedule({
            storeId: store.id,
            type: 'order_shipped',
            customerPhone: '+966501806978',
            customerName: 'Ahmed',
            variables: { order_number: '42', tracking_number: '' },
            platformEventId: 'salla:order_shipped:42',
            orderNumber: '42',
            minDelayMs: 5 * 60 * 1000,
        });

        // Shipment path second: order.shipment.created carrying the tracking number.
        await customerNotificationService.schedule({
            storeId: store.id,
            type: 'order_shipped',
            customerPhone: '+966501806978',
            customerName: 'Ahmed',
            variables: { order_number: '42', tracking_number: 'TRK-9' },
            platformEventId: 'salla:order_shipped:42',
            orderNumber: '42',
            upgradePendingOnDuplicate: true,
        });

        const rows = await logRows(store.id, 'order_shipped');
        expect(rows).toHaveLength(1);
        expect(rows[0].messageSent).toContain('TRK-9');
        expect(rows[0].status).toBe('pending');
    });

    it('the dedup index is UNIQUE (migration 0130 applied)', async () => {
        const [row] = await testDb.execute(sql`
            SELECT indexdef FROM pg_indexes
            WHERE indexname = 'idx_cust_notif_log_store_type_event'
        `) as unknown as Array<{ indexdef: string }>;
        expect(row?.indexdef).toMatch(/CREATE UNIQUE INDEX/i);
    });
});
