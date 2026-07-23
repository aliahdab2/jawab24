import { describe, it, expect } from 'vitest';
import { matchCatalogLinesInKb, matchStructuredFieldLinesInKb, removeKbLines } from '../catalogKbMatch';
import { presentFieldsFromProfile } from '../index';

/** Real merchant shape: a price wall with headers, bullets, emoji and prose. */
const MOTO_KB = [
  '🛞 دراجتي لقطع الموتو',           // 0
  'أسعارنا:',                        // 1
  '- زيت موتول ١٨ ألف',              // 2 ← stale price line (catalog says 22)
  '- حامل جوال مغناطيسي ٣٥ ألف',     // 3
  'زيت موتول الأصلي متوفر دائماً',    // 4 ← prose mention, NO number → never proposed
  'العنوان: حي العزيزية',            // 5 ← fact line, not a catalog line
].join('\n');

const ITEMS = [
  { id: 'oil', name: 'زيت موتول' },
  { id: 'holder', name: 'حامل جوال مغناطيسي' },
];

describe('matchCatalogLinesInKb', () => {
  it('proposes exactly the price-carrying lines of catalog items', () => {
    const matches = matchCatalogLinesInKb(MOTO_KB, ITEMS);
    expect(matches.map((m) => m.lineIndex)).toEqual([2, 3]);
    expect(matches[0]).toMatchObject({ itemIds: ['oil'], confidence: 'exact' });
    expect(matches[1]).toMatchObject({ itemIds: ['holder'], confidence: 'exact' });
  });

  it('never proposes prose mentions without a number (cowardice rule)', () => {
    const matches = matchCatalogLinesInKb(MOTO_KB, ITEMS);
    expect(matches.some((m) => m.lineIndex === 4)).toBe(false);
    expect(matches.some((m) => m.lineIndex === 5)).toBe(false);
  });

  it('reads Arabic-Indic digits as numbers', () => {
    const matches = matchCatalogLinesInKb('زيت موتول ١٨', [ITEMS[0]]);
    expect(matches).toHaveLength(1);
  });

  it('distinguishing tokens keep similar items apart', () => {
    const kb = 'جاكيت جلد ٨٥٠\nجاكيت جينز ٦٥٠';
    const items = [
      { id: 'leather', name: 'جاكيت جلد' },
      { id: 'denim', name: 'جاكيت جينز' },
    ];
    const matches = matchCatalogLinesInKb(kb, items);
    expect(matches).toHaveLength(2);
    expect(matches[0].itemIds).toEqual(['leather']);
    expect(matches[1].itemIds).toEqual(['denim']);
  });

  it('folds taa marbuta so spelling variants still match', () => {
    const matches = matchCatalogLinesInKb('نظاره شمسيه ٤٠', [
      { id: 'g', name: 'نظارة شمسية' },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe('exact');
  });

  it('tolerates the ال prefix on tokens', () => {
    const matches = matchCatalogLinesInKb('الزيت موتول ١٨', [ITEMS[0]]);
    expect(matches).toHaveLength(1);
  });

  it('scattered tokens match at lower confidence, never exact', () => {
    const matches = matchCatalogLinesInKb('مغناطيسي حامل جوال ٣٥', [ITEMS[1]]);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe('tokens');
  });

  it('does NOT match when a token only appears inside another word', () => {
    // «للجوال» is not a standalone «جوال» — cowardice over cleverness.
    const matches = matchCatalogLinesInKb('حامل للجوال مغناطيسي ٣٥', [ITEMS[1]]);
    expect(matches).toHaveLength(0);
  });

  it('caps single short generic names at tokens confidence', () => {
    // «زيت» alone is too generic to pre-check — merchant must opt in.
    const matches = matchCatalogLinesInKb('زيت الزيتون ٥', [{ id: 'z', name: 'زيت' }]);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe('tokens');
  });

  it('returns empty for empty inputs', () => {
    expect(matchCatalogLinesInKb('', ITEMS)).toEqual([]);
    expect(matchCatalogLinesInKb(MOTO_KB, [])).toEqual([]);
  });
});

describe('matchStructuredFieldLinesInKb (the #720 fix)', () => {
  // The exact #720 shape: a confirmed address field + a stale narrative address.
  const KB = [
    'دراجتي لقطع الموتو',                 // 0
    'العنوان: حي العزيزية، طريق الحائر',    // 1 ← stale address (field says النسيم)
    'دوامنا من ٩ صباحاً إلى ٩ مساءً',       // 2 ← hours line
    'للتواصل: ٠٩٣٥٩٢٤٤٧٢',                  // 3 ← phone line
    'نوصّل لكل العناوين داخل دمشق',          // 4 ← delivery prose, NOT their address
  ].join('\n');

  it('proposes the stale address line when the address field is confirmed', () => {
    const matches = matchStructuredFieldLinesInKb(KB, { address: true });
    expect(matches.map((m) => m.lineIndex)).toContain(1);
    expect(matches.find((m) => m.lineIndex === 1)?.fields).toEqual(['address']);
  });

  it('never proposes ANY field line when no field is confirmed (nothing more authoritative exists)', () => {
    expect(matchStructuredFieldLinesInKb(KB, {})).toEqual([]);
  });

  it('does NOT match delivery prose that merely contains a plural of the label', () => {
    // «العناوين» is a different token from «عنوان» — standalone matching skips it.
    const matches = matchStructuredFieldLinesInKb(KB, { address: true });
    expect(matches.some((m) => m.lineIndex === 4)).toBe(false);
  });

  it('matches hours + phone lines only when those fields are confirmed and a digit is present', () => {
    const matches = matchStructuredFieldLinesInKb(KB, { hours: true, phone: true });
    const byLine = new Map(matches.map((m) => [m.lineIndex, m.fields]));
    expect(byLine.get(2)).toEqual(['hours']);
    expect(byLine.get(3)).toEqual(['phone']);
    // address field NOT confirmed here → line 1 not proposed
    expect(byLine.has(1)).toBe(false);
  });

  it('requires a digit for phone/hours (a label alone is not a claim)', () => {
    const matches = matchStructuredFieldLinesInKb('نحن نهتم بمواعيد عملائنا', { hours: true });
    expect(matches).toHaveLength(0);
  });

  it('the full #720 round-trip: propose → remove → stale address gone, field survives elsewhere', () => {
    const matches = matchStructuredFieldLinesInKb(KB, { address: true });
    const cleaned = removeKbLines(KB, matches.map((m) => m.lineIndex));
    expect(cleaned).not.toContain('العزيزية');
    expect(cleaned).toContain('نوصّل لكل العناوين'); // delivery prose kept
  });
});

describe('presentFieldsFromProfile (guards the container-unwrap regression)', () => {
  // The exact bug this guards: the API serves businessProfile as the
  // {merchant, suggestions} CONTAINER; reading it as a flat BusinessProfile
  // returns undefined for every field → field matches never fire (#720 stays).
  it('reads confirmed fields from the CONTAINER shape (merchant.*), not the top level', () => {
    const container = {
      merchant: { address: 'حي النسيم', phones: ['0114567890'], hours: { sat: ['09:00-21:00'] } },
      suggestions: { address: 'حي العزيزية' },
    };
    expect(presentFieldsFromProfile(container)).toEqual({ address: true, phone: true, hours: true });
  });

  it('treats a legacy FLAT profile as unconfirmed (unwrap routes it to suggestions)', () => {
    // A flat BusinessProfile has no merchant/suggestions wrapper, so
    // unwrapBusinessProfile files it under `suggestions` (FB-sync tier). Since
    // only CONFIRMED merchant values gate cleanup, a flat profile is "not
    // present" — correct: we never propose removing a KB line on the strength
    // of an unconfirmed value.
    expect(presentFieldsFromProfile({ address: 'حي النسيم', phones: ['09'] }))
      .toEqual({ address: false, phone: false, hours: false });
  });

  it('ignores suggestions (unconfirmed) — only merchant values count', () => {
    // FB-sync address lives in suggestions; not merchant → not "present".
    expect(presentFieldsFromProfile({ merchant: {}, suggestions: { address: 'حي العزيزية' } }))
      .toEqual({ address: false, phone: false, hours: false });
  });

  it('treats blank/empty values as absent', () => {
    expect(presentFieldsFromProfile({ merchant: { address: '   ', phones: [], hours: {} } }))
      .toEqual({ address: false, phone: false, hours: false });
  });

  it('handles null/undefined', () => {
    expect(presentFieldsFromProfile(null)).toEqual({ address: false, phone: false, hours: false });
    expect(presentFieldsFromProfile(undefined)).toEqual({ address: false, phone: false, hours: false });
  });
});

describe('removeKbLines', () => {
  it('removes confirmed lines only and tidies blank runs', () => {
    const cleaned = removeKbLines(MOTO_KB, [2, 3]);
    expect(cleaned).not.toContain('١٨');
    expect(cleaned).not.toContain('٣٥');
    expect(cleaned).toContain('زيت موتول الأصلي متوفر دائماً');
    expect(cleaned).toContain('العنوان: حي العزيزية');
    expect(cleaned).not.toMatch(/\n{3,}/);
  });

  it('is a no-op without confirmed indices', () => {
    expect(removeKbLines(MOTO_KB, [])).toBe(MOTO_KB);
  });
});
