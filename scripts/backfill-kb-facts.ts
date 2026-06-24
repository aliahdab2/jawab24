#!/usr/bin/env npx tsx
/**
 * Phase C — one-time KB backfill: turn a merchant's existing free-text/chat-log KB into
 * structured kb_facts (tier-2 source of truth), then re-ingest so they become tier-2 chunks
 * that outrank the raw narrative. This is the step that actually improves a real merchant's
 * replies (the foundation alone adds no facts).
 *
 *   npx tsx scripts/backfill-kb-facts.ts --page=<uuid> --dry-run   # extract + print, NO writes
 *   npx tsx scripts/backfill-kb-facts.ts --page=<uuid> --purge     # delete prior facts, then backfill
 *   npx tsx scripts/backfill-kb-facts.ts --page=<uuid>             # backfill (insert + re-ingest)
 *
 * The raw KB text is KEPT (still chunked at tier-4) as a lossless fallback — the facts are
 * additive. Re-running is idempotent only with --purge (otherwise it appends more facts).
 *
 * ⚠️ PRICE-NEVER-WRONG: this script puts every extracted fact LIVE at tier-2, including prices.
 * The merchant-confirm gate (stage price facts at tier-5 until a one-tap confirm) is the B6
 * wire-in and is NOT built yet. Until it is, ALWAYS --dry-run first and eyeball every price
 * before a real run — the dry-run inspection is the manual stand-in for the confirm gate.
 *
 * Prereqs: DATABASE_URL + OPENAI_API_KEY (extraction + re-embedding cost a few cents/merchant).
 */
import { config } from '../backend/src/config'; // MUST be first: dotenv loads backend/.env before db reads DATABASE_URL
import { eq, sql } from 'drizzle-orm';
import { db } from '../backend/src/db';
import { pages, kbFacts } from '../backend/src/db/schema';
import { kbFactExtractor, type ExtractedFact } from '../backend/src/services/kb/factExtractor';
import { validateFacts } from '../backend/src/services/kb/factValidator';
import { getIngestionService } from '../backend/src/services/pages';

// ---- args ----
const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
const has = (k: string) => process.argv.includes(`--${k}`);
const PAGE_ID = arg('page');
const DRY_RUN = has('dry-run');
const PURGE = has('purge');
const SEGMENT_CHARS = Number(arg('segment') ?? 2500); // keep each extract() output well under its 2000-token cap
// One-time backfill → use a stronger model than the per-reply default. Override with --model.
const MODEL = arg('model') ?? 'gpt-4.1';
// Escape hatch: persist flagged (ungrounded/conflicting-price) facts too. Default: hold them.
const INCLUDE_FLAGGED = has('include-flagged');

if (!PAGE_ID) {
    console.error('Usage: --page=<uuid> [--dry-run] [--purge] [--segment=2500]');
    process.exit(1);
}

