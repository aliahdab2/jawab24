/**
 * AI cost & cache-hit breakdown — read-only diagnostic over `ai_usage_log`.
 *
 * Answers "where does the OpenAI spend go, and how well are the caches working?"
 * per pipeline, so cost changes can be judged against a measured baseline (e.g.
 * before/after deploying the KB prompt-cache layering, or flipping a flag).
 *
 * Run (locally, with DATABASE_URL set):
 *   npx tsx scripts/ai_cost_breakdown.ts [--days=7]
 *
 * Or against prod (read-only — SELECT only, safe to run anytime):
 *   ssh -i ~/.ssh/id_jawab24_deploy root@91.99.95.196 \
 *     'docker exec jawab24-postgres psql -U postgres -d jawab24 -f -' < this-query
 *   …or point DATABASE_URL at the prod connection string and run as above.
 *
 * Two INDEPENDENT cache axes (do not conflate — see AI_INSTRUCTIONS.md §13c):
 *   - `cached = true`            → internal exact/semantic hit. No OpenAI call at
 *                                  all (zero cost). Such rows have
 *                                  cached_input_tokens = 0.
 *   - `cached_input_tokens > 0`  → OpenAI's prompt-cache discounted part of a REAL
 *                                  call (billed at the model's cached rate, ~75%
 *                                  off on gpt-4.1-mini).
 * So the OpenAI prompt-cache rate is measured ONLY over `cached = false` rows —
 * folding internal hits into the denominator would understate it.
 *
 * Cost is the pre-computed per-row `cost_usd` (estimateCostUsd, per-model cached
 * rates, aiPricing.ts). We SUM it rather than recompute, and filter to the
 * current pricing schema (`pricing_version = 'v2'`) so historical rows priced
 * under an older schema can't skew the comparison.
 *
 * `workspace_id` is intentionally NOT a grouping dimension: logAiUsage never
 * writes it, so it is always NULL. pipeline / model / page_id / user_id are
 * populated and usable.
 */
import { sql } from 'drizzle-orm';
import { db, client } from '../backend/src/db';

const PRICING_VERSION = 'v2';

interface BreakdownRow {
    day?: string;
    pipeline: string | null;
    calls: number;
    internal_hits: number;
    openai_calls: number;
    prompt_cache_hits: number;
    avg_cached_ratio: number | null;
    avg_tokens_in: number | null;
    avg_tokens_out: number | null;
    total_cost_usd: number;
}

function parseDays(): number {
    const arg = process.argv.find((a) => a.startsWith('--days='));
    const n = arg ? parseInt(arg.split('=')[1], 10) : 7;
    return Number.isFinite(n) && n > 0 ? n : 7;
}

