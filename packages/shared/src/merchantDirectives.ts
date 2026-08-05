/**
 * Merchant directives — the merchant's own instructions, kept apart from facts.
 *
 * THE DEFECT THIS EXISTS FOR
 * --------------------------
 * A business's free text carries two different kinds of sentence, and today they are
 * mashed into one blob:
 *   • FACTS  — «مدة كل مستوى شهر», «12 جلسة», an address, a price.
 *   • ORDERS — «أسئلة المخبر والتحليلات ⇒ ارجو التواصل على أرقامنا».
 * The model reads both as soft context, so an order reads like a suggestion. Measured
 * on الفريق الدمشقي (prod, 2026-08-04): a customer asked what the lab course teaches,
 * and the reply invented a whole curriculum — while the merchant's own text said, in
 * as many words, to route that exact question to the phone. Overriding an instruction
 * the merchant wrote himself is worse than inventing a fact: it countermands a decision
 * he already made.
 *
 * WHY KEYWORDS, AUTHORED BY THE MERCHANT
 * --------------------------------------
 * Deciding "is this question inside the scope of that order?" is a judgement, and asking
 * the model to make it is the failure already recorded for the "is this the same place?"
 * comparison. Writing the scope ourselves would be a hand-maintained vocabulary, which
 * this codebase forbids. So the scope is DATA the merchant writes, matched with the
 * exact primitives Post Reply already uses in production — the most trusted routing path
 * in the product. `matchesKeyword` carries the right bias for this job, quoted from its
 * own docs: "silent false positives are worse than silent misses in a keyword router
 * since wrong replies go out without review."
 */
import { matchesKeyword, parseKeywords } from './utils/keyword-matching';
import { normalizeArabic } from './utils/arabic-normalize';

/** Caps mirror the Post Reply limits — same shape of merchant-authored routing rule. */
export const MAX_DIRECTIVES_PER_PAGE = 12;
export const DIRECTIVE_RESPONSE_MAX_LEN = 300;

/**
 * One merchant instruction: when the customer's message matches any of `keywords`,
 * `response` is what the business wants said — not a hint, an answer.
 */
export interface MerchantDirective {
    /** Comma-separated, merchant-authored. Same format and parser as a Post Reply trigger. */
    keywords: string;
    /** What to say. Kept short on purpose: an instruction, not a second knowledge base. */
    response: string;
}

/** Drop malformed/empty entries and apply the caps. Tolerant by design: directives arrive
 *  from merchant-editable JSON, so one bad row must never break the reply path. */
export function normalizeDirectives(raw: unknown): MerchantDirective[] {
    if (!Array.isArray(raw)) return [];
    const out: MerchantDirective[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const keywords = typeof (entry as MerchantDirective).keywords === 'string'
            ? (entry as MerchantDirective).keywords.trim() : '';
        const response = typeof (entry as MerchantDirective).response === 'string'
            ? (entry as MerchantDirective).response.trim() : '';
        if (!keywords || !response || parseKeywords(keywords).length === 0) continue;
        out.push({ keywords, response: response.slice(0, DIRECTIVE_RESPONSE_MAX_LEN) });
        if (out.length >= MAX_DIRECTIVES_PER_PAGE) break;
    }
    return out;
}

/**
 * The first directive whose scope covers this message, or null.
 *
 * FIRST match wins, in the merchant's own order — the same precedence a person would
 * expect from a list they wrote top-down, and it makes the outcome reproducible instead
 * of dependent on which rule happens to be "more specific".
 *
 * Matching runs on the CUSTOMER's text only. Assistant turns are deliberately excluded
 * everywhere in this pipeline: letting the model's own output re-trigger a rule lets a
 * wrong reply keep justifying itself.
 */
export function matchDirective(
    customerText: string,
    directives: MerchantDirective[],
): MerchantDirective | null {
    if (!customerText?.trim() || directives.length === 0) return null;
    const haystack = normalizeArabic(customerText);
    if (!haystack) return null;
    for (const directive of directives) {
        for (const keyword of parseKeywords(directive.keywords)) {
            if (matchesKeyword(haystack, normalizeArabic(keyword))) return directive;
        }
    }
    return null;
}

/**
 * The prompt block. Rendered as numbered ORDERS, above facts, with the one sentence that
 * makes them orders: follow them even when you believe you know a better answer. Without
 * that line the model treats them as background, which is the defect this fixes.
 *
 * Returns undefined when the page has none, so no page pays prompt bytes for a feature
 * it does not use.
 */
export function renderDirectivesBlock(directives: MerchantDirective[]): string | undefined {
    if (directives.length === 0) return undefined;
    const lines = directives.map((d, i) => `${i + 1}. ${d.response}`);
    return [
        'The business owner has given these standing instructions for specific questions.',
        'They are ORDERS, not suggestions: when one applies, follow it exactly — even if you',
        'believe you could answer the question yourself from other information. Do not add a',
        'fuller answer alongside it.',
        ...lines,
    ].join('\n');
}
