/**
 * Fact-collections service — the generic fact engine's read/write layer.
 *
 * Reaches the AI as TEXT via buildFactCollectionsContext (same contract as
 * the catalog block, D-004: no function-calling tools). Every write invalidates
 * the page's reply caches so the next reply sees the change immediately —
 * without that, a merchant confirming their outlet list would keep serving the
 * pre-confirmation wording from cache for up to 30 days.
 *
 * Scope note: nothing here knows what a pharmacy, course, or delivery zone is.
 * A new KIND of business fact is a row in fact_collections — never a code
 * change (owner ruling 2026-07-28).
 */
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db } from '../db';
import { factCollections, factRows } from '../db/schema';
import { pagesService } from './pages';
import { Logger, noopLogger } from '../types';
import {
    renderFactCollectionBlock,
    indexKeyValues,
    type FactCollectionForPrompt,
    type FactRowForPrompt,
} from './factCollectionsRenderer';
import { matchCollections } from './factCollectionsMatcher';

/** Bound per page so an import can't balloon the prompt or the UI. Generous
 *  relative to reality: BAMBO's real directory is ~240 rows in ONE collection,
 *  and a page having more than a handful of distinct fact KINDS is a signal to
 *  look at, not a case to serve. */
export const MAX_COLLECTIONS_PER_PAGE = 12;
export const MAX_ROWS_PER_COLLECTION = 500;

/**
 * How much of a list the model is allowed to see.
 *
 *   'gated'  (default) — the deterministic match decides WHICH rows the model is
 *            shown. Nothing matched ⇒ no row detail, only the derived coverage
 *            statement. A model that was never given «صيدلية السنونو» cannot
 *            place it in a market it does not belong to.
 *   'list'   — every row, every time (the pre-L2 behaviour). Kept as the
 *            single-env-var rollback if gating ever misbehaves in prod.
 *
 * MEASURED, 48 absent-place samples on the distributor fixture judged by the
 * shipped grounding verifier (`scripts/place-fabrication-probe.ts`); controls
 * (a LISTED area, a real price) stayed 0/24 in every arm:
 *
 *   | class                        | 'list' | +prompt rule | +computed line | 'gated' |
 *   | first ask, absent city       |  1/6   |     1/6      |      3/6       |  0/6 ✅ |
 *   | near-name (own address)      |  5/6   |     6/6      |      5/6       |  6/6 †  |
 *   | doubling down after a lie    |  2/6   |     2/6      |      4/6       |  6/6 ‡  |
 *
 * † Under 'gated' this stops being a FABRICATION: no unmatched outlet name is
 *   named any more. What the verifier still flags is an unsupported availability
 *   inference about the business's OWN address — a data gap only the merchant can
 *   close («is your head office a point of sale?»), not an invented attribution.
 * ‡ This probe injects an already-fabricated assistant turn into the history, and
 *   gating leaves the model no other names, so it defends the history. In
 *   production that prior turn is exactly what 'gated' prevents (0/6 above), so
 *   the number measures recovery from a lie this mode stops telling. Tracked by
 *   the shadow verifier; eval #737 stays red for it.
 *
 * Two attempts to fix this by TELLING the model both failed — a prompt rule
 * (neutral) and the computed match stated as a fact (worse). Do not re-add
 * either; the model was never short of information.
 */
export type FactListMode = 'list' | 'gated';

export function resolveFactListMode(): FactListMode {
    const raw = (process.env.FACT_LIST_MODE || '').trim().toLowerCase();
    return raw === 'list' || raw === 'gated' ? raw : DEFAULT_FACT_LIST_MODE;
}

/** Default is the measured winner; the env var is the rollback lever, not a knob
 *  merchants or callers are expected to touch. */
const DEFAULT_FACT_LIST_MODE: FactListMode = 'gated';

