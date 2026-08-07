/**
 * The illegal-join validator (D-062's named next step).
 *
 * The defect cases below are transcribed from real adjudicated prod replies; the
 * NON-violation cases are the reason the naive reading of D-062's sentence was
 * not implemented. A checker built on bare co-occurrence flags every correct
 * enumeration, so half of this file pins what must STAY silent — those tests are
 * the load-bearing ones. If a future change makes a defect case pass while an
 * enumeration case starts flagging, the trade is a loss, not a win.
 */
import { describe, it, expect } from 'vitest';
import { findIllegalJoins, type JoinRow } from '../services/illegalJoin';

/** MES's five showrooms — unkeyed, so every row renders on every reply. This is
 *  the shape that makes co-occurrence unusable as a test. */
const SHOWROOMS: JoinRow[] = [
    {
        id: 'sh1', collectionLabel: 'صالات الشركة', name: 'صالة أبو رمانة',
        attributes: [
            { label: 'المدينة', value: 'دمشق' },
            { label: 'الهاتف', value: '0955545600' },
        ],
    },
    {
        id: 'sh2', collectionLabel: 'صالات الشركة', name: 'صالة مزة اتوستراد',
        attributes: [
            { label: 'المدينة', value: 'دمشق' },
            { label: 'الهاتف', value: '0993301080' },
        ],
    },
    {
        id: 'sh3', collectionLabel: 'صالات الشركة', name: 'صالة الموغامبو',
        attributes: [
            { label: 'المدينة', value: 'حلب' },
            { label: 'الهاتف', value: '0989100680' },
        ],
    },
    {
        id: 'sh4', collectionLabel: 'صالات الشركة', name: 'صالة الجميلية',
        attributes: [
            { label: 'المدينة', value: 'حلب' },
            { label: 'الهاتف', value: '0989100681' },
        ],
    },
];

describe('correct replies must stay silent', () => {
    it('does not flag a full enumeration — the behaviour the fact engine exists to produce', () => {
        // Every name and every phone number is present; 12 of the 16 cross-pairs
        // are held by no single row. Bare co-occurrence would flag all 12.
        const reply = [
            'صالاتنا:',
            'صالة أبو رمانة (دمشق) — 0955545600',
            'صالة مزة اتوستراد (دمشق) — 0993301080',
            'صالة الموغامبو (حلب) — 0989100680',
            'صالة الجميلية (حلب) — 0989100681',
        ].join('\n');

        const result = findIllegalJoins(reply, SHOWROOMS);
        expect(result.violations).toEqual([]);
        expect(result.anchorsFound).toBe(4);
    });

    it('does not flag a value many rows share', () => {
        // «حلب» is stored on two rows. Naming one of them beside it is correct
        // regardless of which row the matcher happens to bind.
        const result = findIllegalJoins('صالة الموغامبو موجودة في حلب', SHOWROOMS);
        expect(result.violations).toEqual([]);
    });

    it('gives no verdict when the reply names no row', () => {
        // Fail open: without an identity there is nothing to attribute a value to.
        const result = findIllegalJoins('نعم لدينا فروع في حلب، تواصل معنا', SHOWROOMS);
        expect(result.violations).toEqual([]);
        expect(result.anchorsFound).toBe(0);
    });

    it('does not flag a value that is part of the bound row own name', () => {
        const rows: JoinRow[] = [
            {
                id: 'r1', collectionLabel: 'الفروع', name: 'صالة السكري',
                attributes: [{ label: 'المنطقة', value: 'السكري' }],
            },
            {
                id: 'r2', collectionLabel: 'الفروع', name: 'صالة الجميلية',
                attributes: [{ label: 'المنطقة', value: 'الجميلية' }],
            },
        ];
        expect(findIllegalJoins('صالة السكري في منطقة السكري', rows).violations).toEqual([]);
    });
});

describe('the cross-collection weld (#650 does not cover this)', () => {
    // Feras, adjudicated 2026-08-07: a product attribute welded onto a نقاط البيع
    // row. Those rows carry no per-product availability at all, so no
    // within-collection rule can see the pair.
    const rows: JoinRow[] = [
        {
            id: 'p1', collectionLabel: 'نقاط البيع', name: 'صيدلية النور',
            attributes: [{ label: 'المنطقة', value: 'عين زارة' }],
        },
        {
            id: 'c1', collectionLabel: 'كريمات', name: 'كريم الزنك',
            attributes: [{ label: 'الحجم', value: '50 غرام' }],
            price: '45',
        },
    ];

    it('flags a product price attributed to a pharmacy row', () => {
        const result = findIllegalJoins('صيدلية النور يتوفر فيها المنتج بسعر 45', rows);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0]).toMatchObject({
            value: '45',
            boundToRowName: 'صيدلية النور',
            crossCollection: true,
        });
        expect(result.violations[0].ownedByRowNames).toEqual(['كريم الزنك']);
    });

    it('does not flag the same price beside the row that owns it', () => {
        const result = findIllegalJoins('كريم الزنك سعره 45', rows);
        expect(result.violations).toEqual([]);
    });
});

describe('the price cross-wire (the money-loss class)', () => {
    // Waleed, 2026-08-06: توتيان's unit price applied to مجموعة البخور. Caught
    // only because the reply stated the unit price it multiplied — a laundered
    // total alone stays invisible, which the module documents as a known limit.
    const rows: JoinRow[] = [
        { id: 't1', collectionLabel: 'الأسعار', name: 'توتيان', price: '69' },
        { id: 'b1', collectionLabel: 'الأسعار', name: 'مجموعة البخور', price: '119' },
    ];

    it('flags one row price quoted against another row name', () => {
        const result = findIllegalJoins('مجموعة البخور سعرها 69 للطرفين', rows);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0]).toMatchObject({
            value: '69',
            boundToRowName: 'مجموعة البخور',
            crossCollection: false,
        });
    });

    it('stays silent when both products are listed with their own prices', () => {
        const result = findIllegalJoins('توتيان 69 و مجموعة البخور 119', rows);
        expect(result.violations).toEqual([]);
    });
});

describe('boundaries inherited from the shared matcher', () => {
    const rows: JoinRow[] = [
        {
            id: 'r1', collectionLabel: 'المواعيد', name: 'دورة التصوير',
            attributes: [{ label: 'الساعة', value: '2-4' }],
        },
        {
            id: 'r2', collectionLabel: 'المواعيد', name: 'دورة الجودة',
            attributes: [{ label: 'الساعة', value: '5-6' }],
        },
    ];

    it('does not find a letter-free value glued inside a longer number', () => {
        // «2-4» inside «0932-4567» is the collision that once emptied nine live
        // cohorts; findValueOccurrences applies the same token boundary.
        const result = findIllegalJoins('دورة الجودة، للتواصل 0932-4567', rows);
        expect(result.violations).toEqual([]);
    });

    it('matches across Arabic orthographic variants', () => {
        const varied: JoinRow[] = [
            { id: 'a', collectionLabel: 'الفروع', name: 'عين الداليه', attributes: [{ label: 'الهاتف', value: '0911111111' }] },
            { id: 'b', collectionLabel: 'الفروع', name: 'صالة أخرى', attributes: [{ label: 'الهاتف', value: '0922222222' }] },
        ];
        const result = findIllegalJoins('عين الدالية رقمها 0922222222', varied);
        expect(result.violations).toHaveLength(1);
        expect(result.violations[0].boundToRowName).toBe('عين الداليه');
    });
});
