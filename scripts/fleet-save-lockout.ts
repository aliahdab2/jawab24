/**
 * Fleet-wide SAVE lockout check.
 *
 * `isUsablePhoneEntry` gates the Business Info editor's save. Because the editor
 * sends a FULL-REPLACE patch, a no-op save re-validates every ALREADY-STORED
 * entry — so one entry the predicate rejects blocks that merchant from saving
 * anything at all, including edits to unrelated fields.
 *
 * This runs the predicate over every stored phone entry in production and
 * reports who could not save. It is the check that would have caught the
 * short-landline lockout before it reached a paying merchant.
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
const blocked: { page: string; entry: string }[] = [];

for (const row of rows) {
    const { merchant } = unwrapBusinessProfile(row.profile as StoredBusinessProfile);
    const phones = (merchant ?? {}).phones;
    if (!Array.isArray(phones)) continue;
    for (const e of phones) {
        const value = typeof e === 'string' ? e : (e as { number?: string })?.number ?? '';
        if (!value) continue;
        entries++;
        if (!isUsablePhoneEntry(value)) blocked.push({ page: row.page, entry: value });
    }
}

console.log(`Fleet save lockout — ${entries} stored phone entries across ${rows.length} profiles\n`);
console.log(`  would BLOCK a save on: ${blocked.length} entr${blocked.length === 1 ? 'y' : 'ies'}\n`);
for (const b of blocked) console.log(`  🔴 ${b.page}: ${JSON.stringify(b.entry)}`);

// Rejecting genuine junk is the guard working; every rejection must still be
// named, because "0 blocked" and "blocked something real" look identical in a
// summary line. Non-zero exit forces a human to read the list.
process.exit(blocked.length === 0 ? 0 : 1);
