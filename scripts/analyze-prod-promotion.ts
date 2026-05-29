/**
 * Read-only offline analyzer for Option B prod promotion.
 *
 * Operates on a JSON dump of `pages` rows (id, name, business_profile)
 * to avoid needing a postgres tunnel. Produces the per-page report the
 * dry-run gate requires: shape, fields to promote, would-emit-block,
 * plus aggregate counts and anomaly list.
 *
 * Usage:
 *   docker exec jawab24-postgres psql -U postgres -d jawab24 -t -A -c \
 *     "SELECT json_agg(json_build_object('id', id, 'name', name, \
 *      'business_profile', business_profile)) FROM pages \
 *      WHERE business_profile IS NOT NULL;" > /tmp/prod-pages.json
 *   npx tsx scripts/analyze-prod-promotion.ts /tmp/prod-pages.json
 */

import fs from 'fs';
import {
    classifyForMigration,
    formatBusinessInfoPrompt,
    type StoredBusinessProfile,
} from '@jawab24/shared';

interface RawRow {
    id: string;
    name: string;
    business_profile: unknown;
}

// Reporting shape — distinguishes the three actionable plans plus the
// two flavors of skip plus an anomaly bucket. Maps from the shared
// classifier's MigrationPlan ('skip'/'promote_fb_sync'/'wrap_legacy'/
// 'backfill_editor') to the human-readable bucket the report groups by.
type Shape = 'container_empty_merchant' | 'container_merchant_populated'
    | 'legacy_flat_with_data' | 'container_already_migrated'
    | 'empty_or_skip' | 'anomaly';

interface Analyzed {
    id: string;
    name: string;
    shape: Shape;
    promotedFields: string[];
    backfilledFields: string[];
    wouldEmitBlock: boolean;
    notes: string[];
}

function analyze(row: RawRow): Analyzed {
    const raw = row.business_profile;
    const plan = classifyForMigration(raw as StoredBusinessProfile);

    // Storage-layer note (orthogonal to the plan)
    const notes: string[] = [];
    if (typeof raw === 'string') notes.push('stored as jsonb-string (double-encoded)');

    const base = { id: row.id, name: row.name };

    if (plan.kind === 'skip' && plan.reason === 'already_migrated') {
        return {
            ...base, shape: 'container_already_migrated',
            promotedFields: [], backfilledFields: [],
            wouldEmitBlock: false, // not relevant; row is untouched
            notes: ['already has merchantProvenance — will be skipped'],
        };
    }
    if (plan.kind === 'skip' && plan.reason === 'no_data') {
        return {
            ...base, shape: 'empty_or_skip',
            promotedFields: [], backfilledFields: [],
            wouldEmitBlock: false,
            notes: ['no signal data — will be skipped'],
        };
    }
    if (plan.kind === 'skip') { // anomaly
        return {
            ...base, shape: 'anomaly',
            promotedFields: [], backfilledFields: [],
            wouldEmitBlock: false,
            notes: [`unexpected shape; ${plan.details ?? ''}`],
        };
    }

    const wouldEmitBlock = formatBusinessInfoPrompt(plan.newContainer.merchant ?? null) !== null;
    const shape: Shape = plan.kind === 'wrap_legacy' ? 'legacy_flat_with_data'
        : plan.kind === 'promote_fb_sync' ? 'container_empty_merchant'
        : 'container_merchant_populated';

    return {
        ...base, shape,
        promotedFields: plan.kind === 'backfill_editor' ? [] : plan.promotedFields,
        backfilledFields: plan.kind === 'backfill_editor' ? plan.backfilledFields : [],
        wouldEmitBlock,
        notes,
    };
}

