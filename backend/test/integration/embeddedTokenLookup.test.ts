import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import { testDb, createTestUser, createTestWorkspace } from './setup';
import {
    createStore,
    setEmbeddedTokenHash,
    getStoreByEmbeddedTokenHash,
    touchEmbeddedTokenUse,
    EMBEDDED_TOKEN_IDLE_MS,
} from '../../src/services/ecommerce';
import { hashEmbeddedToken } from '../../src/services/embeddedSession';
import * as schema from '../../src/db/schema';
import { uniq } from '../helpers/ecommerceFixtures';

/**
 * `getStoreByEmbeddedTokenHash` is the single query behind three separate security
 * properties of the Zid embedded app (ZID_TEST_PLAN §L):
 *
 *   L-7  uninstall        → the hash is cleared      → the dashboard entry 401s
 *   L-8  merchant disconnect → `is_active` goes false → the dashboard entry 401s
 *   L-13 idle > 30 days   → the idle window excludes it → the dashboard entry 401s
 *
 * Every unit test mocks this function, so until this file existed none of its three
 * predicates were ever executed — three security guarantees resting on one unexercised
 * WHERE clause, on exactly the surface Zid rejected the app for. These run the real SQL
 * against real Postgres, so a predicate deleted in a refactor fails here instead of in
 * a reviewer's browser.
 *
 * The plan's own §L-7/§L-8/§L-13 steps reach the same states by uninstalling the live
 * app; that is deliberately the LAST thing done to the dev store (it is also the
 * cleanup), so these pin the logic without spending it.
 */
describe('getStoreByEmbeddedTokenHash — Integration (real Postgres)', () => {

    /** A connected Zid store with a live embedded credential, as a real install leaves it. */
    async function createEmbeddedStore() {
        const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('m')}@test.com` });
        const workspace = await createTestWorkspace(user.id);
        const store = await createStore({
            userId: user.id,
            platform: 'zid',
            storeDomain: `${uniq('s')}.zid.store`,
            accessToken: 'zid_access_token',
            authorizationToken: 'zid_authorization_token',
            shopInfo: { shopName: 'Zid Test Store', shopCurrency: 'SAR' },
            workspaceId: workspace.id,
        });

        // The raw UUID is what Zid puts on the iframe URL; only its digest is stored.
        const credential = '11111111-2222-3333-4444-555555555555';
        const hash = hashEmbeddedToken(credential);
        await setEmbeddedTokenHash(store.id, hash);
        return { store, hash };
    }

    /** Move the idle clock back by hand — the only way to reach L-13 without waiting 30 days. */
    async function setLastUsed(storeId: string, value: Date | null) {
        await testDb.update(schema.ecommerceStores)
            .set({ embeddedTokenLastUsedAt: value })
            .where(eq(schema.ecommerceStores.id, storeId));
    }

    it('resolves a live credential (the control — every refusal below must differ only in one field)', async () => {
        const { store, hash } = await createEmbeddedStore();

        const found = await getStoreByEmbeddedTokenHash('zid', hash);

        expect(found?.id).toBe(store.id);
    });

    it('L-7: refuses after the hash is cleared, and clears the idle clock with it', async () => {
        const { store, hash } = await createEmbeddedStore();

        // What an uninstall does.
        await setEmbeddedTokenHash(store.id, null);

        expect(await getStoreByEmbeddedTokenHash('zid', hash)).toBeNull();

        // The clock must not survive the credential, or a re-mint would inherit a stale one.
        const [row] = await testDb.select().from(schema.ecommerceStores)
            .where(eq(schema.ecommerceStores.id, store.id)).limit(1);
        expect(row.embeddedTokenHash).toBeNull();
        expect(row.embeddedTokenLastUsedAt).toBeNull();
    });

    it('L-8: refuses once the store is deactivated, even though the hash still matches', async () => {
        const { store, hash } = await createEmbeddedStore();

        // What a merchant-side disconnect does: the row survives, is_active does not.
        await testDb.update(schema.ecommerceStores)
            .set({ isActive: false })
            .where(eq(schema.ecommerceStores.id, store.id));

        expect(await getStoreByEmbeddedTokenHash('zid', hash)).toBeNull();
    });

    it('L-13: refuses a credential idle past the 30-day window', async () => {
        const { store, hash } = await createEmbeddedStore();

        await setLastUsed(store.id, new Date(Date.now() - EMBEDDED_TOKEN_IDLE_MS - 60_000));

        expect(await getStoreByEmbeddedTokenHash('zid', hash)).toBeNull();
    });

    it('L-13: still resolves just INSIDE the window (the boundary is not off by a day)', async () => {
        const { store, hash } = await createEmbeddedStore();

        await setLastUsed(store.id, new Date(Date.now() - EMBEDDED_TOKEN_IDLE_MS + 60_000));

        expect((await getStoreByEmbeddedTokenHash('zid', hash))?.id).toBe(store.id);
    });

    it('treats a NULL idle clock as fresh (credentials minted before the column existed)', async () => {
        const { store, hash } = await createEmbeddedStore();

        await setLastUsed(store.id, null);

        expect((await getStoreByEmbeddedTokenHash('zid', hash))?.id).toBe(store.id);
    });

    it('touchEmbeddedTokenUse pushes the idle clock forward, so an active merchant never expires', async () => {
        const { store, hash } = await createEmbeddedStore();
        const nearlyExpired = new Date(Date.now() - EMBEDDED_TOKEN_IDLE_MS + 60_000);
        await setLastUsed(store.id, nearlyExpired);

        await touchEmbeddedTokenUse(store.id);

        const [row] = await testDb.select().from(schema.ecommerceStores)
            .where(eq(schema.ecommerceStores.id, store.id)).limit(1);
        // The whole point of the touch: the clock must have moved to ~now, not stayed put.
        expect(row.embeddedTokenLastUsedAt!.getTime()).toBeGreaterThan(nearlyExpired.getTime());
        expect(Date.now() - row.embeddedTokenLastUsedAt!.getTime()).toBeLessThan(60_000);
        expect((await getStoreByEmbeddedTokenHash('zid', hash))?.id).toBe(store.id);
    });

    it('is scoped by platform — the same digest on another platform does not resolve', async () => {
        const { hash } = await createEmbeddedStore();

        expect(await getStoreByEmbeddedTokenHash('salla', hash)).toBeNull();
    });

    it('refuses an unknown digest', async () => {
        await createEmbeddedStore();

        expect(await getStoreByEmbeddedTokenHash('zid', hashEmbeddedToken('99999999-8888-7777-6666-555555555555'))).toBeNull();
    });
});
