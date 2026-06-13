import { describe, it, expect } from 'vitest';
import { isInfoGapFlag, getInfoGapQuestion, isKbRelatedFlag } from './flagReason';

describe('isInfoGapFlag', () => {
  it('detects info_not_in_kb as a standalone flag', () => {
    expect(isInfoGapFlag('info_not_in_kb')).toBe(true);
  });

  it('detects info_not_in_kb among comma-separated flags', () => {
    expect(isInfoGapFlag('low_confidence,info_not_in_kb')).toBe(true);
  });

  it('is false for other KB flags and empty input', () => {
    expect(isInfoGapFlag('price_not_in_kb')).toBe(false);
    expect(isInfoGapFlag(null)).toBe(false);
    expect(isInfoGapFlag(undefined)).toBe(false);
    expect(isInfoGapFlag('')).toBe(false);
  });
});

describe('getInfoGapQuestion', () => {
  it('returns the captured question for an info gap', () => {
    expect(
      getInfoGapQuestion('info_not_in_kb', { info_not_in_kb: { question: 'Do you deliver to Jeddah?' } }),
    ).toBe('Do you deliver to Jeddah?');
  });

  it('trims surrounding whitespace', () => {
    expect(
      getInfoGapQuestion('low_confidence,info_not_in_kb', { info_not_in_kb: { question: '  متى تفتحون؟  ' } }),
    ).toBe('متى تفتحون؟');
  });

  it('returns null when the flag is present but no question was captured', () => {
    expect(getInfoGapQuestion('info_not_in_kb', null)).toBeNull();
    expect(getInfoGapQuestion('info_not_in_kb', {})).toBeNull();
    expect(getInfoGapQuestion('info_not_in_kb', { info_not_in_kb: { question: '   ' } })).toBeNull();
  });

  it('returns null when the row is not an info gap, even if meta carries a question', () => {
    expect(
      getInfoGapQuestion('price_not_in_kb', { info_not_in_kb: { question: 'leftover' } }),
    ).toBeNull();
  });
});

describe('isKbRelatedFlag (regression: info gap stays KB-related)', () => {
  it('treats info_not_in_kb as KB-related', () => {
    expect(isKbRelatedFlag('info_not_in_kb')).toBe(true);
  });
});
