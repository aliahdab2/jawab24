/**
 * Integration tests for the Salla Article-5 billing guard's store-presence
 * query (real Postgres).
 *
 * `hasActiveStoreForBillingSubject` is the half of the rule that unit tests
 * cannot honestly cover: its correctness lives in SQL — a LEFT JOIN onto
 * workspaces plus an OR across two ownership legs, filtered by platform and
 * is_active. A mocked query builder would assert the shape of my own mock, not
 * that Postgres agrees. Both failure directions are expensive and silent:
 *   - too narrow → a Salla merchant reaches Stripe checkout (Article-5 breach,
 *     and unpublishing a live Salla app needs a booked meeting with Salla)
 *   - too broad  → a paying direct customer loses their upgrade path
 * so every leg gets an explicit row here.
 *
 * The composed rule (exemption + this query) is unit-tested in
 * test/services/marketplaceBilling.test.ts; the controller wiring in
 * test/controllers/payment.test.ts.
 *
 * The same query now serves the ZID rail too (D-073, one guard for all three
 * marketplaces), so the platform-scoping legs below cover both.
 */
import { describe, it, expect, vi } from 'vitest';
import { createTestUser, createTestWorkspace, testDb } from './setup';
import * as schema from '../../src/db/schema';

// BullMQ queue connects to Redis — external boundary, not under test (same
// reason as ecommerce-sync.test.ts: services/ecommerce.ts pulls it in at load).
vi.mock('../../src/lib/customerNotificationQueue', () => ({
    CUSTOMER_NOTIFICATION_QUEUE: 'customer-notifications',
    customerNotificationQueue: { add: vi.fn().mockResolvedValue(undefined) },
}));

import { hasActiveStoreForBillingSubject } from '../../src/services/ecommerce';
import { uniq } from '../helpers/ecommerceFixtures';


/** Insert a store row directly — createStore encrypts tokens we never read here. */
async function insertStore(values: {
    userId: string;
    workspaceId?: string | null;
    platform: string;
    isActive?: boolean;
}) {
    const [row] = await testDb
        .insert(schema.ecommerceStores)
        .values({
            userId: values.userId,
            workspaceId: values.workspaceId ?? null,
            platform: values.platform,
            storeDomain: uniq(`${values.platform}-store`),
            accessToken: 'ciphertext',
            accessTokenIv: 'iv',
            isActive: values.isActive ?? true,
        })
        .returning();
    return row;
}

describe('hasActiveStoreForBillingSubject', () => {
    it('is false for a user with no stores at all', async () => {
        const user = await createTestUser();

        await expect(hasActiveStoreForBillingSubject('salla', user.id)).resolves.toBe(false);
    });

    it('finds a store the user connected themselves (no workspace)', async () => {
        const user = await createTestUser();
        await insertStore({ userId: user.id, workspaceId: null, platform: 'salla' });

        await expect(hasActiveStoreForBillingSubject('salla', user.id)).resolves.toBe(true);
    });

    /**
     * The case that matters most in production: the workspace OWNER is the
     * billing subject (D-E), but a member may have connected the store. The
     * owner's subscription is what entitles the workspace, so the owner must
     * read as Salla-billed even though no row carries their user_id.
     */
    it('finds a store a MEMBER connected, when asked about the workspace owner', async () => {
        const owner = await createTestUser();
        const member = await createTestUser();
        const workspace = await createTestWorkspace(owner.id);
        await testDb.insert(schema.workspaceMembers).values({
            workspaceId: workspace.id,
            userId: member.id,
            role: 'admin',
        });
        await insertStore({ userId: member.id, workspaceId: workspace.id, platform: 'salla' });

        await expect(hasActiveStoreForBillingSubject('salla', owner.id)).resolves.toBe(true);
    });

    /**
     * The inverse, and the reason the query is scoped to OWNED workspaces
     * rather than every membership: a member has their own subscription, and
     * their employer's Salla store must not strip their personal upgrade path.
     */
    it('does NOT flag a plain member of someone else\'s Salla workspace', async () => {
        const owner = await createTestUser();
        const member = await createTestUser();
        const workspace = await createTestWorkspace(owner.id);
        await testDb.insert(schema.workspaceMembers).values({
            workspaceId: workspace.id,
            userId: member.id,
            role: 'admin',
        });
        await insertStore({ userId: owner.id, workspaceId: workspace.id, platform: 'salla' });

        await expect(hasActiveStoreForBillingSubject('salla', member.id)).resolves.toBe(false);
    });

    it('ignores a disconnected (is_active = false) store', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        await insertStore({
            userId: user.id,
            workspaceId: workspace.id,
            platform: 'salla',
            isActive: false,
        });

        await expect(hasActiveStoreForBillingSubject('salla', user.id)).resolves.toBe(false);
    });

    it('is platform-scoped — a Shopify store does not make you Salla-billed', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        await insertStore({ userId: user.id, workspaceId: workspace.id, platform: 'shopify' });

        await expect(hasActiveStoreForBillingSubject('salla', user.id)).resolves.toBe(false);
        await expect(hasActiveStoreForBillingSubject('shopify', user.id)).resolves.toBe(true);
    });

    /**
     * The Zid rail (D-070/D-073) reads this same query. Pinned separately from
     * the Salla legs because a platform filter that silently matched everything
     * would still pass every Salla case above while making Shopify and direct
     * Stripe customers falsely Zid-billed.
     */
    it('is platform-scoped for Zid too — a Salla store does not make you Zid-billed', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        await insertStore({ userId: user.id, workspaceId: workspace.id, platform: 'salla' });

        await expect(hasActiveStoreForBillingSubject('zid', user.id)).resolves.toBe(false);
        await expect(hasActiveStoreForBillingSubject('salla', user.id)).resolves.toBe(true);
    });

    it('finds a Zid store a MEMBER connected, when asked about the workspace owner', async () => {
        const owner = await createTestUser();
        const member = await createTestUser();
        const workspace = await createTestWorkspace(owner.id);
        await insertStore({ userId: member.id, workspaceId: workspace.id, platform: 'zid' });

        await expect(hasActiveStoreForBillingSubject('zid', owner.id)).resolves.toBe(true);
    });

    /**
     * One subscription serves every workspace its owner has, so a Salla store
     * in ANY owned workspace makes the owner Salla-billed. Scoping this to the
     * workspace being viewed would let the UI offer an upgrade the payment API
     * then refuses — the dead-end the Shopify review caught as H2.
     */
    it('flags an owner whose Salla store sits in a second, non-current workspace', async () => {
        const owner = await createTestUser();
        await createTestWorkspace(owner.id, { name: 'Plain workspace' });
        const sallaWorkspace = await createTestWorkspace(owner.id, { name: 'Salla workspace' });
        await insertStore({ userId: owner.id, workspaceId: sallaWorkspace.id, platform: 'salla' });

        await expect(hasActiveStoreForBillingSubject('salla', owner.id)).resolves.toBe(true);
    });

    it('stays true when an active store sits alongside a disconnected one', async () => {
        const user = await createTestUser();
        const workspace = await createTestWorkspace(user.id);
        await insertStore({
            userId: user.id, workspaceId: workspace.id, platform: 'salla', isActive: false,
        });
        await insertStore({
            userId: user.id, workspaceId: workspace.id, platform: 'salla', isActive: true,
        });

        await expect(hasActiveStoreForBillingSubject('salla', user.id)).resolves.toBe(true);
    });
});
