import { Queue } from 'bullmq';
import { config } from '../config';
import { EcommerceSyncJobData, ECOMMERCE_SYNC_QUEUE_NAME } from '@jawab24/shared';

const connection = {
    host: config.redis.host,
    port: parseInt(String(config.redis.port || 6379)),
    password: config.redis.password,
};

export const ecommerceSyncQueue = new Queue<EcommerceSyncJobData>(ECOMMERCE_SYNC_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: 'exponential',
            delay: 3000, // 3s, 6s, 12s between retries
        },
        removeOnComplete: 50,
        removeOnFail: 200,
    },
});

/**
 * Enqueue a sync for an e-commerce store.
 *
 * `full_sync` (default) refreshes store info + the whole catalog — right for
 * install/claim and the 6h scheduler. Product webhooks should pass
 * `product_update` instead: it re-syncs the catalog WITHOUT the store-info
 * round-trip (Salla/Zid product payloads are too sparse for an in-place upsert,
 * so a catalog re-fetch is still needed — but touching store info on every
 * product edit is redundant API load).
 */
export async function enqueueSyncJob(
    storeId: string,
    platform: 'shopify' | 'salla' | 'zid' = 'shopify',
    jobType: 'full_sync' | 'product_update' = 'full_sync',
): Promise<void> {
    await ecommerceSyncQueue.add(jobType, {
        ecommerceStoreId: storeId,
        platform,
        jobType,
    });
}

export const ECOMMERCE_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** Same lead-in as the reconcile crons in index.ts: late enough for the app to be healthy, early enough to run on every deploy. */
export const ECOMMERCE_SYNC_INITIAL_DELAY_MS = 3 * 60 * 1000;

export interface ScheduleEcommerceSyncOptions {
    getAllActiveStores: () => Promise<Array<{ id: string; platform: string }>>;
    log: { info: (msg: string) => void; error: (err: unknown, msg: string) => void };
    onError?: (err: unknown) => void;
    intervalMs?: number;
    initialDelayMs?: number;
}

/**
 * Schedule the catalog refresh for every active store: one sweep shortly after
 * boot, then every `intervalMs`.
 *
 * The initial sweep is the point. This used to be a bare `setInterval` anchored
 * to process start, so the first refresh came 6 h after boot — and with a
 * blue/green deploy every few hours, no container lived that long. Checked on
 * prod 2026-08-22: neither backend container had ever logged
 * `[EcommerceScheduler]`, and every store's `last_sync_at` came from an install
 * or a manual sync. "Refreshes inventory every 6 hours" was true only on days
 * nothing shipped. Mirrors `scheduleReconcileCron`, which already runs an
 * initial sweep 3 min after boot for the same reason.
 *
 * Returns the timers so a caller (or a test) can clear them.
 */
export function scheduleEcommerceSync(opts: ScheduleEcommerceSyncOptions): { initial: NodeJS.Timeout; interval: NodeJS.Timeout } {
    const sweep = async (phase: string) => {
        try {
            const stores = await opts.getAllActiveStores();
            for (const store of stores) {
                await enqueueSyncJob(store.id, store.platform as 'shopify' | 'salla' | 'zid');
            }
            opts.log.info(`[EcommerceScheduler] ${phase}: enqueued sync for ${stores.length} store(s)`);
        } catch (err) {
            opts.log.error(err, `[EcommerceScheduler] ${phase} failed`);
            opts.onError?.(err);
        }
    };
    const initial = setTimeout(() => { void sweep('initial sweep'); }, opts.initialDelayMs ?? ECOMMERCE_SYNC_INITIAL_DELAY_MS);
    const interval = setInterval(() => { void sweep('scheduled sweep'); }, opts.intervalMs ?? ECOMMERCE_SYNC_INTERVAL_MS);
    return { initial, interval };
}
