/**
 * Flush the Redis workspace_settings cache.
 *
 * Pairs with migration 0095_backfill_default_greeting.sql: after the SQL
 * backfills greeting values, cached settings (5-minute TTL) may still reflect
 * the old empty state. Running this script after the migration eliminates
 * the post-deploy window where customers' first messages could still be
 * flagged as needs_attention by the AI before the cache expires.
 *
 * Idempotent and safe to run any time. SCAN-based — no KEYS *.
 *
 * Usage (prod, after `npm run build`): node dist/scripts/flush-workspace-settings-cache.js
 * Usage (dev):                          npx tsx src/scripts/flush-workspace-settings-cache.ts
 */
import dotenv from 'dotenv';
import { redis } from '../lib/redis';

dotenv.config();

const PATTERN = 'workspace_settings:v1:*';

async function run() {
    console.log(`🔍 Scanning Redis for keys matching ${PATTERN}...`);
    await redis.connect();

    let cursor = '0';
    let total = 0;

    try {
        do {
            // ioredis scan returns [nextCursor, keys[]]
            const [next, keys] = await redis.scan(cursor, 'MATCH', PATTERN, 'COUNT', '500');
            cursor = next;
            if (keys.length > 0) {
                await redis.del(...keys);
                total += keys.length;
            }
        } while (cursor !== '0');

        console.log(`✅ Flushed ${total} workspace_settings cache entries.`);
    } finally {
        await redis.quit();
    }
}

run()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Cache flush failed:', err);
        process.exit(1);
    });
