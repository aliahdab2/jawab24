/**
 * Builds ProductCard[] for the Messenger/Instagram Generic Template carousel.
 *
 * Runs after the tool loop inside `ecommerceToolLoop.ts`. Two sources:
 *   1. Tool results that carry product references (currently `check_inventory`).
 *   2. When no tool produced one — the single in-stock catalog product the
 *      reply text NAMES (mention cards, see below).
 *
 * Also owns the per-customer card cooldown (`filterRecentlySentCards` +
 * `markCardsSent`), which `messageProcessor` applies around the send.
 *
 * Contract:
 *   - Returns [] when there isn't enough data for a card (image + URL).
 *   - Never throws — a DB lookup failure degrades gracefully to text-only reply.
 *   - Image URL comes from `ecommerceProducts.imageUrl` (populated by product sync).
 *     When the store hasn't synced images yet, the tool reply stays text-only.
 *   - Every customer-facing string goes through `t(key, lang)` — a card carries
 *     the same language as the reply it follows (Rule 13b).
 *
 * Extension point: Phase 4a will add `recommend_products` — its results will also
 * flow through here. Add a new case in `extractCardsFromResult()` at that point.
 */
import { and, asc, eq, ilike } from 'drizzle-orm';
import { db } from '../../db';
import { redis } from '../../lib/redis';
import { ecommerceProducts, ecommerceStores } from '../../db/schema';
import { captureError } from '../../utils/sentryHelpers';
import { buildProductUrl } from '../ecommerce';
import { t } from '../../utils/i18n';
import { normalizeArabic } from '@jawab24/shared';
import type { EcommerceToolResult, InventoryInfo, ProductCard } from '@jawab24/shared';

/**
 * Upper bound on catalog rows scanned for a mention match.
 *
 * ⚠️ This is NOT a "big enough" heuristic. The exactly-one rule below is a
 * decision about the WHOLE active catalog — "does the reply name one product or
 * several?" — so evaluating it on a slice silently converts a suppressed card
 * into a sent one whenever the second match falls outside the slice. The scan is
 * therefore ordered (`asc(id)`, so it is at least reproducible) and fetches
 * `LIMIT + 1`; when the extra row comes back the catalog is larger than we can
 * decide over and we return [] rather than guess. Phase 1 selects `id, title`
 * only, so 2,000 rows is a few tens of KB and every real Zid/Salla/Shopify
 * catalog fits inside it.
 */
const MENTION_SCAN_LIMIT = 2000;

/** One card per product per customer per day — a card on every turn of a
 *  conversation about the same product is noise, not help. */
const CARD_COOLDOWN_SECONDS = 24 * 60 * 60;

/** A title shorter than this never matches — too many false positives. */
const MIN_TITLE_CHARS = 3;

/**
 * A SINGLE-token title must be at least this long to card on.
 *
 * A one-word title short enough to appear in ordinary prose is usually a service
 * line item, not the thing the customer asked about: a store that lists «شحن»
 * (shipping) or «هدية» (gift wrap) as products would otherwise card the shipping
 * item on every «الشحن مجاني» — exactly one match, and exactly wrong. Multi-token
 * titles («Sony A7S III», «قميص قطني رجالي») are distinctive on their own and are
 * not subject to this floor.
 */
const MIN_SINGLE_TOKEN_TITLE_CHARS = 6;

/**
 * Why a mention card was or wasn't produced. Counted in Redis so the feature is
 * measurable in production — the bug this path fixes went unnoticed for months
 * precisely because nothing counted cards (AI_INSTRUCTIONS §17.6).
 */
type MentionOutcome =
    | 'fired'
    | 'no_match'
    | 'several_matches'
    | 'out_of_stock'
    | 'no_image_or_handle'
    | 'no_store'
    | 'scan_capped'
    | 'error';

/** Fire-and-forget diagnostic counter — never blocks or fails a reply. */
function recordMentionOutcome(outcome: MentionOutcome): void {
    redis.incr(`metrics:product_card:mention:${outcome}`).catch(() => { });
}

