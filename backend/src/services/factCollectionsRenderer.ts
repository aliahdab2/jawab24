/**
 * Fact-collections renderer — turns generic fact rows into the prompt block the
 * reply model reads, INCLUDING the derived coverage/absence statement.
 *
 * Design constraints, each one paid for:
 *
 * 1. KIND-AWARE, DERIVED — never hand-written. catalog_items was rejected as
 *    the home for lists because its renderer stamps "price on request — in
 *    stock" under "Items this business offers" on every row (nonsense for a
 *    pharmacy directory) and its overflow tail appends "this list is NOT
 *    exhaustive" — the exact opposite of the completeness semantics a list
 *    needs. Here the header comes from the collection's label, the price
 *    column renders only where any row prices it, and the coverage line is
 *    computed from is_complete + the distinct key-attribute values.
 *
 * 2. THE COVERAGE LINE IS THE FIX. Measured 2026-07-28 (probe battery at prod
 *    sampling, distributor fixture): fabrication rate on absent-place
 *    questions 9/32 (28%) with the bare list → 0/32 with the statement, while
 *    every honest positive answer survived (8/8) and prices stayed exact. The
 *    dominant live failure — the merchant's own address answered as an outlet
 *    location, 8/8 before — went to zero.
 *
 * 3. COMPLETENESS IS THE MERCHANT'S WORD, NOT OURS. Until they confirm
 *    (is_complete = true), the absence wording stays «غير مسجّل في قائمتي» —
 *    "not registered with us", which is true by construction — never
 *    «لا نغطيها», which claims knowledge of the world. A hand-authored
 *    experiment line once embedded "(هو عنوان الشركة وليس صيدلية)" — an
 *    assumption nobody had verified; deriving from data makes that class of
 *    editorializing impossible.
 *
 * 4. Pure functions of (collection, rows) — unit-testable without db, same
 *    posture as replyValidator and renderCatalogPromptBlock.
 */

/** Mirror of the drizzle row shapes, decoupled so this module stays pure. */
import { formatPromptPrice } from '../utils/price';

export interface FactCollectionForPrompt {
    label: string;
    keyAttr: string | null;
    isComplete: boolean | null;
}

export interface FactRowForPrompt {
    name: string;
    attributes: { label: string; value: string }[] | null;
    price: string | null;
    currency: string | null;
    startsAt: string | null;
    endsAt: string | null;
    isAvailable: boolean;
}

/** Same cap philosophy as the catalog block: bound the prompt cost of one
 *  collection. Degradation must NEVER drop the coverage line — for lists, the
 *  boundary statement is worth more than any individual row (a truncated list
 *  with a truthful "and the full list covers only: …" line still prevents
 *  fabrication; the reverse does not). */
export const FACT_BLOCK_MAX_CHARS = 12_000;

/** ISO date string for "today" injected by the caller so rendering stays pure
 *  and testable (no Date.now() — same reason the workflow runtime bans it). */
export function renderFactCollectionBlock(
    collection: FactCollectionForPrompt,
    rows: FactRowForPrompt[],
    todayIso: string,
    opts?: {
        /**
         * The subset of rows to PRINT. The coverage statement is still computed over
         * every live row, so the boundary stays truthful while the visible detail
         * shrinks — that asymmetry is the whole point (G1 stage L2 row gating):
         * a model that was never given «صيدلية السنونو» cannot place it in a city.
         *
         * Undefined → print everything (the pre-gating behaviour).
         */
        displayRows?: FactRowForPrompt[];
    },
): string | undefined {
    // Expired rows vanish from the prompt entirely (catalog endsAt precedent —
    // the v38 stale-date class is killed by dates, not by model judgement).
    const live = rows.filter(r => !r.endsAt || r.endsAt >= todayIso);
    if (live.length === 0) return undefined;

    // Gating may legitimately leave NOTHING to print. That is not an empty block:
    // the coverage statement (which enumerates the key values) still renders, so the
    // model can name the areas it covers even when it holds no row detail — the
    // recoverable failure, chosen over the unrecoverable one.
    const display = (opts?.displayRows ?? live).filter(r => !r.endsAt || r.endsAt >= todayIso);

    const anyPrice = display.some(r => r.price !== null);

    const renderRow = (r: FactRowForPrompt, withDetails: boolean): string => {
        const parts = [r.name];
        if (withDetails && r.attributes) {
            for (const a of r.attributes) parts.push(`${a.label}: ${a.value}`);
        }
        // Price ONLY when the collection actually prices things — a pharmacy
        // directory never shows "price on request".
        if (anyPrice) {
            parts.push(r.price !== null
                ? `${formatPromptPrice(r.price)}${r.currency ? ` ${r.currency}` : ''}`
                : 'price on request');
        }
        if (!r.isAvailable) parts.push('غير متاح حالياً');
        if (r.startsAt) parts.push(`starts ${r.startsAt}`);
        if (r.endsAt) parts.push(`ends ${r.endsAt}`);
        return `- ${parts.join(' — ')}`;
    };

    const header = `${collection.label}:`;
    // Coverage over ALL live rows, never over the printed subset — a boundary
    // computed from what happens to be visible is not a boundary.
    const coverage = renderCoverageStatement(collection, live);

    const render = (withDetails: boolean, subset: FactRowForPrompt[]): string =>
        [header, ...subset.map(r => renderRow(r, withDetails)), ...(coverage ? [coverage] : [])].join('\n');

    let block = render(true, display);
    if (block.length > FACT_BLOCK_MAX_CHARS) block = render(false, display);
    if (block.length > FACT_BLOCK_MAX_CHARS) {
        // Drop rows from the tail but KEEP the coverage line — and because the
        // key index in the coverage line is computed over ALL live rows (not
        // the kept subset), the boundary statement stays truthful even when
        // individual rows are omitted.
        const kept: FactRowForPrompt[] = [];
        let length = header.length + (coverage ? coverage.length + 1 : 0) + 80; // tail reserve
        for (const r of display) {
            const line = renderRow(r, false);
            if (length + line.length + 1 > FACT_BLOCK_MAX_CHARS) break;
            kept.push(r);
            length += line.length + 1;
        }
        const omitted = display.length - kept.length;
        block = [
            header,
            ...kept.map(r => renderRow(r, false)),
            `(+${omitted} أخرى في القائمة — مذكورة في فهرس التغطية أدناه)`,
            ...(coverage ? [coverage] : []),
        ].join('\n');
    }
    return block;
}

