import { describe, it, expect } from 'vitest';
import { isPostSuggestionsVisible } from '@/lib/featureFlags';

const FOUNDER_WS = 'a0005407-92bf-473e-9368-013f14c57a7d';
const MES_WS = '9b6ba279-b569-4b45-b020-55b542dad5b6';
const WALEED_WS = '30c90e2c-6ede-4e20-9b9e-9c5cd308e25d';

describe('isPostSuggestionsVisible — «بوست اليوم» pilot allowlist', () => {
  it('shows for the founder workspace and the invited merchant testers', () => {
    expect(isPostSuggestionsVisible(FOUNDER_WS)).toBe(true);
    expect(isPostSuggestionsVisible(MES_WS)).toBe(true);
    expect(isPostSuggestionsVisible(WALEED_WS)).toBe(true);
  });

  it('hides for everyone else — the pilot must not leak to the fleet', () => {
    expect(isPostSuggestionsVisible('some-other-workspace')).toBe(false);
    expect(isPostSuggestionsVisible(null)).toBe(false);
    expect(isPostSuggestionsVisible(undefined)).toBe(false);
    expect(isPostSuggestionsVisible('')).toBe(false);
  });

  it('matches exactly — a case-shifted id is a different workspace', () => {
    expect(isPostSuggestionsVisible(MES_WS.toUpperCase())).toBe(false);
  });
});
