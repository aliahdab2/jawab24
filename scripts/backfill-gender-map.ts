/**
 * One-off backfill: pre-warm the v53 fleet-learned name→gender map
 * (backend/src/services/genderMap.ts) by classifying the distinct historical
 * DM first names with a small model call, so the g:m/g:f exact-cache buckets
 * finally engage. The passive path learns from live reply labels only —
 * ~88 names in 5 days against 500–800 DMs/day of long-tail Arabic names, so
 * getConfidentGender almost never opens and DM traffic stays per-name-keyed
 * (v51 behavior, ~0% cache hits).
 *
 * Mechanism compliance (D-015): this is MODEL inference, memoized in the same
 * Redis counters the passive path uses — not a hand-maintained name lexicon.
 * Ambiguous/unisex names (نور، جود) classify `unknown` and get NOTHING
 * written: those readers keep today's fresh-generation behavior forever.
 *
 * Safety properties:
 *   - skip-if-exists: names with ANY existing counters (organic or previously
 *     seeded) are never touched → re-runs are cheap and idempotent, organic
 *     learning is never stomped (enforced inside seedGenderObservation).
 *   - seed = exactly MIN_OBSERVATIONS (5): one contrary organic observation
 *     drops the majority below 0.9 and confidence breaks back to the safe
 *     per-name bucket — a wrong seed self-heals.
 *   - 90-day TTL (same as organic): names with live traffic refresh forever;
 *     silent names lapse and become eligible again on a later re-run.
 *     Suggested cadence: quarterly, or after large merchant onboarding.
 *
 * Usage (review the dry-run WITH the owner before applying):
 *   DATABASE_URL=... REDIS_HOST=... REDIS_PASSWORD=... OPENAI_API_KEY=... \
 *     npx tsx scripts/backfill-gender-map.ts --dry-run --limit 100 --user-id <admin-uuid>
 *   ... --dry-run --user-id <admin-uuid>          # full dry-run (classifies, writes nothing)
 *   ... --apply   --user-id <admin-uuid>          # classify + seed
 *
 * --user-id is REQUIRED: cost rows land in ai_usage_log (NOT NULL user_id)
 * under pipeline 'gender_name_backfill' — bill the ops/admin account.
 * Cost: ~2,000 names ≈ 40 batched calls ≈ $0.02–0.05 on gpt-4.1-mini.
 */

import postgres from 'postgres';
import { makeTrackedOpenAI } from '../backend/src/services/openaiClient';
import {
    firstNameOf,
    genderNameKeyHash,
    hasGenderObservations,
    seedGenderObservation,
} from '../backend/src/services/genderMap';
import { classifyNamesBatch, type NameClassification } from '../backend/src/services/genderNameClassifier';
import { redis } from '../backend/src/lib/redis';

interface Args {
    dryRun: boolean;
    apply: boolean;
    limit: number;
    batchSize: number;
    model: string;
    userId: string | null;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const flagValue = (flag: string): string | null => {
        const i = argv.indexOf(flag);
        return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
    };
    const args: Args = {
        dryRun: argv.includes('--dry-run'),
        apply: argv.includes('--apply'),
        limit: parseInt(flagValue('--limit') || '2000', 10),
        batchSize: parseInt(flagValue('--batch-size') || '50', 10),
        model: flagValue('--model') || 'gpt-4.1-mini',
        userId: flagValue('--user-id'),
    };
    if (!args.dryRun && !args.apply) {
        console.error('Specify --dry-run OR --apply.');
        process.exit(2);
    }
    if (args.dryRun && args.apply) {
        console.error('--dry-run and --apply are mutually exclusive.');
        process.exit(2);
    }
    if (!args.userId) {
        console.error('--user-id <uuid> required (ai_usage_log attribution — use the ops/admin account).');
        process.exit(2);
    }
    // ai_usage_log.user_id is a NOT NULL FK; logAiUsage is fire-and-forget, so
    // a typo'd id would silently drop every cost row while the run proceeds.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.userId)) {
        console.error(`--user-id "${args.userId}" is not a valid UUID.`);
        process.exit(2);
    }
    if (!args.model.startsWith('gpt-')) {
        console.error(`--model must be a gpt-* model (got "${args.model}").`);
        process.exit(2);
    }
    return args;
}

interface NameGroup {
    /** Most frequent raw first-token variant — what the classifier sees. */
    display: string;
    /** Sum of conversation counts across spelling variants (same key hash). */
    total: number;
    displayCount: number;
}

