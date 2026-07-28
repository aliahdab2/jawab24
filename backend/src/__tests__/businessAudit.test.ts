import { describe, it, expect, vi } from 'vitest';

// The service pulls db/redis/config at module load; none of it is needed to
// exercise the parser, which is pure.
vi.mock('../db', () => ({ db: {} }));
vi.mock('../lib/redis', () => ({ redis: { get: vi.fn(), set: vi.fn() } }));
vi.mock('../config', () => ({ config: { openai: { apiKey: 'test' } } }));
vi.mock('../services/openaiClient', () => ({ makeTrackedOpenAI: vi.fn() }));
vi.mock('../utils/sentryHelpers', () => ({ captureError: vi.fn() }));

import { parseClassifierFindings } from '../services/businessAudit';

const KB = `ملاحظة: اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)
ملاحظة : لما زبون يرسلك صورة لا ترد عليه
طارجو التحدث باللهجة الليبية مع الزباين
سعر بخور العنفر الملكي 37 دينار`;

const json = (findings: unknown) => JSON.stringify({ findings });

describe('parseClassifierFindings — the anti-hallucination contract', () => {
    it('accepts a finding whose capability is known and whose quote is verbatim', () => {
        const out = parseClassifierFindings(json([
            { capability: 'lead_status_change', quote: 'اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)' },
        ]), KB);

        expect(out).toEqual([{
            code: 'lead_status_change',
            kind: 'impossible',
            quote: 'اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)',
            occurrences: 1,
        }]);
    });

    // Guard 1: the model can only name capabilities we have verified against
    // real code. An invented one is not a finding, it is a claim we cannot back.
    it('drops a capability that is not in the manifest', () => {
        expect(parseClassifierFindings(json([
            { capability: 'send_carrier_pigeon', quote: 'سعر بخور العنفر الملكي 37 دينار' },
        ]), KB)).toEqual([]);
    });

    // Guard 2: the model cannot invent a violation it cannot quote.
    it('drops a fabricated quote that appears nowhere in the Business Info', () => {
        expect(parseClassifierFindings(json([
            { capability: 'scheduled_message', quote: 'أرسل رسالة بعد ساعتين' },
        ]), KB)).toEqual([]);
    });

    // A model that "tidies up" the merchant's dialect is not quoting them, and
    // the UI shows this text back to a human as their own words.
    it('drops a paraphrased quote, not just an invented one', () => {
        expect(parseClassifierFindings(json([
            { capability: 'lead_status_change', quote: 'أي عميل يرسل رقم هاتفه حوّله إلى تم التحويل' },
        ]), KB)).toEqual([]);
    });

    it('keeps the valid findings when only some are rejected', () => {
        const out = parseClassifierFindings(json([
            { capability: 'made_up', quote: 'سعر بخور العنفر الملكي 37 دينار' },
            { capability: 'conditional_silence', quote: 'لما زبون يرسلك صورة لا ترد عليه' },
            { capability: 'human_handoff', quote: 'نص غير موجود إطلاقًا' },
        ]), KB);

        expect(out.map(f => f.code)).toEqual(['conditional_silence']);
    });

    it('groups repeated phrasings of one broken rule into a single finding', () => {
        const out = parseClassifierFindings(json([
            { capability: 'lead_status_change', quote: 'اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)' },
            { capability: 'lead_status_change', quote: 'سعر بخور العنفر الملكي 37 دينار' },
        ]), KB);

        expect(out).toHaveLength(1);
        expect(out[0].occurrences).toBe(2);
    });

    it('does not double-count the same quote returned twice', () => {
        const q = 'لما زبون يرسلك صورة لا ترد عليه';
        const out = parseClassifierFindings(json([
            { capability: 'conditional_silence', quote: q },
            { capability: 'conditional_silence', quote: q },
        ]), KB);

        expect(out[0].occurrences).toBe(1);
    });

    describe('malformed model output never reaches a merchant-facing claim', () => {
        it('survives output that is not JSON at all', () => {
            expect(parseClassifierFindings('sorry, I cannot help with that', KB)).toEqual([]);
        });

        it('survives valid JSON with no findings array', () => {
            expect(parseClassifierFindings('{"result":"ok"}', KB)).toEqual([]);
            expect(parseClassifierFindings('{"findings":"none"}', KB)).toEqual([]);
        });

        it('survives entries with missing or wrongly-typed fields', () => {
            expect(parseClassifierFindings(json([
                {},
                { capability: 'lead_status_change' },
                { quote: 'اي عميل يرسل رقم تلفونه تحوله ضمن (تم التحويل)' },
                { capability: 42, quote: 7 },
                null,
            ]), KB)).toEqual([]);
        });

        it('returns nothing for an empty findings array', () => {
            expect(parseClassifierFindings(json([]), KB)).toEqual([]);
        });
    });
});