export async function buildProductCardsFromToolResults(
    storeId: string,
    results: EcommerceToolResult[],
    lang: string,
): Promise<ProductCard[]> {
    const cards: ProductCard[] = [];

    for (const result of results) {
        if (!result.success || !result.data) continue;
        try {
            const card = await extractCardFromResult(storeId, result, lang);
            if (card) cards.push(card);
        } catch (error) {
            // Degrade gracefully — one failed lookup shouldn't kill the reply
            captureError(error, 'Failed to build product card from tool result', {
                tags: { service: 'product-card-builder', tool: result.tool_name },
            });
        }
    }

    return cards;
}

async function extractCardFromResult(
    storeId: string,
    result: EcommerceToolResult,
    lang: string,
): Promise<ProductCard | null> {
    switch (result.tool_name) {
        case 'check_inventory':
            return inventoryToCard(storeId, result.data as unknown as InventoryInfo, lang);
        default:
            return null;
    }
}

async function inventoryToCard(
    storeId: string,
    info: InventoryInfo,
    lang: string,
): Promise<ProductCard | null> {
    // A card without an image isn't worth sending — looks worse than plain text
    const imageUrl = await findProductImage(storeId, info.productName);
    if (!imageUrl) return null;

    // A card without a link is a dead end — defer to text-only reply
    if (!info.productUrl) return null;

    const price = info.price
        ? (info.currency ? `${info.price} ${info.currency}` : info.price)
        : null;

    return buildCard({
        title: info.productName,
        price,
        // The tool asked the platform LIVE, so this is the one path that can
        // state availability as a fact rather than as a sync snapshot.
        availability: info.available ? 'cardInStock' : 'cardOutOfStock',
        productUrl: info.productUrl,
        imageUrl,
        lang,
    });
}

/**
 * The ONE place a ProductCard is shaped. Both sources call it, so the subtitle
 * format and the button label cannot drift apart (Rule 10.8) and neither can
 * silently regress to a hardcoded English string.
 */
function buildCard(input: {
    title: string;
    price: string | null;
    availability: 'cardInStock' | 'cardLowStock' | 'cardOutOfStock' | null;
    productUrl: string;
    imageUrl: string;
    lang: string;
}): ProductCard {
    const parts: string[] = [];
    if (input.price) parts.push(input.price);
    if (input.availability) parts.push(t(input.availability, input.lang));

    return {
        title: input.title,
        subtitle: parts.join(' · '),
        imageUrl: input.imageUrl,
        productUrl: input.productUrl,
        buttons: [
            {
                type: 'web_url',
                title: t('cardViewProduct', input.lang),
                url: input.productUrl,
            },
        ],
    };
}

/**
 * Look up a synced product by title (case-insensitive prefix match) and return
 * its stored image URL. Returns null when no match or no image is available.
 */
async function findProductImage(storeId: string, productName: string): Promise<string | null> {
    const rows = await db
        .select({ imageUrl: ecommerceProducts.imageUrl })
        .from(ecommerceProducts)
        .where(
            and(
                eq(ecommerceProducts.ecommerceStoreId, storeId),
                ilike(ecommerceProducts.title, `${productName}%`),
            ),
        )
        .limit(1);

    return rows[0]?.imageUrl ?? null;
}

// ---------------------------------------------------------------------------
// Mention cards — a card for the ONE product the reply text names
// ---------------------------------------------------------------------------

/**
 * Build a card for the single catalog product a reply text mentions.
 *
 * WHY: tool-result cards (above) only exist when the model calls
 * `check_inventory`. A small catalog is inlined in the prompt whole, so the
 * model answers directly and never calls a tool — which is every new
 * marketplace merchant. Live on the Zid dev store (2026-08-22) the purchase
 * turn «بدي اشتري الكاميرا» got a correct text reply with a bare URL and no
 * card, while every ingredient for one (image, URL, stock) sat in the DB.
 *
 * Contract — deliberately strict, because a wrong card is worse than none:
 *   - EXACTLY ONE catalog product title appears in the reply → card. Zero or
 *     several → [] (the reply is a comparison, a list, or about something else).
 *     The decision is taken over the whole active catalog or not at all: a
 *     catalog larger than MENTION_SCAN_LIMIT returns [] rather than deciding on
 *     a slice, because a second match hiding outside the slice is precisely how
 *     the "several → none" rule stops holding.
 *   - The product must be sellable (`totalInventory` null = untracked/unlimited;
 *     any value <= 0 is not), and have an image and a handle.
 *   - Matching is a normalized substring check (Arabic folded, case-folded):
 *     local, microseconds, no model call (Rule 17). Latin word boundaries are
 *     enforced so `Kit` cannot match "Kitchen"; Arabic proclitics stay matchable
 *     («وقميص» still finds «قميص»), and short single-token titles are rejected
 *     instead (see MIN_SINGLE_TOKEN_TITLE_CHARS).
 *   - Never throws; any failure degrades to text-only.
 *
 * Cost: two indexed reads, only on DM replies for pages with a linked store.
 * Phase 1 pulls `id, title` for the catalog; phase 2 pulls the winning row only.
 */
