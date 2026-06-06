/**
 * Post-reply validation — lightweight checks AFTER GPT responds, BEFORE the
 * result is returned. Catches issues the prompt alone cannot reliably prevent.
 * No API calls (zero extra cost). Pure functions of (parsed reply, request), so
 * each guard is unit-testable in isolation — see replyValidator.test.ts.
 */
import { detectLanguage } from '../language';
import { getKBText, resolveLanguage, resolveChannel } from './replyContext';
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

    return { ...parsed, reply: finalReply, flags };
}
