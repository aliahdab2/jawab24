import { describe, it, expect } from 'vitest';
import {
    isDirectImageUrl,
    findNonDirectImageUrls,
    findDuplicateTableRows,
    runDeterministicChecks,
    rankFindings,
    verifyQuote,
    type BusinessAuditFinding,
} from '../businessAudit';

/**
 * Excerpt of a REAL merchant KB (Ajdabiya store, Libya) — the KB that motivated
 * this feature. Kept verbatim, dialect and typos included: the checks have to
 * work on what merchants actually write, not on tidied fixtures.
 */
const REAL_KB = `💰 المنتجات والخدمات:
طارجو التحدث باللهجة الليبية مع الزباين
بخور العنفر الملكي https://ibb.co/V0SWbqSR هذا رابط اصورة بخور العنفر الملكي ارجو اظهار الصورة للزبون

وزنه 50 جرام
سعر بخور العنفر الملكي 37 دينار

 لما العميل يطلب صورة بخور انسام ارسله هذا الرابط فقط دون اكي كتابة اخرى https://files.catbox.moe/5mo9uz.jpg لا تكتب ها هو رابط بخور انسام
مكان المحل وموقع المحل https://maps.app.goo.gl/9wa3yAwhcNnSgkNx6

ملاحظة: اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)
ملاحظة : لما زبون يرسلك صورة لا ترد عليه

✦ اسعار التوصيل:
سرت 30
الابيار 25
البيضا 20
طرابلس 20
المرج 20
الابيار 25
القبة 20`;

describe('isDirectImageUrl', () => {
    it('accepts real image files, including with a query string', () => {
        expect(isDirectImageUrl('https://files.catbox.moe/5mo9uz.jpg')).toBe(true);
        expect(isDirectImageUrl('https://x.test/a.PNG')).toBe(true);
        expect(isDirectImageUrl('https://x.test/a.webp?v=2')).toBe(true);
    });

    it('rejects viewer/page URLs that only LOOK like image links', () => {
        // The bug this whole check exists for: an ImgBB viewer page, not a file.
        expect(isDirectImageUrl('https://ibb.co/V0SWbqSR')).toBe(false);
        expect(isDirectImageUrl('https://maps.app.goo.gl/9wa3yAwhcNnSgkNx6')).toBe(false);
    });
});

describe('findNonDirectImageUrls', () => {
    it('flags an image-intent line whose link opens a page', () => {
        const [finding] = findNonDirectImageUrls(REAL_KB);
        expect(finding.code).toBe('image_url_not_direct');
        expect(finding.kind).toBe('platform');
        expect(finding.quote).toBe('https://ibb.co/V0SWbqSR');
    });

    it("points at the merchant's OWN working link as the example", () => {
        const [finding] = findNonDirectImageUrls(REAL_KB);
        expect(finding.meta?.example).toBe('https://files.catbox.moe/5mo9uz.jpg');
    });

    it('leaves a maps link alone — no image intent on that line', () => {
        const kb = 'مكان المحل وموقع المحل https://maps.app.goo.gl/9wa3yAwhcNnSgkNx6';
        expect(findNonDirectImageUrls(kb)).toEqual([]);
    });

    it('leaves a direct image link alone even when the line asks for a picture', () => {
        const kb = 'لما العميل يطلب صورة ارسل هذا الرابط https://files.catbox.moe/5mo9uz.jpg';
        expect(findNonDirectImageUrls(kb)).toEqual([]);
    });

    it('returns nothing when the KB has no links at all', () => {
        expect(findNonDirectImageUrls('سعر بخور العنفر الملكي 37 دينار')).toEqual([]);
    });
});

