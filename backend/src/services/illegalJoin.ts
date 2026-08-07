/**
 * Illegal-join validator — DETECTION ONLY, NOT WIRED INTO THE REPLY PATH.
 * ─────────────────────────────────────────────────────────────────────────────
 * D-062 closes with this as the natural next step: "for every pair of stored
 * values appearing in one reply under different labels, assert some single row
 * holds both — needs no model call".
 *
 * WHAT IT CATCHES that nothing else does. Row gating (D-051, D-062) is
 * PREVENTION: it withholds rows the customer's key match does not reach, so the
 * model cannot relabel a row it was never shown. Two classes escape it:
 *
 *   1. CROSS-COLLECTION welding. #650 bounded a constraint to the rows one key
 *      match reaches WITHIN a collection. The Feras adjudication (2026-08-07)
 *      found 5 of 9 real defects were across collections — a product attribute
 *      welded onto نقاط البيع rows, which carry no per-product availability at
 *      all. No within-collection rule can see that pair.
 *   2. UNGATED pages. A collection with no key (MES's five showrooms) renders
 *      every row every time, by design. Nothing narrows, so nothing prevents.
 *
 * WHY CO-OCCURRENCE IS THE WRONG TEST, and the trap this module exists to avoid.
 * The literal reading of "a pair of values appearing in one reply" flags every
 * correct enumeration: a reply that properly lists five showrooms contains five
 * names and five phone numbers, and 20 of the 25 name×phone pairs are held by no
 * single row. Enumerating the whole list is the behaviour the fact engine was
 * built to produce — a checker that flags it would fire hardest on the pages
 * that work. What separates the defect from the list is ATTRIBUTION, so this
 * binds each matched value to the nearest row NAME and asks whether THAT row
 * holds it.
 *
 * FAIL OPEN, ALWAYS. Every uncertain path here returns "no violation": no
 * anchors in the segment, a value held by several rows, a tie between anchors.
 * The asymmetry is deliberate and follows factCollectionsMatcher's
 * rejected-match rule — a missed defect costs one flag, while a false flag on a
 * correct enumeration would train the merchant to ignore the surface entirely.
 *
 * WHAT IT CANNOT SEE. It compares STORED values only, so a laundered total
 * (Waleed's 207 = 3 × a unit price belonging to another row) is invisible unless
 * the reply also states the unit price it multiplied. And a page with no
 * collections yields nothing at all — which is the state of every page whose
 * defect motivated this, until it is migrated.
 *
 * MEASURED COVERAGE ON REAL TRAFFIC (2026-08-07, first run, MES page right after
 * its rows were seeded). Against a genuine prod reply that enumerates all five
 * showrooms correctly: `violations=0` — no false positive, which is the result
 * that matters most. But also `anchorsFound=1, valuesFound=0`, and that second
 * pair is the honest verdict: the validator was SILENT BECAUSE IT COULD NOT
 * ANALYSE THE REPLY, not because it checked it. Two causes, both real:
 *
 *   - ANCHOR RECALL IS POOR. Row names are stored with a generic prefix the
 *     model drops when it writes — stored «صالة الجميلية», written «الجميلية».
 *     Stored-name containment misses every branch except the one the reply
 *     happened to spell in full.
 *   - THE LIST SHAPE DEFEATS PER-LINE SEGMENTATION. That reply puts each phone
 *     number on its OWN line, with the name on the line above. A value alone on
 *     its line has no anchor in its segment, so it is skipped by the fail-open
 *     rule — the same rule that makes enumerations safe.
 *
 * So coverage on this shape is near zero today. Both fixes (match on the
 * distinctive token rather than the stored name; group a name line with the
 * lines that follow it) BUY COVERAGE WITH FALSE-POSITIVE RISK, which is the
 * expensive direction — neither may be adopted on reasoning. Measure each
 * against replies known to be correct before changing either. `anchorsFound` and
 * `valuesFound` exist to keep this distinction visible in any run: a report that
 * counts unanalysable replies as passes is measuring nothing.
 */
