import { describe, it, expect } from 'vitest';
import {
    flagHallucinatedPrice,
    isCommentTooLong,
    stripSelfIdentification,
    isOwnBrandPage,
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

// Prod regression (BAMBO LIBYA, 2026-07-27): a Libyan distributor whose KB was
// typed by hand, so the price lines carry NO space between the amount and the
// currency letter («بسعر38د») and the weight runs straight into it
// («38دالوزن»). On a closing «نعم» during a purchase the model answered
// «باكو واحد ... سعره 1200 دينار ليبي» and nothing flagged it — Check 1 was
// gated to intent QUESTION (fixed in e5313a4c: the check now runs on every
// intent). These pin the grounding decision itself against the merchant's real
// formatting, so the fix can't be undone by a future tokenizer change: the
// invented number MUST flag, and the mangled in-KB ones must NOT — a false
// positive here would deflect every legitimate price this merchant quotes.
describe('flagHallucinatedPrice — hand-typed «د» prices without spaces (BAMBO)', () => {
    // Verbatim shape from kb_chunks (page 8c086c86…, kb_version 10).
    const distributorKb = [
        'رقم 1 - 22 قطعة بسعر 38د الوزن (2-4 كيلو).',
        'رقم 4-24 قطعة بسعر38د الوزن(7-14كيلو).',
        'رقم 5-22 قطعة بسعر38د الوزن(12-18كيلو).',
        'رقم 6- 20 قطعة بسعر 38دالوزن (16+كيلو).',
        'رقم 3 - 52 قطعة بسعر 70د الوزن (4-8 كيلو).',
        'وهذا سعر حفاظ السباحة',
        'السعر 46 دينار',
    ].join('\n');

    it('does NOT flag the pack price even though the KB writes it as «بسعر38د»', () => {
        expect(flagHallucinatedPrice('حفاضات رقم 5 بسعر 38 دينار.', distributorKb)).toBe(false);
        expect(flagHallucinatedPrice('حفاضات رقم 5 بسعر 38د.', distributorKb)).toBe(false);
    });

    it('does NOT flag the jumbo tier or the swim-diaper line', () => {
        expect(flagHallucinatedPrice('الجامبو رقم 3 بسعر 70 دينار.', distributorKb)).toBe(false);
        expect(flagHallucinatedPrice('حفاضات السباحة السعر 46 دينار.', distributorKb)).toBe(false);
    });

    it('FLAGS the invented «1200 دينار ليبي» from the prod purchase turn', () => {
        expect(
            flagHallucinatedPrice('باكو واحد من حفاظات رقم 5 سعره 1200 دينار ليبي.', distributorKb),
        ).toBe(true);
    });

    it('FLAGS a per-piece price — the KB prices packs only, never single pieces', () => {
        expect(flagHallucinatedPrice('سعرها 50 دينار.', distributorKb)).toBe(true);
        expect(flagHallucinatedPrice('القطعة الواحدة بسعر 9 دينار.', distributorKb)).toBe(true);
    });

    // KNOWN LIMITATION, asserted so a future change to grounding is visible in
    // the diff rather than discovered in prod. Check 1 grounds against numbers
    // appearing LITERALLY anywhere in the KB text, and this merchant's KB is
    // dense with small integers that are not prices — size numbers («رقم 5») and
    // weight bounds («(2-4 كيلو)»). So a fabricated per-piece price that happens
    // to be one of those integers grounds by coincidence and is NOT flagged.
    // Cheap prices are exactly where this collides — every plausible per-piece
    // price for this merchant (2, 3, 5, 12…) appears somewhere in their KB as a
    // size or a weight. That is why the Cat 69 eval case (#730) asserts the
    // CONVERSATION never produces a per-piece number at all: the validator alone
    // cannot carry that guarantee for this KB shape.
    it('does NOT flag fabricated prices that collide with size numbers / weight bounds', () => {
        // 2 appears as «(2-4 كيلو)», 12 as «(12-18كيلو)» — neither is a price.
        expect(flagHallucinatedPrice('القطعة الواحدة بسعر 2 دينار.', distributorKb)).toBe(false);
        expect(flagHallucinatedPrice('القطعة الواحدة بسعر 12 دينار.', distributorKb)).toBe(false);
    });
});

// Prod regression (متجر إجدابيا, 2026-07-22): the model computed CORRECT cart
// totals («39 + توصيل 10 = المجموع 49») but the guard grounds every number
// against LITERAL KB values, so a derived total can never pass and the correct
// answer was swapped for the deflection fallback at the moment of sale.
// Fix (v56): the model self-reports the arithmetic in a structured `price_math`
// field; code verifies every addend against the KB and the sum — verified
// totals/products EXTEND the accepted set for that reply only (never replace it).
describe('flagHallucinatedPrice — verified price_math totals (v56)', () => {
    // Shape of the real KB: per-item prices + per-city delivery fees. The
    // «3 ساعات» line matters: Tier B reads the quantity token in «سعر 3 أطراف…»
    // as the quoted price, and in the REAL prod KB it passed only because a
    // literal 3 exists elsewhere («بخور انسام جلكسي 3 ساعات»). That
    // quantity-after-cue reading is a PRE-EXISTING Tier B limitation, out of
    // scope for v56 — price_math terms carry {unit, qty} prices, not bare
    // counts, so it is deliberately not expressible here.
    const kb = 'سعر الثلاث اطرف 39 دينار\nبخور العنفر الملكي سعره 37 دينار\nبخور انسام جلكسي 3 ساعات العلبة 15 دينار\nتوصيل بنغازي 10 دينار\nعطر صندلية 199 دينار\nعطر غرام ذهب 249 دينار';

    it('REGRESSION: correct itemized total (39+10=49) is flagged without price_math', () => {
        // Documents today's defect — the reply that prod replaced with the deflection.
        const reply = 'سعر 3 أطراف 39 دينار، والتوصيل لبنغازي 10 دينار، فيكون المجموع 49 دينار.';
        expect(flagHallucinatedPrice(reply, kb)).toBe(true);
    });

    it('the same total passes when price_math shows verified work', () => {
        const reply = 'سعر 3 أطراف 39 دينار، والتوصيل لبنغازي 10 دينار، فيكون المجموع 49 دينار.';
        const pm = [{ total: 49, terms: [{ unit: 39, qty: 1 }, { unit: 10, qty: 1 }] }];
        expect(flagHallucinatedPrice(reply, kb, pm)).toBe(false);
    });

    it('quantity product: كيسين (2×37) + توصيل 10 = 84 passes; intermediate 74 accepted too', () => {
        // The v54 quantity class — survives today only because PURCHASE_INTENT
        // skips the guard; must also survive when the turn classifies QUESTION.
        const reply = 'كيسين من بخور العنفر بـ 74 دينار والتوصيل 10 دنانير، المجموع 84 دينار.';
        const pm = [{ total: 84, terms: [{ unit: 37, qty: 2 }, { unit: 10, qty: 1 }] }];
        expect(flagHallucinatedPrice(reply, kb, pm)).toBe(false);
    });

    it('multi-total reply: an array vouches for each total independently', () => {
        const reply = 'الطرف الواحد مع توصيل بنغازي 49 دينار، وعطر صندلية مع غرام ذهب والتوصيل 458 دينار.';
        const pm = [
            { total: 49, terms: [{ unit: 39, qty: 1 }, { unit: 10, qty: 1 }] },
            { total: 458, terms: [{ unit: 199, qty: 1 }, { unit: 249, qty: 1 }, { unit: 10, qty: 1 }] },
        ];
        expect(flagHallucinatedPrice(reply, kb, pm)).toBe(false);
    });

    it('ADDITIVE ONLY: valid price_math cannot launder an unrelated hallucinated price', () => {
        // price_math verifies 49, but the reply ALSO quotes an invented 999 —
        // the model-controlled field must extend KB grounding, never bypass it.
        const reply = 'المجموع 49 دينار، وعندنا قلادة فاخرة بـ 999 دينار.';
        const pm = [{ total: 49, terms: [{ unit: 39, qty: 1 }, { unit: 10, qty: 1 }] }];
        expect(flagHallucinatedPrice(reply, kb, pm)).toBe(true);
    });

    it('addend not in KB → claim rejected → total still flagged', () => {
        // Hallucinated line item (55 is nowhere in the KB) — showing "work"
        // built on invented numbers earns nothing.
        const reply = 'المجموع 65 دينار.';
        const pm = [{ total: 65, terms: [{ unit: 55, qty: 1 }, { unit: 10, qty: 1 }] }];
        expect(flagHallucinatedPrice(reply, kb, pm)).toBe(true);
    });

    it('arithmetic that does not add up → claim rejected', () => {
        const reply = 'المجموع 60 دينار.';
        const pm = [{ total: 60, terms: [{ unit: 39, qty: 1 }, { unit: 10, qty: 1 }] }];
        expect(flagHallucinatedPrice(reply, kb, pm)).toBe(true);
    });

    it('malformed price_math degrades to today\'s behavior (never past it)', () => {
        const reply = 'المجموع 49 دينار.';
        // Deliberately malformed shapes a misbehaving model could emit.
        const malformed = [
            null,
            42,
            'nonsense',
            [{ total: 49 }],
            [{ total: 49, terms: 'x' }],
            [{ total: 49, terms: [] }],
            [{ total: 49, terms: [{ unit: 39, qty: -1 }, { unit: 10, qty: 1 }] }],
            [{ total: 49, terms: [{ unit: 39, qty: 0.5 }, { unit: 10, qty: 1 }] }],
            [{ total: NaN, terms: [{ unit: 39, qty: 1 }, { unit: 10, qty: 1 }] }],
        ];
        for (const pm of malformed) {
            expect(flagHallucinatedPrice(reply, kb, pm)).toBe(true);
        }
        // And a KB-literal price stays fine regardless of garbage price_math.
        expect(flagHallucinatedPrice('السعر 39 دينار.', kb, 'garbage')).toBe(false);
    });

    it('absent price_math (undefined/null) is exactly the pre-v56 guard', () => {
        expect(flagHallucinatedPrice('السعر 39 دينار.', kb)).toBe(false);
        expect(flagHallucinatedPrice('السعر 39 دينار.', kb, null)).toBe(false);
        expect(flagHallucinatedPrice('المجموع 49 دينار.', kb, null)).toBe(true);
    });

    it('Arabic-Indic digits in the reply still match a verified total', () => {
        const reply = 'المجموع ٤٩ دينار.';
        const pm = [{ total: 49, terms: [{ unit: 39, qty: 1 }, { unit: 10, qty: 1 }] }];
        expect(flagHallucinatedPrice(reply, kb, pm)).toBe(false);
    });

    // ── e5313a4c blast-radius check, replayed on REAL prod order confirmations ──
    // Stage B of that fix newly runs Check 1 on PURCHASE_INTENT *and* lets the
    // backend swap the reply. متجر إجدابيا is the merchant most exposed to it:
    // 100 PURCHASE_INTENT turns in six days, 57 answered with a reply containing a
    // number, and 20 of those quote a COMPUTED total that does not appear literally
    // in the KB. Before e5313a4c all 20 shipped unchecked; now each one ships only
    // if its price_math verifies. These replay real reply text (verbatim from
    // prod, 2026-07-21→27) with the price_math the model must emit for it, so a
    // regression that silently converts his order confirmations into the «تواصل
    // معنا» deflection fails here instead of at the moment of sale.
    // KB values used below are his real ones: زيت توتيان 39/طرف, عرض الطرفين 69,
    // and the per-city delivery table (توكرة 20, سبها 35, درنة 30, بنغازي 10).
    describe('PURCHASE_INTENT order confirmations survive Stage B', () => {
        const ajdabiaKb = [
            'زيت توتيان للتساقط يوقف التساقط من اول اسبوع سعر الطرف 39 دينار',
            'عرض الطرفين مع بعض ب 69 دينار',
            'سعر الثلاث اطرف 39 دينار (توصيل مجاني لأجدابيا فقط)',
            'توصيل بنغازي 10 دينار',
            'توكرة 20', 'سبها 35', 'درنة 30',
        ].join('\n');

        it('item + delivery total (39+20=59) passes with price_math', () => {
            const reply = 'طلبك طرف واحد زيت توتيان سعره 39 دينار، وتوصيل توكرة 20 دينار، المجموع 59 دينار. يوصلك الطلب خلال 24 ساعة إن شاء الله.';
            const pm = [{ total: 59, terms: [{ unit: 39, qty: 1 }, { unit: 20, qty: 1 }] }];
            expect(flagHallucinatedPrice(reply, ajdabiaKb, pm)).toBe(false);
        });

        it('quantity product + delivery (39×2=78, +35 = 113) passes with price_math', () => {
            const reply = 'طلبك 2 طرف من زيت توتيان للتساقط، سعر الطرف 39 دينار × 2 = 78 دينار، وتوصيل سبها 35 دينار، المجموع 113 دينار.';
            const pm = [{ total: 113, terms: [{ unit: 39, qty: 2 }, { unit: 35, qty: 1 }] }];
            expect(flagHallucinatedPrice(reply, ajdabiaKb, pm)).toBe(false);
        });

        it('the offer + free-delivery city (39+0=39) passes with price_math', () => {
            const reply = 'عرض 3 أطراف من زيت توتيان سعره 39 دينار، وتوصيل أجدابيا مجاني، المجموع 39 دينار.';
            const pm = [{ total: 39, terms: [{ unit: 39, qty: 1 }, { unit: 0, qty: 1 }] }];
            expect(flagHallucinatedPrice(reply, ajdabiaKb, pm)).toBe(false);
        });

        // The OTHER half of the fix, and the reason it is worth its blast radius:
        // this exact reply shipped to a customer on 2026-07-23 12:22 during a
        // PURCHASE_INTENT turn and was NOT flagged, because Check 1 was gated off.
        // His KB prices two أطراف at 69 («عرض الطرفين مع بعض ب 69 دينار») and 70
        // appears NOWHERE in it, so both the unit and the 100 total are invented —
        // the customer was quoted a price his merchant never set.
        it('CATCHES the real invented «70 دينار» order confirmation from prod', () => {
            const reply = 'تمام، اثنين طرف من زيت توتيان ب 70 دينار، والتوصيل لدرنة 30 دينار، المجموع 100 دينار. أرسل لي اسم المدينة ورقم الاتصال باش نكملك الطلب.';
            expect(flagHallucinatedPrice(reply, ajdabiaKb)).toBe(true);
            // Trust-but-VERIFY: even when the model vouches for its own invented
            // unit in price_math, 70 is not in the KB so the claim is rejected.
            const selfServingPm = [{ total: 100, terms: [{ unit: 70, qty: 1 }, { unit: 30, qty: 1 }] }];
            expect(flagHallucinatedPrice(reply, ajdabiaKb, selfServingPm)).toBe(true);
        });

        // Quantifies the residual risk rather than asserting it away: every total
        // above is grounded ONLY by price_math. If emission regresses (prompt edit,
        // model swap, a cache path that drops the field), these become flagged and
        // — on a purchase turn, post-Stage B — get swapped for the deflection.
        // Eval #720 is the live proof this can happen: it is the one FAIL in the
        // 97.0% run, and the same terse shape («الحساب كم بالتوصيل») deflected in
        // this merchant's real traffic on 2026-07-22 while the restated turn a
        // minute later answered «المجموع 49 دينار» correctly.
        it('DOCUMENTS THE RISK: the same totals all flag when price_math is absent', () => {
            const confirmations = [
                'طلبك طرف واحد زيت توتيان سعره 39 دينار، وتوصيل توكرة 20 دينار، المجموع 59 دينار.',
                'طلبك 2 طرف، سعر الطرف 39 دينار × 2 = 78 دينار، وتوصيل سبها 35 دينار، المجموع 113 دينار.',
            ];
            for (const reply of confirmations) {
                expect(flagHallucinatedPrice(reply, ajdabiaKb)).toBe(true);
            }
        });
    });

    // ── BUNDLE-UNIT errors: a THIRD defect class, still OPEN ────────────────
    // Prod (Nourva, 2026-07-23 11:58 — the fleet's highest-volume page). The KB
    // sells a 1+1 bundle: «قطعتين بسعر قطعة واحدة فقط! السعر الآن: 160 دينار»,
    // i.e. 160 buys TWO pieces. A customer ordered four («واحد 34 واثنين 36
    // واحد 38») and the AI answered «السعر الإجمالي 640 دينار» — it read 160 as
    // a PER-PIECE price and multiplied by 4. The correct total is 2 bundles =
    // 320. Exactly double, quoted at the moment of sale, with no flag.
    // The sale was lost in the next two turns: she asked «ليش كم سعره هو», got
    // the promo wall instead of an answer, and left with «شكرا القيته في صفحة 45».
    //
    // This is NOT the BAMBO class (no grounding at all) nor the إجدابيا class
    // (right units, arithmetic on them). Here the unit VALUE is real and in the
    // KB — its MEANING is wrong. Check 1 grounds values, never unit semantics,
    // so v56's trust-but-verify accepts a self-consistent proof of a false
    // premise. Contrast the إجدابيا «70» case above, caught only because 70
    // appears nowhere in that KB.
    describe('bundle-unit semantics (Nourva) — OPEN defect', () => {
        // The exact ambiguity from the live KB: nothing states what one unit of
        // 160 buys in a form that is safe to multiply.
        const bundleKb = [
            'اليوم ستحصلين على قطعتين بسعر قطعة واحدة فقط!',
            '💰 السعر الآن: 160 دينار فقط بدلاً من 320 دينار',
            '🚚 شحن VIP مجاني حتى باب منزلكِ أينما كنتِ داخل ليبيا.',
            'هذا العرض متاح لأول 25 عميلة فقط، وبعد اكتمال العدد يعود السعر مباشرة إلى 320 دينار.',
        ].join('\n');

        const reply640 = 'يا ملكة 👑 طلبك: قطعة واحدة مقاس A (34)، وقطعتين مقاس B (36)، وقطعة واحدة مقاس C (38). السعر الإجمالي 640 دينار فقط مع التوصيل المجاني! 💖';

        // The half e5313a4c DID cure: with the check no longer gated to QUESTION,
        // a silent model's 640 is caught on the purchase turn and the backend
        // swaps in PRICE_FALLBACK (shouldUseFallback('price_not_in_kb',
        // 'PURCHASE_INTENT') === true). Pre-fix this shipped as-is.
        it('is caught when the model emits no price_math (the half e5313a4c cured)', () => {
            expect(flagHallucinatedPrice(reply640, bundleKb)).toBe(true);
        });

        // KNOWN DEFECT — `it.fails` on purpose (same convention as
        // integration/flagMeta.test.ts). This test PASSES while the hole exists
        // and starts FAILING the moment someone teaches price_math unit
        // semantics — at which point flip it to a plain `it` and delete this
        // comment. Do NOT "fix" it by relaxing the assertion.
        //
        // The claim below is what a model FOLLOWING the v56 instruction emits for
        // this reply: every addend is literally in the KB (160 ✓) and the
        // arithmetic is internally consistent (160×4 = 640 ✓), so the claim
        // verifies and the 2× overcharge is laundered straight through. The more
        // diligently the model shows its work, the more reliably the bug ships.
        it.fails('SHOULD flag a wrong-premise price_math that multiplies a bundle unit per-piece', () => {
            const wrongPremise = [{ total: 640, terms: [{ unit: 160, qty: 4 }] }];
            expect(flagHallucinatedPrice(reply640, bundleKb, wrongPremise)).toBe(true);
        });

        // The correct answer for four pieces, so a future fix has a green target
        // and cannot be implemented by rejecting every bundle multiplication.
        it('the CORRECT total (2 bundles = 320) passes with price_math', () => {
            const correct = [{ total: 320, terms: [{ unit: 160, qty: 2 }] }];
            expect(flagHallucinatedPrice('السعر الإجمالي 320 دينار مع التوصيل المجاني', bundleKb, correct)).toBe(false);
        });

        // Regression guard for the path that works today and must keep working:
        // the single-bundle quote. Every other total-bearing reply on this page
        // (11 of 12 sampled over 7 days) is this shape and is correct.
        it('the single-bundle quote (160) still passes untouched', () => {
            expect(flagHallucinatedPrice('السعر الإجمالي 160 دينار فقط مع التوصيل المجاني', bundleKb)).toBe(false);
        });
    });

    // REVIEW REGRESSION (2026-07-22): `unit > 0` rejected the whole claim when the
    // model itemized a FREE delivery line as 0 — reinstating the exact deflection
    // v56 exists to fix, for every merchant with a free-delivery city (the shipped
    // prod KB has «توصيل اجدابيا مجاني»). Zero units are also exempt from the KB
    // lookup: "free" is written «مجاني», never as a literal 0.
    it('a free line itemized as 0 does not reject the claim', () => {
        const freeKb = 'الياسمين 40 دينار\nالمسك 120 دينار\nتوصيل طرابلس 12 دينار\nتوصيل مصراتة مجاني';
        const reply = 'الياسمين 40 والمسك 120، والتوصيل لمصراتة مجاني، المجموع 160 دينار.';
        const pm = [{ total: 160, terms: [{ unit: 40, qty: 1 }, { unit: 120, qty: 1 }, { unit: 0, qty: 1 }] }];
        expect(flagHallucinatedPrice(reply, freeKb, pm)).toBe(false);
        // …and the same cart without the explicit zero line stays valid too.
        expect(flagHallucinatedPrice(reply, freeKb,
            [{ total: 160, terms: [{ unit: 40, qty: 1 }, { unit: 120, qty: 1 }] }])).toBe(false);
    });

    it('a zero term cannot launder a hallucinated total (adds nothing to the sum)', () => {
        const freeKb = 'الياسمين 40 دينار\nتوصيل مصراتة مجاني';
        // Claims 999 while the terms produce 40 — the zero line changes nothing.
        const pm = [{ total: 999, terms: [{ unit: 40, qty: 1 }, { unit: 0, qty: 1 }] }];
        expect(flagHallucinatedPrice('المجموع 999 دينار.', freeKb, pm)).toBe(true);
    });

    it('quantity cap bounds how far a minted product can move a total', () => {
        // 40 is in KB, so unit×qty mints an accepted value; qty above the cap is
        // not verified and the total falls back to the literal-KB check.
        const qtyKb = 'الياسمين 40 دينار';
        expect(flagHallucinatedPrice('المجموع 4000 دينار.', qtyKb,
            [{ total: 4000, terms: [{ unit: 40, qty: 100 }] }])).toBe(false);
        expect(flagHallucinatedPrice('المجموع 10000 دينار.', qtyKb,
            [{ total: 10000, terms: [{ unit: 40, qty: 250 }] }])).toBe(true);
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
        const out = stripSelfIdentification('I am a chatbot. The price is 150 SAR and we deliver fast.');
        expect(out.reply).not.toMatch(/chatbot/i);
        expect(out.reply).toContain('The price is 150 SAR');
        expect(out.stripped).toBe(true);
    });

    // Exhausted strip = the ENTIRE reply was reveal talk. The old contract
    // substituted a canned SELF_ID_FALLBACKS identity line here, which answered
    // "who are you?" regardless of what the customer actually asked (prod,
    // 2026-08-01: «موقعكم الالكتروني» → «معك أحد أعضاء الفريق…», repeated
    // verbatim on retry). New contract: the validator NEVER invents text — an
    // exhausted strip returns an EMPTY reply and the backend holds the message
    // for merchant review (same shape as held_low_confidence) instead of
    // sending a non-answer.
    // One assertion per LANGUAGE, not per call: the fallbackLang parameter is
    // gone, so the emptiness is language-independent by construction and two
    // identical English calls would have proved nothing about Arabic.
    it.each([
        ['EN', 'I am a bot.'],
        ['AR', 'أنا روبوت.'],
    ])('returns an EMPTY reply when nothing useful remains — never substituted text (%s)', (_lang, reply) => {
        expect(stripSelfIdentification(reply)).toEqual({ reply: '', stripped: true });
    });

    it('leaves a clean reply untouched and reports stripped:false', () => {
        const out = stripSelfIdentification('Hello there, how can I help?');
        expect(out.reply).toBe('Hello there, how can I help?');
        expect(out.stripped).toBe(false);
    });

    it('strips the Jawab24 brand name', () => {
        const out = stripSelfIdentification('This is Jawab24 speaking. Our hours are 9 to 5 every weekday here.');
        expect(out.reply).not.toMatch(/jawab24/i);
        expect(out.reply).toContain('Our hours are 9 to 5');
    });

    it('returns empty input unchanged', () => {
        expect(stripSelfIdentification('')).toEqual({ reply: '', stripped: false });
    });

    // Regression (prod 2026-07-17): the dot inside "Jawab24.com" was treated as a
    // sentence boundary, so stripping the brand sentence left the orphaned TLD
    // fragment "com ممكن يساعدوك أكتر." which was sent to a customer.
    it('does not split inside a domain — no orphaned "com" fragment survives', () => {
        const out = stripSelfIdentification(
            'ما عندي هالمعلومة حالياً، بس فريق Jawab24.com ممكن يساعدوك أكتر.');
        expect(out.reply).not.toMatch(/jawab24/i);
        expect(out.reply).not.toMatch(/\bcom\b/);
        // Whole sentence stripped → under 10 useful chars → exhausted, empty.
        expect(out.reply).toBe('');
    });

    it('keeps non-offending sentences intact when a domain sentence is stripped', () => {
        const out = stripSelfIdentification(
            'You can visit Jawab24.com for details. Our hours are 9 to 5 every weekday here.');
        expect(out.reply).not.toMatch(/jawab24|(^|\s)com\b/i);
        expect(out.reply).toContain('Our hours are 9 to 5');
    });

    it('does not treat decimals as sentence boundaries', () => {
        const reply = 'I am a bot. Delivery takes 2.5 days on average for most orders.';
        const out = stripSelfIdentification(reply);
        expect(out.reply).toBe('Delivery takes 2.5 days on average for most orders.');
    });

    // «ذكاء اصطناعي» is ordinary PRODUCT vocabulary (phone cameras, TVs) — it is a
    // self-reveal only when the reply describes the RESPONDER as automated. "Who is
    // the AI in this sentence?" is a meaning question no regex or marker list can
    // answer (a pronoun heuristic needed dialect patches within the hour), so the
    // MODEL answers it via the structured self_identified_as_automation flag —
    // threaded here as `selfReported`. Before this gate, a faithful Galaxy S24 spec
    // answer was nuked to the fallback pool (eval #236, diagnosed 2026-07-24).
    describe('ambiguous AI vocabulary — gated by the model self-report (v59)', () => {
        it('keeps an Arabic spec sentence mentioning ذكاء اصطناعي when the model did not self-report', () => {
            const reply = 'كاميرا Samsung Galaxy S24 بدقة 200 ميجابكسل مع ذكاء اصطناعي، وشاشة 6.2 بوصة بسطوع عالي.';
            expect(stripSelfIdentification(reply)).toEqual({ reply, stripped: false });
        });

        it('keeps an English AI-feature sentence without a self-report', () => {
            const reply = 'The S24 camera uses artificial intelligence for photo editing and instant translation.';
            expect(stripSelfIdentification(reply)).toEqual({ reply, stripped: false });
        });

        it('strips a self-reported AI reveal to EMPTY when nothing else remains («أنا ذكاء اصطناعي»)', () => {
            const out = stripSelfIdentification('أنا ذكاء اصطناعي أساعدك هنا.', true);
            expect(out.reply).toBe('');
            expect(out.stripped).toBe(true);
        });

        it('is dialect-blind by design — the flag decides, not pronoun lists («آني ذكاء اصطناعي»)', () => {
            const out = stripSelfIdentification('آني ذكاء اصطناعي وياك للرد السريع. التوصيل خلال يومين لكل المناطق.', true);
            expect(out.reply).not.toMatch(/ذكاء اصطناعي/);
            expect(out.reply).toContain('التوصيل خلال يومين');
        });

        it('strips only the self-reported AI sentence and keeps the informative rest', () => {
            const out = stripSelfIdentification(
                'I am an artificial intelligence assistant. Delivery takes 3 days for most orders.', true);
            expect(out.reply).not.toMatch(/artificial intelligence/i);
            expect(out.reply).toContain('Delivery takes 3 days');
        });

        // The trust decision, pinned honestly: without the model flag the validator
        // does NOT touch ambiguous AI wording (literal first-person claims like
        // «أنا ذكاء اصطناعي» are decisive and caught regardless — see botWords).
        // The PROMPT is the primary prevention (identity rule + mandatory flag);
        // the self-report is the classifier for everything non-literal; and slips
        // are observable in prod via self_identification_stripped counts.
        it('without a self-report, non-first-person AI wording passes through the VALIDATOR untouched', () => {
            const reply = 'هذا النظام يعتمد على الذكاء الاصطناعي في اقتراح المقاسات المناسبة.';
            expect(stripSelfIdentification(reply, false)).toEqual({ reply, stripped: false });
        });

        it('the literal first-person claim «أنا ذكاء اصطناعي» is DECISIVE — stripped to EMPTY even without the flag', () => {
            const out = stripSelfIdentification('أنا ذكاء اصطناعي أساعدك هنا.', false);
            expect(out.reply).toBe('');
            expect(out.stripped).toBe(true);
        });

        it('lexically-decisive reveals (chatbot / first-person «أنا روبوت») strip regardless of the flag', () => {
            const out = stripSelfIdentification('You are talking to a chatbot. The device costs 2900 SAR with tax.');
            expect(out.reply).not.toMatch(/chatbot/i);
            expect(out.reply).toContain('2900 SAR');

            const ar = stripSelfIdentification('أنا روبوت أرد عليك تلقائياً. سعر الجهاز 2900 ريال شامل الضريبة.');
            expect(ar.reply).not.toMatch(/روبوت/);
            expect(ar.reply).toContain('2900 ريال');
        });

        // روبوت / "robot" are PRODUCTS — robot vacuums, robot toys (#495 review:
        // the same bug class as #236, one word over). Only the model's report or
        // a literal first-person claim makes them a reveal.
        it('keeps ROBOT-product sentences in both languages when the model did not self-report', () => {
            const ar = 'مكنسة روبوت ذكية للتنظيف اليومي بسعر 899 ريال.';
            expect(stripSelfIdentification(ar)).toEqual({ reply: ar, stripped: false });
            const en = 'The robot vacuum cleans daily and costs 899 SAR.';
            expect(stripSelfIdentification(en)).toEqual({ reply: en, stripped: false });
        });

        it('strips a روبوت sentence when the model self-reported', () => {
            const out = stripSelfIdentification('معك روبوت الرد الآلي هنا. الشحن متاح لكل المدن.', true);
            expect(out.reply).not.toMatch(/روبوت/);
            expect(out.reply).toContain('الشحن متاح');
        });
    });

    // On the vendor's OWN page the brand IS the business — stripping it turned
    // every website/app-link answer into a SELF_ID_FALLBACKS identity line
    // (prod, Jawab24 support page, 2026-08-01: «موقعكم الالكتروني» asked 3×,
    // deflected 3×). Brand needles and the flag-gated AI vocabulary are product
    // talk there; first-person tripwires and "chatbot" stay decisive everywhere.
    describe('own-brand page exemption (ownBrandPage)', () => {
        it('keeps the brand and the website URL on the vendor page — the exact prod failure', () => {
            const reply = 'موقعنا الإلكتروني https://jawab24.com وفيه كل التفاصيل عن الخدمة.';
            expect(stripSelfIdentification(reply, false, true)).toEqual({ reply, stripped: false });
        });

        it('keeps a self-reported product description on the vendor page («جواب24 منصة ذكاء اصطناعي»)', () => {
            const reply = 'جواب24 منصة ذكاء اصطناعي ترد على عملائك تلقائياً على مدار الساعة.';
            expect(stripSelfIdentification(reply, true, true)).toEqual({ reply, stripped: false });
        });

        it('still strips first-person bot claims on the vendor page — the tripwire is universal', () => {
            const out = stripSelfIdentification('أنا روبوت أرد تلقائياً. موقعنا jawab24.com دائماً متاح.', false, true);
            expect(out.stripped).toBe(true);
            expect(out.reply).not.toMatch(/أنا روبوت/);
            expect(out.reply).toContain('jawab24.com');
        });

        it('still strips "chatbot" on the vendor page', () => {
            const out = stripSelfIdentification('You are talking to a chatbot. Visit jawab24.com for details today.', false, true);
            expect(out.stripped).toBe(true);
            expect(out.reply).not.toMatch(/chatbot/i);
            expect(out.reply).toContain('jawab24.com');
        });

        // The no-space Arabic form slipped through the original needle and reached
        // customers on merchant pages (prod, 2026-08-01: «جواب24 هو موظف ذكي…»
        // survived Check 6 on the vendor page only by luck of this gap).
        it('strips the no-space «جواب24» form on MERCHANT pages', () => {
            const out = stripSelfIdentification('هذا الرد من جواب24 التلقائي. ساعات الدوام من 9 صباحاً حتى 5 مساءً.');
            expect(out.stripped).toBe(true);
            expect(out.reply).not.toMatch(/جواب24/);
            expect(out.reply).toContain('ساعات الدوام');
        });
    });
});

describe('isOwnBrandPage', () => {
    it('matches the vendor page name in all brand spellings', () => {
        for (const name of ['Jawab24', 'jawab24', 'Jawab 24', 'جواب24', 'جواب 24', 'جواب٢٤', 'جواب ٢٤ للدعم']) {
            expect(isOwnBrandPage(name)).toBe(true);
        }
    });

    it('rejects merchant page names and missing names', () => {
        for (const name of ['متجر الإلكترونيات', 'BAMBO LIBYA', 'معهد الفريق الدمشقي للتأهيل', undefined]) {
            expect(isOwnBrandPage(name)).toBe(false);
        }
    });
});

describe('validateReply orchestration', () => {
    const base = (over: Partial<ParsedReply>): ParsedReply => ({
        reply: 'ok', intent: 'QUESTION', confidence: 'high', hedging: false, language: 'en', flags: [], ...over,
    });

    // WIRING (v56): the checks above are also unit-tested directly, but nothing
    // proved validateReply actually FORWARDS parsed.price_math into Check 1 —
    // dropping the argument at the call site would leave every other test green
    // while the whole feature silently no-ops (caught in review, 2026-07-22).
    // These two cases pin the wiring from both sides.
    const cartKb = 'الثلاث أطراف 42 دينار\nتوصيل طرابلس 12 دينار';
    const cartReply = 'الثلاث أطراف 42 دينار والتوصيل لطرابلس 12 دينار، المجموع 54 دينار.';

    it('Check 1: forwards price_math — a verified total is NOT flagged', () => {
        const out = validateReply(
            base({
                reply: cartReply, language: 'ar',
                price_math: [{ total: 54, terms: [{ unit: 42, qty: 1 }, { unit: 12, qty: 1 }] }],
            }),
            req('الحساب كم بالتوصيل', { knowledgeBase: cartKb }),
        );
        expect(out.flags).not.toContain('price_not_in_kb');
    });

    it('Check 1: the SAME reply without price_math is flagged (proves the arg matters)', () => {
        const out = validateReply(
            base({ reply: cartReply, language: 'ar' }),
            req('الحساب كم بالتوصيل', { knowledgeBase: cartKb }),
        );
        expect(out.flags).toContain('price_not_in_kb');
    });

    // Phase V: the e-commerce tool loop now runs validateReply on its replies.
    // The Phase-2 (post-tool-results) reply passes skipPriceCheck — its prices
    // are verified tool results (a computed total isn't in the static KB, so the
    // heuristic would false-flag it → destructive fallback swap). Phase-1 direct
    // replies (answered from static KB) keep the full check.
    const phoneKb = 'We sell the iPhone 15 and accessories.'; // product named, price not
    const priceReply = 'The iPhone 15 is 3800 SAR and in stock.';

    it('skipPriceCheck: a tool-sourced price (not in the static KB) is NOT flagged (Phase-2)', () => {
        const out = validateReply(
            base({ reply: priceReply }),
            req('how much is the iphone 15', { knowledgeBase: phoneKb }),
            { skipPriceCheck: true },
        );
        expect(out.flags).not.toContain('price_not_in_kb');
    });

    it('skipPriceCheck omitted: the SAME reply IS flagged (default/Phase-1/provider path unchanged)', () => {
        const out = validateReply(
            base({ reply: priceReply }),
            req('how much is the iphone 15', { knowledgeBase: phoneKb }),
        );
        expect(out.flags).toContain('price_not_in_kb');
    });

    it('skipPriceCheck disables ONLY the price check — language mismatch still fires', () => {
        const out = validateReply(
            base({ reply: 'Hello there, the iPhone 15 is 3800 SAR', language: 'en' }),
            req('كم سعر الايفون؟', { knowledgeBase: phoneKb }),
            { skipPriceCheck: true },
        );
        expect(out.flags).not.toContain('price_not_in_kb');
        expect(out.flags).toContain('language_mismatch');
    });

    // BAMBO LIBYA regression (prod, 2026-07-27): Check 1 was gated on
    // `intent === 'QUESTION'`, so it never ran while the customer was BUYING.
    // Real thread, one customer, 90 seconds — «نعم» (PURCHASE_INTENT) got
    // «سعره 1200 دينار ليبي», unflagged; «كم سعره» (QUESTION) was flagged.
    // 1200 exists nowhere: the KB's only digits are the phone number, and the
    // page has no catalog items.
    const bamboKb = [
        'BAMBO LIBYA هي الصفحة الرسمية للوكيل الحصري لمنتجات BAMBO Nature وAbena في ليبيا.',
        'إذا سأل عن السعر — إذا لم يكن السعر موجوداً: أرسل اسم المنتج وسنرسل لك السعر في أقرب وقت.',
        'A صيدلية اكسجين المركزيه - سراج',
        'A صيدلية الحكمة-جنزور',
        'الهاتف: +218 92 088 9583',
    ].join('\n');
    const bamboPriceReply = 'باكو واحد من حفاظات بامبو رقم 5 أو رقم 6 سعره 1200 دينار ليبي.';

    it('Check 1: an invented price is flagged during PURCHASE_INTENT', () => {
        const out = validateReply(
            base({ reply: bamboPriceReply, intent: 'PURCHASE_INTENT', language: 'ar' }),
            req('نعم', { knowledgeBase: bamboKb }),
        );
        expect(out.flags).toContain('price_not_in_kb');
    });

    it('Check 1: the SAME reply as a QUESTION is flagged (intent is the only difference)', () => {
        const out = validateReply(
            base({ reply: bamboPriceReply, intent: 'QUESTION', language: 'ar' }),
            req('كم سعره', { knowledgeBase: bamboKb }),
        );
        expect(out.flags).toContain('price_not_in_kb');
    });

    it('Check 1: a grounded price is NOT flagged during PURCHASE_INTENT (no false positive)', () => {
        const out = validateReply(
            base({ reply: bamboPriceReply, intent: 'PURCHASE_INTENT', language: 'ar' }),
            req('نعم', { knowledgeBase: `${bamboKb}\nباكو حفاظات بامبو رقم 5 — 1200 دينار` }),
        );
        expect(out.flags).not.toContain('price_not_in_kb');
    });

    // Same thread, «العجيلات» → seven pharmacies listed. العجيلات appears ZERO times
    // in the KB and five of the seven names appear nowhere. intent was QUESTION so
    // Check 1 ran — and passed it, because Check 1 grounds only NUMBERS. No name or
    // place grounding exists anywhere in the validator.
    it.todo('a place/entity name absent from the KB is flagged (check not built yet)');

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

    it('v53: passes the gender self-report through, mapping snake_case to camelCase', () => {
        const out = validateReply(
            base({ reply: 'أهلاً بكِ', language: 'ar', gender: 'f', gender_basis: 'name', used_name: false }),
            req('كم السعر؟'),
        );
        expect(out.gender).toBe('f');
        expect(out.genderBasis).toBe('name');
        expect(out.usedName).toBe(false);
    });

    it('v53: absent gender fields stay undefined (old responses / non-emitting paths)', () => {
        const out = validateReply(base({ reply: 'ok' }), req('hi'));
        expect(out.gender).toBeUndefined();
        expect(out.genderBasis).toBeUndefined();
        expect(out.usedName).toBeUndefined();
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

    // Check 6 wiring (v59): the model's structured self-report gates the ambiguous
    // AI vocabulary, and every swap is recorded — Check 6 must never mutate a
    // reply silently again (the silence is how eval #236 hid for months).
    describe('Check 6 wiring — self-report gate + observability flag', () => {
        it('model-flagged AI reveal → stripped AND recorded', () => {
            const out = validateReply(
                base({ reply: 'أنا ذكاء اصطناعي أساعدك هنا.', language: 'ar', flags: ['self_identified_as_automation'] }),
                req('انت بشر؟'),
            );
            expect(out.reply).not.toMatch(/ذكاء اصطناعي/);
            expect(out.flags).toContain('self_identification_stripped');
        });

        it('unflagged PRODUCT-AI reply → untouched, nothing recorded', () => {
            const reply = 'كاميرا Samsung Galaxy S24 بدقة 200 ميجابكسل مع ذكاء اصطناعي، وشاشة 6.2 بوصة.';
            const out = validateReply(base({ reply, language: 'ar' }), req('وش مواصفات السامسونج'));
            expect(out.reply).toBe(reply);
            expect(out.flags).not.toContain('self_identification_stripped');
        });

        it('lexically-decisive reveal («أنا روبوت») → stripped and recorded even WITHOUT the model flag', () => {
            const out = validateReply(
                base({ reply: 'أنا روبوت أرد عليك تلقائياً. سعر الجهاز 2900 ريال شامل الضريبة.', language: 'ar' }),
                req('كم السعر؟'),
            );
            expect(out.reply).not.toMatch(/روبوت/);
            expect(out.reply).toContain('2900 ريال');
            expect(out.flags).toContain('self_identification_stripped');
        });

        it('ROBOT-product reply → untouched (robot vacuums are products, not reveals)', () => {
            const reply = 'مكنسة روبوت ذكية للتنظيف اليومي، شحن مجاني فوق 500 ريال.';
            const out = validateReply(base({ reply, language: 'ar' }), req('عندكم مكانس؟'));
            expect(out.reply).toBe(reply);
            expect(out.flags).not.toContain('self_identification_stripped');
        });

        // Wiring for the own-brand exemption: validateReply must derive it from
        // request.context.pageName — dropping that argument at the call site
        // would leave the direct stripSelfIdentification tests green while the
        // vendor page regresses to identity fallbacks (the 2026-08-01 incident).
        it('vendor page (context.pageName = Jawab24) → brand/URL reply survives untouched', () => {
            const reply = 'موقعنا الإلكتروني https://jawab24.com وفيه كل تفاصيل الخدمة والأسعار.';
            const out = validateReply(
                base({ reply, language: 'ar' }),
                req('موقعكم الالكتروني؟', { pageName: 'Jawab24' }),
            );
            expect(out.reply).toBe(reply);
            expect(out.flags).not.toContain('self_identification_stripped');
        });

        it('merchant page → the SAME brand reply is stripped (proves pageName drives the exemption)', () => {
            const out = validateReply(
                base({ reply: 'موقعنا الإلكتروني https://jawab24.com وفيه كل تفاصيل الخدمة والأسعار.', language: 'ar' }),
                req('موقعكم الالكتروني؟', { pageName: 'متجر الإلكترونيات' }),
            );
            expect(out.reply).not.toMatch(/jawab24/i);
            expect(out.flags).toContain('self_identification_stripped');
        });

        // Exhausted strip crosses the service boundary as a FLAG plus an empty
        // reply — never as invented text. The backend generator maps the flag to
        // a hold (mirroring held_low_confidence) so the merchant answers
        // personally instead of the customer receiving a canned identity line
        // that ignores their question (prod, 2026-08-01).
        it('all-reveal reply → EMPTY reply + self_identification_exhausted flag (the hold signal)', () => {
            const out = validateReply(
                base({ reply: 'أنا روبوت أرد عليك تلقائياً.', language: 'ar' }),
                req('موقعكم الالكتروني؟'),
            );
            expect(out.reply).toBe('');
            expect(out.flags).toContain('self_identification_stripped');
            expect(out.flags).toContain('self_identification_exhausted');
        });

        it('partial strip keeps the informative rest and does NOT raise the exhausted flag', () => {
            const out = validateReply(
                base({ reply: 'أنا روبوت أرد عليك تلقائياً. سعر الجهاز 2900 ريال شامل الضريبة.', language: 'ar' }),
                req('كم السعر؟'),
            );
            expect(out.reply).toContain('2900 ريال');
            expect(out.flags).toContain('self_identification_stripped');
            expect(out.flags).not.toContain('self_identification_exhausted');
        });
    });
});

// A figure the vision step read off the CUSTOMER'S OWN photo is not a price claim
// about the merchant's goods. Prod 2026-08-30 (Z NET): a network owner sent a
// screenshot of his card SMS («قيمة 250 دج»); the model read it back and the guard
// swapped the reply for «للتأكد من السعر بدقة، تواصل معنا على أرقامنا» — inside a
// WhatsApp chat. Only the described-image segments widen the allow-list; the
// customer's TYPED numbers never do (anchored hallucinations must still flag).
describe('flagHallucinatedPrice — numbers read off the customer\'s own photo', () => {
    const kb = 'الاشتراك الشهري 2000 ريال يمني قديم أو 15 ريال سعودي';
    const photo = '[صورة: صورة لهاتف يُظهر رسالة نصية: "شكرك على استخدامك شبكة واي مكسب رقم الكرت 87391241142 قيمة 250 دج"]';
    const reply = 'شفت صورة رسالة الكرت رقم 87391241142 وقيمته 250 دج. إذا تبي تتأكد من حالة الكرت وضح لي أكثر.';

    it('REGRESSION: reading the photographed figure back is flagged without the customer text', () => {
        expect(flagHallucinatedPrice(reply, kb)).toBe(true);
    });

    it('passes when the figure came from the described image in the customer turn', () => {
        expect(flagHallucinatedPrice(reply, kb, undefined, photo)).toBe(false);
    });

    it('finds the description when consolidated with typed text and a second photo', () => {
        const consolidated = `${photo}\nوهو يفتهم لك\n[Image: another screenshot, card value 250 دج]`;
        expect(flagHallucinatedPrice(reply, kb, undefined, consolidated)).toBe(false);
    });

    it('a TYPED customer number does NOT launder an anchored hallucination', () => {
        expect(flagHallucinatedPrice('نعم، الاشتراك 500 ريال', kb, undefined, 'الاشتراك 500 ريال صح؟')).toBe(true);
    });

    it('ADDITIVE ONLY: a photo cannot launder an unrelated invented merchant price', () => {
        expect(flagHallucinatedPrice('الاشتراك السنوي 9000 ريال', kb, undefined, photo)).toBe(true);
    });

    it('validateReply forwards the customer turn into Check 1', () => {
        const parsed: ParsedReply = { reply, intent: 'QUESTION', confidence: 'high', hedging: false, language: 'ar', flags: [] };
        expect(validateReply(parsed, req(photo, { knowledgeBase: kb, channel: 'dm' })).flags).not.toContain('price_not_in_kb');
        expect(validateReply(parsed, req('شوف', { knowledgeBase: kb, channel: 'dm' })).flags).toContain('price_not_in_kb');
    });
});