/** Normalize an Arabic title for dedup: strip tatweel/diacritics, collapse whitespace, lowercase. */
function normTitle(s: string): string {
    return s
        .replace(/[ـ]/g, '')               // tatweel
        .replace(/[ً-ْ]/g, '')         // harakat
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

/**
 * Split the KB into segments on blank-line block boundaries, greedily packed up to
 * SEGMENT_CHARS — so a single course block (name + price + schedule) is never split across
 * a boundary (which would orphan a price from its course = the cross-wiring failure).
 */
function segmentKb(kb: string): string[] {
    const blocks = kb.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
    const segments: string[] = [];
    let cur = '';
    for (const b of blocks) {
        if (cur && (cur.length + b.length + 2) > SEGMENT_CHARS) {
            segments.push(cur);
            cur = '';
        }
        cur = cur ? `${cur}\n\n${b}` : b;
    }
    if (cur) segments.push(cur);
    return segments;
}

async function main() {
    if (!config.openai?.apiKey) throw new Error('OPENAI_API_KEY is required (extraction + embeddings).');

    const [page] = await db
        .select({
            id: pages.id, userId: pages.userId, name: pages.name,
            knowledgeBase: pages.knowledgeBase, kbVersion: pages.kbVersion,
            ecommerceStoreId: pages.ecommerceStoreId,
        })
        .from(pages)
        .where(eq(pages.id, PAGE_ID!))
        .limit(1);

    if (!page) throw new Error(`Page ${PAGE_ID} not found.`);
    if (!page.userId) throw new Error(`Page ${PAGE_ID} has no userId (needed for cost attribution).`);
    const kb = (page.knowledgeBase ?? '').trim();
    if (!kb) throw new Error(`Page ${PAGE_ID} has an empty knowledge base — nothing to backfill.`);

    const segments = segmentKb(kb);
    const ctx = { userId: page.userId, pageId: PAGE_ID, model: MODEL };
    console.log(`Page: ${page.name} (${PAGE_ID})`);
    console.log(`KB: ${kb.length} chars → ${segments.length} segment(s) of ≤${SEGMENT_CHARS} chars · model=${MODEL}\n`);

    // ---- extract per segment (serial: keeps token rate modest, order stable) ----
    const all: ExtractedFact[] = [];
    for (let i = 0; i < segments.length; i++) {
        const facts = await kbFactExtractor.extract(segments[i], ctx);
        console.log(`  segment ${i + 1}/${segments.length} (${segments[i].length} chars) → ${facts.length} fact(s)`);
        all.push(...facts);
    }

    // ---- cheap exact-title pre-dedup (shrinks the consolidation payload) ----
    const byTitle = new Map<string, ExtractedFact>();
    for (const f of all) {
        const key = normTitle(f.title) || normTitle(f.content).slice(0, 60);
        const existing = byTitle.get(key);
        if (!existing) { byTitle.set(key, f); continue; }
        const better = (f.price && !existing.price) || (f.content.length > existing.content.length && !!f.price === !!existing.price);
        if (better) byTitle.set(key, f);
    }
    const preDedup = [...byTitle.values()];

    // ---- consolidation pass: the stability fix. Merges same-offering duplicates the exact-title
    // dedup misses (different names, same course), keeps distinct variants with clear titles, and
    // never changes a price. This is what stops pool-bloat + conflicting-price ambiguity. ----
    const consolidated = await kbFactExtractor.consolidate(preDedup, ctx);

    // ---- validation check layer (deterministic): hold facts whose price isn't grounded in the
    // source, or that conflict on price. price-never-wrong, enforced before anything is persisted. ----
    const { ok, flagged } = validateFacts(consolidated, kb);
    const facts = INCLUDE_FLAGGED ? consolidated : ok;
    const priced = facts.filter(f => f.price);

    console.log(`\nExtracted ${all.length} → ${preDedup.length} (exact-dedup) → ${consolidated.length} (consolidated) → ${ok.length} grounded + ${flagged.length} flagged.\n`);
    console.log('─'.repeat(80));
    for (const f of ok) {
        const tag = f.price ? `💰 ${f.price}` : '  (no price)';
        console.log(`${tag.padEnd(22)} | ${f.title}`);
        console.log(`${' '.repeat(22)} | ${f.content}`);
    }
    if (flagged.length) {
        console.log('\n⚠️  FLAGGED — held for review (not persisted unless --include-flagged):');
        for (const { fact, reasons } of flagged) {
            console.log(`  [${reasons.join(',')}]  💰 ${fact.price}  | ${fact.title}`);
            console.log(`${' '.repeat(8)} ${fact.content}`);
        }
    }
    console.log('─'.repeat(80));

    if (DRY_RUN) {
        console.log('\n[dry-run] No writes. Review the facts above (especially prices + flagged) before a real run.');
        process.exit(0);
    }

    if (!facts.length) { console.log('\nNo facts to write.'); process.exit(0); }

    if (PURGE) {
        const del: any = await db.delete(kbFacts).where(eq(kbFacts.pageId, PAGE_ID!)).returning({ id: kbFacts.id });
        console.log(`\nPurged ${(del.length ?? del.rowCount ?? 0)} existing fact(s) for this page.`);
    }

    await db.insert(kbFacts).values(facts.map(f => ({
        pageId: PAGE_ID!,
        title: f.title.slice(0, 500),
        content: f.content,
        type: 'offering',
        attributes: f.price ? { price: f.price } : {},
    })));
    console.log(`Inserted ${facts.length} kb_facts row(s)${flagged.length && !INCLUDE_FLAGGED ? ` (held back ${flagged.length} flagged)` : ''}.`);

    // ---- re-ingest: bump version, project facts into tier-2 chunks, activate ----
    const [bumped] = await db
        .update(pages)
        .set({ kbVersion: sql`COALESCE(${pages.kbVersion}, 0) + 1`, kbUpdatedAt: new Date(), updatedAt: new Date() })
        .where(eq(pages.id, PAGE_ID!))
        .returning({ kbVersion: pages.kbVersion });
    const newVersion = bumped.kbVersion!;

    const ingestion = getIngestionService();
    if (!ingestion) throw new Error('Ingestion service unavailable (check OPENAI_API_KEY).');
    // Institute/Nourva have no e-commerce store → no products. (Backfill targets KB-only merchants.)
    await ingestion.ingestFullPage(PAGE_ID!, kb, [], newVersion);

    console.log(`Re-ingested at kbVersion=${newVersion} (facts now tier-2 chunks, version activated).`);
    console.log('\nDone. Ask Jawab the questions that used to miss and compare.');
    process.exit(0);
}

main().catch((e) => { console.error('ERR', e instanceof Error ? e.message : e); process.exit(1); });