export interface FactCollectionsContext {
    /** The <business_lists> block, or undefined when the page has no collections. */
    block: string | undefined;
    /** True when row detail was withheld for at least one collection. Diagnostic
     *  only: it is the difference between "the model chose not to answer" and
     *  "the model was never shown the rows", which is unanswerable from logs. */
    gated: boolean;
}

export class FactCollectionLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FactCollectionLimitError';
    }
}

export interface FactRowInput {
    name: string;
    attributes?: { label: string; value: string }[] | null;
    price?: string | null;
    currency?: string | null;
    startsAt?: string | null;
    endsAt?: string | null;
    isAvailable?: boolean;
}

export interface CreateCollectionInput {
    label: string;
    keyAttr?: string | null;
    /** 'kb_extract' (from the merchant's own text, reviewed) | 'editor'. */
    source?: 'kb_extract' | 'editor';
    rows: FactRowInput[];
}

class FactCollectionsService {
    private logger: Logger = noopLogger;

    setLogger(logger: Logger): void {
        this.logger = logger;
    }

    /**
     * The prompt block for every live collection on a page, or undefined when
     * the page has none. Collections are rendered independently and joined —
     * each carries its OWN coverage statement, because completeness is declared
     * per list (a merchant may have confirmed their outlet list while leaving
     * delivery zones open).
     *
     * `todayIso` is injected rather than read from the clock so the render stays
     * a pure function of its inputs and expiry is testable.
     */
    async buildFactCollectionsContext(
        pageId: string,
        messageText?: string,
        todayIso?: string,
    ): Promise<FactCollectionsContext> {
        const today = todayIso ?? new Date().toISOString().slice(0, 10);
        const mode = resolveFactListMode();
        const empty: FactCollectionsContext = { block: undefined, gated: false };

        const collections = await db
            .select()
            .from(factCollections)
            .where(eq(factCollections.pageId, pageId))
            .orderBy(asc(factCollections.sortOrder), asc(factCollections.createdAt))
            .limit(MAX_COLLECTIONS_PER_PAGE);
        if (collections.length === 0) return empty;

        // ONE query for every collection's rows — this runs on every AI reply,
        // so a per-collection query would add a round-trip per collection to the
        // reply's latency budget, growing as merchants adopt the feature. The
        // match and the block are computed from this SAME result set: two passes
        // would double the hot-path cost and could disagree about the rows.
        // Expired rows are filtered here to keep the payload small; the renderer
        // filters again so it stays honest when handed unfiltered rows.
        const allRows = await db
            .select()
            .from(factRows)
            .where(and(
                inArray(factRows.collectionId, collections.map(c => c.id)),
                or(isNull(factRows.endsAt), sql`${factRows.endsAt} >= ${today}`),
            ))
            .orderBy(asc(factRows.sortOrder), asc(factRows.createdAt))
            .limit(MAX_COLLECTIONS_PER_PAGE * MAX_ROWS_PER_COLLECTION);

        const rowsByCollection = new Map<string, typeof allRows>();
        for (const r of allRows) {
            const bucket = rowsByCollection.get(r.collectionId);
            if (bucket) bucket.push(r);
            else rowsByCollection.set(r.collectionId, [r]);
        }

        const blocks: string[] = [];
        let gated = false;

        for (const c of collections) {
            const rows = (rowsByCollection.get(c.id) ?? []).slice(0, MAX_ROWS_PER_COLLECTION);
            if (rows.length === 0) {
                // A collection that renders nothing is invisible to the merchant
                // and to us — the likely cause is every row having expired.
                this.logger.info('fact collection rendered no rows', {
                    pageId, collectionId: c.id, label: c.label,
                });
                continue;
            }

            const promptRows = rows.map(toPromptRow);
            // Rows missing the key are why the renderer degrades to the un-keyed
            // phrasing (an index that omits them cannot be called a boundary).
            // Log it: the fix belongs in the merchant's data, and silence here is
            // what turned this into a High finding in review.
            const { keyValues, rowsMissingKey } = indexKeyValues(c.keyAttr, promptRows);
            if (rowsMissingKey > 0) {
                this.logger.warn('fact collection has rows missing its key attribute — coverage index suppressed', {
                    pageId, collectionId: c.id, label: c.label, keyAttr: c.keyAttr,
                    rowsMissingKey, totalRows: promptRows.length,
                });
            }
            // ── L2 row gating ───────────────────────────────────────────────
            // The deterministic match decides what the model is SHOWN, not what it
            // is told. Two attempts at telling it both failed to move the measured
            // rate (a prompt rule: neutral; the computed fact line: worse), because
            // the model was not missing information — it was holding 236 names it
            // could attach to a place the customer named. It cannot misattribute a
            // name it was never given.
            //
            // Gating applies ONLY to keyed collections with a usable index: without
            // a key there is nothing to match, and with rows missing the key the
            // index is not a boundary (the H2 finding), so withholding rows there
            // would hide facts on the strength of a comparison we know is partial.
            let displayRows: FactRowForPrompt[] | undefined;
            if (mode === 'gated' && c.keyAttr && rowsMissingKey === 0 && messageText && messageText.trim().length > 0) {
                const matched = matchCollections(messageText, [{ label: c.label, keyAttr: c.keyAttr, keyValues }])[0]?.matched ?? [];
                const wanted = new Set(matched.map(v => v.trim()));
                // No match → NO rows. The coverage statement still renders (it is
                // computed over every live row), so the model keeps the list's
                // boundary and can still name the areas it covers — the
                // recoverable failure, deliberately chosen over the unrecoverable
                // one. A normalizer miss («الرمال» vs «حي الرمال») lands here, and
                // the customer still sees their area named in that statement.
                displayRows = wanted.size === 0
                    ? []
                    : promptRows.filter(r => r.attributes?.some(a => wanted.has(a.value.trim())));
                if (displayRows.length !== promptRows.length) gated = true;
            }

            const block = renderFactCollectionBlock(toPromptCollection(c), promptRows, today, { displayRows });
            if (block) blocks.push(block);
        }

        if (gated) {
            this.logger.info('fact collection rows gated by deterministic match', { pageId });
        }

        return { block: blocks.length > 0 ? blocks.join('\n\n') : undefined, gated };
    }

