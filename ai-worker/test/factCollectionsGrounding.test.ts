/**
 * G1a (fact collections) — ai-worker contract tests.
 *
 * Enumerable LIST facts reach the model through `context.factCollectionsBlock`,
 * rendered as <business_lists> with the coverage/absence statement the backend
 * derived from the merchant's data. These tests pin the three guarantees the
 * wiring must hold:
 *
 *  1. INERTNESS — a request without the block produces byte-identical prompts and
 *     unchanged language resolution. Every page without collections (i.e. the
 *     whole fleet on the day this ships) must be untouched.
 *  2. INTEGRITY OF THE MECHANISM — the coverage statement and the attribution
 *     rules both reach the prompt, and the block lands in the cacheable stable
 *     page block rather than the per-call tail.
 *  3. GROUNDING — a price that exists only in a fact row is legitimate, so the
 *     price guard must not flag it (`price_not_in_kb` triggers a destructive
 *     reply swap backend-side), while a price that exists nowhere still flags.
 */
import { describe, it, expect } from 'vitest';
import { getKBText, resolveLanguage } from '../src/services/reply/replyContext';
import { validateReply } from '../src/services/reply/replyValidator';
import { buildSystemPrompt, buildUserPrompt } from '../src/services/reply/promptBuilder';
import type { GenerateRequest, ParsedReply } from '../src/services/reply/types';

/** Shaped exactly like factCollectionsRenderer output: header, rows, coverage line. */
const OUTLETS_BLOCK = [
    'صيدليات المدينة التي تبيع منتجاتنا:',
    '- صيدلية النرجس المركزية — المنطقة: حي الرمال',
    '- صيدلية الفيروز — المنطقة: تلة الريح',
    '- صيدلية المرساة — المنطقة: الميناء القديم',
    'هذه القائمة تغطي «المنطقة» التالية فقط: حي الرمال، تلة الريح، الميناء القديم. أي «المنطقة» غير مذكور في هذه القائمة فهو غير مسجّل لدينا — قل للعميل إنه غير موجود في قائمتك واعرض عليه التواصل معنا مباشرة، ولا تفترض توفره ولا عدم توفره.',
].join('\n');

/** A PRICED collection — متجر إجدابيا's per-city delivery table is the real case. */
const DELIVERY_BLOCK = [
    'أسعار التوصيل حسب المدينة:',
    '- توصيل داخل المدينة — المدينة: إجدابيا — 15 دينار',
    '- توصيل بنغازي — المدينة: بنغازي — 35 دينار',
    'هذه القائمة تغطي «المدينة» التالية فقط: إجدابيا، بنغازي. أي «المدينة» غير مذكور في هذه القائمة فهو غير مسجّل لدينا — قل للعميل إنه غير موجود في قائمتك واعرض عليه التواصل معنا مباشرة، ولا تفترض توفره ولا عدم توفره.',
].join('\n');

const req = (comment: string, ctx: GenerateRequest['context'] = {}): GenerateRequest => ({ comment, context: ctx });

const parsed = (reply: string): ParsedReply => ({
    reply,
    intent: 'QUESTION',
    confidence: 0.95,
    language: 'ar',
    flags: [],
});

describe('getKBText — factCollectionsBlock opt-in', () => {
    it('excludes the block by default (language inference lane untouched)', () => {
        const r = req('وين نلقاكم؟', { knowledgeBase: 'عنوان المحل: طرابلس', factCollectionsBlock: OUTLETS_BLOCK });
        expect(getKBText(r)).toBe('عنوان المحل: طرابلس');
    });

    it('includes the block when opted in (price-guard lane)', () => {
        const r = req('وين نلقاكم؟', { knowledgeBase: 'عنوان المحل: طرابلس', factCollectionsBlock: OUTLETS_BLOCK });
        expect(getKBText(r, { includeFactCollections: true })).toContain('صيدلية الفيروز');
    });

    it('composes with the catalog opt-in without dropping either block', () => {
        const r = req('بقداش؟', {
            knowledgeBase: 'KB',
            productCatalog: 'Items this business offers (merchant-entered):\n- حفاضات — 45 LYD — in stock',
            factCollectionsBlock: DELIVERY_BLOCK,
        });
        const text = getKBText(r, { includeProductCatalog: true, includeFactCollections: true })!;
        expect(text).toContain('حفاضات');
        expect(text).toContain('توصيل بنغازي');
    });

    it('returns the block alone when no other grounding exists', () => {
        const r = req('وين نلقاكم؟', { factCollectionsBlock: OUTLETS_BLOCK });
        expect(getKBText(r, { includeFactCollections: true })).toBe(OUTLETS_BLOCK);
    });
});