import { normalizeFactValue, findValueOccurrences } from './factCollectionsMatcher';

/** A row as the validator reads it. Shape-compatible with `ScopeRow`, plus the
 *  identity needed to say WHICH row a value came from. */
export interface JoinRow {
    /** Stable identity — a row id in production, any unique string in tests. */
    id: string;
    /** The collection this row belongs to, so a violation can name both sides. */
    collectionLabel: string;
    name: string;
    attributes?: { label: string; value: string }[] | null;
    price?: string | null;
}

/** One value the reply attributed to a row that does not hold it. */
export interface IllegalJoin {
    /** The stored value, as stored (not normalized) — quotable in a report. */
    value: string;
    /** The label it is stored under. */
    label: string;
    /** The row name the reply put it next to. */
    boundToRowName: string;
    boundToCollection: string;
    /** Rows that DO hold this value — the correct owners. Never empty. */
    ownedByRowNames: string[];
    ownedByCollections: string[];
    /** True when the owner and the bound row are in different collections — the
     *  class #650 does not cover. */
    crossCollection: boolean;
}

export interface IllegalJoinResult {
    violations: IllegalJoin[];
    /** How many row names were found in the reply. Zero means no verdict was
     *  possible — reported so a run can distinguish "clean" from "unanalysable"
     *  instead of counting both as a pass. */
    anchorsFound: number;
    /** Distinct stored values located in the reply. Zero with anchors > 0 means
     *  the reply named rows without quoting any of their detail. */
    valuesFound: number;
}

/** A row name located in one segment of the reply. */
interface Anchor {
    at: number;
    length: number;
    rowId: string;
    rowName: string;
    collectionLabel: string;
}

const PRICE_LABEL = 'السعر';

/** Cells a row exposes to the validator: its attributes plus its price, which is
 *  a first-class column rather than an attribute and is exactly the field the
 *  money-loss class travels in. */
function cellsOf(row: JoinRow): { label: string; value: string }[] {
    const cells = (row.attributes ?? []).map(a => ({ label: a.label, value: a.value }));
    if (row.price && row.price.trim()) cells.push({ label: PRICE_LABEL, value: row.price.trim() });
    return cells;
}

/**
 * Find every row name in a segment. These are the identity anchors: the points
 * at which the reply commits to talking about a particular row.
 *
 * A name that is a substring of a longer name would anchor twice, so overlapping
 * anchors are resolved in favour of the LONGER name — the more specific identity
 * is the one the reply actually committed to.
 */
function findAnchors(normalizedSegment: string, rows: JoinRow[]): Anchor[] {
    const found: Anchor[] = [];
    for (const row of rows) {
        const needle = normalizeFactValue(row.name);
        if (!needle) continue;
        for (const at of findValueOccurrences(normalizedSegment, needle)) {
            found.push({
                at,
                length: needle.length,
                rowId: row.id,
                rowName: row.name,
                collectionLabel: row.collectionLabel,
            });
        }
    }

    // Longest-first, then drop any anchor that overlaps one already kept.
    found.sort((a, b) => b.length - a.length || a.at - b.at);
    const kept: Anchor[] = [];
    for (const cand of found) {
        const overlaps = kept.some(k => cand.at < k.at + k.length && k.at < cand.at + cand.length);
        if (!overlaps) kept.push(cand);
    }
    return kept.sort((a, b) => a.at - b.at);
}

/** Distance from a value occurrence to an anchor: zero if they overlap, else the
 *  gap between the nearer edges. Direction is deliberately ignored — a reply
 *  puts the name before or after the value with equal ease. */
function distance(valueAt: number, valueLen: number, anchor: Anchor): number {
    if (valueAt < anchor.at + anchor.length && anchor.at < valueAt + valueLen) return 0;
    return valueAt >= anchor.at + anchor.length
        ? valueAt - (anchor.at + anchor.length)
        : anchor.at - (valueAt + valueLen);
}

