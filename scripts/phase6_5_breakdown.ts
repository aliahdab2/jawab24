/**
 * Phase 6.5 P1 diagnostic — read the Redis counters emitted by
 * backend + ai-worker and surface where ai_usage_log coverage leaks.
 *
 * Run (locally, with REDIS_* env vars set):
 *   npx tsx scripts/phase6_5_breakdown.ts
 *
 * Or against prod (read-only):
 *   ssh prod 'docker exec -e REDISCLI_AUTH=$REDIS_PASSWORD jawab24-redis \
 *     redis-cli --scan --pattern "metrics:ai:*" | xargs ...'
 *
 * Counter keys (see backend/src/lib/aiMetrics.ts):
 *   metrics:ai:attempts:{pipeline}:{model}
 *   metrics:ai:returns:{pipeline}:{model}
 *   metrics:ai:logged:{pipeline}:{model}
 *   metrics:ai:failed_before_log:{pipeline}:{model}:{error_class}
 *
 * Gap analysis (full interpretation in AI_INSTRUCTIONS.md §13c):
 *   attempts - returns  → SDK silent retries (direct-call paths) OR OpenAI errors
 *                         that throw before `chat.completions.create` resolves
 *   returns  - logged   → response-received-but-rejected events (refusal / empty
 *                         reply / hedging guards trip *after* recordAiReturn but
 *                         *before* logAiUsage) PLUS traditional log misses
 *                         (missing userId, ZeroTokens guards, swallowed errors)
 *   returns  - logged   → goes NEGATIVE when internal cache hits log without
 *                         issuing an OpenAI call; the magnitude *is* the cache-
 *                         hit volume for that pipeline
 *   attempts == 0 && logged > 0 → 100% internal-cache served in this window
 *
 * Hop failures (backend → ai-worker axios) surface as a dedicated error_class
 * `AiWorkerUnreachable` under failed_before_log — they do NOT inflate the
 * attempts-returns gap, because attempts is emitted on the ai-worker side only
 * (the hop never reached the OpenAI call site).
 *
 * Direct-call sites (lead extractor, kb embedding, kb file extractor, transcription)
 * emit attempts AND returns inside backend — for those the attempts→returns delta
 * is *SDK retry signal* (the OpenAI SDK retries 5xx/429 silently inside one call),
 * not a worker hop failure. The script labels these distinctly in the output.
 */
import Redis from 'ioredis';
import { config } from '../backend/src/config';

const DIRECT_CALL_PIPELINES = new Set([
    'lead_extraction', 'kb_file_extraction', 'operational_facts_extraction',
    'embedding_rag', 'embedding_cache', 'embedding_ingestion',
    'transcription',
    // «بوست اليوم» — both are direct backend makeTrackedOpenAI calls
    // (services/postSuggestions.ts), so an A−R gap here means SDK retries or
    // our own 20s/35s timeouts, never an ai-worker hop.
    'post_generation', 'post_image_generation',
    // D-111 once-per-post caption classification (services/contentCtaClassifier.ts) —
    // a direct backend makeTrackedOpenAI call under withAbortTimeout(15s).
    'post_cta_classification',
]);

/**
 * Pipelines that route through ai-worker `OpenAIService` (ai-worker/src/services/openai.ts:290).
 * That client is the only OpenAI client configured with `maxRetries: 3` — every other
 * client in the repo (backend openaiClient, leadExtractor, transcription, kb/embedding,
 * ai-worker translation, ai-worker ecommerceToolHandler, ai-worker openai-adapter) uses
 * the SDK default `maxRetries: 2`.
 *
 * Theoretical worst-case billing inflation per ultimate failure:
 *   maxRetries=3 → up to 4 billed requests per logged attempt (1 initial + 3 retries)
 *   maxRetries=2 → up to 3 billed requests per logged attempt (1 initial + 2 retries)
 */
