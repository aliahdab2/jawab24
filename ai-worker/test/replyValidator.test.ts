import { describe, it, expect } from 'vitest';
import {
    flagHallucinatedPrice,
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
