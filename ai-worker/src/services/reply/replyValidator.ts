/**
 * Post-reply validation — lightweight checks AFTER GPT responds, BEFORE the
 * result is returned. Catches issues the prompt alone cannot reliably prevent.
 * No API calls (zero extra cost). Pure functions of (parsed reply, request), so
 * each guard is unit-testable in isolation — see replyValidator.test.ts.
 */
import { detectLanguage } from '../language';
import { getKBText, resolveLanguage, resolveChannel } from './replyContext';
import type { GenerateRequest, ParsedReply, ValidatedReply } from './types';

/** Map Arabic-Indic (U+0660–U+0669) and Eastern Arabic-Indic (U+06F0–U+06F9)
 *  digits to ASCII, so "٢٥٠٠٠" and "25000" compare equal. JS `\d` only
 *  matches [0-9], so without this Arabic-Indic prices are invisible to the guard —
 *  both a false-negative hole and a source of inconsistency vs Western digits. */
function normalizeDigits(s: string): string {
    return s
        .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660))
        .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 0x06F0));
}

/** One number token (already digit-normalized) with optional grouping/decimal separators. */
const NUM_TOKEN = '\\d[\\d,.\\u066B\\u066C]*';

/** Word/letter multipliers that may follow a number ("25 ألف", "1.5 مليون", "25k", "3M").
 *  Used inline in the currency pattern so the number→currency adjacency still matches
 *  when a multiplier sits between them. (No `\b` — JS word boundaries are unreliable
 *  against Arabic letters; the value-scaling helpers below do the real disambiguation.) */
const MULT_INLINE = '(?:ألف|الف|آلاف|مليون|ملايين|[kKmM])';

/** Parse a digit-normalized number token to its numeric value. Strips thousands
 *  separators (ASCII comma, Arabic ٬ U+066C) and treats ٫ (U+066B) / "." as the
 *  decimal point. Returns null when unparseable. */
function toValue(token: string): number | null {
    const cleaned = token.replace(/[,٬]/g, '').replace(/٫/g, '.');
    const v = parseFloat(cleaned);
    return Number.isFinite(v) ? v : null;
}

/** Multiplier implied by the text immediately AFTER a number ("ألف"→1000,
 *  "مليون"→1e6, "k"/"K"→1000, "m"/"M"→1e6). The negative lookahead stops "km" /
 *  "million" from being read as a k/m suffix. Returns 1 when none applies. */
function leadingMultiplier(after: string): number {
    if (/^\s*(?:ألف|الف|آلاف)/.test(after)) return 1000;
    if (/^\s*(?:مليون|ملايين)/.test(after)) return 1_000_000;
    if (/^\s*[kK](?![A-Za-z])/.test(after)) return 1000;
    if (/^\s*[mM](?![A-Za-z])/.test(after)) return 1_000_000;
    return 1;
}

/** Multiplier found inside a matched price substring (Tier A — the match may already
 *  include the multiplier word between the number and the currency token). */
function multiplierInMatch(s: string): number {
    if (/(?:ألف|الف|آلاف)/.test(s)) return 1000;
    if (/(?:مليون|ملايين)/.test(s)) return 1_000_000;
    if (/\d\s*[kK](?![A-Za-z])/.test(s)) return 1000;
    if (/\d\s*[mM](?![A-Za-z])/.test(s)) return 1_000_000;
    return 1;
}

/** All numeric VALUES present in the KB text. For every "X <multiplier>" occurrence the
 *  set holds BOTH X and X×multiplier, because merchant data is inconsistent ("150 ألف" =
 *  150000 but "25000 ألف" = 25000) — storing both forms lets a reply match whichever way
 *  it (or the KB) happened to write the figure, regardless of which RAG chunk was retrieved. */
function collectKbValues(kbText: string): Set<number> {
    const norm = normalizeDigits(kbText);
    const values = new Set<number>();
    const re = new RegExp(NUM_TOKEN, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(norm)) !== null) {
        const v = toValue(m[0]);
        if (v === null) continue;
        values.add(v);
        const mult = leadingMultiplier(norm.slice(m.index + m[0].length));
        if (mult > 1) values.add(v * mult);
    }
    return values;
}

/** True when the quoted price `numToken` — taken raw, or scaled by `mult` if a
 *  multiplier word/letter trailed it — corresponds to any value the KB lists.
 *  Unparseable tokens are treated as "in KB" (never flag on parse failure). */