async function main() {
    const args = parseArgs();
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) { console.error('DATABASE_URL required'); process.exit(2); }
    if (!process.env.OPENAI_API_KEY) { console.error('OPENAI_API_KEY required'); process.exit(2); }

    const sql = postgres(dbUrl, { max: 1 });

    // DM sender names only — conversations are DM threads by definition, and
    // the gender map is read exclusively on the DM cache path.
    const rows = await sql<{ sender_name: string; n: string }[]>`
        SELECT sender_name, COUNT(*) AS n
        FROM conversations
        WHERE sender_name IS NOT NULL AND sender_name != ''
        GROUP BY sender_name
    `;
    console.log(`🔍 ${rows.length} distinct sender names in conversations`);

    // Aggregate spelling variants by the SAME hash the map uses, keeping the
    // most frequent raw variant as the display/classification form.
    const groups = new Map<string, NameGroup>();
    for (const row of rows) {
        const hash = genderNameKeyHash(row.sender_name);
        if (!hash) continue;
        const display = firstNameOf(row.sender_name);
        const n = parseInt(row.n, 10) || 0;
        const existing = groups.get(hash);
        if (!existing) {
            groups.set(hash, { display, total: n, displayCount: n });
        } else {
            existing.total += n;
            if (n > existing.displayCount) { existing.display = display; existing.displayCount = n; }
        }
    }

    const ranked = [...groups.values()].sort((a, b) => b.total - a.total).slice(0, args.limit);
    console.log(`   → ${groups.size} distinct first names, considering top ${ranked.length}`);

    // Memoization: skip names the map already knows (organic or prior seed).
    const candidates: NameGroup[] = [];
    let skippedExisting = 0;
    for (const group of ranked) {
        if (await hasGenderObservations(group.display)) skippedExisting++;
        else candidates.push(group);
    }
    console.log(`   → ${skippedExisting} already in the map (skipped), ${candidates.length} to classify`);

    const client = makeTrackedOpenAI(process.env.OPENAI_API_KEY, {
        userId: args.userId as string,
        pipeline: 'gender_name_backfill',
    });

    const classified: (NameClassification & { total: number })[] = [];
    let apiCalls = 0;
    for (let i = 0; i < candidates.length; i += args.batchSize) {
        const batch = candidates.slice(i, i + args.batchSize);
        const results = await classifyNamesBatch(client, args.model, batch.map(b => b.display));
        apiCalls++;
        for (let j = 0; j < results.length; j++) {
            classified.push({ ...results[j], total: batch[j].total });
        }
        // Gentle pacing — 40 calls for 2k names, nowhere near rate limits.
        await new Promise(resolve => setTimeout(resolve, 200));
        if (apiCalls % 10 === 0) console.log(`   … ${Math.min(i + args.batchSize, candidates.length)}/${candidates.length} classified`);
    }

    let seededM = 0;
    let seededF = 0;
    let unknown = 0;
    let raced = 0;
    console.log('');
    console.log(args.dryRun ? '── DRY RUN — would seed: ──' : '── Seeding: ──');
    for (const item of classified) {
        if (item.gender === 'unknown') {
            unknown++;
            // The dry-run review gate exists to eyeball EXACTLY these: unisex
            // names (نور، جود) must land here — hiding them would hide the one
            // failure mode the owner review is meant to catch.
            if (args.dryRun) console.log(`   ?  ${String(item.total).padStart(5)}×  ${item.name}  (unknown — nothing written)`);
            continue;
        }
        if (args.apply) {
            const outcome = await seedGenderObservation(item.name, item.gender);
            if (outcome === 'seeded') { if (item.gender === 'm') seededM++; else seededF++; }
            else raced++; // learned organically between the skip-check and now — fine
        } else {
            if (item.gender === 'm') seededM++; else seededF++;
        }
        console.log(`   ${item.gender}  ${String(item.total).padStart(5)}×  ${item.name}`);
    }

    const summary = {
        namesConsidered: ranked.length,
        skippedExisting,
        classified: classified.length,
        [args.dryRun ? 'wouldSeedM' : 'seededM']: seededM,
        [args.dryRun ? 'wouldSeedF' : 'seededF']: seededF,
        unknown,
        raced,
        apiCalls,
        model: args.model,
    };
    console.log('');
    console.log(`${args.dryRun ? '🔎 Dry-run' : '✅ Apply'} summary: ${JSON.stringify(summary)}`);

    await sql.end();
    await redis.quit();
}

main()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Backfill failed:', err);
        process.exit(1);
    });