    /** Collections + row counts for the review/edit surfaces. */
    async listCollections(pageId: string) {
        const collections = await db
            .select()
            .from(factCollections)
            .where(eq(factCollections.pageId, pageId))
            .orderBy(asc(factCollections.sortOrder), asc(factCollections.createdAt))
            .limit(MAX_COLLECTIONS_PER_PAGE);
        if (collections.length === 0) return [];

        // One grouped count, not one per collection.
        const counts = await db
            .select({ collectionId: factRows.collectionId, count: sql<number>`count(*)::int` })
            .from(factRows)
            .where(inArray(factRows.collectionId, collections.map(c => c.id)))
            .groupBy(factRows.collectionId);
        const countByCollection = new Map(counts.map(c => [c.collectionId, c.count]));

        return collections.map(c => ({ ...c, rowCount: countByCollection.get(c.id) ?? 0 }));
    }

    async getRows(collectionId: string) {
        return db
            .select()
            .from(factRows)
            .where(eq(factRows.collectionId, collectionId))
            .orderBy(asc(factRows.sortOrder), asc(factRows.createdAt))
            .limit(MAX_ROWS_PER_COLLECTION);
    }

    /**
     * Create a collection and its rows in ONE transaction, then invalidate the
     * page's caches. Atomic on purpose: a half-written collection would render
     * a coverage statement over a partial list — i.e. it would assert a boundary
     * that is wrong, which is worse than having no collection at all.
     *
     * `isComplete` is deliberately NOT settable here. Completeness is the
     * merchant's word (D-038); extraction and import may never claim it, so a
     * new collection always starts unconfirmed and renders the honest absence
     * wording until someone taps confirm.
     */
    async createCollection(pageId: string, input: CreateCollectionInput) {
        if (input.rows.length === 0) {
            throw new FactCollectionLimitError('A collection needs at least one row');
        }
        if (input.rows.length > MAX_ROWS_PER_COLLECTION) {
            throw new FactCollectionLimitError(`At most ${MAX_ROWS_PER_COLLECTION} rows per collection`);
        }

        const existing = await db
            .select({ id: factCollections.id })
            .from(factCollections)
            .where(eq(factCollections.pageId, pageId));
        if (existing.length >= MAX_COLLECTIONS_PER_PAGE) {
            throw new FactCollectionLimitError(`At most ${MAX_COLLECTIONS_PER_PAGE} collections per page`);
        }

        const created = await db.transaction(async (tx) => {
            const [collection] = await tx
                .insert(factCollections)
                .values({
                    pageId,
                    label: input.label,
                    keyAttr: input.keyAttr ?? null,
                    source: input.source ?? 'kb_extract',
                    sortOrder: existing.length,
                })
                .returning();

            await tx.insert(factRows).values(input.rows.map((r, i) => ({
                collectionId: collection.id,
                name: r.name,
                attributes: r.attributes ?? null,
                price: r.price ?? null,
                currency: r.currency ?? null,
                startsAt: r.startsAt ?? null,
                endsAt: r.endsAt ?? null,
                isAvailable: r.isAvailable ?? true,
                sortOrder: i,
            })));

            await pagesService.invalidatePageCaches(pageId, tx);
            return collection;
        });

        this.logger.info('fact collection created', {
            pageId, collectionId: created.id, label: created.label,
            keyAttr: created.keyAttr, rows: input.rows.length, source: created.source,
        });
        return created;
    }

