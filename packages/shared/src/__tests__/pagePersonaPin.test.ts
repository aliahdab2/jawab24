import { describe, it, expect } from 'vitest';
import { coerceMultiLang, hasPagePersonaPin, resolvePagePersonaLanguages } from '../index';

/**
 * The per-page persona pin (D-084). These semantics were previously expressed
 * ONLY inline inside `resolveBrandVoiceNotes` (backend reply pipeline) and had
 * no test at all — which is why they are pinned here now that the support
 * console decides "this page is pinned" with the same predicate. A drift between
 * the two would make the console claim a pin the pipeline does not honour, or
 * hide one it does.
 *
 * The rule that matters: a non-empty result is a PIN, and a pin suppresses the
 * workspace persona ENTIRELY (no workspace fallback, no legacy-column fallback).
 * So anything that wrongly reads as content silences the workspace persona for
 * that page.
 */
describe('resolvePagePersonaLanguages / hasPagePersonaPin', () => {
  it('a real language variant is a pin', () => {
    expect(resolvePagePersonaLanguages({ ar: 'نتحدث بلهجة شامية' })).toEqual({ ar: 'نتحدث بلهجة شامية' });
    expect(hasPagePersonaPin({ ar: 'نتحدث بلهجة شامية' })).toBe(true);
  });

  it('NULL, undefined and {} all mean inherit, never a pin', () => {
    expect(hasPagePersonaPin(null)).toBe(false);
    expect(hasPagePersonaPin(undefined)).toBe(false);
    expect(hasPagePersonaPin({})).toBe(false);
  });

  it('an all-cleared record inherits — clearing every language reverts to the workspace persona', () => {
    expect(hasPagePersonaPin({ ar: '', en: '' })).toBe(false);
    expect(resolvePagePersonaLanguages({ ar: '', en: '' })).toEqual({});
  });

  it('sourceLang is bookkeeping, not a language — alone it is not a pin', () => {
    // Reading it as content would pin the page on a value the merchant never
    // wrote, and then answer customers with the string "ar" as the persona.
    expect(hasPagePersonaPin({ sourceLang: 'ar' })).toBe(false);
    expect(resolvePagePersonaLanguages({ sourceLang: 'ar', en: 'We are friendly' })).toEqual({ en: 'We are friendly' });
  });

  it('a whitespace-only variant is not content', () => {
    // { ar: 'نص', en: '  ' } must pin on `ar` only: without the trim filter the
    // truthy whitespace string is picked as the whole persona for English
    // customers, while the pin has already suppressed the workspace fallback.
    expect(hasPagePersonaPin({ en: '   ' })).toBe(false);
    expect(resolvePagePersonaLanguages({ ar: 'نص', en: '  ' })).toEqual({ ar: 'نص' });
  });

  it('a non-string variant is not content (raw jsonb can hold anything)', () => {
    expect(hasPagePersonaPin({ ar: 42 as unknown as string })).toBe(false);
    expect(hasPagePersonaPin({ ar: null as unknown as string })).toBe(false);
  });

  it('a DOUBLE-ENCODED row still resolves — the jsonb cell may hold a JSON string', () => {
    // The business_profile precedent: postgres.js hands back a string, and
    // indexing a string by language silently yields undefined. Without the
    // coercion a pinned page would read as inheriting.
    expect(hasPagePersonaPin(JSON.stringify({ ar: 'نص الشخصية' }))).toBe(true);
    expect(resolvePagePersonaLanguages('{"ar":"نص الشخصية"}')).toEqual({ ar: 'نص الشخصية' });
  });

  it('unparseable or non-object junk is inherit, never a throw', () => {
    expect(hasPagePersonaPin('not json at all')).toBe(false);
    expect(hasPagePersonaPin('"a bare json string"')).toBe(false);
    expect(hasPagePersonaPin(42)).toBe(false);
    expect(hasPagePersonaPin(true)).toBe(false);
  });
});

describe('coerceMultiLang', () => {
  it('passes an object through and parses a double-encoded string', () => {
    expect(coerceMultiLang({ ar: 'أ', en: 'a' })).toEqual({ ar: 'أ', en: 'a' });
    expect(coerceMultiLang('{"ar":"أ"}')).toEqual({ ar: 'أ' });
  });

  it('returns {} for null/undefined/unparseable/non-object, so callers never guard', () => {
    expect(coerceMultiLang(null)).toEqual({});
    expect(coerceMultiLang(undefined)).toEqual({});
    expect(coerceMultiLang('{oops')).toEqual({});
    expect(coerceMultiLang('"bare string"')).toEqual({});
    expect(coerceMultiLang(7)).toEqual({});
  });
});
