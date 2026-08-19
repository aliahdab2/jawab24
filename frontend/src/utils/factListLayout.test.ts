import { describe, it, expect } from 'vitest';
import { sectionizeGroup, rowDisplayAttributes, collectionAttributeLabels, discoverFaceLabel, buildEntityUnit, sessionValueKind, sectionKeyGroups, sectionPartitionLabel, unitHasSchedules, isDatedCollection, buildTierBlocks, datedListFreshness, sectionNameGroups, datedRowsState, retiredRecently, DATED_ENTITY_RECENT_DAYS } from './factListLayout';
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

describe('isDatedCollection — majority rule (the 08-06 «cannot edit» regression)', () => {
  it('ONE dated promo row in a large price list does NOT reclassify it as a schedule', () => {
    const rows = Array.from({ length: 49 }, (_, i) => row(`دورة ${i}`, { price: '100.00' }));
    rows.push(row('دورة المكياج', { price: '50000.00', startsAt: '2026-08-13' }));
    expect(isDatedCollection(coll('أسعار الدورات', null, rows))).toBe(false);
  });

  it('a predominantly dated list IS a schedule even with undated drafts', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row(`دورة ${i}`, { startsAt: '2026-08-10' })),
      row('مسودة بلا تاريخ'),
      row('مسودة ثانية'),
    ];
    expect(isDatedCollection(coll('مواعيد الدورات المعلنة', 'الدورة', rows))).toBe(true);
  });

  it('a single dated row alone is a schedule; an all-undated list is not', () => {
    expect(isDatedCollection(coll('مواعيد', 'الدورة', [row('أ', { startsAt: '2026-08-10' })]))).toBe(true);
    expect(isDatedCollection(coll('أسعار', null, [row('أ'), row('ب')]))).toBe(false);
  });

  it('a TIE leans schedule — a two-row list with one date is a schedule mid-authoring', () => {
    expect(isDatedCollection(coll('مواعيد', 'الدورة', [row('أ', { startsAt: '2026-08-10' }), row('ب')]))).toBe(true);
  });

  it('an END-dated promo row does NOT reclassify a price list as a schedule', () => {
    // The LAYOUT predicate keys on startsAt alone. ListRowSheet will happily
    // save endsAt with no startsAt, so one «ساري حتى» promo row in a four-row
    // price list reaches the tie under a retiringAnchor rule — and a price
    // list classified as a schedule yields no bases, so no card renders a tier
    // row and the entity sheet loses its only door (the 2026-08-06 regression).
    const prices = coll('أسعار الاشتراكات', null, [
      row('شهري', { price: '100.00' }),
      row('سنوي', { price: '1000.00' }),
      row('عرض الافتتاح', { price: '800.00', endsAt: '2026-08-01' }),
      row('عرض الطلاب', { price: '700.00', endsAt: '2026-08-02' }),
    ]);
    expect(isDatedCollection(prices)).toBe(false);
    // …while the freshness notice DOES read those rows as dated, because it
    // asks a different question with a different anchor. The two disagreeing
    // here is the design, not a drift.
    expect(datedListFreshness(prices, '2026-08-10')).toEqual({
      state: 'rowsRetired',
      names: ['عرض الافتتاح', 'عرض الطلاب'],
    });
  });
});

describe('buildTierBlocks — every card keeps its edit door', () => {
  it('a price list carrying one dated promo row still yields BASE blocks (tier rows render)', () => {
    // The Damascus shape: 3 price rows, ONE carries a start date; schedules
    // fully dated. Under the old any-row rule the prices collection counted
    // as dated, bases came back empty, and no card rendered a tier row —
    // the entity sheet's only entry point.
    const prices = coll('أسعار الدورات', null, [
      row('دورة ICDL', { price: '35000.00', attributes: [{ label: 'ملاحظة', value: '8 جلسات' }] }),
      row('دورة المكياج', { price: '35000.00', attributes: [{ label: 'المستوى', value: 'مبتدئ' }] }),
      row('دورة المكياج', { price: '50000.00', attributes: [{ label: 'المستوى', value: 'مكياج متقدم مستوى ثاني' }], startsAt: '2026-08-13' }),
    ]);
    const slots = coll('مواعيد الدورات المعلنة', 'الدورة', [
      row('دورة ICDL', { attributes: [{ label: 'الدورة', value: 'ICDL' }, { label: 'الساعة', value: '9-10' }], startsAt: '2026-08-10' }),
    ]);
    const groups = groupFactCollections([prices, slots]);
    const icdl = groups.find((g) => g.title === 'دورة ICDL');
    const { blocks } = buildTierBlocks(icdl!, [prices, slots], null);
    expect(blocks.some((b) => b.base !== null)).toBe(true);
    expect(blocks.find((b) => b.base)?.base?.row.price).toBe('35000.00');
  });

  it('a session-only entity yields a base-less block (the UI must still offer a door)', () => {
    const prices = coll('أسعار الدورات', null, [row('دورة أخرى', { price: '10.00' })]);
    const slots = coll('مواعيد الدورات المعلنة', 'الدورة', [
      row('دورة الإسعافات الأولية', { attributes: [{ label: 'الدورة', value: 'اسعافات' }], startsAt: '2026-08-20' }),
    ]);
    const groups = groupFactCollections([prices, slots]);
    const firstAid = groups.find((g) => g.title === 'دورة الإسعافات الأولية');
    const { blocks } = buildTierBlocks(firstAid!, [prices, slots], null);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].base).toBeNull();
    expect(blocks[0].sessions).toHaveLength(1);
  });
});