export async function buildProductCardsFromReplyText(
    storeId: string,
    replyText: string,
    lang: string,
): Promise<ProductCard[]> {
    if (!replyText || replyText.trim().length === 0) return [];
    try {
        const [store] = await db
            .select({ platform: ecommerceStores.platform, storeDomain: ecommerceStores.storeDomain })
            .from(ecommerceStores)
            .where(eq(ecommerceStores.id, storeId))
            .limit(1);
        if (!store?.storeDomain) {
            recordMentionOutcome('no_store');
            return [];
        }

        // Ordered + one row past the cap: `asc(id)` makes the scan reproducible
        // (an unordered LIMIT can return a different subset after a VACUUM or a
        // plan change), and the extra row tells us the decision below would be
        // taken on a partial catalog.
        const titles = await db
            .select({ id: ecommerceProducts.id, title: ecommerceProducts.title })
            .from(ecommerceProducts)
            .where(and(
                eq(ecommerceProducts.ecommerceStoreId, storeId),
                eq(ecommerceProducts.status, 'active'),
            ))
            .orderBy(asc(ecommerceProducts.id))
            .limit(MENTION_SCAN_LIMIT + 1);

        if (titles.length > MENTION_SCAN_LIMIT) {
            // Cannot decide "exactly one" over a catalog we only partly read.
            recordMentionOutcome('scan_capped');
            return [];
        }

        const haystack = foldForMatch(replyText);
        const mentioned = titles.filter(p => mentionsTitle(haystack, foldForMatch(p.title)));
        if (mentioned.length !== 1) {
            recordMentionOutcome(mentioned.length === 0 ? 'no_match' : 'several_matches');
            return [];
        }

        const [p] = await db
            .select({
                title: ecommerceProducts.title,
                handle: ecommerceProducts.handle,
                imageUrl: ecommerceProducts.imageUrl,
                priceRange: ecommerceProducts.priceRange,
                totalInventory: ecommerceProducts.totalInventory,
            })
            .from(ecommerceProducts)
            .where(eq(ecommerceProducts.id, mentioned[0].id))
            .limit(1);
        if (!p) {
            recordMentionOutcome('no_match');
            return [];
        }

        // null = untracked/unlimited (Zid `is_infinite`) — sellable. Anything at
        // or below zero is not: a synced row can go NEGATIVE when the platform
        // allows overselling, and `=== 0` would wave that through as in stock.
        if (p.totalInventory !== null && p.totalInventory <= 0) {
            recordMentionOutcome('out_of_stock');
            return [];
        }
        if (!p.imageUrl || !p.handle) {
            recordMentionOutcome('no_image_or_handle');
            return [];
        }

        recordMentionOutcome('fired');
        return [buildCard({
            title: p.title,
            price: p.priceRange,
            // Availability here comes from the last product SYNC, not from a live
            // platform call the way the tool path's does — so it uses the same
            // three-way vocabulary as the catalog block the model answered from
            // (`ecommerce.ts:buildProductSummary`) and never overstates a thin
            // shelf as a full one.
            availability: p.totalInventory !== null && p.totalInventory <= 5 ? 'cardLowStock' : 'cardInStock',
            productUrl: buildProductUrl(store.platform, store.storeDomain, p.handle),
            imageUrl: p.imageUrl,
            lang,
        })];
    } catch (error) {
        recordMentionOutcome('error');
        captureError(error, 'Failed to build product card from reply text', {
            tags: { service: 'product-card-builder', source: 'reply_text' },
        });
        return [];
    }
}

function foldForMatch(text: string): string {
    return normalizeArabic(text).toLowerCase().trim();
}

