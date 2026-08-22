/**
 * Product resolver — decides WHICH product a customer means, in code (D-092).
 *
 * `check_inventory` used to hand the model's free-text `product_name` to each
 * platform's own substring matcher: 4/14 natural Arabic phrasings matched
 * against the real Zid dev catalog, Shopify/Salla returned the FIRST search hit
 * when nothing matched (`|| products[0]` → a wrong product, price and URL,
 * cached for five minutes), and Zid's documented `?search=` ignores its term.
 *
 * Resolution now happens here, over the page's OWN product index (`kb_chunks`
 * rows of `type = 'product'`, the same rows RAG already ranks on every reply),
 * in two stages calibrated on the production index (65 phrasings × 16 products,
 * `scripts/product-resolver-probe.ts`, report in
 * `docs/integrations/product-resolver-probe-2026-08-22.md`):
 *
 *   1. TRIGRAM — pg_trgm on title + content. Resolves exact and near-exact
 *      titles («نظارة شمسية» 0.64, «عباية سوداء» 0.40) and close spelling
 *      variants («نظاره شمسيه» 0.33) with 0 wrong answers in the probe. It
 *      RANKS the «ال»-article and plural phrasings first too, but below the
 *      resolve floor («النظارة» 0.16) — those are decided by stage 2. No
 *      embedding needed, so an exact-title ask costs nothing (Rule 17.2).
 *   2. SEMANTIC — cosine on the reply's own `queryEmbedding` (reused; embedded
 *      here only when the caller has none). It RANKS the right product top-1 in
 *      47/50 single-answer cases and decides the article/plural cases on a
 *      clear lead («النظارة» 0.536 vs 0.236), but its scores cannot separate
 *      "right" from "unrelated" («كاميرا»→Sony 0.33, «ساعة ذكية»→nothing 0.41),
 *      so for cross-script and category asks it mostly PROPOSES: `ambiguous`
 *      with ≤3 candidates is a normal outcome, not an edge case.
 *
 * The thresholds below are read off the probe's cost-weighted sweep (a wrong
 * resolve or a false "we don't sell that" costs −3; "did you mean X or Y?"
 * costs 0). At these values: 0 wrong resolves, 2 false not-founds — both Arabic
 * transliterations of Latin brand names with no Arabic description («جالكسي»
 * 0.24, «ايربودز» 0.18), which score BELOW unrelated queries and are the known
 * open gap (eval XGAP). Re-probe on the first real 50+ product catalog; the
 * `metrics:ecom:check_inventory:not_found` share is the alarm.
 *
 * ⚠️ Never tune these to strict accuracy: raising the semantic floor to 0.35
 * "improves" strict accuracy 42→48/65 and produces 4 wrong prices and 10 false
 * not-founds — exactly the outcomes this module exists to prevent.
 */
import { normalizeArabic, availabilityOf, SELLABLE_STATUSES, type InventoryCandidate, type EcommerceProduct } from '@jawab24/shared';
import { sql } from 'drizzle-orm';
import { db } from '../../db';
import { getProductByPlatformId } from '../ecommerce';
import { retrieveProducts, getRetrievalService, type ProductHit } from '../kb/retrieval';
import { redis } from '../../lib/redis';
import type { Logger } from '../../types/logger';
import { noopLogger } from '../../types/logger';

// --- Calibrated thresholds (probe 2026-08-22; see module doc) ---

/** Trigram score at/above which a lexical hit may resolve on its own. */
export const T_TRI = 0.3;
/** Lead the best trigram hit must have over the runner-up to resolve. */
export const G_TRI = 0.15;
/** Cosine floor: nothing at/above it → not_found. Below 0.25 sits only noise. */
export const T_VEC = 0.25;
/** Cosine the best semantic hit must reach to be resolved rather than proposed. */
export const T_SOLO = 0.35;
/** Lead the best semantic hit must have over the runner-up to resolve. */
export const G_VEC = 0.12;
/** Candidates returned on `ambiguous`. Three is what a reply can list and ask about. */
export const MAX_CANDIDATES = 3;
/** Upper bound on a model-supplied product id before it is looked up. */
const PRODUCT_ID_MAX_LENGTH = 64;

export type ResolveVia = 'id' | 'trigram' | 'hybrid' | 'title_trigram';

export type ProductResolution =
    | { kind: 'resolved'; product: EcommerceProduct; via: ResolveVia }
    | { kind: 'ambiguous'; candidates: InventoryCandidate[] }
    | { kind: 'not_found'; reason: 'no_input' | 'id_unknown' | 'below_floor' | 'empty_catalog' };

export interface ResolveProductInput {
    storeId: string;
    /** The linked page whose product index is scanned. Without it only the by-id path and the title fallback run. */
    pageId?: string | null;
    kbActiveVersion?: number | null;
    /** Model-supplied id — validated, never trusted. */
    productId?: string | null;
    /** The customer's wording (or the model's paraphrase of it). */
    productName?: string | null;
    /** The reply's own query embedding, reused so the common path embeds nothing. */
    queryEmbedding?: number[] | null;
    /** Merchant user id — cost attribution for the rare embedding this module makes itself. */
    userId?: string | null;
    logger?: Logger;
}

