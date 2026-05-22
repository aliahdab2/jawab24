import { and, desc, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { catalogItems, pages } from '../db/schema';

/** Transaction or top-level db handle — both expose the same query builder surface. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Stage 2.2 — catalog service.
 *
 * Workspace scoping: every method takes a `workspaceId` and verifies the
 * parent page belongs to it before reading or mutating. Catalog items are
 * always reached via their owning page; there is no cross-page list.
 *
 * Writes bump `pages.kbVersion` so the semantic cache (scoped by
 * `kbActiveVersionAtCreation`) invalidates whenever the merchant changes
 * structured catalog content. This mirrors how `pages.updatePage` bumps
 * the version when the free-text KB changes.
 */

export type CatalogItemType = 'course' | 'product' | 'service' | 'event' | 'branch' | 'package';
export const CATALOG_ITEM_TYPES: readonly CatalogItemType[] = [
    'course', 'product', 'service', 'event', 'branch', 'package',
] as const;

export type CatalogStatus = 'active' | 'expired' | 'archived' | 'all';

export interface ListFilters {
    type?: CatalogItemType;
    status?: CatalogStatus;
}

export interface CreateCatalogItemInput {
    type: CatalogItemType;
    name: string;
    description?: string | null;
    priceMinor?: number | null;
    currency?: string | null;
    startsAt?: Date | null;
    endsAt?: Date | null;
    enrollmentClosesAt?: Date | null;
    metadata?: Record<string, unknown>;
}

export type UpdateCatalogItemInput = Partial<CreateCatalogItemInput> & {
    archivedAt?: Date | null;
};

class CatalogService {
    /** Returns true if the page exists in the workspace. */
    private async pageBelongsToWorkspace(workspaceId: string, pageId: string): Promise<boolean> {
        const rows = await db
            .select({ id: pages.id })
            .from(pages)
            .where(and(eq(pages.id, pageId), eq(pages.workspaceId, workspaceId)))
            .limit(1);
        return rows.length > 0;
    }

    /**
     * Bump `kbVersion` on the parent page on every catalog write.
     *
     * NOTE: This bumps the *incoming* version (`kbVersion`), not `kbActiveVersion`.
     * Stage 2.2 has no ingestion step that promotes catalog edits to the active
     * version, so the semantic cache — which filters by `kbActiveVersionAtCreation`
     * — does NOT auto-invalidate on catalog edits. That's tolerable for now
     * because Stage 2.3 will route catalog questions through tool calls (each
     * turn re-queries the live row), bypassing cache for that traffic. Revisit
     * if cached free-text replies are observed quoting stale catalog data.
     */
    private async bumpKbVersion(tx: Tx, pageId: string): Promise<void> {
        await tx
            .update(pages)
            .set({
                kbVersion: sql`COALESCE(${pages.kbVersion}, 0) + 1`,
                kbUpdatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(pages.id, pageId));
    }

    async list(workspaceId: string, pageId: string, filters: ListFilters = {}) {
        if (!(await this.pageBelongsToWorkspace(workspaceId, pageId))) return null;

        const conds = [eq(catalogItems.pageId, pageId)];
        if (filters.type) conds.push(eq(catalogItems.type, filters.type));

        const status = filters.status ?? 'active';
        if (status === 'active') {
            conds.push(isNull(catalogItems.archivedAt));
            const freshness = or(isNull(catalogItems.endsAt), gt(catalogItems.endsAt, sql`NOW()`));
            if (freshness) conds.push(freshness);
        } else if (status === 'expired') {
            conds.push(isNull(catalogItems.archivedAt));
            conds.push(isNotNull(catalogItems.endsAt));
            conds.push(lte(catalogItems.endsAt, sql`NOW()`));
        } else if (status === 'archived') {
            conds.push(isNotNull(catalogItems.archivedAt));
        }
        // 'all' applies no status filter.

        return db
            .select()
            .from(catalogItems)
            .where(and(...conds))
            .orderBy(desc(catalogItems.createdAt));
    }

    async get(workspaceId: string, id: string) {
        const rows = await db
            .select()
            .from(catalogItems)
            .innerJoin(pages, eq(catalogItems.pageId, pages.id))
            .where(and(eq(catalogItems.id, id), eq(pages.workspaceId, workspaceId)))
            .limit(1);
        return rows[0]?.catalog_items ?? null;
    }

    async create(workspaceId: string, pageId: string, input: CreateCatalogItemInput) {
        if (!(await this.pageBelongsToWorkspace(workspaceId, pageId))) return null;

        return db.transaction(async (tx) => {
            const [row] = await tx
                .insert(catalogItems)
                .values({
                    pageId,
                    type: input.type,
                    name: input.name,
                    description: input.description ?? null,
                    priceMinor: input.priceMinor ?? null,
                    currency: input.currency ?? null,
                    startsAt: input.startsAt ?? null,
                    endsAt: input.endsAt ?? null,
                    enrollmentClosesAt: input.enrollmentClosesAt ?? null,
                    metadata: input.metadata ?? {},
                    // sourceTier defaults to 2 in the schema.
                })
                .returning();

            await this.bumpKbVersion(tx, pageId);
            return row;
        });
    }

    async update(workspaceId: string, id: string, input: UpdateCatalogItemInput) {
        const existing = await this.get(workspaceId, id);
        if (!existing) return null;

        const setData: Record<string, unknown> = { updatedAt: new Date() };
        for (const key of [
            'type', 'name', 'description', 'priceMinor', 'currency',
            'startsAt', 'endsAt', 'enrollmentClosesAt', 'metadata', 'archivedAt',
        ] as const) {
            if (input[key] !== undefined) setData[key] = input[key];
        }

        return db.transaction(async (tx) => {
            const [row] = await tx
                .update(catalogItems)
                .set(setData)
                .where(eq(catalogItems.id, id))
                .returning();

            await this.bumpKbVersion(tx, existing.pageId);
            return row;
        });
    }

    /** Soft-delete: sets archivedAt = now. Returns null if not found in workspace. */
    async archive(workspaceId: string, id: string) {
        const existing = await this.get(workspaceId, id);
        if (!existing) return null;
        if (existing.archivedAt) return existing; // already archived — idempotent

        return db.transaction(async (tx) => {
            const [row] = await tx
                .update(catalogItems)
                .set({ archivedAt: new Date(), updatedAt: new Date() })
                .where(eq(catalogItems.id, id))
                .returning();

            await this.bumpKbVersion(tx, existing.pageId);
            return row;
        });
    }
}

export const catalogService = new CatalogService();