function main() {
    const path = process.argv[2];
    if (!path) { console.error('Usage: analyze-prod-promotion.ts <dump.json>'); process.exit(2); }
    const raw = fs.readFileSync(path, 'utf-8').trim();
    const rows: RawRow[] = JSON.parse(raw);

    console.log(`Analyzing ${rows.length} row(s)…\n`);

    const analyzed = rows.map(analyze);

    // Per-page report (suppressed for "empty_or_skip" to keep noise low)
    const showShapes: Shape[] = [
        'container_empty_merchant', 'legacy_flat_with_data',
        'container_merchant_populated', 'container_already_migrated', 'anomaly',
    ];
    for (const a of analyzed.filter(a => showShapes.includes(a.shape))) {
        const fields = a.shape === 'container_merchant_populated'
            ? `backfill: ${a.backfilledFields.join(',')}`
            : a.promotedFields.length > 0 ? `promote: ${a.promotedFields.join(',')}` : '—';
        const block = a.wouldEmitBlock ? 'block=YES' : 'block=NO ⚠';
        const noteStr = a.notes.length ? `  [${a.notes.join('; ')}]` : '';
        console.log(`[${a.shape}]  ${a.id}  "${a.name.slice(0, 38)}"  ${fields}  ${block}${noteStr}`);
    }

    // Aggregate
    const counts: Record<Shape, number> = {
        container_empty_merchant: 0,
        container_merchant_populated: 0,
        legacy_flat_with_data: 0,
        container_already_migrated: 0,
        empty_or_skip: 0,
        anomaly: 0,
    };
    for (const a of analyzed) counts[a.shape]++;
    const affected = counts.container_empty_merchant + counts.legacy_flat_with_data + counts.container_merchant_populated;
    const wouldEmitBlock = analyzed.filter(a =>
        ['container_empty_merchant','legacy_flat_with_data','container_merchant_populated'].includes(a.shape)
    ).filter(a => a.wouldEmitBlock).length;
    const wouldStayEmpty = analyzed.filter(a =>
        ['container_empty_merchant','legacy_flat_with_data','container_merchant_populated'].includes(a.shape)
    ).filter(a => !a.wouldEmitBlock);
    const doubleEncodedCount = analyzed.filter(a => a.notes.some(n => n.includes('double-encoded'))).length;

    console.log(`
────────────────────────────────────────────────────────────
Aggregate (${rows.length} rows scanned):
  container_empty_merchant     (promote_fb_sync):  ${counts.container_empty_merchant}
  legacy_flat_with_data        (wrap_legacy):      ${counts.legacy_flat_with_data}
  container_merchant_populated (backfill_editor):  ${counts.container_merchant_populated}
  container_already_migrated   (skip):             ${counts.container_already_migrated}
  empty_or_skip                (skip):             ${counts.empty_or_skip}
  anomaly                      (NEEDS ATTENTION):  ${counts.anomaly}${counts.anomaly > 0 ? ' ⚠' : ''}

Affected pages (would be modified): ${affected}
Would emit BUSINESS_INFO block after: ${wouldEmitBlock} / ${affected}
Would still have empty BUSINESS_INFO: ${wouldStayEmpty.length}${wouldStayEmpty.length > 0 ? ' ⚠' : ''}

Storage shape:
  jsonb-string (double-encoded, runtime-OK):       ${doubleEncodedCount}
────────────────────────────────────────────────────────────`);

    if (wouldStayEmpty.length > 0) {
        console.log('\n⚠ Pages where promotion would NOT produce a non-null BUSINESS_INFO block:');
        for (const a of wouldStayEmpty) {
            console.log(`  [${a.shape}] ${a.id}  "${a.name.slice(0, 50)}"`);
            if (a.promotedFields.length) console.log(`    promoted: ${a.promotedFields.join(',')}`);
            if (a.backfilledFields.length) console.log(`    backfilled: ${a.backfilledFields.join(',')}`);
        }
        console.log('  These rows have data outside the signal set {address, phones, hours, policies}.');
        console.log('  Promotion still runs correctly; the AI block stays empty because');
        console.log('  formatBusinessInfoPrompt requires at least one signal field.\n');
    }

    if (counts.anomaly > 0) {
        console.log('\n⚠ ANOMALIES (NEEDS REVIEW):');
        for (const a of analyzed.filter(a => a.shape === 'anomaly')) {
            console.log(`  ${a.id}  "${a.name.slice(0, 50)}"  ${a.notes.join('; ')}`);
        }
    }

    // Damascus institute spotlight
    const damascus = analyzed.find(a => a.id === '39aeab89-7e43-499f-9e5b-38adc1dbde21');
    if (damascus) {
        console.log(`\n────── Damascus page spotlight (the "عنوان" failure) ──────`);
        console.log(`  id:                  ${damascus.id}`);
        console.log(`  name:                ${damascus.name}`);
        console.log(`  shape:               ${damascus.shape}`);
        console.log(`  would promote:       ${damascus.promotedFields.join(', ') || '(none)'}`);
        console.log(`  BUSINESS_INFO block: ${damascus.wouldEmitBlock ? 'YES — bug closes' : 'NO ⚠ — bug NOT closed by Option B'}`);
        console.log(`  notes:               ${damascus.notes.join('; ') || '(none)'}`);
    }
}

main();
