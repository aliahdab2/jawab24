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
import { redis } from '../lib/redis';
import { factCollections, factRows } from '../db/schema';
import { pagesService } from './pages';
import { Logger, noopLogger } from '../types';
import {
    renderFactCollectionBlock,
    indexKeyValues,
    normalizeLabel,
    type FactCollectionForPrompt,
    type FactRowForPrompt,
} from './factCollectionsRenderer';
import { matchCollections, matchAttributeValues } from './factCollectionsMatcher';

/** Bound per page so an import can't balloon the prompt or the UI. Defined in
 *  @jawab24/shared because the editor must name the cap it just hit; re-exported
 *  here so every existing importer keeps working. */
import { MAX_COLLECTIONS_PER_PAGE, MAX_ROWS_PER_COLLECTION } from '@jawab24/shared';

export { MAX_COLLECTIONS_PER_PAGE, MAX_ROWS_PER_COLLECTION };

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

/**
 * Machine-readable reasons a fact write was refused.
 *
 * The message is a DEVELOPER string — never shown to a merchant. The client
 * maps the code to its own translated copy, because the instruction differs per
 * reason and "try again" is wrong for most of them: a stale row needs a RELOAD,
 * a full collection needs a deletion, the last row cannot be deleted at all.
 */
export type FactCollectionErrorCode =
    /** A rowId that no longer exists (or never belonged here) — the editor is stale. */
    | 'STALE_ROW'
    /** MAX_ROWS_PER_COLLECTION reached. */
    | 'ROW_LIMIT'
    /** MAX_COLLECTIONS_PER_PAGE reached. */
    | 'COLLECTION_LIMIT'
    /** Deleting this row would empty the collection and silently drop its
     *  coverage boundary from the prompt — refused. */
    | 'LAST_ROW'
    /** endsAt < startsAt — a row born expired. Client input error, not a conflict. */
    | 'DATE_ORDER';

export class FactCollectionLimitError extends Error {
    /** Set at every throw site so the controller never has to guess from the
     *  message. Two endpoints used to map the SAME last-row rule to different
     *  codes ('LIMIT' vs 'LAST_ROW') because each catch block picked its own. */
    readonly code: FactCollectionErrorCode;

    constructor(message: string, code: FactCollectionErrorCode) {
        super(message);
        this.name = 'FactCollectionLimitError';
        this.code = code;
    }
}

export interface FactRowInput {
    name: string;
    attributes?: { label: string; value: string }[] | null;
    /** Structured shadow of attribute values (round-7 write-back contract) —
     *  never read by the prompt pipeline. */
    structured?: import('@jawab24/shared').FactStructuredValues | null;
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
        //
        // ⚠ This clause is the SQL expression of `isRowLive` (@jawab24/shared) —
        // the start date owns visibility (D-057), and endsAt only gates rows with
        // no start date. SQL cannot import the function, so the two are pinned by
        // the "isRowLive — SQL and TS agree" contract test in
        // backend/test/integration/factCollections.test.ts. Change one → that test
        // fails until you change the other.
        const allRows = await db
            .select()
            .from(factRows)
            .where(and(
                inArray(factRows.collectionId, collections.map(c => c.id)),
                or(
                    sql`${factRows.startsAt} >= ${today}`,
                    and(
                        isNull(factRows.startsAt),
                        or(isNull(factRows.endsAt), sql`${factRows.endsAt} >= ${today}`),
                    ),
                ),
            ))
            .orderBy(asc(factRows.sortOrder), asc(factRows.createdAt))
            .limit(MAX_COLLECTIONS_PER_PAGE * MAX_ROWS_PER_COLLECTION);

        const rowsByCollection = new Map<string, typeof allRows>();
        for (const r of allRows) {
            const bucket = rowsByCollection.get(r.collectionId);
            if (bucket) bucket.push(r);
            else rowsByCollection.set(r.collectionId, [r]);
        }