function priceIsInKb(numToken: string, mult: number, kbValues: Set<number>): boolean {
    const v = toValue(numToken);
    if (v === null) return true;
    if (kbValues.has(v)) return true;
    return mult > 1 && kbValues.has(v * mult);
}

/** Currency markers, generic across the Arabic-speaking world (not just the Gulf) —
 *  merchants may be in Syria, Libya, Egypt, Lebanon, the Maghreb, the Gulf, etc.
 *  Three groups: symbols, ISO codes, and Arabic words/abbreviations. ISO codes that
 *  collide with common English words (TRY→"try", MAD→"mad") are intentionally omitted —
 *  the Arabic word / dotted abbreviation covers those currencies. Bare "رس" was removed
 *  because it matches inside ordinary words like "الكورس"; "ريال" and "ر.س" cover SAR. */
const CURRENCY = [
    // Symbols
    '\\$', '€', '£',
    // ISO 4217 codes (Arabic-region + major; English-word collisions excluded)
    'SAR', 'SR', 'AED', 'KWD', 'BHD', 'OMR', 'QAR', 'JOD', 'SYP', 'LBP',
    'EGP', 'LYD', 'TND', 'DZD', 'IQD', 'YER', 'SDG', 'USD', 'EUR', 'GBP',
    // Arabic currency words (cover any country that names its unit this way)
    'ريال', 'ليرة', 'درهم', 'دينار', 'جنيه', 'دولار', 'يورو',
    // Arabic dotted abbreviations
    'ر\\.س', 'ل\\.س', 'ل\\.ل', 'د\\.ل', 'د\\.ت', 'د\\.ج', 'د\\.ك',
    'د\\.ب', 'د\\.إ', 'د\\.أ', 'د\\.ع', 'ر\\.ق', 'ر\\.ع', 'ر\\.ي', 'ج\\.م', 'ج\\.س',
].join('|');

/**
 * Check 1 — Hallucinated prices, two-tier detection:
 *   Tier A: numbers adjacent to currency tokens (SAR, ريال, ل.س, $, …)
 *   Tier B: a price-cue phrase with a number nearby (no currency token)
 * Returns true when the reply quotes a price whose VALUE is not present in the KB.
 * Caller gates this on intent === 'QUESTION' and a non-empty KB.
 *
 * Comparison is by numeric VALUE, not string: Arabic-Indic digits are folded to
 * ASCII, thousands separators stripped, and word/letter multipliers ("25 ألف",
 * "1.5 مليون", "25k") expanded — so "25 ألف", "25,000", "25000" and "٢٥٠٠٠" all
 * match. Multiplier expansion is bidirectional (see collectKbValues) to absorb the
 * inconsistent way merchants write "ألف". Tier B captures whole number tokens, measures
 * the cue→number gap by index (never slicing a digit run), and treats only the first
 * number after each cue as the quoted price (so "والتوصيل 3 أيام" — a delivery duration —
 * isn't read as a price).
 */
