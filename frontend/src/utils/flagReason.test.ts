import { describe, it, expect } from 'vitest';
import { isKbGapFlag, getKbGapQuestion, isKbRelatedFlag } from './flagReason';

describe('isKbGapFlag', () => {
  it('detects each KB-gap flag standalone', () => {
    expect(isKbGapFlag('info_not_in_kb')).toBe(true);
    expect(isKbGapFlag('price_not_in_kb')).toBe(true);
    expect(isKbGapFlag('phone_not_in_kb')).toBe(true);
  });

  it('detects a KB-gap flag among comma-separated flags (any position)', () => {
    expect(isKbGapFlag('low_confidence,info_not_in_kb')).toBe(true);
    expect(isKbGapFlag('angry_customer,price_not_in_kb')).toBe(true);
  });

  it('is false for non-KB flags and empty input', () => {
    expect(isKbGapFlag('angry_customer')).toBe(false);
    expect(isKbGapFlag('low_confidence')).toBe(false);
    expect(isKbGapFlag(null)).toBe(false);
    expect(isKbGapFlag(undefined)).toBe(false);
    expect(isKbGapFlag('')).toBe(false);
  });
});

describe('getKbGapQuestion', () => {
  it('returns the captured question for an info gap', () => {
    expect(
      getKbGapQuestion('info_not_in_kb', { info_not_in_kb: { question: 'Do you deliver to Jeddah?' } }),
    ).toBe('Do you deliver to Jeddah?');
  });

  it('returns the captured question for a price gap', () => {
    expect(
      getKbGapQuestion('price_not_in_kb', { price_not_in_kb: { question: 'كم سعر دورة ICDL؟' } }),
    ).toBe('كم سعر دورة ICDL؟');
  });

  it('trims surrounding whitespace', () => {
    expect(
      getKbGapQuestion('low_confidence,info_not_in_kb', { info_not_in_kb: { question: '  متى تفتحون؟  ' } }),
    ).toBe('متى تفتحون؟');
  });

  it('returns null when the flag is present but no question was captured', () => {
    expect(getKbGapQuestion('info_not_in_kb', null)).toBeNull();
    expect(getKbGapQuestion('price_not_in_kb', {})).toBeNull();
    expect(getKbGapQuestion('info_not_in_kb', { info_not_in_kb: { question: '   ' } })).toBeNull();
  });

  it('returns null when the row is not a KB gap, even if meta carries a question', () => {
    expect(
      getKbGapQuestion('angry_customer', { info_not_in_kb: { question: 'leftover' } }),
    ).toBeNull();
  });
});

describe('isKbRelatedFlag (regression: KB gaps stay KB-related)', () => {
  it('treats KB-gap flags as KB-related', () => {
    expect(isKbRelatedFlag('info_not_in_kb')).toBe(true);
    expect(isKbRelatedFlag('price_not_in_kb')).toBe(true);
    expect(isKbRelatedFlag('phone_not_in_kb')).toBe(true);
  });
});
