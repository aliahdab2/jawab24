/**
 * One-off backfill: re-extract phone numbers for leads whose stored `phone`
 * was mangled by the old regex-based extractor.
 *
 * Background: the previous extractor's character class allowed whitespace
 * inside a phone match and stripped it during normalization, so two phone
 * numbers separated by a space were welded into a single invalid string
 * (e.g. "0935924472 0112124470" → "0935924472011212447"). Those leads have
 * `tel:` and `wa.me/` buttons that don't dial anywhere — the lead is
 * effectively unreachable until we re-extract.
 *
 * This script:
 *   1. Finds every lead whose `phone` is not a valid E.164 number.
 *   2. Loads the source message/comment text.
 *   3. Re-runs extractPhoneFromText (now backed by libphonenumber-js).
 *   4. Updates the row when a better phone is recovered.
 *
 * Run once after deploy:
 *   npx tsx backend/src/scripts/backfill-mangled-lead-phones.ts
 *   DRY_RUN=1 npx tsx backend/src/scripts/backfill-mangled-lead-phones.ts   # preview only
 */
import { db } from '../db';
import { leads, messages, comments } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { extractPhoneFromText, isValidPhone } from '@jawab24/shared';

const DRY_RUN = process.env.DRY_RUN === '1';

async function loadSourceText(sourceType: string, sourceId: string | null): Promise<string | null> {
    if (!sourceId) return null;
    if (sourceType === 'message') {
        const rows = await db.select({ message: messages.message }).from(messages).where(eq(messages.id, sourceId)).limit(1);
        return rows[0]?.message ?? null;
    }
    if (sourceType === 'comment') {
        const rows = await db.select({ message: comments.message }).from(comments).where(eq(comments.id, sourceId)).limit(1);
        return rows[0]?.message ?? null;
    }
    return null;
}

async function main() {
    // Mangled phones: anything that isn't a valid E.164 string. The old extractor
    // returned compact national-format digits (e.g. "0935924472") so most pre-fix
    // rows will match this filter; that's intentional — we re-canonicalize them
    // to E.164 too while we're here.
    const rows = await db.execute<{ id: string; phone: string; source_type: string; source_id: string | null }>(sql`
        SELECT id, phone, source_type, source_id
        FROM leads
        WHERE phone !~ '^\\+[1-9][0-9]{1,14}$'
    `);

    const candidates = Array.isArray(rows) ? rows : (rows as { rows: typeof rows }).rows ?? [];
    console.warn(`Found ${candidates.length} lead(s) with non-E.164 phone.`);

    let recovered = 0;
    let unchanged = 0;
    let noSource = 0;

    for (const row of candidates) {
        const sourceText = await loadSourceText(row.source_type, row.source_id);
        if (!sourceText) {
            noSource++;
            continue;
        }

        const newPhone = extractPhoneFromText(sourceText);
        if (!newPhone || !isValidPhone(newPhone)) {
            unchanged++;
            continue;
        }
        if (newPhone === row.phone) {
            unchanged++;
            continue;
        }

        console.warn(`lead=${row.id}  old=${row.phone}  →  new=${newPhone}`);
        if (!DRY_RUN) {
            await db.update(leads).set({ phone: newPhone, updatedAt: new Date() }).where(eq(leads.id, row.id));
        }
        recovered++;
    }

    console.warn(`\nSummary: recovered=${recovered}  unchanged=${unchanged}  no_source=${noSource}  total=${candidates.length}`);
    if (DRY_RUN) console.warn('DRY_RUN=1 — no rows were modified.');
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('Backfill failed:', err);
        process.exit(1);
    });
