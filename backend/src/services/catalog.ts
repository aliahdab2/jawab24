import { db } from '../db';
import { catalogItems, pages } from '../db/schema';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { MAX_CATALOG_ITEMS_PER_PAGE } from '@jawab24/shared';
import type { CatalogItemType } from '@jawab24/shared';
import { pagesService } from './pages';

/**
 * Native catalog service — merchant-authored offerings for pages WITHOUT a
 * connected e-commerce store.
 *
 * Reply-path contract (Stage 2 v2, the v1 post-mortem lesson): items reach the
 * AI as TEXT via buildCatalogPromptBlock → context.productCatalog → the existing
 * <product_catalog> prompt block. NO AI function-calling tools (D-004). Every
 * write invalidates the page's reply caches (invalidatePageCaches) so the next
 * reply sees the change immediately — same mechanism as business-profile edits.
 */

export class CatalogLimitError extends Error {
    constructor() {
        super(`Catalog limit of ${MAX_CATALOG_ITEMS_PER_PAGE} items per page reached`);
        this.name = 'CatalogLimitError';
    }
}

export interface CreateCatalogItemDTO {
    type?: CatalogItemType;
    name: string;
    description?: string | null;
    price?: number | null;
    currency?: string | null;
    isAvailable?: boolean;
}

export type UpdateCatalogItemDTO = Partial<CreateCatalogItemDTO> & { sortOrder?: number };

/** Prompt-block budget: a full 300-item catalog must degrade gracefully, never
 *  silently. Descriptions are dropped first; then the list truncates at an item
 *  boundary with an explicit non-exhaustive tail so the model can never claim
 *  "we don't sell X" from a cut-off list. */
const PROMPT_BLOCK_MAX_CHARS = 12000;
const PROMPT_DESCRIPTION_MAX_CHARS = 120;

/** Non-default types are tagged so the model distinguishes a course from a part.
 *  'product' is untagged — it's the default and the tag would add nothing. */
const TYPE_TAGS: Record<CatalogItemType, string> = {
    product: '',
    service: '[service] ',
    course: '[course] ',
    vehicle: '[vehicle] ',
    custom: '',
};

class CatalogService {
    /** Ownership gate: the page must belong to the caller's workspace. Returns the
     *  page row or null (controllers translate null → 404, never 403 — don't leak
     *  existence of foreign pages). */
    private async resolvePage(workspaceId: string, pageId: string) {
        const [page] = await db
            .select({ id: pages.id })
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .limit(1);
        return page ?? null;
    }

    async listCatalogItems(workspaceId: string, pageId: string) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return null;

        return db
            .select()
            .from(catalogItems)
            .where(eq(catalogItems.pageId, pageId))
            .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.createdAt))
            .limit(MAX_CATALOG_ITEMS_PER_PAGE);
    }

    async createCatalogItem(workspaceId: string, pageId: string, data: CreateCatalogItemDTO) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return null;

        const [{ value: existing }] = await db
            .select({ value: count() })
            .from(catalogItems)
            .where(eq(catalogItems.pageId, pageId));
        if (existing >= MAX_CATALOG_ITEMS_PER_PAGE) throw new CatalogLimitError();

        const [item] = await db
            .insert(catalogItems)
            .values({
                pageId,
                type: data.type ?? 'product',
                name: data.name,
                description: data.description ?? null,
                price: typeof data.price === 'number' ? data.price.toFixed(2) : null,
                currency: data.currency ?? null,
                isAvailable: data.isAvailable ?? true,
                // Append to the end of the merchant's list.
                sortOrder: sql`COALESCE((SELECT MAX(${catalogItems.sortOrder}) + 1 FROM ${catalogItems} WHERE ${catalogItems.pageId} = ${pageId}), 0)`,
            })
            .returning();

        await pagesService.invalidatePageCaches(pageId);
        return item;
    }

    async updateCatalogItem(workspaceId: string, pageId: string, itemId: string, data: UpdateCatalogItemDTO) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return null;

        const values: Record<string, unknown> = { updatedAt: new Date() };
        if (data.type !== undefined) values.type = data.type;
        if (data.name !== undefined) values.name = data.name;
        if (data.description !== undefined) values.description = data.description;
        if (data.price !== undefined) values.price = typeof data.price === 'number' ? data.price.toFixed(2) : null;
        if (data.currency !== undefined) values.currency = data.currency;
        if (data.isAvailable !== undefined) values.isAvailable = data.isAvailable;
        if (data.sortOrder !== undefined) values.sortOrder = data.sortOrder;

        const [item] = await db
            .update(catalogItems)
            .set(values)
            .where(and(eq(catalogItems.id, itemId), eq(catalogItems.pageId, pageId)))
            .returning();
        if (!item) return null;

        await pagesService.invalidatePageCaches(pageId);
        return item;
    }

    async deleteCatalogItem(workspaceId: string, pageId: string, itemId: string) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return false;

        const deleted = await db
            .delete(catalogItems)
            .where(and(eq(catalogItems.id, itemId), eq(catalogItems.pageId, pageId)))
            .returning({ id: catalogItems.id });
        if (deleted.length === 0) return false;

        await pagesService.invalidatePageCaches(pageId);
        return true;
    }

    /** Items that can back a DM photo-card (Release 2 consumer). */
    async getCatalogItemsForCards(pageId: string) {
        return db
            .select()
            .from(catalogItems)
            .where(and(eq(catalogItems.pageId, pageId), sql`${catalogItems.imageUrl} IS NOT NULL`))
            .orderBy(asc(catalogItems.sortOrder))
            .limit(MAX_CATALOG_ITEMS_PER_PAGE);
    }

    /**
     * Render the page's catalog for the <product_catalog> prompt block.
     * Returns undefined when the page has no items (the block is omitted and the
     * prompt stays byte-identical to today — the Phase B inertness guarantee).
     */
    async buildCatalogPromptBlock(pageId: string): Promise<string | undefined> {
        const items = await db
            .select()
            .from(catalogItems)
            .where(eq(catalogItems.pageId, pageId))
            .orderBy(asc(catalogItems.sortOrder), asc(catalogItems.createdAt))
            .limit(MAX_CATALOG_ITEMS_PER_PAGE);
        return renderCatalogPromptBlock(items);
    }
}