const RETRIES_3_PIPELINES = new Set(['dm_reply', 'comment_reply', 'playground', 'failover']);

function maxRetriesFor(pipeline: string): 2 | 3 {
    return RETRIES_3_PIPELINES.has(pipeline) ? 3 : 2;
}

interface PerPipelineRow {
    pipeline: string;
    model: string;
    attempts: number;
    returns: number;
    logged: number;
    failedByClass: Record<string, number>;
}

async function scanAllAiMetricsKeys(redis: Redis): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
        const [next, batch] = await redis.scan(cursor, 'MATCH', 'metrics:ai:*', 'COUNT', 500);
        keys.push(...batch);
        cursor = next;
    } while (cursor !== '0');
    return keys;
}

async function readCounters(redis: Redis, keys: string[]): Promise<Map<string, number>> {
    if (keys.length === 0) return new Map();
    const pipe = redis.pipeline();
    for (const k of keys) pipe.get(k);
    const results = await pipe.exec();
    const m = new Map<string, number>();
    keys.forEach((k, i) => {
        const v = results?.[i]?.[1];
        m.set(k, typeof v === 'string' ? parseInt(v, 10) || 0 : 0);
    });
    return m;
}

function aggregate(counters: Map<string, number>): PerPipelineRow[] {
    const byKey = new Map<string, PerPipelineRow>();

    for (const [key, count] of counters) {
        const parts = key.split(':');
        // parts[0]='metrics', parts[1]='ai', parts[2]=stage, parts[3]=pipeline, parts[4]=model, parts[5?]=errorClass
        const stage = parts[2];
        const pipeline = parts[3];
        const model = parts[4];
        const rowKey = `${pipeline}::${model}`;
        let row = byKey.get(rowKey);
        if (!row) {
            row = { pipeline, model, attempts: 0, returns: 0, logged: 0, failedByClass: {} };
            byKey.set(rowKey, row);
        }
        if (stage === 'attempts') row.attempts = count;
        else if (stage === 'returns') row.returns = count;
        else if (stage === 'logged') row.logged = count;
        else if (stage === 'failed_before_log') {
            const errorClass = parts.slice(5).join(':') || 'unknown';
            row.failedByClass[errorClass] = count;
        }
    }
    return [...byKey.values()].sort((a, b) => b.attempts - a.attempts);
}

function pct(num: number, den: number): string {
    if (den === 0) return '   n/a';
    return `${((100 * num) / den).toFixed(1).padStart(5)}%`;
}

function fmt(n: number, width: number): string {
    return String(n).padStart(width);
}

function isDirectCall(pipeline: string): boolean {
    return DIRECT_CALL_PIPELINES.has(pipeline);
}

