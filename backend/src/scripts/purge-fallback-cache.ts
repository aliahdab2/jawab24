/**
 * Purge cached ai-worker fallback replies from BOTH cache layers.
 *
 * Context: the ai-worker's internal `getFallbackReply()` returns a templated
 * "Thanks, we'll get back to you" string as a *successful* 200 with
 * `flags: ['fallback_reply']`. Until the backend belt-and-suspenders guard
 * shipped, those strings were cached unconditionally in:
 *
 *   1. Redis (`cache:ai_reply:*`)   — 30-day TTL, read first
 *   2. Postgres `ai_cache`          — read on Redis miss, repopulates Redis
 *   3. Postgres `semantic_cache`    — vector-similarity cache (page-scoped)
 *
 * On a cache hit, the fallback text ships to the customer as if it were a real
 * AI reply. Suspected origin: prompt v41's strict JSON schema change (May 13)
 * spiked OpenAI refusals, which fired `getFallbackReply` and seeded the cache.
 * v41 has since been reverted but the cached rows persist.
 *
 * This script removes every cache entry whose stored reply is one of those
 * templates, identified by the `fallback_reply` flag in metadata or by exact
 * string-prefix match against the known template variants (Arabic / English /
 * Swedish, with or without a page-name suffix).
 *
 * Selective (not nuke-all) so legitimate cache entries survive and we avoid a
 * cache-miss surge that would slam ai-worker. Chunked + paced for the same
 * reason — large Postgres DELETEs would also lock the table briefly.
 *
 * Idempotent. Safe to run any time. Logs row counts as a single structured
 * line for ops audit.
 *
 * Usage (prod, after `npm run build`): node dist/scripts/purge-fallback-cache.js
 * Usage (dev):                         npx tsx src/scripts/purge-fallback-cache.ts
 */
import dotenv from 'dotenv';
import { sql } from 'drizzle-orm';
import { db } from '../db';
import { redis } from '../lib/redis';

dotenv.config();

// Known prefixes of every templated fallback string ai-worker can emit.
// Source of truth: ai-worker/src/services/openai.ts getFallbackReply().
// Must stay in sync if any new locale is added there.
export const TEMPLATE_PREFIXES = [
    // Arabic
    'شكراً لرسالتك إلى',
    'شكراً لتواصلك مع',
    // English
    'Thank you for your message to',
    'Thank you for reaching out to',
    // Swedish
    'Tack för ditt meddelande till',
    'Tack för att du kontaktar',
];

const REDIS_SCAN_BATCH = 500;
const PG_CHUNK = 5000;
const PG_CHUNK_SLEEP_MS = 1000;

/**
 * Decision logic for "is this cached entry a fallback that we must delete".
 * Exported for unit testing — any miscalibration here either leaves fallbacks
 * in cache (bad) or deletes legitimate cache entries (worse, regenerates fine
 * but burns ai-worker quota). Both failure modes need test coverage.
 */
export function isFallbackReply(reply: string | undefined | null, flags: unknown): boolean {
    if (Array.isArray(flags) && flags.includes('fallback_reply')) return true;
    if (typeof reply !== 'string') return false;
    return TEMPLATE_PREFIXES.some(prefix => reply.startsWith(prefix));
}

async function purgeRedis(): Promise<number> {
    console.log('🔍 Scanning Redis for cache:ai_reply:* keys...');

    let cursor = '0';
    let scanned = 0;
    let deleted = 0;

    do {
        const [next, keys] = await redis.scan(
            cursor, 'MATCH', 'cache:ai_reply:*', 'COUNT', String(REDIS_SCAN_BATCH),
        );
        cursor = next;

        if (keys.length === 0) continue;
        scanned += keys.length;

        // Pipeline GET for the batch
        const pipeline = redis.pipeline();
        keys.forEach(key => pipeline.get(key));
        const results = await pipeline.exec();

        const victims: string[] = [];
        if (results) {
            results.forEach(([err, value], idx) => {
                if (err || typeof value !== 'string') return;
                try {
                    const parsed = JSON.parse(value) as { reply?: string; flags?: unknown };
                    if (isFallbackReply(parsed.reply, parsed.flags)) {
                        victims.push(keys[idx]);
                    }
                } catch {
                    // Old plain-string entries (pre-metadata era) — won't parse, leave alone.
                    // Anything we can't classify as a fallback stays.
                }
            });
        }

        if (victims.length > 0) {
            await redis.del(...victims);
            deleted += victims.length;
        }
    } while (cursor !== '0');

    console.log(`✅ Redis: scanned ${scanned}, deleted ${deleted} fallback entries.`);
    return deleted;
}

