import { describe, it, expect } from 'vitest';
import { sectionizeGroup, rowDisplayAttributes, collectionAttributeLabels, discoverFaceLabel, buildEntityUnit } from './factListLayout';
import { groupFactCollections } from './factListGrouping';
import type { FactCollectionWithRows, FactRowDto } from '@/lib/api';

let seq = 0;
const row = (name: string, over: Partial<FactRowDto> = {}): FactRowDto => ({
  id: `row-${++seq}`,
  name,
  attributes: null,
  price: null,
  currency: null,
  startsAt: null,
  endsAt: null,
  isAvailable: true,
  ...over,
});

const coll = (
  label: string,
  keyAttr: string | null,
  rows: FactRowDto[],
): FactCollectionWithRows => ({
  id: `coll-${label}`,
  label,
  keyAttr,
  isComplete: true,
  rowCount: rows.length,
  rows,
});

/** Mirrors the real pilot shape: un-keyed prices + keyed dated slots. */
function fixture() {
  const prices = coll('أسعار الدورات', null, [
    row('دورة الأمين للمحاسبة', { attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '35000.00', currency: 'ل.س قديمة' }),
    row('دورة الأمين للمحاسبة', { attributes: [{ label: 'المستوى', value: 'متقدم' }], price: '50000.00', currency: 'ل.س قديمة' }),
  ]);
  const slots = coll('مواعيد الدورات المعلنة', 'الدورة', [
    row('دورة الأمين للمحاسبة', {
      attributes: [
        { label: 'الدورة', value: 'الأمين' },
        { label: 'المستوى', value: 'مبتدئ' },
        { label: 'الأيام', value: 'السبت فقط' },
        { label: 'الساعة', value: '1-3' },
      ],
      startsAt: '2026-08-04', endsAt: null,
    }),
    row('دورة الأمين للمحاسبة', {
      // RAGGED on purpose: different array ORDER and no الساعة
      attributes: [
        { label: 'الأيام', value: 'الأحد والثلاثاء' },
        { label: 'الدورة', value: 'الأمين' },
        { label: 'المستوى', value: 'مبتدئ' },
      ],
      startsAt: '2026-08-09', endsAt: null,
    }),
  ]);
  return [prices, slots];
}

describe('sectionizeGroup', () => {
  it('buckets rows by collection in the PAGE order and skips absent collections', () => {
    const collections = fixture();
    const [group] = groupFactCollections(collections);
    const sections = sectionizeGroup(group, collections);
    expect(sections.map((s) => s.collection.label)).toEqual(['أسعار الدورات', 'مواعيد الدورات المعلنة']);
    expect(sections[0].rows).toHaveLength(2);
    expect(sections[1].rows).toHaveLength(2);
  });

  it('hoists a pair carried identically by every row of a section — «مبتدئ» said once', () => {
    const collections = fixture();
    const [group] = groupFactCollections(collections);
    const sections = sectionizeGroup(group, collections);
    // prices: مبتدئ vs متقدم differ → nothing hoisted
    expect(sections[0].shared).toEqual([]);
    // slots: both rows carry المستوى=مبتدئ → hoisted
    expect(sections[1].shared).toEqual([{ label: 'المستوى', value: 'مبتدئ' }]);
  });

  it('never hoists from a single-row section', () => {
    const prices = coll('أسعار', null, [
      row('دورة الريزن', { attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '100000.00' }),
    ]);
    const [group] = groupFactCollections([prices]);
    const [section] = sectionizeGroup(group, [prices]);
    expect(section.shared).toEqual([]);
  });

  it('a row missing the label blocks the hoist — sparse rows must not inherit a neighbour value', () => {
    const slots = coll('مواعيد', 'الدورة', [
      row('س', { attributes: [{ label: 'الدورة', value: 'س' }, { label: 'المستوى', value: 'مبتدئ' }], startsAt: '2026-08-01' }),
      row('س', { attributes: [{ label: 'الدورة', value: 'س' }], startsAt: '2026-08-02' }),
    ]);
    const [group] = groupFactCollections([slots]);
    const [section] = sectionizeGroup(group, [slots]);
    expect(section.shared).toEqual([]);
  });

  it('does not hoist a pair that would leave a row with nothing to display', () => {
    const brands = coll('الماركات', null, [
      row('أ', { attributes: [{ label: 'الفئة', value: 'عناية' }] }),
      row('ب', { attributes: [{ label: 'الفئة', value: 'عناية' }] }),
    ]);
    const [groupA, groupB] = groupFactCollections([brands]);
    expect(sectionizeGroup(groupA, [brands])[0].shared).toEqual([]);
    expect(sectionizeGroup(groupB, [brands])[0].shared).toEqual([]);
  });
});

