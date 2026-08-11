import { describe, it, expect } from 'vitest';
import { isCatalogVisible, isPostSuggestionsVisible } from '@/lib/featureFlags';

const FOUNDER_WS = 'a0005407-92bf-473e-9368-013f14c57a7d';
const MES_WS = '9b6ba279-b569-4b45-b020-55b542dad5b6';
const WALEED_WS = '30c90e2c-6ede-4e20-9b9e-9c5cd308e25d';

describe('isCatalogVisible — business surface gate (admin OR allowlisted workspace)', () => {
  it('platform admin passes regardless of workspaces', () => {
    expect(isCatalogVisible({ isAdmin: true })).toBe(true);
    expect(isCatalogVisible({ isAdmin: true }, [])).toBe(true);
  });

  it('a member of the founder workspace passes without platform admin', () => {
    expect(isCatalogVisible({ isAdmin: false }, [FOUNDER_WS])).toBe(true);
    expect(isCatalogVisible({ isAdmin: false }, ['other-ws', FOUNDER_WS])).toBe(true);
  });

  it('a member of the MES workspace passes without platform admin (seeded merchant, 2026-08-08)', () => {
    expect(isCatalogVisible({ isAdmin: false }, [MES_WS])).toBe(true);
  });

  it('a member of the Waleed workspace passes without platform admin (self-authoring merchant, 2026-08-11)', () => {
    expect(isCatalogVisible({ isAdmin: false }, [WALEED_WS])).toBe(true);
  });

  it('everyone else stays gated — including missing user or workspaces', () => {
    expect(isCatalogVisible({ isAdmin: false }, ['some-other-workspace'])).toBe(false);
    expect(isCatalogVisible({ isAdmin: false })).toBe(false);
    expect(isCatalogVisible(null, [FOUNDER_WS.toUpperCase()])).toBe(false);
    expect(isCatalogVisible(undefined)).toBe(false);
  });
});

describe('isPostSuggestionsVisible — «بوست اليوم» pilot allowlist', () => {
  it('shows for the founder workspace and the invited merchant tester', () => {
    expect(isPostSuggestionsVisible(FOUNDER_WS)).toBe(true);
    expect(isPostSuggestionsVisible(MES_WS)).toBe(true);
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
