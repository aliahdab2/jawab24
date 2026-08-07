/**
 * Fact-collections matcher (plan G1 stage L2) — the DETERMINISTIC half of the fix.
 *
 * WHY THIS EXISTS
 * ---------------
 * The rendered coverage statement (factCollectionsRenderer) took absent-place
 * fabrication from 28% to 16.7% on the 48-sample probe battery, and the residual
 * was one class: the model accepting a NEAR-NAME as a listed value. The
 * distributor fixture's own address «سوق الثلاثاء» was answered with the
 * pharmacies listed under «سوق الخميس» in 5 of 6 runs.
 *
 * A prompt rule for it («match exactly, resemblance is not a match») was written,
 * measured, and reverted: 8/48 with it, 8/48 without — NEUTRAL. That result is the
 * whole reason this module is code and not prose. "Is what the customer said the
 * same as this listed value?" is a string comparison; the model is unreliable at
 * it, and every attempt to instruct it grows the prompt without moving the number.
 * Owner's ruling (2026-07-28): the exact values live in the database — compare
 * against them there, and stop adding rules.
 *
 * WHAT IT DECIDES, AND WHAT IT MUST NOT CLAIM
 * -------------------------------------------
 * It answers ONE question: which of this list's key values occur in the customer's
 * message. That answer feeds ROW GATING in factCollections.ts — it decides which
 * rows the model is shown — and it is never turned into a claim about the world.
 *
 * Stating it as a prompt fact was tried and measured WORSE (12/48 vs 8/48), which
 * is why nothing here renders prose any more.
 *
 * The scope limit is a hard requirement, not caution (owner, 2026-07-28: «بركي في
 * فعلاً صيدلية عنوانها سوق الجمعة — لازم تتأكد من قاعدة المعرفة قبل»). In the
 * fixture «سوق الثلاثاء» DOES appear in the merchant's data — as the business's own
 * address. So a no-match may never become "that place is not available": the
 * knowledge base stays in the prompt and answers for itself, and the coverage
 * statement (computed over ALL rows) still names every area the list covers.
 *
 * The matcher is also deliberately allowed to find NOTHING without that meaning
 * absence: a customer writing «الرمال» when the row says «حي الرمال» produces no
 * match, and the full list stays in the prompt so the model can still answer them
 * correctly. Silence here must never harden into a denial — that is the H2 review
 * finding (an index that cannot see every row must not be presented as a boundary).
 */
import { normalizeArabic } from '@jawab24/shared';
// ONE definition of "same label" for the whole feature. Its own doc comment warns
// that a second copy is how a row ends up counted by the coverage index yet
// withheld by the gate — so this module imports it rather than re-deriving it.
import { normalizeLabel } from './factCollectionsRenderer';

export interface MatcherCollection {
    label: string;
    keyAttr: string | null;
    /** Distinct key values as stored, in list order. */
    keyValues: string[];
}

export interface CollectionMatch {
    label: string;
    keyAttr: string;
    /** Key values whose stored text occurs in the customer's message. */
    matched: string[];
}

/**
 * Compare the customer's message against each keyed collection's key values.
 *
 * Matching is CONTAINMENT of the stored value inside the message, after shared
 * normalization (`normalizeArabic` + case folding — the same normalizer the KB,
 * cache keys, and catalog reconcile already use, so this cannot drift into a
 * private notion of equality). Containment, not equality, because a customer
 * writes «أنا ساكن في عين الدالية وين نلقاكم» and the stored value is «عين
 * الدالية»; the reverse direction (message token inside a value) is deliberately
 * NOT tried, since that is exactly what turns «سوق الثلاثاء» into a match for
 * «سوق الخميس» through the shared word «سوق».
 *
 * Un-keyed collections are skipped: with no key there is no value to match, and
 * inventing one would be the hand-maintained-vocabulary anti-pattern.
 */