describe('rowDisplayAttributes', () => {
  it('drops the key attribute and hoisted pairs, and orders by the section labelOrder regardless of a row\'s array order', () => {
    const collections = fixture();
    const [group] = groupFactCollections(collections);
    const sections = sectionizeGroup(group, collections);
    const slotSection = sections[1];
    const [first, second] = slotSection.rows;
    // First row: الساعة present; الدورة (key) and المستوى (hoisted) gone.
    expect(rowDisplayAttributes(slotSection, first.row)).toEqual([
      { label: 'الأيام', value: 'السبت فقط' },
      { label: 'الساعة', value: '1-3' },
    ]);
    // Second row declared الأيام FIRST in its own array — output identical order.
    expect(rowDisplayAttributes(slotSection, second.row)).toEqual([
      { label: 'الأيام', value: 'الأحد والثلاثاء' },
    ]);
  });
});

describe('collectionAttributeLabels', () => {
  it('returns the union across all rows, not rows[0] — the null-attributes regression', () => {
    const prices = coll('أسعار', null, [
      row('صبغات', { price: '100000.00' }),                                          // attributes: null
      row('تمريض', { attributes: [{ label: 'المستوى', value: 'الأول' }], price: '35000.00' }),
      row('ICDL', { attributes: [{ label: 'ملاحظة', value: '8 جلسات' }], price: '35000.00' }),
    ]);
    expect(collectionAttributeLabels(prices)).toEqual(['المستوى', 'ملاحظة']);
  });
});

describe('discoverFaceLabel', () => {
  const prices = () => coll('أسعار الدورات', null, [
    row('دورة الأمين للمحاسبة', { attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '35000.00' }),
    row('دورة الأمين للمحاسبة', { attributes: [{ label: 'المستوى', value: 'متقدم' }], price: '50000.00' }),
    row('دورة ICDL', { attributes: [{ label: 'ملاحظة', value: '8 جلسات لمدة شهر' }], price: '35000.00' }),
  ]);
  const slots = () => coll('مواعيد الدورات المعلنة', 'الدورة', [
    row('دورة الأمين للمحاسبة', {
      attributes: [{ label: 'الدورة', value: 'الأمين' }, { label: 'المستوى', value: 'مبتدئ' }, { label: 'الأيام', value: 'السبت' }],
      startsAt: '2026-08-04', endsAt: null,
    }),
    row('دورة ICDL', {
      attributes: [{ label: 'الدورة', value: 'ICDL' }, { label: 'الأيام', value: 'الاثنين' }, { label: 'ملاحظة', value: 'تبدأ عند اكتمال العدد' }],
      startsAt: '2026-08-10', endsAt: null,
    }),
  ]);

  it('elects the label whose values intersect across collections («المستوى») and rejects free text («ملاحظة»)', () => {
    expect(discoverFaceLabel([prices(), slots()])).toBe('المستوى');
  });

  it('excludes every collection key attribute even when it spans two collections', () => {
    const online = coll('الدورات الأونلاين', 'الدورة', [
      row('دورة ICDL أونلاين', { attributes: [{ label: 'الدورة', value: 'ICDL' }], price: '10.00' }),
    ]);
    // «الدورة» is keyed in BOTH dated collections — must never win.
    expect(discoverFaceLabel([slots(), online])).toBeNull();
  });

  it('returns null for a single-collection page and when the only shared label has one value', () => {
    expect(discoverFaceLabel([prices()])).toBeNull();
    const a = coll('أ', null, [row('x', { attributes: [{ label: 'الفئة', value: 'عام' }], price: '1.00' })]);
    const b = coll('ب', 'المنطقة', [row('y', { attributes: [{ label: 'المنطقة', value: 'الرمال' }, { label: 'الفئة', value: 'عام' }] })]);
    expect(discoverFaceLabel([a, b])).toBeNull();
  });
});

