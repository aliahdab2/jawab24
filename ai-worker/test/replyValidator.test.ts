import { describe, it, expect } from 'vitest';
import {
    flagHallucinatedPrice,
    isCommentTooLong,
    stripSelfIdentification,
    validateReply,
    capContactNumbers,
    nameTokenConfirmedAsItem,
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

// Regression: Damascus training institute ("الفريق الدمشقي للتدريب").
// Real production incident (page 39aeab89…): every price question was deflected
// with the PRICE_FALLBACK ("خليني أتأكد من تفاصيل الأسعار وبرجعلك") even though the
// price IS in the KB and GPT answered it with high confidence. Root cause: the
// Tier-B price-cue window (`slice(cue, cue + cueLen + 30)`) is 30 chars wide, which
// for natural Arabic phrasing either (a) bisects the price → compares a fragment
// ("25" vs KB's "25000") → false POSITIVE, or (b) overshoots the number entirely →
// a genuinely hallucinated price slips through → false NEGATIVE. Literal string
// comparison ("25,000" ≠ "25000") and JS `\d` not matching Arabic-Indic digits
// (٢٥٠٠٠) compound it. These assert the CORRECT behavior — they fail before the fix.
describe('flagHallucinatedPrice — Damascus institute price-deflection regression', () => {
    // Mirrors the real KB: the same price appears as "25000" (دورة الأمين section)
    // and as "25,000" (دورة الأمين - مبتدئ section).
    const aminKb = [
        '✦ دورة الأمين:',
        'دورة الأمين للمحاسبة 3 مستويات',
        'الأول مبتدئ المدة شهر الكلفة 25000 ألف ل.س بالعملة القديمة',
        'الثاني متقدم المدة شهر الكلفة 50000 ألف ل.س بالعملة القديمة',
        'الثالث محترف المدة شهر الكلفة 75000 ألف ل.س بالعملة القديمة',
        'اعداد محاسب مالي 150 ألف ل.س بالعملة القديمة',
        '✦ دورة الأمين - مبتدئ:',
        'السعر: 25,000 ل.س بالعملة القديمة',
        'دورة الاونلاين ( محاسبة الأمين) ب 10 دولار',
    ].join('\n');

    // FALSE POSITIVE — the exact prod case: customer "محاسبة الأمين", GPT confidently
    // quotes the correct beginner price, guard truncates "25000" → "25" and flags it.
    it('does NOT flag the correct beginner price (cue far from a multi-digit number)', () => {
        expect(flagHallucinatedPrice('سعر دورة محاسبة الأمين المبتدئ 25000 ل.س', aminKb)).toBe(false);
    });

    it('does NOT flag the same price written with a thousands separator', () => {
        expect(flagHallucinatedPrice('سعر دورة محاسبة الأمين المبتدئ 25,000 ل.س بالعملة القديمة', aminKb)).toBe(false);
    });

    it('does NOT flag Arabic-Indic digits for a price present in KB', () => {
        expect(flagHallucinatedPrice('سعر دورة محاسبة الأمين المبتدئ ٢٥٠٠٠ ل.س بالعملة القديمة', aminKb)).toBe(false);
    });

    it('does NOT flag the intermediate-level price', () => {
        expect(flagHallucinatedPrice('كلفة المستوى المتقدم من دورة الأمين هي 50000 ل.س بالعملة القديمة', aminKb)).toBe(false);
    });

    // FALSE NEGATIVE controls — the fix must not buy false-positive safety by going
    // blind. A price genuinely absent from KB must still be caught, even when the
    // cue sits far from the number or the digits are Arabic-Indic.
    it('STILL flags a genuinely hallucinated price (Western digits, cue far from number)', () => {
        expect(flagHallucinatedPrice('سعر دورة محاسبة الأمين المبتدئ هو 99000 ل.س', aminKb)).toBe(true);
    });

    it('STILL flags a genuinely hallucinated price written in Arabic-Indic digits', () => {
        expect(flagHallucinatedPrice('سعر دورة محاسبة الأمين المبتدئ هو ٩٩٩٩٩ ل.س', aminKb)).toBe(true);
    });
});

// The merchant base is not Gulf-only — Syria (ل.س), Libya (دينار/د.ل), Egypt (ج.م/جنيه),
// Lebanon (ل.ل), the Maghreb, etc. The guard must detect currency-adjacent prices in
// ALL of these, not just SAR/AED. Each pair: an in-KB price (must NOT flag) and an
// out-of-KB price in the same currency (must flag), via both the Tier B cue path and
// the Tier A currency-adjacent path.
describe('flagHallucinatedPrice — generic multi-country currency coverage', () => {
    it('Syria (ل.س) — Tier A currency-adjacent, in KB vs hallucinated', () => {
        const kb = 'الاشتراك الشهري 500 ل.س';
        expect(flagHallucinatedPrice('الاشتراك 500 ل.س', kb)).toBe(false);
        expect(flagHallucinatedPrice('الاشتراك 750 ل.س', kb)).toBe(true);
    });

    it('Libya (دينار / د.ل) — word and dotted abbreviation', () => {
        const kb = 'سعر الخدمة 300 دينار ليبي (د.ل)';
        expect(flagHallucinatedPrice('الخدمة بـ 300 دينار', kb)).toBe(false);
        expect(flagHallucinatedPrice('الخدمة بـ 900 دينار', kb)).toBe(true);
        expect(flagHallucinatedPrice('سعرها 999 د.ل', kb)).toBe(true);
    });

    it('Egypt (جنيه / ج.م) — Arabic currency word', () => {
        const kb = 'الكورس بـ 1200 جنيه';
        expect(flagHallucinatedPrice('الكورس 1200 جنيه', kb)).toBe(false);
        expect(flagHallucinatedPrice('الكورس 1500 جنيه', kb)).toBe(true);
    });

    it('does NOT match the dropped bare "رس" token inside ordinary words (الكورس 12)', () => {
        // "12 جلسة" is the session count, not a price; "كورس" must not read as a currency.
        const kb = 'مدة الكورس 12 جلسة، والسعر 5000 ليرة';
        expect(flagHallucinatedPrice('مدة الكورس 12 جلسة وسعره 5000 ليرة', kb)).toBe(false);
    });
});

// Word/letter multipliers ("25 ألف" = 25000, "2 مليون", "25k"). Merchant KBs mix forms
// inconsistently (the Damascus KB writes "150 ألف" AND "25,000" AND "25000 ألف"), and RAG
// may retrieve only one form — so matching must be by VALUE and bidirectional: a reply
// number matches whether it OR the KB used the multiplier word.
describe('flagHallucinatedPrice — word/letter multipliers (value-based)', () => {
    it('reply "ألف" form matches a plain-digit KB price', () => {
        // KB has 25000; reply writes "25 ألف" → 25*1000 must match.
        const kb = 'السعر 25000 ل.س';
        expect(flagHallucinatedPrice('سعر الدورة 25 ألف ل.س', kb)).toBe(false);
    });

    it('reply plain-digit matches an "ألف" KB price', () => {
        // KB writes "25 ألف"; reply writes "25000" → must match either way.
        const kb = 'الكلفة 25 ألف ل.س';
        expect(flagHallucinatedPrice('سعر الدورة 25000 ل.س', kb)).toBe(false);
    });

    it('handles مليون (×1,000,000) both directions', () => {
        const kb = 'السعر 2 مليون ل.س';
        expect(flagHallucinatedPrice('السعر 2000000 ل.س', kb)).toBe(false);
        expect(flagHallucinatedPrice('السعر 2 مليون ل.س', kb)).toBe(false);
    });

    it('handles the Latin "k" suffix', () => {
        const kb = 'price 25k SAR';
        expect(flagHallucinatedPrice('the price is 25000 SAR', kb)).toBe(false);
    });

    it('STILL flags a hallucinated "ألف" price not in KB', () => {
        const kb = 'الكلفة 25 ألف ل.س'; // {25, 25000}
        expect(flagHallucinatedPrice('سعر الدورة 99 ألف ل.س', kb)).toBe(true);   // 99 / 99000 absent
        expect(flagHallucinatedPrice('سعر الدورة 99000 ل.س', kb)).toBe(true);
    });

    it('does not treat "km" / "million-word" as a k/m multiplier', () => {
        // "25 km" is a distance; the bare number 25 is what gets checked, and it IS in KB.
        const kb = 'المسافة 25 كم والسعر 5000 ل.س';
        expect(flagHallucinatedPrice('المسافة 25 km والسعر 5000 ل.س', kb)).toBe(false);
    });
});

// The guard is business-type-agnostic: it works off generic price/fee cues, not
// course-specific vocabulary. These cover non-course verticals (retail, clinic,
// salon, service) using ثمن (price), رسوم (fees), and English "fee(s)".
describe('flagHallucinatedPrice — generic across business types', () => {
    it('clinic "رسوم" (fees) — in-KB vs hallucinated, no currency token', () => {
        const kb = 'رسوم الكشف 200 والمتابعة 100';
        expect(flagHallucinatedPrice('رسوم الكشف 200', kb)).toBe(false);
        expect(flagHallucinatedPrice('رسوم الكشف 350', kb)).toBe(true);
    });

    it('retail "ثمن" (price) — in-KB vs hallucinated, no currency token', () => {
        const kb = 'ثمن القطعة 80';
        expect(flagHallucinatedPrice('ثمن القطعة 80', kb)).toBe(false);
        expect(flagHallucinatedPrice('ثمن القطعة 120', kb)).toBe(true);
    });

    it('English "fee" is word-bounded — does not trip on "feel"', () => {
        const kb = 'we have great service';
        expect(flagHallucinatedPrice('we feel 500 customers love us', kb)).toBe(false);
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

describe('capContactNumbers (Check 7 — never a wall of numbers)', () => {
    it('leaves a reply with a single number unchanged', () => {
        expect(capContactNumbers('تواصل معنا على 0935924472', 1)).toBe('تواصل معنا على 0935924472');
    });
    it('keeps only the first number when several are dumped (the prod number-wall)', () => {
        const out = capContactNumbers('أرقامنا للتواصل: 0935924472 0112124472 0937549674 تكرم عينك', 1);
        const nums = out.match(/[\d٠-٩]{8,}/g) || [];
        expect(nums).toEqual(['0935924472']);
    });
    it('trims a newline-separated list down to one number', () => {
        const out = capContactNumbers('أرقامنا:\n0935924472\n0112124472\n0937549674', 1);
        expect((out.match(/[\d٠-٩]{8,}/g) || []).length).toBe(1);
    });
    it('does not touch prices or dates (runs under 8 digits)', () => {
        const r = 'السعر 200 ألف وتبدأ 5/7/2026';
        expect(capContactNumbers(r, 1)).toBe(r);
    });
});

describe('nameTokenConfirmedAsItem (Check 8 — name word confirmed as a course)', () => {
    const ctx = (name: string) => `Customer's name is "${name}" (their NAME only — never treat any word in it as a product, course, or service they want)`;

    it('flags the surname when it is confirmed as a course absent from the KB (the prod bug)', () => {
        const tok = nameTokenConfirmedAsItem('تكرم عينك محمد، رح نتواصل معك لتأكيد التسجيل بدورة الحقوق', ctx('محمد حقوق'), 'دورة اللغة الألمانية، دورة التصوير، دورة الأمين');
        expect(tok).toBe('حقوق');
    });
    it('flags an English name token framed as a course not in KB', () => {
        const tok = nameTokenConfirmedAsItem('Thanks John, you are registered for the Law course', ctx('John Law'), 'German course, Photography course');
        expect(tok).toBe('law');
    });
    it('does NOT flag a legit confirmation of a real KB course', () => {
        const tok = nameTokenConfirmedAsItem('تمام محمد، سجّلتك بدورة اللغة الألمانية', ctx('محمد علي'), 'دورة اللغة الألمانية - المستوى الأول');
        expect(tok).toBeNull();
    });
    it('does NOT flag when a name token IS a real KB course (coincidence)', () => {
        // Customer surname "الأمين" but the KB really has "دورة الأمين" → legit, not a hallucination.
        const tok = nameTokenConfirmedAsItem('سجّلتك بدورة الأمين', ctx('سامر الأمين'), 'دورة الأمين للمحاسبة');
        expect(tok).toBeNull();
    });
    it('does NOT flag merely addressing the customer by name near a registration word', () => {
        const tok = nameTokenConfirmedAsItem('سجّلت بياناتك يا محمد حقوق ✅', ctx('محمد حقوق'), 'دورة اللغة الألمانية');
        expect(tok).toBeNull();
    });
    it('returns null when there is no customer context', () => {
        expect(nameTokenConfirmedAsItem('سجّلتك بدورة الحقوق', undefined, 'دورة الألمانية')).toBeNull();
    });
});
