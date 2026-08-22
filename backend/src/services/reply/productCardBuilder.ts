/**
 * Builds ProductCard[] from ecommerce tool results.
 *
 * Runs after the tool loop inside `ecommerceToolLoop.ts` and converts tool
 * results that carry product references (currently just `check_inventory`)
 * into rich-card payloads sent as a follow-up to the text reply.
 *
 * Contract:
 *   - Returns [] when no tool result has enough data for a card (image + URL).
 *   - Never throws — a DB lookup failure degrades gracefully to text-only reply.
 *   - Image URL comes from `ecommerceProducts.imageUrl` (populated by product sync).
 *     When the store hasn't synced images yet, the tool reply stays text-only.
 *
 * Extension point: Phase 4a will add `recommend_products` — its results will also
 * flow through here. Add a new case in `extractCardsFromResult()` at that point.
 */
import { and, eq, ilike } from 'drizzle-orm';
import { db } from '../../db';
import { redis } from '../../lib/redis';
import { ecommerceProducts, ecommerceStores } from '../../db/schema';
import { captureError } from '../../utils/sentryHelpers';
import { buildProductUrl } from '../ecommerce';
import { normalizeArabic } from '@jawab24/shared';
import type { EcommerceToolResult, InventoryInfo, ProductCard } from '@jawab24/shared';

/**
 * Upper bound on catalog rows scanned for a mention match. The catalog block
 * the model answers from is capped at 15 products / ~1200 chars, so a reply
 * can only ever name a product from a small set; 200 keeps the scan bounded
 * for large stores without ever cutting a product the reply could mention.
 */
const MENTION_SCAN_LIMIT = 200;

/** One card per product per customer per day — a card on every turn of a
 *  conversation about the same product is noise, not help. */
const CARD_COOLDOWN_SECONDS = 24 * 60 * 60;

export async function buildProductCardsFromToolResults(
    storeId: string,
    results: EcommerceToolResult[],
): Promise<ProductCard[]> {
    const cards: ProductCard[] = [];

    for (const result of results) {
        if (!result.success || !result.data) continue;
        try {
            const card = await extractCardFromResult(storeId, result);
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
): Promise<ProductCard | null> {
    switch (result.tool_name) {
        case 'check_inventory':
            return inventoryToCard(storeId, result.data as unknown as InventoryInfo);
        default:
            return null;
    }
}

async function inventoryToCard(
    storeId: string,
    info: InventoryInfo,
): Promise<ProductCard | null> {
    // A card without an image isn't worth sending — looks worse than plain text
    const imageUrl = await findProductImage(storeId, info.productName);
    if (!imageUrl) return null;

    // A card without a link is a dead end — defer to text-only reply
    if (!info.productUrl) return null;

    const subtitle = formatInventorySubtitle(info);

    return {
        title: info.productName,
        subtitle,
        imageUrl,
        productUrl: info.productUrl,
        buttons: [
            {
                type: 'web_url',
                title: 'View product',
                url: info.productUrl,
            },
        ],
    };
}

function formatInventorySubtitle(info: InventoryInfo): string {
    const parts: string[] = [];
    if (info.price) {
        parts.push(info.currency ? `${info.price} ${info.currency}` : info.price);
    }
    parts.push(info.available ? 'In stock' : 'Out of stock');
    return parts.join(' · ');
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
 *   - The product must be in stock (totalInventory null = unlimited, or > 0),
 *     have an image and a handle. Out-of-stock products never get a buy card.
 *   - Matching is a normalized substring check (Arabic folded, case-folded):
 *     local, microseconds, no model call (Rule 17). Titles shorter than 3
 *     characters never match — too many false positives.
 *   - Never throws; any failure degrades to text-only.
 *
 * Cost: two indexed reads, only on DM replies for pages with a linked store.
 */
export async function buildProductCardsFromReplyText(
    storeId: string,
    replyText: string,
): Promise<ProductCard[]> {
    if (!replyText || replyText.trim().length === 0) return [];
    try {
        const [store] = await db
            .select({ platform: ecommerceStores.platform, storeDomain: ecommerceStores.storeDomain })
            .from(ecommerceStores)
            .where(eq(ecommerceStores.id, storeId))
            .limit(1);
        if (!store?.storeDomain) return [];

        const products = await db
            .select({
                title: ecommerceProducts.title,
                handle: ecommerceProducts.handle,
                imageUrl: ecommerceProducts.imageUrl,
                priceRange: ecommerceProducts.priceRange,
                totalInventory: ecommerceProducts.totalInventory,
            })
            .from(ecommerceProducts)
            .where(and(
                eq(ecommerceProducts.ecommerceStoreId, storeId),
                eq(ecommerceProducts.status, 'active'),
            ))
            .limit(MENTION_SCAN_LIMIT);

        const haystack = foldForMatch(replyText);
        const mentioned = products.filter(p => {
            const needle = foldForMatch(p.title);
            return needle.length >= 3 && haystack.includes(needle);
        });
        if (mentioned.length !== 1) return [];

        const p = mentioned[0];
        // null = untracked/unlimited (Zid `is_infinite`) — sellable. 0 = not.
        if (p.totalInventory === 0) return [];
        if (!p.imageUrl || !p.handle) return [];

        const productUrl = buildProductUrl(store.platform, store.storeDomain, p.handle);
        return [{
            title: p.title,
            subtitle: p.priceRange ? `${p.priceRange} · In stock` : 'In stock',
            imageUrl: p.imageUrl,
            productUrl,
            buttons: [{ type: 'web_url', title: 'View product', url: productUrl }],
        }];
    } catch (error) {
        captureError(error, 'Failed to build product card from reply text', {
            tags: { service: 'product-card-builder', source: 'reply_text' },
        });
        return [];
    }
}

function foldForMatch(text: string): string {
    return normalizeArabic(text).toLowerCase().trim();
}

/**
 * Drop cards already sent to this customer for the same product within the
 * cooldown. Same Redis `SET NX EX` shape as the away-message cooldown: the
 * first send claims the key, later ones within the window are filtered out.
 * Fails OPEN — a Redis hiccup yields a possible duplicate card, never a
 * missing one, because the card is the sales moment.
 */
export async function filterRecentlySentCards(
    pageId: string,
    senderId: string,
    cards: ProductCard[],
): Promise<ProductCard[]> {
    if (cards.length === 0) return cards;
    const kept: ProductCard[] = [];
    for (const card of cards) {
        try {
            const acquired = await redis.set(
                `product_card:${pageId}:${senderId}:${card.productUrl}`, '1', 'EX', CARD_COOLDOWN_SECONDS, 'NX',
            );
            if (acquired !== null) kept.push(card);
        } catch {
            kept.push(card);
        }
    }
    return kept;
}
