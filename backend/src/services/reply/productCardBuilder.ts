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
import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db';
import { redis } from '../../lib/redis';
import { ecommerceProducts, ecommerceStores } from '../../db/schema';
import { captureError } from '../../utils/sentryHelpers';
import { productUrlFor, getProductByPlatformId } from '../ecommerce';
import { t } from '../../utils/i18n';
import { normalizeArabic, availabilityOf } from '@jawab24/shared';
import { META_TEMPLATE_LIMITS } from '../metaMessaging';
import type { EcommerceToolResult, InventoryInfo, ProductCard, StockAvailability } from '@jawab24/shared';

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

/** Why a TOOL-result card was or wasn't produced — this path emitted nothing until D-092. */
type ToolCardOutcome = 'fired' | 'no_identity' | 'no_image' | 'no_url' | 'error';

/** Why a LINK card was or wasn't produced (per linked product). */
type LinkCardOutcome = 'fired' | 'out_of_stock' | 'no_image' | 'capped';

/**
 * Fire-and-forget diagnostic counter — never blocks or fails a reply.
 * `metrics:product_card:{source}:{outcome}`; the mention keys are unchanged
 * from before the tool source was added, so existing reads keep working.
 */
function recordCardOutcome(source: 'mention', outcome: MentionOutcome): void;
function recordCardOutcome(source: 'tool', outcome: ToolCardOutcome): void;
function recordCardOutcome(source: 'link', outcome: LinkCardOutcome): void;
function recordCardOutcome(source: 'mention' | 'tool' | 'link', outcome: string): void {
    try {
        redis.incr(`metrics:product_card:${source}:${outcome}`).catch(() => { });
    } catch {
        // never on the reply path
    }
}
const recordMentionOutcome = (outcome: MentionOutcome) => recordCardOutcome('mention', outcome);

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
            recordCardOutcome('tool', 'error');
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

/**
 * A tool-result card is keyed on the product the resolver CHOSE
 * (`platformProductId`), never re-resolved by name: the old `ILIKE 'title%'`
 * lookup was a second, different matcher, and a card could show a product the
 * answer never named. A result without identity (an old cached shape during
 * rollout) gets no card rather than a guessed one.
 */
async function inventoryToCard(
    storeId: string,
    info: InventoryInfo,
    lang: string,
): Promise<ProductCard | null> {
    if (!info.platformProductId) {
        recordCardOutcome('tool', 'no_identity');
        return null;
    }

    // A card without a link is a dead end — defer to text-only reply
    if (!info.productUrl) {
        recordCardOutcome('tool', 'no_url');
        return null;
    }

    // The image rides on the result when the resolver had it; otherwise read
    // the row by key. A card without an image looks worse than plain text.
    const imageUrl = info.imageUrl
        ?? (await getProductByPlatformId(storeId, info.platformProductId, { sellable: false }))?.imageUrl
        ?? null;
    if (!imageUrl) {
        recordCardOutcome('tool', 'no_image');
        return null;
    }

    recordCardOutcome('tool', 'fired');
    return buildCard({
        title: info.productName,
        // `price` already carries its currency ("10000 SAR") — printed once.
        price: info.price ?? null,
        availability: cardAvailability(info.availability ?? (info.available ? 'in_stock' : 'out_of_stock')),
        productUrl: info.productUrl,
        imageUrl,
        lang,
    });
}