describe('buildEntityUnit', () => {
  const makeFixture = () => {
    const prices = coll('أسعار الدورات', null, [
      row('دورة الأمين للمحاسبة', { attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '35000.00' }),
      row('دورة الأمين للمحاسبة', { attributes: [{ label: 'المستوى', value: 'متقدم' }], price: '50000.00' }),
    ]);
    const slots = coll('مواعيد الدورات المعلنة', 'الدورة', [
      row('دورة الأمين للمحاسبة', {
        attributes: [{ label: 'الدورة', value: 'الأمين' }, { label: 'المستوى', value: 'مبتدئ' }, { label: 'الأيام', value: 'السبت' }],
        startsAt: '2026-08-04', endsAt: null,
      }),
      row('دورة الأمين للمحاسبة', {
        attributes: [{ label: 'الدورة', value: 'الأمين' }, { label: 'المستوى', value: 'مبتدئ' }, { label: 'الأيام', value: 'الأحد' }],
        startsAt: '2026-08-09', endsAt: null,
      }),
      row('دورة الأمين للمحاسبة', {
        // session with NO face value — must not be claimed by any tier
        attributes: [{ label: 'الدورة', value: 'الأمين' }, { label: 'الأيام', value: 'الخميس' }],
        startsAt: '2026-08-14', endsAt: null,
      }),
    ]);
    return [prices, slots] as const;
  };

  it('a multi-tier card splits sessions by normalized face value, unclaimed sessions attach to nothing', () => {
    const [prices, slots] = makeFixture();
    const [group] = groupFactCollections([prices, slots]);
    const opened = group.rows.find((r) => r.row.price === '35000.00');
    const unit = buildEntityUnit(group, [prices, slots], 'المستوى', opened as never);
    expect(unit.faceValue).toBe('مبتدئ');
    expect(unit.base?.row.price).toBe('35000.00');
    expect(unit.sessions.map((s) => s.row.attributes?.find((a) => a.label === 'الأيام')?.value)).toEqual(['السبت', 'الأحد']);
  });

  it('a single-base card owns ALL sessions regardless of face values (the الأظافر case)', () => {
    const prices = coll('أسعار الدورات', null, [
      row('دورة الأظافر', { price: '100000.00' }), // attributes: null
    ]);
    const slots = coll('مواعيد الدورات المعلنة', 'الدورة', [
      row('دورة الأظافر', {
        attributes: [{ label: 'الدورة', value: 'اظافر' }, { label: 'المستوى', value: 'مبتدئ' }],
        startsAt: '2026-08-05', endsAt: null,
      }),
    ]);
    const [group] = groupFactCollections([prices, slots]);
    const opened = group.rows.find((r) => r.row.price !== null);
    const unit = buildEntityUnit(group, [prices, slots], 'المستوى', opened as never);
    expect(unit.base?.row.name).toBe('دورة الأظافر');
    expect(unit.sessions).toHaveLength(1);
  });

  it('opening a SESSION row resolves its tier base, and the session collection is the first dated one', () => {
    const [prices, slots] = makeFixture();
    const [group] = groupFactCollections([prices, slots]);
    const opened = group.rows.find((r) => r.row.attributes?.some((a) => a.value === 'الأحد'));
    const unit = buildEntityUnit(group, [prices, slots], 'المستوى', opened as never);
    expect(unit.base?.row.price).toBe('35000.00');
    expect(unit.sessionCollection?.id).toBe(slots.id);
  });
});
