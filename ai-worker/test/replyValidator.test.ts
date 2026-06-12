import { describe, it, expect } from 'vitest';
import {
    flagHallucinatedPrice,
    findPastDateInReply,
    isCommentTooLong,
    stripSelfIdentification,
    validateReply,
} from '../src/services/reply/replyValidator';
import type { GenerateRequest, ParsedReply } from '../src/services/reply/types';

const req = (comment: string, ctx: GenerateRequest['context'] = {}): GenerateRequest => ({ comment, context: ctx });

describe('flagHallucinatedPrice (Check 1)', () => {
    const kb = 'باقة الورد - 150 ريال\nالتوصيل مجاني';

    it('flags a currency-adjacent number not in KB', () => {
        expect(flagHallucinatedPrice('السعر 999 ريال', kb)).toBe(true);
    });

    it('does NOT flag a currency-adjacent number present in KB', () => {
        expect(flagHallucinatedPrice('السعر 150 ريال', kb)).toBe(false);
    });

    it('flags a price-cue number with no currency token (Tier B)', () => {
        expect(flagHallucinatedPrice('the price is only 88', 'package details, no numbers here')).toBe(true);
    });

    it('does NOT flag a price-cue number that matches KB', () => {
        expect(flagHallucinatedPrice('price is 150', kb)).toBe(false);
    });

    it('ignores whitelisted patterns (phone numbers) near a cue', () => {
        // 0512345678 is stripped as a SA phone before the cue scan → no number remains
        expect(flagHallucinatedPrice('for just call 0512345678', kb)).toBe(false);
    });

    it('ignores times and dates adjacent to a cue', () => {
        expect(flagHallucinatedPrice('cost at 9:30 on 12/05', kb)).toBe(false);
    });

    it('returns false when the reply has no numbers at all', () => {
        expect(flagHallucinatedPrice('we have great packages', kb)).toBe(false);
    });
});

describe('isCommentTooLong (Check 2)', () => {
    const long = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    const short = 'just a few words here';

    it('flags a public comment over 50 words', () => {
        expect(isCommentTooLong(long, 'comment')).toBe(true);
    });

    it('does not flag a short comment', () => {
        expect(isCommentTooLong(short, 'comment')).toBe(false);
    });

    it('never flags DM replies regardless of length', () => {
        expect(isCommentTooLong(long, 'dm')).toBe(false);
    });

    it('returns false for an empty reply', () => {
        expect(isCommentTooLong('', 'comment')).toBe(false);
    });
});

describe('stripSelfIdentification (Check 6)', () => {
    it('strips only the offending sentence and keeps the rest', () => {
        const out = stripSelfIdentification('I am a chatbot. The price is 150 SAR and we deliver fast.', 'en');
        expect(out).not.toMatch(/chatbot/i);
        expect(out).toContain('The price is 150 SAR');
    });

    it('falls back to the EN canned reply when nothing useful remains', () => {
        expect(stripSelfIdentification('I am a bot.', 'en')).toBe("I'm part of the page team. How can I help you?");
    });

    it('falls back to the AR canned reply when fallbackLang is ar', () => {
        expect(stripSelfIdentification('I am a bot.', 'ar')).toBe('أنا من فريق الصفحة، كيف أقدر أساعدك؟');
    });

    it('leaves a clean reply untouched', () => {
        expect(stripSelfIdentification('Hello there, how can I help?', 'en')).toBe('Hello there, how can I help?');
    });

    it('strips the Jawab24 brand name', () => {
        const out = stripSelfIdentification('This is Jawab24 speaking. Our hours are 9 to 5 every weekday here.', 'en');
        expect(out).not.toMatch(/jawab24/i);
        expect(out).toContain('Our hours are 9 to 5');
    });

    it('returns empty input unchanged', () => {
        expect(stripSelfIdentification('', 'ar')).toBe('');
    });
});

describe('validateReply orchestration', () => {
    const base = (over: Partial<ParsedReply>): ParsedReply => ({
        reply: 'ok', intent: 'QUESTION', confidence: 'high', hedging: false, language: 'en', flags: [], ...over,
    });

    it('Check 4: hedging on a QUESTION downgrades confidence and flags info_not_in_kb', () => {
        const out = validateReply(base({ reply: 'let me check with the team', hedging: true }), req('do you deliver?'));
        expect(out.confidence).toBe('low');
        expect(out.flags).toContain('info_not_in_kb');
    });

    it('Check 4: hedging is ignored for non-question intents', () => {
        const out = validateReply(base({ reply: 'thanks so much', intent: 'COMPLIMENT', hedging: true }), req('great job'));
        expect(out.flags).not.toContain('info_not_in_kb');
    });

    it('Check 5: low confidence on a QUESTION forces info_not_in_kb', () => {
        const out = validateReply(base({ reply: 'not sure honestly', confidence: 'low' }), req('do you ship?'));
        expect(out.flags).toContain('info_not_in_kb');
    });

    it('Check 5: does not duplicate an existing info_not_in_kb flag', () => {
        const out = validateReply(base({ reply: 'hmm', confidence: 'low', flags: ['info_not_in_kb'] }), req('do you ship?'));
        expect(out.flags!.filter(f => f === 'info_not_in_kb')).toHaveLength(1);
    });

    it('Check 3: flags a language mismatch (EN reply to AR input)', () => {
        const out = validateReply(base({ reply: 'Hello there friend', language: 'en' }), req('كم السعر؟'));
        expect(out.flags).toContain('language_mismatch');
        expect(out.flags).toContain('expected_lang:ar');
        expect(out.flags).toContain('reply_lang:en');
    });

    it('Check 1: integrates the price guard into flags', () => {
        const out = validateReply(
            base({ reply: 'السعر 999 ريال', language: 'ar' }),
            req('كم؟', { knowledgeBase: 'باقة الورد - 150 ريال' }),
        );
        expect(out.flags).toContain('price_not_in_kb');
    });

    it('passes an intentional empty (OFFENSIVE) reply straight through', () => {
        const out = validateReply(
            { reply: '', intent: 'OFFENSIVE', confidence: 'high', hedging: false, language: 'ar', flags: ['offensive_or_abusive'] },
            req('يا حمير'),
        );
        expect(out.reply).toBe('');
        expect(out.flags).toEqual(['offensive_or_abusive']);
    });

    it('returns a clean reply unchanged with no spurious flags', () => {
        const out = validateReply(base({ reply: 'Hello there, happy to help', intent: 'GREETING' }), req('hi'));
        expect(out.reply).toBe('Hello there, happy to help');
        expect(out.flags).toEqual([]);
    });
});