export function matchCollections(messageText: string, collections: MatcherCollection[]): CollectionMatch[] {
    const haystack = normalizeFactValue(messageText);
    if (!haystack) return [];

    const out: CollectionMatch[] = [];
    for (const c of collections) {
        if (!c.keyAttr || c.keyValues.length === 0) continue;
        const matched: string[] = [];
        for (const value of c.keyValues) {
            if (!valueOccursIn(haystack, normalizeFactValue(value))) continue;
            if (!matched.includes(value)) matched.push(value);
        }
        out.push({ label: c.label, keyAttr: c.keyAttr, matched });
    }
    return out;
}

/** One stored attribute cell, as it appears on a row. */
export interface AttributeCell {
    label: string;
    value: string;
}

/**
 * Which stored ATTRIBUTE values occur in the customer's message, grouped by the
 * label they were found under — the sub-key half of row gating.
 *
 * WHY THIS EXISTS (measured, 2026-08-06). The key gate bounds membership at the
 * key's granularity, and that is where the residual defect lives: asked for the
 * انكليزي **مبتدئ** cohort — retired by D-057 while متوسط 1/2 stayed live — the
 * model returned متوسط 1's row verbatim with the level swapped, 6 of 8 runs at
 * prod sampling. A prose clause telling it not to do that measured NEUTRAL
 * (6/8 → 5/8) and was reverted, for the same reason the near-name rule above was:
 * the model is not missing information, it is holding a row it can relabel. It
 * cannot relabel a row it was never shown.
 *
 * GROUPED BY LABEL, NEVER A FLAT VALUE SET. A matched value constrains only the
 * label it was stored under, so «سوق الجمعة» read from «المدينة» can never gate on
 * «ملاحظة». That is the same attribution discipline the key gate already enforces
 * in factCollections.ts, applied one level down.
 *
 * The vocabulary deliberately crosses collections: «محادثة» is a stored «المستوى»
 * value in the PRICE list and appears nowhere in the schedules list, which is
 * precisely what makes "no announced cohort for this level" derivable with zero
 * configuration. The merchant's own data supplies the vocabulary — nothing here is
 * hand-maintained, and no merchant declares anything.
 *
 * The result of this function is NOT usable as a constraint on its own
 * (2026-08-06). It answers "did the customer name this stored value", page-wide;
 * `createAttributeScope` below then decides which of those values a given key
 * match may act on. Skipping that step lets one list's vocabulary withhold
 * another's rows — «متقدم» is a level of the BARBERING price list and of nothing
 * English, yet unscoped it emptied all nine live انكليزي cohorts.
 *
 * Same containment + normalization + minimum length as matchCollections, because
 * two notions of "the customer said this value" would drift apart.
 */
export function matchAttributeValues(
    messageText: string,
    cells: AttributeCell[],
): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    const haystack = normalizeFactValue(messageText);
    if (!haystack) return out;

    // Values are deduped per label before matching: a page's rows repeat the same
    // level or city many times, and normalizing each copy is wasted work on the
    // reply path (Rule 17 — this runs per message).
    const byLabel = new Map<string, Set<string>>();
    for (const cell of cells) {
        const label = normalizeLabel(cell.label);
        const value = cell.value.trim();
        if (!label || !value) continue;
        const set = byLabel.get(label) ?? new Set<string>();
        set.add(value);
        byLabel.set(label, set);
    }

    for (const [label, values] of byLabel) {
        for (const value of values) {
            if (!valueOccursIn(haystack, normalizeFactValue(value))) continue;
            const hits = out.get(label) ?? new Set<string>();
            hits.add(value);
            out.set(label, hits);
        }
    }
    return out;
}

/** A row as the scoper reads it — name plus the cells it carries. */
export interface ScopeRow {
    name: string;
    attributes: { label: string; value: string }[] | null;
}

