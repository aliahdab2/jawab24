import { describe, it, expect } from 'vitest';
import { reconcileCatalogProposals } from '../catalogReconcile';
import type { ReconcileExistingItem, ReconcileProposalItem } from '../catalogReconcile';

const existing: ReconcileExistingItem[] = [
    { id: 'makeup', name: 'دورة المكياج المبتدئ', price: '35000.00', currency: 'ل.س بالعملة القديمة' },
    { id: 'icdl', name: 'دورة ICDL', price: '35000', currency: 'ل.س' },
    { id: 'onreq', name: 'دورة الشعر', price: null, currency: null },
];

const p = (name: string, price: number | null, currency: string | null = null): ReconcileProposalItem => ({ name, price, currency });

describe('reconcileCatalogProposals', () => {
    it('flags a name match with a CHANGED price as an update (the D-038 conflict)', () => {
        const [r] = reconcileCatalogProposals([p('دورة المكياج المبتدئ', 25000, 'ل.س بالعملة القديمة')], existing);
        expect(r.kind).toBe('update');
        expect(r.match?.id).toBe('makeup');
    });

    it('flags an identical name + price + currency as a duplicate (nothing to do)', () => {
        const [r] = reconcileCatalogProposals([p('دورة ICDL', 35000, 'ل.س')], existing);
        expect(r.kind).toBe('duplicate');
        expect(r.match?.id).toBe('icdl');
    });

    it('flags an unmatched name as new', () => {
        const [r] = reconcileCatalogProposals([p('دورة التصوير', 75000)], existing);
        expect(r.kind).toBe('new');
        expect(r.match).toBeNull();
    });

    it('treats price 35000 vs "35000.00" as equal (numeric compare, not string)', () => {
        const [r] = reconcileCatalogProposals([p('دورة المكياج المبتدئ', 35000, 'ل.س بالعملة القديمة')], existing);
        expect(r.kind).toBe('duplicate');
    });

    it('a currency change alone (same price) is still an update when the proposal STATES a currency', () => {
        const [r] = reconcileCatalogProposals([p('دورة ICDL', 35000, 'ريال')], existing);
        expect(r.kind).toBe('update');
    });

    it('a proposal that OMITS currency (same price) is a duplicate, not an update — never wipes the existing currency', () => {
        const [r] = reconcileCatalogProposals([p('دورة ICDL', 35000, null)], existing);
        expect(r.kind).toBe('duplicate');
    });

    it('both prices null (price-on-request) → duplicate; adding a price → update', () => {
        expect(reconcileCatalogProposals([p('دورة الشعر', null)], existing)[0].kind).toBe('duplicate');
        expect(reconcileCatalogProposals([p('دورة الشعر', 100000)], existing)[0].kind).toBe('update');
    });

    it('matches by NORMALIZED name — taa-marbuta / case / spacing differences still match', () => {
        // "المكياج" written with a trailing haa vs taa-marbuta, extra spaces
        const [r] = reconcileCatalogProposals([p('  دورة   المكياج   المبتدئ ', 25000)], existing);
        expect(r.kind).toBe('update');
        expect(r.match?.id).toBe('makeup');
    });

    it('does NOT merge distinct course levels (exact-name match, not token subset)', () => {
        const levels: ReconcileExistingItem[] = [
            { id: 'l1', name: 'دورة الحلاقة - المستوى الأول', price: '50000', currency: 'ل.س' },
            { id: 'l2', name: 'دورة الحلاقة - المستوى الثاني', price: '75000', currency: 'ل.س' },
        ];
        const results = reconcileCatalogProposals(
            [p('دورة الحلاقة - المستوى الأول', 50000, 'ل.س'), p('دورة الحلاقة - المستوى الثالث', 100000, 'ل.س')],
            levels,
        );
        expect(results[0].kind).toBe('duplicate'); // L1 matches L1 only
        expect(results[1].kind).toBe('new');        // L3 is not any existing level
    });

    it('anchors to the FIRST existing row when the catalog itself has duplicate names', () => {
        const dupes: ReconcileExistingItem[] = [
            { id: 'a', name: 'دورة X', price: '10000', currency: 'ل.س' },
            { id: 'b', name: 'دورة X', price: '20000', currency: 'ل.س' },
        ];
        const [r] = reconcileCatalogProposals([p('دورة X', 10000, 'ل.س')], dupes);
        expect(r.match?.id).toBe('a');
        expect(r.kind).toBe('duplicate');
    });
});