/**
 * Announced dates retire themselves (D-057) and say nothing to the merchant
 * while they do it. Measured on the pilot page 2026-08-10: 26 of 46 announced
 * slots already invisible, the rest gone by 08-31, no signal anywhere. The
 * window is 3 days by owner ruling the same day — a week reads as noise.
 */
/**
 * A price list carries one course per tier, so flat it reads as the same name
 * three times — the redundancy entity cards exist to remove, still present in
 * the list view (owner, 2026-08-11: «المهم ما نكرر اسم الدورة»).
 */
describe('sectionNameGroups', () => {
  const g = (name: string, over: Partial<FactRowDto> = {}) => ({
    collection: coll('أسعار الدورات', null, []),
    row: row(name, over),
  });

  it('gathers a repeated name into one group, in first-seen order', () => {
    const groups = sectionNameGroups([
      g('دورة الحلاقة النسائية', { price: '35000.00' }),
      g('دورة صبغات', { price: '100000.00' }),
      g('دورة الحلاقة النسائية', { price: '50000.00' }),
      g('دورة الحلاقة النسائية', { price: '75000.00' }),
    ]);
    expect(groups).not.toBeNull();
    expect(groups!.map((x) => [x.display, x.rows.length])).toEqual([
      ['دورة الحلاقة النسائية', 3],
      ['دورة صبغات', 1],
    ]);
  });

  it('returns null when nothing repeats — grouping singletons adds chrome and compresses nothing', () => {
    expect(sectionNameGroups([g('دورة أ'), g('دورة ب'), g('دورة ج')])).toBeNull();
  });

  it('folds names the way the entity join does, so a list and a card cannot disagree', () => {
    // Same normalizer as groupFactCollections: hamza and taa-marbuta folded.
    const groups = sectionNameGroups([g('دورة الإنكليزية'), g('دورة الانكليزية')]);
    expect(groups).not.toBeNull();
    expect(groups).toHaveLength(1);
    expect(groups![0].rows).toHaveLength(2);
  });
});

