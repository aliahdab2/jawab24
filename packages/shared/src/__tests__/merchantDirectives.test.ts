import { describe, it, expect } from 'vitest';
import {
    normalizeDirectives,
    matchDirective,
    renderDirectivesBlock,
    MAX_DIRECTIVES_PER_PAGE,
    type MerchantDirective,
} from '../merchantDirectives';

/** The real directive from الفريق الدمشقي's own text — the one the reply overrode in prod
 *  on 2026-08-04 by inventing a lab-course curriculum instead of routing to the phone. */
const LAB: MerchantDirective = {
    keywords: 'مخبر, تحاليل, سحب الدم',
    response: 'لهذا السؤال يرجى التواصل على أرقامنا.',
};
const PRICE: MerchantDirective = {
    keywords: 'سعر, أسعار',
    response: 'الأسعار من الصالة مباشرة — تواصل مع أبو رمانة.',
};

describe('matchDirective — scope is the merchant\'s keywords, never our judgement', () => {
    it('matches the question that was overridden in production', () => {
        expect(matchDirective('وبتعلمو تحليلات جوا بالمخبر ؟', [LAB])).toBe(LAB);
        expect(matchDirective('وفي تعليم لسحب الدم؟', [LAB])).toBe(LAB);
    });

    it('matches through the Arabic definite article and leading particles', () => {
        // matchesKeyword strips the ال-family from both sides: المخبر ↔ مخبر, والتحاليل ↔ تحاليل.
        expect(matchDirective('شو محتوى دورة العمل المخبري؟', [LAB])).toBe(LAB);
        expect(matchDirective('والتحاليل شو وضعها', [LAB])).toBe(LAB);
    });

    it('returns null when nothing in the merchant\'s scope matches', () => {
        expect(matchDirective('وين مكانكم؟', [LAB])).toBeNull();
        expect(matchDirective('كم مدة دورة المكياج؟', [LAB])).toBeNull();
    });

    it('takes the FIRST match in the merchant\'s own order, so the outcome is reproducible', () => {
        const both = 'قديش سعر تحاليل المخبر؟';
        expect(matchDirective(both, [LAB, PRICE])).toBe(LAB);
        expect(matchDirective(both, [PRICE, LAB])).toBe(PRICE);
    });

    it('is inert with no directives, empty text, or whitespace', () => {
        expect(matchDirective('شو محتوى المخبر', [])).toBeNull();
        expect(matchDirective('', [LAB])).toBeNull();
        expect(matchDirective('   ', [LAB])).toBeNull();
    });

    it('does not match a broken plural — a silent miss beats a wrong reply', () => {
        // The keyword router deliberately does not conflate سعر ↔ أسعار; the merchant
        // configures both forms. Pinned so nobody "improves" it into false positives.
        expect(matchDirective('قديش الأسعار؟', [{ keywords: 'سعر', response: 'x' }])).toBeNull();
    });
});

describe('normalizeDirectives — tolerant, because this is merchant-editable JSON', () => {
    it('keeps well-formed entries and trims them', () => {
        expect(normalizeDirectives([{ keywords: '  مخبر ', response: '  تواصل معنا  ' }]))
            .toEqual([{ keywords: 'مخبر', response: 'تواصل معنا' }]);
    });

    it('drops entries that could never route anything', () => {
        expect(normalizeDirectives([
            { keywords: '', response: 'x' },
            { keywords: 'مخبر', response: '' },
            { keywords: ',,,', response: 'x' },
            null,
            'nonsense',
            { keywords: 5, response: 6 },
        ])).toEqual([]);
    });

    it('returns empty for non-arrays instead of throwing — one bad row must not break replies', () => {
        expect(normalizeDirectives(undefined)).toEqual([]);
        expect(normalizeDirectives({})).toEqual([]);
        expect(normalizeDirectives('x')).toEqual([]);
    });

    it('applies the per-page cap', () => {
        const many = Array.from({ length: MAX_DIRECTIVES_PER_PAGE + 5 }, (_, i) => ({
            keywords: `k${i}`, response: `r${i}`,
        }));
        expect(normalizeDirectives(many)).toHaveLength(MAX_DIRECTIVES_PER_PAGE);
    });

    it('truncates an over-long response rather than rejecting the rule', () => {
        const [only] = normalizeDirectives([{ keywords: 'k', response: 'x'.repeat(500) }]);
        expect(only.response.length).toBe(300);
    });
});

describe('renderDirectivesBlock', () => {
    it('renders numbered orders with the line that makes them orders', () => {
        const block = renderDirectivesBlock([LAB, PRICE])!;
        expect(block).toContain('ORDERS, not suggestions');
        expect(block).toContain('1. لهذا السؤال يرجى التواصل على أرقامنا.');
        expect(block).toContain('2. الأسعار من الصالة مباشرة — تواصل مع أبو رمانة.');
        // The keywords are routing scope, not something to read out to a customer.
        expect(block).not.toContain('سحب الدم');
    });

    it('renders nothing when the page has no directives — no page pays for an unused feature', () => {
        expect(renderDirectivesBlock([])).toBeUndefined();
    });
});
