/**
 * Re-register webhook topics for existing connected stores.
 *
 * New webhook topics (e.g. Shopify's `fulfillments/update`, added for delivery
 * notifications) are only subscribed at install/claim time. Stores connected
 * before the topic was added never receive it until they re-register. Run this
 * once after deploying a topic change; it is idempotent — Shopify returns 422
 * for an already-registered topic, which registerWebhooks treats as success.
 *
 * Usage:
 *   npx ts-node scripts/reregister-webhooks.ts [platform]   # shopify | salla | zid
 *   npx ts-node scripts/reregister-webhooks.ts               # all platforms
 *
 * Uses the same persist-on-throw + retry-queue path as the install flow and the
 * per-workspace "Re-register" button (createReregisterHandler), so webhookStatus
 * is refreshed and partial failures are queued for retry.
 */
import { db } from '../src/db';
import { ecommerceStores } from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { registerWebhooksWithPersist, type EcommercePlatform } from '../src/services/ecommerce';
import { isDemoStore } from '../src/services/demoStore';
import { integrationRegistry } from '../src/integrations';

const PLATFORMS: EcommercePlatform[] = ['shopify', 'salla', 'zid'];

async function reregisterForPlatform(platform: EcommercePlatform): Promise<void> {
    const adapter = integrationRegistry.get(platform);
    if (!adapter) {
        console.log(`[${platform}] not registered — skipping`);
        return;
    }

    const stores = await db.select()
        .from(ecommerceStores)
        .where(and(eq(ecommerceStores.platform, platform), eq(ecommerceStores.isActive, true)));

    console.log(`[${platform}] ${stores.length} active store(s)`);

    for (const store of stores) {
        if (isDemoStore(store)) {
            console.log(`  ⏭️  ${store.storeDomain} — demo store, skipping`);
            continue;
        }
        try {
            const status = await registerWebhooksWithPersist(
                store.id,
                platform,
                () => adapter.registerWebhooks({
                    id: store.id,
                    storeDomain: store.storeDomain,
                    accessToken: store.accessToken,
                    accessTokenIv: store.accessTokenIv,
                }),
            );
            const ok = status.failed.length === 0;
            console.log(`  ${ok ? '✅' : '⚠️ '} ${store.storeDomain} — registered ${status.registered.length}, failed ${status.failed.length}`);
            if (!ok) console.log(`     failed: ${JSON.stringify(status.failed)}`);
        } catch (err) {
            console.error(`  ❌ ${store.storeDomain} — ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

(async () => {
    const arg = process.argv[2] as EcommercePlatform | undefined;
    const targets = arg ? [arg] : PLATFORMS;
    if (arg && !PLATFORMS.includes(arg)) {
        console.error(`Unknown platform "${arg}". Use one of: ${PLATFORMS.join(', ')}`);
        process.exit(1);
    }

    try {
        for (const platform of targets) {
            await reregisterForPlatform(platform);
        }
    } catch (err) {
        console.error('ERROR:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    } finally {
        process.exit(0);
    }
})();