async function purgePostgresAiCache(): Promise<number> {
    console.log('🔍 Purging Postgres ai_cache table (chunked)...');

    let totalDeleted = 0;
    for (;;) {
        // Match either: (a) metadata.flags array contains 'fallback_reply', or
        // (b) reply_text starts with one of the known template prefixes.
        // Chunked DELETE via CTE keeps each transaction small.
        const result = await db.execute(sql`
            WITH victims AS (
                SELECT id FROM ai_cache
                WHERE metadata @> '{"flags": ["fallback_reply"]}'::jsonb
                   OR reply_text LIKE 'شكراً لرسالتك إلى%'
                   OR reply_text LIKE 'شكراً لتواصلك مع%'
                   OR reply_text LIKE 'Thank you for your message to%'
                   OR reply_text LIKE 'Thank you for reaching out to%'
                   OR reply_text LIKE 'Tack för ditt meddelande till%'
                   OR reply_text LIKE 'Tack för att du kontaktar%'
                LIMIT ${PG_CHUNK}
            )
            DELETE FROM ai_cache WHERE id IN (SELECT id FROM victims)
            RETURNING id
        `);
        // Drizzle's db.execute returns the RETURNING rows directly.
        const n = Array.isArray(result) ? result.length : 0;
        totalDeleted += n;

        if (n < PG_CHUNK) break;
        await new Promise(r => setTimeout(r, PG_CHUNK_SLEEP_MS));
    }

    console.log(`✅ Postgres ai_cache: deleted ${totalDeleted} fallback rows.`);
    return totalDeleted;
}

async function purgePostgresSemanticCache(): Promise<number> {
    console.log('🔍 Purging Postgres semantic_cache table...');

    // semantic_cache is smaller (page-scoped); one pass is fine. No template-
    // prefix check needed — the flag in metadata is the only signal that this
    // row came from getFallbackReply (semantic cache stores full LLM output).
    const result = await db.execute(sql`
        DELETE FROM semantic_cache
        WHERE metadata @> '{"flags": ["fallback_reply"]}'::jsonb
        RETURNING id
    `);
    const n = Array.isArray(result) ? result.length : 0;
    console.log(`✅ Postgres semantic_cache: deleted ${n} fallback rows.`);
    return n;
}

async function run() {
    const start = Date.now();

    // Postgres FIRST: if we nuke Redis first, a cache-miss could repopulate Redis
    // from a still-fallback row in Postgres. By doing PG first, any subsequent
    // Redis miss falls through to a clean Postgres state.
    const aiCacheDeleted = await purgePostgresAiCache();
    const semCacheDeleted = await purgePostgresSemanticCache();
    const redisDeleted = await purgeRedis();

    const durationMs = Date.now() - start;
    console.log(JSON.stringify({
        event: 'fallback_cache_purged',
        ai_cache_pg: aiCacheDeleted,
        semantic_cache_pg: semCacheDeleted,
        redis_ai_reply: redisDeleted,
        duration_ms: durationMs,
    }));
}

// Only auto-run when executed as a script, not when imported (e.g. by tests).
if (require.main === module) {
    run()
        .then(() => process.exit(0))
        .catch(err => {
            console.error('❌ Cache purge failed:', err);
            process.exit(1);
        });
}
