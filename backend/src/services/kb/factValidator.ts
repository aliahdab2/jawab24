import { normalizeArabic } from '@jawab24/shared';
import type { ExtractedFact } from './factExtractor';

/**
 * Deterministic validation layer — the last gate BEFORE extracted facts are persisted.
 *
 * It does NOT call an LLM (so it adds zero variance and is fully stable). It catches the two
 * failure modes the extraction/consolidation passes can still let through:
 *
 *  1. price_not_grounded — a fact's price is not present in the SOURCE text. The model
 *     transformed/hallucinated it (e.g. converted currency, rounded, cross-wired). This is the
 *     deterministic enforcement of the price-never-wrong guarantee: a price that isn't literally
 *     in what the merchant wrote does not go live.
 *  2. price_conflict — two facts for the same offering (same normalized title) state different
 *     prices. The consolidation pass should have split or merged these; if one slips through it
 *     is held for review rather than shipping an ambiguous price.
 *
 * Flagged facts are HELD (not discarded): the caller stages them for merchant review instead of
 * letting them reach a customer. Non-priced facts are never flagged on price grounds.
 */

export type FactFlagReason = 'price_not_grounded' | 'price_conflict';

export interface FlaggedFact {
    fact: ExtractedFact;
    reasons: FactFlagReason[];
}

export interface FactValidation {
    /** Grounded, conflict-free → safe to persist live. */
    ok: ExtractedFact[];
    /** Held for review (ungrounded or conflicting price). */
    flagged: FlaggedFact[];
}

/** Matches a "thousand" word so "٥٠ ألف" can ground against a source that wrote "50000". */
const THOUSAND_RE = /(ألف|الف|آلاف|الاف)/;

/**
 * All maximal whole-number digit-runs in a normalized string, as a Set.
 * Thousands separators INSIDE a number (50,000 / 50 000 / ٥٠٬٠٠٠) are stripped first so the
 * run is "50000", matching however the other side wrote it.
 */
function digitRuns(normalized: string): Set<string> {
    // Drop a separator (comma/Arabic comma/space) that sits between a digit and a 3-digit group.
    const joined = normalized.replace(/(\d)[,،٬\s](?=\d{3}(?:\D|$))/g, '$1');
    return new Set(joined.match(/\d+/g) ?? []);
}

/**
 * Is the fact's price grounded in the source text? Grounded = at least one of the price's
 * numbers (or its ×1000 expansion when the price says "ألف") appears as a whole number in the
 * source. A price with no digits (e.g. "حسب المستوى") has nothing to verify → treated as grounded.
 */
function priceGrounded(price: string, sourceRuns: Set<string>): boolean {
    const norm = normalizeArabic(price);
    const runs = [...digitRuns(norm)];
    if (runs.length === 0) return true;
    const hasThousand = THOUSAND_RE.test(norm);
    return runs.some(r => {
        if (sourceRuns.has(r)) return true;
        if (hasThousand) {
            const n = Number(r);
            if (Number.isFinite(n) && n > 0 && n < 1000 && sourceRuns.has(String(n * 1000))) return true;
        }
        return false;
    });
}

export function validateFacts(facts: ExtractedFact[], sourceText: string): FactValidation {
    const sourceRuns = digitRuns(normalizeArabic(sourceText));

    // Pre-pass: collect the distinct prices stated per offering (normalized title).
    const pricesByTitle = new Map<string, Set<string>>();
    for (const f of facts) {
        if (!f.price) continue;
        const key = normalizeArabic(f.title);
        const set = pricesByTitle.get(key) ?? new Set<string>();
        set.add(normalizeArabic(f.price));
        pricesByTitle.set(key, set);
    }

    const ok: ExtractedFact[] = [];
    const flagged: FlaggedFact[] = [];
    for (const f of facts) {
        const reasons: FactFlagReason[] = [];
        if (f.price) {
            if (!priceGrounded(f.price, sourceRuns)) reasons.push('price_not_grounded');
            if ((pricesByTitle.get(normalizeArabic(f.title))?.size ?? 0) > 1) reasons.push('price_conflict');
        }
        if (reasons.length) flagged.push({ fact: f, reasons });
        else ok.push(f);
    }
    return { ok, flagged };
}