/**
 * Restrict a set of attribute matches to the values a given key match can REACH.
 *
 * WHY (2026-08-06, external review — a false denial measured on the shipped
 * fixture). `matchAttributeValues` is deliberately fed the whole page so that
 * «محادثة», priced but never scheduled, can constrain the schedules list. Applied
 * without provenance that same reach is a false-denial machine: «متقدم» and
 * «محترف» are levels of the BARBERING and accounting price lists and of nothing
 * English, so «ايمتا تبدأ دورات الانكليزي؟ أنا متقدم» withheld all nine live
 * انكليزي cohorts and answered "no announced dates". A false denial loses the
 * registration outright — strictly worse than the borrowing this all exists to
 * stop, and the same class as the per-collection C7 bug caught before it shipped.
 *
 * THE TEST: a matched value survives only if some row that STORES it is reached by
 * the customer's key match — i.e. the row's identity text (its name plus every
 * value it carries) contains one of the matched key values. Containment of the
 * stored key inside the longer identity text is the same direction used
 * everywhere else here; the reverse is never tried.
 *
 * That keeps the cross-collection asymmetry intact: for «محادثة» the storing row
 * is the English PRICE row, whose name «اللغة الإنكليزية» contains the matched key
 * «انكليزي», so S9 narrows exactly as measured (0/40). It is NOT the rejected
 * per-collection rule ("does this list use that label?") — scope is decided per
 * VALUE by where it is stored, never per list.
 *
 * Returns a closure because the identity index is built once per request and
 * queried once per collection: recomputing it per collection would pay the
 * normalization cost `MAX_COLLECTIONS_PER_PAGE` times on the reply path.
 */
export function createAttributeScope(
    rows: ScopeRow[],
    attributeMatches: Map<string, Set<string>>,
): (matchedKeyValues: string[]) => Map<string, Set<string>> {
    // U+0000 separator: a space would let («المستوى الأول», «x») collide with
    // («المستوى», «الأول x»).
    const hitKey = (label: string, value: string): string => `${label}\u0000${value}`;

    // Which rows store each matched (label, value), as normalized identity text.
    const identitiesByHit = new Map<string, string[]>();
    if (attributeMatches.size > 0) {
        for (const row of rows) {
            let identity: string | undefined;
            for (const a of row.attributes ?? []) {
                const label = normalizeLabel(a.label);
                const value = a.value.trim();
                if (!attributeMatches.get(label)?.has(value)) continue;
                identity ??= normalizeFactValue(
                    [row.name, ...(row.attributes ?? []).map(c => c.value)].join(' '),
                );
                const bucket = identitiesByHit.get(hitKey(label, value));
                if (bucket) bucket.push(identity);
                else identitiesByHit.set(hitKey(label, value), [identity]);
            }
        }
    }

    return (matchedKeyValues: string[]): Map<string, Set<string>> => {
        const out = new Map<string, Set<string>>();
        if (attributeMatches.size === 0 || matchedKeyValues.length === 0) return out;
        const keys = matchedKeyValues.map(normalizeFactValue);
        for (const [label, values] of attributeMatches) {
            const kept = new Set<string>();
            for (const value of values) {
                const identities = identitiesByHit.get(hitKey(label, value)) ?? [];
                if (identities.some(text => keys.some(key => text.includes(key)))) kept.add(value);
            }
            if (kept.size > 0) out.set(label, kept);
        }
        return out;
    };
}

/**
 * Compose the text the matcher reads for a DM: the customer's recent USER turns
 * plus the current consolidated burst.
 *
 * Why history at all: a customer states their area once («أنا ساكن في عين
 * الدالية»), gets a reply, and asks for outlet names minutes later — outside the
 * seconds-scale consolidation window. Matching only the burst would withhold
 * their own area's rows for the rest of the conversation, and every follow-up
 * («أعطني الأسماء») matches nothing either, so the model could name the area but
 * never an outlet — a dead end the customer cannot escape without re-typing the
 * area name.
 *
 * Why USER turns only, never assistant turns: the planted-history probe (eval
 * #737) is an assistant turn asserting outlets in a city that is in no list.
 * If assistant turns fed the matcher, a fabricated reply naming a REAL listed
 * area for the WRONG city would re-open that area's rows and hand the model
 * material to keep defending the lie — the matcher would be trusting the very
 * output it exists to constrain. The customer's own words are the only
 * authoritative statement of where they are.
 */
