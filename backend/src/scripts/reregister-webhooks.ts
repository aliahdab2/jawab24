/**
 * Re-register webhook topics for existing connected stores.
 *
 * New webhook topics (e.g. Shopify's `fulfillments/update`, added for delivery
 * notifications) are only subscribed at install/claim time. Stores connected
 * before the topic was added never receive it until they re-register. Run this
 * once after deploying a topic change; it is idempotent — Shopify registration
 * is a GraphQL list-then-upsert (matching subscriptions are skipped, drifted
 * callback URLs updated in place), and Salla/Zid treat already-registered
 * topics as success.
 *
 * Run (prod) — this file lives under src/ so it compiles into dist/ and can be run
 * INSIDE the running backend container, which already holds the database URL, the
 * token-encryption key and each platform's webhook secret:
 *
 *   docker exec <backend-container> node dist/scripts/reregister-webhooks.js salla
 *   docker exec <backend-container> node dist/scripts/reregister-webhooks.js
 *
 * (shopify | salla | zid; no argument = all platforms.) Locally: npx tsx
 * backend/src/scripts/reregister-webhooks.ts [platform].
 *
 * It was under backend/scripts/ until 2026-08-23, which is NOT compiled — so the one
 * documented repair path for the unsigned-Salla-subscription incident could not actually
 * be run anywhere near production, leaving the per-workspace "Re-register" button (which
 * needs that merchant's own logged-in session) as the only option.
 *
 * Uses the same persist-on-throw + retry-queue path as the install flow and the
 * per-workspace "Re-register" button (createReregisterHandler), so webhookStatus
 * is refreshed and partial failures are queued for retry.
 */
import { db } from '../db';
import { ecommerceStores } from '../db/schema';
import { and, eq } from 'drizzle-orm';
import { registerWebhooksWithPersist, type EcommercePlatform } from '../services/ecommerce';
import { isDemoStore } from '../services/demoStore';
import { integrationRegistry } from '../integrations';
import { toStoreForWebhooks } from '../integrations/registry';

const PLATFORMS: EcommercePlatform[] = ['shopify', 'salla', 'zid'];

/**
 * Per-store outcome tally. Returned (never just printed) so the process exit code can
 * reflect it: a repair run that could not repair a store must NOT look like a success to
 * whoever is scripting it — an ❌/⚠️ line scrolling past in a container log is not a signal.
 */
interface PlatformTally { ok: number; partial: number; failed: number; skipped: number }

const emptyTally = (): PlatformTally => ({ ok: 0, partial: 0, failed: 0, skipped: 0 });

async function reregisterForPlatform(platform: EcommercePlatform): Promise<PlatformTally> {
    const tally = emptyTally();
    const adapter = integrationRegistry.get(platform);
    if (!adapter) {
        console.log(`[${platform}] not registered — skipping`);
        return tally;
    }

    const stores = await db.select()
        .from(ecommerceStores)
        .where(and(eq(ecommerceStores.platform, platform), eq(ecommerceStores.isActive, true)));

    console.log(`[${platform}] ${stores.length} active store(s)`);

    for (const store of stores) {
        if (isDemoStore(store)) {
            console.log(`  ⏭️  ${store.storeDomain} — demo store, skipping`);
            tally.skipped++;
            continue;
        }
        try {
            const status = await registerWebhooksWithPersist(
                store.id,
                platform,
                () => adapter.registerWebhooks(toStoreForWebhooks(store)),
            );
            const ok = status.failed.length === 0;
            console.log(`  ${ok ? '✅' : '⚠️ '} ${store.storeDomain} — registered ${status.registered.length}, failed ${status.failed.length}`);
            if (!ok) console.log(`     failed: ${JSON.stringify(status.failed)}`);
            if (ok) tally.ok++; else tally.partial++;
        } catch (err) {
            console.error(`  ❌ ${store.storeDomain} — ${err instanceof Error ? err.message : String(err)}`);
            tally.failed++;
        }
    }
    return tally;
}

(async () => {
    const arg = process.argv[2] as EcommercePlatform | undefined;
    const targets = arg ? [arg] : PLATFORMS;
    if (arg && !PLATFORMS.includes(arg)) {
        console.error(`Unknown platform "${arg}". Use one of: ${PLATFORMS.join(', ')}`);
        process.exit(1);
    }

    const total = emptyTally();
    try {
        for (const platform of targets) {
            const tally = await reregisterForPlatform(platform);
            total.ok += tally.ok;
            total.partial += tally.partial;
            total.failed += tally.failed;
            total.skipped += tally.skipped;
        }
    } catch (err) {
        console.error('ERROR:', err instanceof Error ? err.message : String(err));
        process.exit(1);
    }

    // A store we could not fully re-register is a FAILED run. The previous version ended in
    // `finally { process.exit(0) }`, which discarded even the catch above — every run exited 0.
    const unhealthy = total.partial + total.failed;
    console.log(
        `\nDONE: ok=${total.ok} partial=${total.partial} failed=${total.failed} skipped=${total.skipped}`,
    );
    if (unhealthy > 0) {
        console.error(`${unhealthy} store(s) were not fully re-registered — re-run after fixing the cause.`);
    }
    process.exit(unhealthy > 0 ? 1 : 0);
})();
