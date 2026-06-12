/**
 * Post-reply validation — lightweight checks AFTER GPT responds, BEFORE the
 * result is returned. Catches issues the prompt alone cannot reliably prevent.
 * No API calls (zero extra cost). Pure functions of (parsed reply, request), so
 * each guard is unit-testable in isolation — see replyValidator.test.ts.
 */
import { detectLanguage } from '../language';
import { getKBText, resolveLanguage, resolveChannel } from './replyContext';
import { todayParts } from './promptBuilder';
import type { GenerateRequest, ParsedReply, ValidatedReply } from './types';

/**
 * Check 1 — Hallucinated prices, two-tier detection:
 *   Tier A: numbers adjacent to currency tokens (SAR, SR, ريال, $, etc.)
 *   Tier B: price-cue phrases + a number within 30 chars (no currency token)
 * Returns true when the reply quotes a number not present in the KB text.
 * Caller gates this on intent === 'QUESTION' and a non-empty KB.
 */
export function flagHallucinatedPrice(reply: string, kbText: string): boolean {
    const kbNums = new Set((kbText.match(/\d+(?:[,.\u066B]\d+)*/g) || []));

    // Tier A: currency-adjacent numbers
    const pricePattern = /(?:SAR|SR|ريال|ر\.س|رس|\$|AED|USD|EUR|KWD|BHD|OMR|QAR|JOD)\s*\d+(?:[,.\u066B]\d+)*|\d+(?:[,.\u066B]\d+)*\s*(?:SAR|SR|ريال|ر\.س|رس|\$|AED|USD|EUR|KWD|BHD|OMR|QAR|JOD)/gi;
    const replyPrices = reply.match(pricePattern) || [];
    if (replyPrices.length > 0) {
        const replyNums = replyPrices.map(p => p.replace(/[^\d,.\u066B]/g, '').replace(/^[,.]|[,.]$/g, ''));
        if (replyNums.some(n => n && !kbNums.has(n))) {
            return true;
        }
    }

    // Tier B: price-cue phrases + nearby number (no currency token required)
    //   Strip whitelisted patterns first (phones, times, dates, order IDs, %).
    const sanitized = reply
        .replace(/0[5-9]\d{8}/g, '')                                      // SA phone numbers
        .replace(/\+?\d{1,3}[-.\s]?\d{3}[-.\s]?\d{3,4}/g, '')             // intl phone
        .replace(/\d{1,2}[:/]\d{2}/g, '')                                  // times (9:00, 5:30)
        .replace(/\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?/g, '')               // dates
        .replace(/#\d+|ORD-?\d+/gi, '')                                    // order IDs
        .replace(/\d+%/g, '');                                              // percentages

    const priceCues = /(?:price|cost|costs|only|starts?\s*at|starting|for just|valued at|سعر|السعر|بسعر|قيمت[هة]|تكلفة|فقط|يبدأ من)/gi;
    let cueMatch: RegExpExecArray | null;
    while ((cueMatch = priceCues.exec(sanitized)) !== null) {
        const window = sanitized.slice(cueMatch.index, cueMatch.index + cueMatch[0].length + 30);
        const numberInWindow = window.match(/\d+(?:[,.\u066B]\d+)*/);
        if (numberInWindow) {
            const num = numberInWindow[0];
            if (num && !kbNums.has(num)) {
                return true;
            }
        }
    }

    return false;
}

/** Month-name → number map for the date guard. Western-Arabic, Levantine, and English names.
 *  Bare "اب" (آب without madda) is deliberately excluded — it collides with ordinary words. */
const MONTH_NAMES: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
    'يناير': 1, 'فبراير': 2, 'مارس': 3, 'أبريل': 4, 'ابريل': 4, 'مايو': 5, 'يونيو': 6,
    'يوليو': 7, 'أغسطس': 8, 'اغسطس': 8, 'سبتمبر': 9, 'أكتوبر': 10, 'اكتوبر': 10, 'نوفمبر': 11, 'ديسمبر': 12,
    'كانون الثاني': 1, 'شباط': 2, 'آذار': 3, 'اذار': 3, 'نيسان': 4, 'أيار': 5, 'ايار': 5,
    'حزيران': 6, 'تموز': 7, 'آب': 8, 'أيلول': 9, 'ايلول': 9,
    'تشرين الأول': 10, 'تشرين الاول': 10, 'تشرين الثاني': 11, 'كانون الأول': 12, 'كانون الاول': 12,
};
// Longest-first so "كانون الثاني" wins over a hypothetical shorter overlap.
const MONTH_ALTERNATION = Object.keys(MONTH_NAMES).sort((a, b) => b.length - a.length).join('|');
// Optional day before the month, the month name, optional day after, then a year.
const NAMED_DATE_PATTERN = new RegExp(
    `(?:(\\d{1,2})\\s+)?(${MONTH_ALTERNATION})\\s*,?\\s*(?:(\\d{1,2})\\s*,?\\s*)?(20\\d{2})`,
    'giu',
);
const NUMERIC_DATE_PATTERN = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(20\d{2})/g;
const ISO_DATE_PATTERN = /(20\d{2})-(\d{1,2})-(\d{1,2})/g;