/**
 * A LINE IS THE ATTRIBUTION UNIT, and this is the correction that made the
 * validator usable at all.
 *
 * Binding each value to the globally nearest row name flags a correct
 * enumeration, because a listed value sits at the END of its own line and is
 * therefore closer to the NEXT row's name than to its own:
 *
 *     <branch A> (city) - 0993301080
 *     <branch B> (city) - 0989100680
 *      ^ two characters from the previous line's phone number
 *
 * Segmenting first makes the list's own structure carry the attribution, and
 * leaves nearest-anchor to do the one job it is good at: separating values
 * inside a single clause ("A 69 and B 119").
 *
 * Segmentation runs on the RAW reply — `normalizeFactValue` collapses every run
 * of whitespace, newlines included, so the structure is gone after it.
 */
function segmentsOf(reply: string): string[] {
    return reply.split(/\r?\n/).filter(s => s.trim().length > 0);
}

/**
 * Check one reply against one page's rows.
 *
 * `rows` MUST span every collection on the page: the cross-collection class is
 * the half #650 leaves open, and passing one collection at a time would hide
 * precisely the defects this was written for.
 */
export function findIllegalJoins(reply: string, rows: JoinRow[]): IllegalJoinResult {
    const empty: IllegalJoinResult = { violations: [], anchorsFound: 0, valuesFound: 0 };
    if (!reply?.trim() || rows.length === 0) return empty;

    const byId = new Map(rows.map(r => [r.id, r]));

    // Which rows hold a given (label, value)? Built once per call: a page's rows
    // repeat the same city or price many times over.
    const owners = new Map<string, { label: string; value: string; needle: string; rowIds: Set<string> }>();
    for (const row of rows) {
        for (const cell of cellsOf(row)) {
            const value = cell.value.trim();
            const needle = normalizeFactValue(value);
            if (!needle || needle.length < 2) continue;
            const key = `${normalizeFactValue(cell.label)} ${needle}`;
            const entry = owners.get(key) ?? { label: cell.label, value, needle, rowIds: new Set<string>() };
            entry.rowIds.add(row.id);
            owners.set(key, entry);
        }
    }

    const violations: IllegalJoin[] = [];
    const valuesSeen = new Set<string>();
    let anchorsFound = 0;

    for (const segment of segmentsOf(reply)) {
        const normalized = normalizeFactValue(segment);
        if (!normalized) continue;

        const anchors = findAnchors(normalized, rows);
        // No identity in this segment -> nothing to attribute a value TO. Fail open.
        if (anchors.length === 0) continue;
        anchorsFound += anchors.length;

        for (const [key, entry] of owners) {
            const occurrences = findValueOccurrences(normalized, entry.needle);
            if (occurrences.length === 0) continue;
            valuesSeen.add(key);

            for (const at of occurrences) {
                // Bind to the nearest anchor. A tie means the reply gives no reason
                // to prefer either row, so a violation would rest on ordering luck.
                let best = Infinity;
                let tied: Anchor[] = [];
                for (const anchor of anchors) {
                    const d = distance(at, entry.needle.length, anchor);
                    if (d < best) {
                        best = d;
                        tied = [anchor];
                    } else if (d === best) {
                        tied.push(anchor);
                    }
                }
                // The value sits inside its own row's name (a branch named for the
                // district it also stores) — not a join.
                if (tied.some(a => entry.rowIds.has(a.rowId))) continue;
                if (tied.length !== 1) continue;

                const bound = tied[0];
                const ownerRows = [...entry.rowIds].map(id => byId.get(id)).filter((r): r is JoinRow => !!r);
                violations.push({
                    value: entry.value,
                    label: entry.label,
                    boundToRowName: bound.rowName,
                    boundToCollection: bound.collectionLabel,
                    ownedByRowNames: ownerRows.map(r => r.name),
                    ownedByCollections: [...new Set(ownerRows.map(r => r.collectionLabel))],
                    crossCollection: ownerRows.every(r => r.collectionLabel !== bound.collectionLabel),
                });
            }
        }
    }

    return { violations, anchorsFound, valuesFound: valuesSeen.size };
}