/** Fire-and-forget diagnostic counters — `metrics:ecom:check_inventory:{outcome}` (§13c idiom). */
export function recordResolverOutcome(outcome: string): void {
    try {
        redis.incr(`metrics:ecom:check_inventory:${outcome}`).catch(() => { });
    } catch {
        // never on the reply path
    }
}

/** A model-supplied product id is opaque platform text: bounded, printable, no whitespace. */
export function sanitizeProductId(raw: string | null | undefined): string | null {
    const cleaned = (raw ?? '').trim();
    if (!cleaned || cleaned.length > PRODUCT_ID_MAX_LENGTH) return null;
    if (!/^[A-Za-z0-9_\-:.]+$/.test(cleaned)) return null;
    return cleaned;
}

export async function resolveProduct(input: ResolveProductInput): Promise<ProductResolution> {
    const log = input.logger ?? noopLogger;
    const { storeId } = input;

    // 1. By id — the model saw `ID: …` in a product entry and passed it back.
    const productId = sanitizeProductId(input.productId);
    if (productId) {
        const byId = await getProductByPlatformId(storeId, productId);
        if (byId) {
            recordResolverOutcome('by_id');
            return { kind: 'resolved', product: byId, via: 'id' };
        }
        // A hallucinated id is decided here, in code: it never reaches a platform.
        recordResolverOutcome('id_unknown');
        if (!input.productName?.trim()) return { kind: 'not_found', reason: 'id_unknown' };
    }

    const rawName = (input.productName ?? '').trim();
    if (!rawName) {
        recordResolverOutcome('not_found');
        return { kind: 'not_found', reason: 'no_input' };
    }
    const normalizedQuery = normalizeArabic(rawName);

    // 2. The page's product index (trigram first, then semantic).
    if (input.pageId && input.kbActiveVersion) {
        let hits = await retrieveProducts(input.pageId, input.kbActiveVersion, normalizedQuery, input.queryEmbedding ?? null);

        if (hits.length > 0) {
            const lexical = decideTrigram(hits);
            if (lexical) {
                const product = await validated(storeId, lexical.platformProductId);
                if (product) {
                    recordResolverOutcome('by_trigram');
                    return { kind: 'resolved', product, via: 'trigram' };
                }
            }

            // Semantic stage needs a vector. Reuse the reply's; embed only when absent.
            if (hits.every(h => h.vecScore === null)) {
                const embedded = await embedQuery(normalizedQuery, input.userId ?? undefined, log);
                if (embedded) {
                    recordResolverOutcome('resolved_embed');
                    hits = await retrieveProducts(input.pageId, input.kbActiveVersion, normalizedQuery, embedded);
                }
            }

            // Stage 2 — decided over the hits whose rows still exist. The index
            // may lag the catalog, so a hit whose row is gone is dropped and the
            // decision is RE-TAKEN over the rest with the SAME thresholds. A lone
            // survivor below T_SOLO is proposed, never resolved: that is the
            // probe's procedure, and "0 wrong resolves" was measured for it alone
            // (on the corpus, three single-candidate cases sit in 0.25–0.35 —
            // «ماك بوك» 0.253, «ابل تي في» 0.292, «العود» 0.318 — all right, but
            // the zone is the one cosine cannot tell from unrelated; see §5).
            let remaining = hits;
            for (;;) {
                const semantic = decideSemantic(remaining);
                if (semantic.kind === 'not_found') break;
                if (semantic.kind === 'resolved') {
                    const product = await validated(storeId, semantic.platformProductId);
                    if (product) {
                        recordResolverOutcome('by_hybrid');
                        return { kind: 'resolved', product, via: 'hybrid' };
                    }
                    remaining = remaining.filter(h => h.platformProductId !== semantic.platformProductId);
                    continue;
                }
                const candidates = await candidatesFor(storeId, semantic.candidateIds);
                if (candidates.length === semantic.candidateIds.length) {
                    recordResolverOutcome('ambiguous');
                    return { kind: 'ambiguous', candidates };
                }
                // At least one candidate row is gone: drop those and decide again.
                const alive = new Set(candidates.map(c => c.platformProductId));
                remaining = remaining.filter(h => alive.has(h.platformProductId) || !semantic.candidateIds.includes(h.platformProductId));
            }
            recordResolverOutcome('not_found');
            return { kind: 'not_found', reason: 'below_floor' };
        }
        // No product chunks for this page/version: a just-added product, or an
        // index that has not caught up. Fall through to the catalog rows.
        recordResolverOutcome('no_index');
    }

    // 3. Fallback — trigram straight over the catalog titles. No embedding, no
    //    index: bounded by the store's rows (≤ PRODUCT_SAFETY_CAP), and only the
    //    lexical decision is trusted here.
    const titleHits = await trigramOverTitles(storeId, normalizedQuery);
    if (titleHits.length === 0) {
        recordResolverOutcome('not_found');
        return { kind: 'not_found', reason: 'empty_catalog' };
    }
    const lexical = decideTrigram(titleHits);
    if (lexical) {
        const product = await validated(storeId, lexical.platformProductId);
        if (product) {
            recordResolverOutcome('by_title_trigram');
            return { kind: 'resolved', product, via: 'title_trigram' };
        }
    }
    const above = titleHits.filter(h => h.triScore >= T_TRI).slice(0, MAX_CANDIDATES);
    if (above.length > 1) {
        const candidates = await candidatesFor(storeId, above.map(h => h.platformProductId));
        if (candidates.length > 1) {
            recordResolverOutcome('ambiguous');
            return { kind: 'ambiguous', candidates };
        }
    }
    recordResolverOutcome('not_found');
    return { kind: 'not_found', reason: 'below_floor' };
}

