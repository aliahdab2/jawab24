/**
 * Catalog Tool Executor — Stage 2.3a of KB restructure
 *
 * Backend-side handler for the three catalog tools the LLM can call
 * (`search_entities`, `get_entity_details`, `list_active_entities`).
 *
 * Pure read path: every method queries `catalog_items` scoped to a single
 * `pageId` and returns a normalized envelope shaped like `EcommerceToolResult`,
 * so the existing tool-loop can dispatch either pipeline through the same
 * code path (Stage 2.3b will wire that dispatcher).
 *
 * Freshness invariant: `list_active_entities` automatically excludes items
 * past `endsAt` and any archived items. This is the catalyst-incident
 * safeguard — even if the LLM forgets to filter, the data layer guarantees
 * stale catalog entries are unreachable.
 */
import { and, desc, eq, gt, ilike, isNull, lte, or } from 'drizzle-orm';
import { db } from '../db';
import { catalogItems } from '../db/schema';
import { catalogActiveCondition } from './catalog';
import {
    VALID_CATALOG_TOOL_NAMES,
    computeCatalogStatus,
    type CatalogEntityDetails,
    type CatalogEntitySummary,
    type CatalogEntityType,
    type CatalogToolCall,
    type CatalogToolResult,
} from '@jawab24/shared';

const SEARCH_DEFAULT_LIMIT = 5;
const LIST_DEFAULT_LIMIT = 10;
const HARD_MAX_LIMIT = 25;

type CatalogRow = typeof catalogItems.$inferSelect;

function clampLimit(raw: unknown, fallback: number): number {
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(Math.floor(n), HARD_MAX_LIMIT);
}

function toSummary(row: CatalogRow, now: Date): CatalogEntitySummary {
    return {
        id: row.id,
        type: row.type as CatalogEntityType,
        name: row.name,
        description: row.description,
        priceMinor: row.priceMinor,
        currency: row.currency,
        startsAt: row.startsAt?.toISOString() ?? null,
        endsAt: row.endsAt?.toISOString() ?? null,
        enrollmentClosesAt: row.enrollmentClosesAt?.toISOString() ?? null,
        status: computeCatalogStatus(row, now),
    };
}

function toDetails(row: CatalogRow, now: Date): CatalogEntityDetails {
    const summary = toSummary(row, now);
    return {
        ...summary,
        metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
}

function ok(name: string, data: Record<string, unknown>): CatalogToolResult {
    return { tool_name: name, success: true, data };
}

function fail(name: string, error: string): CatalogToolResult {
    return { tool_name: name, success: false, error };
}

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

async function searchEntities(pageId: string, args: CatalogToolCall['arguments']): Promise<CatalogToolResult> {
    const query = String(args.query ?? '').trim();
    if (!query) return fail('search_entities', 'query_required');

    const type = args.type as CatalogEntityType | undefined;
    const priceMinMinor = args.price_min_minor !== undefined ? Number(args.price_min_minor) : undefined;
    const priceMaxMinor = args.price_max_minor !== undefined ? Number(args.price_max_minor) : undefined;

    const fuzzy = or(
        ilike(catalogItems.name, `%${query}%`),
        ilike(catalogItems.description, `%${query}%`),
    );
    const conds = [
        eq(catalogItems.pageId, pageId),
        isNull(catalogItems.archivedAt),
    ];
    if (fuzzy) conds.push(fuzzy);
    if (type) conds.push(eq(catalogItems.type, type));
    if (Number.isFinite(priceMinMinor)) conds.push(gt(catalogItems.priceMinor, (priceMinMinor as number) - 1));
    if (Number.isFinite(priceMaxMinor)) conds.push(lte(catalogItems.priceMinor, priceMaxMinor as number));

    const rows = await db
        .select()
        .from(catalogItems)
        .where(and(...conds))
        .orderBy(desc(catalogItems.createdAt))
        .limit(SEARCH_DEFAULT_LIMIT);

    const now = new Date();
    return ok('search_entities', { results: rows.map(r => toSummary(r, now)), count: rows.length });
}

async function getEntityDetails(pageId: string, args: CatalogToolCall['arguments']): Promise<CatalogToolResult> {
    const id = String(args.id ?? '').trim();
    if (!id) return fail('get_entity_details', 'id_required');

    const rows = await db
        .select()
        .from(catalogItems)
        .where(and(eq(catalogItems.id, id), eq(catalogItems.pageId, pageId)))
        .limit(1);

    const row = rows[0];
    if (!row) return fail('get_entity_details', 'entity_not_found');

    return ok('get_entity_details', { entity: toDetails(row, new Date()) });
}

async function listActiveEntities(pageId: string, args: CatalogToolCall['arguments']): Promise<CatalogToolResult> {
    const type = args.type as CatalogEntityType | undefined;
    const limit = clampLimit(args.limit, LIST_DEFAULT_LIMIT);

    const conds = catalogActiveCondition(pageId);
    if (type) conds.push(eq(catalogItems.type, type));

    const rows = await db
        .select()
        .from(catalogItems)
        .where(and(...conds))
        .orderBy(desc(catalogItems.createdAt))
        .limit(limit);

    const now = new Date();
    return ok('list_active_entities', { results: rows.map(r => toSummary(r, now)), count: rows.length });
}

// ---------------------------------------------------------------------------
// Dispatcher (called by the tool-loop in Stage 2.3b)
// ---------------------------------------------------------------------------

export async function executeCatalogToolCall(
    pageId: string,
    toolCall: CatalogToolCall,
): Promise<CatalogToolResult> {
    if (!VALID_CATALOG_TOOL_NAMES.includes(toolCall.name)) {
        return fail(toolCall.name, 'unknown_tool');
    }
    try {
        switch (toolCall.name) {
            case 'search_entities':
                return await searchEntities(pageId, toolCall.arguments);
            case 'get_entity_details':
                return await getEntityDetails(pageId, toolCall.arguments);
            case 'list_active_entities':
                return await listActiveEntities(pageId, toolCall.arguments);
        }
    } catch {
        return fail(toolCall.name, 'catalog_query_error');
    }
}

/**
 * Cheap presence check used by Stage 2.3b to decide whether to surface the
 * catalog tools to the LLM at all. Returns true if the page has ≥1 non-archived
 * catalog item (active or expired — expired items are still legitimate
 * subjects for `get_entity_details`).
 */
export async function pageHasCatalogItems(pageId: string): Promise<boolean> {
    const rows = await db
        .select({ id: catalogItems.id })
        .from(catalogItems)
        .where(and(eq(catalogItems.pageId, pageId), isNull(catalogItems.archivedAt)))
        .limit(1);
    return rows.length > 0;
}