/** The subset of a catalog_items row the renderer needs (pure — unit-testable without db). */
export interface CatalogPromptItem {
    type: string;
    name: string;
    description: string | null;
    price: string | null;
    currency: string | null;
    isAvailable: boolean;
}

/**
 * Pure renderer behind buildCatalogPromptBlock.
 *
 * Prices render as plain numerals (e.g. "3500 EGP") so the deterministic price
 * guard (collectKbValues) parses them; availability vocabulary matches the
 * e-commerce summary ("in stock" / "out of stock") so the model sees one
 * convention across store-synced and manual catalogs. Over budget the list
 * degrades loudly, never silently: descriptions drop first, then the list
 * truncates at an item boundary with an explicit non-exhaustive tail.
 */
export function renderCatalogPromptBlock(items: CatalogPromptItem[]): string | undefined {
    if (items.length === 0) return undefined;

    const renderItem = (item: CatalogPromptItem, withDescription: boolean): string => {
        const tag = TYPE_TAGS[(item.type as CatalogItemType)] ?? '';
        const parts = [`${tag}${item.name}`];
        parts.push(item.price !== null ? `${formatPrice(item.price)}${item.currency ? ` ${item.currency}` : ''}` : 'price on request');
        parts.push(item.isAvailable ? 'in stock' : 'out of stock');
        if (withDescription && item.description) {
            parts.push(item.description.length > PROMPT_DESCRIPTION_MAX_CHARS
                ? `${item.description.slice(0, PROMPT_DESCRIPTION_MAX_CHARS)}…`
                : item.description);
        }
        return `- ${parts.join(' — ')}`;
    };

    const render = (withDescription: boolean): string =>
        ['Items this business offers (merchant-entered):', ...items.map(i => renderItem(i, withDescription))].join('\n');

    let block = render(true);
    if (block.length > PROMPT_BLOCK_MAX_CHARS) block = render(false);
    if (block.length > PROMPT_BLOCK_MAX_CHARS) {
        const lines = render(false).split('\n');
        const kept: string[] = [lines[0]];
        let length = lines[0].length;
        for (const line of lines.slice(1)) {
            if (length + line.length + 1 > PROMPT_BLOCK_MAX_CHARS - 80) break; // reserve room for the tail
            kept.push(line);
            length += line.length + 1;
        }
        const omitted = items.length - (kept.length - 1);
        kept.push(`(+${omitted} more items not listed — this list is NOT exhaustive)`);
        block = kept.join('\n');
    }
    return block;
}

/** "3500.00" → "3500", "49.99" → "49.99" — plain numerals for the price guard. */
function formatPrice(price: string): string {
    const num = Number(price);
    return Number.isFinite(num) ? String(num) : price;
}

export const catalogService = new CatalogService();
