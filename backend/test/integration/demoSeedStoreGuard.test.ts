/**
 * The demo seeder's store self-heal must never delete a REAL merchant's store.
 *
 * `seedDemoData` deletes stores on the demo fixture domains that are owned by
 * anyone other than the shared demo user — a self-heal for fixtures stranded
 * under another account, since (platform, store_domain) is globally unique.
 *
 * The hazard: those fixture domains live in a namespace real merchants draw
 * from. `gulf-fashion.salla.sa` is an ordinary Salla subdomain, so "this domain
 * + not the demo user" is also an exact description of a real merchant who
 * happens to own it — and this statement runs on EVERY demo login, with the
 * store's products cascading. The `platformData.demo` predicate is what makes
 * deleting a real store impossible rather than merely unlikely.
 */
import { describe, it, expect } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
    testDb,
    createTestUser,
    createTestWorkspace,
    createTestEcommerceStore,
} from './setup';
import * as schema from '../../src/db/schema';
import { seedDemoData } from '../../src/plugins/demo/seedData';

/** The Salla fixture domain — deliberately an ordinary, claimable Salla subdomain. */
const DEMO_SALLA_DOMAIN = 'gulf-fashion.salla.sa';

async function storeExists(storeId: string): Promise<boolean> {
    const rows = await testDb.select({ id: schema.ecommerceStores.id })
        .from(schema.ecommerceStores)
        .where(eq(schema.ecommerceStores.id, storeId));
    return rows.length === 1;
}

describe('demo seed — store self-heal never deletes a real merchant store', () => {
    it('KEEPS a real store that merely shares the fixture domain', async () => {
        // A real merchant who legitimately owns gulf-fashion.salla.sa: real
        // (non-demo) platformData, their own user, their own products.
        const merchant = await createTestUser({ email: 'merchant@example.com' });
        const merchantWs = await createTestWorkspace(merchant.id);
        const realStore = await createTestEcommerceStore(merchant.id, {
            workspaceId: merchantWs.id,
            platform: 'salla',
            storeDomain: DEMO_SALLA_DOMAIN,
            platformData: { merchantId: '2108580704' }, // no `demo` flag — a real store
        });
        await testDb.insert(schema.ecommerceProducts).values({
            ecommerceStoreId: realStore.id,
            platformProductId: 'real-product-1',
            title: 'عباية حقيقية',
            status: 'active',
        });

        // Someone clicks "Try Demo" — a different user, seeding demo fixtures.
        const demoUser = await createTestUser({ email: 'demo@jawab24.com' });
        const demoWs = await createTestWorkspace(demoUser.id);
        await seedDemoData(demoUser.id, demoWs.id);

        expect(await storeExists(realStore.id)).toBe(true);
        const products = await testDb.select().from(schema.ecommerceProducts)
            .where(eq(schema.ecommerceProducts.ecommerceStoreId, realStore.id));
        expect(products).toHaveLength(1); // products did not cascade away
    });

    it('still DELETES a genuine demo fixture stranded under another user (self-heal intact)', async () => {
        // The case the delete exists for: a demo fixture orphaned under a real
        // account. Without removing it, the fresh-seed insert 23505s on the
        // globally-unique (platform, store_domain) on every demo login.
        const stranded = await createTestUser({ email: 'stranded@example.com' });
        const strandedWs = await createTestWorkspace(stranded.id);
        const strandedFixture = await createTestEcommerceStore(stranded.id, {
            workspaceId: strandedWs.id,
            platform: 'salla',
            storeDomain: DEMO_SALLA_DOMAIN,
            platformData: { merchant_id: 'demo_salla_merchant', demo: true },
        });

        const demoUser = await createTestUser({ email: 'demo@jawab24.com' });
        const demoWs = await createTestWorkspace(demoUser.id);
        await seedDemoData(demoUser.id, demoWs.id);

        expect(await storeExists(strandedFixture.id)).toBe(false);
    });

    it('deletes a stranded fixture whose platform_data is a DOUBLE-SERIALIZED jsonb string', async () => {
        // postgres-js stores some jsonb writes as a string scalar rather than an
        // object. `platform_data->>'demo'` returns NULL on those, so a SQL-side
        // predicate silently matches nothing and the stranded fixture survives —
        // which then 23505s the seed insert on every demo login. isDemoStore runs
        // on the hydrated row, which drizzle parses back for both encodings.
        // Written raw here because the ORM write path produces the object form.
        const stranded = await createTestUser({ email: 'double-serialized@example.com' });
        const strandedWs = await createTestWorkspace(stranded.id);
        const fixture = await createTestEcommerceStore(stranded.id, {
            workspaceId: strandedWs.id,
            platform: 'salla',
            storeDomain: DEMO_SALLA_DOMAIN,
        });
        await testDb.execute(sql`
            UPDATE ecommerce_stores
               SET platform_data = to_jsonb(${JSON.stringify({ merchant_id: 'demo_salla_merchant', demo: true })}::text)
             WHERE id = ${fixture.id}
        `);
        // Guard the guard: prove this row really is the encoding that defeats `->>`.
        const [probe] = await testDb.execute<{ via_operator: string | null }>(sql`
            SELECT platform_data->>'demo' AS via_operator
              FROM ecommerce_stores WHERE id = ${fixture.id}
        `);
        expect(probe.via_operator).toBeNull();

        const demoUser = await createTestUser({ email: 'demo@jawab24.com' });
        const demoWs = await createTestWorkspace(demoUser.id);
        await seedDemoData(demoUser.id, demoWs.id);

        expect(await storeExists(fixture.id)).toBe(false);
    });
});
