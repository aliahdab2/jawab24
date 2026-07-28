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

/** Shared normalization for both sides of the comparison. */
function normalizeForMatch(text: string): string {
    // taa marbuta folded here (unlike the default): «الدالية» vs «الداليه» is a
    // typing variant of the same place, and this comparison decides whether a
    // covered area is recognized — a false negative costs a customer an answer.
    return normalizeArabic(text, { normalizeTaaMarbuta: true }).toLowerCase();
}
