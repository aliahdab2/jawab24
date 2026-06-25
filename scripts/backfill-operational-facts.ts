/**
 * One-time backfill: extract structured operational facts (hours / address /
 * phones) from each page's free-text knowledge base and promote them into
 * `business_profile.merchant` so the authoritative BUSINESS_INFO prompt block
 * carries them — instead of the AI improvising from mis-chunked free text.
 *
 * This fixes merchants whose hours/address live ONLY in the free-text KB and
 * never came from Facebook (the Damascus-institute class of pages). Companion
 * to the FB-sync path (`promote-business-profile-fb-sync.ts`); same provenance
 * model, different source.
 *
 * Usage:
 *   # Inspect what WOULD change (no writes) — start with the institute:
 *   DATABASE_URL=... OPENAI_API_KEY=... npx tsx scripts/backfill-operational-facts.ts --dry-run --page-id <uuid>
 *
 *   # Whole DB dry-run, then apply:
 *   DATABASE_URL=... OPENAI_API_KEY=... npx tsx scripts/backfill-operational-facts.ts --dry-run
 *   DATABASE_URL=... OPENAI_API_KEY=... npx tsx scripts/backfill-operational-facts.ts --apply
 *
 *   # Pin a stronger extraction model for the one-time run (accuracy paid once):
 *   ... --apply --model gpt-4.1
 *
 * Safety:
 *   - fill-ONLY-empty: `applyKbExtractToMerchant` never overwrites an `editor`
 *     or `fb_sync` value (see businessProfileMerge.ts). A re-run only refreshes
 *     previously kb_extract fields.
 *   - hours are hard-validated (`canonicalizeHoursWeek` inside the extractor);
 *     an unparseable value is dropped, never stored.
 *   - rows with no KB text, or where extraction yields nothing new, are skipped.
 *   - cache invalidation: bumps kb_version + kb_active_version (the
 *     pages.ts:invalidatePageCaches contract — business_profile is prompt-injected).
 */

import postgres from 'postgres';
import {
    unwrapBusinessProfile,
    applyKbExtractToMerchant,
    formatBusinessInfoPrompt,
    type StoredBusinessProfile,
    type BusinessProfile,
    type BusinessProfileContainer,
} from '@jawab24/shared';
import { operationalFactsExtractor } from '../backend/src/services/kb/operationalFactsExtractor';

interface Args {
    dryRun: boolean;
    apply: boolean;
    pageId: string | null;
    model: string | null;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const args: Args = {
        dryRun: argv.includes('--dry-run'),
        apply: argv.includes('--apply'),
        pageId: null,
        model: null,
    };
    const idIdx = argv.indexOf('--page-id');
    if (idIdx >= 0 && argv[idIdx + 1]) args.pageId = argv[idIdx + 1];
    const mIdx = argv.indexOf('--model');
    if (mIdx >= 0 && argv[mIdx + 1]) args.model = argv[mIdx + 1];
    if (!args.dryRun && !args.apply) {
        console.error('Specify --dry-run OR --apply.');
        process.exit(2);
    }
    if (args.dryRun && args.apply) {
        console.error('--dry-run and --apply are mutually exclusive.');
        process.exit(2);
    }
    return args;
}

interface PageRow {
    id: string;
    name: string;
    user_id: string | null;
    knowledge_base: string | null;
    business_profile: unknown;
}

/**
 * Summarize the fields ACTUALLY promoted — i.e. where the new merchant value
 * differs from the old. Shows the review gate exactly what will be written,
 * not the raw extractor output (some of which precedence may have skipped
 * because an editor/fb_sync value already owns the field).
 */
function describePromoted(oldM: BusinessProfile, newM: BusinessProfile): string {
    const parts: string[] = [];
    if (newM.hours && JSON.stringify(newM.hours) !== JSON.stringify(oldM.hours)) {
        parts.push(`hours{${Object.entries(newM.hours).map(([d, v]) => `${d}:${v.join('/')}`).join(' ')}}`);
    }
    if (newM.address && newM.address !== oldM.address) parts.push(`address="${newM.address.slice(0, 60)}"`);
    if (newM.phones && JSON.stringify(newM.phones) !== JSON.stringify(oldM.phones)) parts.push(`phones=[${newM.phones.join(', ')}]`);
    return parts.length ? parts.join('  ') : '(provenance only — no value change)';
}