async function main() {
    const redis = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        lazyConnect: true,
    });
    await redis.connect();

    try {
        const keys = await scanAllAiMetricsKeys(redis);
        const counters = await readCounters(redis, keys);
        const rows = aggregate(counters);

        if (rows.length === 0) {
            console.log('No metrics:ai:* keys found. Has Phase 6.5 P1 been deployed yet?');
            return;
        }

        console.log('Phase 6.5 P1 breakdown — counter snapshot');
        console.log(`Total keys scanned: ${keys.length}`);
        console.log('');
        console.log(
            ['pipeline'.padEnd(22), 'model'.padEnd(28),
                'attempts'.padStart(10), 'returns'.padStart(10), 'logged'.padStart(10),
                'A→R gap'.padStart(10), 'R→L gap'.padStart(10),
                'R→L%'.padStart(8), 'type'.padStart(8)].join(' '));
        console.log('-'.repeat(140));

        for (const r of rows) {
            const aToR = r.attempts - r.returns;
            const rToL = r.returns - r.logged;
            const rToLPct = r.attempts > 0 ? (100 * rToL) / r.attempts : 0;
            const flag = rToLPct > 10 ? ' ⚠' : '  ';
            const type = isDirectCall(r.pipeline) ? 'direct' : 'worker';
            console.log([
                r.pipeline.padEnd(22),
                r.model.padEnd(28),
                fmt(r.attempts, 10), fmt(r.returns, 10), fmt(r.logged, 10),
                fmt(aToR, 10), fmt(rToL, 10),
                pct(rToL, r.attempts), type.padStart(6) + flag,
            ].join(' '));
            const errClasses = Object.entries(r.failedByClass);
            if (errClasses.length > 0) {
                const summary = errClasses.map(([cls, n]) => `${cls}=${n}`).join(', ');
                console.log('    failed_before_log: ' + summary);
            }
        }

        console.log('');
        console.log('Top 3 gap contributors (R→L gap = backend log misses):');
        const top = [...rows].sort((a, b) => (b.returns - b.logged) - (a.returns - a.logged)).slice(0, 3);
        top.forEach((r, i) => {
            const gap = r.returns - r.logged;
            console.log(`  ${i + 1}. ${r.pipeline}/${r.model}: ${gap} unlogged returns (${pct(gap, r.attempts).trim()} of attempts)`);
        });

        console.log('');
        console.log('Top 3 SDK-retry / worker-hop signals (A→R gap):');
        const aRTop = [...rows].sort((a, b) => (b.attempts - b.returns) - (a.attempts - a.returns)).slice(0, 3);
        aRTop.forEach((r, i) => {
            const gap = r.attempts - r.returns;
            const kind = isDirectCall(r.pipeline) ? 'SDK silent retries' : 'worker/network failures';
            console.log(`  ${i + 1}. ${r.pipeline}/${r.model}: ${gap} (${kind})`);
        });

        // Retry-inflation tracks. The two OpenAI SDK clients in the codebase
        // use different `maxRetries` settings, so the worst-case billing
        // inflation per ultimate failure differs by track. The script reports
        // each separately so the operator can compare against the OpenAI
        // dashboard request count.
        console.log('');
        console.log('Retry-inflation tracks (compare totals against OpenAI dashboard requests):');
        let mainAttempts = 0, mainReturns = 0;
        let defaultAttempts = 0, defaultReturns = 0;
        for (const r of rows) {
            if (maxRetriesFor(r.pipeline) === 3) {
                mainAttempts += r.attempts; mainReturns += r.returns;
            } else {
                defaultAttempts += r.attempts; defaultReturns += r.returns;
            }
        }
        const totalAttempts = mainAttempts + defaultAttempts;
        // Worst case = every call retries the full budget. Real inflation will
        // be much smaller (most calls succeed on first try) — this is the
        // ceiling, not an estimate.
        const mainCeiling = mainAttempts * 4;
        const defaultCeiling = defaultAttempts * 3;
        console.log(`  main reply path (ai-worker openai.ts, maxRetries=3):`);
        console.log(`    pipelines: ${[...RETRIES_3_PIPELINES].join(', ')}`);
        console.log(`    attempts=${mainAttempts}  returns=${mainReturns}  ceiling=${mainCeiling} billed requests`);
        console.log(`  default-retries paths (six other clients, maxRetries=2):`);
        console.log(`    attempts=${defaultAttempts}  returns=${defaultReturns}  ceiling=${defaultCeiling} billed requests`);
        console.log('');
        console.log(`  total attempts (script-side):       ${totalAttempts}`);
        console.log(`  worst-case ceiling (both tracks):   ${mainCeiling + defaultCeiling}`);
        console.log('  → compare `total attempts` against OpenAI dashboard requests for the same window.');
        console.log('    if dashboard ≈ attempts: retries are minimal, the gap is unlogged call sites.');
        console.log('    if dashboard >> attempts: retries explain the gap (compare to ceiling for severity).');
    } finally {
        await redis.quit();
    }
}

main().catch((err) => {
    console.error('phase6_5_breakdown failed:', err);
    process.exit(1);
});
