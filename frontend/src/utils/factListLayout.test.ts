import { describe, it, expect } from 'vitest';
import { sectionizeGroup, rowDisplayAttributes, collectionAttributeLabels, discoverFaceLabel, buildEntityUnit, sessionValueKind, sectionKeyGroups, sectionPartitionLabel, unitHasSchedules } from './factListLayout';
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

describe('sessionValueKind', () => {
  it('recognizes weekday values in both app locales, via Intl data not word lists', () => {
    expect(sessionValueKind('السبت')).toBe('weekday');
    expect(sessionValueKind('الأحد والثلاثاء')).toBe('weekday');
    expect(sessionValueKind('Saturday')).toBe('weekday');
    expect(sessionValueKind('Sat')).toBe('weekday');
  });

  it('matches merchant spelling variants through the shared normalizer', () => {
    // Hamza-seated alef and tashkeel both fold away.
    expect(sessionValueKind('الإثنين')).toBe('weekday');
    expect(sessionValueKind('الجُمعة')).toBe('weekday');
  });

  it('classifies digit-and-separator values as time, including Arabic-Indic digits', () => {
    expect(sessionValueKind('1-3')).toBe('time');
    expect(sessionValueKind('10:00')).toBe('time');
    expect(sessionValueKind('٤-٦')).toBe('time');
  });

  it('leaves anything uncertain unadorned — words with digits, free text, English substrings', () => {
    expect(sessionValueKind('من 1 إلى 3 العصر')).toBe('other');
    expect(sessionValueKind('8 جلسات')).toBe('other');
    expect(sessionValueKind('salmon sundae')).toBe('other');
    expect(sessionValueKind('')).toBe('other');
  });
});

describe('sectionKeyGroups', () => {
  const directory = (keyAttr: string | null, rows: FactRowDto[]) => {
    const collection = coll('صيدليات المدينة', keyAttr, rows);
    const group = { key: collection.id, title: collection.label, rows: rows.map((r) => ({ collection, row: r })) };
    const [section] = sectionizeGroup(group, [collection]);
    return { section, entries: section.rows };
  };

  it('groups by the key value, first-seen order, display keeps first raw spelling', () => {
    const { section, entries } = directory('المنطقة', [
      row('صيدلية النرجس', { attributes: [{ label: 'المنطقة', value: 'حي الرمال' }] }),
      row('صيدلية الفيروز', { attributes: [{ label: 'المنطقة', value: 'تلة الريح' }] }),
      // Spacing variant of the FIRST area — must fold into it, not open a third
      row('صيدلية السنبلة', { attributes: [{ label: 'المنطقة', value: 'حي  الرمال' }] }),
    ]);
    const groups = sectionKeyGroups(section, entries);
    expect(groups).not.toBeNull();
    expect(groups!.map((g) => g.display)).toEqual(['حي الرمال', 'تلة الريح']);
    expect(groups![0].rows.map((r) => r.row.name)).toEqual(['صيدلية النرجس', 'صيدلية السنبلة']);
  });

  it('returns null (flat) when the collection has no key attribute', () => {
    const { section, entries } = directory(null, [
      row('رواء رقم 1', { attributes: [{ label: 'السلسلة', value: 'عادي' }] }),
      row('رواء رقم 2', { attributes: [{ label: 'السلسلة', value: 'عادي' }] }),
    ]);
    expect(sectionKeyGroups(section, entries)).toBeNull();
  });

  it('returns null (flat) when every key value is unique — headers per row are noise', () => {
    const { section, entries } = directory('المنطقة', [
      row('أ', { attributes: [{ label: 'المنطقة', value: 'الشرق' }] }),
      row('ب', { attributes: [{ label: 'المنطقة', value: 'الغرب' }] }),
    ]);
    expect(sectionKeyGroups(section, entries)).toBeNull();
  });

  it('rows missing the key value land in a trailing null bucket', () => {
    const { section, entries } = directory('المنطقة', [
      row('أ', { attributes: [{ label: 'المنطقة', value: 'الشرق' }] }),
      row('ب', { attributes: [{ label: 'المنطقة', value: 'الشرق' }] }),
      row('ج', { attributes: null }),
    ]);
    const groups = sectionKeyGroups(section, entries);
    expect(groups!.at(-1)!.value).toBeNull();
    expect(groups!.at(-1)!.rows.map((r) => r.row.name)).toEqual(['ج']);
  });
});