export function composeFactMatchText(
    history: { role: 'user' | 'assistant'; content: string }[] | undefined,
    currentText: string,
): string {
    const userTurns = (history ?? [])
        .filter(t => t.role === 'user' && t.content && t.content.trim().length > 0)
        .map(t => t.content);
    return userTurns.length > 0 ? [...userTurns, currentText].join('\n') : currentText;
}

/**
 * Shared normalization for both sides of the comparison.
 *
 * Exported because the ROW side of row gating (factCollections.ts) must decide
 * "is this row's stored value one the customer named?" with the same notion of
 * equality used to find the match — comparing raw bytes there while matching on
 * normalized text withholds a row over an alef or a digit form.
 */
export function normalizeFactValue(text: string): string {
    // taa marbuta folded here (unlike the default): «الدالية» vs «الداليه» is a
    // typing variant of the same place, and this comparison decides whether a
    // covered area is recognized — a false negative costs a customer an answer.
    return normalizeArabic(text, { normalizeTaaMarbuta: true }).toLowerCase();
}

/** A letter in any script — Arabic, Latin, anything. */
const HAS_LETTER_RE = /\p{L}/u;
/** Letter or digit: what a bare number must NOT be glued to to count as a hit. */
const WORDISH_RE = /[\p{L}\p{N}]/u;

/**
 * Does a stored value occur in the (already normalized) message?
 *
 * ONE definition for both matchers. Containment, not equality — a customer writes
 * «أنا ساكن في عين الدالية وين نلقاكم» and the stored value is «عين الدالية». The
 * reverse direction is deliberately never tried (see `matchCollections`).
 *
 * LETTER-FREE VALUES NEED A TOKEN BOUNDARY (2026-08-06). Schedule rows store
 * «الساعة» as «2-4», «1-2», «5-6» — three characters, no letters, and bare
 * containment finds them inside any digit run. A customer answering the lead
 * prompt with «رقمي 0932-4567» matched «2-4» and, because the constraint then
 * withheld every row carrying a different time, was told a course with five live
 * cohorts had no announced dates. `composeFactMatchText` feeds the matcher the
 * conversation's earlier USER turns, so one phone number poisoned every later
 * question in that thread.
 *
 * The boundary is applied ONLY to needles containing no letters. It cannot be
 * applied generally: Arabic glues its prefixes to the word, so «عين الدالية» must
 * keep matching inside «بعين الدالية» — the place mechanism depends on it. A bare
 * number has no such morphology, so demanding a non-alphanumeric neighbour costs
 * nothing and closes the collision. A rejected match FAILS OPEN (rows stay
 * visible), which is the safe direction for a narrowing constraint.
 */
function valueOccursIn(haystack: string, needle: string): boolean {
    return findValueOccurrences(haystack, needle).length > 0;
}

/**
 * WHERE a stored value occurs in the (already normalized) text — every hit, in
 * order. `valueOccursIn` is the boolean projection of this, so the two can never
 * disagree about what counts as an occurrence.
 *
 * Positions exist for the illegal-join validator (`illegalJoin.ts`), which binds
 * each matched value to the nearest row NAME in the reply. Co-occurrence alone
 * cannot decide attribution: a reply that correctly enumerates five showrooms
 * contains all five names and all five phone numbers, so every cross-pair looks
 * like a join. Distance is what separates "listed one after another" from "this
 * row's number welded to that row's name".
 */
export function findValueOccurrences(haystack: string, needle: string): number[] {
    // A single character (or an empty value after normalization) would match
    // almost any message; treat it as unmatchable rather than as a hit.
    if (needle.length < 2) return [];

    const hits: number[] = [];
    const bounded = !HAS_LETTER_RE.test(needle);
    for (let from = 0; ; ) {
        const at = haystack.indexOf(needle, from);
        if (at === -1) return hits;
        if (!bounded) {
            hits.push(at);
        } else {
            // Letter-free needles need a token boundary — see the note above.
            const before = at > 0 ? haystack[at - 1] : ' ';
            const after = at + needle.length < haystack.length ? haystack[at + needle.length] : ' ';
            if (!WORDISH_RE.test(before) && !WORDISH_RE.test(after)) hits.push(at);
        }
        from = at + 1;
    }
}