    /**
     * The merchant's completeness declaration — the ONE action that upgrades
     * the absence wording from «غير مسجّل في قائمتي» to a confident
     * «لا يوجد لدينا». Nothing else in the system may set this.
     *
     * `isComplete: false` is a real answer, not a reset: it means "my list is
     * partial", which pins the honest wording permanently. `null` returns the
     * collection to un-asked.
     */
    async setCompleteness(pageId: string, collectionId: string, isComplete: boolean | null) {
        const [updated] = await db
            .update(factCollections)
            .set({
                isComplete,
                completenessConfirmedAt: isComplete === null ? null : new Date(),
                updatedAt: new Date(),
            })
            .where(and(eq(factCollections.id, collectionId), eq(factCollections.pageId, pageId)))
            .returning();
        if (!updated) return null;

        // This changes what customers are told about absence — the reply caches
        // must not keep serving the previous wording.
        this.logger.info('fact collection completeness set', {
            pageId, collectionId, isComplete,
        });
        await pagesService.invalidatePageCaches(pageId);
        return updated;
    }

    async deleteCollection(pageId: string, collectionId: string) {
        const [deleted] = await db
            .delete(factCollections)
            .where(and(eq(factCollections.id, collectionId), eq(factCollections.pageId, pageId)))
            .returning({ id: factCollections.id });
        if (!deleted) return null;
        await pagesService.invalidatePageCaches(pageId);
        return deleted;
    }
}

/** Row/collection shapes are decoupled from drizzle in the renderer, so map at
 *  the boundary rather than leaking column types into a pure module. */
function toPromptCollection(c: typeof factCollections.$inferSelect): FactCollectionForPrompt {
    return { label: c.label, keyAttr: c.keyAttr, isComplete: c.isComplete };
}

function toPromptRow(r: typeof factRows.$inferSelect): FactRowForPrompt {
    return {
        name: r.name,
        attributes: r.attributes ?? null,
        price: r.price ?? null,
        currency: r.currency ?? null,
        startsAt: r.startsAt ?? null,
        endsAt: r.endsAt ?? null,
        isAvailable: r.isAvailable,
    };
}

export const factCollectionsService = new FactCollectionsService();
