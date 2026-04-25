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
import { ecommerceProducts } from '../../db/schema';
import { captureError } from '../../utils/sentryHelpers';
import type { EcommerceToolResult, InventoryInfo, ProductCard } from '@jawab24/shared';

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
