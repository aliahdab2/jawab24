/**
 * Stage 2.6.1 / Option B one-shot migration:
 * promote `business_profile.suggestions` into `business_profile.merchant`
 * with per-field provenance for pages written before Option B landed.
 *
 * This is a MANUAL script (not a Drizzle auto-migration) because it
 * modifies 42 prod rows with complex shape-classified logic. Visibility
 * > convenience.
 *
 * Usage:
 *   # Inspect what WOULD change (no writes):
 *   DATABASE_URL=... npx tsx scripts/promote-business-profile-fb-sync.ts --dry-run
 *
 *   # Apply for real (requires explicit --apply):
 *   DATABASE_URL=... npx tsx scripts/promote-business-profile-fb-sync.ts --apply
 *
 *   # Limit to a single page (works in both modes):
 *   DATABASE_URL=... npx tsx scripts/promote-business-profile-fb-sync.ts --dry-run --page-id <uuid>
 *
 * Idempotent: rows that already have `merchantProvenance` set are skipped.
 *
 * What it does per affected row:
 *   - shape='container' && merchant={}, suggestions populated:
 *       promote each non-empty suggestions field into merchant with
 *       provenance { source: 'fb_sync', confirmedAt: null }.
 *   - shape='container' && merchant populated:
 *       backfill provenance as { source: 'editor', confirmedAt: null } for
 *       every existing merchant field. Values UNTOUCHED. No fb_sync
 *       promotion (merchant already has those fields).
 *   - shape='legacy_flat':
 *       wrap into a container. Treat the flat data as suggestions, and
 *       promote into merchant with fb_sync provenance.
 *
 * Cache invalidation: bumps kb_version AND kb_active_version per
 * pages.ts:invalidatePageCaches contract. Orphaned cache:ai_reply:*
 * entries expire on their existing 30-day TTL — no SCAN+DEL needed.
 */

import postgres from 'postgres';
import {
    classifyForMigration,
    formatBusinessInfoPrompt,
    type StoredBusinessProfile,
} from '@jawab24/shared';

interface Args {
    dryRun: boolean;
    apply: boolean;
    pageId: string | null;
}

function parseArgs(): Args {
    const argv = process.argv.slice(2);
    const args: Args = {
        dryRun: argv.includes('--dry-run'),
        apply: argv.includes('--apply'),
        pageId: null,
    };
    const idIdx = argv.indexOf('--page-id');
    if (idIdx >= 0 && argv[idIdx + 1]) args.pageId = argv[idIdx + 1];
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

async function main() {
    const args = parseArgs();
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
        console.error('DATABASE_URL required');
        process.exit(2);
    }

    const sql = postgres(dbUrl, { prepare: false });

    const rows = args.pageId
        ? await sql<{ id: string; name: string; business_profile: unknown; kb_active_version: number | null }[]>`
            SELECT id, name, business_profile, kb_active_version
            FROM pages
            WHERE id = ${args.pageId} AND business_profile IS NOT NULL`
        : await sql<{ id: string; name: string; business_profile: unknown; kb_active_version: number | null }[]>`
            SELECT id, name, business_profile, kb_active_version
            FROM pages
            WHERE business_profile IS NOT NULL`;

    let skipped = 0;
    const promoteFbSync: typeof rows = [];
    const backfillEditor: typeof rows = [];
    const wrapLegacy: typeof rows = [];
    const wouldBeEmptyBlock: { id: string; name: string; kind: string }[] = [];

    console.log(`Mode: ${args.dryRun ? 'DRY-RUN (no writes)' : 'APPLY'}`);
    console.log(`Scanning ${rows.length} page row(s)…\n`);

    for (const row of rows) {
        const plan = classifyForMigration(row.business_profile as StoredBusinessProfile);

        if (plan.kind === 'skip') {
            skipped++;
            continue;
        }

        // Bucket for summary
        if (plan.kind === 'promote_fb_sync') promoteFbSync.push(row);
        else if (plan.kind === 'backfill_editor') backfillEditor.push(row);
        else if (plan.kind === 'wrap_legacy') wrapLegacy.push(row);

        // Would BUSINESS_INFO go non-null after this migration?
        const wouldEmitBlock = formatBusinessInfoPrompt(plan.newContainer.merchant ?? null) !== null;
        if (!wouldEmitBlock) {
            wouldBeEmptyBlock.push({ id: row.id, name: row.name, kind: plan.kind });
        }

        const label = `[${plan.kind}] ${row.id}  "${row.name.slice(0, 40)}"`;
        const blockMark = wouldEmitBlock ? 'block=YES' : 'block=NO  ⚠';
        if (plan.kind === 'promote_fb_sync' || plan.kind === 'wrap_legacy') {
            console.log(`${label}  → promoting: ${plan.promotedFields.join(', ')}  [${blockMark}]`);
        } else if (plan.kind === 'backfill_editor') {
            console.log(`${label}  → backfilling editor provenance: ${plan.backfilledFields.join(', ')}  [${blockMark}]`);
        }

        if (args.apply) {
            await sql`
                UPDATE pages SET
                  business_profile = ${plan.newContainer as unknown as object}::jsonb,
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
  promote_fb_sync (container, merchant={} + suggestions populated): ${promoteFbSync.length}
  wrap_legacy     (legacy flat with data):                          ${wrapLegacy.length}
  backfill_editor (container, merchant already populated):          ${backfillEditor.length}
  skipped         (already migrated, empty, or nothing to do):      ${skipped}
  total scanned:                                                    ${rows.length}
  pages where BUSINESS_INFO block would still be empty after:       ${wouldBeEmptyBlock.length}${wouldBeEmptyBlock.length > 0 ? ' ⚠' : ''}
────────────────────────────────────────────────────────────`);

    if (wouldBeEmptyBlock.length > 0) {
        console.log('\n⚠ Pages where promotion would NOT produce a non-null BUSINESS_INFO block:');
        for (const p of wouldBeEmptyBlock) {
            console.log(`  [${p.kind}] ${p.id}  "${p.name.slice(0, 50)}"`);
        }
        console.log('  These pages have data outside the {address, phones, hours, policies} signal set');
        console.log('  (e.g. only name/category/website) — promotion is still correct, but the AI\'s');
        console.log('  BUSINESS_INFO block stays empty because formatBusinessInfoPrompt requires at');
        console.log('  least one signal field.\n');
    }

    console.log(args.dryRun ? '⚠  DRY-RUN — no writes made. Re-run with --apply to commit.\n' : '✓  APPLIED.\n');

    await sql.end();
}

main().catch(e => { console.error(e); process.exit(1); });
