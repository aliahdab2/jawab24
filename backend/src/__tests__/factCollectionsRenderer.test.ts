import { describe, it, expect } from 'vitest';
import {
    renderFactCollectionBlock,
    renderCoverageStatement,
    FACT_BLOCK_MAX_CHARS,
    type FactCollectionForPrompt,
    type FactRowForPrompt,
} from '../services/factCollectionsRenderer';

const TODAY = '2026-07-28';

/** Narrowing helper — the repo forbids non-null assertions, and a renderer
 *  returning undefined here is itself a test failure worth a clear message. */
function must<T>(v: T | undefined): T {
    if (v === undefined) throw new Error('expected a rendered value, got undefined');
    return v;
}

const row = (over: Partial<FactRowForPrompt> = {}): FactRowForPrompt => ({
    name: 'صيدلية النرجس المركزية',
    attributes: [{ label: 'المدينة', value: 'حي الرمال' }],
    price: null,
    currency: null,
    startsAt: null,
    endsAt: null,
    isAvailable: true,
    ...over,
});

const outlets: FactCollectionForPrompt = {
    label: 'الصيدليات التي تتوفر فيها منتجاتنا',
    keyAttr: 'المدينة',
    isComplete: null,
};

describe('renderFactCollectionBlock — the shapes that disqualified catalog_items', () => {
    it('never stamps price wording on a collection where nothing is priced', () => {
        const block = must(renderFactCollectionBlock(outlets, [row(), row({ name: 'صيدلية الياقوتة' })], TODAY));
        expect(block).not.toContain('price on request');
        expect(block).not.toContain('in stock');
    });

    it('shows the price column when any row prices it (delivery zones)', () => {
        const zones: FactCollectionForPrompt = { label: 'مناطق التوصيل', keyAttr: 'المدينة', isComplete: null };
        const block = must(renderFactCollectionBlock(zones, [
            row({ name: 'توصيل بنغازي', attributes: [{ label: 'المدينة', value: 'بنغازي' }], price: '10.00', currency: 'دينار' }),
            row({ name: 'توصيل أجدابيا', attributes: [{ label: 'المدينة', value: 'أجدابيا' }], price: '0.00', currency: 'دينار' }),
        ], TODAY));
        expect(block).toContain('10 دينار');
        // trailing ".00" would defeat Check 1's literal price grounding
        expect(block).not.toContain('10.00');
    });

    it('uses the collection label as the header — no "Items this business offers"', () => {
        const block = must(renderFactCollectionBlock(outlets, [row()], TODAY));
        expect(block.startsWith('الصيدليات التي تتوفر فيها منتجاتنا:')).toBe(true);
    });

    it('excludes expired rows from the prompt entirely (v38 stale-date class)', () => {
        const block = must(renderFactCollectionBlock(outlets, [
            row(),
            row({ name: 'عرض منتهي', endsAt: '2026-07-01' }),
        ], TODAY));
        expect(block).not.toContain('عرض منتهي');
    });

    it('returns undefined when every row is expired — an empty block must gate, not render', () => {
        expect(renderFactCollectionBlock(outlets, [row({ endsAt: '2026-01-01' })], TODAY)).toBeUndefined();
    });
});

describe('renderCoverageStatement — the 28%→0% mechanism', () => {
    it('enumerates the distinct key values as the list boundary', () => {
        const s = must(renderCoverageStatement(outlets, [
            row(),
            row({ name: 'صيدلية الفيروز', attributes: [{ label: 'المدينة', value: 'تلة الريح' }] }),
            row({ name: 'صيدلية المرجانة', attributes: [{ label: 'المدينة', value: 'تلة الريح' }] }),
        ]));
        expect(s).toContain('حي الرمال');
        expect(s).toContain('تلة الريح');
        // distinct — the duplicate district appears once
        expect(s.split('تلة الريح').length - 1).toBe(1);
    });

    // The wording distinction is customer-facing money: the strong negative is
    // EARNED by merchant confirmation, never assumed. An unconfirmed list must
    // say "not registered with us" (true by construction) — claiming «غير
    // متوفر» off an unconfirmed list turns fabrication into false denial.
    it('unconfirmed list (isComplete null) → honest "not in my list" wording, no confident negative', () => {
        const s = must(renderCoverageStatement(outlets, [row()]));
        expect(s).toContain('غير مسجّل لدينا');
        expect(s).toContain('التواصل معنا');
        expect(s).not.toContain('كاملة ونهائية');
    });

    it('merchant-confirmed complete → the confident negative is unlocked', () => {
        const s = must(renderCoverageStatement({ ...outlets, isComplete: true }, [row()]));
        expect(s).toContain('كاملة ونهائية');
        expect(s).toContain('غير متوفر لدينا');
    });

    it('explicitly-partial list (isComplete false) keeps the honest wording forever', () => {
        const s = must(renderCoverageStatement({ ...outlets, isComplete: false }, [row()]));
        expect(s).toContain('غير مسجّل لدينا');
        expect(s).not.toContain('كاملة ونهائية');
    });

    it('un-keyed collection still gets an absence directive', () => {
        const flat: FactCollectionForPrompt = { label: 'الماركات المعتمدة', keyAttr: null, isComplete: null };
        const s = must(renderCoverageStatement(flat, [row({ name: 'ماركة أ', attributes: null })]));
        expect(s).toContain('غير مسجّل لدينا');
    });
});

describe('degradation — the coverage line survives what row detail does not', () => {
    // The catalog block's overflow appends "this list is NOT exhaustive" — the
    // exact opposite of list semantics. Here truncation drops ROWS while the
    // coverage line (computed over ALL live rows) keeps the boundary truthful.
    it('a block over the cap keeps the coverage statement and every distinct key value', () => {
        const many: FactRowForPrompt[] = [];
        for (let i = 0; i < 400; i++) {
            many.push(row({
                name: `صيدلية رقم ${i} بامتداد اسم طويل جداً لملء الكتلة بالحروف حتى تتجاوز السقف المحدد للعرض`,
                attributes: [{ label: 'المدينة', value: `منطقة ${i % 25}` }],
            }));
        }
        const block = must(renderFactCollectionBlock(outlets, many, TODAY));
        expect(block.length).toBeLessThanOrEqual(FACT_BLOCK_MAX_CHARS + 200);
        // the boundary index survives in full: all 25 distinct districts present
        for (let d = 0; d < 25; d++) expect(block).toContain(`منطقة ${d}`);
        // and it never claims exhaustiveness it does not have
        expect(block).not.toContain('NOT exhaustive');
        expect(block).toContain('غير مسجّل لدينا');
    });
});