/** Compare a (year, month, day?) candidate against today. Day-less candidates use
 *  month granularity — same month is NOT past. */
function isPast(c: { year: number; month: number; day?: number }, today: { year: number; month: number; day: number }): boolean {
    if (c.month < 1 || c.month > 12) return false;
    if (c.year !== today.year) return c.year < today.year;
    if (c.month !== today.month) return c.month < today.month;
    return c.day !== undefined && c.day >= 1 && c.day <= 31 && c.day < today.day;
}

/**
 * Check 7 — the date guard: true when the reply states an explicit calendar date
 * that is already in the past (merchant timezone). Deterministic backstop for
 * prompt rule 12, mirroring the price guard (Check 1): the prompt catches most
 * stale-date relays, but at temp 0.5 it is probabilistic (eval #422 flipped on
 * roughly half of runs). Recognized forms: "1 فبراير 2025" / "February 1, 2025"
 * (Western-Arabic, Levantine, and English month names), "31/12/2024", and ISO
 * "2024-12-31"; Arabic-Indic digits are normalized first. Bare years are ignored
 * (founding years, model numbers). Ambiguous d/m vs m/d numeric dates count as
 * past only when BOTH readings are past.
 */
export function findPastDateInReply(reply: string, timezone?: string, now: Date = new Date()): boolean {
    if (!reply) return false;
    const today = todayParts(timezone, now);
    // Arabic-Indic digits → ASCII so one set of patterns covers both scripts.
    const text = reply.replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 0x0660));

    for (const m of text.matchAll(NAMED_DATE_PATTERN)) {
        const month = MONTH_NAMES[m[2].toLowerCase()];
        const day = m[1] ? parseInt(m[1], 10) : (m[3] ? parseInt(m[3], 10) : undefined);
        if (isPast({ year: parseInt(m[4], 10), month, day }, today)) return true;
    }
    for (const m of text.matchAll(NUMERIC_DATE_PATTERN)) {
        const [a, b, year] = [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
        const dmReading = { year, month: b, day: a };
        const mdReading = { year, month: a, day: b };
        const dmValid = b >= 1 && b <= 12 && a >= 1 && a <= 31;
        const mdValid = a >= 1 && a <= 12 && b >= 1 && b <= 31;
        // Ambiguous order: flag only when every valid reading is past.
        if (dmValid || mdValid) {
            const readings = [dmValid ? dmReading : null, mdValid ? mdReading : null].filter(Boolean) as typeof dmReading[];
            if (readings.every(r => isPast(r, today))) return true;
        }
    }
    for (const m of text.matchAll(ISO_DATE_PATTERN)) {
        if (isPast({ year: parseInt(m[1], 10), month: parseInt(m[2], 10), day: parseInt(m[3], 10) }, today)) return true;
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
    const parts = reply.split(/([.!?؟\n]+)/);
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
    if (reply && parsed.intent === 'QUESTION') {
        const kbText = getKBText(request);
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

    // Check 7: Date guard — the reply states an explicit calendar date that is
    // already past (e.g. relaying a stale KB registration window as upcoming).
    // Runs BEFORE Check 5 so the confidence downgrade picks up info_not_in_kb
    // there. 'stale_date_in_reply' (distinct from the model-set 'stale_kb_date')
    // marks a guard detection: the backend swaps the reply for the date fallback
    // via SAFE_FALLBACK_FLAGS — a reply asserting a past date as current must
    // never reach the customer, same contract as the price guard.
    if (reply && HEDGE_CHECK_INTENTS.has(parsed.intent || '') && findPastDateInReply(reply, request.context?.timezone)) {
        if (!flags.includes('stale_kb_date')) flags.push('stale_kb_date');
        flags.push('stale_date_in_reply');
        parsed = { ...parsed, confidence: 'low' };
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

    // date_sensitive (model judgment, snake_case in the JSON contract) → dateSensitive.
    // A stale_kb_date flag implies date-dependence even if the model forgot the boolean.
    const dateSensitive = parsed.date_sensitive === true || flags.includes('stale_kb_date');

    return { ...parsed, reply: finalReply, flags, dateSensitive };
}