/** Latin letters/digits only. Arabic is deliberately excluded — its proclitics
 *  attach («وقميص» = و + قميص), so a boundary test that counted Arabic letters
 *  would reject most legitimate Arabic mentions. Short generic Arabic titles are
 *  handled by the single-token length floor instead. */
const LATIN_WORD_CHAR_RE = /[A-Za-z0-9]/;

/**
 * Does `haystack` (folded reply) name `needle` (folded product title)?
 *
 * A plain `includes` is wrong in two ways, and each has its own guard:
 *   - it cards a store's «شحن» line item on «الشحن مجاني» → the token floor.
 *   - it matches a title glued to the END of a longer Latin word ("Charger"
 *     inside "supercharger") → the LEADING boundary check.
 *
 * ⚠️ The boundary is checked on the LEFT ONLY, and deliberately. A trailing
 * check would read "we sell chargers" as not naming «Charger» — English plurals
 * and Arabic enclitics are the normal way a reply names a product, so blocking
 * them would cost far more real cards than the contrived mid-word collision it
 * would catch. (A trailing check shipped in review and was cut when a mutation
 * test showed it had no case of its own: `Kit` inside "Kitchen" is already
 * rejected by the token floor, three characters before the boundary runs.)
 */
function mentionsTitle(haystack: string, needle: string): boolean {
    if (needle.length < MIN_TITLE_CHARS) return false;
    const isSingleToken = !needle.includes(' ');
    if (isSingleToken && needle.length < MIN_SINGLE_TOKEN_TITLE_CHARS) return false;

    for (let from = 0; ;) {
        const i = haystack.indexOf(needle, from);
        if (i === -1) return false;
        if (!LATIN_WORD_CHAR_RE.test(i > 0 ? haystack[i - 1] : '')) return true;
        from = i + 1;
    }
}

// ---------------------------------------------------------------------------
// Per-customer card cooldown
// ---------------------------------------------------------------------------

const cooldownKey = (pageId: string, senderId: string, productUrl: string) =>
    `product_card:${pageId}:${senderId}:${productUrl}`;

/**
 * Drop cards already sent to this customer for the same product within the
 * cooldown window.
 *
 * ⚠️ This only READS. The window is claimed by {@link markCardsSent} AFTER the
 * platform accepted the send, never before it: a card that failed to deliver (an
 * expired page token, a Meta rate limit, a closed messaging window) must not
 * suppress the next turn's attempt for 24h. Claiming up front inverted the
 * documented failure direction — it produced a MISSING card, which is the one
 * outcome this is supposed to prevent.
 *
 * Fails OPEN — a Redis hiccup yields a possible duplicate card, never a missing
 * one, because the card is the sales moment.
 */
export async function filterRecentlySentCards(
    pageId: string,
    senderId: string,
    cards: ProductCard[],
): Promise<ProductCard[]> {
    if (cards.length === 0) return cards;
    try {
        const seen = await redis.mget(...cards.map(c => cooldownKey(pageId, senderId, c.productUrl)));
        return cards.filter((_, i) => seen[i] === null);
    } catch (error) {
        // Behaviour fails open; the SIGNAL must not. A silently broken cooldown
        // looks exactly like "merchants report card spam" with nothing in Sentry.
        captureError(error, 'Product card cooldown check failed — sending unfiltered', {
            tags: { service: 'product-card-builder', source: 'cooldown_read' },
        });
        return cards;
    }
}

/**
 * Open the 24h window for cards the platform has ACCEPTED. Best-effort: a
 * failure here means the customer may see the card again tomorrow, which is the
 * side of the trade this feature chose.
 */
export async function markCardsSent(
    pageId: string,
    senderId: string,
    cards: ProductCard[],
): Promise<void> {
    if (cards.length === 0) return;
    try {
        const pipeline = redis.pipeline();
        for (const card of cards) {
            pipeline.set(cooldownKey(pageId, senderId, card.productUrl), '1', 'EX', CARD_COOLDOWN_SECONDS);
        }
        await pipeline.exec();
    } catch (error) {
        captureError(error, 'Product card cooldown write failed — card may repeat', {
            tags: { service: 'product-card-builder', source: 'cooldown_write' },
        });
    }
}