/** The card's three-way vocabulary, from the shared ladder. */
function cardAvailability(availability: StockAvailability): 'cardInStock' | 'cardLowStock' | 'cardOutOfStock' {
    switch (availability) {
        case 'out_of_stock': return 'cardOutOfStock';
        case 'low_stock': return 'cardLowStock';
        default: return 'cardInStock';
    }
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
 *   - A LINKED product is resolved first (2026-08-23). Since D-097 the model's
 *     catalog block carries each product's real storefront URL, and a reply
 *     that links one names it with no ambiguity at all — which is exactly what
 *     title matching cannot do on a catalog with repeated titles (the Salla
 *     demo store: 9 × «فستان», 5 × «تنورة» → `several_matches` on every turn,
 *     while the reply's own link pointed at one specific row). Every in-stock
 *     linked product with an image gets a card, in reply order, up to the
 *     Generic Template's carousel limit. Only when the reply links nothing
 *     does the title rule below apply.
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
            .select({
                id: ecommerceProducts.id,
                title: ecommerceProducts.title,
                handle: ecommerceProducts.handle,
                productUrl: ecommerceProducts.productUrl,
            })
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

        // Link-first: the reply's own product URLs are an exact identity.
        const linkedIds = linkedProductIds(replyText, store, titles);
        if (linkedIds.length > 0) {
            const linked = await buildCardsForLinkedProducts(linkedIds, store, lang);
            if (linked.length > 0) return linked;
            // Every linked product was unsellable or image-less — fall through to
            // the title rule rather than return nothing on a reply that still
            // names one product in prose.
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
                productUrl: ecommerceProducts.productUrl,
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
        // A card needs somewhere to send the customer. `productUrlFor` is the
        // platform-canonical URL or one derived from the handle — Salla rows have
        // no handle, so gating on `handle` alone suppressed every Salla card.
        const productUrl = productUrlFor(store, p);
        if (!p.imageUrl || !productUrl) {
            recordMentionOutcome('no_image_or_handle');
            return [];
        }

        recordMentionOutcome('fired');
        return [buildCard({
            title: p.title,
            price: p.priceRange,
            // Availability here comes from the last product SYNC — the same
            // shared ladder the catalog block and the KB chunks read, so a thin
            // shelf is never overstated as a full one. (The scan above admits
            // only `active` rows, so the status branch of the ladder cannot fire.)
            availability: cardAvailability(availabilityOf(p)),
            productUrl,
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

/**
 * Storefront URLs a reply carries, each in the ONE canonical form the catalog
 * stores them in: percent-decoded (the model sometimes emits the encoded form of
 * an Arabic path), scheme-normalised, no trailing punctuation or slash. Bounded
 * by the carousel limit — a reply is not a sitemap.
 */
const REPLY_URL_RE = /https?:\/\/[^\s<>"'()[\]،؛]+/g;
const TRAILING_PUNCT_RE = /[.,;:!?»\u060C\u061B]+$/;

function replyUrls(replyText: string): string[] {
    const found = new Set<string>();
    for (const raw of replyText.match(REPLY_URL_RE) ?? []) {
        const trimmed = raw.replace(TRAILING_PUNCT_RE, '');
        let decoded = trimmed;
        try { decoded = decodeURIComponent(trimmed); } catch { /* malformed escape — keep as written */ }
        const canon = canonicalUrl(decoded);
        if (canon) found.add(canon);
        if (found.size >= META_TEMPLATE_LIMITS.maxCards) break;
    }
    return [...found];
}

function canonicalUrl(url: string): string | null {
    if (!/^https?:\/\//i.test(url)) return null;
    return url.replace(/\/+$/, '');
}

/** Catalog ids whose canonical storefront URL appears in the reply, in reply order. */
function linkedProductIds(
    replyText: string,
    store: { platform: string | null; storeDomain: string | null },
    catalog: Array<{ id: string; handle: string | null; productUrl: string | null }>,
): string[] {
    const urls = replyUrls(replyText);
    if (urls.length === 0) return [];
    const byUrl = new Map<string, string>();
    for (const p of catalog) {
        const canon = canonicalUrl(productUrlFor(store, p) ?? '');
        if (canon && !byUrl.has(canon)) byUrl.set(canon, p.id);
    }
    const ids: string[] = [];
    for (const u of urls) {
        const id = byUrl.get(u);
        if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
}

/** One card per linked, sellable, imaged product — reply order, carousel-capped. */
async function buildCardsForLinkedProducts(
    ids: string[],
    store: { platform: string | null; storeDomain: string | null },
    lang: string,
): Promise<ProductCard[]> {
    const rows = await db
        .select({
            id: ecommerceProducts.id,
            title: ecommerceProducts.title,
            handle: ecommerceProducts.handle,
            productUrl: ecommerceProducts.productUrl,
            imageUrl: ecommerceProducts.imageUrl,
            priceRange: ecommerceProducts.priceRange,
            totalInventory: ecommerceProducts.totalInventory,
        })
        .from(ecommerceProducts)
        .where(inArray(ecommerceProducts.id, ids))
        .limit(ids.length);
    const byId = new Map(rows.map(r => [r.id, r]));

    const cards: ProductCard[] = [];
    for (const id of ids) {
        const p = byId.get(id);
        if (!p) continue;
        if (cards.length >= META_TEMPLATE_LIMITS.maxCards) {
            recordCardOutcome('link', 'capped');
            break;
        }
        // Same sellability rule as the title path: null = untracked/unlimited.
        if (p.totalInventory !== null && p.totalInventory <= 0) {
            recordCardOutcome('link', 'out_of_stock');
            continue;
        }
        const productUrl = productUrlFor(store, p);
        if (!p.imageUrl || !productUrl) {
            recordCardOutcome('link', 'no_image');
            continue;
        }
        recordCardOutcome('link', 'fired');
        cards.push(buildCard({
            title: p.title,
            price: p.priceRange,
            availability: cardAvailability(availabilityOf(p)),
            productUrl,
            imageUrl: p.imageUrl,
            lang,
        }));
    }
    return cards;
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
        const kept = cards.filter((_, i) => seen[i] === null);
        // Counted, because a card built and then swallowed here used to be
        // indistinguishable from a card sent: on the Zid dev store the builder
        // reported `fired=2` for ONE delivered card (2026-08-22).
        for (let i = kept.length; i < cards.length; i++) {
            try { redis.incr('metrics:product_card:cooldown:suppressed').catch(() => { }); } catch { /* diagnostic only */ }
        }
        return kept;
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