/** Coerce postgres-js aggregate output (bigint→string, numeric→string) to a number. */
function num(v: unknown): number {
    if (v === null || v === undefined) return 0;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

/** Same coercion but preserves null (for averages over an empty cached=false set). */
function numOrNull(v: unknown): number | null {
    if (v === null || v === undefined) return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
}

/**
 * The shared aggregate SELECT. `byDay` toggles the date_trunc dimension so the
 * same conditional-aggregate logic backs both the daily table and the
 * whole-window roll-up.
 */
async function runBreakdown(days: number, byDay: boolean): Promise<BreakdownRow[]> {
    const dayExpr = byDay ? sql`date_trunc('day', created_at) AS day,` : sql``;
    const groupBy = byDay ? sql`GROUP BY day, pipeline` : sql`GROUP BY pipeline`;
    const orderBy = byDay
        ? sql`ORDER BY day DESC, total_cost_usd DESC`
        : sql`ORDER BY total_cost_usd DESC`;

    const rows = await db.execute(sql`
        SELECT
          ${dayExpr}
          pipeline,
          count(*)                                                        AS calls,
          count(*) FILTER (WHERE cached)                                  AS internal_hits,
          count(*) FILTER (WHERE NOT cached)                              AS openai_calls,
          count(*) FILTER (WHERE NOT cached AND cached_input_tokens > 0)  AS prompt_cache_hits,
          avg(cached_input_tokens::float / NULLIF(tokens_in, 0)) FILTER (WHERE NOT cached) AS avg_cached_ratio,
          avg(tokens_in)  FILTER (WHERE NOT cached)                       AS avg_tokens_in,
          avg(tokens_out) FILTER (WHERE NOT cached)                       AS avg_tokens_out,
          sum(cost_usd)                                                   AS total_cost_usd
        FROM ai_usage_log
        WHERE created_at >= now() - (${days} * interval '1 day')
          AND pricing_version = ${PRICING_VERSION}
        ${groupBy}
        ${orderBy}
    `);

    return (rows as unknown as Record<string, unknown>[]).map((r) => ({
        day: byDay ? new Date(r.day as string).toISOString().slice(0, 10) : undefined,
        pipeline: (r.pipeline as string) ?? null,
        calls: num(r.calls),
        internal_hits: num(r.internal_hits),
        openai_calls: num(r.openai_calls),
        prompt_cache_hits: num(r.prompt_cache_hits),
        avg_cached_ratio: numOrNull(r.avg_cached_ratio),
        avg_tokens_in: numOrNull(r.avg_tokens_in),
        avg_tokens_out: numOrNull(r.avg_tokens_out),
        total_cost_usd: num(r.total_cost_usd),
    }));
}

function pct(num: number, den: number): string {
    if (den === 0) return '    n/a';
    return `${((100 * num) / den).toFixed(1).padStart(5)}%`;
}

function ratioPct(ratio: number | null): string {
    if (ratio === null) return '    n/a';
    return `${(100 * ratio).toFixed(1).padStart(5)}%`;
}

function fmt(n: number | null, width: number, decimals = 0): string {
    if (n === null) return 'n/a'.padStart(width);
    return n.toFixed(decimals).padStart(width);
}

const HEADER = [
    'pipeline'.padEnd(20),
    'calls'.padStart(8),
    'intCache%'.padStart(10),  // internal exact/semantic hit rate (zero-cost)
    'oaiCalls'.padStart(9),    // real OpenAI calls (cached=false)
    'pcHit%'.padStart(8),      // OpenAI prompt-cache hit rate over real calls
    'pcRatio'.padStart(8),     // avg cached_input/tokens_in over real calls
    'tokIn'.padStart(8),
    'tokOut'.padStart(8),
    'cost($)'.padStart(11),
].join(' ');

function printRow(r: BreakdownRow): void {
    console.log([
        (r.pipeline ?? '(null)').padEnd(20),
        fmt(r.calls, 8),
        pct(r.internal_hits, r.calls).padStart(10),
        fmt(r.openai_calls, 9),
        pct(r.prompt_cache_hits, r.openai_calls).padStart(8),
        ratioPct(r.avg_cached_ratio).padStart(8),
        fmt(r.avg_tokens_in, 8),
        fmt(r.avg_tokens_out, 8),
        fmt(r.total_cost_usd, 11, 4),
    ].join(' '));
}

async function main() {
    const days = parseDays();

    console.log(`AI cost & cache-hit breakdown — last ${days} day(s), pricing_version=${PRICING_VERSION}`);
    console.log('Columns: intCache% = internal exact/semantic hits (zero cost) | '
        + 'pcHit%/pcRatio = OpenAI prompt-cache, measured over real (cached=false) calls only');
    console.log('');

    const rollup = await runBreakdown(days, false);

    if (rollup.length === 0) {
        console.log('No ai_usage_log rows in window (check DATABASE_URL / pricing_version / time range).');
        return;
    }

    // Whole-window roll-up first — the headline numbers.
    console.log(`=== Whole-window roll-up (${days}d) ===`);
    console.log(HEADER);
    console.log('-'.repeat(HEADER.length));
    let totalCalls = 0, totalInternal = 0, totalOpenai = 0, totalPcHits = 0, totalCost = 0;
    for (const r of rollup) {
        printRow(r);
        totalCalls += r.calls;
        totalInternal += r.internal_hits;
        totalOpenai += r.openai_calls;
        totalPcHits += r.prompt_cache_hits;
        totalCost += r.total_cost_usd;
    }
    console.log('-'.repeat(HEADER.length));
    console.log([
        'TOTAL'.padEnd(20),
        fmt(totalCalls, 8),
        pct(totalInternal, totalCalls).padStart(10),
        fmt(totalOpenai, 9),
        pct(totalPcHits, totalOpenai).padStart(8),
        ''.padStart(8),
        ''.padStart(8),
        ''.padStart(8),
        fmt(totalCost, 11, 4),
    ].join(' '));

    // Per-day trend — so the pre/post-deploy boundary is visible.
    const daily = await runBreakdown(days, true);
    console.log('');
    console.log(`=== Per-day x pipeline ===`);
    let currentDay = '';
    for (const r of daily) {
        if (r.day !== currentDay) {
            currentDay = r.day ?? '';
            console.log('');
            console.log(`[${currentDay}]`);
            console.log(HEADER);
            console.log('-'.repeat(HEADER.length));
        }
        printRow(r);
    }

    console.log('');
    console.log('Reading it:');
    console.log('  - High intCache% + low cost  → exact/semantic cache is doing its job (comment_reply).');
    console.log('  - Low intCache% (dm_reply)   → history bypasses internal caches; spend lands here.');
    console.log('  - pcHit%/pcRatio rising      → OpenAI prompt-cache warming (KB-hoist deploy working).');
    console.log('  - pcHit% ~0 on a big-tokIn pipeline → prefix not cached (cold pages / pre-hoist prod).');
}

main()
    .catch((err) => {
        console.error('ai_cost_breakdown failed:', err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await client.end({ timeout: 5 });
    });
