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

import { customerNotificationService } from '../../src/services/customerNotifications';
import {
    createStoreWithNotificationTemplates,
    notificationLogRows as logRows,
} from '../helpers/ecommerceFixtures';

/** Kept as a local shim so the assertions below read unchanged. */
async function createStoreWithTemplates() {
    return { store: await createStoreWithNotificationTemplates('salla') };
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
