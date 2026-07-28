import { db } from '../db';
import { formatPromptPrice } from '../utils/price';
import { catalogItems, pages } from '../db/schema';
import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm';
import {
    CATALOG_VERTICALS, MAX_CATALOG_ITEMS_PER_PAGE, mergedBusinessProfile, verticalFromFbCategory,
} from '@jawab24/shared';
import type {
    CatalogItemAttribute, CatalogItemType, CatalogVertical, CatalogVerticalSource, StoredBusinessProfile,
} from '@jawab24/shared';
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

/**
 * Thrown when a write targets a page with a connected e-commerce store. Two
 * reasons manual items are blocked there: (a) contextEnricher's store branch
 * wins, so the items would silently never reach the AI; (b) every catalog
 * write bumps kbActiveVersion WITHOUT re-ingesting chunks, and e-commerce
 * pages are the only ones still on the RAG path with an exact kb_version
 * filter — one write would orphan all their chunks until the next store sync.
 */
export class CatalogStoreConflictError extends Error {
    constructor() {
        super('This page gets its catalog from a connected store; manual items are disabled');
        this.name = 'CatalogStoreConflictError';
    }
}

/** Effective vertical + where it came from — the UI prefill (never asks when
 *  Facebook already told us the business type). */
export interface CatalogVerticalInfo {
    effective: CatalogVertical;
    source: CatalogVerticalSource;
}

/**
 * Pure vertical resolution (unit-testable without db): merchant override wins,
 * then the FB page category (merged profile — a merchant-edited category also
 * wins over the FB suggestion), then 'other'. An invalid stored value (enum
 * drift after a rename) falls through to derivation instead of breaking the UI.
 */
export function resolveCatalogVertical(
    stored: string | null,
    businessProfile: StoredBusinessProfile,
): CatalogVerticalInfo {
    if (stored && (CATALOG_VERTICALS as string[]).includes(stored)) {
        return { effective: stored as CatalogVertical, source: 'merchant' };
    }
    const derived = verticalFromFbCategory(mergedBusinessProfile(businessProfile).category);
    if (derived) return { effective: derived, source: 'facebook' };
    return { effective: 'other', source: 'default' };
}

