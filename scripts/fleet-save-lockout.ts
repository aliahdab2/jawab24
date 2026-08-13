/**
 * Fleet-wide phone-slot data-quality check.
 *
 * ⚠️ RENAMED IN MEANING 2026-08-13 — read this before quoting its output.
 *
 * It used to be a LOCKOUT check, and it was: `isUsablePhoneEntry` gated the
 * editor's save, and because the editor sends a FULL-REPLACE patch a no-op save
 * re-validated every ALREADY-STORED entry, so one rejected entry blocked that
 * merchant from saving anything at all — including edits to unrelated fields.
 * This script is what would have caught the short-landline lockout before it
 * reached a paying merchant.
 *
 * ⭐ That is no longer what a rejection MEANS. `merchantBusinessProfileSchema`
 * now GRANDFATHERS numbers already stored on the page (backend
 * `utils/validation.ts`), and the editor grandfathers the same set inline, so a
 * bad stored entry can be kept or deleted but can never block a save. The change
 * was forced by the supply being continuous rather than a one-off: `fb_sync` and
 * the KB fact extractor write through the BASE schema by design, so Facebook can
 * plant an unjudgeable entry at any time.
 *
 * So what this now reports is a DATA-QUALITY BACKLOG, not an outage:
 *
 *   - these entries are not phone numbers, and the prompt publishes them to
 *     customers as if they were (that is the defect the standard exists to fix);
 *   - they do NOT block any save today;
 *   - they WOULD be rejected if the merchant re-typed the same text, which is
 *     the guard working.
 *
 * ⇒ Do not report a non-zero count as "N merchants cannot save". Report it as
 * "N stored entries are not numbers".
 *
 *   npx tsx scripts/fleet-save-lockout.ts <profiles.json>
 */

import { readFileSync } from 'fs';
import { isUsablePhoneEntry, unwrapBusinessProfile } from '../packages/shared/src/index';
import type { StoredBusinessProfile } from '../packages/shared/src/businessProfileMerge';

interface Row { page: string; fbid: string; profile: unknown }

const file = process.argv[2];
if (!file) {
    console.error('usage: npx tsx scripts/fleet-save-lockout.ts <profiles.json>');
    process.exit(2);
}

const rows: Row[] = JSON.parse(readFileSync(file, 'utf8'));
let entries = 0;
const notNumbers: { page: string; entry: string }[] = [];

for (const row of rows) {
    const { merchant } = unwrapBusinessProfile(row.profile as StoredBusinessProfile);
    const phones = (merchant ?? {}).phones;
    if (!Array.isArray(phones)) continue;
    for (const e of phones) {
        const value = typeof e === 'string' ? e : (e as { number?: string })?.number ?? '';
        if (!value) continue;
        entries++;
        if (!isUsablePhoneEntry(value)) notNumbers.push({ page: row.page, entry: value });
    }
}

console.log(`Fleet phone-slot quality — ${entries} stored phone entries across ${rows.length} profiles\n`);
console.log(`  stored entries that are NOT phone numbers: ${notNumbers.length}`);
console.log('  (grandfathered — these do NOT block a save; they are published to');
console.log('   customers as if they were numbers, and would be refused if re-typed)\n');
for (const b of notNumbers) console.log(`  🟠 ${b.page}: ${JSON.stringify(b.entry)}`);

// Every finding must still be NAMED: "0" and "found something real" look
// identical in a summary line, and this list is the cleanup backlog. Non-zero
// exit forces a human to read it — but it is a backlog signal now, not a gate
// that must reach 0 before shipping.
process.exit(notNumbers.length === 0 ? 0 : 1);
