/**
 * One-off backfill: enrich the 17 leads recovered from the "our reply echoes the
 * customer's own number" drop (fix f2d4ba7e). They were re-inserted with only a phone +
 * raw-message summary and EMPTY fields; this re-runs our REAL extractor over each full
 * conversation (leadExtractorService.reextractLeadNow) to fill the structured card
 * (name / course / address / size) and pick up details spread across multiple messages
 * or numbers — exactly as live capture would.
 *
 * SAFE BY DEFAULT: dry-run (prints what it would extract) unless --confirm is passed.
 * Never changes phone or status — extractedData only (see reextractLeadNow).
 *
 * Usage (prod):
 *   Dry-run:  docker exec jawab24-backend-green node backend/dist/scripts/backfill-enrich-leads.js
 *   Execute:  docker exec jawab24-backend-green node backend/dist/scripts/backfill-enrich-leads.js --confirm
 */
import { eq } from 'drizzle-orm';
import { db, client } from '../src/db';
import { pages } from '../src/db/schema';
import { leadExtractorService } from '../src/services/leadExtractor';

const NOURVA = '0f0e581a-25c4-4e91-a1b1-a47fa97f4708';
const DIMASHQI = '39aeab89-7e43-499f-9e5b-38adc1dbde21';
const ULTRA = 'dbf392b1-1b02-418c-ba8b-4a009178db8d';

// The 17 recovered leads: [pageId, senderId, label].
const TARGETS: Array<[string, string, string]> = [
    [NOURVA, '27523241207271514', 'Nourva / ام سعودي'],
    [NOURVA, '26045280398478180', 'Nourva / Pretty Spakydora'],
    [NOURVA, '27929035403348600', 'Nourva / Shaimaa Saiti'],
    [NOURVA, '27357854923871710', 'Nourva / Oluwashindara Ayomie'],
    [NOURVA, '27226996123629924', 'Nourva / Nosa Kanoun'],
    [NOURVA, '1056957663524351', 'Nourva / ajayianu69 (Khadijat)'],
    [NOURVA, '36601876642793879', 'Nourva / Oluwa Seun'],
    [NOURVA, '27971775295740247', 'Nourva / أم جهودي'],
    [DIMASHQI, '27643516785261205', 'الدمشقي / Amany Marjeh'],
    [DIMASHQI, '25709143135450328', 'الدمشقي / Bushra Muhammad'],
    [DIMASHQI, '27493664633609231', 'الدمشقي / Amal Alroh'],
    [DIMASHQI, '28296957783240873', 'الدمشقي / Dàlà Àlmohammed'],
    [DIMASHQI, '28235515482718576', 'الدمشقي / طه الناصر'],
    [DIMASHQI, '27510079735289768', 'الدمشقي / Mjd Freah'],
    [DIMASHQI, '26683651934655395', 'الدمشقي / Hanin Sukar'],
    [DIMASHQI, '25056503120710683', 'الدمشقي / Majd Alsaleem'],
    [ULTRA, '36728719763440724', 'Ultra / Munira Albrdwil'],
];

const confirm = process.argv.includes('--confirm');

async function main(): Promise<void> {
    // Owner userId per page — callExtractionAI needs it for model resolution + cost logging.
    const pageUser = new Map<string, string>();
    for (const [pageId] of TARGETS) {
        if (pageUser.has(pageId)) continue;
        const [p] = await db.select({ userId: pages.userId }).from(pages).where(eq(pages.id, pageId)).limit(1);
        pageUser.set(pageId, p?.userId ?? '');
    }

    console.log(`${confirm ? 'ENRICHING' : 'DRY-RUN (no writes)'} — ${TARGETS.length} leads\n`);
    let ok = 0, missing = 0, failed = 0;
    for (const [pageId, senderId, label] of TARGETS) {
        const userId = pageUser.get(pageId) ?? '';
        try {
            const r = await leadExtractorService.reextractLeadNow(pageId, senderId, userId, { dryRun: !confirm });
            if (!r.found) { console.log(`  ⚠ MISSING lead — ${label}`); missing++; continue; }
            const fields = (r.fields ?? []).map(f => `${f.label_ar || f.label_en || f.key}=${f.value}`).join(' | ');
            console.log(`  ✓ ${label}`);
            console.log(`      summary: ${r.summary ?? '(none)'}`);
            console.log(`      fields:  ${fields || '(none)'}`);
            ok++;
        } catch (e) {
            console.log(`  ✗ ERROR — ${label}: ${(e as Error).message}`);
            failed++;
        }
    }
    console.log(`\n${confirm ? 'Updated' : 'Would update'}: ${ok} | missing: ${missing} | failed: ${failed}`);
    await client.end();
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
