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
    const haystack = normalizeForMatch(messageText);
    if (!haystack) return [];

    const out: CollectionMatch[] = [];
    for (const c of collections) {
        if (!c.keyAttr || c.keyValues.length === 0) continue;
        const matched: string[] = [];
        for (const value of c.keyValues) {
            const needle = normalizeForMatch(value);
            // A single character (or an empty value after normalization) would match
            // almost any message; treat it as unmatchable rather than as a hit.
            if (needle.length < 2) continue;
            if (haystack.includes(needle) && !matched.includes(value)) matched.push(value);
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
 * The label→values map is built across ALL of the page's collections on purpose:
 * «محادثة» is a stored «المستوى» value in the PRICE list and appears nowhere in the
 * schedules list, which is precisely what makes "no announced cohort for this
 * level" derivable with zero configuration. The merchant's own data supplies the
 * vocabulary — nothing here is hand-maintained, and no merchant declares anything.
 *
 * Same containment + normalization + minimum length as matchCollections, because
 * two notions of "the customer said this value" would drift apart.
 */
export function matchAttributeValues(
    messageText: string,
    cells: AttributeCell[],
): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    const haystack = normalizeForMatch(messageText);
    if (!haystack) return out;

    // Values are deduped per label before matching: a page's rows repeat the same
    // level or city many times, and normalizing each copy is wasted work on the
    // reply path (Rule 17 — this runs per message).
    const byLabel = new Map<string, Set<string>>();
    for (const cell of cells) {
        const label = cell.label.trim().replace(/\s+/g, ' ');
        const value = cell.value.trim();
        if (!label || !value) continue;
        const set = byLabel.get(label) ?? new Set<string>();
        set.add(value);
        byLabel.set(label, set);
    }

    for (const [label, values] of byLabel) {
        for (const value of values) {
            const needle = normalizeForMatch(value);
            if (needle.length < 2) continue;
            if (!haystack.includes(needle)) continue;
            const hits = out.get(label) ?? new Set<string>();
            hits.add(value);
            out.set(label, hits);
        }
    }
    return out;
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

/** Shared normalization for both sides of the comparison. */
function normalizeForMatch(text: string): string {
    // taa marbuta folded here (unlike the default): «الدالية» vs «الداليه» is a
    // typing variant of the same place, and this comparison decides whether a
    // covered area is recognized — a false negative costs a customer an answer.
    return normalizeArabic(text, { normalizeTaaMarbuta: true }).toLowerCase();
}