export function flagHallucinatedPrice(reply: string, kbText: string): boolean {
    const nReply = normalizeDigits(reply);
    const kbValues = collectKbValues(kbText);

    // Tier A: currency-adjacent numbers (optional multiplier word between number and currency).
    const pricePattern = new RegExp(
        `(?:${CURRENCY})\\s*(${NUM_TOKEN})(?:\\s*${MULT_INLINE})?`
        + `|(${NUM_TOKEN})(?:\\s*${MULT_INLINE})?\\s*(?:${CURRENCY})`,
        'gi',
    );
    let pm: RegExpExecArray | null;
    while ((pm = pricePattern.exec(nReply)) !== null) {
        const num = pm[1] || pm[2] || '';
        if (num && !priceIsInKb(num, multiplierInMatch(pm[0]), kbValues)) {
            return true;
        }
    }

    // Tier B: price-cue phrase + nearby number (no currency token required).
    //   Strip whitelisted patterns first (phones, times, dates, order IDs, %).
    const sanitized = nReply
        .replace(/0[5-9]\d{8}/g, '')                                      // SA phone numbers
        .replace(/\+?\d{1,3}[-.\s]?\d{3}[-.\s]?\d{3,4}/g, '')             // intl phone
        .replace(/\d{1,2}[:/]\d{2}/g, '')                                  // times (9:00, 5:30)
        .replace(/\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?/g, '')               // dates
        .replace(/#\d+|ORD-?\d+/gi, '')                                    // order IDs
        .replace(/\d+%/g, '');                                              // percentages

    // Generic price/fee cues that fit ANY business type (retail, clinics, salons,
    // services, real estate, courses…), not just one vertical:
    //   • "كلفة" (bare) also matches الكلفة / تكلفة / بكلفة — the common cost-word.
    //   • "ثمن" (price) and "رسوم" (fees) cover retail and service/clinic/school pricing.
    //   • "fees?\b" is word-bounded so it doesn't match inside "feel"/"feedback".
    const priceCues = /(?:price|cost|costs|fees?\b|only|starts?\s*at|starting|for just|valued at|سعر|السعر|بسعر|قيمت[هة]|كلفة|ثمن|رسوم|فقط|يبدأ من)/gi;
    const cueIndexes: number[] = [];
    let cueMatch: RegExpExecArray | null;
    while ((cueMatch = priceCues.exec(sanitized)) !== null) {
        cueIndexes.push(cueMatch.index);
    }
    if (cueIndexes.length > 0) {
        // A price quoted in prose follows its cue ("سعر دورة ... المبتدئ 25000"); allow
        // enough span to clear a noun phrase between them. Only the FIRST number after
        // each cue is treated as the quoted price — later numbers in the same sentence
        // are usually durations/quantities ("والتوصيل 3 أيام"), not prices.
        const CUE_TO_NUMBER_SPAN = 45;
        const numRe = new RegExp(NUM_TOKEN, 'g');
        for (const ci of cueIndexes) {
            numRe.lastIndex = ci;
            const nm = numRe.exec(sanitized);
            if (nm && nm.index - ci <= CUE_TO_NUMBER_SPAN) {
                const after = sanitized.slice(nm.index + nm[0].length, nm.index + nm[0].length + 12);
                if (!priceIsInKb(nm[0], leadingMultiplier(after), kbValues)) {
                    return true;
                }
            }
        }
    }

    return false;
}

/** Check 2 — public comments should be brief. True when a comment exceeds 50 words. */
export function isCommentTooLong(reply: string, channel: 'comment' | 'dm'): boolean {
    if (channel !== 'comment' || !reply) {
        return false;
    }
    return reply.split(/\s+/).filter(Boolean).length > 50;
}

/**
 * Check 6 — the bot must never reveal it's automated. Strips only the offending
 * sentence(s) and keeps the rest. Falls back to a canned reply (in fallbackLang)
 * only if fewer than 10 useful characters remain.
 */
export function stripSelfIdentification(reply: string, fallbackLang: string): string {
    if (!reply) {
        return reply;
    }
    const botWords = /\bبوت\b|bot\b|روبوت|ذكاء اصطناعي|artificial intelligence|AI chatbot|chat\s*bot|Jawab24|jawab24|جواب٢٤|جواب 24/i;
    if (!botWords.test(reply)) {
        return reply;
    }
    // Split while preserving sentence delimiters so we can rejoin naturally.
    // A period only terminates a sentence when followed by whitespace or
    // end-of-string — the dot inside "Jawab24.com" / "example.com" / "2.5"
    // is NOT a boundary. Without the lookahead, "…فريق Jawab24.com ممكن
    // يساعدوك أكتر" split at "Jawab24|.|com …", the brand sentence was
    // stripped, and the orphaned "com ممكن يساعدوك أكتر." fragment was sent
    // to a real customer (prod, 2026-07-17).
    const parts = reply.split(/([.!?؟\n]+(?=\s|$))/);
    const kept: string[] = [];
    for (let i = 0; i < parts.length; i += 2) {
        const sentence = parts[i];
        const delimiter = parts[i + 1] || '';
        if (!sentence) continue;
        if (botWords.test(sentence)) continue;
        kept.push(sentence + delimiter);
    }
    const filtered = kept.join('').trim();
    if (filtered.length < 10) {
        return fallbackLang === 'ar'
            ? 'أنا من فريق الصفحة، كيف أقدر أساعدك؟'
            : 'I\'m part of the page team. How can I help you?';
    }
    return filtered;
}

/**
 * Run all post-reply checks and return the corrected reply + flags.
 * Mutations are applied in order; Check 4 (hedging) lowers confidence which
 * Check 5 then reads, so ordering is significant — do not reorder.
 */
export function validateReply(parsed: ParsedReply, request: GenerateRequest): ValidatedReply {
    const flags = [...(parsed.flags || [])];
    const reply = parsed.reply || '';

    // Check 1: Hallucinated prices (currency-adjacent or price-cue + number).
    // Grounding includes the <product_catalog> block: catalog prices (manual
    // items or store summary) are merchant content the model legitimately
    // quotes — without them here, every correct catalog price would flag.
    if (reply && parsed.intent === 'QUESTION') {
        const kbText = getKBText(request, { includeProductCatalog: true });
        if (kbText && flagHallucinatedPrice(reply, kbText) && !flags.includes('price_not_in_kb')) {
            flags.push('price_not_in_kb');
        }
    }

    // Check 2: Comment too long — public comments should be brief.
    const channel = resolveChannel(request);
    if (isCommentTooLong(reply, channel) && !flags.includes('comment_too_long')) {
        flags.push('comment_too_long');
    }

    // Check 3: Language mismatch — reply language differs from input.
    // Prefers GPT's declared `language` field (from strict json_schema) as the source of truth;
    // falls back to heuristic detection when absent (invalid_json fallback path).
    // Also logs `declared_lang_mismatch` (observability only) when GPT's JSON metadata diverges from what the reply looks like.
    if (reply) {
        const inputLang = resolveLanguage(request);
        const detectedLang = detectLanguage(reply);
        const replyLang = parsed.language || detectedLang;
        if (inputLang !== replyLang && !flags.includes('language_mismatch')) {
            flags.push('language_mismatch');
            flags.push(`expected_lang:${inputLang}`);
            flags.push(`reply_lang:${replyLang}`);
        }
        // Cross-check: GPT declared one language but reply text looks like another.
        // Log-only — this catches a metadata inconsistency in GPT's JSON output, not a
        // reply-quality issue. The reply itself is correct (it matches the resolved input
        // language); surfacing this to merchants creates false positives when customers
        // type a Latin acronym ("ICDL") in an otherwise Arabic conversation.
        if (
            parsed.language
            && parsed.language !== detectedLang
            && /[a-zA-Z\u0600-\u06FF]{3,}/.test(reply)
        ) {
            console.log(JSON.stringify({
                event: 'declared_lang_mismatch',
                declared: parsed.language,
                detected: detectedLang,
                inputLang,
            }));
        }
    }

    // Check 4: GPT-reported hedging — model signals its reply is a deflection ("I'll check", "contact us", etc.)
    // Language-agnostic: GPT evaluates its own reply in context, no regex maintenance needed.
    // Only applies to question-type intents — hedging on GREETING/COMPLIMENT replies is not meaningful.
    const HEDGE_CHECK_INTENTS = new Set(['QUESTION', 'BUSINESS_INQUIRY', 'PURCHASE_INTENT']);
    if (parsed.hedging && HEDGE_CHECK_INTENTS.has(parsed.intent || '')) {
        parsed = { ...parsed, confidence: 'low' };
        if (!flags.includes('info_not_in_kb')) {
            flags.push('info_not_in_kb');
        }
    }

    // Check 5: Low confidence without info_not_in_kb flag.
    // Per prompt rules: confidence=low means KB didn't answer the question → flag is mandatory.
    // Only for question-type intents — complaints, greetings, etc. can be low for other reasons.
    const QUESTION_INTENTS = new Set(['QUESTION', 'BUSINESS_INQUIRY', 'PURCHASE_INTENT']);
    if (
        parsed.confidence === 'low' &&
        QUESTION_INTENTS.has(parsed.intent || '') &&
        !flags.includes('info_not_in_kb')
    ) {
        flags.push('info_not_in_kb');
    }

    // Check 6: Self-identification — strip any sentence revealing the bot is automated.
    const finalReply = stripSelfIdentification(reply, parsed.language || request.language || 'ar');

    return {
        ...parsed,
        reply: finalReply,
        flags,
        // v53 gender self-report: snake_case (model JSON) → camelCase (service contract).
        genderBasis: parsed.gender_basis,
        usedName: parsed.used_name,
    };
}
