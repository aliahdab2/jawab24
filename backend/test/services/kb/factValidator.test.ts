/**
 * Unit tests for validateFacts — the deterministic check layer that gates extracted facts
 * before they are persisted (price-never-wrong enforcement, no LLM involved).
 */
import { describe, it, expect } from 'vitest';
import { validateFacts } from '../../../src/services/kb/factValidator';
import type { ExtractedFact } from '../../../src/services/kb/factExtractor';

const f = (title: string, content: string, price = ''): ExtractedFact => ({ title, content, price });

describe('validateFacts — price grounding', () => {
    const source = 'دورة المكياج سعرها 35000 ل.س. دورة الإسعافات 35,000. دورة الطاقة الشمسية ٥٠٠٠٠٠ ل.س. دورة أونلاين 10 دولار.';

    it('passes a fact whose price appears verbatim in the source', () => {
        const { ok, flagged } = validateFacts([f('المكياج', 'سعرها 35000', '35000 ل.س')], source);
        expect(ok).toHaveLength(1);
        expect(flagged).toHaveLength(0);
    });

    it('passes when the source uses a thousands separator (50,000 ≡ 50000)', () => {
        const { ok } = validateFacts([f('إسعافات', 'سعرها 35,000', '35,000 ل.س')], source);
        expect(ok).toHaveLength(1);
    });

    it('grounds an Arabic-Indic source price against an ASCII fact price', () => {
        const { ok } = validateFacts([f('طاقة شمسية', 'بسعر 500000', '500000 ل.س')], source);
        expect(ok).toHaveLength(1);
    });

    it('grounds "50 ألف" against a source that wrote 50000 (×1000 expansion)', () => {
        const { ok } = validateFacts([f('طاقة', 'نصف مليون', '500 ألف')], 'الدورة 500000 ل.س');
        expect(ok).toHaveLength(1);
    });

    it('FLAGS a price that is not in the source (model transformed/hallucinated it)', () => {
        const { ok, flagged } = validateFacts([f('المكياج', 'سعرها 100000', '100000 ل.س')], source);
        expect(ok).toHaveLength(0);
        expect(flagged[0].reasons).toContain('price_not_grounded');
    });

    it('does not flag a non-numeric price (nothing to ground)', () => {
        const { ok, flagged } = validateFacts([f('حلاقة', 'حسب المستوى — تواصلي معنا', 'حسب المستوى')], source);
        expect(ok).toHaveLength(1);
        expect(flagged).toHaveLength(0);
    });

    it('does not flag facts with no price at all', () => {
        const { ok } = validateFacts([f('العنوان', 'برامكة سانا')], source);
        expect(ok).toHaveLength(1);
    });
});

describe('validateFacts — price conflict', () => {
    it('flags two facts for the SAME offering with different prices', () => {
        const source = 'دورة الأمين 35000 و 50000 ل.س';
        const { ok, flagged } = validateFacts([
            f('دورة الأمين', 'سعرها 35000', '35000'),
            f('دورة الأمين', 'سعرها 50000', '50000'),
        ], source);
        expect(ok).toHaveLength(0);
        expect(flagged).toHaveLength(2);
        expect(flagged.every(x => x.reasons.includes('price_conflict'))).toBe(true);
    });

    it('does NOT flag distinct offerings that happen to differ in price', () => {
        const source = 'دورة الأمين مبتدئ 35000. دورة الأمين متقدم 50000.';
        const { ok, flagged } = validateFacts([
            f('دورة الأمين - مبتدئ', 'سعرها 35000', '35000'),
            f('دورة الأمين - متقدم', 'سعرها 50000', '50000'),
        ], source);
        expect(ok).toHaveLength(2);
        expect(flagged).toHaveLength(0);
    });
});