describe('findDuplicateTableRows', () => {
    it('finds the city listed twice in the delivery table', () => {
        const findings = findDuplicateTableRows(REAL_KB);
        const dup = findings.find(f => f.code === 'duplicate_row');
        expect(dup).toBeDefined();
        expect(dup!.quote).toBe('الابيار 25');
        expect(dup!.kind).toBe('data');
    });

    it('separates a genuine price conflict from a harmless repeat', () => {
        const findings = findDuplicateTableRows('سرت 30\nسرت 45\nالمرج 20\nالمرج 20');
        expect(findings.find(f => f.code === 'conflicting_row')?.quote).toBe('سرت 30');
        expect(findings.find(f => f.code === 'duplicate_row')?.quote).toBe('المرج 20');
    });

    it('treats alef variants as the same city', () => {
        const findings = findDuplicateTableRows('الأبيار 25\nالابيار 25');
        expect(findings.find(f => f.code === 'duplicate_row')).toBeDefined();
    });

    it('matches rows written with Arabic-Indic digits', () => {
        const findings = findDuplicateTableRows('سرت ٣٠\nسرت ٣٠');
        expect(findings.find(f => f.code === 'duplicate_row')).toBeDefined();
    });

    it('ignores product lines — a currency word means it is not a table row', () => {
        const kb = 'سعر بخور العنفر الملكي 37 دينار\nسعر بخور العنفر الملكي 37 دينار';
        expect(findDuplicateTableRows(kb)).toEqual([]);
    });

    it('ignores a city listed once', () => {
        expect(findDuplicateTableRows('سرت 30\nالمرج 20')).toEqual([]);
    });
});

describe('runDeterministicChecks', () => {
    it('produces exactly the two free findings for the real KB', () => {
        const codes = runDeterministicChecks(REAL_KB).map(f => f.code).sort();
        expect(codes).toEqual(['duplicate_row', 'image_url_not_direct']);
    });

    it('returns nothing for empty or whitespace-only Business Info', () => {
        expect(runDeterministicChecks('')).toEqual([]);
        expect(runDeterministicChecks('   \n  ')).toEqual([]);
    });

    it('never flags a dialect instruction — that one actually works', () => {
        const kb = 'طارجو التحدث باللهجة الليبية مع الزباين';
        expect(runDeterministicChecks(kb)).toEqual([]);
    });
});

describe('rankFindings', () => {
    it('puts an impossible rule above a broken link above a typo', () => {
        const findings: BusinessAuditFinding[] = [
            { code: 'duplicate_row', kind: 'data', quote: 'الابيار 25', occurrences: 1 },
            { code: 'image_url_not_direct', kind: 'platform', quote: 'https://ibb.co/x', occurrences: 1 },
            { code: 'lead_status_change', kind: 'impossible', quote: 'تحوله ضمن', occurrences: 1 },
        ];
        expect(rankFindings(findings).map(f => f.kind)).toEqual(['impossible', 'platform', 'data']);
    });

    it('orders same-kind findings by how often they occur', () => {
        const findings: BusinessAuditFinding[] = [
            { code: 'lead_status_change', kind: 'impossible', quote: 'a', occurrences: 1 },
            { code: 'conditional_silence', kind: 'impossible', quote: 'b', occurrences: 3 },
        ];
        expect(rankFindings(findings)[0].occurrences).toBe(3);
    });

    it('does not mutate the input array', () => {
        const findings: BusinessAuditFinding[] = [
            { code: 'duplicate_row', kind: 'data', quote: 'x', occurrences: 1 },
            { code: 'lead_status_change', kind: 'impossible', quote: 'y', occurrences: 1 },
        ];
        rankFindings(findings);
        expect(findings[0].code).toBe('duplicate_row');
    });
});

describe('verifyQuote', () => {
    it('accepts a quote lifted verbatim from the KB', () => {
        expect(verifyQuote(REAL_KB, 'اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)')).toBe(true);
    });

    it('tolerates surrounding whitespace on the model side', () => {
        expect(verifyQuote(REAL_KB, '  الابيار 25\n')).toBe(true);
    });

    it('rejects a fabricated quote — the anti-hallucination guard', () => {
        expect(verifyQuote(REAL_KB, 'ارسل رسالة بعد ساعتين')).toBe(false);
    });

    it('rejects a PARAPHRASED quote, not just an invented one', () => {
        // Same meaning, different words. Must still fail: a model that
        // "tidies up" the merchant's text is not quoting it.
        expect(verifyQuote(REAL_KB, 'أي عميل يرسل رقم هاتفه حوّله إلى تم التحويل')).toBe(false);
    });

    it('rejects an empty quote', () => {
        expect(verifyQuote(REAL_KB, '   ')).toBe(false);
    });
});
