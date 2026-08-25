/**
 * Shared fixtures for e-commerce tests that run against the real test database
 * (the `integration` and `stress` suites, which share `test/integration/setup.ts`).
 *
 * Rule 10.8: these were copy-pasted across six test files before this module
 * existed. `npm run check:duplication` cannot catch that — its `SKIP_PATH`
 * deliberately excludes `*.test.ts` — so test-side duplication is on us to spot,
 * which is exactly why it had spread that far unnoticed.
 */
import { and, eq } from 'drizzle-orm';
import { createTestUser, createTestWorkspace, testDb } from '../integration/setup';
import * as schema from '../../src/db/schema';
import { createStore } from '../../src/services/ecommerce';
import { customerNotificationService } from '../../src/services/customerNotifications';

export type EcommercePlatform = 'salla' | 'zid' | 'shopify';

/** A collision-proof suffix for fixture identifiers within one run. */
export function uniq(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface CreateFixtureStoreOptions {
    /** Persisted ENCRYPTED via createStore — `decrypt()` has no legacy passthrough,
     *  so a hand-written ciphertext throws on read and silently voids a test. */
    refreshToken?: string;
    /** Columns to force after creation (e.g. `tokenExpiresAt` for refresh tests). */
    overrides?: Record<string, unknown>;
}

/**
 * A connected store owned by a fresh user + workspace.
 *
 * Zid always receives an `authorizationToken`: its dual-header auth refuses every
 * API call without one, which surfaces as a confusing "merchant must reconnect"
 * rather than as a fixture problem.
 */
export async function createFixtureStore(
    platform: EcommercePlatform,
    opts: CreateFixtureStoreOptions = {},
) {
    const user = await createTestUser({ facebookId: uniq('fb'), email: `${uniq('m')}@test.com` });
    const workspace = await createTestWorkspace(user.id);
    const store = await createStore({
        userId: user.id,
        platform,
        storeDomain: `${uniq('store')}.example.com`,
        accessToken: 'tok_fixture',
        refreshToken: opts.refreshToken,
        authorizationToken: platform === 'zid' ? 'zid_authorization_token' : undefined,
        shopInfo: { shopName: `Fixture ${platform}`, shopCurrency: 'SAR' },
        workspaceId: workspace.id,
    });

    if (opts.overrides && Object.keys(opts.overrides).length > 0) {
        await testDb.update(schema.ecommerceStores)
            .set(opts.overrides)
            .where(eq(schema.ecommerceStores.id, store.id));
    }
    return store;
}

/**
 * A connected store whose notification templates are seeded AND enabled.
 *
 * Seeding leaves every template `is_enabled = false` by design (the merchant opts
 * in), and `schedule()` returns early on a disabled template — so a test that
 * forgets this reads "zero rows" as a dedup pass. Enable them explicitly.
 */
export async function createStoreWithNotificationTemplates(
    platform: EcommercePlatform = 'salla',
    opts: CreateFixtureStoreOptions = {},
) {
    const store = await createFixtureStore(platform, opts);
    await customerNotificationService.seedDefaults(store.id);
    await testDb.update(schema.customerNotificationTemplates)
        .set({ isEnabled: true })
        .where(eq(schema.customerNotificationTemplates.ecommerceStoreId, store.id));
    return store;
}

/** Notification-log rows for one store and notification type. */
export async function notificationLogRows(storeId: string, type: string) {
    return testDb.select().from(schema.customerNotificationsLog)
        .where(and(
            eq(schema.customerNotificationsLog.ecommerceStoreId, storeId),
            eq(schema.customerNotificationsLog.notificationType, type),
        ));
}

/** Every synced product row for one store. */
export async function storeProductRows(storeId: string) {
    return testDb.select().from(schema.ecommerceProducts)
        .where(eq(schema.ecommerceProducts.ecommerceStoreId, storeId));
}