export interface CreateCatalogItemDTO {
    type?: CatalogItemType;
    name: string;
    description?: string | null;
    price?: number | null;
    currency?: string | null;
    isAvailable?: boolean;
    /** 'YYYY-MM-DD' calendar dates (validated upstream by CatalogDateInput). */
    startsAt?: string | null;
    endsAt?: string | null;
    attributes?: CatalogItemAttribute[] | null;
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
     *  page row (id + userId for activation telemetry + ecommerceStoreId for the
     *  store-conflict guard) or null (controllers translate null → 404, never
     *  403 — don't leak existence of foreign pages). */
    private async resolvePage(workspaceId: string, pageId: string) {
        const [page] = await db
            .select({ id: pages.id, userId: pages.userId, ecommerceStoreId: pages.ecommerceStoreId })
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

    /** Effective vertical for the page (merchant override → FB category → 'other').
     *  Null when the page isn't in the workspace (controllers → 404). */
    async getPageVertical(workspaceId: string, pageId: string): Promise<CatalogVerticalInfo | null> {
        const [page] = await db
            .select({ catalogVertical: pages.catalogVertical, businessProfile: pages.businessProfile })
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .limit(1);
        if (!page) return null;
        return resolveCatalogVertical(page.catalogVertical, page.businessProfile as StoredBusinessProfile);
    }

    /**
     * Merchant override of the vertical. No cache bump — the vertical shapes
     * catalog-UI defaults and extraction hints only, never the reply prompt.
     */
    async setPageVertical(workspaceId: string, pageId: string, vertical: CatalogVertical): Promise<CatalogVerticalInfo | null> {
        const [updated] = await db
            .update(pages)
            .set({ catalogVertical: vertical, updatedAt: new Date() })
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .returning({ id: pages.id });
        if (!updated) return null;
        return { effective: vertical, source: 'merchant' };
    }

    /**
     * Create an item. Returns `{ item, pageUserId }` (userId feeds the caller's
     * fire-and-forget activation event without a second page query), or null
     * when the page isn't in the workspace. Row insert + cache-version bump are
     * one transaction: a bump that never lands would leave replies serving the
     * pre-write catalog until cache TTL (worst on delete — see M2 in PR #407).
     */
    async createCatalogItem(workspaceId: string, pageId: string, data: CreateCatalogItemDTO) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return null;
        if (page.ecommerceStoreId) throw new CatalogStoreConflictError();

        const [{ value: existing }] = await db
            .select({ value: count() })
            .from(catalogItems)
            .where(eq(catalogItems.pageId, pageId));
        if (existing >= MAX_CATALOG_ITEMS_PER_PAGE) throw new CatalogLimitError();

        const item = await db.transaction(async (tx) => {
            const [created] = await tx
                .insert(catalogItems)
                .values({
                    pageId,
                    type: data.type ?? 'product',
                    name: data.name,
                    description: data.description ?? null,
                    price: typeof data.price === 'number' ? data.price.toFixed(2) : null,
                    currency: data.currency ?? null,
                    isAvailable: data.isAvailable ?? true,
                    startsAt: data.startsAt ?? null,
                    endsAt: data.endsAt ?? null,
                    attributes: data.attributes ?? null,
                    // Append to the end of the merchant's list.
                    sortOrder: sql`COALESCE((SELECT MAX(${catalogItems.sortOrder}) + 1 FROM ${catalogItems} WHERE ${catalogItems.pageId} = ${pageId}), 0)`,
                })
                .returning();
            await pagesService.invalidatePageCaches(pageId, tx);
            return created;
        });
        return { item, pageUserId: page.userId };
    }

    async updateCatalogItem(workspaceId: string, pageId: string, itemId: string, data: UpdateCatalogItemDTO) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return null;
        if (page.ecommerceStoreId) throw new CatalogStoreConflictError();

        const values: Record<string, unknown> = { updatedAt: new Date() };
        if (data.type !== undefined) values.type = data.type;
        if (data.name !== undefined) values.name = data.name;
        if (data.description !== undefined) values.description = data.description;
        if (data.price !== undefined) values.price = typeof data.price === 'number' ? data.price.toFixed(2) : null;
        if (data.currency !== undefined) values.currency = data.currency;
        if (data.isAvailable !== undefined) values.isAvailable = data.isAvailable;
        if (data.startsAt !== undefined) values.startsAt = data.startsAt;
        if (data.endsAt !== undefined) values.endsAt = data.endsAt;
        if (data.attributes !== undefined) values.attributes = data.attributes;
        if (data.sortOrder !== undefined) values.sortOrder = data.sortOrder;

        return db.transaction(async (tx) => {
            const [item] = await tx
                .update(catalogItems)
                .set(values)
                .where(and(eq(catalogItems.id, itemId), eq(catalogItems.pageId, pageId)))
                .returning();
            if (!item) return null;
            await pagesService.invalidatePageCaches(pageId, tx);
            return item;
        });
    }

    async deleteCatalogItem(workspaceId: string, pageId: string, itemId: string) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return false;
        if (page.ecommerceStoreId) throw new CatalogStoreConflictError();

