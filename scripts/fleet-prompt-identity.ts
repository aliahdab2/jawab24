/**
 * Fleet-wide prompt byte-identity check — the pre-merge gate for PR #733.
 *
 * The probe (`contact-standard-probe.ts`) proves the change on TWO merchants'
 * shapes. This proves it on ALL of them: every real `business_profile` in
 * production is rendered through origin/main's BUSINESS_INFO formatter and this
 * branch's, in one process, and the bytes are compared.
 *
 * Why this and not more reply sampling: what reaches the model IS the rendered
 * block, and rendering is a pure function. If the bytes match for a merchant,
 * that merchant's replies cannot have changed — no sampling, no LLM variance, no
 * error bar. Reply-level probes are for measuring whether the change HELPS; this
 * is for proving it cannot HURT.
 *
 * Read-only against production: it consumes a JSON dump taken with
 * `scripts/prod-db-query.sh` (SELECT-only by construction) and never connects
 * to production itself.
 *
 *   ./scripts/prod-db-query.sh "SELECT json_agg(json_build_object(
 *      'page', p.name, 'fbid', p.facebook_page_id,
 *      'profile', (p.business_profile #>> '{}')::jsonb))::text
 *    FROM pages p WHERE p.business_profile IS NOT NULL;" -t > /tmp/prod-profiles.json
 *
 *   git show origin/main:packages/shared/src/businessInfoPrompt.ts \
 *     > packages/shared/src/__mainBusinessInfoPrompt.ts
 *
 *   npx tsx scripts/fleet-prompt-identity.ts /tmp/prod-profiles.json
 */

import { readFileSync } from 'fs';
import { formatBusinessInfoPrompt } from '../packages/shared/src/businessInfoPrompt';
import { formatBusinessInfoPrompt as formatOnMain } from '../packages/shared/src/__mainBusinessInfoPrompt';
import { unwrapBusinessProfile, businessPhoneList } from '../packages/shared/src/index';
import type { StoredBusinessProfile } from '../packages/shared/src/businessProfileMerge';

interface Row { page: string; fbid: string; profile: unknown }

const file = process.argv[2];
if (!file) {
    console.error('usage: npx tsx scripts/fleet-prompt-identity.ts <profiles.json>');
    process.exit(2);
}

const rows: Row[] = JSON.parse(readFileSync(file, 'utf8'));
console.log(`Fleet prompt identity — ${rows.length} production profiles\n`);

let identical = 0;
const changed: { page: string; fbid: string; before: string; after: string }[] = [];
const exclusionShrunk: { page: string; lost: string[] }[] = [];

for (const row of rows) {
    const { merchant, merchantProvenance } = unwrapBusinessProfile(row.profile as StoredBusinessProfile);

    const before = formatOnMain(merchant ?? null, merchantProvenance) ?? '';
    const after = formatBusinessInfoPrompt(merchant ?? null, merchantProvenance) ?? '';
    if (before === after) identical++;
    else changed.push({ page: row.page, fbid: row.fbid, before, after });

    // Every number the merchant stores must come back out of `businessPhoneList`,
    // whichever shape it is stored in. That list feeds the lead-capture
    // exclusion set, so a number it drops becomes capturable as a CUSTOMER lead
    // and the merchant's own line lands on a lead's call button — a regression
    // this codebase has shipped once already.
    //
    // Stated as an invariant over the RAW data rather than as a before/after
    // diff, deliberately: production stores only bare strings today, so a
    // before/after comparison would pass trivially and prove nothing. This form
    // also catches the `[object Object]` failure mode, where an entry survives
    // as an object and empties the set on `texts.join()`.
    const raw = (merchant ?? {}).phones;
    const expected = Array.isArray(raw)
        ? raw.map((e) => (typeof e === 'string' ? e : (e as { number?: string })?.number ?? '')).filter(Boolean)
        : [];
    const got = businessPhoneList(merchant ?? {});
    const lost = expected.filter((n) => !got.some((g) => g.includes(n) || n.includes(g)));
    if (lost.length) exclusionShrunk.push({ page: row.page, lost });
}

console.log(`  byte-identical : ${identical}/${rows.length}`);
console.log(`  changed        : ${changed.length}`);
console.log(`  exclusion set shrank on: ${exclusionShrunk.length} page(s)\n`);

for (const c of changed.slice(0, 10)) {
    console.log(`▸ ${c.page} (${c.fbid})`);
    const b = c.before.split('\n');
    const a = c.after.split('\n');
    for (let i = 0; i < Math.max(b.length, a.length); i++) {
        if (b[i] !== a[i]) {
            if (b[i] !== undefined) console.log(`   - ${b[i]}`);
            if (a[i] !== undefined) console.log(`   + ${a[i]}`);
        }
    }
    console.log('');
}
if (changed.length > 10) console.log(`  … and ${changed.length - 10} more changed pages not shown\n`);

for (const e of exclusionShrunk) console.log(`🔴 ${e.page}: lost ${e.lost.join(', ')}`);

// A changed prompt is not automatically wrong — but it must be explained, never
// discovered after the merge. Exit non-zero so this cannot pass unnoticed in a
// pre-deploy chain.
process.exit(changed.length === 0 && exclusionShrunk.length === 0 ? 0 : 1);
