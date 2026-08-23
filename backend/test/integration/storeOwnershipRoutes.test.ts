import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fastify, { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import * as schema from '../../src/db/schema';
import type { WorkspaceRequest } from '../../src/middleware/workspace';

// Auth + workspace resolution are injected by buildApp(); everything else —
// the ownership middleware under test, the controllers, and the DB — is real.
vi.mock('../../src/middleware/auth', () => ({
    authenticate: vi.fn(async () => {}),
    requireAdmin: vi.fn(async () => {}),
}));
vi.mock('../../src/middleware/workspace', () => ({
    resolveWorkspace: vi.fn(async () => {}),
    requireRole: vi.fn(() => async () => {}),
}));

let seq = 0;
const uniq = (p: string) => `${p}-${Date.now()}-${++seq}`;

async function buildApp(userId: string, workspaceId: string): Promise<FastifyInstance> {
    const app = fastify({ logger: false });
    app.addHook('preHandler', async (request) => {
        const req = request as WorkspaceRequest;
        req.user = { userId, facebookId: 'fb_test' };
        req.workspaceId = workspaceId;
        req.workspaceRole = 'owner';
    });
    const notificationRoutes = (await import('../../src/routes/customerNotifications')).default;
    const analyticsRoutes = (await import('../../src/routes/ecommerceAnalytics')).default;
    app.register(notificationRoutes, { prefix: '/' });
    app.register(analyticsRoutes, { prefix: '/ecommerce-analytics' });
    await app.ready();
    return app;
}

async function seedStore(userId: string, workspaceId: string) {
    const [store] = await testDb.insert(schema.ecommerceStores).values({
        userId,
        workspaceId,
        platform: 'zid',
        storeDomain: `${uniq('h')}.zid.store`,
        accessToken: 'placeholder',
        accessTokenIv: '0'.repeat(32),
        isActive: true,
    }).returning({ id: schema.ecommerceStores.id });
    return store;
}

/**
 * Regression for the 2026-08-23 IDOR: every route keyed by a client-supplied
 * `:storeId` trusted it. A user in one workspace could read another merchant's
 * notification log (customer phone numbers + message bodies), rewrite their
 * templates, or wipe them — proven live against the Zid dev store before the
 * fix. These tests drive the real routes over HTTP with two real workspaces.
 */
describe('store-scoped routes refuse a store owned by another workspace', () => {
    let ownerApp: FastifyInstance;
    let intruderApp: FastifyInstance;
    let storeId: string;

    beforeEach(async () => {
        const owner = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('owner')}@test.com` });
        const ownerWs = await createTestWorkspace(owner.id);
        const intruder = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('intruder')}@test.com` });
        const intruderWs = await createTestWorkspace(intruder.id);

        storeId = (await seedStore(owner.id, ownerWs.id)).id;
        // Seed one template so the write paths have a real row to protect.
        await testDb.insert(schema.customerNotificationTemplates).values({
            ecommerceStoreId: storeId,
            notificationType: 'order_confirmed',
            messageAr: 'أصلي',
            messageEn: 'original',
            isEnabled: true,
        });

        ownerApp = await buildApp(owner.id, ownerWs.id);
        intruderApp = await buildApp(intruder.id, intruderWs.id);
    });

    afterEach(async () => {
        await ownerApp?.close();
        await intruderApp?.close();
    });

    const READS = [
        (id: string) => `/notification-templates/${id}`,
        (id: string) => `/notification-log/${id}`,
        (id: string) => `/notification-log/${id}/stats`,
        (id: string) => `/ecommerce-analytics/${id}`,
    ];

    it.each(READS.map(u => [u('<id>'), u]))('GET %s → 403 for the intruder, 200 for the owner', async (_label, url) => {
        const denied = await intruderApp.inject({ method: 'GET', url: url(storeId) });
        expect(denied.statusCode).toBe(403);
        expect(denied.body).not.toContain('original'); // nothing of the store leaks

        const allowed = await ownerApp.inject({ method: 'GET', url: url(storeId) });
        expect(allowed.statusCode).toBe(200);
    });

    it('PUT template → 403 for the intruder and the row is untouched', async () => {
        const denied = await intruderApp.inject({
            method: 'PUT',
            url: `/notification-templates/${storeId}/order_confirmed`,
            payload: { messageEn: 'hijacked' },
        });
        expect(denied.statusCode).toBe(403);

        const [row] = await testDb.select({ messageEn: schema.customerNotificationTemplates.messageEn })
            .from(schema.customerNotificationTemplates)
            .where(eq(schema.customerNotificationTemplates.ecommerceStoreId, storeId));
        expect(row.messageEn).toBe('original');

        const allowed = await ownerApp.inject({
            method: 'PUT',
            url: `/notification-templates/${storeId}/order_confirmed`,
            payload: { messageEn: 'edited by owner' },
        });
        expect(allowed.statusCode).toBe(200);
    });

    it('POST reset → 403 for the intruder and the templates survive', async () => {
        const denied = await intruderApp.inject({
            method: 'POST',
            url: `/notification-templates/${storeId}/reset`,
        });
        expect(denied.statusCode).toBe(403);

        const rows = await testDb.select({ id: schema.customerNotificationTemplates.id })
            .from(schema.customerNotificationTemplates)
            .where(eq(schema.customerNotificationTemplates.ecommerceStoreId, storeId));
        expect(rows).toHaveLength(1);
    });

    it('an unknown storeId is 404, not a leak of whether it exists elsewhere', async () => {
        const res = await intruderApp.inject({
            method: 'GET',
            url: '/notification-log/00000000-0000-0000-0000-000000000000',
        });
        expect(res.statusCode).toBe(404);
    });
});
