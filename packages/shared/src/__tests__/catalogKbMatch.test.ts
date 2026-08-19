import { describe, it, expect } from 'vitest';
import { matchCatalogLinesInKb, matchStructuredFieldLinesInKb, removeKbLines } from '../catalogKbMatch';
import { presentFieldsFromProfile, hasFieldLinesToClean } from '../index';

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

  /**
   * Reported 2026-08-19 with a screenshot: the cleanup sheet offered two FAQ
   * lines — neither carrying a price — PRE-CHECKED for deletion from Business
   * Info. Both are reproduced verbatim here; a single item named «جواب24» is
   * what makes them match.
   *
   * Mutation check: revert the per-item digit gate and the first test fails;
   * revert the MAX_ROW_TAIL_TOKENS cap and the second reports 'exact'.
   */
  describe('a digit inside the item NAME is not a price', () => {
    const BRAND = [{ id: 'brand', name: 'جواب24' }];
    const FAQ_QUESTION = 'كيف يعمل الذكاء الاصطناعي في جواب24؟';
    const FAQ_ANSWER =
      'الطريقة بسيطة من خلال تحميل تطبيق جواب٢٤ على اندرويد او من خلال صفحة جواب ٢٤';

    it('never proposes a prose line whose only digits come from the name', () => {
      // The «24» in «جواب24» is the brand, not an amount — this line prices
      // nothing, so the cleanup scope does not include it.
      expect(matchCatalogLinesInKb(FAQ_QUESTION, BRAND)).toEqual([]);
    });

    it('offers a sentence UNCHECKED even when it does carry a real number', () => {
      // «صفحة جواب ٢٤» leaves a standalone 24 once the name is removed, so the
      // price gate cannot reject it. The prose cap is what stops it being one
      // tap from deletion.
      const matches = matchCatalogLinesInKb(FAQ_ANSWER, BRAND);
      expect(matches).toHaveLength(1);
      expect(matches[0].confidence).toBe('tokens');
    });

    it('still pre-checks a genuine price row for the same digit-bearing name', () => {
      // The fix must not make digit-bearing names unmatchable — only unpriced
      // prose about them.
      const matches = matchCatalogLinesInKb('جواب24 — 15$ شهرياً', BRAND);
      expect(matches).toHaveLength(1);
      expect(matches[0].confidence).toBe('exact');
    });
  });

  it('measures the prose tail per LINE, so a multi-product row stays exact', () => {
    // Three names + three prices is a long line, but every word on it is
    // catalog content. Measuring the tail per item would have read the OTHER
    // two products as prose and demoted all three to 'tokens'.
    const matches = matchCatalogLinesInKb('زيت موتول ١٨ ألف، فلتر هواء ٢٥ ألف، بوجيه ٣٠ ألف', [
      { id: 'oil', name: 'زيت موتول' },
      { id: 'filter', name: 'فلتر هواء' },
      { id: 'plug', name: 'بوجيه' },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].itemIds).toEqual(['oil', 'filter', 'plug']);
    expect(matches[0].confidence).toBe('exact');
  });

  it('keeps a wordy but real price row at exact confidence', () => {
    // The prose cap must clear the wordiest rows merchants actually write, or
    // it silently stops pre-checking legitimate cleanups.
    const matches = matchCatalogLinesInKb('باقة الاحتراف: ٢٥ دولار شهرياً للمتجر الواحد', [
      { id: 'pro', name: 'باقة الاحتراف' },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0].confidence).toBe('exact');
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

  // ── «الموقع» — the label this matcher was blind to ────────────────────────
  //
  // Everything above uses «العنوان». The moto fixture — and, from the 07-23
  // measurement, most merchants — write «📍 الموقع:». «موقع» was excluded from
  // the label list because it collides with «الموقع الإلكتروني» (website), so
  // the matcher proposed NOTHING for the very line #720 is about: the feature
  // was a no-op wherever it mattered most. It is admitted now and separated
  // from the website by evidence ON THE LINE, not by dropping the label.
  describe('«الموقع» is the address label merchants actually use', () => {
    // The line the moto fixture carried while #720 was open. It is no longer in
    // seedData.ts — that fixture now models the merchant who ACCEPTED this
    // proposal — so the shape is pinned here, where the proposing is tested.
    const REAL_LINE = '📍 الموقع: الرياض، حي العزيزية، طريق الحائر';

    it('proposes the real fixture line — the exact miss that made C-F1 a no-op', () => {
      const matches = matchStructuredFieldLinesInKb(REAL_LINE, { address: true });
      expect(matches).toHaveLength(1);
      expect(matches[0].fields).toEqual(['address']);
    });

    it.each([
      ['🌐 الموقع الإلكتروني: https://majd-moto.com', 'the ال-prefixed website phrase'],
      ['الموقع الالكتروني: www.majd-moto.com', 'the unhamzated spelling'],
      ['موقع الشركة: majd-moto.com', 'a bare domain with no «إلكتروني» at all'],
    ])('does NOT propose %s (%s)', (line) => {
      expect(matchStructuredFieldLinesInKb(line, { address: true })).toEqual([]);
    });

    it('an UNAMBIGUOUS label still wins on a line that also carries a URL', () => {
      // «عنواننا» names the place outright, so the website evidence does not
      // veto it. Field lines reach the sheet UNCHECKED (D-038) and the merchant
      // decides — proposing is not removing.
      const line = 'عنواننا: حي العزيزية — وللطلب www.majd-moto.com';
      expect(matchStructuredFieldLinesInKb(line, { address: true })).toHaveLength(1);
    });

    it('«موقعنا» (the possessive) keeps working — it was never the ambiguous one', () => {
      expect(matchStructuredFieldLinesInKb('موقعنا: حي العزيزية', { address: true })).toHaveLength(1);
    });

    it('proposes nothing when the address field is not confirmed', () => {
      expect(matchStructuredFieldLinesInKb(REAL_LINE, { phone: true })).toEqual([]);
    });
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

/**
 * The single question both cleanup triggers ask — the fact-save in `/business`
 * (C-F1, the #720 fix) and the post-import pass in CatalogManager. It exists as
 * one function precisely so those two cannot drift into disagreeing about when
 * the offer appears; that drift is what left the cleanup unreachable from the
 * place the conflict is actually created.
 */
describe('hasFieldLinesToClean (the shared cleanup trigger)', () => {
  // The moto page as it was when #720 was filed: the merchant confirms النسيم
  // in /business while this line still sits in their Business Info.
  const STALE = '📍 الموقع: الرياض، حي العزيزية، طريق الحائر';
  const CONFIRMED = { merchant: { address: 'الرياض، حي النسيم، طريق الدائري الشرقي' } };

  it('offers the cleanup for the address the merchant just confirmed', () => {
    expect(hasFieldLinesToClean(STALE, CONFIRMED)).toBe(true);
  });

  it('stays silent when the field is NOT confirmed — nothing outranks the narrative yet', () => {
    expect(hasFieldLinesToClean(STALE, { merchant: {} })).toBe(false);
  });

  it('stays silent on an empty or whitespace-only Business Info', () => {
    expect(hasFieldLinesToClean('', CONFIRMED)).toBe(false);
    expect(hasFieldLinesToClean('   \n  ', CONFIRMED)).toBe(false);
    expect(hasFieldLinesToClean(null, CONFIRMED)).toBe(false);
    expect(hasFieldLinesToClean(undefined, CONFIRMED)).toBe(false);
  });

  it('stays silent when the KB says nothing about the confirmed field', () => {
    expect(hasFieldLinesToClean('نبيع قطع غيار أصلية لجميع الموتوسيكلات', CONFIRMED)).toBe(false);
  });

  it('reads the {merchant,suggestions} CONTAINER — an UNCONFIRMED suggestion must not trigger it', () => {
    // Reading the profile flat (or off `suggestions`) makes the feature fire on
    // data the merchant never confirmed — the inverse of the 07-23 bug, and it
    // would propose deleting a line backed by nothing more authoritative.
    expect(hasFieldLinesToClean(STALE, { merchant: {}, suggestions: { address: 'حي النسيم' } })).toBe(false);
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