async function main() {
    const args = parseArgs();
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL required');
        process.exit(2);
    }
    if (!process.env.OPENAI_API_KEY) {
        console.error('OPENAI_API_KEY required (extraction is an OpenAI call)');
        process.exit(2);
    }

    const sql = postgres(dbUrl, { prepare: false });

    const rows = args.pageId
        ? await sql<PageRow[]>`
            SELECT id, name, user_id, knowledge_base, business_profile
            FROM pages
            WHERE id = ${args.pageId}`
        : await sql<PageRow[]>`
            SELECT id, name, user_id, knowledge_base, business_profile
            FROM pages
            WHERE knowledge_base IS NOT NULL AND length(trim(knowledge_base)) > 0`;

    console.log(`Mode: ${args.dryRun ? 'DRY-RUN (no writes)' : 'APPLY'}${args.model ? `  model=${args.model}` : ''}`);
    console.log(`Scanning ${rows.length} page row(s)…  (one OpenAI extraction call per page that needs it)\n`);

    let filled = 0;
    let noFacts = 0;
    let noChange = 0;
    let skippedNoKb = 0;
    let skippedNoUser = 0;
    let alreadyComplete = 0;
    let llmCalls = 0;
    let first = true;

    for (const row of rows) {
        const kb = (row.knowledge_base || '').trim();
        if (!kb) { skippedNoKb++; continue; }

        const container = unwrapBusinessProfile(row.business_profile as StoredBusinessProfile);
        const existing = container.merchant ?? {};
        // Cost / idempotency guard: if the merchant already has all three
        // operational fields, the fill-only-empty merge can't add anything —
        // skip the LLM call. Makes re-runs cheap and avoids wasted spend.
        if (existing.hours && existing.address && existing.phones) {
            alreadyComplete++;
            continue;
        }

        // Without a user_id the OpenAI spend can't be attributed: the tracked
        // client trips the §13c MissingUserId guard → failed_before_log, so the
        // cost lands with no ai_usage_log row. Skip so a billed run stays visible.
        if (!row.user_id) {
            skippedNoUser++;
            console.warn(`[skip] ${row.id}  "${row.name.slice(0, 40)}" — no user_id; skipping (extraction cost would be unattributed)`);
            continue;
        }

        // Gentle pacing between API calls (skip the very first).
        if (!first) await new Promise(r => setTimeout(r, 150));
        first = false;
        llmCalls++;

        const extracted = await operationalFactsExtractor.extract(kb, {
            userId: row.user_id,
            pageId: row.id,
            model: args.model ?? undefined,
        }) as BusinessProfile;

        if (!extracted.hours && !extracted.address && !extracted.phones) {
            noFacts++;
            continue;
        }

        const { merchant, merchantProvenance } = applyKbExtractToMerchant(
            container.merchant,
            container.merchantProvenance,
            extracted,
        );

        // fill-only-empty: detect whether anything actually changed.
        const before = JSON.stringify({ m: container.merchant ?? {}, p: container.merchantProvenance ?? {} });
        const after = JSON.stringify({ m: merchant, p: merchantProvenance });
        if (before === after) { noChange++; continue; }

        // Spread the unwrapped container first so any future top-level key is
        // preserved; override only the two halves we recompute.
        const newContainer: BusinessProfileContainer = {
            ...container,
            merchant,
            merchantProvenance,
        };
        const blockMark = formatBusinessInfoPrompt(merchant) !== null ? 'block=YES' : 'block=NO ⚠';

        filled++;
        console.log(`[fill] ${row.id}  "${row.name.slice(0, 40)}"  [${blockMark}]`);
        console.log(`       promoting: ${describePromoted(container.merchant ?? {}, merchant)}`);

        if (args.apply) {
            await sql`
                UPDATE pages SET
                  business_profile = ${newContainer as unknown as object}::jsonb,
                  business_profile_updated_at = NOW(),
                  kb_version = COALESCE(kb_version, 0) + 1,
                  kb_active_version = COALESCE(kb_active_version, 0) + 1,
                  kb_updated_at = NOW(),
                  updated_at = NOW()
                WHERE id = ${row.id}
            `;
        }
    }

    console.log(`
────────────────────────────────────────────────────────────
Summary:
  filled          (structured facts promoted into merchant): ${filled}
  no_facts        (extractor found no hours/address/phones):  ${noFacts}
  no_change       (facts already present / editor-owned):     ${noChange}
  already_complete(merchant had hours+address+phones; skipped LLM): ${alreadyComplete}
  skipped_no_kb   (empty knowledge base):                     ${skippedNoKb}
  skipped_no_user (null user_id; cost unattributable):        ${skippedNoUser}
  total scanned:                                              ${rows.length}
  OpenAI extraction calls made:                               ${llmCalls}
────────────────────────────────────────────────────────────`);
    console.log(args.dryRun ? '⚠  DRY-RUN — no writes made. Re-run with --apply to commit.\n' : '✓  APPLIED.\n');

    await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