        return db.transaction(async (tx) => {
            const deleted = await tx
                .delete(catalogItems)
                .where(and(eq(catalogItems.id, itemId), eq(catalogItems.pageId, pageId)))
                .returning({ id: catalogItems.id });
            if (deleted.length === 0) return false;
            await pagesService.invalidatePageCaches(pageId, tx);
            return true;
        });
    }

    /**
     * How many more items the page can take. Gates the import extract endpoint
     * BEFORE any LLM spend. Same null/throw semantics as the other methods:
     * null = page not in workspace (404), store pages throw (409).
     */
    async getCatalogCapacity(workspaceId: string, pageId: string) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return null;
        if (page.ecommerceStoreId) throw new CatalogStoreConflictError();

        const [{ value: existing }] = await db
            .select({ value: count() })
            .from(catalogItems)
            .where(eq(catalogItems.pageId, pageId));
        return { remaining: Math.max(0, MAX_CATALOG_ITEMS_PER_PAGE - existing), pageUserId: page.userId };
    }

    /**
     * Create many items in ONE transaction — the import flow's save step.
     * All-or-nothing: the capacity check runs INSIDE the transaction (unlike
     * single-create's pre-check, a 100-row batch racing another writer matters),
     * and a limit breach rolls back every row. One cache bump for the whole
     * batch instead of N.
     */
    async createCatalogItemsBatch(workspaceId: string, pageId: string, items: CreateCatalogItemDTO[]) {
        const page = await this.resolvePage(workspaceId, pageId);
        if (!page) return null;
        if (page.ecommerceStoreId) throw new CatalogStoreConflictError();

        const created = await db.transaction(async (tx) => {
            const [{ value: existing }] = await tx
                .select({ value: count() })
                .from(catalogItems)
                .where(eq(catalogItems.pageId, pageId));
            if (existing + items.length > MAX_CATALOG_ITEMS_PER_PAGE) throw new CatalogLimitError();

            const [{ base }] = await tx
                .select({ base: sql<number>`COALESCE(MAX(${catalogItems.sortOrder}) + 1, 0)` })
                .from(catalogItems)
                .where(eq(catalogItems.pageId, pageId));

            const rows = await tx
                .insert(catalogItems)
                .values(items.map((data, i) => ({
                    pageId,
                    type: data.type ?? 'product',
                    name: data.name,
                    description: data.description ?? null,
                    price: typeof data.price === 'number' ? data.price.toFixed(2) : null,
                    currency: data.currency ?? null,
                    isAvailable: data.isAvailable ?? true,
                    startsAt: data.startsAt ?? null,
                    endsAt: data.endsAt ?? null,
                    attributes: data.attributes ?? null,
                    sortOrder: base + i, // append after the merchant's existing order
                })))
                .returning();
            await pagesService.invalidatePageCaches(pageId, tx);
            return rows;
        });
        return { items: created, pageUserId: page.userId };
    }

    /**
     * Render the page's catalog for the <product_catalog> prompt block.
     * Returns undefined when the page has no items (the block is omitted and the
     * prompt stays byte-identical to today — the Phase B inertness guarantee).
     *
     * Items past their endsAt are EXCLUDED here (kb_chunks valid_until
     * precedent) — the AI must never offer an ended cohort/offer. They stay in
     * the merchant UI with an "Ended" badge until edited or deleted.
     */
    async buildCatalogPromptBlock(pageId: string): Promise<string | undefined> {
        const items = await db
            .select()
            .from(catalogItems)
            .where(and(
                eq(catalogItems.pageId, pageId),
                or(isNull(catalogItems.endsAt), sql`${catalogItems.endsAt} >= CURRENT_DATE`),
            ))
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
    /** 'YYYY-MM-DD' or null. Rendered verbatim — the model reasons against the
     *  prompt's "Today's date" line (D-006), no date math here. */
    startsAt?: string | null;
    endsAt?: string | null;
    attributes?: CatalogItemAttribute[] | null;
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

    const renderItem = (item: CatalogPromptItem, withDetails: boolean): string => {
        const tag = TYPE_TAGS[(item.type as CatalogItemType)] ?? '';
        const parts = [`${tag}${item.name}`];
        parts.push(item.price !== null ? `${formatPromptPrice(item.price)}${item.currency ? ` ${item.currency}` : ''}` : 'price on request');
        parts.push(item.isAvailable ? 'in stock' : 'out of stock');
        // Dates survive every degradation tier — tiny, and semantically critical
        // (the model judges past/upcoming against its "Today's date" line).
        if (item.startsAt) parts.push(`starts ${item.startsAt}`);
        if (item.endsAt) parts.push(`ends ${item.endsAt}`);
        if (withDetails && item.attributes) {
            for (const attr of item.attributes) parts.push(`${attr.label}: ${attr.value}`);
        }
        if (withDetails && item.description) {
            parts.push(item.description.length > PROMPT_DESCRIPTION_MAX_CHARS
                ? `${item.description.slice(0, PROMPT_DESCRIPTION_MAX_CHARS)}…`
                : item.description);
        }
        return `- ${parts.join(' — ')}`;
    };

    const render = (withDetails: boolean): string =>
        ['Items this business offers (merchant-entered):', ...items.map(i => renderItem(i, withDetails))].join('\n');

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


export const catalogService = new CatalogService();