describe('inertness — requests without a fact-collections block are unchanged', () => {
    it('builds a byte-identical system prompt with the field absent vs undefined', () => {
        const withField = buildSystemPrompt(req('مرحبا', { knowledgeBase: 'KB', pageName: 'متجر', factCollectionsBlock: undefined }));
        const without = buildSystemPrompt(req('مرحبا', { knowledgeBase: 'KB', pageName: 'متجر' }));
        expect(withField).toBe(without);
    });

    it('treats an empty/whitespace block as absent', () => {
        const blank = buildSystemPrompt(req('مرحبا', { knowledgeBase: 'KB', pageName: 'متجر', factCollectionsBlock: '   \n  ' }));
        const without = buildSystemPrompt(req('مرحبا', { knowledgeBase: 'KB', pageName: 'متجر' }));
        expect(blank).toBe(without);
    });

    it('builds a byte-identical user prompt (the block is system-side only)', () => {
        const withField = buildUserPrompt(req('مرحبا', { knowledgeBase: 'KB', factCollectionsBlock: OUTLETS_BLOCK }));
        const without = buildUserPrompt(req('مرحبا', { knowledgeBase: 'KB' }));
        expect(withField).toBe(without);
    });

    it('resolves the same language whether or not the block is present', () => {
        const withField = resolveLanguage(req('...', { knowledgeBase: 'Store address: Tripoli', factCollectionsBlock: OUTLETS_BLOCK }));
        const without = resolveLanguage(req('...', { knowledgeBase: 'Store address: Tripoli' }));
        expect(withField).toBe(without);
    });
});

describe('the block reaches the prompt with its mechanism intact', () => {
    const prompt = buildSystemPrompt(req('العجيلات، وين نلقاكم؟', {
        knowledgeBase: 'نحن وكيل حصري.',
        pageName: 'وكيل',
        factCollectionsBlock: OUTLETS_BLOCK,
    }));

    it('wraps the block in <business_lists>', () => {
        expect(prompt).toContain('<business_lists>');
        expect(prompt).toContain('</business_lists>');
        expect(prompt).toContain('صيدلية المرساة');
    });

    it('carries the DERIVED coverage statement verbatim — it is the fix, not decoration', () => {
        expect(prompt).toContain('هذه القائمة تغطي «المنطقة» التالية فقط: حي الرمال، تلة الريح، الميناء القديم.');
        expect(prompt).toContain('غير مسجّل لدينا');
    });

    it('states the anti-re-attribution rule (real names, invented city — the measured defect)', () => {
        expect(prompt).toContain('NEVER RE-ATTRIBUTE AN ENTRY');
    });

    it('rules out answering a branch question with the business own address', () => {
        expect(prompt).toMatch(/is NOT an entry in these lists/);
    });

    it('places the block in the cacheable stable prefix, before the per-call CONTEXT block', () => {
        expect(prompt.indexOf('<business_lists>')).toBeLessThan(prompt.indexOf('CONTEXT FOR THIS REPLY:'));
    });

    it('keeps <business_lists> after <business_knowledge> so KB stays the cached prefix head', () => {
        expect(prompt.indexOf('<business_knowledge>')).toBeLessThan(prompt.indexOf('<business_lists>'));
    });
});

describe('price guard — fact-row prices are legitimate grounding', () => {
    it('does NOT flag a reply quoting a price that exists only in a fact row', () => {
        const r = req('التوصيل لبنغازي بقداش؟', { knowledgeBase: 'نوصل لعدة مدن.', factCollectionsBlock: DELIVERY_BLOCK });
        const out = validateReply(parsed('توصيل بنغازي 35 دينار.'), r);
        expect(out.flags).not.toContain('price_not_in_kb');
    });

    it('still flags a price that is in neither KB nor any list', () => {
        const r = req('التوصيل لسبها بقداش؟', { knowledgeBase: 'نوصل لعدة مدن.', factCollectionsBlock: DELIVERY_BLOCK });
        const out = validateReply(parsed('توصيل سبها 90 دينار.'), r);
        expect(out.flags).toContain('price_not_in_kb');
    });

    it('keeps flagging hallucinated prices when no collections exist (baseline unchanged)', () => {
        const r = req('بقداش؟', { knowledgeBase: 'نوصل لعدة مدن.' });
        const out = validateReply(parsed('السعر 90 دينار.'), r);
        expect(out.flags).toContain('price_not_in_kb');
    });
});
