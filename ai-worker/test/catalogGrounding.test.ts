/**
 * Stage 2 v2 (native catalog) — ai-worker contract tests.
 *
 * The manual catalog reaches the model through context.productCatalog (the same
 * <product_catalog> block store summaries use). These tests pin the two hard
 * guarantees of Phase B:
 *
 *  1. INERTNESS — a request without catalog content produces byte-identical
 *     prompts and unchanged language resolution (no regression risk for every
 *     existing page; the v1 catalog was reverted for violating exactly this).
 *  2. GROUNDING — the price guard treats catalog prices as legitimate, and
 *     still flags prices that appear nowhere.
 */
import { describe, it, expect } from 'vitest';
import { getKBText, resolveLanguage } from '../src/services/reply/replyContext';
import { validateReply } from '../src/services/reply/replyValidator';
import { buildSystemPrompt, buildUserPrompt } from '../src/services/reply/promptBuilder';
import type { GenerateRequest, ParsedReply } from '../src/services/reply/types';

const CATALOG_BLOCK = [
    'Items this business offers (merchant-entered):',
    '- دبل صدمات NJT — 3500 EGP — in stock — يناسب الصيني والهندي',
    '- [course] دورة صيانة موتوسيكلات — 1200 EGP — in stock',
    '- طرمبة بنزين هوندا — 950 EGP — out of stock',
].join('\n');

const req = (comment: string, ctx: GenerateRequest['context'] = {}): GenerateRequest => ({ comment, context: ctx });

const parsed = (reply: string): ParsedReply => ({
    reply,
    intent: 'QUESTION',
    confidence: 0.95,
    language: 'ar',
    flags: [],
});

describe('getKBText — productCatalog opt-in', () => {
    it('excludes productCatalog by default (language inference lane untouched)', () => {
        const r = req('بكام؟', { knowledgeBase: 'عنوان المحل: مصر', productCatalog: CATALOG_BLOCK });
        expect(getKBText(r)).toBe('عنوان المحل: مصر');
    });

    it('includes productCatalog when opted in (price-guard lane)', () => {
        const r = req('بكام؟', { knowledgeBase: 'عنوان المحل: مصر', productCatalog: CATALOG_BLOCK });
        expect(getKBText(r, { includeProductCatalog: true })).toContain('3500 EGP');
    });

    it('returns the catalog alone when no other grounding exists', () => {
        const r = req('بكام؟', { productCatalog: CATALOG_BLOCK });
        expect(getKBText(r)).toBeNull();
        expect(getKBText(r, { includeProductCatalog: true })).toContain('دبل صدمات');
    });
});

describe('inertness — requests without catalog content are unchanged', () => {
    it('builds a byte-identical system prompt with productCatalog absent vs undefined', () => {
        const base = { knowledgeBase: 'نبيع قطع غيار موتوسيكلات', pageName: 'ELMAGD MOTOR' };
        const without = buildSystemPrompt(req('عندكم دبل صدمات؟', { ...base }));
        const withUndefined = buildSystemPrompt(req('عندكم دبل صدمات؟', { ...base, productCatalog: undefined }));
        expect(withUndefined).toBe(without);
    });

    it('builds a byte-identical user prompt with productCatalog absent vs undefined', () => {
        const base = { knowledgeBase: 'نبيع قطع غيار' };
        expect(buildUserPrompt(req('بكام؟', { ...base, productCatalog: undefined })))
            .toBe(buildUserPrompt(req('بكام؟', { ...base })));
    });

    it('resolves the same language whether or not a catalog block is present', () => {
        const base = { knowledgeBase: 'نبيع قطع غيار للموتوسيكلات في مصر' };
        const withoutCatalog = resolveLanguage(req('...', { ...base }));
        const withCatalog = resolveLanguage(req('...', { ...base, productCatalog: CATALOG_BLOCK }));
        expect(withCatalog).toBe(withoutCatalog);
    });
});

describe('price guard — catalog prices are legitimate grounding', () => {
    it('does NOT flag a reply quoting a catalog price', () => {
        const r = req('بكام الدبل صدمات؟', { knowledgeBase: 'محل قطع غيار', productCatalog: CATALOG_BLOCK });
        const result = validateReply(parsed('دبل صدمات NJT متوفر بـ 3500 جنيه ✅'), r);
        expect(result.flags).not.toContain('price_not_in_kb');
    });

    it('does NOT flag a catalog price quoted in Arabic-Indic digits', () => {
        const r = req('بكام الدورة؟', { productCatalog: CATALOG_BLOCK });
        const result = validateReply(parsed('سعر دورة الصيانة ١٢٠٠ جنيه'), r);
        expect(result.flags).not.toContain('price_not_in_kb');
    });

    it('still flags a price that is in neither KB nor catalog', () => {
        const r = req('بكام؟', { knowledgeBase: 'محل قطع غيار', productCatalog: CATALOG_BLOCK });
        const result = validateReply(parsed('السعر 9999 جنيه'), r);
        expect(result.flags).toContain('price_not_in_kb');
    });

    it('keeps flagging hallucinated prices when no catalog exists (baseline unchanged)', () => {
        const r = req('بكام؟', { knowledgeBase: 'محل قطع غيار بدون أسعار' });
        const result = validateReply(parsed('السعر 500 جنيه'), r);
        expect(result.flags).toContain('price_not_in_kb');
    });
});