        // ── Sub-key constraints, computed ONCE for the whole page ───────────────
        // Which stored attribute values the customer named, grouped by their label.
        // Built over EVERY live row on the page, not per collection, because that is
        // what makes the sub-key derivable with no configuration: «محادثة» is a
        // stored «المستوى» value in the PRICE list and appears nowhere in the
        // schedules list, and that asymmetry IS the fact "this level has no announced
        // cohort". Computed here rather than in the loop so the reply path pays for
        // one normalization pass per distinct (label, value), not one per collection.
        const attributeMatches = mode === 'gated' && messageText && messageText.trim().length > 0
            ? matchAttributeValues(
                messageText,
                allRows.flatMap(r => r.attributes ?? []),
            )
            : new Map<string, Set<string>>();

        const blocks: string[] = [];
        let gated = false;

        for (const c of collections) {
            const rows = (rowsByCollection.get(c.id) ?? []).slice(0, MAX_ROWS_PER_COLLECTION);
            if (rows.length === 0) {
                // A collection that renders nothing is invisible to the merchant
                // and to us — the likely cause is every row having expired.
                // REPLY PATH: fires once per collection per inbound message for a
                // condition that never self-heals, so a log line here is permanent
                // per-message spam. A counter answers the only question that
                // matters — "is this happening, and how much?" — and the detail
                // stays at debug for whoever is actually investigating.
                redis.incr('metrics:facts:collection_empty').catch(() => {});
                this.logger.debug('fact collection rendered no rows', {
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
                redis.incr('metrics:facts:rows_missing_key').catch(() => {});
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
            const keyAttr = c.keyAttr;
            if (mode === 'gated' && keyAttr && rowsMissingKey === 0 && messageText && messageText.trim().length > 0) {
                const matched = matchCollections(messageText, [{ label: c.label, keyAttr, keyValues }])[0]?.matched ?? [];
                const wanted = new Set(matched.map(v => v.trim()));
                // The row must carry the matched value UNDER THE COLLECTION'S KEY.
                // Testing every attribute's value instead would show a row because
                // some unrelated attribute («الشارع», «ملاحظة») happens to hold a
                // matched string — an attribution bug inside the module whose whole
                // purpose is attribution. Labels are compared with the renderer's
                // normalization for the same reason indexKeyValues does it: they come
                // from extraction and merchant typing, where «المنطقة » and «المنطقة»
                // are one intent (review finding H1, same class as the earlier H2).
                // Same normalizeLabel as indexKeyValues — the gate and the coverage
                // index must share one notion of "same label", or a row gets counted
                // by the index yet withheld by the gate.
                const wantedLabel = normalizeLabel(keyAttr);
                const carriesMatchedKey = (r: FactRowForPrompt): boolean =>
                    !!r.attributes?.some(a => normalizeLabel(a.label) === wantedLabel && wanted.has(a.value.trim()));
                // No match → NO rows. The coverage statement still renders (it is
                // computed over every live row), so the model keeps the list's
                // boundary and can still name the areas it covers — the
                // recoverable failure, deliberately chosen over the unrecoverable
                // one. A normalizer miss («الرمال» vs «حي الرمال») lands here, and
                // the customer still sees their area named in that statement.
                displayRows = wanted.size === 0 ? [] : promptRows.filter(carriesMatchedKey);

                // ── Sub-key narrowing (2026-08-06) ──────────────────────────────
                // STRICTLY NARROWING, by construction: it filters the key-gated set
                // and can never add a row. That property is what makes it safe to
                // ship next to the measured 28%→0% place mechanism — a collection
                // whose rows carry nothing but the key has no other label to
                // constrain, so its behaviour is byte-identical to before.
                //
                // THE CONSTRAINT IS EVALUATED PER ROW, NOT PER COLLECTION — and the
                // difference is a false-denial bug found in external review before this
                // shipped. A per-collection test ("does this list use «المستوى»?") is
                // true for the schedules list because its English rows carry levels, so
                // «بدي ICDL وأنا مبتدئ» would have filtered out every ICDL row — none of
                // them carries a level at all — and denied five real upcoming cohorts.
                //
                // A row that does not carry the constrained label is UNCONSTRAINED on
                // that axis, never excluded: the constraint narrows only among rows the
                // data can actually distinguish. (This is deliberately NOT SQL's
                // `WHERE level = 'x'`, which drops NULLs — dropping them here hides
                // facts on the strength of an attribute the merchant never recorded.)
                // A list with no such label anywhere — the outlet directory — is
                // therefore untouched by construction, not by a special case.
                //
                // The AND across labels is the point: «انكليزي» + «محادثة» leaves zero
                // rows, so the model is shown the boundary statement with NO cohort
                // rows and cannot relabel متوسط 2's slot as a محادثة slot. Prose
                // telling it the same thing measured neutral (6/8 → 5/8); this
                // removes the material instead of asking for restraint.
                let subKeyNarrowed = false;
                for (const [label, values] of attributeMatches) {
                    const norm = normalizeLabel(label);
                    if (norm === wantedLabel) continue; // the key is already gated above
                    const before = displayRows.length;
                    displayRows = displayRows.filter(r => {
                        const cell = r.attributes?.find(a => normalizeLabel(a.label) === norm);
                        // No such attribute on THIS row ⇒ the constraint cannot judge it
                        // ⇒ keep it. Only a row that carries the label and disagrees is
                        // withheld.
                        return !cell || values.has(cell.value.trim());
                    });
                    if (displayRows.length !== before) subKeyNarrowed = true;
                }
                if (subKeyNarrowed) {
                    // Separate counter from rows_gated: this is the new axis, and
                    // "did the sub-key pass ever fire in production?" must be
                    // answerable without reading debug logs.
                    redis.incr('metrics:facts:rows_gated_subkey').catch(() => {});
                }

                if (displayRows.length !== promptRows.length) {
                    gated = true;
                    // M3: the merchant-facing symptom of gating is "the AI stopped
                    // naming my shops", so the log must say WHICH list, how the
                    // message matched, and how much was withheld — pageId alone
                    // cannot answer that question after the fact.
                    // REPLY PATH and the normal case for any keyed page: counter,
                    // not a log line. Note the payload below includes values
                    // derived from the CUSTOMER's message, which is a second
                    // reason to keep it off info.
                    redis.incr('metrics:facts:rows_gated').catch(() => {});
                    this.logger.debug('fact collection rows gated by deterministic match', {
                        pageId, collectionId: c.id, label: c.label, keyAttr,
                        matchedValues: matched, rowsShown: displayRows.length, rowsTotal: promptRows.length,
                    });
                }
            }

            const block = renderFactCollectionBlock(toPromptCollection(c), promptRows, today, { displayRows });
            if (block) blocks.push(block);
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
     * All collections of a page WITH their rows — one query for the
     * collections, ONE for every row (not one per collection; the same
     * no-N+1 posture as listCollections' grouped count). The editor's read.
     */
    async listCollectionsWithRows(pageId: string) {
        const collections = await this.listCollections(pageId);
        if (collections.length === 0) return [];

        const rows = await db
            .select()
            .from(factRows)
            .where(inArray(factRows.collectionId, collections.map(c => c.id)))
            .orderBy(asc(factRows.sortOrder), asc(factRows.createdAt));
        const byCollection = new Map<string, typeof rows>();
        for (const row of rows) {
            const bucket = byCollection.get(row.collectionId) ?? [];
            bucket.push(row);
            byCollection.set(row.collectionId, bucket);
        }
        return collections.map(c => ({ ...c, rows: byCollection.get(c.id) ?? [] }));
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
            throw new FactCollectionLimitError('A collection needs at least one row', 'LAST_ROW');
        }
        if (input.rows.length > MAX_ROWS_PER_COLLECTION) {
            throw new FactCollectionLimitError(`At most ${MAX_ROWS_PER_COLLECTION} rows per collection`, 'ROW_LIMIT');
        }

        const existing = await db
            .select({ id: factCollections.id })
            .from(factCollections)
            .where(eq(factCollections.pageId, pageId));
        if (existing.length >= MAX_COLLECTIONS_PER_PAGE) {
            throw new FactCollectionLimitError(`At most ${MAX_COLLECTIONS_PER_PAGE} collections per page`, 'COLLECTION_LIMIT');
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

    // ------------------------------------------------------------------
    // Row-level CRUD (G1b list editor). Every write invalidates the page's
    // reply caches — a merchant changing a cohort date must never keep serving
    // the old date from cache (same contract as createCollection).
    // The pageId is verified against the collection on EVERY call: the row id
    // alone must never authorize a cross-page write.
    // ------------------------------------------------------------------

    /** The collection, only if it belongs to this page. */
    private async ownedCollection(pageId: string, collectionId: string) {
        const [collection] = await db
            .select()
            .from(factCollections)
            .where(and(eq(factCollections.id, collectionId), eq(factCollections.pageId, pageId)))
            .limit(1);
        return collection ?? null;
    }

    async addRow(pageId: string, collectionId: string, input: FactRowInput) {
        const collection = await this.ownedCollection(pageId, collectionId);
        if (!collection) return null;
        assertRowDateRange(input.startsAt ?? null, input.endsAt ?? null);

        const created = await db.transaction(async (tx) => {
            // Count INSIDE the transaction — outside it, two concurrent adds
            // could both pass the cap check (deleteRow's guard sits inside its
            // tx for the same reason).
            const rows = await tx
                .select({ count: sql<number>`count(*)::int`, maxSort: sql<number>`coalesce(max(${factRows.sortOrder}), -1)::int` })
                .from(factRows)
                .where(eq(factRows.collectionId, collectionId));
            if ((rows[0]?.count ?? 0) >= MAX_ROWS_PER_COLLECTION) {
                throw new FactCollectionLimitError(`At most ${MAX_ROWS_PER_COLLECTION} rows per collection`, 'ROW_LIMIT');
            }
            const [row] = await tx.insert(factRows).values({
                collectionId,
                name: input.name,
                attributes: input.attributes ?? null,
                structured: input.structured ?? null,
                price: input.price ?? null,
                currency: input.currency ?? null,
                startsAt: input.startsAt ?? null,
                endsAt: input.endsAt ?? null,
                isAvailable: input.isAvailable ?? true,
                sortOrder: (rows[0]?.maxSort ?? -1) + 1,
            }).returning();
            await pagesService.invalidatePageCaches(pageId, tx);
            return row;
        });
        this.logger.info('fact row added', { pageId, collectionId, rowId: created.id, name: created.name });
        return created;
    }

    /**
     * Patch one row. Only the provided keys change; an explicit `null` clears a
     * nullable field (that distinction is why the input is `Partial<>` rather
     * than a full replacement — the sheet sends what the merchant touched).
     */
    async updateRow(pageId: string, collectionId: string, rowId: string, patch: Partial<FactRowInput>) {
        const collection = await this.ownedCollection(pageId, collectionId);
        if (!collection) return null;

        const set: Record<string, unknown> = { updatedAt: new Date() };
        if (patch.name !== undefined) set.name = patch.name;
        if (patch.attributes !== undefined) set.attributes = patch.attributes;
        if (patch.structured !== undefined) set.structured = patch.structured;
        if (patch.price !== undefined) set.price = patch.price;
        if (patch.currency !== undefined) set.currency = patch.currency;
        if (patch.startsAt !== undefined) set.startsAt = patch.startsAt;
        if (patch.endsAt !== undefined) set.endsAt = patch.endsAt;
        if (patch.isAvailable !== undefined) set.isAvailable = patch.isAvailable;

        const updated = await db.transaction(async (tx) => {
            // The per-field Zod schema cannot see the OTHER date on a partial
            // patch, so an update touching one side could leave endsAt <
            // startsAt — a row that is expired the moment it saves and silently
            // vanishes from the prompt. Validate the MERGED row, inside the tx
            // so the read can't race a concurrent patch.
            if (patch.startsAt !== undefined || patch.endsAt !== undefined) {
                const [existing] = await tx
                    .select({ startsAt: factRows.startsAt, endsAt: factRows.endsAt })
                    .from(factRows)
                    .where(and(eq(factRows.id, rowId), eq(factRows.collectionId, collectionId)))
                    .limit(1);
                if (!existing) return null;
                assertRowDateRange(
                    patch.startsAt !== undefined ? patch.startsAt : existing.startsAt,
                    patch.endsAt !== undefined ? patch.endsAt : existing.endsAt,
                );
            }
            const [row] = await tx
                .update(factRows)
                .set(set)
                .where(and(eq(factRows.id, rowId), eq(factRows.collectionId, collectionId)))
                .returning();
            if (!row) return null;
            await pagesService.invalidatePageCaches(pageId, tx);
            return row;
        });
        if (!updated) return null;
        this.logger.info('fact row updated', { pageId, collectionId, rowId, keys: Object.keys(patch) });
        return updated;
    }

    /**
     * Delete one row. The LAST row of a collection cannot be deleted this way:
     * an empty collection renders nothing (no coverage statement), which would
     * silently drop the whole boundary — deleting the collection instead is the
     * explicit way to say that.
     */
    async deleteRow(pageId: string, collectionId: string, rowId: string) {
        const collection = await this.ownedCollection(pageId, collectionId);
        if (!collection) return null;

        const deleted = await db.transaction(async (tx) => {
            const [{ count }] = await tx
                .select({ count: sql<number>`count(*)::int` })
                .from(factRows)
                .where(eq(factRows.collectionId, collectionId));
            if (count <= 1) {
                throw new FactCollectionLimitError('Cannot delete the last row — delete the collection instead', 'LAST_ROW');
            }
            const [row] = await tx
                .delete(factRows)
                .where(and(eq(factRows.id, rowId), eq(factRows.collectionId, collectionId)))
                .returning({ id: factRows.id });
            if (!row) return null;
            await pagesService.invalidatePageCaches(pageId, tx);
            return row;
        });
        if (!deleted) return null;
        this.logger.info('fact row deleted', { pageId, collectionId, rowId });
        return deleted;
    }

    /**
     * Atomic save for one ENTITY as the single-form editor sees it: row
     * upserts and deletes that may span SEVERAL collections (the price row in
     * one list, its session rows in another), applied in one transaction with
     * one cache invalidation. Per-row endpoints would leave a half-saved
     * course behind the first failure — unacceptable for a form whose whole
     * point is that the merchant edits the item as one thing.
     *
     * All ownership is re-checked here: every referenced collection must
     * belong to the page, and every referenced row to its stated collection.
     * A miss aborts the WHOLE save (stale editor state must not partially
     * apply). Guards preserved from the per-row paths: the merged date order,
     * the per-collection row cap, and the last-row boundary rule (a collection
     * may not be emptied through this endpoint either).
     */
    async saveEntityRows(
        pageId: string,
        input: {
            upserts: Array<FactRowInput & { collectionId: string; rowId?: string }>;
            deletes: Array<{ collectionId: string; rowId: string }>;
        },
    ) {
        const touchedIds = [...new Set([
            ...input.upserts.map(u => u.collectionId),
            ...input.deletes.map(d => d.collectionId),
        ])];
        if (touchedIds.length === 0) return { upserted: [], deletedIds: [] };

        const owned = await db
            .select({ id: factCollections.id })
            .from(factCollections)
            .where(and(inArray(factCollections.id, touchedIds), eq(factCollections.pageId, pageId)));
        if (owned.length !== touchedIds.length) return null;

        for (const u of input.upserts) assertRowDateRange(u.startsAt ?? null, u.endsAt ?? null);

        const result = await db.transaction(async (tx) => {
            // Per-collection counts INSIDE the tx (same race rationale as addRow).
            const counts = await tx
                .select({
                    collectionId: factRows.collectionId,
                    count: sql<number>`count(*)::int`,
                    maxSort: sql<number>`coalesce(max(${factRows.sortOrder}), -1)::int`,
                })
                .from(factRows)
                .where(inArray(factRows.collectionId, touchedIds))
                .groupBy(factRows.collectionId);
            const byCollection = new Map(counts.map(c => [c.collectionId, { count: c.count, maxSort: c.maxSort }]));

            for (const id of touchedIds) {
                const state = byCollection.get(id) ?? { count: 0, maxSort: -1 };
                const inserts = input.upserts.filter(u => u.collectionId === id && !u.rowId).length;
                const removals = input.deletes.filter(d => d.collectionId === id).length;
                const net = state.count + inserts - removals;
                if (net <= 0) {
                    throw new FactCollectionLimitError('Cannot delete the last row — delete the collection instead', 'LAST_ROW');
                }
                if (net > MAX_ROWS_PER_COLLECTION) {
                    throw new FactCollectionLimitError(`At most ${MAX_ROWS_PER_COLLECTION} rows per collection`, 'ROW_LIMIT');
                }
            }

            const deletedIds: string[] = [];
            for (const d of input.deletes) {
                const [row] = await tx
                    .delete(factRows)
                    .where(and(eq(factRows.id, d.rowId), eq(factRows.collectionId, d.collectionId)))
                    .returning({ id: factRows.id });
                if (!row) throw new FactCollectionLimitError('Row not found — reload and try again', 'STALE_ROW');
                deletedIds.push(row.id);
            }

            const upserted = [];
            for (const u of input.upserts) {
                if (u.rowId) {
                    const [row] = await tx
                        .update(factRows)
                        .set({
                            name: u.name,
                            attributes: u.attributes ?? null,
                            structured: u.structured ?? null,
                            price: u.price ?? null,
                            currency: u.currency ?? null,
                            startsAt: u.startsAt ?? null,
                            endsAt: u.endsAt ?? null,
                            isAvailable: u.isAvailable ?? true,
                            updatedAt: new Date(),
                        })
                        .where(and(eq(factRows.id, u.rowId), eq(factRows.collectionId, u.collectionId)))
                        .returning();
                    if (!row) throw new FactCollectionLimitError('Row not found — reload and try again', 'STALE_ROW');
                    upserted.push(row);
                } else {
                    const state = byCollection.get(u.collectionId) ?? { count: 0, maxSort: -1 };
                    state.maxSort += 1;
                    byCollection.set(u.collectionId, state);
                    const [row] = await tx.insert(factRows).values({
                        collectionId: u.collectionId,
                        name: u.name,
                        attributes: u.attributes ?? null,
                        structured: u.structured ?? null,
                        price: u.price ?? null,
                        currency: u.currency ?? null,
                        startsAt: u.startsAt ?? null,
                        endsAt: u.endsAt ?? null,
                        isAvailable: u.isAvailable ?? true,
                        sortOrder: state.maxSort,
                    }).returning();
                    upserted.push(row);
                }
            }

            await pagesService.invalidatePageCaches(pageId, tx);
            return { upserted, deletedIds };
        });

        this.logger.info('fact entity saved', {
            pageId,
            collections: touchedIds.length,
            upserts: input.upserts.length,
            deletes: input.deletes.length,
        });
        return result;
    }
}

/** The invariant every dated row must hold — endsAt < startsAt is a row that is
 *  born expired and silently absent from the prompt. Thrown as the service's
 *  limit error so both write paths surface it through one channel. */
function assertRowDateRange(startsAt: string | null | undefined, endsAt: string | null | undefined): void {
    if (startsAt && endsAt && endsAt < startsAt) {
        throw new FactCollectionLimitError('End date must not be before the start date', 'DATE_ORDER');
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