describe('findPastDateInReply (Check 7 — date guard)', () => {
    // Fixed clock: 2026-06-12 noon UTC. All assertions are relative to it, so the
    // suite never goes time-dependent.
    const NOW = new Date('2026-06-12T12:00:00Z');
    const past = (reply: string, tz?: string) => findPastDateInReply(reply, tz, NOW);

    it('flags an Arabic month-name date in the past', () => {
        expect(past('يبدأ التسجيل 1 فبراير 2025')).toBe(true);
    });

    it('flags an English month-name date in the past', () => {
        expect(past('Registration opens February 1, 2025')).toBe(true);
    });

    it('flags a Levantine month-name date in the past', () => {
        expect(past('الدورة تبدأ 5 شباط 2025')).toBe(true);
    });

    it('flags a numeric dd/mm/yyyy date in the past', () => {
        expect(past('العرض ينتهي 31/12/2024')).toBe(true);
    });

    it('flags an ISO date in the past', () => {
        expect(past('valid until 2025-03-01')).toBe(true);
    });

    it('flags Arabic-Indic digits in a past date', () => {
        expect(past('ينتهي العرض ٣١/١٢/٢٠٢٤')).toBe(true);
    });

    it('does NOT flag a future date', () => {
        expect(past('الدورة القادمة تبدأ 1 سبتمبر 2030')).toBe(false);
        expect(past('starts September 1, 2030')).toBe(false);
    });

    it('does NOT flag a bare year (founding years, model numbers)', () => {
        expect(past('تأسسنا عام 2015 ونخدمكم منذ ذلك الحين')).toBe(false);
    });

    it('does NOT flag month+year granularity within the current month', () => {
        expect(past('العرض ساري خلال يونيو 2026')).toBe(false);
    });

    it('flags month+year granularity for an earlier month', () => {
        expect(past('كان العرض في مايو 2026')).toBe(true);
    });

    it('ambiguous d/m vs m/d: not flagged when one reading is future', () => {
        // 05/07/2026 → 5 July (future) or 7 May (past): one future reading → no flag
        expect(past('on 05/07/2026')).toBe(false);
    });

    it('does NOT flag replies without any calendar date', () => {
        expect(past('نعم مفتوحين السبت من 9 صباحاً حتى 5 مساءً')).toBe(false);
        expect(past('')).toBe(false);
    });
});

describe('validateReply — Check 7 date guard wiring', () => {
    const base = (over: Partial<ParsedReply>): ParsedReply => ({
        reply: 'ok', intent: 'QUESTION', confidence: 'high', hedging: false, language: 'ar', flags: [], ...over,
    });
    // The guard reads the real clock via validateReply; "1 فبراير 2025" stays in
    // the past forever, so these are stable without clock mocking.
    const STALE = 'التسجيل يبدأ 1 فبراير 2025 وينتهي 28 فبراير 2025';

    it('downgrades a stale-date QUESTION reply: flags + low confidence + dateSensitive', () => {
        const out = validateReply(base({ reply: STALE }), req('متى يبدأ التسجيل؟'));
        expect(out.flags).toContain('stale_kb_date');
        expect(out.flags).toContain('stale_date_in_reply');
        expect(out.flags).toContain('info_not_in_kb');
        expect(out.confidence).toBe('low');
        expect(out.dateSensitive).toBe(true);
    });

    it('does not double-add stale_kb_date when the model already set it', () => {
        const out = validateReply(base({ reply: STALE, flags: ['stale_kb_date'] }), req('متى يبدأ التسجيل؟'));
        expect(out.flags!.filter(f => f === 'stale_kb_date')).toHaveLength(1);
    });

    it('leaves future-date replies untouched', () => {
        const out = validateReply(base({ reply: 'الدورة القادمة تبدأ 1 سبتمبر 2030' }), req('متى الدورة؟'));
        expect(out.flags).not.toContain('stale_date_in_reply');
        expect(out.confidence).toBe('high');
    });

    it('is gated to question-like intents (COMPLAINT replies are not touched)', () => {
        const out = validateReply(base({ reply: STALE, intent: 'COMPLAINT' }), req('سيء جداً'));
        expect(out.flags).not.toContain('stale_date_in_reply');
    });

    it('maps the model JSON date_sensitive field to dateSensitive', () => {
        const out = validateReply(base({ reply: 'العرض ينتهي 30 ديسمبر 2099', date_sensitive: true }), req('العرض شغال؟'));
        expect(out.dateSensitive).toBe(true);
        const out2 = validateReply(base({ reply: 'موقعنا الرياض' }), req('وين موقعكم؟'));
        expect(out2.dateSensitive).toBe(false);
    });
});