describe('datedListFreshness', () => {
  const TODAY = '2026-08-10';

  it('says nothing about a list that carries no dates', () => {
    const outlets = coll('نقاط البيع', 'المنطقة', [row('صيدلية النرجس'), row('صيدلية الودان')]);
    expect(datedListFreshness(outlets, TODAY)).toBeNull();
  });

  it('says nothing while there is runway beyond the window', () => {
    const slots = coll('مواعيد الدورات', null, [
      row('دورة ICDL', { startsAt: '2026-08-13' }),
      row('دورة الإكسل', { startsAt: '2026-08-31' }),
    ]);
    expect(datedListFreshness(slots, TODAY)).toBeNull();
  });

  it('reports the last date once every remaining one falls inside the window', () => {
    const slots = coll('مواعيد الدورات', null, [
      row('دورة ICDL', { startsAt: '2026-08-01' }),   // already retired
      row('دورة الإكسل', { startsAt: '2026-08-13' }), // the last one standing
    ]);
    expect(datedListFreshness(slots, TODAY)).toEqual({ state: 'ending', lastDate: '2026-08-13' });
  });

  it('counts the boundary day itself as inside the window, and the next as outside', () => {
    const inside = coll('مواعيد', null, [row('أ', { startsAt: '2026-08-13' })]);
    const outside = coll('مواعيد', null, [row('أ', { startsAt: '2026-08-14' })]);
    expect(datedListFreshness(inside, TODAY)).toEqual({ state: 'ending', lastDate: '2026-08-13' });
    expect(datedListFreshness(outside, TODAY)).toBeNull();
  });

  it('reports a list whose dates have all retired', () => {
    const slots = coll('مواعيد الدورات', null, [
      row('دورة ICDL', { startsAt: '2026-07-25' }),
      row('دورة الإكسل', { startsAt: '2026-08-09' }),
    ]);
    expect(datedListFreshness(slots, TODAY)).toEqual({ state: 'ended' });
  });

  it('treats a row starting TODAY as still live — it retires tomorrow, not now', () => {
    const slots = coll('مواعيد', null, [row('أ', { startsAt: TODAY })]);
    expect(datedListFreshness(slots, TODAY)).toEqual({ state: 'ending', lastDate: TODAY });
  });

  it('uses endsAt as the anchor when a row has no start date', () => {
    // isRowLive keys off endsAt for these; the warning must agree with it, or
    // it would call a row live that the renderer has already dropped.
    const live = coll('عروض', null, [row('عرض', { endsAt: '2026-08-12' })]);
    const gone = coll('عروض', null, [row('عرض', { endsAt: '2026-08-09' })]);
    expect(datedListFreshness(live, TODAY)).toEqual({ state: 'ending', lastDate: '2026-08-12' });
    expect(datedListFreshness(gone, TODAY)).toEqual({ state: 'ended' });
  });

  it('never generalises a price list — a stray retired date names its own row', () => {
    // THE PRODUCTION SHAPE, 2026-08-19: «أسعار الدورات» held 50 price rows of
    // which exactly ONE carried a date, and it had passed. The old any-row
    // rule made "every dated row has retired" true and the page announced that
    // the LIST's announced dates had ended — while seven live dates for those
    // same courses sat in «مواعيد الدورات المعلنة» next to it. A minority of
    // dated rows may only speak for itself.
    const prices = coll('أسعار الدورات', null, [
      ...Array.from({ length: 5 }, (_, i) => row(`دورة ${i}`, { price: '35000.00' })),
      row('دورة المكياج او التجميل (الميك أب)', { price: '50000.00', startsAt: '2026-08-09' }),
    ]);
    expect(datedListFreshness(prices, TODAY)).toEqual({
      state: 'rowsRetired',
      names: ['دورة المكياج او التجميل (الميك أب)'],
    });
  });

  it('still reports the last announced date of a NON-schedule list — that sentence is true of any list', () => {
    // «آخر تاريخ معلن في «{list}» هو {date}» reports a date; it does not
    // characterise the list, so the majority rule does not apply to it. Gating
    // it too would silently drop the early warning for a cohort block
    // announced inside a mostly-undated list.
    const prices = coll('أسعار الدورات', null, [
      ...Array.from({ length: 5 }, (_, i) => row(`دورة ${i}`, { price: '35000.00' })),
      row('مكياج متقدم', { price: '50000.00', startsAt: '2026-08-12' }),
    ]);
    expect(datedListFreshness(prices, TODAY)).toEqual({ state: 'ending', lastDate: '2026-08-12' });
  });

  it('keeps the early warning for a cohort block inside a mostly-undated list', () => {
    // Nine dated rows among twenty: a minority, so no list-wide claim — but
    // all nine retire inside the window and the merchant must hear about it.
    const mixed = coll('قائمة الدورات', null, [
      ...Array.from({ length: 11 }, (_, i) => row(`بند ${i}`)),
      ...Array.from({ length: 9 }, (_, i) => row(`دفعة ${i}`, { startsAt: '2026-08-12' })),
    ]);
    expect(datedListFreshness(mixed, TODAY)).toEqual({ state: 'ending', lastDate: '2026-08-12' });
  });

  it('a TIE of stray dates is NOT enough to speak for the list', () => {
    // Layout leans schedule at the tie (a list mid-authoring still edits as
    // one); a SENTENCE does not get that benefit, or two passed promo dates on
    // a four-row price list would print «انتهت التواريخ المعلنة في «الأسعار»».
    const prices = coll('أسعار الاشتراكات', null, [
      row('شهري', { price: '100.00' }),
      row('سنوي', { price: '1000.00' }),
      row('عرض الافتتاح', { price: '800.00', startsAt: '2026-08-01' }),
      row('عرض الطلاب', { price: '700.00', startsAt: '2026-08-02' }),
    ]);
    expect(isDatedCollection(prices)).toBe(true);
    expect(datedListFreshness(prices, TODAY)).toEqual({
      state: 'rowsRetired',
      names: ['عرض الافتتاح', 'عرض الطلاب'],
    });
  });

  it('names every retired stray, so none is hidden from the merchant who must fix it', () => {
    const prices = coll('أسعار الدورات', null, [
      ...Array.from({ length: 6 }, (_, i) => row(`دورة ${i}`, { price: '35000.00' })),
      row('عرض الصيف', { price: '20000.00', startsAt: '2026-08-01' }),
      row('عرض العيد', { price: '25000.00', endsAt: '2026-08-05' }),
    ]);
    expect(datedListFreshness(prices, TODAY)).toEqual({
      state: 'rowsRetired',
      names: ['عرض الصيف', 'عرض العيد'],
    });
  });

  it('still speaks for the whole list when the list IS a schedule', () => {
    // The majority rule is the ONLY thing that changed: a genuine schedule
    // that has run out keeps saying so, list-wide.
    const slots = coll('مواعيد الدورات المعلنة', null, [
      row('دورة ICDL', { startsAt: '2026-07-25' }),
      row('دورة الإكسل', { startsAt: '2026-08-09' }),
      row('دورة قيد الإعداد'),
    ]);
    expect(isDatedCollection(slots)).toBe(true);
    expect(datedListFreshness(slots, TODAY)).toEqual({ state: 'ended' });
  });
});