describe('sectionPartitionLabel', () => {
  const section = (keyAttr: string | null, rows: FactRowDto[]) => {
    const collection = coll('مقاسات وأسعار', keyAttr, rows);
    const group = { key: collection.id, title: collection.label, rows: rows.map((r) => ({ collection, row: r })) };
    return sectionizeGroup(group, [collection])[0];
  };

  it('returns the key attribute when the collection has one', () => {
    const s = section('المنطقة', [row('أ', { attributes: [{ label: 'المنطقة', value: 'الشرق' }] })]);
    expect(sectionPartitionLabel(s)).toBe('المنطقة');
  });

  it('discovers the best-compressing attribute on a keyless list — السلسلة on the sizes shape', () => {
    const s = section(null, [
      row('رواء رقم 1', { attributes: [{ label: 'السلسلة', value: 'عادي' }, { label: 'الوزن', value: '2-4 كيلو' }], price: '45.00' }),
      row('رواء رقم 2', { attributes: [{ label: 'السلسلة', value: 'عادي' }, { label: 'الوزن', value: '3-6 كيلو' }], price: '45.00' }),
      row('رواء رقم 3', { attributes: [{ label: 'السلسلة', value: 'جامبو' }, { label: 'الوزن', value: '4-8 كيلو' }], price: '82.00' }),
      row('رواء رقم 4', { attributes: [{ label: 'السلسلة', value: 'جامبو' }, { label: 'الوزن', value: '7-14 كيلو' }], price: '82.00' }),
    ]);
    // الوزن has 4 distinct values (no compression); السلسلة has 2 → elected.
    expect(sectionPartitionLabel(s)).toBe('السلسلة');
  });

  it('returns null when an attribute is missing on any row — a partition must cover the list', () => {
    const s = section(null, [
      row('أ', { attributes: [{ label: 'السلسلة', value: 'عادي' }] }),
      row('ب', { attributes: [{ label: 'السلسلة', value: 'عادي' }] }),
      row('ج', { attributes: null }),
    ]);
    expect(sectionPartitionLabel(s)).toBeNull();
  });

  it('returns null when nothing repeats or only one value exists', () => {
    const unique = section(null, [
      row('أ', { attributes: [{ label: 'اللون', value: 'أحمر' }] }),
      row('ب', { attributes: [{ label: 'اللون', value: 'أزرق' }] }),
      row('ج', { attributes: [{ label: 'اللون', value: 'أخضر' }] }),
    ]);
    expect(sectionPartitionLabel(unique)).toBeNull();
    const constant = section(null, [
      row('أ', { attributes: [{ label: 'اللون', value: 'أحمر' }] }),
      row('ب', { attributes: [{ label: 'اللون', value: 'أحمر' }] }),
      row('ج', { attributes: [{ label: 'اللون', value: 'أحمر' }] }),
    ]);
    expect(sectionPartitionLabel(constant)).toBeNull();
  });
});

describe('unitHasSchedules', () => {
  // The predicate copy keys off: «delete this item AND ITS DATES» and the
  // date-expiry rule must never be shown for an item that has no date rows
  // (owner catch, 2026-08-04 — a plain price row promised both).
  const priceRow = row('حفاضات بامبو رقم 1', { price: '38.00', currency: 'د.ل' });
  const datedRow = row('دورة التصوير', { startsAt: '2026-09-01' });

  it('is false for a plain priced row, even when the page HAS a dated list', () => {
    const prices = coll('أسعار حفاضات بامبو', null, [priceRow]);
    const slots = coll('مواعيد الدورات', null, [datedRow]);
    const [group] = groupFactCollections([prices, slots]).filter((g) => g.rows.some((r) => r.row.id === priceRow.id));
    const unit = buildEntityUnit(group, [prices, slots], null, { collection: prices, row: priceRow } as never);
    // The sheet COULD hold dates (a dated list exists) — but this item has none.
    expect(unit.sessionCollection).not.toBeNull();
    expect(unitHasSchedules(unit)).toBe(false);
  });

  it('is true once the entity actually carries a schedule row', () => {
    const slots = coll('مواعيد الدورات', null, [datedRow]);
    const [group] = groupFactCollections([slots]);
    const unit = buildEntityUnit(group, [slots], null, { collection: slots, row: datedRow } as never);
    expect(unitHasSchedules(unit)).toBe(true);
  });
});