/**
 * The derived coverage/absence statement — the 28%→0% mechanism.
 *
 * Keyed collection («المدينة»): enumerates the DISTINCT key values so the
 * model holds the complete boundary of the list even if row detail was
 * truncated, then states what absence means — in the wording the merchant's
 * confirmation level has earned.
 *
 * Un-keyed collection: the statement covers the list as a whole.
 */
export function renderCoverageStatement(
    collection: FactCollectionForPrompt,
    liveRows: FactRowForPrompt[],
): string | undefined {
    if (liveRows.length === 0) return undefined;

    const { keyValues, rowsMissingKey } = indexKeyValues(collection.keyAttr, liveRows);

    // The enumerated index may be claimed as the list's BOUNDARY only when every
    // row carries the key. If any row lacks it, those rows are invisible to the
    // index — asserting "the only values are X, Y, Z" would then omit something
    // the merchant actually serves, and the model would deny a covered area to a
    // real customer. That is the false-denial failure this design exists to
    // avoid, so an incomplete index degrades to the un-keyed phrasing instead of
    // making a claim it cannot support.
    const canEnumerate = !!collection.keyAttr && keyValues.length > 0 && rowsMissingKey === 0;

    // Phrasing is built FROM keyAttr, never from a table of known key names —
    // a hand-maintained word list is the anti-pattern this module exists to
    // avoid, and it would silently degrade for «محافظة» / «ولاية» / English keys.
    const scopeLine = canEnumerate
        ? `هذه القائمة تغطي «${collection.keyAttr}» التالية فقط: ${keyValues.join('، ')}.`
        : 'هذه هي القائمة كما هي مسجّلة لدينا.';

    // The absence directive — the half that actually stops fabrication. The
    // strong form is EARNED by merchant confirmation, never assumed.
    const subject = collection.keyAttr ? `«${collection.keyAttr}»` : 'عنصر';
    const absence = collection.isComplete === true
        ? `هذه القائمة كاملة ونهائية: أي ${subject} غير مذكور فيها فهو غير متوفر لدينا — قلها للعميل بوضوح وثقة.`
        : `أي ${subject} غير مذكور في هذه القائمة فهو غير مسجّل لدينا — قل للعميل إنه غير موجود في قائمتك واعرض عليه التواصل معنا مباشرة، ولا تفترض توفره ولا عدم توفره.`;

    // Retraction clause — measured need (2026-07-30 A/B): with row gating alone,
    // a PRIOR assistant turn asserting coverage for an unlisted key value gets
    // RATIFIED, not corrected — the model reframes the transcript's claim as
    // «حسب قائمتنا» (borrowed authority) 4/4 at prod sampling, worse than the
    // ungated arm's 2/4. The boundary must outrank the transcript explicitly.
    // Derived from keyAttr like everything above — not a hand list, not a
    // global prompt rule.
    const retraction = `وإذا ذُكر في هذه المحادثة سابقاً — من أي طرف — ${subject} ليس في هذه القائمة على أنه مغطى، فذلك الذكر خطأ: صحّحه للعميل صراحةً ولا تؤكده.`;

    return `${scopeLine} ${absence} ${retraction}`;
}

/**
 * Distinct key values across the rows, plus how many rows carry NO key value —
 * the number that decides whether the index may be presented as a boundary.
 *
 * Labels are compared NORMALIZED (trimmed, inner whitespace collapsed) because
 * they come from extraction and merchant typing, where «المدينة » and «المدينة»
 * are the same intent. An exact-equality comparison silently dropped such rows
 * from the index — a wrong boundary rather than a visible error.
 */
export function indexKeyValues(
    keyAttr: string | null,
    rows: FactRowForPrompt[],
): { keyValues: string[]; rowsMissingKey: number } {
    if (!keyAttr) return { keyValues: [], rowsMissingKey: 0 };
    const wanted = normalizeLabel(keyAttr);
    const seen = new Set<string>();
    let rowsMissingKey = 0;
    for (const r of rows) {
        const hit = r.attributes?.find(a => normalizeLabel(a.label) === wanted)?.value?.trim();
        if (hit) seen.add(hit);
        else rowsMissingKey++;
    }
    return { keyValues: [...seen], rowsMissingKey };
}

/** Attribute labels are human-typed; compare on intent, not on bytes. */
function normalizeLabel(label: string): string {
    return label.trim().replace(/\s+/g, ' ');
}