// --- Decision layer (pure; pinned by unit tests) ---

/** Stage 1: a lexical hit resolves when it clears T_TRI and leads the runner-up by G_TRI. */
export function decideTrigram(hits: ProductHit[]): ProductHit | null {
    const ranked = [...hits].sort((a, b) => b.triScore - a.triScore);
    const top = ranked[0];
    if (!top || top.triScore < T_TRI) return null;
    const lead = ranked.length === 1 ? 1 : top.triScore - ranked[1].triScore;
    return lead >= G_TRI ? top : null;
}

export type SemanticDecision =
    | { kind: 'resolved'; platformProductId: string }
    | { kind: 'ambiguous'; candidateIds: string[] }
    | { kind: 'not_found' };

/**
 * Stage 2: candidates are everything at/above T_VEC; the top one resolves only
 * when it also clears T_SOLO and leads by G_VEC — otherwise the candidates are
 * proposed. Hits with no vector (no embedding available) cannot be candidates.
 */
export function decideSemantic(hits: ProductHit[]): SemanticDecision {
    const ranked = hits
        .filter(h => h.vecScore !== null && h.vecScore >= T_VEC)
        .sort((a, b) => (b.vecScore ?? 0) - (a.vecScore ?? 0));
    if (ranked.length === 0) return { kind: 'not_found' };
    const top = ranked[0].vecScore ?? 0;
    const lead = ranked.length === 1 ? 1 : top - (ranked[1].vecScore ?? 0);
    if (top >= T_SOLO && lead >= G_VEC) return { kind: 'resolved', platformProductId: ranked[0].platformProductId };
    return { kind: 'ambiguous', candidateIds: ranked.slice(0, MAX_CANDIDATES).map(h => h.platformProductId) };
}

// --- Helpers ---

/** The index may lag the catalog: a hit is only a product if its row still exists and is sellable. */
async function validated(storeId: string, platformProductId: string): Promise<EcommerceProduct | null> {
    return getProductByPlatformId(storeId, platformProductId);
}

async function candidatesFor(storeId: string, ids: string[]): Promise<InventoryCandidate[]> {
    const rows = await Promise.all(ids.map(id => getProductByPlatformId(storeId, id)));
    return rows
        .filter((r): r is EcommerceProduct => r !== null)
        .map(r => ({
            platformProductId: r.platformProductId,
            title: r.title,
            availability: availabilityOf(r),
            ...(r.priceRange ? { price: r.priceRange } : {}),
        }));
}

async function embedQuery(normalizedQuery: string, userId: string | undefined, log: Logger): Promise<number[] | null> {
    const retrieval = getRetrievalService();
    if (!retrieval) return null;
    try {
        return await retrieval.embedForResolver(normalizedQuery, userId);
    } catch (err) {
        log.warn('Product resolver: embedding failed, semantic stage skipped', {
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}

/**
 * Trigram over `ecommerce_products.title` for a store, for pages with no
 * product index yet. Folded with the same `normalizeArabic` the index uses.
 * No new column, no new index: the scan is bounded by
 * `idx_ecommerce_products_store_id` and the PRODUCT_SAFETY_CAP.
 */
async function trigramOverTitles(storeId: string, normalizedQuery: string): Promise<ProductHit[]> {
    // pg_trgm is case-insensitive by construction; the title is not Arabic-folded
    // here (the index's title_normalized is), which this fallback accepts — it
    // runs only while a page has no product index, and titles rarely carry the
    // diacritics normalizeArabic strips.
    const rows = await db.execute(sql`
        SELECT platform_product_id, title,
               similarity(title, ${normalizedQuery}) AS tri_score
        FROM ecommerce_products
        WHERE ecommerce_store_id = ${storeId}
          AND status IN (${sql.join(SELLABLE_STATUSES.map(s => sql`${s}`), sql`, `)})
        ORDER BY tri_score DESC
        LIMIT 20
    `);
    return (rows as unknown as Array<Record<string, unknown>>).map(r => ({
        platformProductId: String(r.platform_product_id),
        title: String(r.title ?? ''),
        vecScore: null,
        triScore: Number(r.tri_score ?? 0),
    }));
}
