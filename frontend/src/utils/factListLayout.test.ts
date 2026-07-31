import { describe, it, expect } from 'vitest';
import { sectionizeGroup, rowDisplayAttributes, collectionAttributeLabels } from './factListLayout';
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
