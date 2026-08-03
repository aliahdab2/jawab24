import { describe, it, expect } from 'vitest';
import { groupFactCollections, rowKeyValue } from './factListGrouping';
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

describe('groupFactCollections', () => {
  it('groups un-keyed rows sharing a name into one entity (price levels)', () => {
    const prices = coll('أسعار الدورات', null, [
      row('دورة الحلاقة النسائية', { attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '35000.00' }),
      row('دورة الحلاقة النسائية', { attributes: [{ label: 'المستوى', value: 'مستوى ثاني' }], price: '50000.00' }),
      row('دورة الريزن', { price: '100000.00' }),
    ]);
    const groups = groupFactCollections([prices]);
    expect(groups.map((g) => g.title)).toEqual(['دورة الحلاقة النسائية', 'دورة الريزن']);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('joins a keyed row to the price group by EXACT normalized name first', () => {
    const prices = coll('أسعار الدورات', null, [
      row('دورة الأمين للمحاسبة', { price: '35000.00' }),
      row('دورة الأمين تصنيع', { price: '100000.00' }),
    ]);
    const slots = coll('مواعيد الدورات', 'الدورة', [
      row('دورة الأمين للمحاسبة', {
        attributes: [{ label: 'الدورة', value: 'الأمين' }],
        startsAt: '2026-08-01',
        endsAt: '2026-08-01',
      }),
    ]);
    const groups = groupFactCollections([prices, slots]);
    // The shared stem «الأمين» is ambiguous across two price groups — the exact
    // name join must win before the needle is ever tried.
    expect(groups).toHaveLength(2);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[1].rows).toHaveLength(1);
  });

  it('joins by key-value containment when names differ, through the shared normalizer', () => {
    const prices = coll('أسعار الدورات', null, [
      row('اللغة الإنكليزية', { attributes: [{ label: 'المستوى', value: 'مبتدئ' }], price: '35000.00' }),
    ]);
    const slots = coll('مواعيد الدورات', 'الدورة', [
      row('دورة اللغة الانكليزية — مبتدئ', {
        attributes: [{ label: 'الدورة', value: 'انكليزي' }],
        startsAt: '2026-08-04',
        endsAt: '2026-08-04',
      }),
    ]);
    const groups = groupFactCollections([prices, slots]);
    // «انكليزي» ⊂ normalized «الإنكليزية» (hamza folded) — one card, not two.
    expect(groups).toHaveLength(1);
    expect(groups[0].title).toBe('اللغة الإنكليزية');
    expect(groups[0].rows).toHaveLength(2);
  });

  it('an ambiguous needle must NOT guess — the row keeps its own card', () => {
    const prices = coll('أسعار الدورات', null, [
      row('دورة الحلاقة النسائية', { price: '35000.00' }),
      row('دورة الحلاقة الرجالية', { price: '50000.00' }),
    ]);
    const slots = coll('مواعيد الدورات', 'الدورة', [
      row('دورة حلاقة', {
        attributes: [{ label: 'الدورة', value: 'حلاقة' }],
        startsAt: '2026-08-10',
        endsAt: '2026-08-10',
      }),
    ]);
    const groups = groupFactCollections([prices, slots]);
    expect(groups).toHaveLength(3);
  });

  it('a course with slots but no price row still gets exactly one card', () => {
    const slots = coll('مواعيد الدورات', 'الدورة', [
      row('دورة الغيتار', {
        attributes: [{ label: 'الدورة', value: 'غيتار' }],
        startsAt: '2026-08-12', endsAt: '2026-08-12',
      }),
      row('دورة الغيتار', {
        attributes: [{ label: 'الدورة', value: 'غيتار' }],
        startsAt: '2026-09-12', endsAt: '2026-09-12',
      }),
    ]);
    const groups = groupFactCollections([slots]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
  });

  it('a sub-2-char key value never matches (matcher rule)', () => {
    const prices = coll('أسعار', null, [row('دورة ما', { price: '10.00' })]);
    const slots = coll('مواعيد', 'الدورة', [
      row('شيء آخر', { attributes: [{ label: 'الدورة', value: 'م' }] }),
    ]);
    const groups = groupFactCollections([prices, slots]);
    expect(groups).toHaveLength(2);
  });

  it('rowKeyValue reads the key attribute and null for un-keyed collections', () => {
    const slots = coll('مواعيد', 'الدورة', []);
    const r = row('x', { attributes: [{ label: 'الدورة', value: 'انكليزي' }] });
    expect(rowKeyValue(slots, r)).toBe('انكليزي');
    expect(rowKeyValue(coll('أسعار', null, []), r)).toBeNull();
  });
});