describe('datedRowsState — absence and expiry are different facts', () => {
  const TODAY = '2026-08-20';

  it('separates the two cases a live-only filter cannot', () => {
    // The whole reason this predicate exists. Both of these leave zero live
    // dated rows, and three surfaces on /business used to treat them alike:
    // a scope that never held a session, and one whose sessions have expired.
    expect(datedRowsState([], TODAY)).toEqual({ state: 'noRows' });
    expect(datedRowsState([
      row('دورة', { startsAt: '2026-07-25' }),
      row('دورة', { startsAt: '2026-08-10' }),
    ], TODAY)).toEqual({ state: 'retired', lastDate: '2026-08-10' });
  });

  it('reports the LATEST retired date, not the first or the last in row order', () => {
    const rows = [
      row('أ', { startsAt: '2026-08-10' }),
      row('ب', { startsAt: '2026-08-18' }),
      row('ج', { startsAt: '2026-07-25' }),
    ];
    expect(datedRowsState(rows, TODAY)).toEqual({ state: 'retired', lastDate: '2026-08-18' });
  });

  it('one live row makes the whole set live, however many have retired', () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row(`منتهٍ ${i}`, { startsAt: '2026-07-25' })),
      row('قادم', { startsAt: '2026-08-31' }),
    ];
    expect(datedRowsState(rows, TODAY)).toEqual({ state: 'live' });
  });

  it('an UNDATED row keeps the set live — it is still quoted, so nothing went dark', () => {
    // «تبدأ عند اكتمال العدد»: isRowLive keeps it forever. An item holding one
    // has not gone dark just because its cohorts have.
    const rows = [row('دفعة', { startsAt: '2026-07-25' }), row('عند اكتمال العدد')];
    expect(datedRowsState(rows, TODAY)).toEqual({ state: 'live' });
  });

  it('keys off endsAt when a row has no start date, exactly like isRowLive', () => {
    expect(datedRowsState([row('عرض', { endsAt: '2026-08-01' })], TODAY))
      .toEqual({ state: 'retired', lastDate: '2026-08-01' });
    expect(datedRowsState([row('عرض', { endsAt: '2026-09-01' })], TODAY)).toEqual({ state: 'live' });
  });

  it('rows that carry no dates at all are LIVE, not «never dated» — isRowLive keeps them', () => {
    expect(datedRowsState([row('دورة'), row('دورة ب')], TODAY)).toEqual({ state: 'live' });
  });

  it('retiredRecently spans the window inclusively and excludes the day before it', () => {
    const TODAY_ISO = '2026-08-20';
    const inside = '2026-07-21';  // 30 days back
    const outside = '2026-07-20'; // 31
    expect(DATED_ENTITY_RECENT_DAYS).toBe(30);
    expect(retiredRecently(inside, TODAY_ISO)).toBe(true);
    expect(retiredRecently(outside, TODAY_ISO)).toBe(false);
  });
});
